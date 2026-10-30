"""The area steps of the app (index.html) in headless Chromium (Playwright): a file, rectangles drawn and moved
with the mouse, Merge shapes, a search, and the Build button. Each output file must have the format of `duckosm
boundary` (docs/boundary_tool.md, docs/app.md). e2e.py tests the build.

    python crates/duckosm-wasm/www/boundary_e2e.py [--no-search]

The page loads MapLibre, terra-draw and polyclip-ts from cdn.jsdelivr.net and the map from OpenFreeMap, so the
computer needs the network. If Photon or Nominatim does not answer, the test skips the search and says so.
"""
import argparse
import json
import pathlib

from playwright.sync_api import sync_playwright

from serve import start

WWW = pathlib.Path(__file__).resolve().parent
MONACO = WWW.parents[2] / "tests/data/monaco.geojson"
KEYS = {"name", "osm_id", "admin_level", "area_km2", "source", "geofabrik"}

a = argparse.ArgumentParser()
a.add_argument("--no-search", action="store_true", help="do not ask Photon and Nominatim")
args = a.parse_args()

server = start(0, quiet=True)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"


def areas(page):
    """The number of areas that the page finished."""
    return page.evaluate("window.areas ?? 0")


def boundary(page, ready):
    """Wait until the page finished `ready` areas, download boundary.geojson and check its format; returns the
    Feature."""
    page.wait_for_function(f"(window.areas ?? 0) >= {ready}")
    with page.expect_download() as d:
        page.click("#save")
    g = json.loads(pathlib.Path(d.value.path()).read_text())
    assert g["type"] == "FeatureCollection" and len(g["features"]) == 1, g
    f = g["features"][0]
    assert f["type"] == "Feature" and set(f["properties"]) == KEYS, f["properties"]
    assert f["geometry"]["type"] in ("Polygon", "MultiPolygon")
    assert all({"id", "name", "pbf"} == set(x) for x in f["properties"]["geofabrik"])
    return f



def step_tab(page, tab):
    """a tab of step 1 or step 3; the page folds a card when its step is done (a click on the heading opens it)"""
    card, head = ("extracts-box", "#step3") if tab in ("#tab-region", "#tab-overpass", "#tab-cut") else ("step1-card", "#step1")
    if page.evaluate(f"document.getElementById('{card}').classList.contains('folded')"):
        page.click(head)
    page.click(tab)

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--enable-unsafe-swiftshader"])
    page = browser.new_page(accept_downloads=True, viewport={"width": 1200, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.mapReady", timeout=60_000)

    # a file
    step_tab(page, "#tab-file")
    n = areas(page)
    page.set_input_files("#file", str(MONACO))
    f = boundary(page, n + 1)
    pr = f["properties"]
    assert pr["area_km2"] == 2.39 and pr["name"] == "Monaco" and pr["geofabrik"][0]["id"] == "monaco", pr
    print("file: ok,", pr["area_km2"], "km²,", [x["id"] for x in pr["geofabrik"]])

    # a click on an extract shows it, a second click hides it again
    alps = page.locator("#extracts input").nth(2)
    alps.click()
    assert alps.is_checked()
    alps.click()
    assert not alps.is_checked()
    print("extract: ok, shown and hidden")

    # two rectangles that overlap, drawn with mouse drags: one polygon. The panel covers the left side of the
    # map, so the drags are on the right side.
    box = page.locator("#map canvas").bounding_box()
    assert box

    def drag(x0, y0, x1, y1):
        page.mouse.move(box["x"] + x0 * box["width"], box["y"] + y0 * box["height"])
        page.mouse.down()
        page.mouse.move(box["x"] + x1 * box["width"], box["y"] + y1 * box["height"], steps=10)
        page.mouse.up()
        page.wait_for_timeout(300)

    step_tab(page, "#tab-draw")
    n = areas(page)
    for rect in [(0.45, 0.3, 0.6, 0.5), (0.55, 0.4, 0.75, 0.6)]:
        page.click("[data-mode=rectangle]")
        drag(*rect)
    f = boundary(page, n + 2)
    g, pr = f["geometry"], f["properties"]
    assert pr["source"] == "drawn" and pr["osm_id"] is None and pr["area_km2"] > 0, pr
    assert g["type"] == "Polygon" and len(g["coordinates"][0]) == 9, g  # the merge of the two: 8 vertices
    print("rectangles: ok,", pr["area_km2"], "km²")

    # the second rectangle is selected after the draw: a drag moves it away from the first one
    n = areas(page)
    drag(0.65, 0.5, 0.8, 0.5)
    f = boundary(page, n + 1)
    g = f["geometry"]
    assert g["type"] == "MultiPolygon" and len(g["coordinates"]) == 2, g
    print("move: ok,", f["properties"]["area_km2"], "km²")

    # a third rectangle over the two, then Merge shapes: one shape on the map, so Delete shape empties the area
    n = areas(page)
    page.click("[data-mode=rectangle]")
    drag(0.5, 0.45, 0.85, 0.55)
    boundary(page, n + 1)
    assert page.is_enabled("#merge")
    n = areas(page)
    page.click("#merge")
    f = boundary(page, n + 1)
    assert f["geometry"]["type"] == "Polygon", f["geometry"]
    page.wait_for_function("document.getElementById('merge').disabled && !document.getElementById('delete').disabled")
    page.click("#delete")
    page.wait_for_function("document.getElementById('save').disabled")
    print("merge: ok,", f["properties"]["area_km2"], "km²,", len(f["geometry"]["coordinates"][0]) - 1, "vertices")

    # a search
    if not args.no_search:
        step_tab(page, "#tab-find")
        n = areas(page)
        page.fill("#q", "Monaco")
        page.press("#q", "Enter")
        page.wait_for_function("!document.getElementById('found').textContent.startsWith('Searching')", timeout=30_000)
        hit = page.locator("#found input:not([disabled])").first
        if hit.count():
            hit.check()
            f = boundary(page, n + 1)
            print("search: ok,", f["properties"]["name"], f["properties"]["source"], f["properties"]["area_km2"], "km²")
            assert "Monaco-Ville" in page.inner_text("#found")
            # after a selection, the other places of the list do not show on the map (Kaveh); a new search shows them again
            shown = lambda: page.evaluate("window.duckMap.getSource('preview').serialize().data.features?.length ?? 1")
            page.locator("#found label").nth(2).hover()
            page.wait_for_timeout(300)
            assert shown() == 0, "another place of the list showed after a selection"
            # a search while the user types, with no Enter
            page.fill("#q", "stockholm")
            page.wait_for_function("document.getElementById('found').textContent.includes('Stockholms län')", timeout=30_000)
            page.locator("#found label").first.hover()
            page.wait_for_function("window.duckMap.getSource('preview').serialize().data.geometry != null", timeout=10_000)
            print("search as you type: ok; after a selection only the selected place shows, a new search shows its list again")
        else:
            print("search: skipped,", page.inner_text("#found"))

    # Build: on when the area and its data are ready (step 3), off without a region file
    step_tab(page, "#tab-file")
    n = areas(page)
    page.set_input_files("#file", str(MONACO))
    boundary(page, n + 1)
    step_tab(page, "#tab-region")
    assert page.is_disabled("#run"), "Build is on without a region file"
    page.set_input_files("#region", str(MONACO.with_name("monaco_sample.osm.pbf")))
    assert page.is_enabled("#run"), "Build is off with an area and a region file"
    step_tab(page, "#tab-overpass")
    assert page.is_enabled("#run"), "Build is off with an area and Overpass"
    print("build button: ok")

    assert not errors, errors
    browser.close()
server.shutdown()
