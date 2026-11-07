"""A phone-size check of the fixes panel: every tab at 390 x 844 has no horizontal overflow, and the bars are in view (docs/osm-editing.md)."""
import pathlib, sys
from playwright.sync_api import sync_playwright
from serve import WWW, start
ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-phone-fix"); out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
ROAD = 503462470
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    errs = []; page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(url); page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120000)
    page.evaluate("localStorage.clear()")
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson")); page.wait_for_function("window.areas >= 1", timeout=60000)
    page.click("#tab-region"); page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf")); page.click("#run")
    page.wait_for_function("!document.getElementById('run').hasAttribute('aria-busy') && !document.getElementById('step7-card').classList.contains('off')", timeout=600000)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600000)
    page.evaluate("window.fixesPanel.open()"); page.wait_for_timeout(800)
    page.evaluate(f"window.fixesPanel.select('road', 'way', {ROAD})"); page.wait_for_function("document.querySelector('#fixf-lanes')", timeout=20000)
    page.fill("#fixf-lanes", "5"); page.click("#fix-save"); page.wait_for_timeout(300)
    def check(tab):
        page.evaluate(f"window.fixesPanel.tab('{tab}')"); page.wait_for_timeout(500)
        m = page.evaluate("""() => { const b = document.getElementById('fix-body'), r = document.getElementById('fix-panel').getBoundingClientRect();
            // (the tab row of roadstyle's frame is one row that scrolls sideways on a phone: its tabs can be past the edge)
            const wide = [...document.querySelectorAll('#fix-panel *')].filter((e) => e.offsetParent && !e.closest('#fix-tabs') && e.getBoundingClientRect().right > r.right + 1).map((e) => e.id || e.className || e.tagName).slice(0, 4);
            return {scrollW: b.scrollWidth, clientW: b.clientWidth, docW: document.documentElement.scrollWidth, inner: innerWidth, wide}; }""")
        page.screenshot(path=str(out / f"phone-{tab}.png"))
        assert m["scrollW"] <= m["clientW"] + 1 and m["docW"] <= m["inner"] + 1 and not m["wide"], (tab, m)
        return m
    for t in ("road", "building", "node", "turns", "new", "changes"): print(t, check(t))
    assert not errs, errs
    b.close(); server.shutdown()
print("phone_fixes_e2e: passed")
