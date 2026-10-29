"""The tile format of the roads map in headless Chromium (Playwright): build Monaco, draw the roads on the blank base map,
and check (1) MVT is the default, the tile address has `f=mvt` and the source has no encoding; (2) the setting "Map tiles" = MLT gives
the style with the encoding `mlt`, `f=mlt` in the address and the same picture (a small share of pixels may differ); the choice is kept
in the storage of the browser; MVT again gives the first picture.

    python crates/duckosm-wasm/www/tile_format_e2e.py [out folder]

It uses tests/data/monaco.osm.pbf and tests/data/monaco.geojson. Build the page first (docs/development.md, "WebAssembly").
"""
import io
import pathlib
import sys

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-tile-format")
out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
SOURCES = "Object.values(window.duckMap.getStyle().sources).filter((s) => s.type === 'vector' && s.tiles)"
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1000, "height": 700})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    page.evaluate("localStorage.removeItem('duckosm.tileformat')")
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-cut")
    page.set_input_files("#pbf", str(ROOT / "tests/data/monaco.osm.pbf"))
    page.click("#run")
    page.wait_for_function("!document.getElementById('step5-card').hidden", timeout=300_000)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent)", timeout=300_000)
    page.click("#bbase")
    page.click("input[name=base][value='blank']")
    page.keyboard.press("Escape")

    def settle():
        page.wait_for_function("window.duckMap.loaded() && !window.duckMap.isMoving()", timeout=60_000)
        page.wait_for_timeout(800)

    def picture(name):
        settle()
        # the part of the map that the panel and the bar leave free: the panel's list shows another text for each format
        left = page.evaluate("Math.ceil(Math.max(document.getElementById('sb').getBoundingClientRect().right, document.getElementById('rs-toolbar').getBoundingClientRect().right)) + 8")
        png = page.screenshot(path=str(out / f"{name}.png"), clip={"x": left, "y": 0, "width": 1000 - left, "height": 700})
        return np.asarray(Image.open(io.BytesIO(png)).convert("RGB")).astype(int)

    def addresses():
        return page.evaluate(f"{SOURCES}.flatMap((s) => s.tiles)")

    assert page.input_value("#tilefmt") == "mvt", "MVT is not the default"
    a = addresses()
    assert a and all("&f=mvt" in u and "?g=" in u for u in a), a
    assert not any(s.get("encoding") for s in page.evaluate(SOURCES)), "MVT: the source has an encoding"
    mvt = picture("mvt")
    print(f"MVT: {len(a)} source address(es), e.g. {a[0]}")

    def choose(page, id, text):
        """A choice in roadstyle's list (selectbox.js shows a button and a list in place of the select)."""
        page.locator(f".rs-sel:has(#{id}) .rs-sel-btn").click()
        page.locator(".rs-sel-opt", has_text=text).first.click()

    def diff(x, y):
        return float((np.abs(x - y).max(axis=2) > 8).mean())

    choose(page, "tilefmt", "MLT")
    page.wait_for_function("window.duckApi.tileFormat === 'mlt'")
    page.wait_for_function(f"{SOURCES}.every((s) => s.encoding === 'mlt' && s.tiles.every((u) => u.includes('&f=mlt')))")
    mlt = picture("mlt")
    assert page.evaluate("localStorage.getItem('duckosm.tileformat')") == "mlt"
    assert page.evaluate("window.duckApi.tileStats.length") > 0, "no tile of the MLT style"
    d = diff(mvt, mlt)
    print(f"MLT: encoding mlt, f=mlt in the address, {d * 100:.3f} % of the pixels differ from MVT")
    assert d < 0.005, d

    choose(page, "tilefmt", "MVT")
    page.wait_for_function(f"{SOURCES}.every((s) => !s.encoding && s.tiles.every((u) => u.includes('&f=mvt')))")
    d = diff(mvt, picture("mvt-again"))
    print(f"MVT again: {d * 100:.3f} % of the pixels differ from the first MVT picture")
    assert d < 0.005, d

    assert not errors, errors
    browser.close()
server.shutdown()
