"""The page on a phone in headless Chromium (Playwright's "iPhone 13": 390 x 664 page, touch, scale 3; docs/app.md, "On a phone"):
build Monaco, scroll the cards, fold the panel, and use the level editor with taps: roadstyle's sheet at the bottom of the map, a tap
on a road, its end head, "Apply and solve", Apply in the page's bar, the sheet's handle, Close. It checks that the map stays at the
top while the cards scroll, that the editor's bar (the counts, Apply, Close) is in view above the map and the sheet, and that the
page's panel comes back at its place after Apply and Close. It writes phone-*.png for each state.

    python crates/duckosm-wasm/www/phone_e2e.py [out folder] [page folder]

Build the page first (docs/development.md, "WebAssembly"). The page loads its libraries from cdn.jsdelivr.net.
"""
import pathlib
import sys

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
    shot("1-start")
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.tap("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    page.tap("#run")
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && window.duckMap.loaded()", timeout=600_000)
    assert "drawn" in page.inner_text("#mapnote"), page.inner_text("#mapnote")
    shot("2-built")

    # the cards scroll under the map, which stays at the top; the attribution starts folded
    page.evaluate("document.getElementById('step5-card').scrollIntoView()")
    left, top, right, bottom = page.evaluate(BOX, "map")
    assert top == 0 and bottom > 200, ("the map stays at the top", top, bottom)
    assert not page.evaluate("document.querySelector('.maplibregl-ctrl-attrib').classList.contains('maplibregl-compact-show')")
    shot("3-cards")

    # the panel folds and opens with a tap
    page.evaluate("window.scrollTo(0, 0)")
    page.tap("#collapse")
    assert page.evaluate("document.body.classList.contains('collapsed')") and not page.is_visible("#step1-card")
    shot("4-folded")
    page.tap("#collapse")
    assert page.is_visible("#step1-card")

    # the level editor: one panel at a time. The page's bar with Apply and Close at the top, the map under it, roadstyle's sheet at the
    # bottom of the map (half the height)
    def open_editor():
        page.evaluate("document.getElementById('step7-card').scrollIntoView()")
        page.tap("#edit-open")
        page.wait_for_function("window.levelEditorOpen || /failed/.test(document.getElementById('editnote').textContent)", timeout=300_000)
        assert page.evaluate("!!window.levelEditorOpen"), page.inner_text("#editnote")
        page.wait_for_function("window.duckMap.loaded()", timeout=120_000)
        page.wait_for_timeout(400)                  # the sheet's height and the map's padding (0.2 s)

    def back_at(before):
        page.wait_for_function("!window.levelEditorOpen && !window.mapDrawing && window.duckMap.loaded()", timeout=300_000)
        assert page.is_visible("#step7-card") and page.is_visible("footer") and not page.is_visible("#editbar")
        # the page's place again: card 7 in view (card 6's note can change its height while the map draws)
        top = page.evaluate("document.getElementById('step7-card').getBoundingClientRect().top")
        assert 0 <= top < page.evaluate("innerHeight") - 100, ("card 7 in view again", before, page.evaluate("scrollY"), top)

    page.evaluate("document.getElementById('step7-card').scrollIntoView()")
    before = page.evaluate("scrollY")
    open_editor()
    bar, mp, lv = (page.evaluate(BOX, i) for i in ("editbar", "map", "lv"))
    height = page.evaluate("innerHeight")
    assert page.evaluate("document.body.classList.contains('lv-sheet')"), "roadstyle's sheet"
    assert bar[1] == 0 and abs(mp[1] - bar[3]) < 1 and abs(mp[3] - height) < 1, ("the map under the bar", bar, mp, height)
    assert abs(lv[3] - height) < 1 and bar[3] < lv[1] < height * 0.6, ("the sheet at the bottom, half the height", lv, height)
    assert not page.is_visible("#step1-card") and not page.is_visible("footer"), "the page's panel is away"
    for b in page.query_selector_all("#editbar button"):
        r = b.bounding_box()
        assert r and r["y"] >= 0 and r["y"] + r["height"] <= bar[3], ("in the bar", b.inner_text(), r)
    print(f"editor: bar {bar}, map {mp}, sheet {lv}, window height {height}")
    shot("5-editor-sheet")

    # a tap on a road in the part of the map above the sheet: the sheet shows its card
    point = page.evaluate("""(top) => { const m = window.duckMap, t = window.RS_SIDE, bottom = document.getElementById('lv').getBoundingClientRect().top;
        for (const c of t.mids) { if (!c) continue; const p = m.project(c), y = p.y + top;
          if (p.x > 30 && p.x < innerWidth - 70 && y > top + 20 && y < bottom - 20) return [p.x, y]; } return null; }""", mp[1])
    assert point, "a road above the sheet"
    page.touchscreen.tap(*point)
    page.wait_for_selector("#lv-cards [data-hroad]", timeout=30_000)
    shot("6-road")
    # its end head one metre shorter (the slider, as a finger moves it), then "Apply and solve" in the sheet
    page.evaluate("""() => { const b = document.querySelectorAll('#lv-cards [data-hroad] input')[1];
        b.value = String(Math.max(+b.min || 0.5, +b.value - 1)); b.dispatchEvent(new Event('input')); b.dispatchEvent(new Event('change')); }""")
    page.tap("#lv-apply")
    page.wait_for_function("document.getElementById('lv-queue-sec').hidden", timeout=120_000)
    page.wait_for_function("/Solved again/.test(document.getElementById('editnote').textContent)", timeout=60_000)
    # Apply in the page's bar: the tables, the map again, the page's panel back
    page.tap("#editbar [data-for=edit-apply]")
    page.wait_for_function("/Applied|failed/.test(document.getElementById('editnote').textContent)", timeout=120_000)
    assert "heads: 1" in page.inner_text("#editnote"), page.inner_text("#editnote")
    back_at(before)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent)", timeout=300_000)
    assert "drawn" in page.inner_text("#mapnote"), page.inner_text("#mapnote")
    shot("7-applied")

    # the sheet's handle: half, full, one row; then Close, and the page's panel back
    open_editor()
    for state in ("full", "fold"):
        page.tap("#lv-handle")
        page.wait_for_timeout(400)
        assert page.evaluate("document.body.dataset.lvSheet") == state
        shot(f"8-sheet-{state}")
    page.tap("#editbar [data-for=edit-close]")
    back_at(before)
    shot("9-closed")
    assert not errors, errors
    print("phone: the map stays at the top, the panel folds; the editor: the sheet, a tap on a road, a head, Apply, the handle, Close; "
          "the page's panel comes back; no page errors")
    browser.close()
server.shutdown()
