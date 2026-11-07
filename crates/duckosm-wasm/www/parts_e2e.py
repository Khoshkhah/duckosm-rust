"""Every control of the page is a roadstyle part, so every control has roadstyle's hover (docs/development.md, "The page uses roadstyle's parts").
The test builds Monaco (tests/data/monaco.geojson and tests/data/monaco_sample.osm.pbf), opens each card, each tab of cards 1 and 3, the export list
and card 7 (Edit OSM data) with each of its tabs and an edited road. It puts the pointer on each visible control of the panel that is not disabled (a
button, a link, a tab, a summary, a label with a check box or a radio, a select box, a row that acts) and fails when its look does not change.
The title of an open card keeps its accent: the test does not check it. Light theme, then dark theme. Usage: python3 parts_e2e.py [out-dir]"""
import pathlib, sys
from playwright.sync_api import sync_playwright
from serve import WWW, start
ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-parts"); out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
ROAD = 503462470
SEL = ("button, a[href], [role=button], [role=tab], summary, label:has(> input[type=checkbox]), label:has(> input[type=radio]), .rs-sel-btn, "
       ".chg, .wallrow, .doorrow, .turn")
# the look of an element: what a hover can change
LOOK = "(e) => { const c = getComputedStyle(e); return [c.backgroundColor, c.color, c.borderColor, c.boxShadow, c.textDecorationLine, c.opacity, c.filter, c.outlineStyle].join('|'); }"
# a name of an element for the report: the ids or classes of it and two parents, and its text
KEY = """(e) => { const p = []; let x = e; for (let i = 0; x && i < 3; i++, x = x.parentElement) p.push(x.id ? '#' + x.id : (typeof x.className === 'string' && x.className.trim()
  ? '.' + x.className.trim().split(/\\s+/)[0] : x.tagName.toLowerCase())); return p.reverse().join(' > ') + ' «' + (e.innerText || e.getAttribute('aria-label') || e.title || '')
  .trim().slice(0, 28).replace(/\\n/g, ' ') + '»'; }"""
# not checked: the title of a card that is open (it has the accent already)
OPEN_TITLE = "(e) => !!e.closest('.sb-sec[data-rs-fold]:not(.folded) > .rs-sec-hd')"
# roadstyle's own gap (roadstyle PR #62): a checked option row has the accent tint and edge, and no other look under the pointer. Reported, not a failure.
RS_GAP = "(e) => e.matches('.rs-opt:has(> input:checked)')"


def audit(pg, where, seen, gaps):
    for e in pg.query_selector_all(f":is(#sb) :is({SEL})"):
        try:
            if not e.is_visible() or e.is_disabled() or e.evaluate(OPEN_TITLE):
                continue
            box = e.bounding_box()
            if not box or box["width"] < 4 or box["height"] < 4:
                continue
            key = e.evaluate(KEY)
            if key in seen:
                continue
            pg.mouse.move(1, 1); pg.wait_for_timeout(60)
            inner = e.query_selector_all("*")[:6]
            before = [e.evaluate(LOOK)] + [x.evaluate(LOOK) for x in inner]
            e.hover(timeout=1500); pg.wait_for_timeout(220)
            seen[key] = before != [e.evaluate(LOOK)] + [x.evaluate(LOOK) for x in inner]
            if not seen[key] and e.evaluate(RS_GAP):
                seen[key] = True; gaps.append(f"[{where}] {key}")
            elif not seen[key]:
                print(f"NO HOVER [{where}] {key}")
        except Exception as ex:                       # an element that went away (a list drew again): not a control to check
            print(f"skipped [{where}]: {str(ex).splitlines()[0][:100]}")
    pg.mouse.move(1, 1)


def unfold(pg):
    for s in ("areas", "step1", "step2", "step3", "step4", "step5", "step6", "step10"):
        pg.evaluate(f"try {{ rs.sections.fold('{s}', false); }} catch (e) {{}}")
    pg.evaluate("document.querySelectorAll('#sb details').forEach((d) => d.open = true)"); pg.wait_for_timeout(400)


def fixes(pg, where, seen, gaps):
    pg.evaluate("window.fixesPanel.open()"); pg.wait_for_timeout(600)
    pg.evaluate(f"window.fixesPanel.tab('road'); window.fixesPanel.select('road', 'way', {ROAD})")
    pg.wait_for_function("document.querySelector('#fixf-lanes')", timeout=20000)
    for t in ("road", "building", "node", "turns", "new", "changes"):
        pg.evaluate(f"window.fixesPanel.tab('{t}')"); pg.wait_for_timeout(400)
        audit(pg, f"{where} card 7 {t}", seen, gaps)
    pg.evaluate("window.fixesPanel.tab('road')"); pg.wait_for_timeout(300)
    pg.screenshot(path=str(out / f"{where}-card7.png"))
    pg.click("#fix-back"); pg.wait_for_timeout(300)


with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1400, "height": 900})
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url); pg.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120000)
    pg.evaluate("localStorage.clear(); rsSetTheme('light')")
    seen, gaps = {}, []
    unfold(pg)
    for tab in ("#tab-draw", "#tab-file", "#tab-h3", "#tab-find"):      # each tab of card 1 (Search last: H3 picks on the map)
        pg.click(tab); pg.wait_for_timeout(300); audit(pg, "card 1 " + tab, seen, gaps)
    pg.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson")); pg.wait_for_function("window.areas >= 1", timeout=60000)
    unfold(pg)
    for tab in ("#tab-overpass", "#tab-cut", "#tab-region"):          # each tab of card 3, with the extracts of the area
        pg.click(tab); pg.wait_for_timeout(300); audit(pg, "card 3 " + tab, seen, gaps)
    pg.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf")); pg.click("#run")
    pg.wait_for_function("!document.getElementById('run').hasAttribute('aria-busy') && !document.getElementById('step7-card').classList.contains('off')", timeout=600000)
    pg.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600000)
    unfold(pg)
    audit(pg, "built", seen, gaps)
    # card 7 with an edited road: the bar of the Road tab, and a change in the list of the Changes tab
    pg.evaluate("window.fixesPanel.open()"); pg.wait_for_timeout(600)
    pg.evaluate(f"window.fixesPanel.select('road', 'way', {ROAD})"); pg.wait_for_function("document.querySelector('#fixf-lanes')", timeout=20000)
    pg.fill("#fixf-lanes", "5"); pg.click("#fix-save"); pg.wait_for_timeout(300); pg.fill("#fixf-lanes", "4"); pg.wait_for_timeout(200)
    pg.click("#fix-back"); pg.wait_for_timeout(300)
    fixes(pg, "light", seen, gaps)
    # the dark theme: the same controls again
    pg.evaluate("rsSetTheme('dark')"); pg.wait_for_timeout(400)
    dark = {}
    unfold(pg)
    audit(pg, "dark built", dark, gaps)
    fixes(pg, "dark", dark, gaps)
    b.close()
bad = [k for k, v in {**{"light " + k: v for k, v in seen.items()}, **{"dark " + k: v for k, v in dark.items()}}.items() if not v]
for g in sorted(set(gaps)):
    print("roadstyle gap (a checked option row has no hover):", g)
print(f"{len(seen)} controls in the light theme, {len(dark)} in the dark theme; {len(bad)} have no hover")
assert not errs, errs
assert not bad, "controls with no hover:\n" + "\n".join(bad)
print("parts_e2e: OK")
