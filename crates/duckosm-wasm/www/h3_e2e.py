"""The H3 tab of card 1 (docs/app.md, "H3 hexagons") in headless Chromium (Playwright): the area is the union of hexagons that the person clicks on the map.
- on a computer: the levels with the size of a cell; six clicks around a cell give one polygon with a hole, a seventh click fills the hole; a click on a
  picked cell removes it; Clear (off with its reason under it, no tooltip) removes all; another level removes the cells; the cap (5,000 km2) stops a click;
  a build of Monaco from the cells gives roads, all of them near the cells;
- on a phone (390 x 844, touch): the four tabs fit in the panel, the page has no sideways scroll, and taps on the map pick the cells.

    python crates/duckosm-wasm/www/h3_e2e.py [out folder]

It uses tests/data/monaco_sample.osm.pbf. The page loads its libraries (h3-js too) from cdn.jsdelivr.net. Build the page first (docs/development.md, "WebAssembly").
"""
import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-h3")
out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html?maxroads=0"
MONACO = (7.4246, 43.7384)
errors = []


def h3(page, body, *args):
    """run `body` in the page with the h3-js module (the page's import map) as `h3`"""
    return page.evaluate("async ([body, args]) => { const h3 = await import('h3-js'); return (new Function('h3', 'duckMap', 'args', 'return (async () => {' + body + '})()'))(h3, window.duckMap, args); }", [body, list(args)])


def where(page, cell):
    """the pixel of the centre of a cell on the page"""
    return h3(page, "const [lat, lng] = h3.cellToLatLng(args[0]), p = duckMap.project([lng, lat]), c = duckMap.getCanvas().getBoundingClientRect(); return [p.x + c.left, p.y + c.top];", cell)


def show(page, lng, lat, zoom):
    page.evaluate(f"duckMap.jumpTo({{center: [{lng}, {lat}], zoom: {zoom}}})")
    page.wait_for_function("!duckMap.isMoving()")
    page.wait_for_timeout(500)


def inside(point, geometry):
    """the even-odd rule over all rings of the polygon"""
    x, y = point
    c = False
    for ring in geometry["coordinates"]:
        for i in range(len(ring)):
            (x1, y1), (x2, y2) = ring[i - 1], ring[i]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                c = not c
    return c


def run(browser, phone):
    page = browser.new_context(**(playwright.devices["iPhone 13"] if phone else dict(viewport={"width": 1400, "height": 900}))).new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.mapReady", timeout=120_000)
    name = "phone" if phone else "desk"
    click = lambda sel: page.tap(sel) if phone else page.click(sel)  # noqa: E731
    text = lambda: page.inner_text("#h3-hint")  # noqa: E731

    def pick(cell):
        x, y = where(page, cell)
        if phone:
            page.touchscreen.tap(x, y)
            page.wait_for_timeout(700)      # two taps less than 500 ms apart are a double tap (MapLibre), and the map zooms
        else:
            page.mouse.click(x, y)

    def saved():
        """the GeoJSON of the GeoJSON button"""
        page.wait_for_function("!document.getElementById('save').disabled", timeout=60_000)
        with page.expect_download() as d:
            page.click("#save", no_wait_after=True) if not phone else page.evaluate("document.getElementById('save').click()")   # a tap on the button makes the next tap on the map a no-op in Playwright
        f = json.load(open(d.value.path()))["features"][0]
        return f

    def level(n):
        """roadstyle's list in place of the select"""
        click(".rs-sel:has(#h3-level) .rs-sel-btn")
        click(f".rs-sel-opt:has-text('Level {n}:')")
        page.wait_for_function(f"document.getElementById('h3-level').value === '{n}'")

    def cells(n):
        try:
            page.wait_for_function(f"window.h3Cells.size === {n}", timeout=10_000)
        except Exception:
            raise AssertionError(f"{n} cells expected, the page has {page.evaluate('[...window.h3Cells]')}; {text()}") from None
        assert text().startswith(f"{n} cell" if n else "Click a hexagon"), text()

    # the tab and the levels
    click("#tab-h3")
    page.wait_for_function("document.getElementById('h3-level').options.length === 6")
    options = page.eval_on_selector_all("#h3-level option", "(o) => o.map((x) => x.textContent)")
    assert options[3].startswith("Level 8: edge 531 m, 0.737 km²"), options
    assert options[0].startswith("Level 5: edge 9.9 km, 252.9 km²") and options[5].startswith("Level 10: edge 76 m"), options
    # the tab opens on a view with too many hexagons (the map starts on Europe): it zooms in by itself, and the grid shows
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['h3-grid']}).length > 10", timeout=30_000)
    # a view with too many hexagons: no grid, a click picks nothing and says why, and the button zooms in
    show(page, 10, 50, 3)
    page.wait_for_function("document.getElementById('h3-grid-note').textContent.includes('too many hexagons')", timeout=20_000)
    page.touchscreen.tap(195, 150) if phone else page.mouse.click(800, 450)
    page.wait_for_timeout(700)
    assert page.evaluate("window.h3Cells.size") == 0 and "too many hexagons" in text(), (page.evaluate("window.h3Cells.size"), text())
    click("#h3-zoom")
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['h3-grid']}).length > 10", timeout=30_000)
    # the grid: a transparent layer with the hexagons in view, a lit hexagon under the pointer, and the picked cells filled
    show(page, 7.4246, 43.7384, 14)
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['h3-grid']}).length > 10", timeout=20_000)
    assert "hexagon" in page.inner_text("#h3-grid-note"), page.inner_text("#h3-grid-note")
    assert page.evaluate("duckMap.getPaintProperty('h3-grid', 'line-opacity')") < 0.6 and page.evaluate("duckMap.getLayer('h3-grid').type") == "line", "the grid has no fill"
    if not phone:
        page.mouse.move(700, 450)
        page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['h3-hover']}).length > 0", timeout=10_000)
    # the dark theme: light lines on the dark map (dark gray lines were not seen), and back
    page.evaluate("rsSetTheme('dark')")
    page.wait_for_function("duckMap.getPaintProperty('h3-grid', 'line-color') === '#e2e8f0'", timeout=10_000)
    page.evaluate("rsSetTheme('light')")
    page.wait_for_function("duckMap.getPaintProperty('h3-grid', 'line-color') === '#475569'", timeout=10_000)
    # the row "H3 hexagons" of the base-map box (roadstyle's rsAddTopRow) shows or hides the layers
    row = page.locator("label:has-text('H3 hexagons') input")
    vis = lambda: page.evaluate("['h3-grid', 'h3-fill', 'h3-hover', 'h3-line'].map((l) => duckMap.getLayoutProperty(l, 'visibility') ?? 'visible')")  # noqa: E731
    assert row.count() == 1 and row.evaluate("(c) => c.checked && !c.disabled") and set(vis()) == {"visible"}, (row.count(), vis())
    row.evaluate("(c) => c.click()")
    page.wait_for_function("duckMap.getLayoutProperty('h3-grid', 'visibility') === 'none'", timeout=10_000)
    assert set(vis()) == {"none"} and page.evaluate("duckMap.queryRenderedFeatures({layers: ['h3-grid']}).length") == 0, vis()
    row.evaluate("(c) => c.click()")
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['h3-grid']}).length > 10", timeout=20_000)
    assert set(vis()) == {"visible"}, vis()
        # the four tabs fit in the panel and the page does not scroll sideways
    tabs = page.evaluate("[...document.querySelectorAll('#step1-card [role=tab]:not([hidden])')].map((t) => { const r = t.getBoundingClientRect(); return [r.left, r.right, r.width]; })")
    sb = page.evaluate("(() => { const r = document.getElementById('sb').getBoundingClientRect(); return [r.left, r.right]; })()")
    assert len(tabs) == 4 and all(t[0] >= sb[0] and t[1] <= sb[1] + 1 and t[2] > 50 for t in tabs), (tabs, sb)
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "sideways scroll"
    # Unselect is off at the start: the normal cursor, no tooltip (one button for the cells and the area: Unselect)
    look = page.evaluate("(() => { const b = document.querySelector('#step1-card .area-clear'), c = getComputedStyle(b), h = document.getElementById('h3-hint').getBoundingClientRect(); return {disabled: b.disabled, cursor: c.cursor, title: b.title, opacity: c.opacity}; })()")
    assert look == {"disabled": True, "cursor": "default", "title": "", "opacity": "1"}, look
    assert "Click a hexagon" in text()
    level(9)
    show(page, *MONACO, 13.5 if phone else 14.5)    # on a phone, six cells around one fit in the 390 px
    centre = h3(page, "return h3.latLngToCell(args[0], args[1], 9);", MONACO[1], MONACO[0])
    ring = h3(page, "return h3.gridDiskDistances(args[0], 1)[1];", centre)

    # six cells around one: a polygon with a hole
    for c in ring:
        pick(c)
    cells(6)
    assert page.evaluate("document.body.classList.contains('h3')") and not page.evaluate("document.querySelector('#step1-card .area-clear').disabled")
    f = saved()
    g = f["geometry"]
    assert g["type"] == "Polygon" and len(g["coordinates"]) == 2, ("one polygon with a hole", g["type"], len(g["coordinates"]))
    assert f["properties"]["source"] == "h3" and f["properties"]["h3_level"] == 9 and f["properties"]["h3_cells"] == 6, f["properties"]
    cx, cy = h3(page, "const [lat, lng] = h3.cellToLatLng(args[0]); return [lng, lat];", centre)
    assert not inside((cx, cy), g), "the middle of the ring is a hole"
    total = sum(h3(page, "return h3.cellArea(args[0], 'km2');", c) for c in ring)
    got = page.inner_text("#summary .rs-kpi-val")
    assert abs(float(got.replace(",", "")) - total) < 0.02 * total + 0.01, ("the area of card 2 is the area of the cells", got, total)
    assert f"{total:.2f}"[:3] in text(), (text(), total)
    assert page.inner_text("#summary .rs-kpi:nth-child(2) .rs-kpi-val") == "1"
    page.screenshot(path=str(out / f"{name}-1-ring.png"))
    # a seventh click fills the hole; a click on a picked cell removes it
    pick(centre)
    cells(7)
    f = saved()
    assert f["geometry"]["type"] == "Polygon" and len(f["geometry"]["coordinates"]) == 1 and inside((cx, cy), f["geometry"]), "no hole"
    pick(centre)
    cells(6)
    # work in a later card ends the picking: a click on the map then picks nothing; a click in card 1 starts it again (h3Mode)
    page.dispatch_event("#step4-card", "click")
    assert not page.evaluate("document.body.classList.contains('h3')"), "a click in card 4 ends the picking of hexagons"
    pick(centre)
    page.wait_for_timeout(800)                  # time for a pick to act, if picking were still on
    cells(6)
    page.dispatch_event("#step1-card", "click")
    assert page.evaluate("document.body.classList.contains('h3')"), "a click in card 1 starts it again"
    # Unselect removes the cells and the area
    click("#step1-card .area-clear")
    cells(0)
    assert page.inner_text("#summary") == "" and page.evaluate("document.querySelector('#step1-card .area-clear').disabled && document.getElementById('save').disabled")
    # the Search tab takes H3 IDs: one cell, then seven; the name is the ID (the first cell and "-plus-6"); a wrong ID says so
    def search_ids(text_):
        click("#tab-find")
        page.fill("#q", text_)
        page.keyboard.press("Enter")

    search_ids(centre)
    cells(1)
    assert page.get_attribute("#tab-h3", "aria-selected") == "true" and page.input_value("#name") == centre, (page.input_value("#name"), centre)
    assert page.evaluate("window.h3Cells.has(" + json.dumps(centre) + ")") and page.get_attribute("#h3-level", "value") in (None, "9") or page.input_value("#h3-level") == "9"
    page.wait_for_function("!duckMap.isMoving()")
    search_ids(" ".join([centre, *ring]))
    cells(7)
    assert page.input_value("#name") == f"{centre}-plus-6", page.input_value("#name")
    page.fill("#name", "my hexagons")
    pick(ring[0])
    cells(6)
    assert page.input_value("#name") == "my hexagons", "a name that the person typed stays"
    search_ids("123456789abcdef")
    page.wait_for_function("document.getElementById('found').textContent.includes('not an H3 cell ID')", timeout=10_000)
    click("#tab-h3")
    click("#step1-card .area-clear")
    cells(0)
    # two cells that do not touch are two polygons
    far = h3(page, "return h3.gridDiskDistances(args[0], 2)[2][0];", centre)
    pick(centre)
    pick(far)
    cells(2)
    assert page.inner_text("#summary .rs-kpi:nth-child(2) .rs-kpi-val") == "2"
    page.screenshot(path=str(out / f"{name}-2-two.png"))
    click("#step1-card .area-clear")
    cells(0)

    if phone:
        # the picked cells stay above the sheet
        for c in ring[:3]:
            pick(c)
        cells(3)
        sheet = page.evaluate("document.getElementById('sb').getBoundingClientRect().top")
        assert all(where(page, c)[1] < sheet for c in ring[:3]), ("the cells are above the sheet", sheet)
        page.screenshot(path=str(out / "phone-3-picked.png"))
        return page.context.close()

    # a click on another tab: the cells go when another way makes the area
    for c in ring[:2]:
        pick(c)
    cells(2)
    click("#tab-draw")
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.h3Cells.size === 0 && window.areas >= 1", timeout=60_000)
    assert page.evaluate("duckMap.getSource('h3cells').serialize().data.features.length") == 0, "the outlines go with the cells"
    click("#tab-h3")
    assert "Click a hexagon" in text()
    # another level removes the cells
    for c in ring[:2]:
        pick(c)
    cells(2)
    level(8)
    page.wait_for_function("window.h3Cells.size === 0")
    assert "The cells are removed" in text() and page.evaluate("document.querySelector('#step1-card .area-clear').disabled"), text()
    assert page.inner_text("#summary") == "", "the area goes with the cells"
    # the cap: level 5 (253 km2 each) allows 19 cells in 5,000 km2
    level(5)
    show(page, *MONACO, 8)
    c5 = h3(page, "return h3.latLngToCell(args[0], args[1], 5);", MONACO[1], MONACO[0])
    many = h3(page, "return h3.gridDisk(args[0], 3).sort((a, b) => h3.gridDistance(args[0], a) - h3.gridDistance(args[0], b));", c5)
    for c in many[:19]:
        pick(c)
    cells(19)
    pick(many[19])
    page.wait_for_function("document.getElementById('h3-hint').textContent.includes('most km')", timeout=10_000)
    cells_now = page.evaluate("window.h3Cells.size")
    assert cells_now == 19, cells_now
    assert page.evaluate("document.querySelector('#step1-card .area-clear').disabled") is False
    page.screenshot(path=str(out / "desk-3-cap.png"))
    click("#step1-card .area-clear")
    cells(0)

    # a build of Monaco from the cells
    level(9)
    show(page, *MONACO, 14.5)
    for c in [centre, *ring]:
        pick(c)
    cells(7)
    box = h3(page, "const p = args[0].flatMap((c) => h3.cellToBoundary(c, true)); return [Math.min(...p.map((x) => x[0])), Math.min(...p.map((x) => x[1])), Math.max(...p.map((x) => x[0])), Math.max(...p.map((x) => x[1]))];", [centre, *ring])
    page.wait_for_function("!document.getElementById('save').disabled", timeout=60_000)
    page.click("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    page.wait_for_function("!document.getElementById('run').disabled", timeout=60_000)
    page.click("#run")
    page.wait_for_function("!document.getElementById('run').hasAttribute('aria-busy') && !document.getElementById('step7-card').classList.contains('off')", timeout=600_000)
    n = page.evaluate("window.duckApi.query('SELECT count(*) AS n, min(ST_XMin(geometry)) AS w, min(ST_YMin(geometry)) AS s, max(ST_XMax(geometry)) AS e, max(ST_YMax(geometry)) AS n2 FROM driving.edges').then((r) => r.toArray().map((x) => x.toJSON()))")[0]
    pad = 0.01     # a road that crosses the border is kept whole
    assert n["n"] > 0 and n["w"] > box[0] - pad and n["s"] > box[1] - pad and n["e"] < box[2] + pad and n["n2"] < box[3] + pad, (n, box)
    print("build from the cells:", n["n"], "driving edges")
    # a build from hexagons hides them (the boundary of the area stays, like for another area); the H3 tab shows them again
    assert set(vis()) == {"none"} and not row.evaluate("(c) => c.checked"), (vis(), row.evaluate("(c) => c.checked"))
    assert page.evaluate("duckMap.getLayer('area-line') !== undefined && duckMap.getLayoutProperty('area-line', 'visibility') !== 'none'"), "the boundary stays"
    if "folded" in (page.get_attribute("#step1-card", "class") or ""):
        click("#step1")                         # the build ended the picking, and card 1 folded with the other finished steps
    click("#tab-h3")
    page.wait_for_function("(duckMap.getLayoutProperty('h3-grid', 'visibility') ?? 'visible') === 'visible'", timeout=10_000)
    assert row.evaluate("(c) => c.checked")
    page.screenshot(path=str(out / "desk-4-built.png"))
    page.context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch()
    if len(sys.argv) < 3: run(browser, phone=False)
    run(browser, phone=True)
    browser.close()
assert not errors, errors
print("ok")
