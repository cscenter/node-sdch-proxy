var http = require('http');
var url = require('url');
var config = require('config-node')();

var server = http.createServer(function(req,resp){
    //что за запрос вообще к нам пришел?
    //console.log(req.method, req.url);

    var parsed_url = url.parse(req.url, true);
    //console.log(req.headers)
    if (parsed_url.pathname == '/test1')
    {
        resp.setHeader('content-type', 'text/plain');
        resp.setHeader('content-length', 6);
        resp.end("Hello!");
    }
    else if (parsed_url.pathname == '/test2')
    {
        resp.setHeader('content-type', 'text/plain');
        resp.setHeader('Cache-Control', 'private');
        resp.setHeader('content-length', 6);
        resp.end("Hello!");
    }
    else if (parsed_url.pathname == '/search&q=brussel')
    {
        resp.setHeader('content-type', 'text/plain');
        resp.setHeader('Cache-Control', 'private');
        resp.setHeader('content-length', 36);
        resp.end("Hello!Hello!Hello!Hello!Hello!Hello!");
    }
    else
    {
        resp.statusCode = 404;
        resp.end("Sorry, Page Not found!");
    }

})

function run() {
    server.listen(config.testServerPort, config.testServerHost);
    console.log("test-server listening on port " + config.testServerPort);
}

if (module.parent) {
    exports.run = run
} else {
    run()
}
