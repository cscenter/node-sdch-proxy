#!/usr/bin/env node
var debug = require('debug')('node-sdch-proxy');
var express = require('express');
var fs = require('fs');
var path = require('path');
var url = require('url');
var zlib = require('zlib');
var compression = require('compression');
var request = require('superagent')
var logger = require('morgan');
var sdch = require('sdch');
var connectSdch = require('connect-sdch');
var app = express();

// Здесь может быть много словарей
var dicts = [
  new sdch.SdchDictionary({
    url: 'http://ru.wikipedia.org/some-wikipedia-dict-sldkfjlskdjflsk',
    domain: 'ru.wikipedia.org',
    data: fs.readFileSync('model.fzm')
  }),
]
// Создаем хранилище словарей
var storage = new connectSdch.DictionaryStorage(dicts);

// create a write stream (in append mode)
var proxyErrLog = fs.createWriteStream(__dirname + '/logs/proxy-error.log', {flags: 'a'})
var sdchLog = fs.createWriteStream(__dirname + '/logs/sdch.log', {flags: 'a'})

// Middleware

// setup the logger
logger.token('hostname', function(req, res){ return url.parse(req.url).hostname })
app.use(logger('common',
    { skip: function (req, res) { return res.statusCode < 400 }, stream: proxyErrLog }
))

app.use(logger(('":method :hostname";Avail-Dictionary:[:req[Avail-Dictionary]];'
                + ':status;Get-Dictionary:[:res[Get-Dictionary]];'
                + 'Content-type:[:res[content-type]];Content-Encoding:[:res[content-encoding]];'),
    { skip: function (req, res) { return res.getHeader('content-type').substring(0, 4) !== 'text' }, stream: sdchLog }
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
        if (url.parse(req.url).hostname == 'ru.wikipedia.org')
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
app.get('/*', function(req, res, next) { // get по любому url
    res.setHeader('content-type', 'text/html');
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
        }).end();
});

module.exports = app;

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
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

app.set('port', process.env.PORT || 3000);

var server = app.listen(app.get('port'), function() {
    debug('Express server listening on port ' + server.address().port);
});


