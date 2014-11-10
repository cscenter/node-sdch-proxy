#!/usr/bin/env node
var exec = require('child_process').exec;
var config = require('config-node')();

var child = exec('rm ' + config.dictionaryRootdir + '/' + process.argv[2] + '/*',
    function (error, stdout, stderr) {
        console.log('model.fzm');
        if (error !== null) {
            console.log('update-dict error: ' + error);
        }
    });