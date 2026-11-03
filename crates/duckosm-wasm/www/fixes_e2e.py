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
    page.click("#fix-tab-building")
    assert page.is_visible("#fix-walls-all") and page.locator("#fixf-lanes").count() == 0 and "Nothing is picked" in page.inner_text("#fix-obj"), page.inner_text("#fix-obj")
    assert page.is_visible("#fixf-roof_shape") is False and page.input_value("#fix-id") == ""
    page.click("#fix-tab-road")
    assert page.input_value("#fix-id") == str(ROAD) and page.input_value("#fixf-lanes") == "7", "the Road tab keeps its road"
    assert page.evaluate("window.fixesPanel.drawn().sel") == 0, "the Building tab has nothing picked, so nothing is blue"
    page.click("#fix-tab-road")
    page.wait_for_function("window.fixesPanel.drawn().sel > 0", timeout=20_000)
    pt = rows(page, f"SELECT ST_X(ST_PointOnSurface(ST_Union_Agg(geometry))) AS x, ST_Y(ST_PointOnSurface(ST_Union_Agg(geometry))) AS y FROM driving.edges WHERE osm_id = {ROAD}")[0]
    page.wait_for_function("!window.duckMap.isMoving()")
    assert page.evaluate(f"window.duckMap.getBounds().contains([{pt['x']}, {pt['y']}])"), "a switch to the Road tab shows its road on the map"
    print("the tabs: Building has its own empty form, Road keeps its road and its rule, and the map shows the road of the tab")

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

    # the walls of the building: a list with a type for each wall (from main.building_faces), colored on the map; a change of type is a rule at once
    page.wait_for_function("document.querySelectorAll('#fix-form .wallrow').length >= 3", timeout=20_000)
    assert page.evaluate("window.fixesPanel.drawn().faces") >= 3, "the walls of the building are drawn"
    wall = page.evaluate("(() => { const r = document.querySelector('#fix-form .wallrow'); return [r.dataset.a, r.dataset.b, r.dataset.computed]; })()")
    new_type = "party" if wall[2] != "party" else "side"
    page.select_option("#fix-form .wallrow select", new_type)
    y = text(page)
    assert "building_faces" in y and f"type: {new_type}" in y and f"building: {b['osm_id']}" in y, y
    assert "edited" in (page.get_attribute("#fix-form .wallrow", "class") or "")
    print(f"a wall: nodes {wall[0]} and {wall[1]} were {wall[2]}, now {new_type}")
    page.screenshot(path=str(out / "walls.png"))

    # a node (a traffic signal): its tab, a real click
    page.click("#fix-tab-node")
    n = rows(page, "SELECT osm_id, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM features.traffic WHERE map_extract(tags, 'highway')[1] = 'traffic_signals' LIMIT 1")[0]
    px = at(page, n["lon"], n["lat"])
    page.mouse.click(*px)
    page.wait_for_function(f"document.getElementById('fix-id').value === '{n['osm_id']}' && document.querySelector('#fixf-traffic_signals_direction')", timeout=20_000)
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
    frm = rows(page, "SELECT a.osm_id FROM driving.edges a JOIN driving.edges b ON b.source = a.target AND b.osm_id != a.osm_id LIMIT 1")[0]["osm_id"]
    page.click("#fix-tab-turns")
    page.fill("#fix-from", str(frm))
    page.click("#fix-turn-find")
    page.wait_for_selector("#fix-out .turn")
    page.select_option("#fix-out .turn select", "no_left_turn")
    assert "not added yet" in page.inner_text("#fix-turn-note") and "restriction" not in text(page), "a choice is not a change until Add to changes"
    assert page.is_visible("#fix-tab-turns .dot")
    page.click("#fix-turn-add")
    assert not page.is_visible("#fix-tab-turns .dot")
    y = text(page)
    assert "turn_restrictions" in y and "restriction: no_left_turn" in y and f"from_way: {frm}" in y, y

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
    print(f"after the build: lanes 7, walk type sidewalk, building floors {bt['l']} roof {bt['r']} {bt['c']}, node tags changed; amber features: {amber(page)}")
    browser.close()
    server.shutdown()
assert not errors, errors
print("fixes_e2e.py: passed")
