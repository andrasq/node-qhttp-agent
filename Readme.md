qhttp-agent
===========

Edited version of http.Agent from node-v0.10.29

This is a drop-in replacement for http.Agent that fixes connection reuse and
speeds up requests by up to 50%.  All connections are opened with `keepAlive:
true`.  This version is not an event emitter, and does not emit Agent events.

Fixes the socket TIME_WAIT leak, fixes connection reuse, and is overall much
faster than the one in in node-v0.10.  Uses a timeout thread to harvest idle
sockets if socket.unref is not available, so might work with node-v0.8 too.

        npm install qhttp-agent
        npm test qhtt-pagent


## Usage

### new HttpAgent( [options] )

`HttpAgent` is passed in as an option to `http.request` to be used in place of
`http.globalAgent`.

        HttpAgent = require('qhttp-agent');
        var agent = new HttpAgent(options);

Options

- `maxSockets` - limit connections to each destination (default 5)
- `socketIdleTimeout` - how long to hold on to an open socket before releasing it (default 2000 ms)
- `allowHalfOpen` - allow sockets to be closed for writes but still be read (default false)

http.Agent and passes all options to `net.createConnection`.  This seems odd,
but HttpAgent emulates this behavior, so socket options can be included as
well (eg allowHalfOpen).

Example

        var http = require('http');
        var HttpAgent = require('qhttp-agent');
        var requestOptions = {
            method: "GET",
            host: "google.com",
            path: "/",
            agent: new HttpAgent(),
        };
        var req = http.request(requestOptions, function(res) {
            var body = "";
            res.on('data', function(chunk) {
                body += chunk;
            });
            res.on('end', function() {
                console.log(res.headers);
                console.log(body);
                res.socket.end();
            });
        });
        req.write("");
        req.end();


## Analysis

The node-v0.10.29 http.Agent only reuses a keepAlive connection if a second
request arrives before the first finishes.  Then the second request will be
sent on the same connection as the first, otherwise the connection is closed.
It would be better to keep around the open socket and reuse it.

Also, the http.Agent `maxSockets` option limits the number of connection per
host:port destination, not the overall number of sockets allowed.  The default
of 5 still allows an unlimited number of concurrent connections.  This is
counter-intuitive.

As a consequence of the above, allowing more sockets makes it less likely that
any socket will be reused.  Even the default 5 is too many in some cases.  All
the closed sockets enter a TIME_WAIT state and become unusable for 60 seconds,
making a scarce resource even scarcer.


## Related Work

[agentkeepalive](https://npmjs.org/package/agentkeepalive) - another keepAlive agent, a little slower
