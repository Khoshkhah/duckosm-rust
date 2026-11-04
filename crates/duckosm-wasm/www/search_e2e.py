"""Step 1, the Search tab (docs/app.md): a selected place gives its boundary and the map zooms to it. When Nominatim fails (a rule of the network, a limit), the map still
moves to the box of the place, the text stays under the list, a second click asks again, and "use the box of the place" makes the area.

    python crates/duckosm-wasm/www/search_e2e.py

It needs the network: photon.komoot.io, and nominatim.openstreetmap.org for the first part.
"""
import time

from playwright.sync_api import sync_playwright

from serve import WWW, start

server = start(0, quiet=True, directory=WWW)
base = f"http://127.0.0.1:{server.server_address[1]}/"
errors = []


def search(page, name):
    page.fill("#q", name)
    page.keyboard.press("Enter")
    page.wait_for_selector("#found label", timeout=30_000)


with sync_playwright() as p:
    browser = p.chromium.launch()
    # a place: the boundary and the zoom
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base)
    page.wait_for_function("window.mapReady", timeout=120_000)
    z0 = page.evaluate("duckMap.getZoom()")
    search(page, "Tartu")
    page.click("#found label >> nth=0")
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['area-line']}).length > 0 && !duckMap.isMoving()", timeout=30_000)
    z1 = page.evaluate("duckMap.getZoom()")
    assert z1 > z0 + 4, (z0, z1)
    print(f"a place: the boundary shows and the map zoomed from {z0:.1f} to {z1:.1f}")
    page.close()

    # Nominatim fails: the map moves to the box at once, the text stays, a second click asks again, and the box can be the area
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("https://nominatim.openstreetmap.org/**", lambda r: r.fulfill(status=429, body="{}"))
    page.goto(base)
    page.wait_for_function("window.mapReady", timeout=120_000)
    z0 = page.evaluate("duckMap.getZoom()")
    search(page, "Tartu")
    page.click("#found label >> nth=0")
    page.wait_for_selector("#found-err", timeout=30_000)
    assert "429" in page.inner_text("#found-err") and not page.is_checked("#found input >> nth=0"), page.inner_text("#found-err")
    page.wait_for_function("!duckMap.isMoving()")
    assert page.evaluate("duckMap.getZoom()") > z0 + 4, "the map moved to the box of the place"
    assert page.evaluate("window.areas || 0") == 0
    page.click("#use-box")
    page.wait_for_function("window.areas >= 1", timeout=30_000)
    assert page.locator("#found-err").count() == 0 and float(page.inner_text("#summary .stat b").replace(",", "")) > 1
    print("Nominatim fails: the map zoomed to the box, the text and the box button show, and the box is the area")

    # a slow file at the start (a test page behind an ssh tunnel): the map's `load` comes during the wait, and the page must not lose it (the area, the zoom and the layers came from it)
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/local_keys.json", lambda r: (time.sleep(4), r.fulfill(status=404, body=""))[1])
    page.goto(base)
    page.wait_for_function("window.mapReady", timeout=120_000)
    z0 = page.evaluate("duckMap.getZoom()")
    search(page, "Tartu")
    page.click("#found label >> nth=0")
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['area-line']}).length > 0 && !duckMap.isMoving()", timeout=30_000)
    assert page.evaluate("duckMap.getZoom()") > z0 + 4
    print("a slow start: the area shows and the map zooms as with a fast start")
    page.close()
    browser.close()
assert not errors, errors
print("search_e2e.py: passed")
