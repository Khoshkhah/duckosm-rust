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


BOX = "(id) => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }"
BUSY = "!document.getElementById('mapbusy').hidden"


def drawn(page, js):
    """Run js (clicks that start a draw), then wait until no draw runs (window.mapDrawing) and the map is drawn or failed. The map's
    loading veil (#mapbusy) shows at once and goes when the draw stops."""
    page.evaluate(js)
    assert page.evaluate(BUSY), "the loading veil shows at once"
    page.wait_for_timeout(1000)                     # a second click 300 ms later is in
    page.wait_for_function("!window.mapDrawing && /drawn|failed/.test(document.getElementById('mapnote').textContent) && "
                           "window.duckMap.loaded()", timeout=300_000)
    assert not page.evaluate(BUSY), "the loading veil goes after the draw"


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(accept_downloads=True, viewport={"width": 1400, "height": 850})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    unversioned = unversioned_requests(page, www)
    page.on("console", lambda m: m.type == "error" and print("console:", m.text))
    # roadstyle's dashboard checks each roads style's interaction contract (roadstyle:contract, since 6be68c2): an error for a newer
    # one, an info line for a style without it. The page's look is not "live", so its styles have no contract: read as version 1.
    contract = []
    page.on("console", lambda m: "contract" in m.text and contract.append(f"{m.type}: {m.text}"))
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    page.evaluate("localStorage.clear()")             # no edits of an earlier run
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    page.click("#run")
    # the draw after the build (Kaveh: "a loading map processing shows first, then change base map to blank and zoom to that area"):
    # first the veil with the draw's step over the map as it is (the base map of before), then the blank base and the area in view
    page.wait_for_function(BUSY, timeout=600_000, polling=50)
    assert page.evaluate("document.querySelector('input[name=rs-bm]:checked')?.value") != "blank", "the old base map under the veil"
    print("while the draw runs:", page.inner_text("#mapbusy-text"))
    page.screenshot(path=str(out / "draw-during.png"))
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && document.getElementById('mapbusy').hidden",
                           timeout=600_000)
    assert "drawn" in page.inner_text("#mapnote"), page.inner_text("#mapnote")
    assert page.is_visible("#step7-card"), "card 7 shows after a build with levels"
    # the draw after the build: the blank base map (the light theme) and the area in view (Kaveh: "set base map to blank and zoom on
    # the selected area")
    page.wait_for_function("!window.duckMap.isMoving()", timeout=30_000)
    assert page.evaluate("document.querySelector('input[name=rs-bm]:checked')?.value") == "blank"
    w, s_, e, n = AREA
    assert page.evaluate(f"(b => b.contains([{w}, {s_}]) && b.contains([{e}, {n}]))(window.duckMap.getBounds())"), "the area in view"
    page.screenshot(path=str(out / "draw-after.png"))
    # a real hover and a real click on a road (roadstyle's pick layer, rs-roads-simple): the road's hover state, then rs:select
    point = page.evaluate("""() => { const m = window.duckMap, c = m.getCanvas().getBoundingClientRect();
        for (const f of m.queryRenderedFeatures({layers: window.duckMap.getStyle().layers.filter((l) => l.id.startsWith('rs-roads-simple')).map((l) => l.id)})) {
          const g = f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates[0];
          const p = m.project(g[Math.floor(g.length / 2)]);
          const hit = m.queryRenderedFeatures(p, {layers: window.duckMap.getStyle().layers.filter((l) => l.id.startsWith('rs-roads-simple')).map((l) => l.id)})[0];
          if (hit && p.x > 420 && p.x < c.width - 80 && p.y > 40 && p.y < c.height - 60) return [p.x + c.left, p.y + c.top, hit.id]; }
        return null; }""")
    assert point, "a road on the map"
    page.evaluate("window.selected = null; document.addEventListener('rs:select', (e) => { window.selected = e.detail.id; })")
    page.mouse.move(point[0], point[1])
    page.wait_for_function("""(id) => window.duckMap.getFeatureState({source: 'rs-roads', sourceLayer: 'simple', id}).hover === true""",
                           arg=point[2], timeout=10_000)
    page.mouse.click(point[0], point[1])
    page.wait_for_function("window.selected != null", timeout=10_000)
    print(f"hover and click: road row {point[2]} glows, rs:select gives row {page.evaluate('window.selected')}")
    page.evaluate("window.rsDeselect?.()")
    # a card folds with a click on its heading, the page keeps the fold, and a second click opens it
    page.click("#step6")
    assert page.evaluate("document.getElementById('step6-card').classList.contains('folded')") and not page.is_visible("#show")
    assert page.evaluate("localStorage.getItem('duckosm.card.6')") == "1"
    assert page.get_attribute("#step6 .fold", "aria-expanded") == "false"
    page.click("#step6 .fold")
    assert page.is_visible("#show") and page.evaluate("localStorage.getItem('duckosm.card.6')") == "0"

    # a base map that the user chooses: "Show on map" (a fresh map) sets the blank one again; the choice stays for the draws that are not fresh
    choose = "(r => { r.checked = true; r.dispatchEvent(new Event('change')); })(document.querySelector('input[name=rs-bm][value=ofm_liberty]'))"
    page.evaluate(choose)
    drawn(page, "document.getElementById('show').click()")
    assert page.evaluate("document.querySelector('input[name=rs-bm]:checked')?.value") == "blank", "Show on map sets blank after a chosen base map"
    page.evaluate(choose)
    print("base map: blank at each fresh draw (Show on map, after a build), whatever the user chose before")

    # one draw at a time: two clicks at once, a click while a draw runs, then each network after "all"
    for what, js in [("two clicks at once", "document.getElementById('show').click(); document.getElementById('show').click()"),
                     ("a click while a draw runs", "document.getElementById('show').click(); setTimeout(() => document.getElementById('show').click(), 300)"),
                     *[(f"network {m}", f"(s => {{ s.value = '{m}'; s.dispatchEvent(new Event('change')); }})(document.getElementById('mapmode'))")
                       for m in ["driving", "all", "walking", "all", "cycling", "all"]]]:
        centre = page.evaluate("window.duckMap.getCenter().toArray()")
        drawn(page, js)
        assert "drawn" in page.inner_text("#mapnote"), f"{what}: {page.inner_text('#mapnote')}"
        if what.startswith("network"):       # a network change does not move the view
            assert page.evaluate("window.duckMap.getCenter().toArray()") == centre, what
        if what.startswith("network"):       # the roads on the map: the network's own (Monaco: driving 3,454, walking 11,910, cycling 11,257)
            print(f"{what}: {page.evaluate('window.RS_SIDE.props.length')} roads on the map")
    # a draw that fails (an unknown network) must not break the next ones
    failed = page.evaluate("import('./app/duck.js').then((d) => d.roadsStyle('nope', 'x')).then(() => '', (e) => e.message)")
    assert failed, "the draw with an unknown network fails"
    for m in ["driving", "all"]:
        drawn(page, f"(s => {{ s.value = '{m}'; s.dispatchEvent(new Event('change')); }})(document.getElementById('mapmode'))")
        assert "drawn" in page.inner_text("#mapnote"), f"network {m} after a failed draw: {page.inner_text('#mapnote')}"
    # a draw of the page that fails (the map refuses the roads source once): the veil goes and the note gives the error
    page.evaluate("() => { window.duckMap.addSource = () => { delete window.duckMap.addSource; throw new Error('test fault'); }; }")
    drawn(page, "document.getElementById('show').click()")
    assert "The map failed: test fault" in page.inner_text("#mapnote"), page.inner_text("#mapnote")
    print("a failed draw:", page.inner_text("#mapnote"))
    drawn(page, "document.getElementById('show').click()")
    assert "drawn" in page.inner_text("#mapnote"), f"the draw after a failed draw: {page.inner_text('#mapnote')}"
    # each reading drops its own temporary tables (roadstyle's run: "drop")
    assert sql(page, "SELECT count(*) FROM duckdb_tables() WHERE temporary") == ["0"], "no temporary table after the draws"
    print("draws: two clicks, a click during a draw, the networks, and the networks after a failed draw: each one drawn")
    edges = int(sql(page, "SELECT count(*) FROM visualization.edge_levels")[0])
    before = sql(page, "SELECT count(*) FROM visualization.edge_levels WHERE head_end_m = 7 OR head_start_m = 7")[0]

    # open the editor: the level area from the tables, the editor's roads on the page's map (tiles lv://), its panel on the right
    # the longest task of the main thread while the editor opens (the editor's engine is in a worker: the page does not stop)
    page.evaluate("""window.longTask = 0; new PerformanceObserver((l) => l.getEntries().forEach((e) =>
        window.longTask = Math.max(window.longTask, e.duration))).observe({type: 'longtask'})""")
    # the messages to the editor's worker (roadstyle's call.js: {type, id}): the number of solves, and the time of each type until its
    # answer (window.workerSeconds, the last one of each type)
    page.evaluate("""() => { window.solves = 0; window.workerSeconds = {}; const post = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (m, ...r) {
          if (m && /^[a-z]/.test(m.type) && m.id) {      // MapLibre's workers have messages {type, id} too, with upper-case types
            if (m.type === 'solve') window.solves++;
            const t0 = performance.now(), w = this;
            w.addEventListener('message', function done(e) {
              if (e.data.id === m.id) { window.workerSeconds[m.type] = (performance.now() - t0) / 1000; w.removeEventListener('message', done); } });
          }
          return post.call(this, m, ...r); }; }""")
    ref = page.evaluate("(() => { const c = window.duckMap.getCenter(); return [c.lng + 0.001, c.lat + 0.001]; })()")
    at = lambda: page.evaluate("r => { const q = window.duckMap.project(r); return [q.x, q.y]; }", ref)
    pos0 = at()
    t = time.time()
    page.click("#edit-open")
    page.wait_for_function("window.levelEditorOpen || /failed/.test(document.getElementById('editnote').textContent)", timeout=300_000)
    assert page.evaluate("!!window.levelEditorOpen"), page.inner_text("#editnote")
    # the page gives the editor the map's levels (levelEditor's levels, roadstyle 083224c): no solve also at the first open
    page.wait_for_timeout(500)
    assert max(abs(x - y) for x, y in zip(at(), pos0)) <= 2, ("the view moved when the editor opened", pos0, at())
    # 3D at z16: the extrusion layers are after every road layer (lines draw over extrusions), also with the editor's roads
    page.evaluate("window.duckMap.jumpTo({zoom: 16, pitch: 60})")
    page.wait_for_function("window.duckMap.loaded()", timeout=120_000)
    page.wait_for_timeout(1500)
    order = page.evaluate("window.duckMap.getStyle().layers.map((l) => [l.id, l.type, l.source ?? ''])")
    ext = [i for i, (_, t, src) in enumerate(order) if t == "fill-extrusion" and src.startswith("rs-")]   # ours; OpenFreeMap's stay as served
    roads = [i for i, (n, t, _) in enumerate(order) if t == "line" and n.startswith(("rs-roads", "rs-lv-"))]
    print("3D layers:", len(ext), "road layers:", len(roads))
    assert not ext or not roads or min(ext) > max(roads), ("extrusion layers after the road layers", ext, roads)
    page.screenshot(path=str(out / "editor-3d-pitch60.png"))
    page.evaluate("window.duckMap.jumpTo({pitch: 0})")
    pos0 = at()
    print("first open: the editor starts from", page.evaluate("window.levelEditorOpen.answer().resolve"))
    assert page.evaluate("window.solves") == 0, "the first open starts from the page's levels"
    print(f"open: {time.time() - t:.2f} s from the click until the editor is open; longest main-thread task "
          f"{page.evaluate('window.longTask') / 1000:.2f} s")
    print("first open:", page.inner_text("#editnote"))
    SPOT = """() => { const m = window.duckMap, c = m.getCanvas().getBoundingClientRect();   // left of the editor's panel
        for (const f of m.queryRenderedFeatures({layers: window.duckMap.getStyle().layers.filter((l) => l.id.startsWith('rs-roads-simple')).map((l) => l.id)})) {
          const g = f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates[0];
          const p = m.project(g[Math.floor(g.length / 2)]);
          if (m.queryRenderedFeatures(p, {layers: window.duckMap.getStyle().layers.filter((l) => l.id.startsWith('rs-roads-simple')).map((l) => l.id)})[0] && p.x > 420 && p.x < c.width - 450 && p.y > 40 && p.y < c.height - 60) return [p.x + c.left, p.y + c.top]; }
        return null; }"""
    STATES = """() => { const m = window.duckMap, out = [];
        const layers = [...new Set(m.getStyle().layers.filter((l) => l.source === 'rs-roads' && l['source-layer']).map((l) => l['source-layer']))];
        for (const sl of layers) for (let i = 0; i < window.RS_SIDE.props.length; i++) {
          const f = m.getFeatureState({source: 'rs-roads', sourceLayer: sl, id: i});
          if (f && Object.keys(f).some((k) => f[k])) out.push([sl, i, JSON.stringify(f)]);
        } return out; }"""
    # the real click in the editor: a road picked as the user does it (the editor's tap), then Close
    cam = page.evaluate("(() => { const m = window.duckMap; return {center: m.getCenter(), zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing()}; })()")
    page.evaluate("window.duckMap.jumpTo({zoom: 14, pitch: 0})")        # flat, where roads are left of the panel
    page.wait_for_function("window.duckMap.loaded()", timeout=120_000)
    page.mouse.click(*page.evaluate(SPOT))
    page.wait_for_selector("#lv-cards .card, #lv-cards [data-hroad]", timeout=10_000)
    page.evaluate("c => window.duckMap.jumpTo(c)", cam)
    # the road table has no lines (roadstyle a5209e9): the editor's end marks come from the worker's roadLines through linesOf
    assert page.evaluate("window.RS_SIDE.props.some((p) => p && p.s_lon != null && p.e_lon != null)"), "the editor's end marks (lines of the roads)"
    print("editor: a road picked by a click; states while open:", len(page.evaluate(STATES)))
    # the second open of the same area: the page writes the area's files again; since roadstyle 6be68c2 the editor starts from the
    # stored levels when levels_info.json names the same inputs (the SHA-256 of roads.parquet, pairs.csv and edits.csv): no solve
    page.click("#lv-back")
    page.wait_for_function("!window.levelEditorOpen && !window.mapDrawing && window.duckMap.loaded()", timeout=300_000)
    page.wait_for_timeout(500)
    assert max(abs(x - y) for x, y in zip(at(), pos0)) <= 2, ("the view moved when the editor closed", pos0, at())
    # Kaveh's path (2026-10-26): a road picked while the editor was open (rsSelect(200) above), then Close: no road keeps select or hover
    # state on the page's map, a real click on another road selects it, and a click on empty map clears it
    left = page.evaluate(STATES)
    print("states left after Close:", left[:5])
    assert not left, ("the editor leaves feature state on the page's map", left[:5])
    page.evaluate("window.duckMap.jumpTo({zoom: 14, pitch: 0})")
    page.wait_for_function("window.duckMap.loaded()", timeout=120_000)
    spot = page.evaluate(SPOT)
    assert spot, "a road to click"
    page.mouse.click(*spot)
    page.wait_for_timeout(700)
    picked = page.evaluate(STATES)
    assert picked, "a click on a road selects it after the editor"
    page.wait_for_function("window.RS_SIDE._lines && window.RS_SIDE._lines.size > 0", timeout=20_000)   # the picked road's line was loaded (linesOf)
    assert page.evaluate("[...window.RS_SIDE._lines.values()].some((l) => l && l.length >= 2)"), "the line of the picked road"
    page.mouse.click(*page.evaluate("() => { const m = window.duckMap; for (const [x, y] of [[420, 60], [430, 800], [1000, 70]]) { if (!m.queryRenderedFeatures([[x - 6, y - 6], [x + 6, y + 6]], {layers: window.duckMap.getStyle().layers.filter((l) => l.id.startsWith('rs-roads-simple')).map((l) => l.id)}).length) return [x, y]; } return [420, 60]; }"))
    page.wait_for_timeout(700)
    assert not page.evaluate(STATES), "a click on empty map clears the selection"
    print("after Close: no state left, a click selects a road, a click on empty map clears it")
    page.evaluate("c => window.duckMap.jumpTo(c)", cam)
    page.wait_for_function("window.duckMap.loaded()", timeout=120_000)
    made = page.evaluate("window.editorArea")
    page.evaluate("window.editorArea = null")
    t = time.time()
    page.click("#edit-open")
    page.wait_for_function("window.levelEditorOpen || /failed/.test(document.getElementById('editnote').textContent)", timeout=300_000)
    assert page.evaluate("!!window.levelEditorOpen"), page.inner_text("#editnote")
    assert page.evaluate("window.editorArea") is None, "the area is not made again: its edges did not change (areaIsFor)"
    print("second open: the editor starts from", page.evaluate("window.levelEditorOpen.answer().resolve"))
    print(f"second open: {time.time() - t:.2f} s from the click until the editor is open, "
          f"{page.evaluate('window.solves')} solve(s)")
    if page.evaluate("window.solves") != 0:      # why: the stored key and the files' key
        print("stored inputs key:", page.evaluate("""async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('lv-duckosm_Monaco');
            const text = async (n) => (await (await d.getFileHandle(n)).getFile()).arrayBuffer();
            const sha = async (b) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
            return [JSON.parse(new TextDecoder().decode(await text('levels_info.json'))).inputs,
              [await sha(await text('roads.parquet')), await sha(await text('pairs.csv')), await sha(await text('edits.csv'))].join(':')]; }"""))
    assert page.evaluate("window.solves") == 0, "the second open of the same area starts from the stored levels"
    print("editor:", page.inner_text("#editnote"))
    assert made["roads"] > 6000 and made["pairs"] > 0, made      # Monaco: 6,830 roads (13,298 edges)
    # host mode: the editor draws on the page's own map and tile source rs-roads; only its end markers are its own
    assert page.evaluate("window.duckMap.getStyle().sources['rs-roads'].tiles[0]").startswith("rs://"), "the page's roads"
    assert page.evaluate("'lv-ends' in window.duckMap.getStyle().sources"), "the editor's end markers"
    assert page.evaluate("window.duckMap.getStyle().layers.some((l) => l.source === 'rs-roads' && l['source-layer'] === 'simple')"), "the roads"
    print("host mode: the editor uses the page's tile source rs-roads")
    assert page.is_visible("#lv"), "the editor's panel"
    page.evaluate("window.rsSelect(200)")          # a road picked, as a click on it does: the panel shows its card
    page.wait_for_function("window.duckMap.loaded()", timeout=120_000)
    page.screenshot(path=str(out / "editor.png"))
    # the dark theme (the theme tool of roadstyle's bar sets data-rs-theme; the page copies it to data-theme): the editor's panel follows it
    page.locator("#rs-toolbar button").first.click()   # the theme tool (roadstyle's tip.js takes the title attribute)
    page.wait_for_timeout(500)
    assert page.evaluate("document.documentElement.dataset.theme") == "dark" == page.evaluate("document.documentElement.dataset.rsTheme")
    assert page.evaluate("getComputedStyle(document.getElementById('lv')).backgroundColor") != "rgb(246, 247, 249)", "the dark panel"
    page.screenshot(path=str(out / "editor-dark.png"))
    page.locator("#rs-toolbar button").first.click()   # the theme tool (roadstyle's tip.js takes the title attribute)
    # the editor is in the page's one panel (#sb): the panel's hide button hides the editor with it, and the show button brings it back with its
    # tabs working (before 2026-10-30 the editor had a frame of its own, which stayed on the right when the page's panel collapsed)
    for click, collapsed in [("#sb-hide", True), ("#sb-show", False)]:
        page.click(click)
        page.wait_for_timeout(400)
        assert page.evaluate("document.body.classList.contains('collapsed')") == collapsed
        assert page.is_hidden("#sb") if collapsed else page.is_visible("#sb"), "the page's panel hides and shows"
        assert page.is_hidden("#lv") if collapsed else page.is_visible("#lv"), ("the editor goes with the panel", collapsed)
        if collapsed:
            page.screenshot(path=str(out / "editor-collapsed.png"))
            continue
        assert page.evaluate("getComputedStyle(document.querySelector('#sb .sb-body')).display") == "none", "the page's steps stay hidden"
        page.click("#lv-tabs [data-t=history]")
        page.wait_for_function("document.querySelector('#lv-tabs [data-t=history]').classList.contains('on')", timeout=5_000)
        page.click("#lv-tabs [data-t=edit]")
    print("collapse: the editor goes with the page's panel and comes back with it; its tabs work")

    # one edit: the end head of a long road 7 m long, as the panel's API does it; the editor solves again and sends "solved"
    page.evaluate("window.solvedEvents = 0; window.levelEditorOpen.addEventListener('solved', () => window.solvedEvents++)")
    road = page.evaluate("(async () => { const e = window.levelEditorOpen, ids = e.roads.slice(0, 300), f = await e.facts(ids); return ids.find((i) => f[i].length_m > 30); })()")   # a head of 7 m fits
    t = time.time()
    said = page.evaluate("r => window.lvApi('/api/apply', {ops: [{op: 'head', road: r, end: 'end', m: '7'}]})", road)
    assert said["ok"] and said["redrawn"], said
    assert page.evaluate("window.solvedEvents") == 1
    print(f"edit: a head: {time.time() - t:.2f} s until the map is drawn again ({said['said']})")
    # a cap change and its undo (the cap of the editor's default): each is drawing only
    for cap in ["square", ""]:
        t = time.time()
        said = page.evaluate("([r, c]) => window.lvApi('/api/apply', {ops: [{op: 'cap', road: r, end: 'start', cap: c}]})", [road, cap])
        assert said["ok"] and said["redrawn"], said
        print(f"edit: a cap ({cap or 'auto'}): {time.time() - t:.2f} s until the map is drawn again ({said['said']})")
    print("the worker's last times (s):", {k: round(v, 2) for k, v in page.evaluate("window.workerSeconds").items()})
    assert page.evaluate("window.solvedEvents") == 3
    page.click("#lv-back")
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
    page.evaluate("(v) => { const s = document.getElementById('mapmode'); s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); }", "driving")   # the select is roadstyle's list (selectbox.js)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && window.duckMap.loaded()", timeout=300_000)
    print("driving map:", page.inner_text("#mapnote"))
    assert "drawn" in page.inner_text("#mapnote")
    page.evaluate("(v) => { const s = document.getElementById('mapmode'); s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); }", "all")   # the select is roadstyle's list (selectbox.js)
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
    # the area's files are in the site's private file system (roadstyle's browserStore since 65af6e6), heads.csv with the edit
    heads = page.evaluate("""async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('lv-duckosm_Monaco');
        return (await (await d.getFileHandle('heads.csv')).getFile()).text(); }""")
    assert heads.count(road) == 1, heads
    assert page.evaluate("localStorage.getItem('lv:duckosm:Monaco:pairs.csv')") is None, "no text file in localStorage"
    page.click("#lv-back")                       # destroy puts the page's road layers back: no new drawing
    page.wait_for_function("window.duckMap.loaded()", timeout=300_000)
    assert page.evaluate("window.duckMap.getStyle().sources['rs-roads'].tiles[0]").startswith("rs://")
    assert not page.evaluate("Object.keys(window.duckMap.getStyle().sources).some((id) => id.startsWith('rs-lv-'))")
    assert page.evaluate("window.duckMap.getStyle().layers.some((l) => l.source === 'rs-roads' && l['source-layer'] === 'simple')"), "the roads"
    assert sql(page, "SELECT count(*) FROM visualization.edge_levels WHERE head_end_m = 7 OR head_start_m = 7")[0] == after
    print("close: no change")

    # a browser that cannot keep large files (a full storage of the site): each file over 100 KB fails in the private file system. The
    # editor opens with those files in memory, it solves, and the card says so.
    # the store empty first: the page makes the area again and writes its files (areaIsFor is false)
    page.evaluate("async () => { await (await navigator.storage.getDirectory()).removeEntry('lv-duckosm_Monaco', {recursive: true}); }")
    page.evaluate("""() => { const w = FileSystemWritableFileStream.prototype.write; window.realWrite = w;
        FileSystemWritableFileStream.prototype.write = function (data) {
          const n = typeof data === "string" ? data.length : data.byteLength ?? data.size ?? 0;
          if (n > 100000) return Promise.reject(new DOMException("the quota has been exceeded", "QuotaExceededError"));
          return w.call(this, data); }; }""")
    page.click("#edit-open")
    page.wait_for_function("window.levelEditorOpen || /failed/.test(document.getElementById('editnote').textContent)", timeout=300_000)
    assert page.evaluate("!!window.levelEditorOpen"), page.inner_text("#editnote")
    assert "could not keep the area files" in page.inner_text("#editnote"), page.inner_text("#editnote")
    said = page.evaluate("r => window.lvApi('/api/apply', {ops: [{op: 'head', road: r, end: 'end', m: '6'}]})", road)
    assert said["ok"], said
    assert "could not keep the area files" in page.inner_text("#editnote"), page.inner_text("#editnote")
    print("full storage:", page.inner_text("#editnote")[-160:])
    page.click("#lv-back")
    page.wait_for_function("window.duckMap.loaded() && !window.levelEditorOpen", timeout=300_000)
    page.evaluate("() => { FileSystemWritableFileStream.prototype.write = window.realWrite; }")
    assert not errors, errors
    assert not [c for c in contract if not c.startswith("info:")], contract
    print(f"contract: no error; {len(contract)} info line(s) (a style with no roadstyle:contract is read as version 1)")
    assert not unversioned, f"requests with no version: {unversioned}"
    print("no page errors")
    browser.close()
server.shutdown()
