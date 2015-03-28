qhttp-agent
===========

Edited version of http.globalAgent from node-v0.10.29

This is a drop-in replacement for http.Agent that fixes connection reuse and speeds up requests by 20%.
Currently all connections are opened with `keepAlive: true`.

Fixes the socket TIME_WAIT leak, fixes connection reuse, and is overall much
faster than the one in in node-v0.10.  Uses a timeout thread to harvest idle
sockets if socket.unref is not available, so might work with node-v0.8 too.

        npm install qhttp-agent
        npm test qhtt-pagent


## Usage

`HttpAgent` is passed in as an option to `http.request` to be used in place of
`http.globalAgent`.

Example

        var http = require('http');
        var HttpAgent = require('./http-agent');
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


## Related Work

[agentkeepalive](https://npmjs.org/package/agentkeepalive) - another keepAlive agent, a little slower
