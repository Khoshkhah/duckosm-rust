"""The page on a phone in headless Chromium (Playwright's "iPhone 13": 390 x 664 page, touch, scale 3; docs/app.md, "On a phone"):
build Monaco, scroll the cards, fold the panel, open and close the level editor with taps. It checks that the map stays at the top
while the cards scroll, that the editor's bar (the counts, Apply, Close) is in view with no overlap of the map and the editor's
panel, and that the page's panel comes back at its place after Close. It writes phone-*.png for each state.

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

    # the level editor: one panel at a time, the bar with Apply and Close in view, no overlap of the bar, the map and the editor's panel
    page.evaluate("document.getElementById('step7-card').scrollIntoView()")
    before = page.evaluate("scrollY")
    page.tap("#edit-open")
    page.wait_for_function("window.levelEditorOpen || /failed/.test(document.getElementById('editnote').textContent)", timeout=300_000)
    assert page.evaluate("!!window.levelEditorOpen"), page.inner_text("#editnote")
    page.wait_for_function("window.duckMap.loaded()", timeout=120_000)
    bar, mp, lv = (page.evaluate(BOX, i) for i in ("editbar", "map", "lv"))
    height = page.evaluate("innerHeight")
    assert bar[1] == 0 and mp[1] >= bar[3] - 1 and lv[1] >= mp[3] - 1 and lv[3] <= height + 1, ("no overlap", bar, mp, lv, height)
    assert not page.is_visible("#step1-card") and not page.is_visible("footer"), "the page's panel is away"
    for b in page.query_selector_all("#editbar button"):
        r = b.bounding_box()
        assert r and r["y"] >= 0 and r["y"] + r["height"] <= bar[3], ("in the bar", b.inner_text(), r)
    print(f"editor: bar {bar}, map {mp}, editor panel {lv}, window height {height}")
    shot("5-editor")
    page.tap("#editbar [data-for=edit-close]")
    page.wait_for_function("!window.levelEditorOpen && !window.mapDrawing && window.duckMap.loaded()", timeout=300_000)
    assert page.is_visible("#step7-card") and page.is_visible("footer") and not page.is_visible("#editbar")
    assert abs(page.evaluate("scrollY") - before) < 2, ("the panel at its place again", before, page.evaluate("scrollY"))
    shot("6-closed")
    assert not errors, errors
    print("phone: the map stays at the top, the panel folds, the editor's bar is in view, the panel comes back; no page errors")
    browser.close()
server.shutdown()
