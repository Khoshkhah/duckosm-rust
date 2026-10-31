"""The action buttons of the steps in headless Chromium (Playwright): each is `disabled` until its inputs are ready, with a clearly different look (muted
background and text from the panel's tokens, not-allowed cursor, no hover change) and a short reason as text under it (no tooltip). Search (a name), GeoJSON
(an area), Build (an area and a data file), Run (a query), Show on map and Edit levels (while a draw runs or the editor opens). On a computer (light and dark)
and on a phone (390 x 844, touch).

    python crates/duckosm-wasm/www/buttons_e2e.py [out folder]

It uses tests/data/monaco_sample.osm.pbf and tests/data/monaco.geojson. Build the page first (docs/development.md, "WebAssembly").
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-buttons")
out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html?maxroads=0"
LOOK = """(id) => { const b = document.getElementById(id), c = getComputedStyle(b); return {disabled: b.disabled, bg: c.backgroundColor, color: c.color, cursor: c.cursor, title: b.title || '', opacity: c.opacity}; }"""
errors = []


def run(browser, name, dark=False, **context):
    phone = "has_touch" in context
    page = browser.new_context(**context).new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.mapReady", timeout=120_000)
    if dark:
        page.evaluate("rsSetTheme('dark')")
    tap = page.tap if phone else page.click
    look = lambda i: page.evaluate(LOOK, i)  # noqa: E731
    why = lambda i: page.evaluate("(i) => document.getElementById(i).textContent.trim()", i)  # noqa: E731

    def off(button, reason_id, text):
        """the button is disabled, looks disabled, has no tooltip, and the reason is the text under it"""
        l = look(button)
        assert l["disabled"] and l["cursor"] == "not-allowed" and l["opacity"] == "1" and not l["title"], (button, l)
        assert text in why(reason_id), (button, why(reason_id))
        b = page.evaluate("(i) => { const r = document.getElementById(i).getBoundingClientRect(); return [r.bottom]; }", button)
        w = page.evaluate("(i) => { const r = document.getElementById(i).getBoundingClientRect(); return [r.top, r.height]; }", reason_id)
        assert w[1] > 0 and w[0] >= b[0] - 1, ("the reason is under the button", button, b, w)
        return l

    def on(button, reason_id):
        l = look(button)
        assert not l["disabled"] and l["cursor"] != "not-allowed", (button, l)
        assert why(reason_id) == "", (button, why(reason_id))
        return l

    # before any input
    assert page.query_selector("#search-go") is None and page.query_selector("#search-why") is None, "the search has one field and no button"
    g0, b0 = off("save", "buildhint", "area"), off("run", "buildhint", "area")
    assert g0["bg"] == b0["bg"], ("one disabled look for every button", g0, b0)
    page.screenshot(path=str(out / f"{name}-1-nothing.png"))
    # an area: GeoJSON is on, Build waits for the data file
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    tap("#tab-region")
    assert not look("save")["disabled"], "GeoJSON is on with an area"
    off("run", "buildhint", "region file")
    page.screenshot(path=str(out / f"{name}-2-area.png"))
    # the data file: Build is on, and it looks like a primary button
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    l = on("run", "buildhint")
    assert l["bg"] != b0["bg"], "Build looks different when it is on"
    page.screenshot(path=str(out / f"{name}-3-ready.png"))
    # building: Build is off with its reason
    tap("#run")
    off("run", "buildhint", "Building")
    page.wait_for_function("!document.getElementById('step5-card').classList.contains('off')", timeout=900_000)
    page.wait_for_function("!document.getElementById('run').disabled", timeout=300_000)       # the build ends after the tables are in the cards
    on("run", "buildhint")
    # the query box: Run is off when it is empty
    page.evaluate("document.getElementById('sql-box').open = true")
    on("query", "query-why")
    page.fill("#sql", "")
    off("query", "query-why", "Type a query first")
    page.fill("#sql", "SELECT 1")
    on("query", "query-why")
    # the map: Show on map is off while the draw runs (the roads draw after the build), Edit levels waits for it
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    on("show", "show-why")
    on("edit-open", "edit-why")
    # a click on Show on map starts a draw: in the same turn of the page, both buttons are off with their reasons (the page is busy while it draws)
    now = page.evaluate("""() => { document.getElementById('show').click(); const g = (i) => document.getElementById(i);
        return [g('show').disabled, g('show-why').textContent, g('edit-open').disabled, g('edit-why').textContent, getComputedStyle(g('show')).cursor]; }""")
    assert now[0] and "Drawing" in now[1] and now[2] and "map is drawn" in now[3] and now[4] == "not-allowed", now
    page.wait_for_function("!window.mapDrawing", timeout=600_000)
    on("show", "show-why")
    on("edit-open", "edit-why")
    page.context.close()
    print(f"buttons ({name}): GeoJSON, Build, Run, Show on map and Edit levels are off with a reason until their inputs are ready, and on after")


with sync_playwright() as p:
    browser = p.chromium.launch()
    run(browser, "desktop", viewport={"width": 1400, "height": 900})
    run(browser, "desktop-dark", dark=True, viewport={"width": 1400, "height": 900})
    run(browser, "phone", viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    browser.close()
server.shutdown()
assert not errors, errors
print("buttons: a disabled look (the panel's tokens), a reason under the button and no tooltip; on a computer (light and dark) and on a phone; no page errors")
