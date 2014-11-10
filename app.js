#!/usr/bin/env node
var debug = require('debug')('node-sdch-proxy');
var express = require('express');
var fs = require('fs');
var url = require('url');
var zlib = require('zlib');
var request = require('superagent')
var logger = require('morgan');
var sdch = require('sdch');
var connectSdch = require('connect-sdch');
var config = require('config-node')();
var mkdirp = require('mkdirp');
var exec = require('child_process').exec;

var app = express();

// Здесь может быть много словарей
var dicts = [
  new sdch.SdchDictionary({
    url: 'http://' + config.testServerHost + ':' + config.testServerPort + config.dictionartPath,
    domain: config.testServerHost,
    data: fs.readFileSync(config.dictionaryFile)
  })
]
var domainHits = new Array(config.domains.length);
for (var i = 0; i < domainHits.length; i++) {
    domainHits[i] = 0
}
// Создаем хранилище словарей
var storage = new connectSdch.DictionaryStorage(dicts);

// create a write stream (in append mode)
var proxyErrLog = fs.createWriteStream(__dirname + '/logs/proxy-error.log', {flags: 'w'})
var proxyLog = fs.createWriteStream(__dirname + '/logs/proxy.log', {flags: 'w'})
var sdchLog = fs.createWriteStream(__dirname + '/logs/sdch.log', {flags: 'w'})

// Middleware

// setup the logger
logger.token('hostname', function(req, res){ return url.parse(req.url).hostname })

app.use(logger('common',
    { skip: function (req, res) { return res.statusCode < 400 }, stream: proxyErrLog }
))
app.use(logger('common', { stream: proxyLog }
))

app.use(logger(('":method :hostname";Avail-Dictionary:[:req[Avail-Dictionary]];'
                + ':status;Get-Dictionary:[:res[Get-Dictionary]];'
                + 'Content-type:[:res[content-type]];Content-Encoding:[:res[content-encoding]];'),
    { skip: function (req, res) { return !isTextContent(res) }, stream: sdchLog }
))

app.use(connectSdch.compress({ threshold: '1kb' }, { /* some zlib options */ }));

/*
 connectSdch.encode(options, encodeOptions)
 если Accept-Encoding содержит sdch,
 добавляет к ответу Get-Dictionary со списком доступных словарей.
 */

app.use(connectSdch.encode({
    // toSend определяет какой словарь будет добавлен в Get-Dictionary
    toSend: function(req, availDicts) {
        if (url.parse(req.url).hostname == config.testServerHost)
            return [dicts[0]]
        else
            return null
    },
    // toEncode определяет какой словарь будет использован для шифрования ответа
    toEncode: function(req, availDicts) {
        // Use only first dictionary
        if (availDicts.length > 0 &&
            availDicts[0] === dicts[0].clientHash)
            return dicts[0]
        return null;
    }
}, { /* some vcdiff options */ }));

// перехварывает и обрабатывает запрос словаря
app.use(connectSdch.serve(storage));

// прокся
app.get('/*', function proxy(req, res, next) { // get по любому url
    res.setHeader('Via', 'My-precious-proxy');
    request.get(req.url)  // проксируем get
        .set(req.headers)
        .request()          // дождались ответа  --> вернет объект ответа
        .on('response', function(resp) {
            res.statusCode = resp.statusCode;
            var CE = resp.headers['content-encoding'];
            var p = resp;
            if (CE === 'gzip') {
                p = resp.pipe(zlib.createGunzip());
                delete resp.headers['content-encoding'];
            }
            // копируем заголовки ответа удаленной стороны в наш ответ
            for (var k in resp.headers) {
                res.setHeader(k, resp.headers[k]);
            }
            p.pipe(res);
            var parseUrl = url.parse(req.url)
            var currDomain =  getDomain(parseUrl.hostname)
            var domainNum = -1
            for(var i = 0; i < config.domains.length; i++) {
                if (config.domains[i].domainName == currDomain) {
                    domainNum = i
                }
            }
            if (domainNum != -1 && isTextContent(res)) {
                var dir = config.dictionaryRootdir + '/' + currDomain
                mkdirp(dir, function (err) {
                    if (!err) {
                        p.pipe(fs.createWriteStream(dir + '/'
                            + fixedEncodeURIComponent(parseUrl.path), {flags: 'w'}))
                            .on('error', function (err) {
                                console.log("Stream page:", err);
                            })
                    } else {
                        console.log(err);
                    }
                });
                domainHits[domainNum] += 1
                if (domainHits[domainNum] == config.domains[domainNum].domainPageInDict) {
                    var child = exec('./' + config.dictionaryGenerator + ' ' + currDomain,
                        function (error, stdout, stderr) {
                            //TODO  перегрузить словарь для домена из этого файла
                            console.log('stdout: ' + stdout);
                            fs.readFile(stdout.replace(/\n/, ''), function (err, data) {
                                if (err) throw err;
                                dicts[0].url = 'http://' + currDomain + '/dictionaries/dict-x' + randWD(13)
                                dicts[0].domain = currDomain
                                dicts[0].data = data
                            });
                            if (error !== null) {
                                console.log('exec error: ' + error);
                            }
                        });
                    domainHits[domainNum] = 0
                }
            }
        }).end();
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
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

function fixedEncodeURIComponent(str) {
    return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
        return '%' + c.charCodeAt(0).toString(16);
    });
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
    var CT = res.getHeader('content-type')
    if (!CT) return false
    return CT.toLowerCase().startsWith('text')
}

function randWD(n){  // random words and digits
    return Math.random().toString(36).slice(2, 2 + Math.max(1, Math.min(n, 10)) );
} //result is such as "46c17fkfpl"

if (typeof String.prototype.startsWith != 'function') {
    String.prototype.startsWith = function( str ) {
        return str.length > 0 && this.substring(0, str.length) === str;
    }
}