"""A phone-size check of the Design panel: every tab at 390 x 844 has no horizontal overflow, the tabs and the bar are in view, and the card opens the panel (roadstyle's design panel, docs/app.md)."""
import pathlib
import sys

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-phone-design")
out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120000)
    page.evaluate("localStorage.clear()")
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60000)
    page.click("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    page.click("#run")
    page.wait_for_function("!document.getElementById('run').hasAttribute('aria-busy') && !document.getElementById('step7-card').classList.contains('off')", timeout=600000)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600000)
    # the card opens the panel in the sheet (a tap, as on a phone)
    if "folded" in (page.get_attribute("#step9-card", "class") or ""):
        page.evaluate("document.getElementById('step9').click()")
    page.evaluate("document.getElementById('step9').click()")
    page.wait_for_timeout(800)
    assert page.evaluate("window.designPanel.isOpen()")

    def check(tab):
        page.evaluate(f"window.designPanel.tab('{tab}')")
        page.wait_for_timeout(500)
        m = page.evaluate("""() => {
            const b = document.querySelector('#design-panel .rs-dz-body'), r = document.getElementById('design-panel').getBoundingClientRect();
            const wide = [...document.querySelectorAll('#design-panel *')].filter((e) => e.offsetParent && e.getBoundingClientRect().right > r.right + 1).map((e) => e.id || e.className || e.tagName).slice(0, 4);
            const tabs = document.querySelector('#design-tabs').getBoundingClientRect(), bar = document.querySelector('#design-panel .rs-dz-bar').getBoundingClientRect();
            return {scrollW: b.scrollWidth, clientW: b.clientWidth, docW: document.documentElement.scrollWidth, inner: innerWidth, wide,
                    tabsIn: tabs.left >= 0 && tabs.right <= innerWidth, barIn: bar.bottom <= innerHeight + 1 && bar.height > 0, tabTexts: [...document.querySelectorAll('#design-panel [role=tab]')].every((t) => t.scrollWidth <= t.clientWidth + 1)};
        }""")
        page.screenshot(path=str(out / f"phone-{tab}.png"))
        assert m["scrollW"] <= m["clientW"] + 1 and m["docW"] <= m["inner"] + 1 and not m["wide"] and m["tabsIn"] and m["barIn"] and m["tabTexts"], (tab, m)
        return m
    page.evaluate("window.designPanel.tab('theme')")
    page.fill("#mine-name", "Phone theme")
    page.evaluate("document.getElementById('mine-save').click()")           # a saved theme: its card has three buttons that must fit
    page.wait_for_selector("[data-mine=phone-theme]")
    for t in ("theme", "roads", "text", "layers", "tiles"):
        print(t, check(t))
    assert not errs, errs
    b.close()
    server.shutdown()
print("phone_design_e2e: passed")
