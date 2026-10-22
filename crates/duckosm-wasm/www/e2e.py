"""The page in headless Chromium (Playwright): build a PBF file, run a query, and download
the Parquet files and load.sql. Prints the times of the page as JSON (docs/browser.md, step B3).

    python crates/duckosm-wasm/www/e2e.py <file.osm.pbf> <out folder> [--modes driving,walking,cycling] [--fixes file.yaml]

Build the page first (docs/development.md, "WebAssembly"). The page loads duckdb-wasm from cdn.jsdelivr.net, so
the computer needs the network.
"""
import argparse
import base64
import functools
import http.server
import json
import pathlib
import threading

from playwright.sync_api import sync_playwright

WWW = pathlib.Path(__file__).resolve().parent

a = argparse.ArgumentParser()
a.add_argument("pbf")
a.add_argument("out")
a.add_argument("--modes", default="driving,walking,cycling")
a.add_argument("--fixes")
args = a.parse_args()
out = pathlib.Path(args.out)
out.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(WWW)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(accept_downloads=True)
    page.on("pageerror", lambda e: print("page error:", e))
    page.goto(url)
    page.wait_for_function("document.getElementById('status').textContent.startsWith('DuckDB is ready')", timeout=120_000)
    page.set_input_files("#pbf", args.pbf)
    if args.fixes:
        page.set_input_files("#fixes", args.fixes)
    for box in page.query_selector_all("input[name=mode]"):
        box.set_checked(box.get_attribute("value") in args.modes.split(","))
    page.click("#run")
    page.wait_for_function("!document.getElementById('query').disabled || document.getElementById('status').textContent.startsWith('Error')",
                           timeout=1_800_000)
    status = page.inner_text("#status")
    if status.startswith("Error"):
        raise SystemExit(status)
    print(status)
    page.click("#query")
    page.wait_for_selector("#result table, #result:has-text('Error')", timeout=60_000)
    print("query:", page.inner_text("#result p"))
    with page.expect_download(timeout=60_000) as d:
        page.click("#duckdb")
    d.value.save_as(out / "load.sql")
    # the bytes of each file through its blob link (Chromium stops many downloads in a row)
    files = page.evaluate("""async () => Promise.all([...document.querySelectorAll('#files a')].map(async (a) => {
        const b = new Blob([await (await fetch(a.href)).arrayBuffer()]);
        const url = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
        return [a.download, url.slice(url.indexOf(',') + 1)];
    }))""")
    for name, data in files:
        (out / name).write_bytes(base64.b64decode(data))
    print(json.dumps(page.evaluate("window.timings")))
    browser.close()
server.shutdown()
