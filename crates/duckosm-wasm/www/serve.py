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
GEOFABRIK = re.compile(r"^https://download\.geofabrik\.de/[a-z0-9/_-]+-(latest|\d{6})\.osm\.pbf$")


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

    def do_HEAD(self):
        if self.path.startswith("/relay?"):
            return self.relay(head=True)
        super().do_HEAD()

    def relay(self, head=False):
        """relay/worker.js on this computer: a Geofabrik .osm.pbf file, streamed (the page is on the same site, so no CORS)."""
        url = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("url", [""])[0]
        if not GEOFABRIK.match(url):
            return self.send_error(400, "Only the .osm.pbf files of download.geofabrik.de")
        headers = {"User-Agent": "duckosm-relay (+https://github.com/Khoshkhah/duckOSM)"}
        rng = self.headers.get("Range", "")
        if rng and not re.match(r"^bytes=\d+-\d*$", rng):
            return self.send_error(416, "Only one range, bytes=<from>-<to>")
        if rng:
            headers["Range"] = rng
        req = urllib.request.Request(url, headers=headers, method="HEAD" if head else "GET")
        with urllib.request.urlopen(req) as r:
            self.send_response(r.status)
            for k in ("Content-Type", "Content-Length", "Last-Modified", "ETag", "Content-Range", "Accept-Ranges"):
                if r.headers.get(k):
                    self.send_header(k, r.headers[k])
            self.send_header("Content-Location", r.geturl())
            self.end_headers()
            if head:
                return
            try:
                shutil.copyfileobj(r, self.wfile, 1 << 20)
            except (BrokenPipeError, ConnectionResetError):
                pass  # the page stopped the download (Cancel)

    def log_message(self, *a):
        if not self.quiet:
            super().log_message(*a)


def start(port, isolated=True, quiet=False, directory=WWW):
    """Start the server in a thread; port 0 takes a free port (server.server_address[1]). directory: the page's folder (a
    copy with versions, version_refs.py, for a test of the deployed page)."""
    h = type("H", (Handler,), {"isolated": isolated, "quiet": quiet})
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(h, directory=str(directory)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def unversioned_requests(page, directory):
    """For the headless tests: a list that gets each request of the page (and its workers) for a .js, .wasm, .json or .css
    file of the site with no ?v=, when `directory` has versions (version_refs.py). Without versions it stays empty."""
    left = []
    if "?v=" in (pathlib.Path(directory) / "index.html").read_text():
        site = re.compile(r"^http://127\.0\.0\.1:\d+/[^?]*\.(js|wasm|json|css)(\?|$)")
        page.on("request", lambda r: site.match(r.url) and "v=" not in urllib.parse.urlsplit(r.url).query and left.append(r.url))
    return left


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"http://localhost:{port}")
    start(port).serve_forever()
