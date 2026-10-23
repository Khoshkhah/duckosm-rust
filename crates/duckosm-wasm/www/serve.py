"""Serve the page on http://localhost:<port> with the COOP and COEP headers, so the page is cross-origin isolated
and uses the WebAssembly module with threads (pkg-threads). `python3 -m http.server` does not send them: the page
then uses the module with one thread.

    python3 crates/duckosm-wasm/www/serve.py [port]

It also has the relay of the page at /relay?url=... (the same rules as relay/worker.js, docs/relay.md), so the page
can get a Geofabrik extract on this computer: open http://localhost:<port>/?relay=relay
"""
import functools
import http.server
import pathlib
import re
import shutil
import sys
import threading
import urllib.parse
import urllib.request

WWW = pathlib.Path(__file__).resolve().parent
GEOFABRIK = re.compile(r"^https://download\.geofabrik\.de/[a-z0-9/_-]+-latest\.osm\.pbf$")


class Handler(http.server.SimpleHTTPRequestHandler):
    isolated = True
    quiet = False

    def end_headers(self):
        if self.isolated:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/relay?"):
            return self.relay()
        super().do_GET()

    def relay(self):
        """relay/worker.js on this computer: a Geofabrik .osm.pbf file, streamed (the page is on the same site, so no CORS)."""
        url = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("url", [""])[0]
        if not GEOFABRIK.match(url):
            return self.send_error(400, "Only the .osm.pbf files of download.geofabrik.de")
        req = urllib.request.Request(url, headers={"User-Agent": "duckosm-relay (+https://github.com/Khoshkhah/duckOSM)"})
        with urllib.request.urlopen(req) as r:
            self.send_response(200)
            for k in ("Content-Type", "Content-Length", "Last-Modified", "ETag"):
                if r.headers.get(k):
                    self.send_header(k, r.headers[k])
            self.end_headers()
            try:
                shutil.copyfileobj(r, self.wfile, 1 << 20)
            except (BrokenPipeError, ConnectionResetError):
                pass  # the page stopped the download (Cancel)

    def log_message(self, *a):
        if not self.quiet:
            super().log_message(*a)


def start(port, isolated=True, quiet=False):
    """Start the server in a thread; port 0 takes a free port (server.server_address[1])."""
    h = type("H", (Handler,), {"isolated": isolated, "quiet": quiet})
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(h, directory=str(WWW)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"http://localhost:{port}")
    start(port).serve_forever()
