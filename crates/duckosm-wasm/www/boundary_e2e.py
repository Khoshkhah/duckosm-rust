"""The boundary tool in headless Chromium (Playwright): a file, rectangles drawn and moved with the mouse, Merge
shapes, a search, and the hand-off to index.html. Each output file must have the format of `duckosm boundary`
(docs/boundary_tool.md).

    python crates/duckosm-wasm/www/boundary_e2e.py [--no-search]

The page loads MapLibre, terra-draw and polyclip-ts from cdn.jsdelivr.net and the map from OpenFreeMap, so the
computer needs the network. If Nominatim does not answer, the test skips the search and says so.
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
a.add_argument("--no-search", action="store_true", help="do not ask Nominatim")
args = a.parse_args()

server = start(0, quiet=True)
url = f"http://127.0.0.1:{server.server_address[1]}/boundary.html"


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


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--enable-unsafe-swiftshader"])
    page = browser.new_page(accept_downloads=True, viewport={"width": 1200, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.mapReady", timeout=60_000)

    # a file
    page.click("#tab-file")
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

    page.click("#tab-draw")
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
        page.click("#tab-find")
        n = areas(page)
        page.fill("#q", "Monaco")
        page.press("#q", "Enter")
        page.wait_for_function("!document.getElementById('found').textContent.startsWith('Searching')", timeout=30_000)
        hit = page.locator("#found input:not([disabled])").first
        if hit.count():
            hit.check()
            f = boundary(page, n + 1)
            print("search: ok,", f["properties"]["name"], f["properties"]["source"], f["properties"]["area_km2"], "km²")
        else:
            print("search: skipped,", page.inner_text("#found"))

    # the hand-off to index.html
    page.click("#tab-file")
    n = areas(page)
    page.set_input_files("#file", str(MONACO))
    boundary(page, n + 1)
    page.click("#use")
    page.wait_for_url("**/index.html")
    page.wait_for_function("!document.getElementById('area').textContent.startsWith('No boundary')")
    area = page.inner_text("#area")
    assert area.startswith("Monaco, 2.39 km², from the boundary tool"), area
    print("hand-off: ok,", area.splitlines()[0])

    assert not errors, errors
    browser.close()
server.shutdown()
