"""The pictures of the manual (docs/dashboard.md and docs/manual/*.md), made in headless Chromium (Playwright): build Monaco, and take one picture of each part of the page.

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


def trim_bottom(path):
    """cut the empty rows at the bottom of a picture of a card that is shorter than its box (needs Pillow and numpy; else the picture stays)"""
    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        return
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(int)
    rows = np.where((abs(a - a[-1, -1]).sum(axis=2) > 12).any(axis=1))[0]
    if len(rows) and rows.max() + 12 < im.height:
        im.crop((0, 0, im.width, int(rows.max()) + 12)).save(path)


def shot(page, name, selector=None, **kw):
    """a picture of an element (a card of the panel) or of the whole page"""
    path = out / f"{name}.png"
    page.wait_for_timeout(400)
    if selector:
        # a picture of one card: no scroll fade of the panel at its edges (the fade is a hint that more is above or below, not part of the card)
        page.evaluate("document.querySelectorAll('#sb .sb-body').forEach((b) => b.style.setProperty('mask-image', 'none') || b.style.setProperty('-webkit-mask-image', 'none'))")
        page.locator(selector).first.screenshot(path=str(path))
        page.evaluate("document.querySelectorAll('#sb .sb-body').forEach((b) => { b.style.removeProperty('mask-image'); b.style.removeProperty('-webkit-mask-image'); })")
        trim_bottom(path)
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
    page.set_viewport_size({"width": 1400, "height": 1000})       # all ten cards: at 900 the card Export was cut
    page.wait_for_timeout(1000)
    shot(page, "01-start")
    page.set_viewport_size({"width": 1400, "height": 900})

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
    page.click("#tab-overpass")
    shot(page, "39-overpass", "#extracts-box")
    page.click("#tab-region")
    unfold(page, "step4-card")
    shot(page, "08-build-options", "#step4-card")
    page.click("#run")
    page.wait_for_function("!document.getElementById('run').hasAttribute('aria-busy') && !document.getElementById('step7-card').classList.contains('off')", timeout=600_000)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    shot(page, "09-build-done", "#step4-card")
    # the roads in roadstyle's theme High saturation (Kaveh): the pictures of the map show its strong colors
    page.click("#step9")
    page.wait_for_selector("#design-panel", state="visible")
    page.click("#design-pane [data-look=highsat]")
    page.evaluate("window.designPanel.flush()")
    page.wait_for_function("!window.mapDrawing && /shows this design/.test(window.designPanel.state())", timeout=180_000)
    page.click("#design-back")
    unfold(page, "step5-card")
    shot(page, "10-result", "#step5-card")
    page.click("#files-box summary")                                   # the list scrolls in the picture, as on the page (Kaveh: the full list was too tall)
    shot(page, "38-each-table", "#files-box")
    page.click("#files-box summary")
    unfold(page, "step6-card")
    shot(page, "11-visualization", "#step6-card")
    unfold(page, "step10-card")
    page.evaluate("document.getElementById('step10-card').scrollIntoView({block: 'start'})")   # the window with the top of the card; the card scrolls in the panel
    shot(page, "11b-export")
    with page.expect_download(timeout=120_000) as d:                   # a file that the card made: the map image (SVG)
        page.click("#export-list [data-fmt=svg]")
    d.value.save_as(out / "40-export-map.svg")
    print("wrote", out / "40-export-map.svg")
    page.set_viewport_size({"width": 1400, "height": 900})
    page.evaluate("rs.sections.fold('step10', true); document.getElementById('step5-card').scrollIntoView({block: 'start'})")   # the panel shows steps 5 and 6, not the card Export
    page.evaluate("duckMap.jumpTo({center: [7.4246, 43.7384], zoom: 15, pitch: 55, bearing: -20})")   # the map tilted, the buildings in 3D (Kaveh)
    page.evaluate("""() => { const b = [...document.querySelectorAll('#rs-toolbar button')].find((x) => /buildings/i.test(x.title || x.getAttribute('aria-label') || ''));
        if (b && !b.disabled && !b.classList.contains('rs-on')) b.click(); }""")
    page.wait_for_function("!window.duckMap.isMoving() && window.duckMap.loaded()")
    page.wait_for_timeout(2500)
    shot(page, "12-map-after-build")

    # the bar of tools and the base-map box
    page.evaluate("duckMap.jumpTo({center: [7.4246, 43.7384], zoom: 15.5, padding: {left: 900}})")   # Monaco's roads just left of the bar
    page.wait_for_function("!window.duckMap.isMoving()")
    page.wait_for_timeout(2500)
    bar = page.locator("#rs-toolbar").bounding_box()                  # the bar with 220 px of the map at its left, 20 px above and under it
    x, top = bar["x"] - 220, max(0, bar["y"] - 20)
    shot(page, "13-bar", None, clip={"x": x, "y": top, "width": 1400 - x, "height": min(900 - top, bar["height"] + 40)})
    page.evaluate("duckMap.jumpTo({center: [7.4246, 43.7384], zoom: 15, padding: {left: 0}, pitch: 55, bearing: -20})")
    page.click("#rs-toolbar .bm-ctrl .bm-icon")
    shot(page, "14-base-map-box")
    page.keyboard.press("Escape")

    # the dark theme
    page.evaluate("rsSetTheme('dark')")
    page.wait_for_timeout(2500)
    shot(page, "15-dark")
    page.evaluate("rsSetTheme('light')")

    # Ask and the data dock (manual/ask.md): Query the tables in card 5, the table and the chart of its start query, and Ask
    page.evaluate("duckMap.jumpTo({center: [7.4246, 43.7384], zoom: 14.5, pitch: 0, bearing: 0})")
    page.evaluate("rs.sections.fold('step5', false)")
    page.click("#query-tables")
    page.evaluate("window.dataPart.run()")
    page.wait_for_function("window.dataPart.result() && window.dataPart.result().rows.length > 0", timeout=120_000)
    page.wait_for_timeout(2000)
    shot(page, "41-dock-table")
    page.evaluate("window.dataPart.view('chart')")
    page.wait_for_timeout(2000)
    shot(page, "42-dock-chart")
    page.evaluate("window.askPart.open()")
    page.locator(".rs-ask .rs-chip").first.wait_for(state="visible")
    page.wait_for_timeout(1000)
    shot(page, "43-ask")
    page.evaluate("window.askPart.close(); window.dataPart.view('table'); window.dataPart.close()")
    page.wait_for_timeout(800)

    # card 7: the Edit OSM data panel, one picture for each tab
    unfold(page, "step7-card")
    page.evaluate("duckMap.jumpTo({pitch: 0, bearing: 0})")                    # the editors from straight above: they show exact objects
    shot(page, "16-fix-card", "#step7-card")
    page.click("#step7")
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
    page.click("#sb-hide")
    page.wait_for_timeout(800)
    shot(page, "23-fix-panel-hidden")
    page.click("#sb-show")                                              # the hide button closed the editor first: the panel shows the steps

    # card 8: the level editor with two joined roads picked (road 1 red, road 2 blue)
    page.click("#step8")
    page.wait_for_function("window.levelEditorOpen", timeout=300_000)
    page.evaluate("duckMap.jumpTo({center: [7.4246, 43.7384], zoom: 16, pitch: 0})")
    page.wait_for_function("window.duckMap.loaded()", timeout=120_000)
    page.wait_for_timeout(1500)
    pair = page.evaluate("""() => { const m = window.duckMap, c = m.getCanvas().getBoundingClientRect(), L = %s, key = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6), items = [];
        for (const f of m.queryRenderedFeatures({layers: L})) { if (f.geometry.type !== 'LineString') continue; const g = f.geometry.coordinates, q = m.project(g[Math.floor(g.length / 2)]);
          if (q.x > 440 && q.x < c.width - 100 && q.y > 60 && q.y < c.height - 80 && m.queryRenderedFeatures(q, {layers: L})[0]) items.push({q, ends: [key(g[0]), key(g[g.length - 1])]}); }
        for (const a of items) for (const b of items) if (a !== b && a.ends.some((e) => b.ends.includes(e)) && Math.hypot(a.q.x - b.q.x, a.q.y - b.q.y) > 40) return [[a.q.x + c.left, a.q.y + c.top], [b.q.x + c.left, b.q.y + c.top]];
        return null; }""" % LAYERS)
    assert pair, "two roads that join, in the free part of the map"
    for x, y in pair:
        page.mouse.click(x, y)
        page.wait_for_timeout(1200)
    page.wait_for_selector("#lv-cards .card, #lv-cards [data-hroad]", timeout=10_000)
    shot(page, "36-levels-editor")
    page.click("#lv-back")
    page.wait_for_function("!window.levelEditorOpen && !window.mapDrawing && window.duckMap.loaded()", timeout=300_000)

    # card 9: the Design panel, one picture for each tab, and the map in the Dark theme
    unfold(page, "step9-card")
    shot(page, "26-design-card", "#step9-card")
    page.click("#step9")
    page.wait_for_selector("#design-panel", state="visible")
    shot(page, "27-design-theme")                                      # the first themes; the list scrolls in the panel
    page.click("#design-tab-roads")
    shot(page, "28-design-roads")
    page.click("#design-tab-text")
    shot(page, "29-design-text")
    page.click("#design-tab-layers")
    shot(page, "30-design-layers")
    page.click("#design-tab-tiles")
    shot(page, "31-design-tiles")
    page.click("#design-tab-theme")
    page.click("#design-pane [data-look=dark]")
    page.evaluate("window.designPanel.flush()")
    page.wait_for_function("!window.mapDrawing && /shows this design/.test(window.designPanel.state())", timeout=180_000)
    page.wait_for_timeout(2500)
    shot(page, "32-design-dark-map")
    # the roads overlay on the satellite base map (the picture needs the network for the satellite tiles)
    page.click("#design-pane [data-look=overlay]")
    page.evaluate("window.designPanel.flush()")
    page.wait_for_function("!window.mapDrawing && /shows this design/.test(window.designPanel.state())", timeout=180_000)
    page.evaluate("window.rsSetBasemap('satellite')")
    page.wait_for_timeout(5000)
    shot(page, "33-design-overlay")
    page.click("#design-pane [data-look=ghost]")                  # the roads ghost on the satellite map
    page.evaluate("window.designPanel.flush()")
    page.wait_for_function("!window.mapDrawing && /shows this design/.test(window.designPanel.state())", timeout=180_000)
    page.wait_for_timeout(2500)
    shot(page, "35-design-ghost")
    page.evaluate("window.rsSetBasemap('blank')")
    page.evaluate("rsSetTheme('light')")                           # the satellite map turned the page dark
    page.click("#design-pane [data-look=light]")
    page.evaluate("window.designPanel.flush()")
    page.wait_for_function("!window.mapDrawing && /shows this design/.test(window.designPanel.state())", timeout=180_000)
    # Your themes: change a ready theme, save it under a name, and show the Theme tab with the card
    page.click("#design-pane [data-look=print]")
    page.click("#design-tab-text")
    page.eval_on_selector("[data-p='labels.color']", "(el) => { el.value = '#7a1f1f'; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    page.click("#design-tab-theme")
    page.fill("#mine-name", "My print")
    page.click("#mine-save")
    page.evaluate("window.designPanel.flush()")
    page.wait_for_function("!window.mapDrawing && /shows this design/.test(window.designPanel.state())", timeout=180_000)
    page.wait_for_timeout(1500)
    page.evaluate("document.querySelector('#design-pane .fix-group, #design-pane #mine-list').scrollIntoView()")
    shot(page, "34-design-your-themes")
    page.click("#design-pane [data-look=highsat]")
    page.evaluate("window.designPanel.flush()")
    page.wait_for_function("!window.mapDrawing && /shows this design/.test(window.designPanel.state())", timeout=180_000)
    page.click("#design-back")
    page.evaluate("localStorage.removeItem('duckosm.themes')")
    page.evaluate("localStorage.removeItem('duckosm.design')")        # the next visit (below) starts with the Light design

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
