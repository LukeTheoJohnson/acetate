#!/usr/bin/env python3
"""Dev static server for Strudel Auto-DJ with caching disabled.

Plain `python -m http.server` sends no Cache-Control header, so browsers apply
heuristic caching to src/*.js and keep serving *stale* code between edits — you
refresh and hear the old build. This server sends `Cache-Control: no-store` on
every response, so a normal refresh always loads the latest files.

    python serve.py            # port 8123
    python serve.py 8124       # custom port
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    print('Serving Strudel Auto-DJ with caching disabled on '
          'http://localhost:%d  (Ctrl+C to stop)' % port)
    try:
        HTTPServer(('', port), NoCacheHandler).serve_forever()
    except KeyboardInterrupt:
        print('\nstopped')
