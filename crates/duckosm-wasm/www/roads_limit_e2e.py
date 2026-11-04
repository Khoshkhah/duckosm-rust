"""The limit of the map (docs/app.md, "On a phone"): with ?maxroads=5000 the page says that a browser page draws at most 5,000 roads, lists the networks that fit,
and does not say "∞". Monaco: all networks 13,298 roads.

    python crates/duckosm-wasm/www/roads_limit_e2e.py
"""
import pathlib

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
server = start(0, quiet=True, directory=WWW)
base = f"http://127.0.0.1:{server.server_address[1]}/index.html"
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "?maxroads=5000")
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    page.click("#run")
    page.wait_for_function("!document.getElementById('run').hasAttribute('aria-busy') && !document.getElementById('step7-card').classList.contains('off')", timeout=600_000)
    page.wait_for_function("document.getElementById('mapnote').textContent.includes('draws at most')", timeout=120_000)
    note = page.inner_text("#mapnote")
    assert "draws at most 5,000 roads" in note and "∞" not in note and "Choose one network" in note and "SQL and the downloads work" in note, note
    print("the limit says what it is:", note)
    # a page with no parameter: a desktop page has the limit of the engine
    assert page.evaluate("window.mapMaxRoads") == 5000
    page.goto(base)
    page.wait_for_function("window.mapReady", timeout=120_000)
    assert page.evaluate("window.mapMaxRoads") == 200000, page.evaluate("window.mapMaxRoads")
    browser.close()
assert not errors, errors
print("roads_limit_e2e.py: passed")
