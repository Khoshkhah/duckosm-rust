"""A theme on the same tiles (roadstyle's LiveMap.setLook, roadstyle's docs/design/restyle_without_retile.md) in headless Chromium (Playwright):
after a build of Monaco's sample, roads get live colours (rsColor), and the Design panel's theme Amber (other colours only) keeps the map's tiles:
no tile is asked for again, the road layer gets the new colours, and the live colours stay. The theme Hollow (other road widths: other tile
buffers) draws a new map.

    python crates/duckosm-wasm/www/restyle_e2e.py
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
errors = []


def theme(page, t):
    page.click(f"#design-pane [data-look={t}]")
    page.evaluate("window.designPanel.flush()")
    page.wait_for_function("!window.mapDrawing && /shows this design|could not/.test(window.designPanel.state())", timeout=300_000)
    return page.evaluate("window.lastRestyle")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    page.evaluate("localStorage.clear()")
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    page.click("#run")
    page.wait_for_function("!document.getElementById('run').hasAttribute('aria-busy') && !document.getElementById('step7-card').classList.contains('off')", timeout=600_000)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    if "folded" in (page.get_attribute("#step9-card", "class") or ""):
        page.click("#step9")
    page.click("#design-open")
    page.click("#design-tab-theme")
    assert theme(page, "light") == "same tiles", "the default look over the default map keeps the tiles"

    # live colours on some roads, as rs.setData and rsColor write them (the feature state rs_c on each road's row)
    page.evaluate("window.duckMap.jumpTo({center: [7.4246, 43.7384], zoom: 15})")
    page.wait_for_function("window.duckMap.loaded() && window.duckMap.areTilesLoaded()", timeout=60_000)
    rows = page.evaluate("[...new Set(window.duckMap.querySourceFeatures('rs-roads', {sourceLayer: 'simple'}).map((f) => f.id).filter((i) => i != null))].slice(0, 10)")
    assert rows, "the map shows roads"
    page.evaluate("(rows) => window.rsColor([[rows, '#ff00ff']])", rows)
    state = "(rows) => rows.map((id) => (window.duckMap.getFeatureState({source: 'rs-roads', sourceLayer: 'simple', id}) || {}).rs_c)"
    assert page.evaluate(state, rows) == ["#ff00ff"] * len(rows), "rsColor sets the live colour"
    tiles = page.evaluate("window.duckApi.tileStats.length")
    colour = "JSON.stringify(window.duckMap.getPaintProperty('rs-roads-simple', 'line-color'))"
    before = page.evaluate(colour)

    assert theme(page, "amber") == "same tiles", "Amber changes colours only: the map keeps its tiles"
    page.wait_for_function("window.duckMap.loaded()", timeout=60_000)
    assert page.evaluate("window.duckApi.tileStats.length") == tiles, "no tile is asked for again"
    assert page.evaluate(colour) != before, "the road layer has Amber's colours"
    assert page.evaluate(state, rows) == ["#ff00ff"] * len(rows), "the live colours stay"
    assert "same tiles" in (page.text_content("#mapnote") or "")
    print("a new look on the same tiles: ok,", len(rows), "live colours kept")

    assert theme(page, "hollow") == "the look needs new tiles", "Hollow has other road widths (other tile buffers): a new map"
    assert "same tiles" not in (page.text_content("#mapnote") or "")
    print("a look with other widths draws a new map: ok")
    browser.close()

assert not errors, errors
print("restyle_e2e: passed")
sys.exit(0)
