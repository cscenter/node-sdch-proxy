#!/usr/bin/env node
var debug = require('debug')('node-sdch-proxy');
var express = require('express');
var fs = require('fs');
var url = require('url');
var zlib = require('zlib');
var logger = require('morgan');
var sdch = require('sdch');
var connectSdch = require('../connect-sdch');
var config = require('config-node')();
var mkdirp = require('mkdirp');
var exec = require('child_process').exec;
var crypto = require('crypto');
var http = require('http');

var app = express();

////Здесь может быть много словарей
//var initialDictionaries = [
//    new sdch.SdchDictionary({
//        url: 'http://' + config.testServerHost + ':' + config.testServerPort + config.dictionartPath,
//        domain: config.testServerHost,
//        data: fs.readFileSync(config.dictionaryFile)
//    })
//];

//console.log(d.path);

//var initialDictionaries = [
//     new sdch.SdchDictionary({
//    url: 'http://' + config.testServerHost + ':' + config.testServerPort + config.dictionartPath,
//    domain: config.testServerHost,
//    data: fs.readFileSync(config.dictionaryFile)
//}) ];
var storage = new connectSdch.DictionaryStorage([]);
var addDictionary = function (data, domainName, dictUrl) {
    dictUrl = dictUrl || 'http://' + domainName + '/dictionaries/dict-x' + randWD(13);
    console.log("Add dict: " + dictUrl);
    var dict = new sdch.SdchDictionary({
        url: dictUrl,
        domain: domainName,
        data: data
    });
    storage.addDictionary(dict);
};

addDictionary(
    fs.readFileSync(config.dictionaryFile),
    config.testServerHost,
    'http://' + config.testServerHost + ':' + config.testServerPort + config.dictionartPath
); //test

for (var i = 0; i < config.domains.length; i++) {
    config.domains[i].hits = 0
}
// Создаем хранилище словарей

// create a write stream (in append mode)
mkdirp(__dirname + '/logs');
var tempFileDir = __dirname + '/tempFiles';
mkdirp(tempFileDir);
var proxyErrLog = fs.createWriteStream(__dirname + '/logs/proxy-error.log', {flags: 'w'})
var proxyLog = fs.createWriteStream(__dirname + '/logs/proxy.log', {flags: 'w'})
var sdchLog = fs.createWriteStream(__dirname + '/logs/sdch.log', {flags: 'w'})

// Middleware

// setup the logger
logger.token('hostname', function (req, res) {
    return url.parse(req.url).hostname
});

app.use(logger('common',
    {
        skip: function (req, res) {
            return res.statusCode < 400
        }, stream: proxyErrLog
    }
));
app.use(logger('common', {stream: proxyLog}
));

app.use(logger(('":method :hostname";Avail-Dictionary:[:req[Avail-Dictionary]];'
    + ':status;Get-Dictionary:[:res[Get-Dictionary]];'
    + 'Content-type:[:res[content-type]];Content-Encoding:[:res[content-encoding]];'),
    {
        skip: function (req, res) {
            return !isTextContent(res)
        }, stream: sdchLog
    }
));

app.use(connectSdch.compress({threshold: '1kb'}, {/* some zlib options */}));

/*
 connectSdch.encode(options, encodeOptions)
 если Accept-Encoding содержит sdch,
 добавляет к ответу Get-Dictionary со списком доступных словарей.
 */

app.use(connectSdch.encode({
    // toSend определяет какой словарь будет добавлен в Get-Dictionary
    toSend: function (req, availDicts) {
        var domainName = getDomain(url.parse(req.url).hostname);
        console.log("To send: " + domainName);
        var dict = storage.getByDomain(domainName);
        if (dict){
            if (availDicts.indexOf(dict.clientHash) < 0) { // если у клиента нет самого свежего словаря - предложить
                console.log("Sended: " + dict.clientHash);
                return dict;
            }
        }
        return null;
    },
    // toEncode определяет какой словарь будет использован для шифрования ответа
    toEncode: function (req, availDicts) {
        var domainName = getDomain(url.parse(req.url).hostname);
        console.log("To encode: " + domainName);
        var availDictsMap = {};
        availDicts.forEach(function(e) {
            availDictsMap[e] = true;
        });
        var dictsByDomain = storage.dictsByDomain(domainName);

        for(var i = dictsByDomain.length - 1; i >= 0; --i) {
            if(sdch.clientUtils.canAdvertiseDictionary(dictsByDomain[i], req.url)) {
                return dictsByDomain[i];
            }
        }
        return null;
    }
}, {/* some vcdiff options */}));

// перехварывает и обрабатывает запрос словаря
app.use(connectSdch.serve(storage));

// прокся
app.all('/*', function proxy(clientRequest, clinetResponse, next) { // get по любому url
    //console.log(url.parse(clientRequest.url).hostname);
    //console.log(clientRequest.url);
    console.log("Request HEADERS: ");
    for (var k in clientRequest.headers) {
        console.log(k + " : " + clientRequest.headers[k]);

    }
    clinetResponse.setHeader('Via', 'My-precious-proxy');
    var options = url.parse(clientRequest.url);
    options.method = clientRequest.method;

    options.headers = clientRequest.headers;
    options.headers['X-Real-IP'] = options.headers['X-Real-IP'] || clientRequest.ip;
    options.headers['X-Forwarded-Proto'] = options.headers['X-Forwarded-Proto'] || clientRequest.protocol;
    if (options.headers['X-Forwarded-For']) {
        options.headers['X-Forwarded-For'] = options.headers['X-Forwarded-For'] + ", " + clientRequest.ip;
    } else {
        options.headers['X-Forwarded-For'] = clientRequest.ip;
    }
    var proxyRequest;

    if (clientRequest.method != "GET") {
        proxyRequest = http.request(options, function (serverResponse) {
            clinetResponse.statusCode = serverResponse.statusCode;
            for (var k in serverResponse.headers) {
                clinetResponse.setHeader(k, serverResponse.headers[k]);
            }
            serverResponse.pipe(clinetResponse);
        });
        clientRequest.pipe(proxyRequest);
    } else {
        delete options.headers['accept-encoding']; // временное решение баги с едущей разметкой
        delete options.headers['Accept-Encoding']; // временное решение баги с едущей разметкой
        console.log("Headers: ");
        for(var h in options.headers) {
            console.log(h + " : " + options.headers[h]);
        }
        proxyRequest = http.get(options, function (serverResponse) {
            clinetResponse.statusCode = serverResponse.statusCode;
            var CE = serverResponse.headers['content-encoding'];
             CE = CE || serverResponse.headers['Content-Encoding'];
            console.log("responce encoding: " + CE)
            var p = serverResponse;
            //if (CE === 'gzip') {
            //    p = serverResponse.pipe(zlib.createGunzip());
            //    delete serverResponse.headers['content-encoding'];
            //}
            // копируем заголовки ответа удаленной стороны в наш ответ
            console.log("Response headers: ");
            for (var k in serverResponse.headers) {
                clinetResponse.setHeader(k, serverResponse.headers[k]);
                console.log(k + " " + serverResponse.headers[k]);

            }
            var parseUrl = url.parse(clientRequest.url);
            var currDomain = getDomain(parseUrl.hostname);
            var domainNum = -1;
            for (var i = 0; i < config.domains.length; i++) {
                if (config.domains[i].domainName == currDomain) {
                    domainNum = i
                }
            }

            if (domainNum === -1 || !isTextContent(clinetResponse)) {
                p.pipe(clinetResponse);
            } else {
                console.log(url.parse(clientRequest.url).hostname);
                var domainDir = config.dictionaryRootdir + '/' + currDomain;
                mkdirp(domainDir, function (err) {
                    if (!err) {
                        var randomName = tempFileDir + '/' + currDomain + '_' + randWD(20) + ".tmp";
                        var hash = crypto.createHash('md5');
                        var fileStream = fs.createWriteStream(randomName, {flags: 'w'});
                        p.on('readable', function () {
                            var chunk;
                            while (null !== (chunk = p.read())) {
                                clinetResponse.write(chunk);
                                hash.write(chunk);
                                fileStream.write(chunk);
                            }
                        })
                            .on('end', function () {
                                hash.end();
                                fileStream.end();
                                clinetResponse.end();
                                var hashName = hash.read().toString('hex');
                                console.log("rename from " + randomName + " to " + domainDir + '/' + hashName);
                                fs.rename(randomName, domainDir + '/' + hashName, function (err) {
                                    if (err) {
                                        console.log("NOT RENAMED: " + randomName + " hash: " + hashName);
                                    } else {
                                        config.domains[domainNum].hits += 1;
                                        if (config.domains[domainNum].hits == config.domains[domainNum].domainPageInDict) {
                                            var child = exec('./' + config.dictionaryGenerator + ' ' + currDomain,
                                                function (error, stdout, stderr) {
                                                    console.log('stdout: ' + stdout);
                                                    if (error !== null) {
                                                        console.log('exec error: ' + error);
                                                    } else {
                                                        fs.readFile(stdout.replace(/\n/, ''), function (err, data) {
                                                            if (err) {
                                                                console.log(err);
                                                            } else {
                                                                addDictionary(data, currDomain);
                                                                //console.log("Dictionaries avalible");
                                                                //for(var i = 0; i < storage.dicts().length; ++i) {
                                                                //    console.log(storage.dicts()[i].url)
                                                                //    console.log(storage.dicts()[i].domain)
                                                                //    console.log(storage.dicts()[i].clientHash)
                                                                //}
                                                                //
                                                                //console.log("Dict end");


                                                            }
                                                        });
                                                    }
                                                });
                                            config.domains[domainNum].hits = 0
                                        }
                                    }
                                });
                            })
                            .on('error', function (err) {
                                console.log("Stream page error:", err);
                            });

                    } else {
                        console.log(err);
                    }
                });

            }

        });
    }
    proxyRequest.on('error', function (err) {
        console.log('problem with request : ' + clientRequest.url + ' ' + err);
        clinetResponse.statusCode = 503;
        clinetResponse.setHeader('Retry-After', 10);
        clinetResponse.end();
    });
});

app.set('port', config.proxyPort || 3000);

function run() {
    var server = app.listen(app.get('port'), function () {
        console.log('node-sdch-proxy listening on port ' + server.address().port);
    });
}

if (module.parent) {
    exports.run = run
} else {
    run()
}

function getDomain(hostName) {
    var domain = hostName;
    if (hostName != null) {
        var parts = hostName.split('.').reverse();
        if (parts != null && parts.length > 1) {
            domain = parts[1] + '.' + parts[0];
        }
    }
    return domain;
}

function isTextContent(res) {
    var CT = res.getHeader('content-type');
    if (!CT) return false;
    return CT.toLowerCase().startsWith('text');
}

function randWD(n) {  // random words and digits
    return Math.random().toString(36).slice(2, 2 + Math.max(1, Math.min(n, 10)));
} //result is such as "46c17fkfpl"

if (typeof String.prototype.startsWith != 'function') {
    String.prototype.startsWith = function (str) {
        return str.length > 0 && this.substring(0, str.length) === str;
    }
}