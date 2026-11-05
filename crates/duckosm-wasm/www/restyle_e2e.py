"""A theme on the same tiles (roadstyle's LiveMap.setLook, roadstyle's docs/design/restyle_without_retile.md) in headless Chromium (Playwright):
after a build of Monaco's sample, roads get live colours (rsColor), and the Design panel's theme Amber (other colours only) keeps the map's tiles:
no tile is asked for again, the road layer gets the new colours, and the live colours stay. The themes Hollow (roads 10% wider) and
Accessibility large (roads 1.8 times wider) keep the tiles too: the page's look has a buffer headroom of the widest ready theme (make_look.mjs).
A design of your own with wider roads (2.5 times) needs more buffer than the tiles have, and draws a new map.
The page reads map/look.json one time (duck.pageLookText): when the file changes while the page is open (a deploy), a theme still keeps the tiles.

    python crates/duckosm-wasm/www/restyle_e2e.py
"""
import json
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
    # map/look.json changes while the page is open (as on a deploy): after the first draw, the server sends another headroom
    look = json.loads((WWW / "map/look.json").read_text())
    changed = {"now": False}
    page.route("**/map/look.json*", lambda r: r.fulfill(status=200, content_type="application/json",
                                                         body=json.dumps(dict(look, tiles=dict(look["tiles"], buffer_headroom=2.0)) if changed["now"] else look)))
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
    changed["now"] = True
    page.click("#design-open")
    page.click("#design-tab-theme")
    assert theme(page, "light") == "same tiles", "the default look over the default map keeps the tiles, also when map/look.json changed"

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

    # one change on the map: each frame that MapLibre draws during the change has the old ground and colours, or the new ground and colours
    page.evaluate("""() => { const m = window.duckMap; window.frames = [];
      window.frameProbe = () => window.frames.push([m.getPaintProperty('bg', 'background-opacity'), JSON.stringify(m.getPaintProperty('rs-roads-simple', 'line-color'))]);
      m.on('render', window.frameProbe); }""")
    old_frame = page.evaluate("[window.duckMap.getPaintProperty('bg', 'background-opacity'), JSON.stringify(window.duckMap.getPaintProperty('rs-roads-simple', 'line-color'))]")
    assert theme(page, "hollow") == "same tiles", "Hollow's wider roads fit in the tiles' buffer: the map keeps its tiles"
    new_frame = page.evaluate("window.duckMap.off('render', window.frameProbe), [window.duckMap.getPaintProperty('bg', 'background-opacity'), JSON.stringify(window.duckMap.getPaintProperty('rs-roads-simple', 'line-color'))]")
    frames = page.evaluate("window.frames")
    assert old_frame != new_frame and old_frame[0] != new_frame[0] and old_frame[1] != new_frame[1], "Hollow changes the ground and the colours"
    mixed = [f for f in frames if f != old_frame and f != new_frame]
    assert not mixed, f"{len(mixed)} of {len(frames)} frames show a half-changed theme (the ground of one, the colours of the other)"
    assert "a new look on the same tiles, in" in page.evaluate("window.designPanel.state()"), "the Design panel tells how the map changed and the time"
    print("one change on the map:", len(frames), "frames, none half-changed")
    assert theme(page, "access") == "same tiles", "Accessibility large is the widest ready theme: the headroom covers it"
    assert page.evaluate(state, rows) == ["#ff00ff"] * len(rows), "the live colours stay"
    print("wider roads within the headroom keep the tiles: ok")
    page.click("#design-tab-roads")
    page.eval_on_selector("#design-pane [data-p='roads.width.major']", "(el) => { el.value = '2.5'; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    page.evaluate("window.designPanel.flush()")
    page.wait_for_function("!window.mapDrawing && /shows this design|could not/.test(window.designPanel.state())", timeout=300_000)
    assert page.evaluate("window.lastRestyle") == "the look needs new tiles", "roads 2.5 times wider need more buffer than the tiles have: a new map"
    assert "same tiles" not in (page.text_content("#mapnote") or "")
    print("a look that needs more buffer draws a new map: ok")
    browser.close()

assert not errors, errors
print("restyle_e2e: passed")
sys.exit(0)
