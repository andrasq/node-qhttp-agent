/**
 * Copyright (C) 2015 Andras Radics
 * Licensed under the Apache License, Version 2.0
 */

'use strict';

var http = require('http');
var HttpAgent = require('./http-agent');
var HttpClient = require('qhttp/http-client');
var aflow = require('aflow');

module.exports = {
    setUp: function(done) {
        this.agent = new HttpAgent({keepAlive: true});
        done();
    },

    'package.json should be valid': function(t) {
        var json = require('./package.json');
        t.done();
    },

    'should be available through index.js': function(t) {
        var index = require('./index');
        t.equal(index.HttpAgent, HttpAgent);
        t.done();
    },

    'should work in HttpClient': function(t) {
        var http = new HttpClient({agent: new HttpAgent(), keepAlive: true});
        var nloops = 10;
        var ncalls = 0;
        t.expect(nloops * 2);
        aflow.repeatWhile(
            function() {
                return ncalls++ < nloops;
            },
            function(cb) {
                http.call('GET', "http://localhost:80", function(err, res) {
                    t.ifError(err);
                    t.ok(res.body);
                    cb();
                });
            },
            function(err) {
                t.done();
            }
        );
    },
};
