"""The level editor of the page (card 7, docs/app.md) in headless Chromium (Playwright): build Monaco through the File tab, open the
editor, make one edit through its API (window.lvApi, as the panel does), Apply, and check the tables, the .duckdb download and the map.
The out folder gets editor.png (the editor open) and page.duckdb.

    python crates/duckosm-wasm/www/editor_e2e.py [out folder] [page folder]

The page folder is this one by default; a copy with versions (version_refs.py, as the deploy makes it) also checks that
each request of the page for a file of the site has the version. It uses tests/data/monaco_sample.osm.pbf and tests/data/monaco.geojson. Build the page first (docs/development.md, "WebAssembly").
The page loads duckdb-wasm and MapLibre from cdn.jsdelivr.net, so the computer needs the network.
"""
import json
import pathlib
import sys
import time

import duckdb
from playwright.sync_api import sync_playwright

from serve import WWW, start, unversioned_requests

ROOT = pathlib.Path(__file__).resolve().parents[3]
# the box of the test's area (tests/data/monaco.geojson): west, south, east, north
_rings = [c for f in json.loads((ROOT / "tests/data/monaco.geojson").read_text())["features"] for c in
          (f["geometry"]["coordinates"] if f["geometry"]["type"] == "Polygon" else [r for poly in f["geometry"]["coordinates"] for r in poly])]
AREA = (min(x for r in _rings for x, _ in r), min(y for r in _rings for _, y in r), max(x for r in _rings for x, _ in r),
        max(y for r in _rings for _, y in r))
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-editor")
out.mkdir(parents=True, exist_ok=True)
www = sys.argv[2] if len(sys.argv) > 2 else WWW
server = start(0, quiet=True, directory=www)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"


def sql(page, text):
    """The rows of a query in the page's DuckDB, through the SQL box of card 5 (the first column of each row)."""
    page.evaluate("document.getElementById('sql-box').open = true")   # the SQL box of card 5 is folded
    page.fill("#sql", text)
    page.click("#query")
    page.wait_for_function("document.querySelector('#result table, #result .error')", timeout=60_000)
    if page.query_selector("#result .error"):
        raise SystemExit("SQL: " + page.inner_text("#result .error"))
    got = page.eval_on_selector_all("#result table tr td:first-child", "tds => tds.map((t) => t.textContent)")
    page.evaluate("document.getElementById('result').innerHTML = ''")
    return got


def drawn(page, js):
    """Run js (clicks that start a draw), then wait until no draw runs (window.mapDrawing) and the map is drawn or failed."""
    page.evaluate(js)
    page.wait_for_timeout(1000)                     # a second click 300 ms later is in
    page.wait_for_function("!window.mapDrawing && /drawn|failed/.test(document.getElementById('mapnote').textContent) && "
                           "window.duckMap.loaded()", timeout=300_000)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(accept_downloads=True, viewport={"width": 1400, "height": 850})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    unversioned = unversioned_requests(page, www)
    page.on("console", lambda m: m.type == "error" and print("console:", m.text))
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    page.evaluate("localStorage.clear()")             # no edits of an earlier run
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    page.click("#run")
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent)", timeout=600_000)
    assert "drawn" in page.inner_text("#mapnote"), page.inner_text("#mapnote")
    assert page.is_visible("#step7-card"), "card 7 shows after a build with levels"
    # the draw after the build: the blank base map (the light theme) and the area in view (Kaveh: "set base map to blank and zoom on
    # the selected area")
    page.wait_for_function("!window.duckMap.isMoving()", timeout=30_000)
    assert page.evaluate("document.querySelector('input[name=base]:checked')?.value") == "blank"
    w, s_, e, n = AREA
    assert page.evaluate(f"(b => b.contains([{w}, {s_}]) && b.contains([{e}, {n}]))(window.duckMap.getBounds())"), "the area in view"
    # a card folds with a click on its heading, the page keeps the fold, and a second click opens it
    page.click("#step6")
    assert page.evaluate("document.getElementById('step6-card').classList.contains('folded')") and not page.is_visible("#show")
    assert page.evaluate("localStorage.getItem('duckosm.card.6')") == "1"
    assert page.get_attribute("#step6 .fold", "aria-expanded") == "false"
    page.click("#step6 .fold")
    assert page.is_visible("#show") and page.evaluate("localStorage.getItem('duckosm.card.6')") == "0"

    # a base map that the user chooses stays for the next draws of the page
    page.evaluate("(r => { r.checked = true; r.dispatchEvent(new Event('change')); })(document.querySelector('input[name=base][value=\"\"]'))")
    drawn(page, "document.getElementById('show').click()")
    assert page.evaluate("document.querySelector('input[name=base]:checked')?.value") == "", "the user's base map stays"
    print("base map: blank at the first draw, the user's choice at the next ones")

    # one draw at a time: two clicks at once, a click while a draw runs, then each network after "all"
    for what, js in [("two clicks at once", "document.getElementById('show').click(); document.getElementById('show').click()"),
                     ("a click while a draw runs", "document.getElementById('show').click(); setTimeout(() => document.getElementById('show').click(), 300)"),
                     *[(f"network {m}", f"(s => {{ s.value = '{m}'; s.dispatchEvent(new Event('change')); }})(document.getElementById('mapmode'))")
                       for m in ["driving", "all", "walking", "all", "cycling", "all"]]]:
        drawn(page, js)
        assert "drawn" in page.inner_text("#mapnote"), f"{what}: {page.inner_text('#mapnote')}"
        if what.startswith("network"):       # the roads on the map: the network's own (Monaco: driving 3,454, walking 11,910, cycling 11,257)
            print(f"{what}: {page.evaluate('window.RS_SIDE.props.length')} roads on the map")
    # a draw that fails (an unknown network) must not break the next ones
    failed = page.evaluate("import('./app/duck.js').then((d) => d.roadsStyle('nope', 'x')).then(() => '', (e) => e.message)")
    assert failed, "the draw with an unknown network fails"
    for m in ["driving", "all"]:
        drawn(page, f"(s => {{ s.value = '{m}'; s.dispatchEvent(new Event('change')); }})(document.getElementById('mapmode'))")
        assert "drawn" in page.inner_text("#mapnote"), f"network {m} after a failed draw: {page.inner_text('#mapnote')}"
    # each reading drops its own temporary tables (roadstyle's run: "drop")
    assert sql(page, "SELECT count(*) FROM duckdb_tables() WHERE temporary") == ["0"], "no temporary table after the draws"
    print("draws: two clicks, a click during a draw, the networks, and the networks after a failed draw: each one drawn")
    edges = int(sql(page, "SELECT count(*) FROM visualization.edge_levels")[0])
    before = sql(page, "SELECT count(*) FROM visualization.edge_levels WHERE head_end_m = 7 OR head_start_m = 7")[0]

    # open the editor: the level area from the tables, the editor's roads on the page's map (tiles lv://), its panel on the right
    # the longest task of the main thread while the editor opens (the editor's engine is in a worker: the page does not stop)
    page.evaluate("""window.longTask = 0; new PerformanceObserver((l) => l.getEntries().forEach((e) =>
        window.longTask = Math.max(window.longTask, e.duration))).observe({type: 'longtask'})""")
    t = time.time()
    page.click("#edit-open")
    page.wait_for_function("window.levelEditorOpen || /failed/.test(document.getElementById('editnote').textContent)", timeout=300_000)
    assert page.evaluate("!!window.levelEditorOpen"), page.inner_text("#editnote")
    print(f"open: {time.time() - t:.2f} s from the click until the editor is open; longest main-thread task "
          f"{page.evaluate('window.longTask') / 1000:.2f} s")
    made = page.evaluate("window.editorArea")
    print("editor:", page.inner_text("#editnote"))
    assert made["roads"] > 6000 and made["pairs"] > 0, made      # Monaco: 6,830 roads (13,298 edges)
    tiles = page.evaluate("window.duckMap.getStyle().sources['rs-lv-roads'].tiles[0]")
    assert tiles.startswith("lv://"), tiles
    assert page.evaluate("window.duckMap.getStyle().layers.some((l) => l.source === 'rs-lv-roads')"), "the editor's roads"
    # the duckOSM base-map layers stay with the page's tile source rs-roads; only the page's road layers go
    page_layers = page.evaluate("""window.duckMap.getStyle().layers.filter((l) => l.source === 'rs-roads')
        .map((l) => [l['source-layer'], (l.layout || {}).visibility || 'visible'])""")
    assert page_layers and all(sl.startswith("ov") for sl, _ in page_layers), page_layers
    assert any(v == "visible" for _, v in page_layers), "a duckOSM base-map layer shows"
    print(f"base map: {len(page_layers)} duckOSM layers stay while the editor is open")
    assert page.is_visible("#lv"), "the editor's panel"
    page.evaluate("window.rsSelect(200)")          # a road picked, as a click on it does: the panel shows its card
    page.wait_for_function("window.duckMap.loaded()", timeout=120_000)
    page.screenshot(path=str(out / "editor.png"))
    # the dark theme of the page's button (data-theme): the panel follows it
    page.evaluate("document.documentElement.dataset.theme = 'dark'")
    page.wait_for_timeout(500)
    assert page.evaluate("getComputedStyle(document.getElementById('lv')).backgroundColor") != "rgb(246, 247, 249)", "the dark panel"
    page.screenshot(path=str(out / "editor-dark.png"))
    page.evaluate("document.documentElement.dataset.theme = 'light'")

    # one edit: the end head of a long road 7 m long, as the panel's API does it; the editor solves again and sends "solved"
    page.evaluate("window.solvedEvents = 0; window.levelEditorOpen.addEventListener('solved', () => window.solvedEvents++)")
    road = page.evaluate("window.levelEditorOpen.roads.find((f) => f.length_m > 30).road")   # a head of 7 m fits
    said = page.evaluate("r => window.lvApi('/api/apply', {ops: [{op: 'head', road: r, end: 'end', m: '7'}]})", road)
    assert said["ok"] and said["redrawn"], said
    assert page.evaluate("window.solvedEvents") == 1
    print("edit:", said["said"])
    page.click("#edit-apply")
    try:
        page.wait_for_function("/Applied|failed/.test(document.getElementById('editnote').textContent)", timeout=120_000)
    finally:
        print("apply note:", page.inner_text("#editnote"))
    print("apply:", page.inner_text("#editnote"))
    assert "Applied" in page.inner_text("#editnote")
    drawn(page, "document.getElementById('show').click()")   # a click while the draw after Apply runs: one more draw after it
    assert "drawn" in page.inner_text("#mapnote"), page.inner_text("#mapnote")
    assert page.evaluate("window.duckMap.getStyle().sources['rs-roads'].tiles[0]").startswith("rs://"), "the page's roads again"
    assert not page.is_visible("#lv") and not page.evaluate("window.levelEditorOpen"), "the editor is closed"

    # the tables of the page
    after = sql(page, "SELECT count(*) FROM visualization.edge_levels WHERE head_end_m = 7 OR head_start_m = 7")[0]
    assert int(sql(page, "SELECT count(*) FROM visualization.edge_levels")[0]) == edges
    assert int(before) == 0 and int(after) >= 1, (before, after)
    assert sql(page, "SELECT source FROM visualization.edge_levels_meta") == ["area"]
    assert sql(page, "SELECT count(*) FROM visualization.level_heads") == ["1"]
    print(f"tables: {after} edge(s) with a 7 m head of {edges}; edge_levels_meta.source = 'area'; level_heads has the edit")

    # a map of one mode reads the stored levels of all modes (roadstyle's subset check)
    page.select_option("#mapmode", "driving")
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && window.duckMap.loaded()", timeout=300_000)
    print("driving map:", page.inner_text("#mapnote"))
    assert "drawn" in page.inner_text("#mapnote")
    page.select_option("#mapmode", "all")
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && window.duckMap.loaded()", timeout=300_000)

    # the .duckdb download has the same
    with page.expect_download(timeout=120_000) as d:
        page.click("#duckdb")
    d.value.save_as(out / "page.duckdb")
    con = duckdb.connect(str(out / "page.duckdb"), read_only=True)
    assert con.sql("SELECT count(*) FROM visualization.edge_levels WHERE head_end_m = 7 OR head_start_m = 7").fetchone()[0] == int(after)
    assert con.sql("SELECT source FROM visualization.edge_levels_meta").fetchone()[0] == "area"
    assert con.sql("SELECT road FROM visualization.level_heads").fetchone()[0] == int(road)
    con.close()
    print("duckdb: the download has the edited levels and level_heads")

    # Close with no Apply changes nothing; the editor opens again with the edit of this area
    page.click("#edit-open")
    page.wait_for_function("window.levelEditorOpen", timeout=300_000)
    assert page.evaluate("r => window.lvApi('/api/edits').then(() => localStorage.getItem('lv:duckosm:Monaco:heads.csv'))", road).count(road) == 1
    page.click("#edit-close")                       # destroy puts the page's road layers back: no new drawing
    page.wait_for_function("window.duckMap.loaded()", timeout=300_000)
    assert page.evaluate("window.duckMap.getStyle().sources['rs-roads'].tiles[0]").startswith("rs://")
    assert not page.evaluate("Object.keys(window.duckMap.getStyle().sources).some((id) => id.startsWith('rs-lv-'))")
    assert page.evaluate("window.duckMap.getStyle().layers.some((l) => l.source === 'rs-roads' && l['source-layer'] === 'simple')"), "the roads"
    assert sql(page, "SELECT count(*) FROM visualization.edge_levels WHERE head_end_m = 7 OR head_start_m = 7")[0] == after
    assert not errors, errors
    assert not unversioned, f"requests with no version: {unversioned}"
    print("close: no change; no page errors")
    browser.close()
server.shutdown()
