"""The page in headless Chromium (Playwright): build an area, run a query, show the roads map (a picture in
map.png; a large area waits for "Show on map", which the test clicks), and download the zip and the Parquet files. The
out folder gets make_duckdb.sql from the zip, and page.duckdb (the button "Download .duckdb"). Prints the times of
the page as JSON (docs/browser.md, steps B3 and B4).

    python crates/duckosm-wasm/www/e2e.py <file.osm.pbf> <out folder> [--boundary area.geojson] [--modes driving,walking,cycling] [--fixes file.yaml]
        [--no-features] [--www folder]

With --boundary, the PBF file is a region file and the page cuts it to the boundary; without, the file is
already cut. With --boundary and the PBF file "overpass", the data comes from the Overpass API. With --boundary
and the PBF file "relay", the page gets the smallest extract through the relay of serve.py (docs/relay.md) and
keeps it in the browser. With a region file, the page also makes the base-map layers (docs/features.md), unless
--no-features: the out folder gets their features_<table>.parquet files (tools/compare_features.py --page checks them).

--www serves another folder: a copy with versions (version_refs.py, as the deploy makes it); then each request of the
page for a file of the site must have the version. Build the page first (docs/development.md, "WebAssembly"). The page loads duckdb-wasm from cdn.jsdelivr.net, so
the computer needs the network.
"""
import argparse
import base64
import json
import pathlib
import re
import subprocess
import time
import zipfile

from playwright.sync_api import sync_playwright

from serve import start, unversioned_requests

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
a.add_argument("--view", help="lng,lat,zoom: move the map there before the picture (map.png)")
a.add_argument("--boundary-shots", action="store_true", help="pictures at a point of the boundary (z12, z16; flat and pitch 60), OpenFreeMap base")
a.add_argument("--www", default=str(WWW), help="the page's folder (default: this one)")
args = a.parse_args()
out = pathlib.Path(args.out)
out.mkdir(parents=True, exist_ok=True)

server = start(0, isolated=not args.one_thread, quiet=True, directory=args.www)
params = [f"threads={args.threads}"] * bool(args.threads) + ["relay=relay"] * (args.pbf == "relay")
url = f"http://127.0.0.1:{server.server_address[1]}/index.html" + ("?" + "&".join(params) if params else "")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(accept_downloads=True)
    page.on("pageerror", lambda e: print("page error:", e))
    unversioned = unversioned_requests(page, args.www)
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    # the files that build.sh takes from roadstyle are roadstyle's own at ROADSTYLE_COMMIT (no copy that can drift)
    pin = re.search(r"^ROADSTYLE_COMMIT=(\w+)", (WWW.parent / "build.sh").read_text(), re.M).group(1)
    clone = WWW.parents[2] / "target" / f"roadstyle-{pin}"
    dashboard = subprocess.run(["git", "-C", str(clone), "ls-tree", "-r", "--name-only", pin, "rust/roadstyle-assets/files/static/dashboard/"],
                               capture_output=True, text=True, check=True).stdout.split()
    for served, source in [("popup.css", "rust/roadstyle-assets/files/static/popup.css"), ("popup.js", "rust/roadstyle-assets/files/static/popup.js"),
                           ("roads_sql.js", "rust/roadstyle-wasm/js/roads_sql.js"), ("features_sql.js", "rust/roadstyle-wasm/js/features_sql.js"),
                           ("level_editor.html", "rust/roadstyle-assets/files/static/level_editor.html"),
                           *[(f.removeprefix("rust/roadstyle-assets/files/static/"), f) for f in dashboard]]:
        want = subprocess.run(["git", "-C", str(clone), "show", f"{pin}:{source}"], capture_output=True, check=True).stdout
        got = page.request.get(url.split("index.html")[0] + "map/roadstyle/" + served).body()
        got = re.sub(rb"\?v=[\w.-]+", b"", got)      # a copy with versions (--www): the file without them
        assert got == want, f"map/roadstyle/{served} is not roadstyle's {source} at {pin}: run build.sh"
    print(f"roadstyle's files: the same as roadstyle {pin}")
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
    assert page.input_value("#levels") == "solve", "the drawing order of a new page is Optimized (Kaveh, 2026-10-24)"
    # the list is roadstyle's (selectbox.js: a button and a list in place of the select)
    page.locator(".rs-sel:has(#levels) .rs-sel-btn").click()
    page.locator(".rs-sel-opt", has_text={"tags": "From the tags", "solve": "Optimized"}[args.levels]).first.click()
    assert page.input_value("#levels") == args.levels
    page.click("#run")
    page.wait_for_function("!document.getElementById('step5-card').hidden || document.getElementById('buildstatus').textContent.startsWith('Error')",
                           timeout=1_800_000)
    status = page.inner_text("#buildstatus")
    if status.startswith("Error"):
        raise SystemExit(status)
    print(status)
    # the build details of card 4 (folded): one table row each
    print("build details:", " | ".join(page.eval_on_selector_all("#builddetails tr", "rs => rs.map((r) => [...r.cells].map((c) => c.textContent).join(' ').trim())")))
    page.evaluate("document.getElementById('sql-box').open = true")   # the SQL box of card 5 is folded
    page.click("#query")
    page.wait_for_selector("#result table, #result .error", timeout=60_000)
    print("query:", page.inner_text("#result p"))
    # the zip: a folder with the Parquet files, layers.json, make_duckdb.sql, the boundary and a README
    with page.expect_download(timeout=120_000) as d:
        page.click("#zip")
    d.value.save_as(out / "all.zip")
    with zipfile.ZipFile(out / "all.zip") as z:
        names = z.namelist()
        (out / "make_duckdb.sql").write_bytes(next(z.read(n) for n in names if n.endswith("/make_duckdb.sql")))
    parquet = [n for n in names if n.endswith(".parquet")]
    print(f"zip: {len(parquet)} Parquet files and", sorted(n.split("/", 1)[1] for n in names if not n.endswith(".parquet")))
    # the .duckdb file: tools/compare_duckdb.py compares it with the file that make_duckdb.sql makes
    t = time.time()
    with page.expect_download(timeout=120_000) as d:
        page.click("#duckdb")
    seconds = time.time() - t
    d.value.save_as(out / "page.duckdb")
    print(f"duckdb: {d.value.suggested_filename}, {(out / 'page.duckdb').stat().st_size} bytes, {seconds:.2f} s")
    # the bytes of each file through its blob link (Chromium stops many downloads in a row)
    files = page.evaluate("""async () => Promise.all([...document.querySelectorAll('#files a[download]')].map(async (a) => {
        const b = new Blob([await (await fetch(a.href)).arrayBuffer()]);
        const url = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
        return [a.download, url.slice(url.indexOf(',') + 1)];
    }))""")
    for name, data in files:
        (out / name).write_bytes(base64.b64decode(data))
    # the roads map (map/, card 6): its note, and a picture of it
    page.wait_for_function("/drawn|failed|Show on map/.test(document.getElementById('mapnote').textContent)", timeout=600_000)
    if "Show on map" in page.inner_text("#mapnote"):
        page.click("#show")
        page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent)", timeout=600_000)
    print("map:", page.inner_text("#mapnote"))
    # the draw after a build or "Show on map" with no base map chosen in this page: the blank base map (Kaveh, 2026-10-26: it did not change)
    assert page.evaluate("document.querySelector('input[name=rs-bm]:checked')?.value") == "blank", "the first draw sets the blank base map"
    page.wait_for_function("window.duckMap && window.duckMap.loaded()", timeout=600_000)   # the tiles are cut and drawn
    # roadstyle's standard tools read each roads style that comes after the start (rs.setStyle): "Colour by and legend" is on, and the Layers box has a
    # row for each layer of the area (the duckOSM layers) and the 3D row. A row that is turned off hides its layers, and the next draw keeps it off.
    assert not page.evaluate("rs.tools.list().find((t) => t.id === 'legend').disabled"), "Colour by and legend is on after the roads are drawn"
    rows = page.evaluate("[...document.querySelectorAll('.ov-ctrl label')].map((l) => l.textContent.trim())")
    print("layers box:", rows)
    assert "buildings" in rows and rows[rows.index("buildings") + 1] == "Buildings 3D", rows   # the 3D row is under the buildings row
    first = rows[0]
    ov = lambda: page.evaluate("duckMap.getStyle().layers.filter((l) => /^rs-ov\\d/.test(l.id) && l.type !== 'fill-extrusion').map((l) => l.layout?.visibility ?? 'visible')")  # noqa: E731
    assert "visible" in ov(), "the area's layers show"
    page.evaluate("(l) => rs.setOverlay(l, false)", first)
    assert not page.evaluate("document.querySelector('.ov-ctrl input').checked")
    page.evaluate("document.getElementById('show').click()")        # a new draw: the switch that is off stays off
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    assert not page.evaluate("document.querySelector('.ov-ctrl input').checked"), "the switch stays off after a draw"
    page.evaluate("(l) => rs.setOverlay(l, true)", first)
    page.wait_for_function("window.duckMap.loaded()", timeout=600_000)
    # the colours of the roads are the look's (Colour by: Road class): the legend box has its rows
    page.evaluate("rs.tools.open('legend')")
    assert page.is_visible("#rs-color-box"), "the colour box opens"
    page.evaluate("rs.tools.close('legend')")
    # a base map chosen before: "Show on map" (a fresh map) sets the blank one again (Kaveh, 2026-10-26)
    page.click("#rs-toolbar .bm-ctrl .bm-icon"); page.click("input[name=rs-bm][value='ofm_liberty']"); page.wait_for_timeout(500)
    assert page.evaluate("document.querySelector('input[name=rs-bm]:checked')?.value") == "ofm_liberty", "OpenFreeMap chosen"
    page.evaluate("document.getElementById('show').click()")
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    page.wait_for_function("window.duckMap.loaded()", timeout=600_000)
    assert page.evaluate("document.querySelector('input[name=rs-bm]:checked')?.value") == "blank", "Show on map sets blank after a chosen base map"
    if args.view:
        lng, lat, z = map(float, args.view.split(","))
        page.evaluate(f"window.duckMap.jumpTo({{center: [{lng}, {lat}], zoom: {z}}})")
        page.wait_for_function("window.duckMap.loaded()", timeout=600_000)
    print("map view:", page.evaluate("(() => { const m = window.duckMap; return {center: m.getCenter(), zoom: m.getZoom()}; })()"))
    page.screenshot(path=str(out / "map.png"))
    if args.boundary_shots:
        gj = json.loads(pathlib.Path(args.boundary).read_text())
        g = gj["features"][0]["geometry"] if "features" in gj else gj
        ring = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"][0][0]
        lng, lat = min(ring)[:2]                     # the westmost vertex of the boundary: the area on one side, OpenFreeMap on the other
        for z in (12, 16):
            for pitch in (0, 60):
                page.evaluate(f"window.duckMap.jumpTo({{center: [{lng}, {lat}], zoom: {z}, pitch: {pitch}}})")
                page.wait_for_function("window.duckMap.loaded()", timeout=600_000)
                page.wait_for_timeout(1500)
                page.screenshot(path=str(out / f"boundary-z{z}-pitch{pitch}.png"))
    print(json.dumps(page.evaluate("window.timings")))
    assert not unversioned, f"requests with no version: {unversioned}"
    browser.close()
server.shutdown()
