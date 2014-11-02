var assert = require('chai').assert;
var http = require('http');
var sdch = require('sdch');
var config = require('config-node')();
var proxy = require('../app');
var test_server = require('../test-server');

var resp;

describe('Node-sdch-proxy tests:', function() {

    before(function() {
        assert.doesNotThrow(function () {
            proxy.run()
            test_server.run()
        })
    })

    describe('Without Accept-Encoding: sdch', function () {

        before(function (done) {
            http.get({
                host: config.proxy_host,
                port: config.proxyPort,
                path: "http://" + config.testServerHost + ":" + config.testServerPort + "/test1",
                headers: {
                    Host: config.testServerHost
                }
            }, function (res) {
                resp = res;
                done()
            })
        });

        describe('proxy response:', function () {
            it('have statusCode == 200 OK', function () {
                assert.equal(200, resp.statusCode);
            })

            it("have via == 'My-precious-proxy'", function () {
                assert.equal('My-precious-proxy', resp.headers['via'])
            })

            it("have content-type == 'text/plain'", function () {
                assert.equal('text/plain', resp.headers['content-type']);
            })

            it("have content-length value", function () {
                assert.isDefined(resp.headers['content-length']);
            })

            it("Get-Dictionary: Empty", function () {
                assert.isUndefined(resp.headers['Get-Dictionary'])
            })

            it("Content-Encoding: Not contain sdch", function () {
                assert.notInclude(resp.headers['Content-Encoding'], 'sdch')
            })
        })
    })
    describe('Initial Interaction, User Agent has No Dictionaries', function () {
        before(function (done) {
            http.get({
                host: config.proxyHost,
                port: config.proxyPort,
                path: "http://" + config.testServerHost + ":" + config.testServerPort + "/test2",
                headers: {
                    Host: config.testServerHost,
                    'Accept-Encoding': 'sdch, gzip'
                }
            }, function (res) {
                resp = res;
                done()
            })
        });

        describe('proxy response:', function () {
            it('have statusCode == 200 OK', function () {
                assert.equal(200, resp.statusCode);
            })

            it("have via == 'My-precious-proxy'", function () {
                assert.equal('My-precious-proxy', resp.headers['via'])
            })

            it("have content-type == 'text/plain'", function () {
                assert.equal('text/plain', resp.headers['content-type']);
            })

            it("have content-length value", function () {
                assert.isDefined(resp.headers['content-length']);
            })

            it('Get-Dictionary: Not Empty', function () {
                assert.isNotNull(resp.headers['Get-Dictionary'])
            })

            it("Content-Encoding: Not contain 'sdch'", function () {
                assert.notInclude(resp.headers['Content-Encoding'], 'sdch')
            })
        })
    })

    var dict = '/dictionaries/search_dict'

    describe('User Agent Requests the Dictionary', function () {
        before(function (done) {
            http.get({
                host: config.proxyHost,
                port: config.proxyPort,
                path: "http://" + config.testServerHost + ":" + config.testServerPort + dict,
                headers: {
                    Host: config.testServerHost,
                    'Accept-Encoding': 'sdch, gzip'
                }
            }, function (res) {
                resp = res;
                resp.body = ''
                res.on('data', function (d) {
                    resp.body += d;
                });
                res.on('end', function () {
                    done()
                })
            })
        });

        describe('proxy response:', function () {
            it('have statusCode == 200 OK', function () {
                assert.equal(200, resp.statusCode);
            })

            it("have Content-type == 'application/x-sdch-dictionary'", function () {
                assert.equal('application/x-sdch-dictionary', resp.headers['content-type']);
            })

            it("Content-Encoding: Not contain 'sdch'", function () {
                assert.notInclude(resp.headers['Content-Encoding'], 'sdch')
            })

            it('valid dictionary headers', function () {
                var url = "http://" + config.testServerHost + ":" + config.testServerPort + dict
                assert.doesNotThrow(function () {
                    var opts = sdch.createDictionaryOptions(url, resp.body)
                    var dict = sdch.clientUtils.createDictionaryFromOptions(opts)
                })

            })
        })
    })

    describe('User Requests Page AND User Agent Has Already Downloaded the Dictionary', function () {
        before(function (done) {
            http.get({
                host: config.proxyHost,
                port: config.proxyPort,
                path: "http://" + config.testServerHost + ":" + config.testServerPort + '/search&q=brussel',
                headers: {
                    Host: config.testServerHost,
                    'Accept-Encoding': 'sdch',
                    'Avail-Dictionary': 'TWFuIGlz'
                }
            }, function (res) {
                resp = res;
                done()
            })
        });

        describe('proxy response:', function () {
            it('have statusCode == 200 OK', function () {
                assert.equal(200, resp.statusCode);
            })

            it("have via == 'My-precious-proxy'", function () {
                assert.equal('My-precious-proxy', resp.headers['via'])
            })

            it("have content-type == 'text/plain'", function () {
                assert.equal('text/plain', resp.headers['content-type']);
            })

            it("Content-Encoding: contain 'sdch'", function () {
                //console.log(resp)
                assert.include(resp.headers['content-encoding'], 'sdch')
            })

            it("Get-Dictionary: Not contain already downloaded dictionary", function () {
                assert.notInclude(resp.headers['Get-Dictionary'], dict)
            });
        })
    })
})

