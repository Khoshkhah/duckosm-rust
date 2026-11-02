"""The buffer of the area (docs/app.md, "The buffer") in headless Chromium: load the Monaco boundary, set the buffer to 500 m, and check
that the area grows as a buffer should (more than the boundary's length times 250 m, and at most the boundary's length times 500 m plus
a disc of 500 m), that the saved GeoJSON is the grown area with `buffer_m`, and that a buffer of 0 gives the first area again.
Writes buffer-desktop.png and buffer-phone.png.

    python crates/duckosm-wasm/www/buffer_e2e.py <out folder> [--www folder]
"""
import argparse
import json
import math
import pathlib

from playwright.sync_api import sync_playwright

from serve import start

WWW = pathlib.Path(__file__).resolve().parent
GEOJSON = WWW.parents[2] / "tests" / "data" / "monaco.geojson"

a = argparse.ArgumentParser()
a.add_argument("out")
a.add_argument("--www", default=str(WWW))
args = a.parse_args()
out = pathlib.Path(args.out)
out.mkdir(parents=True, exist_ok=True)
D = 500.0


def rings(g):
    g = g["features"][0]["geometry"] if g["type"] == "FeatureCollection" else g
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    return [r for p in polys for r in p[:1]]   # the outer rings


def metres(ring):
    lat0 = sum(c[1] for c in ring) / len(ring)
    k = math.pi / 180 * 6371008.8
    return [(c[0] * k * math.cos(math.radians(lat0)), c[1] * k) for c in ring]


def area_km2(g):
    return sum(abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(m, m[1:] + m[:1]))) / 2 for m in map(metres, rings(g))) / 1e6


def length_m(g):
    return sum(math.dist(p, q) for m in map(metres, rings(g)) for p, q in zip(m, m[1:] + m[:1]))


boundary = json.loads(GEOJSON.read_text())
a0, perimeter = area_km2(boundary), length_m(boundary)
server = start(0, quiet=True, directory=args.www)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"


def shown_km2(page):
    return float(page.inner_text("#summary .stat b").replace(",", ""))


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(accept_downloads=True, viewport={"width": 1280, "height": 720})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    assert page.input_value("#buffer") == "0", "the buffer is 0 m by default"
    page.set_input_files("#file", str(GEOJSON))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    first = shown_km2(page)
    assert abs(first - a0) / a0 < 0.02, (first, a0)
    print(f"area without a buffer: {first} km2 (computed here: {a0:.2f})")

    if not page.is_visible("#buffer"):
        page.click("#step2")      # card 2 folds when an area is chosen
    page.fill("#buffer", str(int(D)))
    page.wait_for_function("window.areas >= 2", timeout=60_000)
    grown = shown_km2(page)
    low, high = a0 + perimeter * D / 2e6, a0 + (perimeter * D + math.pi * D * D) / 1e6
    print(f"area with a buffer of {D:.0f} m: {grown} km2 (it must be between {low:.2f} and {high:.2f})")
    assert low < grown <= high * 1.02, (grown, low, high)
    assert "m buffer" in page.inner_text("#summary")
    with page.expect_download() as d:
        page.click("#save")
    saved = json.loads(pathlib.Path(d.value.path()).read_text())
    assert saved["features"][0]["properties"]["buffer_m"] == D, saved["features"][0]["properties"]
    assert abs(area_km2(saved) - grown) / grown < 0.02, (area_km2(saved), grown)
    print("the saved GeoJSON is the grown area, with buffer_m =", D)
    page.screenshot(path=str(out / "buffer-desktop.png"))

    page.fill("#buffer", "0")
    page.wait_for_function("window.areas >= 3", timeout=60_000)
    assert shown_km2(page) == first, (shown_km2(page), first)
    assert "m buffer" not in page.inner_text("#summary")
    print("a buffer of 0 gives the first area again")
    page.set_viewport_size({"width": 390, "height": 664})
    page.fill("#buffer", "250")
    page.wait_for_function("window.areas >= 4", timeout=60_000)
    page.screenshot(path=str(out / "buffer-phone.png"))
    browser.close()

assert not errors, errors
print("OK")
