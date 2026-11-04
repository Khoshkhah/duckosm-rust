"""The pictures of docs/dashboard.md, made in headless Chromium (Playwright): build Monaco, and take one picture of each part of the page.

    python crates/duckosm-wasm/www/docs_shots.py [out folder]        (default: docs/img/dashboard)

It uses tests/data/monaco_sample.osm.pbf and tests/data/monaco.geojson. The Search picture needs the network (photon.komoot.io), and the H3 library
comes from cdn.jsdelivr.net. Build the page first (docs/development.md, "WebAssembly"). The pictures are 1400 x 900 (a computer) or 390 x 844 (a phone).
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "docs/img/dashboard")
out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
errors = []
LAYERS = "duckMap.getStyle().layers.filter((l) => l.id.startsWith('rs-roads-simple') && l.layout?.visibility !== 'none').map((l) => l.id)"


def rows(page, sql):
    return page.evaluate(f"window.duckApi.query({sql!r}).then((r) => r.toArray().map((x) => x.toJSON()))")


def shot(page, name, selector=None, **kw):
    """a picture of an element (a card of the panel) or of the whole page"""
    path = out / f"{name}.png"
    page.wait_for_timeout(400)
    if selector:
        page.locator(selector).first.screenshot(path=str(path))
    else:
        page.screenshot(path=str(path), **kw)
    print("wrote", path.relative_to(ROOT) if path.is_relative_to(ROOT) else path)


def unfold(page, card):
    """open a card of the panel if it is folded (a click on its title: the number of the step names it)"""
    if page.evaluate(f"document.getElementById('{card}').classList.contains('folded')"):
        page.click("#" + {"extracts-box": "step3"}.get(card, card.replace("-card", "")))
        page.wait_for_timeout(300)


def at(page, lon, lat, zoom):
    page.evaluate(f"window.duckMap.jumpTo({{center: [{lon}, {lat}], zoom: {zoom}}})")
    page.wait_for_function("!window.duckMap.isMoving()")
    page.wait_for_timeout(1500)
    return page.evaluate(f"(() => {{ const p = duckMap.project([{lon}, {lat}]), c = duckMap.getCanvas().getBoundingClientRect(); return [p.x + c.left, p.y + c.top]; }})()")


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1400, "height": 900})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    page.evaluate("localStorage.clear()")
    page.evaluate("rsSetTheme('light')")

    # 1. the page at the start: the OpenFreeMap base map, the panel with the steps, the bar of tools
    page.wait_for_timeout(2500)
    shot(page, "01-start")

    # card 1: the four ways to choose an area
    unfold(page, "step1-card")
    page.fill("#q", "Monaco")
    page.keyboard.press("Enter")
    page.wait_for_selector("#found label", timeout=30_000)
    shot(page, "02-search", "#step1-card")
    page.click("#tab-draw")
    shot(page, "03-draw", "#step1-card")
    page.click("#tab-file")
    shot(page, "04-file", "#step1-card")
    page.click("#tab-h3")
    page.wait_for_function("document.getElementById('h3-level').options.length === 6")
    page.evaluate("duckMap.jumpTo({center: [7.4246, 43.7384], zoom: 13})")
    page.wait_for_timeout(2500)
    h3 = page.evaluate("""async () => { const h3 = await import('h3-js'); const c = h3.latLngToCell(43.7384, 7.4246, 8); return h3.gridDisk(c, 1).map((id) => { const [lat, lng] = h3.cellToLatLng(id); const p = duckMap.project([lng, lat]), r = duckMap.getCanvas().getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; }); }""")
    for x, y in h3:
        page.mouse.click(x, y)
        page.wait_for_timeout(250)
    shot(page, "05-h3")

    # card 2: the area (the Monaco boundary from the file tab)
    page.click("#tab-file")
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    unfold(page, "step2-card")
    shot(page, "06-area", "#step2-card")
    shot(page, "06b-area-on-map")

    # card 3 and 4: the data and the build
    page.click("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    unfold(page, "extracts-box")
    shot(page, "07-data", "#extracts-box")
    unfold(page, "step4-card")
    shot(page, "08-build-options", "#step4-card")
    page.click("#run")
    page.wait_for_function("!document.getElementById('run').hasAttribute('aria-busy') && !document.getElementById('step7-card').classList.contains('off')", timeout=600_000)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    shot(page, "09-build-done", "#step4-card")
    unfold(page, "step5-card")
    shot(page, "10-result", "#step5-card")
    unfold(page, "step6-card")
    shot(page, "11-visualization", "#step6-card")
    unfold(page, "step9-card")
    page.set_viewport_size({"width": 1400, "height": 1250})      # the card is taller than the panel
    shot(page, "11b-export", "#step9-card")
    page.set_viewport_size({"width": 1400, "height": 900})
    shot(page, "12-map-after-build")

    # the bar of tools and the base-map box
    page.evaluate("duckMap.jumpTo({center: [7.4246, 43.7384], zoom: 15})")
    page.wait_for_timeout(2000)
    shot(page, "13-bar", None, clip={"x": 1100, "y": 0, "width": 300, "height": 700})
    page.click("#rs-toolbar .bm-ctrl .bm-icon")
    shot(page, "14-base-map-box")
    page.keyboard.press("Escape")

    # the dark theme
    page.evaluate("rsSetTheme('dark')")
    page.wait_for_timeout(2500)
    shot(page, "15-dark")
    page.evaluate("rsSetTheme('light')")

    # card 7: the Fix OSM data panel, one picture for each tab
    unfold(page, "step7-card")
    shot(page, "16-fix-card", "#step7-card")
    page.click("#fix-open")
    page.wait_for_selector("#fix-panel", state="visible")
    point = page.evaluate("""() => { const m = window.duckMap, c = m.getCanvas().getBoundingClientRect(), L = %s;
        for (const f of m.queryRenderedFeatures({layers: L})) { const g = f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates[0];
          const q = m.project(g[Math.floor(g.length / 2)]), hit = m.queryRenderedFeatures(q, {layers: L})[0];
          if (hit && q.x > 440 && q.x < c.width - 100 && q.y > 60 && q.y < c.height - 80) return [q.x + c.left, q.y + c.top]; }
        return null; }""" % LAYERS)
    page.mouse.click(*point)
    page.wait_for_function("document.getElementById('fix-id').value !== ''", timeout=20_000)
    page.wait_for_timeout(800)
    shot(page, "17-fix-road")
    page.click("#fix-tab-building")
    b = rows(page, "SELECT osm_id, ST_X(ST_PointOnSurface(geom)) AS x, ST_Y(ST_PointOnSurface(geom)) AS y FROM features.buildings WHERE osm_type = 'way' AND ST_Area(geom) BETWEEN 0.000000008 AND 0.000000015 ORDER BY osm_id LIMIT 1")[0]
    px = at(page, b["x"], b["y"], 18)
    page.mouse.click(*px)
    page.wait_for_function(f"document.getElementById('fix-id').value === '{b['osm_id']}'", timeout=20_000)
    page.wait_for_timeout(2000)
    shot(page, "18-fix-building")
    page.click("#fix-tab-node")
    j = rows(page, "SELECT n.node_id AS id, ST_X(n.geom) AS x, ST_Y(n.geom) AS y FROM driving.nodes n WHERE n.node_id IN (SELECT nid FROM (SELECT source AS nid, target AS o FROM driving.edges UNION ALL SELECT target, source FROM driving.edges) GROUP BY nid HAVING count(DISTINCT o) >= 3) "
                  "AND n.node_id NOT IN (SELECT osm_id FROM features.traffic) LIMIT 1")[0]
    px = at(page, j["x"], j["y"], 17)
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['fix-nodes-pt']}).length > 0", timeout=20_000)
    page.evaluate(f"window.fixesPanel.select('node', 'node', {j['id']})")
    page.wait_for_function(f"document.getElementById('fix-id').value === '{j['id']}' && document.querySelector('#fixf-highway')", timeout=20_000)
    page.select_option("#fixf-highway", "traffic_signals")
    page.wait_for_timeout(800)
    shot(page, "19-fix-node")
    page.click("#fix-tab-turns")
    road = rows(page, "SELECT e.osm_id FROM driving.edges e WHERE e.target IN (SELECT source FROM driving.edges GROUP BY source HAVING count(DISTINCT osm_id) >= 3) LIMIT 1")[0]["osm_id"]
    page.fill("#fix-from", str(road))
    page.click("#fix-turn-find")
    page.wait_for_selector("#fix-out .turn")
    page.wait_for_timeout(2000)
    shot(page, "20-fix-turn")
    page.click("#fix-tab-new")
    page.wait_for_timeout(500)
    shot(page, "21-fix-new-road")
    page.click("#fix-tab-changes")
    page.wait_for_timeout(500)
    shot(page, "22-fix-changes")
    page.click("#fix-hide")
    page.wait_for_timeout(800)
    shot(page, "23-fix-panel-hidden")
    page.click("#sb-show")
    page.click("#fix-back")

    # the card "Your areas": the built area is saved, a new visit lists it
    page2 = ctx.new_page()
    page2.on("pageerror", lambda e: errors.append(str(e)))
    page2.goto(url)
    page2.wait_for_function("window.mapReady", timeout=120_000)
    page2.wait_for_selector("#areas-card .saved-area", timeout=30_000)
    page2.wait_for_timeout(1500)
    page2.locator("#areas-card .saved-area strong").first.click()
    page2.wait_for_timeout(2000)
    shot(page2, "24-your-areas")
    page2.close()
    page.close()

    # a phone
    phone = browser.new_context(**p.devices["iPhone 13"]).new_page()
    phone.on("pageerror", lambda e: errors.append(str(e)))
    phone.goto(url)
    phone.wait_for_function("window.mapReady", timeout=120_000)
    phone.wait_for_timeout(2500)
    shot(phone, "25-phone")
    browser.close()

assert not errors, errors
print("ok")
