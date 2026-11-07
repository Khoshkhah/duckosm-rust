"""Ask and the data dock (roadstyle's dataDock and askPanel) in headless Chromium (Playwright), on a computer and on a phone (390 x 844, touch):
"Query the tables" (card 5) opens the dock with the start query, and Run gives its rows; a query of road ids gives roads on the map; the card "Ask the data"
opens Ask with the key note and the example questions, and the head row and the body of Ask start at the same left edge (Kaveh: they did not).
Nothing is wider than the phone. No AI service and no key: the test does not ask a question.

    python crates/duckosm-wasm/www/ask_e2e.py [out folder]

It uses tests/data/monaco_sample.osm.pbf and tests/data/monaco.geojson. Build the page first (docs/development.md, "WebAssembly").
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-ask")
out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
errors = []
EDGE = """(sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.offsetParent); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }"""


def run(browser, name, **context):
    phone = "has_touch" in context
    page = browser.new_context(**context).new_page()
    page.on("pageerror", lambda e: errors.append(f"{name}: {e}"))
    page.goto(url)
    page.wait_for_function("window.mapReady", timeout=120_000)
    tap = page.tap if phone else page.click
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    tap("#run")
    page.wait_for_function("!document.getElementById('step5-card').classList.contains('off') && !document.getElementById('run').disabled", timeout=900_000)

    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)   # the roads on the map
    # the dock: the start query runs on the tables of the build
    # no dock until Ask or Query the tables opens it (Kaveh, 2026-11-06: no SQL panel outside Ask)
    assert not page.evaluate("!!document.getElementById('rs-dock') || document.documentElement.classList.contains('rs-dock-has')"), f"{name}: a dock before its first use"
    page.evaluate("rs.sections.fold('step5', false)")
    tap("#query-tables")
    page.wait_for_function("document.documentElement.classList.contains('rs-dock-has')", timeout=10_000)
    page.evaluate("window.dataPart.run()")                             # the start text of the SQL line; the person presses Run
    page.wait_for_function("window.dataPart.result() && window.dataPart.result().rows.length > 0", timeout=120_000)
    r = page.evaluate("(() => { const r = window.dataPart.result(); return {cols: r.columns.map((c) => c.name), rows: r.rows.length}; })()")
    assert r["cols"][:3] == ["highway", "edges", "km"] and r["rows"] > 5, ("the start query", r)
    ids = page.evaluate("window.dataPart.roads(\"SELECT edge_id FROM driving.edges WHERE highway = 'primary'\").then((x) => x.length)")
    assert ids > 0, ("a query of road ids gives roads on the map", ids)
    page.screenshot(path=str(out / f"{name}-1-dock.png"))
    if phone:
        assert page.evaluate("document.documentElement.scrollWidth") <= 390, "the page with the dock is wider than the phone"

    # Ask: the key note and the examples, and one left edge for the head row and the body
    page.evaluate("window.askPart.open()")
    page.wait_for_function("window.askPart.isOpen()", timeout=10_000)
    page.locator(".rs-ask .rs-ask-q").first.wait_for(state="visible")
    assert "key" in page.inner_text(".rs-ask-need").lower(), "Ask says that it needs a key"
    head, body = page.evaluate(EDGE, ".rs-ask-who"), page.evaluate(EDGE, ".rs-ask-hint, .rs-ask .rs-ask-q")
    assert head and body and abs(head[0] - body[0]) <= 1, ("the head row and the body of Ask start at the same left edge", head, body)
    page.screenshot(path=str(out / f"{name}-2-ask.png"))
    if phone:
        assert page.evaluate("document.documentElement.scrollWidth") <= 390, "the page with Ask is wider than the phone"
    page.context.close()
    print(f"ask ({name}): the dock runs the start query ({r['rows']} rows) and finds {ids} roads; Ask has the key note and the examples, one left edge")


with sync_playwright() as p:
    browser = p.chromium.launch()
    run(browser, "desktop", viewport={"width": 1400, "height": 900})
    run(browser, "phone", viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    browser.close()
server.shutdown()
assert not errors, errors
print("ask: the data dock and Ask on a computer and on a phone; no page errors")
