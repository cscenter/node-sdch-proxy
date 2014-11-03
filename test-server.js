var express = require('express');
var config = require('config-node')();

var app = express()

app.get('/test1', function(req, res) {
    res.setHeader('content-type', 'text/plain');
    res.setHeader('content-length', 6);
    res.end("Hello!");
})

app.get('/test2', function(req, res) {
    res.setHeader('content-type', 'text/plain');
    res.setHeader('Cache-Control', 'private');
    res.setHeader('content-length', 6);
    res.end("Hello!");
})

app.get('/search&q=brussel', function(req, res) {
    res.setHeader('content-type', 'text/plain');
    res.setHeader('Cache-Control', 'private');
    res.setHeader('content-length', 36);
    res.end("Hello!Hello!Hello!Hello!Hello!Hello!");
})

function run() {
    var server = app.listen(config.testServerPort, function () {
        console.log("test-server listening on port " + server.address().port);
    });
}

if (module.parent) {
    exports.run = run
} else {
    run()
}
