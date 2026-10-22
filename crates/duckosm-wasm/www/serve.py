"""Serve the page on http://localhost:<port> with the COOP and COEP headers, so the page is cross-origin isolated
and uses the WebAssembly module with threads (pkg-threads). `python3 -m http.server` does not send them: the page
then uses the module with one thread.

    python3 crates/duckosm-wasm/www/serve.py [port]
"""
import functools
import http.server
import pathlib
import sys
import threading

WWW = pathlib.Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    isolated = True
    quiet = False

    def end_headers(self):
        if self.isolated:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

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
