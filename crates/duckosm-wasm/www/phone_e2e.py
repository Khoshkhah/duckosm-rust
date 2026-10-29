"""The page on a phone in headless Chromium (Playwright's "iPhone 13": 390 x 664 page, touch, scale 3; docs/app.md, "On a phone"):
roadstyle's sheet (its grip: 40 %, full, closed; the map's padding), Build from the 40 % sheet, a scroll in the sheet, the limit of the
map, and the level editor with taps: roadstyle's sheet at the bottom of the map, a tap
on a road, its end head, "Apply and solve", Apply in the page's bar, the sheet's handle, Close. It checks that the map stays at the
top while the cards scroll, that the editor's bar (the counts, Apply, Close) is in view under roadstyle's bar and above the sheet, and that the
page's panel comes back at its place after Apply and Close. It writes phone-*.png for each state. dashboard_e2e.py checks the phone
form of the bar, the boxes and the windows at 390 x 844.

    python crates/duckosm-wasm/www/phone_e2e.py [out folder] [page folder]

Build the page first (docs/development.md, "WebAssembly"). The page loads its libraries from cdn.jsdelivr.net.
"""
import json
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-phone")
out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=sys.argv[2] if len(sys.argv) > 2 else WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
BOX = "(id) => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_context(**p.devices["iPhone 13"]).new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    shot = lambda name: page.screenshot(path=str(out / f"phone-{name}.png"))  # noqa: E731
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    page.evaluate("localStorage.clear()")
    H = page.evaluate("innerHeight")
    # roadstyle's sheet: three heights (0 closed, 1 40 %, 2 full); the map's padding at the bottom is the part of the screen under its grip
    state = lambda: page.evaluate("[0, 1, 2].find((n) => document.documentElement.classList.contains('rs-sheet-' + n))")  # noqa: E731
    grip = lambda: page.evaluate(BOX, "grip")  # noqa: E731
    page.evaluate("document.querySelector('.rs-grip').id = 'grip'")
    sheet_h = lambda: (lambda b: b[3] - b[1])(page.evaluate(BOX, "sb")) if page.is_visible("#sb") else 0  # noqa: E731
    padding = lambda: page.evaluate("window.duckMap.getPadding().bottom")  # noqa: E731
    under_grip = lambda: H - grip()[1]  # noqa: E731
    page.wait_for_function("window.duckMap.getPadding().bottom > 0", timeout=30_000)   # the sheet's padding: after the map's load

    # the panel is a sheet at the bottom: 40 % of the height at first; the map fills the screen, its padding is the sheet and its grip
    mp, pn = page.evaluate(BOX, "map"), page.evaluate(BOX, "sb")
    assert state() == 1 and mp[1] == 0 and abs(mp[3] - H) < 1, (state(), mp, H)
    assert abs(pn[3] - H) < 1 and abs(sheet_h() - H * 0.4) < 6 and abs(padding() - under_grip()) < 2, (pn, padding(), H)
    shot("1-40")
    # the grip: full, closed, 40 % again
    for want in (2, 0, 1):
        page.tap(".rs-grip")
        page.wait_for_timeout(500)
        assert state() == want, (want, state())
        assert abs(padding() - under_grip()) < 2, (want, padding(), grip())
        if want == 2:
            assert page.evaluate(BOX, "rs-toolbar")[3] - 1 <= page.evaluate(BOX, "sb")[1] < 170, "the full sheet is under the bar"
        if want == 0:
            assert not page.is_visible("#sb") and page.is_visible(".rs-grip"), "closed: the grip alone"
        shot(f"2-{want}")

    # the area and the region file in the 40 % sheet, then Build (the Build bar is at the sheet's bottom edge)
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.tap("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    assert page.evaluate(BOX, "run")[3] <= H, "Build is in view in the sheet"
    page.tap("#run")
    # first the loading veil over the map that the sheet leaves free (the base map of before), then the blank base and the area in view
    page.wait_for_function("!document.getElementById('mapbusy').hidden", timeout=600_000, polling=50)
    assert page.evaluate("document.querySelector('input[name=rs-bm]:checked')?.value") != "blank", "the old base map under the veil"
    page.wait_for_timeout(300)                      # the sheet's height (a transition)
    if page.evaluate("!document.getElementById('mapbusy').hidden"):
        busy, pn = page.evaluate(BOX, "mapbusy"), page.evaluate(BOX, "sb")
        assert abs(busy[3] - grip()[1]) <= 1 and busy[1] >= 40, ("the veil above the sheet and under the bar", busy, grip())
        shot("3a-drawing")
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && window.duckMap.loaded() && "
                           "document.getElementById('mapbusy').hidden", timeout=600_000)
    assert "drawn" in page.inner_text("#mapnote"), page.inner_text("#mapnote")
    assert state() == 1, state()
    page.wait_for_timeout(400)
    card5, pn = page.evaluate(BOX, "step5-card"), page.evaluate(BOX, "sb")
    assert pn[1] < card5[1] < H - 100, ("card 5 (the result) in view in the sheet", card5, pn)
    # the draw after the build: the blank base map and the area in view above the sheet and under the bar (the map's padding)
    page.wait_for_function("!window.duckMap.isMoving()", timeout=30_000)
    assert page.evaluate("document.querySelector('input[name=rs-bm]:checked')?.value") == "blank"
    barb = page.evaluate(BOX, "rs-toolbar")[3]
    area = page.evaluate("""(top) => { const c = window.duckMap.getContainer().getBoundingClientRect(), m = window.duckMap;
        const b = [m.unproject([0, top]), m.unproject([c.width, c.height - window.duckMap.getPadding().bottom])];
        return [b[0].lng, b[1].lat, b[1].lng, b[0].lat]; }""", barb)
    rings = [r for f in json.loads((ROOT / "tests/data/monaco.geojson").read_text())["features"] for r in
             (f["geometry"]["coordinates"] if f["geometry"]["type"] == "Polygon" else [r for poly in f["geometry"]["coordinates"] for r in poly])]
    w, s_, e, n = (min(x for r in rings for x, _ in r), min(y for r in rings for _, y in r), max(x for r in rings for x, _ in r),
                   max(y for r in rings for _, y in r))
    assert area[0] <= w and area[1] <= s_ and area[2] >= e and area[3] >= n, ("Monaco above the sheet", area, (w, s_, e, n))
    shot("3-built")

    # a scroll inside the sheet moves the cards, not the map and not the page
    centre = page.evaluate("window.duckMap.getCenter().toArray()")
    page.mouse.move(195, H - 120)
    page.mouse.wheel(0, 700)
    page.wait_for_timeout(500)
    assert page.evaluate("document.querySelector('.sb-body').scrollTop") > 0, "the cards scroll"
    assert page.evaluate("scrollY") == 0 and page.evaluate("window.duckMap.getCenter().toArray()") == centre, "the map and the page stay"
    shot("4-cards")

    # the largest map on a small device (a touch screen: 40,000 roads): with a limit of 10,000 for Monaco's 13,298 roads, the note says
    # so and nothing is drawn; one network that is smaller (driving: 3,454 roads) draws
    assert page.evaluate("window.mapMaxRoads") == 40000, page.evaluate("window.mapMaxRoads")
    page.evaluate("window.mapMaxRoads = 10000; document.getElementById('show').click()")
    page.wait_for_function("/on this device the map can show up to 10,000/.test(document.getElementById('mapnote').textContent)", timeout=30_000)
    print("limit:", page.inner_text("#mapnote"))
    page.evaluate("(v) => { const s = document.getElementById('mapmode'); s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); }", "driving")   # the select is roadstyle's list (selectbox.js)
    page.wait_for_function("/drawn|failed|on this device/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing "
                           "&& window.duckMap.loaded()", timeout=300_000)
    assert "drawn" in page.inner_text("#mapnote"), page.inner_text("#mapnote")
    page.evaluate("window.mapMaxRoads = 40000")
    page.evaluate("(v) => { const s = document.getElementById('mapmode'); s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); }", "all")   # the select is roadstyle's list (selectbox.js)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing && window.duckMap.loaded()",
                           timeout=300_000)
    assert "drawn" in page.inner_text("#mapnote"), page.inner_text("#mapnote")

    # the level editor: one panel at a time. The page's bar with Apply and Close at the top, the map under it, roadstyle's sheet at the
    # bottom of the map (half the height)
    def open_editor():
        page.tap("#edit-open")
        page.wait_for_function("window.levelEditorOpen || /failed/.test(document.getElementById('editnote').textContent)", timeout=300_000)
        assert page.evaluate("!!window.levelEditorOpen"), page.inner_text("#editnote")
        page.wait_for_function("window.duckMap.loaded()", timeout=120_000)
        page.wait_for_timeout(400)                  # the sheet's height and the map's padding (0.2 s)
        same("opened")

    def back_at(before):
        page.wait_for_function("!window.levelEditorOpen && !window.mapDrawing && window.duckMap.loaded()", timeout=300_000)
        page.wait_for_timeout(400)
        same("closed")
        assert page.is_visible("#step7-card") and page.is_visible("footer") and not page.is_visible("#editbar")
        # the page's sheet again, in the state it had, with the map's padding for it, and card 7 in view in it
        assert state() == before and abs(page.evaluate(BOX, "sb")[3] - H) < 1 and abs(padding() - under_grip()) < 2, (state(), padding(), under_grip())
        top, card = page.evaluate(BOX, "sb")[1], page.evaluate(BOX, "step7-card")
        assert min(card[3], H) - max(card[1], top) >= 100, ("card 7 in view again (100 px of it in the sheet)", top, card)
        assert page.evaluate("scrollY") == 0

    ref = page.evaluate("(() => { const c = window.duckMap.getCenter(); return [c.lng + 0.001, c.lat + 0.001]; })()")
    at = lambda: page.evaluate("r => { const q = window.duckMap.project(r); return [q.x, q.y]; }", ref)
    pos0 = at()
    def same(what):
        assert max(abs(x - y) for x, y in zip(at(), pos0)) <= 2, (f"the view moved when the editor {what}", pos0, at())
    before = state()
    open_editor()
    bar, mp, lv, rsbar = (page.evaluate(BOX, i) for i in ("editbar", "map", "lv", "rs-toolbar"))
    height = page.evaluate("innerHeight")
    assert page.evaluate("document.body.classList.contains('lv-sheet')"), "roadstyle's sheet"
    assert abs(bar[1] - rsbar[3]) < 12 and mp == [0, 0, 390, height], ("the page's bar under roadstyle's bar, the map under both", bar, rsbar, mp, height)
    assert abs(lv[3] - height) < 1 and bar[3] < lv[1] < height * 0.6, ("the sheet at the bottom, half the height", lv, height)
    assert not page.is_visible("#step1-card") and not page.is_visible("footer") and sheet_h() < 1, "the page's sheet is away"
    for b in page.query_selector_all("#editbar button"):
        r = b.bounding_box()
        assert r and r["y"] >= 0 and r["y"] + r["height"] <= bar[3], ("in the bar", b.inner_text(), r)
    print(f"editor: bar {bar}, map {mp}, sheet {lv}, window height {height}")
    shot("5-editor-sheet")

    # a tap on a road in the part of the map above the sheet: the sheet shows its card
    point = page.evaluate("""(top) => { const m = window.duckMap, t = window.RS_SIDE, bottom = document.getElementById('lv').getBoundingClientRect().top;
        for (const c of t.mids) { if (!c) continue; const p = m.project(c), y = p.y + top;
          if (p.x > 30 && p.x < innerWidth - 70 && y > document.getElementById('editbar').getBoundingClientRect().bottom + 20 && y < bottom - 20 &&
            m.queryRenderedFeatures([[p.x - 4, p.y - 4], [p.x + 4, p.y + 4]], {layers: window.duckMap.getStyle().layers.filter((l) => l.id.startsWith('rs-roads-simple')).map((l) => l.id)}).length) return [p.x, y]; } return null; }""", 0)
    assert point, "a road above the sheet"
    page.touchscreen.tap(*point)
    page.wait_for_selector("#lv-cards [data-hroad]", timeout=30_000)
    shot("6-road")
    # its end head one metre shorter (the slider, as a finger moves it): since roadstyle 6be68c2 a head is saved and drawn at once, with
    # no solve and no "Apply and solve"
    t = time.time()
    page.evaluate("""() => { const b = document.querySelectorAll('#lv-cards [data-hroad] input')[1];
        b.value = String(Math.max(+b.min || 0.5, +b.value - 1)); b.dispatchEvent(new Event('input')); b.dispatchEvent(new Event('change')); }""")
    page.wait_for_function("/Changed/.test(document.getElementById('editnote').textContent)", timeout=120_000)   # host mode (LiveMap.relevel): the map redraws in place, RS_SIDE stays
    page.wait_for_timeout(300)
    page.wait_for_function("window.duckMap.loaded()", timeout=120_000)
    print(f"head slider: {time.time() - t:.2f} s until the map is drawn again")
    assert page.is_hidden("#lv-apply"), "no Apply and solve for a head"
    # roadstyle's fault (level_editor.js tap(), since before b976864): a tap near a road's edge sends a second rs:select from the wide
    # tap line, with no road; the panel then asks for the road "undefined" and says "unknown road"
    if "unknown road" in page.evaluate("document.getElementById('lv-toast').textContent"):
        print("roadstyle fault: the tap picked a second road 'undefined' (unknown road)")
    page.wait_for_function("/Changed/.test(document.getElementById('editnote').textContent)", timeout=60_000)
    # Apply in the page's bar: the tables, the map again, the page's panel back
    page.tap("#editbar [data-for=edit-apply]")
    page.wait_for_function("/Applied|failed/.test(document.getElementById('editnote').textContent)", timeout=120_000)
    assert "heads: 1" in page.inner_text("#editnote"), page.inner_text("#editnote")
    back_at(before)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent)", timeout=300_000)
    assert "drawn" in page.inner_text("#mapnote"), page.inner_text("#mapnote")
    shot("7-applied")

    # the editor's sheet handle: half, full, one row; then Close, and the page's panel back
    open_editor()
    for lv_state in ("full", "fold"):
        # the editor's full sheet is 100% - 48 px high and starts under roadstyle's top bar: its handle can be under the bar (a gap in roadstyle,
        # docs/app.md). The page does not correct it. The test prints the gap and clicks the handle in the page.
        if page.evaluate("(h => { const r = h.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) !== h; })(document.getElementById('lv-handle'))"):
            print("GAP, the editor's sheet handle is under roadstyle's bar:", page.evaluate(BOX, "lv-handle"))
            page.evaluate("document.getElementById('lv-handle').click()")
        else:
            page.tap("#lv-handle")
        page.wait_for_timeout(400)
        assert page.evaluate("document.body.dataset.lvSheet") == lv_state
        shot(f"8-sheet-{lv_state}")
    page.tap("#editbar [data-for=edit-close]")
    back_at(before)
    shot("9-closed")
    assert not errors, errors
    print("phone: the sheet (40 %, full, closed), Build from the sheet, a scroll in the sheet; the editor: the sheet, a tap on a road, a head, Apply, the handle, Close; "
          "the page's panel comes back; no page errors")
    browser.close()
server.shutdown()
