"""Screenshots of every card of the panel (step 1 with its three tabs and the Draw states, then cards 2 to 7 and the footer after a Monaco build), for a
review of the layout: python cards_shots.py <label> [out folder]. A computer and a phone, light and dark. It writes <label>-<mode>-<card>.png."""
import pathlib
import sys

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
label = sys.argv[1]
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else f"out-cards-{label}")
out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html?maxroads=0"
CARDS = {"step1": "step1-card", "step2": "step2-card", "step3": "extracts-box", "step4": "step4-card", "step5": "step5-card", "step6": "step6-card", "step7": "step7-card"}


def page_of(browser, dark, phone):
    ctx = dict(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2) if phone else dict(viewport={"width": 1400, "height": 900})
    page = browser.new_context(**ctx).new_page()
    page.goto(url)
    page.wait_for_function("window.mapReady", timeout=120_000)
    page.wait_for_function("window.duckMap.isStyleLoaded()", timeout=60_000)
    if dark:
        page.evaluate("rsSetTheme('dark')")
    if phone:
        page.evaluate("rs.sheet(2)")                      # the full sheet: a card is whole
    page.wait_for_timeout(800)
    return page


def card(page, name, key, tag):
    page.evaluate(f"rs.sections.fold('{key}', false)")
    page.wait_for_timeout(250)
    page.locator(f"#{CARDS[key]}").screenshot(path=str(out / f"{label}-{name}-{tag}.png"))


def run(browser, name, dark=False, phone=False):
    # ---- step 1: the three tabs and the Draw states (empty, drawing, done)
    page = page_of(browser, dark, phone)
    card(page, name, "step1", "1a-search")
    page.click("#tab-draw") if not phone else page.tap("#tab-draw")
    page.wait_for_timeout(300)
    card(page, name, "step1", "1b-draw-empty")
    page.click("[data-mode=rectangle]") if not phone else page.tap("[data-mode=rectangle]")
    if not phone:
        page.mouse.move(700, 300)
        page.mouse.down()
        page.mouse.move(900, 450, steps=6)
        page.wait_for_timeout(300)
        card(page, name, "step1", "1c-draw-drawing")
        page.mouse.up()
        page.wait_for_timeout(600)
        card(page, name, "step1", "1d-draw-done")
        page.evaluate("rs.sections.fold('step2', false)")
        card(page, name, "step2", "2b-area-drawn")
    page.click("#tab-file") if not phone else page.tap("#tab-file")
    page.wait_for_timeout(300)
    card(page, name, "step1", "1e-file")
    page.context.close()
    # ---- the cards after a Monaco build
    page = page_of(browser, dark, phone)
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    card(page, name, "step2", "2-area")
    (page.tap if phone else page.click)("#step3")
    page.wait_for_timeout(300)
    card(page, name, "step3", "3a-data-empty")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    page.wait_for_timeout(500)
    card(page, name, "step3", "3b-data-ready")
    card(page, name, "step4", "4a-build-ready")
    page.evaluate("document.getElementById('run').click()")
    page.wait_for_function("!document.getElementById('step5-card').classList.contains('off')", timeout=900_000)
    page.wait_for_function("!document.getElementById('run').disabled", timeout=300_000)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    page.wait_for_timeout(1000)
    for key, tag in (("step4", "4b-built"), ("step5", "5-result"), ("step6", "6-visualization"), ("step7", "7-edit")):
        card(page, name, key, tag)
    page.locator("footer.sb-foot").screenshot(path=str(out / f"{label}-{name}-8-footer.png"))
    page.context.close()
    print(f"{label} {name}: done")


with sync_playwright() as p:
    browser = p.chromium.launch()
    run(browser, "desktop")
    run(browser, "desktop-dark", dark=True)
    run(browser, "phone", phone=True)
    run(browser, "phone-dark", dark=True, phone=True)
    browser.close()
server.shutdown()
