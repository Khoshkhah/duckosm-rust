"""The OSM fixes of the page (card 7, docs/app.md, docs/osm-editing.md) in headless Chromium (Playwright): build Monaco with the layers, open the panel,
pick a road, a building and a node with real clicks (the form has the data of the object, and no popup shows), change them with the preset fields,
add a turn rule, look at the list of changes (undo, select, delete), build again, and check the tables.

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
ROAD = 503462470          # a secondary road of the sample: the walking network has it as shared_road
LAYERS = "duckMap.getStyle().layers.filter((l) => l.id.startsWith('rs-roads-simple') && l.layout?.visibility !== 'none').map((l) => l.id)"


def rows(page, sql):
    return page.evaluate(f"window.duckApi.query({sql!r}).then((r) => r.toArray().map((x) => x.toJSON()))")


def built(page):
    page.wait_for_function("!document.getElementById('run').hasAttribute('aria-busy') && "
                           "!document.getElementById('step7-card').classList.contains('off')", timeout=600_000)


def text(page):
    return page.evaluate("window.fixesPanel.text() ?? ''")


def amber(page):
    return page.evaluate("window.fixesPanel.drawn().edits")


def at(page, lon, lat):
    """Move the map to the point and give the pixel of the point on the page."""
    page.evaluate(f"window.duckMap.jumpTo({{center: [{lon}, {lat}], zoom: 18}})")
    page.wait_for_function("!window.duckMap.isMoving()")
    page.wait_for_timeout(1200)
    return page.evaluate(f"(() => {{ const p = duckMap.project([{lon}, {lat}]), c = duckMap.getCanvas().getBoundingClientRect(); return [p.x + c.left, p.y + c.top]; }})()")


def popups(page):
    return page.evaluate("document.querySelectorAll('.maplibregl-popup:not(.rs-tip)').length")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: "fixes panel" in m.text and print(m.text[:300]))
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    page.evaluate("localStorage.clear()")
    assert "off" in (page.get_attribute("#step7-card", "class") or "") and "after step 4" in page.inner_text("#step7-card .after")
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    page.click("#run")
    built(page)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    if "folded" in (page.get_attribute("#step7-card", "class") or ""):
        page.click("#step7")
    assert "No fixes" in page.inner_text("#fix-sum")

    # the panel is the page's one panel; ← Steps brings the steps back
    page.click("#fix-open")
    assert page.is_visible("#fix-panel") and not page.is_visible("#sb .sb-body") and not page.is_visible("#sb .sb-foot")
    page.click("#fix-back")
    assert not page.is_visible("#fix-panel") and page.is_visible("#sb .sb-body")
    page.click("#fix-open")
    assert all(page.is_visible(f"#fix-tab-{t}") for t in ("road", "building", "node", "turns", "new", "changes")), "the six tabs"
    assert page.get_attribute("#fix-tab-road", "aria-selected") == "true", "the panel opens on the Road tab"
    # the panel hides (the map takes its place) and the button at the corner shows it again, with the tab and the picks as they were
    page.click("#fix-hide")
    page.wait_for_function("document.getElementById('sb').classList.contains('hidden')")
    assert page.is_visible("#sb-show") and page.evaluate("document.body.classList.contains('editing-fixes')")
    page.click("#sb-show")
    page.wait_for_function("!document.getElementById('sb').classList.contains('hidden')")
    assert page.is_visible("#fix-panel") and page.get_attribute("#fix-tab-road", "aria-selected") == "true"
    assert not page.is_visible("#fix-walls-all"), "the walls check box is only in the Building tab"

    # a click on a road: the form has the data of the road, all its tags are listed, and no popup shows
    point = page.evaluate("""() => { const m = window.duckMap, c = m.getCanvas().getBoundingClientRect(), L = %s;
        for (const f of m.queryRenderedFeatures({layers: L})) { const g = f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates[0];
          const p = m.project(g[Math.floor(g.length / 2)]), hit = m.queryRenderedFeatures(p, {layers: L})[0];
          if (hit && p.x > 440 && p.x < c.width - 100 && p.y > 60 && p.y < c.height - 80) return [p.x + c.left, p.y + c.top]; }
        return null; }""" % LAYERS)
    assert point, "a road on the map"
    page.mouse.move(*point)
    page.mouse.click(*point)
    page.wait_for_function("document.getElementById('fix-id').value !== '' && document.querySelector('#fix-obj .objhead') && document.querySelector('#fix-form select')", timeout=20_000)
    page.wait_for_timeout(700)
    clicked = int(page.input_value("#fix-id"))
    assert popups(page) == 0, "no popup in the fixes panel"
    assert "Road way" in page.inner_text("#fix-obj .objhead"), page.inner_text("#fix-obj")
    n_tags = int(page.inner_text("#fix-obj .alltags summary").split("(")[1].split(")")[0])
    assert n_tags >= 2, ("all the tags of the road are listed", n_tags)
    edges = rows(page, f"SELECT any_value(lanes)::INTEGER AS lanes, bool_or(oneway) AS oneway FROM driving.edges WHERE osm_id = {clicked}")[0]
    if edges["lanes"] is not None:
        assert page.input_value("#fixf-lanes") == str(edges["lanes"]), ("the form starts with the data", page.input_value("#fixf-lanes"), edges)
    assert page.input_value("#fixf-oneway") == str(bool(edges["oneway"])).lower(), "the one-way field has the data"
    print(f"a click on a road: way {clicked}, {n_tags} tags, the form has the data (lanes {edges['lanes']}), no popup")
    page.evaluate("window.rsDeselect?.()")

    # a road rule with preset fields: lanes (a key of the rule), sidewalk and surface (tags)
    page.fill("#fix-id", str(ROAD))
    page.click("#fix-load")
    page.wait_for_function(f"document.querySelector('#fix-obj .objhead')?.textContent.includes('way {ROAD}') && document.querySelector('#fixf-sidewalk')", timeout=20_000)
    assert page.input_value("#fixf-sidewalk") == "", "no sidewalk tag in the data"
    page.select_option("#fixf-sidewalk", "both")
    page.select_option("#fixf-surface", "paved")
    page.fill("#fixf-lanes", "7")
    # guards: a one-way road closes the forward and backward lanes (with the reason under them); a choice that opens them again takes the guard away; a bridge closes the tunnel list
    page.select_option("#fixf-oneway", "true")
    assert page.is_disabled("#fixf-lanes_forward") and page.is_disabled("#fixf-lanes_backward") and "one direction" in page.inner_text("#fix-form"), "a one-way road closes the lanes for each direction"
    assert page.input_value("#fixf-lanes") == "7", "the guard keeps the other fields"
    page.select_option("#fixf-oneway", "false")
    assert not page.is_disabled("#fixf-lanes_forward"), "a two-way road opens them"
    page.select_option("#fixf-bridge", "yes")
    assert page.is_disabled("#fixf-tunnel") and "bridge or a tunnel" in page.inner_text("#fix-form")
    page.select_option("#fixf-bridge", "")
    assert not page.is_disabled("#fixf-tunnel")
    page.click("#fix-save")
    y = text(page)
    assert f"id: {ROAD}" in y and "sidewalk: both" in y and "surface: paved" in y and "tag_edits" in y and "lanes: 7" in y, y
    assert page.inner_text("#fix-n") == "1" and "1 change" in page.inner_text("#fix-apply-n")
    page.wait_for_function("window.fixesPanel.drawn().edits > 0", timeout=20_000)
    print("a road rule: lanes in the rule, sidewalk and surface in extra.tag_edits; the road is in the amber layer")
    # the label of an edited field shows the mark, and Reset form takes the edit out of the form
    assert "edited" in (page.get_attribute("label[for=fixf-sidewalk]", "class") or "")
    page.fill("#fixf-lanes", "9")
    page.click("#fix-revert")
    assert page.input_value("#fixf-lanes") == "7", "Reset form: the form shows the saved rule again"

    # the tabs are real: the Building tab has no road form, and the Road tab keeps its road, form and rule
    page.evaluate("window.__desel = 0; const o = window.rsDeselect; window.rsDeselect = (...a) => { window.__desel++; return o?.(...a); }")
    page.click("#fix-tab-building")
    assert page.evaluate("window.__desel") >= 1, "a switch of tab clears roadstyle's selection on the map"
    assert page.is_visible("#fix-walls-all") and page.locator("#fixf-lanes").count() == 0 and "Nothing is picked" in page.inner_text("#fix-obj"), page.inner_text("#fix-obj")
    assert page.is_visible("#fixf-roof_shape") is False and page.input_value("#fix-id") == ""
    page.wait_for_function("window.fixesPanel.drawn().sel === 0", timeout=10_000)             # the Building tab has nothing picked, so nothing is blue
    page.click("#fix-tab-road")
    assert page.input_value("#fix-id") == str(ROAD) and page.input_value("#fixf-lanes") == "7", "the Road tab keeps its road"
    page.click("#fix-tab-road")
    page.wait_for_function("window.fixesPanel.drawn().sel > 0", timeout=20_000)
    pt = rows(page, f"SELECT ST_X(ST_PointOnSurface(ST_Union_Agg(geometry))) AS x, ST_Y(ST_PointOnSurface(ST_Union_Agg(geometry))) AS y FROM driving.edges WHERE osm_id = {ROAD}")[0]
    page.wait_for_function("!window.duckMap.isMoving()")
    assert page.evaluate(f"window.duckMap.getBounds().contains([{pt['x']}, {pt['y']}])"), "a switch to the Road tab shows its road on the map"
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['fix-sel-line']}).length > 0", timeout=20_000)     # the blue road is drawn, not only counted
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['fix-edits-line']}).length > 0", timeout=20_000)   # and the amber one (the rule of the road)
    print("the tabs: Building has its own empty form, Road keeps its road and its rule, and the map shows the road of the tab")
    # Unselect takes the road out of the tab (the form, the id and the blue road), and Load picks it again
    assert page.is_visible("#fix-unselect")
    page.click("#fix-unselect")
    assert page.locator("#fixf-lanes").count() == 0 and page.input_value("#fix-id") == "" and not page.is_visible("#fix-unselect")
    page.wait_for_function("window.fixesPanel.drawn().sel === 0", timeout=10_000)
    page.fill("#fix-id", str(ROAD)); page.click("#fix-load")
    page.wait_for_function(f"document.querySelector('#fix-obj .objhead')?.textContent.includes('way {ROAD}') && document.querySelector('#fixf-lanes')?.value === '7'", timeout=20_000)
    print("Unselect: the road goes out of the tab, and Load brings it back")
    # leaving the panel (← Steps) unselects everything on the map; the tabs keep their objects, and the blue comes back when the panel opens
    page.wait_for_function("window.fixesPanel.drawn().sel > 0", timeout=20_000)
    page.evaluate("window.__desel = 0")
    page.click("#fix-back")
    assert page.evaluate("window.__desel") >= 1, "closing the panel clears roadstyle's selection"
    page.wait_for_function("window.fixesPanel.drawn().sel === 0 && window.fixesPanel.drawn().faces === 0 && window.fixesPanel.drawn().nodes === 0", timeout=10_000)
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['fix-sel-line', 'fix-sel-fill', 'fix-sel-pt']}).length === 0", timeout=10_000)      # the map draws again after the data goes
    page.click("#fix-open")
    page.wait_for_function("window.fixesPanel.drawn().sel > 0", timeout=20_000)
    print("← Steps unselects everything on the map, and the panel shows the picked road again when it opens")

    # a click on a building in the Road or the Turn tab picks no road: roadstyle takes the nearest road for a click within a few pixels, and the panel ignores it on a building
    near = rows(page, "SELECT ST_X(ST_ClosestPoint(b.geom, e.geometry)) * 0.9 + ST_X(ST_PointOnSurface(b.geom)) * 0.1 AS x, ST_Y(ST_ClosestPoint(b.geom, e.geometry)) * 0.9 + ST_Y(ST_PointOnSurface(b.geom)) * 0.1 AS y "
                       "FROM features.buildings b, driving.edges e WHERE b.osm_type = 'way' AND ST_Distance(b.geom, e.geometry) < 0.00003 ORDER BY ST_Area(b.geom) DESC LIMIT 1")[0]
    px = at(page, near["x"], near["y"])
    before = page.input_value("#fix-id")
    page.mouse.click(*px)
    page.wait_for_timeout(1500)
    assert page.input_value("#fix-id") == before, ("a click on a building picked a road in the Road tab", before, page.input_value("#fix-id"))
    page.click("#fix-tab-turns")
    px = at(page, near["x"], near["y"])
    page.mouse.click(*px)
    page.wait_for_timeout(1500)
    assert page.input_value("#fix-from") == "" and page.evaluate("document.getElementById('fix-turnsec').hidden"), "a click on a building picked a junction in the Turn tab"
    page.click("#fix-tab-road")
    print("a click on a building in the Road or the Turn tab picks no road and no junction")

    # a building: its tab, a real click, the preset fields (floors, roof shape, roof color)
    page.click("#fix-tab-building")
    b = rows(page, "SELECT osm_id, ST_X(ST_PointOnSurface(geom)) AS x, ST_Y(ST_PointOnSurface(geom)) AS y FROM features.buildings WHERE osm_type = 'way' "
                   "AND map_extract(tags, 'building:levels')[1] IS NULL ORDER BY ST_Area(geom) DESC LIMIT 1")[0]
    px = at(page, b["x"], b["y"])
    page.mouse.click(*px)
    page.wait_for_function(f"document.getElementById('fix-id').value === '{b['osm_id']}' && document.querySelector('#fixf-building_levels')", timeout=20_000)
    page.wait_for_timeout(500)
    assert popups(page) == 0 and "Building way" in page.inner_text("#fix-obj .objhead"), page.inner_text("#fix-obj")
    page.fill("#fixf-building_levels", "7")
    page.select_option("#fixf-roof_shape", "gabled")
    page.fill("#fixf-roof_colour", "#cc3300")
    page.click("#fix-save")
    y = text(page)
    assert "type: way" in y and "building:levels: '7'" in y and "roof:shape: gabled" in y and "roof:colour: '#cc3300'" in y, y
    page.wait_for_function("window.fixesPanel.drawn().heights.length > 0", timeout=20_000)
    assert 22.4 in page.evaluate("window.fixesPanel.drawn().heights"), ("7 floors are 22.4 m in the 3D preview", page.evaluate("window.fixesPanel.drawn().heights"))
    print(f"a building: way {b['osm_id']}, floors 7 (3D preview 22.4 m), roof gabled, roof color #cc3300")

    # a table of an older build (a saved area) has no column `door`: the walls still show
    page.evaluate("window.duckApi.query('ALTER TABLE main.building_faces DROP COLUMN door')")
    page.evaluate(f"window.fixesPanel.select('building', 'way', {b['osm_id']})")
    # the walls of the building: a list with a type for each wall (from main.building_faces), colored on the map; a change of type is a rule at once
    page.wait_for_function("document.querySelectorAll('#fix-form .wallrow').length >= 3", timeout=20_000)
    assert page.evaluate("window.fixesPanel.drawn().faces") >= 3, "the walls of the building are drawn"
    assert page.evaluate("document.querySelectorAll('#fix-form .wallrow .sw').length === document.querySelectorAll('#fix-form .wallrow').length"), "each wall row has the color of its type"
    page.wait_for_function("duckMap.querySourceFeatures('fix-faces').filter((f) => f.properties.n).length >= 3", timeout=20_000)     # the numbers of the walls on the map, as in the list (#1, #2, ...)
    assert page.evaluate("duckMap.getLayer('fix-faces-label').layout.get ? true : !!duckMap.getLayer('fix-faces-label')")
    wall = page.evaluate("(() => { const r = document.querySelector('#fix-form .wallrow'); return [r.dataset.a, r.dataset.b, r.dataset.computed]; })()")
    new_type = "party" if wall[2] != "party" else "side"
    page.select_option("#fix-form .wallrow select", new_type)
    assert "building_faces" not in text(page) and not page.is_disabled("#fix-save") and "1 change not added yet" in page.inner_text("#fix-state"), "a wall type waits for Add to changes"
    page.click("#fix-save")
    y = text(page)
    assert "building_faces" in y and f"type: {new_type}" in y and f"building: {b['osm_id']}" in y, y
    assert "edited" in (page.get_attribute("#fix-form .wallrow", "class") or "")
    print(f"a wall: nodes {wall[0]} and {wall[1]} were {wall[2]}, now {new_type}")
    # a door on a wall: a select in the row, a draft until Add to changes, then a rule with `door` (the type stays), a dot on the map, and the text in the Changes tab
    page.select_option("#fix-form .wallrow >> nth=0 >> select[data-walldoor]", "main")
    assert "door: main" not in text(page) and not page.is_disabled("#fix-save"), "a door waits for Add to changes"
    page.click("#fix-save")
    y = text(page)
    assert "door: main" in y and f"type: {new_type}" in y, y
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['fix-faces-door']}).length === 1", timeout=20_000)
    assert page.input_value("#fix-form .wallrow >> nth=0 >> select[data-walldoor]") == "main"
    print(f"a door on the wall: nodes {wall[0]} and {wall[1]} have a main door, the type {new_type} stays, and a dot shows on the map")

    # a building that is a multipolygon relation: its outer ring has walls like a way, and its courtyard has `court` walls
    rel = rows(page, "SELECT building_id FROM main.building_faces WHERE building_type = 'relation' AND face_type = 'court' LIMIT 1")
    assert rel, "Monaco has a building with a courtyard"
    page.evaluate(f"window.fixesPanel.select('building', 'relation', {rel[0]['building_id']})")
    page.wait_for_function("document.querySelectorAll('#fix-form .wallrow').length >= 5", timeout=20_000)
    assert page.evaluate("[...document.querySelectorAll('#fix-form .wallrow select[data-wall]')].some((s) => s.value === 'court')"), "the courtyard walls have the type court"
    page.evaluate(f"window.fixesPanel.select('building', 'way', {b['osm_id']})")
    page.wait_for_function("document.querySelectorAll('#fix-form .wallrow').length >= 3", timeout=20_000)
    print(f"a building that is a relation ({rel[0]['building_id']}): walls with court walls for the courtyard")

    # select each wall: a row of the list, the bar (Next, Previous, Unselect), and a click on the wall on the map
    assert "No wall is selected" in page.inner_text("#fix-wallpos")
    page.click("#fix-form .wallrow >> nth=1 >> .small")
    assert "Wall 2 of" in page.inner_text("#fix-wallpos") and page.locator("#fix-form .wallrow.sel").count() == 1
    page.wait_for_function("!duckMap.isMoving()")
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['fix-faces-sel']}).length > 0", timeout=20_000)     # the selected wall has its outline on the map
    page.click("[data-wall-nav='1']")
    assert "Wall 3 of" in page.inner_text("#fix-wallpos")
    page.click("[data-wall-nav='-1']"); page.click("[data-wall-nav='-1']")
    assert "Wall 1 of" in page.inner_text("#fix-wallpos")
    page.click("[data-wall-nav='-1']")                      # Wall 1 and Previous: the last wall; its row scrolls into view above the bar at the bottom of the panel
    page.wait_for_timeout(300)
    assert page.evaluate("(() => { const r = document.querySelector('#fix-form .wallrow.sel').getBoundingClientRect(), b = document.querySelector('#fix-panel .fix-body').getBoundingClientRect(), bars = [...document.querySelectorAll('#fix-panel .fix-bar')].filter((x) => x.offsetParent).map((x) => x.getBoundingClientRect().top); return r.top >= b.top - 1 && r.bottom <= Math.min(b.bottom, ...bars) + 1; })()"), "the picked wall is under the bar or out of the panel"
    page.click("[data-wall-nav='1']")
    assert "Wall 1 of" in page.inner_text("#fix-wallpos")
    w3 = rows(page, f"SELECT ST_X(ST_LineInterpolatePoint(geometry, 0.5)) AS x, ST_Y(ST_LineInterpolatePoint(geometry, 0.5)) AS y FROM main.building_faces WHERE building_id = {b['osm_id']} AND face_index = 2")[0]
    px = at(page, w3["x"], w3["y"])
    page.mouse.click(*px)                                  # a real click on the third wall of the picked building
    page.wait_for_function("document.getElementById('fix-wallpos').textContent.startsWith('Wall 3 of')", timeout=20_000)
    page.click("#fix-wall-off")
    assert "No wall is selected" in page.inner_text("#fix-wallpos")
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['fix-faces-sel']}).length === 0", timeout=10_000)
    assert page.locator("#fix-form .wallrow.sel").count() == 0 and f"{b['osm_id']}" in page.input_value("#fix-id")
    print("select each wall: a click on a row, Next and Previous, a click on the wall on the map, and Unselect")
    page.screenshot(path=str(out / "walls.png"))

    # a node (a traffic signal): its tab, a real click
    page.click("#fix-tab-node")
    n = rows(page, "SELECT osm_id, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM features.traffic WHERE map_extract(tags, 'highway')[1] = 'traffic_signals' LIMIT 1")[0]
    px = at(page, n["lon"], n["lat"])
    assert page.is_visible("#fix-nodes-legend") and "Traffic signal" in page.inner_text("#fix-nodes-legend")
    page.wait_for_function("window.fixesPanel.drawn().nodes > 0 && duckMap.queryRenderedFeatures({layers: ['fix-nodes-pt']}).length > 0", timeout=20_000)
    assert "In view:" in page.inner_text("#fix-nodes-info"), page.inner_text("#fix-nodes-info")
    page.mouse.move(*px)                       # hover: a ring, the pointer cursor and a tooltip with the kind and the id
    page.wait_for_selector(".maplibregl-popup.fix-tip", timeout=10_000)
    tip = page.inner_text(".maplibregl-popup.fix-tip")
    assert "Traffic signal" in tip and f"node {n['osm_id']}" in tip, tip
    assert page.evaluate("duckMap.getCanvas().style.cursor") == "pointer"
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['fix-nodes-hover']}).length > 0", timeout=10_000)
    page.mouse.move(px[0] + 300, px[1] + 200)    # away from the dot: no tooltip
    page.wait_for_function("document.querySelectorAll('.maplibregl-popup.fix-tip').length === 0", timeout=10_000)
    page.mouse.click(*px)
    page.wait_for_function(f"document.getElementById('fix-id').value === '{n['osm_id']}' && document.querySelector('#fixf-traffic_signals_direction')", timeout=20_000)
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['fix-sel-pt']}).length > 0", timeout=20_000)    # the picked node has its blue ring
    print("the Node tab draws the traffic signals and crossings in view as dots, and the picked node has a ring")
    page.select_option("#fixf-traffic_signals_direction", "backward")
    page.click("#fix-save")
    y = text(page)
    assert "type: node" in y and "traffic_signals:direction: backward" in y, y
    page.wait_for_timeout(500)
    # a tag that the preset does not list: add it, then delete one of the data tags
    page.fill("#fix-addkey", "note:test")
    page.fill("#fix-addval", "hello")
    page.click("#fix-add")
    page.click("#fix-save")
    assert "note:test: hello" in text(page)
    page.click("#fix-form [data-clear='traffic_signals']")
    page.click("#fix-save")
    y = text(page)
    assert "delete:" in y and "- traffic_signals" in y, y
    print(f"a node: {n['osm_id']}, a preset field, an added tag and a deleted tag")

    # a turn rule: the road that the road click gave has a junction; the rule goes into the list of changes (and into the file)
    frm = rows(page, "SELECT a.osm_id FROM driving.edges a JOIN driving.edges b ON b.source = a.target AND b.osm_id != a.osm_id "
                     "JOIN driving.edges c ON c.target = a.target AND c.osm_id NOT IN (a.osm_id, b.osm_id) LIMIT 1")[0]["osm_id"]
    page.click("#fix-tab-turns")
    page.fill("#fix-from", str(frm))
    page.click("#fix-turn-find")
    page.wait_for_selector("#fix-out .turn")
    # the map: the road that the turn starts on (blue), the junction (a ring) and the roads that leave it (green); a hover on a row outlines its road
    page.wait_for_function("window.fixesPanel.drawn().sel >= 2 && window.fixesPanel.drawn().turn > 0", timeout=20_000)
    page.wait_for_function("!duckMap.isMoving()")
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['fix-sel-line']}).length > 0 && duckMap.queryRenderedFeatures({layers: ['fix-sel-pt']}).length > 0 && duckMap.queryRenderedFeatures({layers: ['fix-turn-line']}).length > 0", timeout=20_000)
    page.hover("#fix-out .turn")
    assert page.get_attribute("#fix-out .turn", "data-to") in page.evaluate("JSON.stringify(duckMap.getFilter('fix-turn-hl'))"), "a hover on a row outlines its road"
    assert page.is_visible("#fix-turn-legend")
    print("the Turn tab draws the start road, the junction ring and the roads that leave it")
    # only the rules that fit the turn are offered: Allowed, No <way> and Only <way> (the way is left, right, straight on or a U-turn), not all ten; the row has the green of the map
    opts = page.eval_on_selector_all("#fix-out .turn select", "(l) => l.map((x) => [...x.options].map((o) => o.value))")
    assert opts and all(len(o) == 3 and o[0] == "" and o[1].startswith("no_") and o[2].startswith("only_") and o[1][3:] == o[2][5:] for o in opts), opts
    assert page.evaluate("[...document.querySelectorAll('#fix-out .turn .sw')].length") == len(opts)
    # the junctions are a list like the walls: the junction that the tab picked first has the mark, no row is wider than the panel, a row under the pointer has a tint
    assert page.locator("#fix-via-list .junrow.sel").count() == 1 and page.eval_on_selector("#fix-via", "(s) => s.type") == "hidden" and page.locator("#fix-via-row .rs-sel").count() == 0, "no dropdown in the junction row"
    assert page.evaluate("[...document.querySelectorAll('#fix-via-list .junrow, #fix-out .turn')].every((r) => r.getBoundingClientRect().right <= document.getElementById('fix-panel').getBoundingClientRect().right + 1)"), "a row is wider than the panel"
    page.mouse.move(5, 5)
    still = page.eval_on_selector("#fix-out .turn", "(r) => getComputedStyle(r).backgroundColor")
    page.hover("#fix-out .turn")
    assert page.eval_on_selector("#fix-out .turn", "(r) => getComputedStyle(r).backgroundColor") != still, "a row under the pointer changes its color"
    # a click on a row of a road that leaves picks it: the mark stays and the map keeps the outline after the pointer goes; a second click drops it
    page.click("#fix-out .turn .small")
    to = page.get_attribute("#fix-out .turn", "data-to")
    page.mouse.move(5, 5)
    assert page.locator("#fix-out .turn.sel").count() == 1 and to in page.evaluate("JSON.stringify(duckMap.getFilter('fix-turn-hl'))"), "the picked road keeps its outline"
    page.click("#fix-out .turn .small")
    assert page.locator("#fix-out .turn.sel").count() == 0 and "-1" in page.evaluate("JSON.stringify(duckMap.getFilter('fix-turn-hl'))")
    # the pick colors show in the dark theme too (the panel's accent, not a dark gray)
    page.evaluate("rsSetTheme('dark')")
    page.click("#fix-out .turn .small")
    page.mouse.move(5, 5)
    sel = page.eval_on_selector("#fix-out .turn.sel", "(r) => { const c = getComputedStyle(r); return [c.outlineColor, c.backgroundColor, getComputedStyle(document.getElementById('fix-panel')).backgroundColor]; }")
    assert sel[0] != sel[1] and sel[1] != sel[2] and sel[0] != "rgb(17, 24, 39)", sel
    page.click("#fix-out .turn .small")
    page.evaluate("rsSetTheme('light')")
    # the junction list says how many roads leave each junction, and the roads that arrive can be the start road
    assert "leave" in page.inner_text("#fix-via-list .junrow.sel"), "the junction list has the number of roads that leave"
    arr = page.get_attribute("#fix-out [data-from]", "data-from")
    page.click("#fix-out [data-from]")
    page.wait_for_function(f"document.getElementById('fix-from').value === '{arr}'", timeout=10_000)
    # a road that ends in a dead end: no road leaves, and the tab says why and lists the roads that arrive
    dead = rows(page, "SELECT e.osm_id FROM driving.edges e GROUP BY e.osm_id HAVING bool_and(NOT EXISTS (SELECT 1 FROM driving.edges o WHERE o.source = e.target AND o.osm_id != e.osm_id)) LIMIT 1")
    if dead:
        page.fill("#fix-from", str(dead[0]["osm_id"])); page.click("#fix-turn-find")
        page.wait_for_function("document.getElementById('fix-out').textContent.includes('No other road leaves this junction')", timeout=10_000)
    page.fill("#fix-from", str(frm)); page.click("#fix-turn-find")
    page.wait_for_selector("#fix-out .turn")
    print("the Turn tab: the junctions say how many roads leave, a dead end says why, and an arriving road can be the start road")
    rule = page.eval_on_selector("#fix-out .turn select", "(x) => x.options[1].value")      # the first rule that fits the turn: No <way>
    page.select_option("#fix-out .turn select", rule)
    assert "not added yet" in page.inner_text("#fix-turn-note") and "restriction" not in text(page), "a choice is not a change until Add to changes"
    assert page.is_visible("#fix-tab-turns .dot")
    page.click("#fix-turn-add")
    assert not page.is_visible("#fix-tab-turns .dot")
    y = text(page)
    assert "turn_restrictions" in y and f"restriction: {rule}" in y and f"from_way: {frm}" in y, y
    page.click("#fix-turn-clear")                  # Clear takes the road out of the Turn tab (the rule stays in the changes)
    assert not page.is_visible("#fix-turnsec") and page.input_value("#fix-from") == "" and "turn_restrictions" in text(page)

    # the one Build button waits while a tab has edits that are not in the changes
    page.click("#fix-tab-road")
    page.fill("#fixf-lanes", "9")
    assert page.is_visible("#fix-tab-road .dot")
    page.click("#fix-tab-changes")
    assert page.is_visible("#fix-pending") and page.is_disabled("#fix-apply") and "Road tab" in page.inner_text("#fix-pending"), page.inner_text("#fix-pending")
    page.click("#fix-pending [data-go=road]")
    assert page.get_attribute("#fix-tab-road", "aria-selected") == "true"
    page.click("#fix-revert")
    assert not page.is_visible("#fix-tab-road .dot")

    # the list of changes
    page.click("#fix-tab-changes")
    assert not page.is_visible("#fix-pending") and page.is_enabled("#fix-apply")
    assert page.evaluate("window.fixesPanel.drawn().nodes") == 0, "the dots go when the Node tab is not shown"
    page.wait_for_function("document.querySelectorAll('#fix-list .chg').length === 5", timeout=10_000)
    lst = page.inner_text("#fix-list")
    assert "Road" in lst and "Building" in lst and "Node" in lst and "Turn" in lst and "Wall" in lst and "sidewalk" in lst and "both" in lst and "building:levels" in lst and "roads (1)" in lst.lower(), lst
    assert page.inner_text("#fix-n") == "5"
    page.screenshot(path=str(out / "changes.png"))
    # a click on a change selects the object, with its data, and goes to the Edit tab
    page.click(f"#fix-list .chg[data-id='{ROAD}']")
    page.wait_for_function(f"document.getElementById('fix-id').value === '{ROAD}' && document.querySelector('#fixf-sidewalk')?.value === 'both'", timeout=20_000)
    assert page.is_visible("#fix-edit")
    page.screenshot(path=str(out / "edit-road.png"))
    # every kind of change opens in its own tab, for edit: a building, a node and a turn rule
    for sel_, tab_, check in [(".chg[data-kind=building]:not([data-face])", "building", "document.querySelector('#fixf-building_levels')"),
                              (".chg[data-type=node]", "node", "document.querySelector('#fixf-traffic_signals_direction')"),
                              (".chg[data-turn]", "turns", "document.getElementById('fix-from').value !== ''")]:
        page.click("#fix-tab-changes")
        page.click(f"#fix-list {sel_}")
        page.wait_for_function(check, timeout=20_000)
        assert page.get_attribute(f"#fix-tab-{tab_}", "aria-selected") == "true", tab_
    page.click("#fix-tab-changes")
    print("a click on a change opens the road, the building, the node and the turn in their tabs")
    # delete a change, then undo and redo
    page.click("#fix-tab-changes")
    page.click("#fix-list .chg[data-type=node] [data-x]")
    page.wait_for_function("document.querySelectorAll('#fix-list .chg').length === 4")
    page.click("#fix-undo")
    page.wait_for_function("document.querySelectorAll('#fix-list .chg').length === 5")
    page.click("#fix-redo")
    page.wait_for_function("document.querySelectorAll('#fix-list .chg').length === 4")
    page.click("#fix-undo")
    page.wait_for_function("document.querySelectorAll('#fix-list .chg').length === 5")
    assert "traffic_signals:direction: backward" in text(page)

    # the Changes list shows what the data had before, as "was -> now"
    assert "→" in lst and "none" in lst, lst

    # a new road: the first click is near a junction (it joins it), the second is a free point; Enter-free path: the Finish button
    page.click("#fix-tab-new")
    page.click("#fix-draw")
    assert page.is_visible("#fix-drawbox")
    j = rows(page, "SELECT node_id, ST_X(geom) AS x, ST_Y(geom) AS y FROM driving.nodes WHERE node_id IN (SELECT node_id FROM driving.way_nodes) LIMIT 1")[0]
    px = at(page, j["x"], j["y"])
    page.mouse.click(*px)
    page.wait_for_function("window.fixesPanel.drawn().draw === 1", timeout=20_000)
    assert "joins a junction" in page.inner_text("#fix-draw-n"), page.inner_text("#fix-draw-n")
    page.mouse.click(px[0] + 150, px[1] - 80)
    page.wait_for_function("window.fixesPanel.drawn().draw === 2", timeout=20_000)
    page.select_option("#fixn-highway", "service")
    page.fill("#fixn-name", "Test Lane")
    page.click("#fix-draw-done")
    y = text(page)
    assert "new_ways" in y and "id: 9000000000000" in y and "highway: service" in y and "name: Test Lane" in y, y
    assert not page.is_visible("#fix-drawbox") and page.inner_text("#fix-n") == "6"
    print("a new road: two points, the first joins a junction; it is in new_ways")
    # a click on the new road in the Changes tab opens it in the New road tab, for edit (its points stay)
    page.click("#fix-tab-changes")
    page.click("#fix-list .chg[data-newway]")
    assert page.get_attribute("#fix-tab-new", "aria-selected") == "true" and page.is_visible("#fix-drawbox") and page.input_value("#fixn-name") == "Test Lane"
    assert page.inner_text("#fix-draw-done") == "Update change" and page.is_visible("#fix-new-del") and not page.is_visible("#fix-draw-undo")
    page.wait_for_function("window.fixesPanel.drawn().sel > 0", timeout=20_000)
    page.fill("#fixn-name", "Test Lane 2")
    page.click("#fix-draw-done")
    y = text(page)
    assert "name: Test Lane 2" in y and "name: Test Lane\n" not in y and page.inner_text("#fix-n") == "6", y
    assert not page.is_visible("#fix-drawbox")
    print("a new road opens for edit in its tab: the name changed, the points stayed")

    # a file that is not valid does not change the rules; a duckOSM file (overrides with tags) loads
    saved = text(page)
    page.evaluate("window.fixesPanel.load('overrides: [')")
    assert page.inner_text("#fix-n") == "6"
    page.evaluate("window.fixesPanel.load('overrides:\\n  - osm_id: 1\\n    lanes: 3\\n    tags: {surface: asphalt}\\n')")
    assert page.inner_text("#fix-n") == "1"
    page.evaluate("(t) => window.fixesPanel.load(t)", saved)
    page.wait_for_function("document.getElementById('fix-n').textContent === '6'")

    # the changes stay in this browser for the area (a reload of the page keeps them)
    key = "duckosm.fixes:" + page.input_value("#name").strip()
    assert page.evaluate("(k) => localStorage.getItem(k)", key) == saved, "the browser has the changes"
    page.evaluate("window.fixesPanel.load('{}')")
    assert page.evaluate("(k) => localStorage.getItem(k)", key) is None and page.inner_text("#fix-n") == ""
    page.evaluate("([k, t]) => localStorage.setItem(k, t)", [key, saved])
    assert page.evaluate("window.fixesPanel.restore()") == 6 and page.inner_text("#fix-n") == "6", "restore brings the changes back"

    # build again with the rules: the one Build button is in the Changes tab; it closes the panel; the tables have the changes, and the amber layer is drawn again
    page.click("#fix-tab-changes")
    page.click("#fix-apply")
    page.wait_for_function("document.getElementById('run').hasAttribute('aria-busy')", timeout=30_000)
    built(page)
    page.wait_for_function("document.getElementById('fix-why').textContent.includes('Built with these fixes')", timeout=60_000)
    assert not page.is_visible("#fix-panel") and "6 changes" in page.inner_text("#fix-sum"), page.inner_text("#fix-sum")
    lanes = rows(page, f"SELECT DISTINCT lanes::INTEGER AS lanes FROM driving.edges WHERE osm_id = {ROAD}")
    assert [r["lanes"] for r in lanes] == [7], lanes
    wt = {r["walk_type"] for r in rows(page, f"SELECT DISTINCT walk_type FROM walking.edges WHERE osm_id = {ROAD}")}
    assert wt == {"sidewalk"}, ("the sidewalk tag changes the walking type", wt)
    bt = rows(page, f"SELECT map_extract(tags, 'building:levels')[1] AS l, map_extract(tags, 'roof:shape')[1] AS r, map_extract(tags, 'roof:colour')[1] AS c "
                    f"FROM features.buildings WHERE osm_id = {b['osm_id']} AND osm_type = 'way'")[0]
    assert (bt["l"], bt["r"], bt["c"]) == ("7", "gabled", "#cc3300"), bt
    road = rows(page, "SELECT count(*)::INTEGER AS n, any_value(highway) AS h, any_value(name) AS nm FROM driving.edges WHERE osm_id = 9000000000000")[0]
    assert (road["n"] > 0, road["h"], road["nm"]) == (True, "service", "Test Lane 2"), ("the new road is in driving.edges", road)
    joined = rows(page, "SELECT count(*)::INTEGER AS n FROM driving.edges e JOIN driving.edges o ON o.osm_id <> e.osm_id AND (o.source IN (e.source, e.target) OR o.target IN (e.source, e.target)) WHERE e.osm_id = 9000000000000")[0]["n"]
    assert joined > 0, "the new road joins the network at the junction"
    faces = rows(page, f"SELECT face_type, computed_type, edited FROM main.building_faces WHERE building_id = {b['osm_id']} AND "
                       f"least(from_node, to_node) = least({wall[0]}, {wall[1]}) AND greatest(from_node, to_node) = greatest({wall[0]}, {wall[1]})")[0]
    assert (faces["face_type"], faces["computed_type"], faces["edited"]) == (new_type, wall[2], True), ("the rule is in main.building_faces", faces)
    assert rows(page, f"SELECT door FROM main.building_faces WHERE building_id = {b['osm_id']} AND door IS NOT NULL")[0]["door"] == "main" and rows(page, "SELECT count(*)::INTEGER AS n FROM main.building_faces WHERE door IS NOT NULL")[0]["n"] == 1, "the door is in main.building_faces"
    assert rows(page, "SELECT count(*)::INTEGER AS n FROM main.building_faces")[0]["n"] > 1000
    info = rows(page, f"SELECT levels, roof_shape, roof_color, height_m FROM main.building_info WHERE osm_id = {b['osm_id']} AND osm_type = 'way'")[0]
    assert (info["levels"], info["roof_shape"], info["roof_color"]) == (7, "gabled", "#cc3300"), info
    cc = rows(page, "SELECT css_color('red') AS a, css_color('#f0a') AS b, css_color('nope') AS c")[0]
    assert (cc["a"], cc["b"], cc["c"]) == ("#ff0000", "#ff00aa", None), cc
    assert rows(page, "SELECT count(*)::INTEGER AS n FROM main.building_info")[0]["n"] == rows(page, "SELECT count(*)::INTEGER AS n FROM features.buildings")[0]["n"]
    nt = rows(page, f"SELECT map_extract(tags, 'traffic_signals:direction')[1] AS d, map_extract(tags, 'traffic_signals')[1] AS s, map_extract(tags, 'note:test')[1] AS n "
                    f"FROM features.traffic WHERE osm_id = {n['osm_id']}")[0]
    assert (nt["d"], nt["s"], nt["n"]) == ("backward", None, "hello"), nt
    page.wait_for_function("window.fixesPanel.drawn().edits > 0", timeout=30_000)
    assert not popups(page)
    # out and back: the changes and the picked road are still there after the build
    if "folded" in (page.get_attribute("#step7-card", "class") or ""):
        page.click("#step7")
    page.click("#fix-open")
    assert page.inner_text("#fix-n") == "6"
    page.click("#fix-tab-road")
    page.wait_for_function(f"document.querySelector('#fix-obj .objhead')?.textContent.includes('way {ROAD}') && document.querySelector('#fixf-lanes')", timeout=20_000)
    page.click("#fix-tab-changes")
    assert page.locator("#fix-list .chg").count() == 6, "the list of changes after the build"
    print("out and back: 6 changes in the list, the Road tab has its road")

    # doors: the Building tab lists the doors of a building (main.building_entrances), draws them as dots, and a door kind is a node edit
    bid = rows(page, "SELECT building_id FROM main.building_entrances WHERE building_id IS NOT NULL GROUP BY building_id ORDER BY count(*) DESC LIMIT 1")[0]["building_id"]
    n_doors = rows(page, f"SELECT count(*)::INTEGER AS n FROM main.building_entrances WHERE building_id = {bid}")[0]["n"]
    door = rows(page, f"SELECT osm_id, kind FROM main.building_entrances WHERE building_id = {bid} ORDER BY osm_id LIMIT 1")[0]
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=60_000)      # the page fits the area after a build: let that end
    page.wait_for_function("!window.duckMap.isMoving()")
    page.click("#fix-tab-building")
    page.evaluate(f"window.fixesPanel.select('building', 'way', {bid}, {{zoom: true}})")
    page.wait_for_function("document.querySelectorAll('#fix-form .doorrow').length > 0", timeout=20_000)
    assert page.locator("#fix-form .doorrow").count() == n_doors, (page.locator("#fix-form .doorrow").count(), n_doors)
    page.wait_for_timeout(1500)
    page.wait_for_function("!window.duckMap.isMoving()")
    try:
        page.wait_for_function("window.fixesPanel.drawn().doors > 0 && duckMap.queryRenderedFeatures({layers: ['fix-doors-pt']}).length > 0", timeout=20_000)
    except Exception:
        print("DEBUG doors", page.evaluate("[window.fixesPanel.drawn(), document.getElementById('fix-doors-info').textContent, duckMap.getZoom(), document.querySelector('#fix-tab-building').getAttribute('aria-selected'), document.body.classList.contains('editing-fixes')]"), bid)
        raise
    assert page.is_visible("#fix-doors-legend") and "In view" in page.inner_text("#fix-doors-info")
    new_kind = "service" if door["kind"] != "service" else "main"
    page.select_option("#fix-form .doorrow >> nth=0 >> select", new_kind)
    assert f"entrance: {new_kind}" not in text(page) and not page.is_disabled("#fix-save"), "a door kind waits for Add to changes"
    page.click("#fix-save")
    y = text(page)
    assert f"id: {door['osm_id']}" in y and "type: node" in y and f"entrance: {new_kind}" in y, y
    print(f"doors: building {bid} has {n_doors} door(s), drawn as dots; the kind of door {door['osm_id']} is {door['kind']} now {new_kind}")

    # add a traffic signal at a junction of the roads: a gray dot, a click on it, the quick button, Add to changes, build again, and the node is in features.traffic
    ARMS = "(SELECT nid FROM (SELECT source AS nid, target AS o FROM driving.edges UNION ALL SELECT target, source FROM driving.edges) GROUP BY nid HAVING count(DISTINCT o) >= 3)"
    j = rows(page, "SELECT n.node_id AS id, ST_X(n.geom) AS x, ST_Y(n.geom) AS y FROM driving.nodes n WHERE n.node_id IN " + ARMS + " AND n.node_id IN (SELECT node_id FROM driving.way_nodes) "
                   "AND NOT EXISTS (SELECT 1 FROM driving.edges e WHERE (e.source = n.node_id OR e.target = n.node_id) AND e.highway IN ('motorway', 'motorway_link', 'trunk', 'trunk_link')) "
                   "AND NOT EXISTS (SELECT 1 FROM features.traffic t WHERE abs(ST_X(t.geom) - ST_X(n.geom)) < 0.0004 AND abs(ST_Y(t.geom) - ST_Y(n.geom)) < 0.0004) LIMIT 1")[0]
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=60_000)
    page.wait_for_function("!window.duckMap.isMoving()")
    page.click("#fix-tab-node")
    page.wait_for_function("window.fixesPanel.drawn().sel > 0", timeout=20_000)       # the tab shows its node and zooms to it: let that end before the jump
    page.wait_for_timeout(1500)
    page.wait_for_function("!window.duckMap.isMoving()")
    px = at(page, j["x"], j["y"])
    try:
        page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['fix-nodes-pt']}).some((f) => f.properties.k === 'junction' && f.properties.id === " + str(j['id']) + ")", timeout=20_000)
    except Exception:
        print("DEBUG", page.evaluate("[window.fixesPanel.drawn(), document.getElementById('fix-nodes-info').textContent, duckMap.getZoom(), duckMap.getCenter(), document.querySelector('#fix-tab-node').getAttribute('aria-selected')]"), j)
        raise
    page.mouse.click(*px)
    page.wait_for_function(f"document.querySelector('#fix-obj .objhead')?.textContent.includes('node {j['id']}') && document.querySelector('#fixf-highway')", timeout=20_000)
    assert "no traffic tag" in page.inner_text("#fix-obj"), page.inner_text("#fix-obj")
    assert page.is_disabled("#fixf-kerb") and page.is_disabled("#fixf-crossing") and "for a crossing" in page.inner_text("#fix-form"), "a node with no kind has no crossing, kerb or tactile paving"
    page.select_option("#fixf-highway", "traffic_signals")
    assert not page.is_disabled("#fixf-kerb") and page.is_disabled("#fixf-traffic_signals_direction") is False
    assert page.eval_on_selector_all("#fixf-crossing option", "(o) => o.map((x) => x.value)") == ["", "traffic_signals"], "a traffic signal with a crossing has one crossing value"
    assert page.input_value("#fixf-highway") == "traffic_signals"
    page.click("#fix-save")
    y = text(page)
    assert f"id: {j['id']}" in y and "highway: traffic_signals" in y, y
    # the constraints: a plain road node (2 roads) takes no traffic signal, in the buttons and in the Kind field
    plain = rows(page, "SELECT nid::BIGINT AS id FROM (SELECT source AS nid, target AS o FROM driving.edges UNION ALL SELECT target, source FROM driving.edges) GROUP BY nid HAVING count(DISTINCT o) = 2 "
                       "AND nid IN (SELECT node_id FROM driving.way_nodes) AND nid NOT IN (SELECT osm_id FROM features.traffic) LIMIT 1")[0]["id"]
    page.evaluate(f"window.fixesPanel.select('node', 'node', {plain})")
    page.wait_for_function(f"document.querySelector('#fix-obj .objhead')?.textContent.includes('node {plain}') && document.querySelector('#fixf-highway')", timeout=20_000)
    assert page.evaluate("document.querySelector('#fixf-highway option[value=traffic_signals]').disabled") and "at least 3 roads" in page.inner_text("#fix-form .quickwhy"), page.inner_text("#fix-form")
    page.click("#fix-unselect")
    print("the constraints: a node with 2 roads takes no traffic signal (the Kind option is off with its reason under it)")

    # Delete: a building (a way) and a road are deleted from the data (the rule `remove`), and they are in no table after the build
    ob = rows(page, f"SELECT osm_id FROM features.buildings WHERE osm_type = 'way' AND osm_id != {b['osm_id']} LIMIT 1")[0]["osm_id"]
    page.evaluate(f"window.fixesPanel.select('building', 'way', {ob}, {{zoom: true}})")
    page.wait_for_selector("#fix-delete", timeout=20_000)
    page.click("#fix-delete")
    assert "will be deleted" in page.inner_text(".fsec.danger") and page.is_visible("#fix-delete"), page.inner_text(".fsec.danger")
    page.click("#fix-save")
    y = text(page)
    assert f"osm_id: {ob}" in y and "remove: true" in y, y
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['fix-edits-fill', 'fix-edits-line']}).some((f) => f.properties.d === 1)", timeout=20_000)      # a deleted object is red
    orr = rows(page, f"SELECT osm_id FROM driving.edges WHERE osm_id NOT IN ({ROAD}, {frm}) AND osm_id < 9000000000000 AND source != {j['id']} AND target != {j['id']} ORDER BY length_m LIMIT 1")[0]["osm_id"]
    page.click("#fix-tab-road")
    page.evaluate(f"window.fixesPanel.select('road', 'way', {orr})")
    page.wait_for_selector("#fix-delete", timeout=20_000)
    page.click("#fix-delete"); page.click("#fix-save")
    assert f"osm_id: {orr}" in text(page)
    page.click("#fix-tab-changes")
    lst2 = page.inner_text("#fix-list")
    assert "deleted from the data" in lst2 and page.locator("#fix-list .chg.del").count() == 2, lst2
    print(f"Delete: a building ({ob}) and a road ({orr}) are in the changes as deleted, red on the map")

    page.click("#fix-tab-changes")
    page.click("#fix-apply")
    page.wait_for_function("document.getElementById('run').hasAttribute('aria-busy')", timeout=30_000)
    built(page)
    page.wait_for_function("document.getElementById('fix-why').textContent.includes('Built with these fixes')", timeout=60_000)
    assert rows(page, f"SELECT count(*)::INTEGER AS n FROM features.buildings WHERE osm_id = {ob} AND osm_type = 'way'")[0]["n"] == 0, "the deleted building is not in features.buildings"
    assert rows(page, f"SELECT count(*)::INTEGER AS n FROM driving.edges WHERE osm_id = {orr}")[0]["n"] == 0, "the deleted road is not in driving.edges"
    dk = rows(page, f"SELECT kind FROM main.building_entrances WHERE osm_id = {door['osm_id']}")
    assert dk and dk[0]["kind"] == new_kind, ("the door kind is in main.building_entrances after the build", dk)
    kind = rows(page, f"SELECT map_extract(tags, 'highway')[1] AS h FROM features.traffic WHERE osm_id = {j['id']}")
    assert kind and kind[0]["h"] == "traffic_signals", ("the new signal is in features.traffic", kind)
    # card 5 has the fixes file of this build (.yaml)
    assert not page.evaluate("document.getElementById('fixesyaml').hidden"), "the .yaml button shows after a build with fixes"
    with page.expect_download() as dl:
        page.evaluate("document.getElementById('fixesyaml').click()")
    body = pathlib.Path(dl.value.path()).read_text()
    assert dl.value.suggested_filename == "osm_fixes.yaml" and "tag_edits" in body and f"id: {j['id']}" in body, (dl.value.suggested_filename, body[:200])
    print(f"a traffic signal at the junction {j['id']}: a gray dot, a click, Kind Traffic signals, Add to changes, build again: it is in features.traffic")
    print(f"after the build: lanes 7, walk type sidewalk, building floors {bt['l']} roof {bt['r']} {bt['c']}, node tags changed; amber features: {amber(page)}")
    # the Arrows switch in roadstyle's base-map box: on while the roads show, a click hides the one-way arrows, a second click brings them back
    ARROWS = "duckMap.getStyle().layers.filter((l) => l.type === 'symbol' && (JSON.stringify((l.layout || {})['icon-image'] || '').includes('oneway') || /arrows/.test(l.id)))"
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=120_000)      # the roads of the new build
    page.wait_for_function(f"{ARROWS}.length > 0", timeout=30_000)
    assert page.evaluate(f"{ARROWS}.length") > 0, "the roads style has arrow layers"
    page.click("#rs-toolbar .bm-ctrl .bm-icon")
    page.wait_for_selector("#rs-top-arrows", state="visible", timeout=10_000)
    assert page.is_checked("#rs-top-arrows") and page.is_enabled("#rs-top-arrows")
    page.click("#rs-top-arrows")
    page.wait_for_function(f"{ARROWS}.every((l) => duckMap.getLayoutProperty(l.id, 'visibility') === 'none')", timeout=10_000)
    page.click("#rs-top-arrows")
    page.wait_for_function(f"{ARROWS}.every((l) => duckMap.getLayoutProperty(l.id, 'visibility') !== 'none')", timeout=10_000)
    print("the Arrows switch hides and shows the one-way arrows")
    browser.close()
    server.shutdown()
assert not errors, errors
print("fixes_e2e.py: passed")
