"""The tile format of the roads map in headless Chromium (Playwright): build Monaco, draw the roads on the blank base map,
and check (1) MLT is the default (no stored choice), the tile address has `f=mlt` and the source has the encoding `mlt`; (2) the setting
"Map tiles" = MVT gives the style with no encoding, `f=mvt` in the address and the same picture (a small share of pixels may differ); the
choice is kept in the storage of the browser; MLT again gives the first picture.

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
    page.wait_for_function("!document.getElementById('step5-card').classList.contains('off')", timeout=300_000)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent)", timeout=300_000)
    page.click("#rs-toolbar .bm-ctrl .bm-icon")
    page.click("input[name=rs-bm][value='blank']")
    page.keyboard.press("Escape")

    def settle():
        page.wait_for_function("window.duckMap.loaded() && !window.duckMap.isMoving()", timeout=60_000)
        page.wait_for_timeout(800)

    def picture(name):
        settle()
        # the part of the map that the panel and the bar leave free: the panel's list shows another text for each format
        # (the panel is at the left, the bar at the right: the part between them)
        left, right = page.evaluate("[Math.ceil(document.getElementById('sb').getBoundingClientRect().right) + 8, Math.floor(document.getElementById('rs-toolbar').getBoundingClientRect().left) - 8]")
        png = page.screenshot(path=str(out / f"{name}.png"), clip={"x": left, "y": 0, "width": right - left, "height": 700})
        return np.asarray(Image.open(io.BytesIO(png)).convert("RGB")).astype(int)

    def addresses():
        return page.evaluate(f"{SOURCES}.flatMap((s) => s.tiles)")

    assert page.input_value("#tilefmt") == "mlt", "MLT is not the default"
    a = addresses()
    assert a and all("&f=mlt" in u and "?g=" in u for u in a), a
    assert all(s.get("encoding") == "mlt" for s in page.evaluate(SOURCES)), "MLT: the source has the encoding"
    assert page.evaluate("localStorage.getItem('duckosm.tileformat')") is None, "the default is not a stored choice"
    mlt = picture("mlt")
    assert page.evaluate("window.duckApi.tileStats.length") > 0, "no tile of the MLT style"
    print(f"MLT (the default): {len(a)} source address(es), e.g. {a[0]}")

    def choose(page, id, text):
        """A choice in roadstyle's list (selectbox.js shows a button and a list in place of the select)."""
        if page.evaluate("document.getElementById('step6-card').classList.contains('folded')"):
            page.click("#step6")                      # the page folds a card when its step is done
        page.locator(f".rs-sel:has(#{id}) .rs-sel-btn").click()
        page.locator(".rs-sel-opt", has_text=text).first.click()

    def diff(x, y):
        return float((np.abs(x - y).max(axis=2) > 8).mean())

    choose(page, "tilefmt", "MVT")
    page.wait_for_function("window.duckApi.tileFormat === 'mvt'")
    page.wait_for_function(f"{SOURCES}.every((s) => !s.encoding && s.tiles.every((u) => u.includes('&f=mvt')))")
    mvt = picture("mvt")
    assert page.evaluate("localStorage.getItem('duckosm.tileformat')") == "mvt"
    d = diff(mlt, mvt)
    print(f"MVT: no encoding, f=mvt in the address, {d * 100:.3f} % of the pixels differ from MLT")
    assert d < 0.005, d

    choose(page, "tilefmt", "MLT")
    page.wait_for_function(f"{SOURCES}.every((s) => s.encoding === 'mlt' && s.tiles.every((u) => u.includes('&f=mlt')))")
    d = diff(mlt, picture("mlt-again"))
    print(f"MLT again: {d * 100:.3f} % of the pixels differ from the first MLT picture")
    assert d < 0.005, d

    assert not errors, errors
    browser.close()
server.shutdown()
