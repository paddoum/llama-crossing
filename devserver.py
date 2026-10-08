#!/usr/bin/env python3
"""Static dev server that forbids caching.

ES modules are cached per URL, so with an ordinary static server an edit to one
module can leave the page running a mix of old and new files -- which looks
exactly like a bug. Production (GitHub Pages) still sets max-age=600; the
version label in the bottom-left corner is how you spot a stale build there.

    python3 devserver.py [port]
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    http.server.test(HandlerClass=NoCacheHandler, port=port, bind='0.0.0.0')
