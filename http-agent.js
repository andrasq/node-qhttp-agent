/**
 * nodejs Agent
 * Copyright Joyent, Inc. and other Node contributors.
 *
 * socket TIME_WAIT leak fix, multi-value store, connnection reuse fix
 * Copyright (C) 2015 Andras Radics
 *
 * This file is an edited version of the one from node-v0.10.29
 */

// New Agent code.

// The largest departure from the previous implementation is that
// an Agent instance holds connections for a variable number of host:ports.
// Surprisingly, this is still API compatible as far as third parties are
// concerned. The only code that really notices the difference is the
// request object.

// Another departure is that all code related to HTTP parsing is in
// ClientRequest.onSocket(). The Agent is now *strictly*
// concerned with managing a connection pool.


// AR:
module.exports = Agent;
var net = require('net');
var http = require('http');
var Url = require('url');
//var util = require('util');
//var EventEmitter = require('events').EventEmitter;
var MultiValueCache = require('qcache/mvcache');

function Agent( options ) {
    //EventEmitter.call(this);
    options = options || {}

    var self = this;
    self.options = {
        //keepAlive: true,
        maxSockets: Agent.defaultMaxSockets,
        socketIdleTimeout: Agent.defaultSocketIdleTimeout,
    };
    //self.requests = new MultiValueStore();
    self.requests = new MultiValueCache();
    self.socketCounts = {};
    //self.idleSockets = new MultiValueStore();
    self.idleSockets = new MultiValueCache();

    for (var i in self.options) {
        if (options[i] !== undefined) self.options[i] = options[i];
    }

    // clear out any per-connection options
    delete self.options.port;
    delete self.options.host;
    delete self.options.localAddress;
    delete self.options.servername;

    self.createConnection = net.createConnection;
    self.now = Date.now;
}
//util.inherits(Agent, EventEmitter);
exports.Agent = Agent;

Agent.defaultMaxSockets = 5;                    // max connections to any single url
Agent.defaultSocketIdleTimeout = 2000;          // close socket after ~ seconds inactivity

// AR:
var _originalGlobalAgent = http.globalAgent;
Agent.install = function( ) {
    // FIXME: cannot install/uninstall, v0.10 http uses an internal handle
    if (!_originalGlobalAgent) _originalGlobalAgent = http.globalAgent;
    http.globalAgent = new Agent();
};
Agent.uninstall = function( ) {
    http.globalAgent = _originalGlobalAgent;
};

Agent.prototype = {
    addRequest:
        function addRequest( req, host, port, localAddress ) {
            // convert v0.11-style calls into v0.10-format so we can process them
            if (host.host !== undefined) {
                port = host.port;
                localAddress = host.localAddress;
                host = host.host;
            }
            var name = localAddress ? (host + ':' + port + ':' + localAddress) : (host + ':' + port);

            // try to reuse an available still-connected socket, else try
            // to create a new socket.  create will fail if we reached maxSockets
            var socket = !this.idleSockets.isEmpty(name) && this.getRecycledSocket(name) || this.createSocket(name, host, port, localAddress, req);
            if (socket) {
                req.onSocket(socket);
            }
            else {
                // if no socket available, queue the request for later
                this.requests.push(name, req);
            }
        },

    createSocket:
        function createSocket( name, host, port, localAddress, req ) {
          if (this.socketCounts[name] >= this.maxSocketCount) return null;

          // AR: make options a struct for fast access, so
          // pre-declare all common option fields
          var self = this;
          var i, options = {
            port: port, host: host, localAddress: localAddress, servername: '',
            allowHalfOpen: false,
            // tbd: more fields?
            maxSockets: 0, socketIdleTimeout: 0,
          };
          // AR: why pass all the Agent options to the connection ??
          for (i in self.options) options[i] = self.options[i];

          options.port = port;
          options.host = host;
          options.localAddress = localAddress;

          options.servername = host;
          if (req) {
            var hostHeader = req.getHeader('host');
            if (hostHeader) {
              var nameEnd = hostHeader.indexOf(':');
              options.servername = nameEnd < 0 ? hostHeader : hostHeader.slice(0, nameEnd);
            }
          }

          var s = self.createConnection(options);
          if (this.socketCounts[name]) this.socketCounts[name] += 1; else this.socketCounts[name] = 1;

          var onFree;
          s.on('free', onFree = function() {
            self.recycleSocket(name, s);
          });

          var onClose;
          s.on('close', onClose = function(err) {
            // This is the only place where sockets get removed from the Agent.
            // If you want to remove a socket from the pool, just close it.
            // All socket errors end in a close event anyway.
            self.socketCounts[name] -= 1;
            if (!self.socketCounts[name]) delete self.socketCounts[name];
            self.removeSocket(s, name, host, port, localAddress);
            //removeSocket(s);
          });

          var onRemove;
          s.on('agentRemove', onRemove = function() {
            // We need this function for cases like HTTP 'upgrade'
            // (defined by WebSockets) where we need to remove a socket from the pool
            //  because it`ll be locked up indefinitely
            self.socketCounts[name] -= 1;
            if (!self.socketCounts[name]) delete self.socketCounts[name];
            s.removeListener('close', onClose);
            s.removeListener('free', onFree);
            s.removeListener('agentRemove', onRemove);
            self.removeSocket(s, name, host, port, localAddress);
            //removeSocket(s);
          });

/**
          // closure is no faster than passing all the params...
          function removeSocket( s ) {
              // if more work for the removed socket, create and start its replacement
              var req = self.requests.shift(name);
              if (req) this.createSocket(name, host, port, localAddress, req).emit('free');
          }
**/

          return s;
        },

    removeSocket:
        function removeSocket( s, name, host, port, localAddress ) {
            var req = this.requests.shift(name);
            if (req) {
                // if more work for the removed socket, create and start its replacement
                this.createSocket(name, host, port, localAddress, req).emit('free');
            }
        },

    recycleSocket:
        function( name, socket ) {
            var req;
            if (socket.destroyed) return;
            if ((req = this.requests.shift(name))) {
                // if more work for this socket, make the next request
                req.onSocket(socket);
            }
            else {
                if (socket.setKeepAlive && socket.unref) {
                    socket.setKeepAlive(this.socketIdleTimeout);
                    socket.unref();
                }
                else {
                    socket._reaper = setTimeout(function(){ socket.destroy(); socket.destroyed = true; }, this.socketIdleTimeout);
                    if (socket._reaper.unref) socket._reaper.unref();
                }
                this.idleSockets.push(name, socket);
            }
        },

    getRecycledSocket:
        function( name ) {
            var socket;
            while ((socket = this.idleSockets.shift(name))) {
                if (socket.destroyed) continue;
                if (socket.ref) {
                    socket.ref();
                }
                else {
                    clearTimeout(socket._reaper);
                    socket._reaper = null;
                }
                return socket;
            }
            return null;
        },
}
