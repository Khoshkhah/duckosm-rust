"""The OSM fixes of the page (card 7, docs/app.md) in headless Chromium (Playwright): build Monaco, load a fixes file, make a road rule and a
turn rule with the forms, break the YAML text and see the error, then build again and check the tables.

    python crates/duckosm-wasm/www/fixes_e2e.py [out folder]

It uses tests/data/monaco_sample.osm.pbf and tests/data/monaco.geojson. The page loads its libraries from cdn.jsdelivr.net.
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-fixes")
out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
errors = []


def rows(page, sql):
    return page.evaluate(f"window.duckApi.query({sql!r}).then((r) => r.toArray().map((x) => x.toJSON()))")


def built(page):
    page.wait_for_function("!document.getElementById('run').hasAttribute('aria-busy') && "
                           "!document.getElementById('step7-card').classList.contains('off')", timeout=600_000)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    page.evaluate("localStorage.clear()")
    assert "off" in (page.get_attribute("#step7-card", "class") or ""), "card 7 waits for the build"
    assert "after step 4" in page.inner_text("#step7-card .after")
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    page.click("#run")
    built(page)
    if "folded" in (page.get_attribute("#step7-card", "class") or ""):
        page.click("#step7")
    assert "No fixes" in page.inner_text("#fix-count")

    # a fixes file goes into the rules; the page writes the YAML again (the comment is gone), and the ids are numbers
    fixes_file = out / "start.yaml"
    fixes_file.write_text("# a comment\noverrides:\n  - osm_id: 1\n    lanes: 2\n    tags: {surface: '30'}\nturn_restrictions: []\n")
    page.set_input_files("#fixes", str(fixes_file))
    page.wait_for_function("document.getElementById('fix-count').textContent.includes('1 road rule')")
    y = page.input_value("#fix-yaml")
    assert "osm_id: 1" in y and "comment" not in y and "turn_restrictions" not in y, y
    page.click("#fix-tab-yaml")
    page.click("#fix-clear")
    page.click("#fix-tab-roads")
    assert "No fixes" in page.inner_text("#fix-count") and page.input_value("#fix-yaml") == ""

    # a road rule from the form
    way = rows(page, "SELECT osm_id FROM driving.edges WHERE lanes IS NOT NULL AND lanes != 7 AND osm_id IN (SELECT osm_id FROM walking.edges) LIMIT 1")[0]["osm_id"]
    walk_before = rows(page, f"SELECT count(*)::INTEGER AS n FROM walking.edges WHERE osm_id = {way}")[0]["n"]
    page.fill("#fix-id", str(way))
    page.click("#fix-load")
    page.wait_for_function(f"document.getElementById('fix-road').textContent.startsWith('Way {way}:')")
    assert "not in the networks" not in page.inner_text("#fix-road"), page.inner_text("#fix-road")
    page.click("#fix-save")
    assert "at least one value" in page.inner_text("#fix-yaml-err")
    page.fill("#fix-lanes", "7")
    page.fill("#fix-tags", "surface=paved, maxspeed=30")
    page.check("input[name=fix-ex][value=walking]")
    page.fill("#fix-note", "test")
    page.click("#fix-save")
    y = page.input_value("#fix-yaml")
    assert f"osm_id: {way}" in y and "lanes: 7" in y and "walking" in y and "note: test" in y, y
    assert "surface: paved" in y and "maxspeed: '30'" in y, ("the tag values are text", y)
    assert "1 road rule" in page.inner_text("#fix-count")
    # the form shows the saved rule again
    page.click("#fix-del")
    assert page.input_value("#fix-lanes") == "" and "No fixes" in page.inner_text("#fix-count")
    page.fill("#fix-lanes", "7")
    page.check("input[name=fix-ex][value=walking]")
    page.click("#fix-save")
    page.fill("#fix-lanes", "")
    page.click("#fix-load")
    page.wait_for_function("document.getElementById('fix-lanes').value === '7'")
    assert "It has a rule" in page.inner_text("#fix-road"), page.inner_text("#fix-road")

    # a key that the form does not own (keep_nodes) stays when the form saves the rule again
    page.click("#fix-tab-yaml")
    page.fill("#fix-yaml", page.input_value("#fix-yaml") + "  - osm_id: 999999999\n    keep_nodes: [1, 2]\n    layer: 1\n")
    page.click("#fix-yaml-save")
    assert "2 road rules" in page.inner_text("#fix-count"), page.inner_text("#fix-count")
    page.click("#fix-tab-roads")
    page.fill("#fix-id", "999999999")
    page.click("#fix-load")
    page.wait_for_function("document.getElementById('fix-layer').value === '1'")
    page.fill("#fix-layer", "2")
    page.click("#fix-save")
    y = page.input_value("#fix-yaml")
    assert "keep_nodes" in y and "layer: 2" in y, y
    page.click("#fix-del")
    assert "1 road rule" in page.inner_text("#fix-count")

    # a turn rule: a road that has a road leaving its end
    frm = rows(page, "SELECT a.osm_id FROM driving.edges a JOIN driving.edges b ON b.source = a.target AND b.osm_id != a.osm_id LIMIT 1")[0]["osm_id"]
    page.click("#fix-tab-turns")
    page.fill("#fix-from", str(frm))
    page.click("#fix-turn-find")
    page.wait_for_selector("#fix-out .turn")
    page.select_option("#fix-out .turn select", "no_left_turn")
    page.click("#fix-tab-yaml")
    y = page.input_value("#fix-yaml")
    assert "turn_restrictions" in y and "restriction: no_left_turn" in y and f"from_way: {frm}" in y, y
    assert "1 turn rule" in page.inner_text("#fix-count")
    page.click("#fix-tab-turns")
    assert "No left turn" in page.inner_text("#fix-turn-list")

    # a text that is not YAML: the error shows, and the rules stay
    page.click("#fix-tab-yaml")
    good = page.input_value("#fix-yaml")
    page.fill("#fix-yaml", "overrides: [")
    page.click("#fix-yaml-save")
    assert "not valid" in page.inner_text("#fix-yaml-err")
    assert "1 road rule" in page.inner_text("#fix-count")
    page.fill("#fix-yaml", "- a\n- list\n")
    page.click("#fix-yaml-save")
    assert "map of keys" in page.inner_text("#fix-yaml-err")
    page.fill("#fix-yaml", good)
    page.click("#fix-yaml-save")
    assert page.inner_text("#fix-yaml-err") == ""
    page.screenshot(path=str(out / "fixes.png"))

    # a new build with the rules: the tables have them
    page.click("#fix-apply")
    page.wait_for_function("document.getElementById('run').hasAttribute('aria-busy')", timeout=30_000)
    built(page)
    page.wait_for_function("document.getElementById('fix-why').textContent.includes('Built with these fixes')", timeout=60_000)
    lanes = rows(page, f"SELECT DISTINCT lanes FROM driving.edges WHERE osm_id = {way}")
    assert [r["lanes"] for r in lanes] == [7], lanes
    walk = rows(page, f"SELECT count(*)::INTEGER AS n FROM walking.edges WHERE osm_id = {way}")[0]["n"]
    assert walk_before > 0 and walk == 0, ("the road is out of the walking network", walk_before, walk)
    assert not page.is_hidden("#step7-card .done"), "the done mark"
    print(f"fixes_e2e.py: way {way} has 7 lanes after the build, turn rule from way {frm}; no page errors" if not errors else errors)

    browser.close()
    server.shutdown()
assert not errors, errors
