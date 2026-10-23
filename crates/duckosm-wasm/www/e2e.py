"""The page in headless Chromium (Playwright): build an area, run a query, show the roads map (a picture in
map.png), and download the Parquet files and load.sql. Prints the times of the page as JSON (docs/browser.md, steps B3 and B4).

    python crates/duckosm-wasm/www/e2e.py <file.osm.pbf> <out folder> [--boundary area.geojson] [--modes driving,walking,cycling] [--fixes file.yaml]
        [--no-features]

With --boundary, the PBF file is a region file and the page cuts it to the boundary; without, the file is
already cut. With --boundary and the PBF file "overpass", the data comes from the Overpass API. With --boundary
and the PBF file "relay", the page gets the smallest extract through the relay of serve.py (docs/relay.md) and
keeps it in the browser. With a region file, the page also makes the base-map layers (docs/features.md), unless
--no-features: the out folder gets their features_<table>.parquet files (tools/compare_features.py --page checks them).

Build the page first (docs/development.md, "WebAssembly"). The page loads duckdb-wasm from cdn.jsdelivr.net, so
the computer needs the network.
"""
import argparse
import base64
import json
import pathlib
import zipfile

from playwright.sync_api import sync_playwright

from serve import start

WWW = pathlib.Path(__file__).resolve().parent

a = argparse.ArgumentParser()
a.add_argument("pbf", help="a .osm.pbf file, or overpass (with --boundary)")
a.add_argument("--boundary")
a.add_argument("out")
a.add_argument("--modes", default="driving,walking,cycling")
a.add_argument("--fixes")
a.add_argument("--no-features", action="store_true", help="the box 'Base map layers' off")
a.add_argument("--levels", choices=["tags", "solve"], default="tags", help="the drawing order (docs/levels.md)")
a.add_argument("--one-thread", action="store_true", help="serve the page without the COOP and COEP headers")
a.add_argument("--threads", type=int, help="the size of the thread pool (default: the cores, at most 8)")
args = a.parse_args()
out = pathlib.Path(args.out)
out.mkdir(parents=True, exist_ok=True)

server = start(0, isolated=not args.one_thread, quiet=True)
params = [f"threads={args.threads}"] * bool(args.threads) + ["relay=relay"] * (args.pbf == "relay")
url = f"http://127.0.0.1:{server.server_address[1]}/index.html" + ("?" + "&".join(params) if params else "")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(accept_downloads=True)
    page.on("pageerror", lambda e: print("page error:", e))
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    if args.boundary:
        page.set_input_files("#file", args.boundary)   # the File tab of step 1
        page.wait_for_function("window.areas >= 1", timeout=60_000)
        print("area:", page.input_value("#name"), "|", " ".join(page.inner_text("#summary").split()))
    source = "cut" if not args.boundary else "overpass" if args.pbf == "overpass" else "region"
    page.click(f"#tab-{source}")
    if args.pbf == "relay":
        page.click("#extracts button[data-get]")      # the smallest extract that covers the area
        page.wait_for_selector("#extracts button:has-text('In use')", timeout=1_800_000)
        print("relay:", page.inner_text("#region-name"), "|", " ".join(page.inner_text("#kept").split()))
    elif source != "overpass":
        page.set_input_files("#pbf" if source == "cut" else "#region", args.pbf)
    if args.fixes:
        page.set_input_files("#fixes", args.fixes)
    for box in page.query_selector_all("input[name=mode]"):
        box.set_checked(box.get_attribute("value") in args.modes.split(","))
    page.set_checked("#features", not args.no_features)
    page.select_option("#levels", args.levels)
    page.click("#run")
    page.wait_for_function("!document.getElementById('step5-card').hidden || document.getElementById('buildstatus').textContent.startsWith('Error')",
                           timeout=1_800_000)
    status = page.inner_text("#buildstatus")
    if status.startswith("Error"):
        raise SystemExit(status)
    print(status)
    page.click("#query")
    page.wait_for_selector("#result table, #result .error", timeout=60_000)
    print("query:", page.inner_text("#result p"))
    with page.expect_download(timeout=60_000) as d:
        page.click("#duckdb")
    d.value.save_as(out / "load.sql")
    # the zip: a folder with the Parquet files, layers.json, load.sql, the boundary and a README
    with page.expect_download(timeout=120_000) as d:
        page.click("#zip")
    d.value.save_as(out / "all.zip")
    with zipfile.ZipFile(out / "all.zip") as z:
        names = z.namelist()
    parquet = [n for n in names if n.endswith(".parquet")]
    print(f"zip: {len(parquet)} Parquet files and", sorted(n.split("/", 1)[1] for n in names if not n.endswith(".parquet")))
    # the bytes of each file through its blob link (Chromium stops many downloads in a row)
    files = page.evaluate("""async () => Promise.all([...document.querySelectorAll('#files a[download]')].map(async (a) => {
        const b = new Blob([await (await fetch(a.href)).arrayBuffer()]);
        const url = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
        return [a.download, url.slice(url.indexOf(',') + 1)];
    }))""")
    for name, data in files:
        (out / name).write_bytes(base64.b64decode(data))
    # the roads map (map/): its note, and a picture of it
    page.wait_for_function("/layers:|failed/.test(document.getElementById('mapnote').textContent)", timeout=600_000)
    print("map:", page.inner_text("#mapnote"))
    page.wait_for_function("window.duckMap && window.duckMap.loaded()", timeout=600_000)   # the tiles are cut and drawn
    print("map view:", page.evaluate("(() => { const m = window.duckMap; return {center: m.getCenter(), zoom: m.getZoom()}; })()"))
    page.screenshot(path=str(out / "map.png"))
    print(json.dumps(page.evaluate("window.timings")))
    browser.close()
server.shutdown()
