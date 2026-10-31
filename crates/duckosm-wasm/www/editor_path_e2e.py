"""The level editor as a person uses it, in headless Chromium (Playwright), with real clicks and no test hook: build Monaco, Show on map, Edit levels (the
editor takes the page's one panel), pick two roads on the map, choose their order and add it to the list, go back with the change waiting (the bar
asks: Stay, Discard, Apply), Stay, Apply and solve, then "← Steps": the steps come back with the edit in the tables. On a computer (1400 x 900, light
and dark) and on a phone (390 x 844, touch; the editor is in the sheet). It also checks that the base-map box lists the seven maps.

    python crates/duckosm-wasm/www/editor_path_e2e.py [out folder]

It uses tests/data/monaco_sample.osm.pbf and tests/data/monaco.geojson. Build the page first (docs/development.md, "WebAssembly").
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-editor-path")
out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html?maxroads=0"
BASEMAPS = ["ofm_liberty", "ofm_positron", "osm", "esri_gray", "esri_street", "satellite", "blank"]
ROADS = "duckMap.getStyle().layers.filter((l) => l.id.startsWith('rs-roads-simple') && l.layout?.visibility !== 'none').map((l) => l.id)"
errors = []


def run(browser, name, dark=False, **context):
    phone = "has_touch" in context
    page = browser.new_context(**context).new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.mapReady", timeout=120_000)
    if dark:
        page.evaluate("rsSetTheme('dark')")
    tap = page.tap if phone else page.click
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    tap("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    tap("#run")
    page.wait_for_function("!document.getElementById('step5-card').classList.contains('off')", timeout=900_000)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    page.wait_for_function("window.duckMap.loaded()", timeout=600_000)
    page.wait_for_timeout(1500)
    tap("[data-rs-tool=basemap] button")
    assert page.evaluate("[...document.querySelectorAll('.bm-menu input[name=rs-bm]')].map((r) => r.value)") == BASEMAPS, "the seven base maps"
    page.keyboard.press("Escape")
    # the editor takes the page's one panel
    tap("#edit-open")
    page.wait_for_function("window.levelEditorOpen || /failed/.test(document.getElementById('editnote').textContent)", timeout=300_000)
    assert page.evaluate("!!window.levelEditorOpen"), page.inner_text("#editnote")
    page.wait_for_timeout(1000)
    assert page.is_visible("#lv-back") and "Edit levels" in page.inner_text("#sb"), "the editor is in the panel"
    assert page.evaluate("getComputedStyle(document.querySelector('#sb .sb-body')).display") == "none", "the steps are hidden"
    assert page.query_selector("#editbar") is None and page.query_selector("#lvhost") is None, "no edit bar and no frame of the page's own"
    page.screenshot(path=str(out / f"{name}-1-open.png"))
    # inside the editor: the page's theme, its area layers with the switch in the Base map box, and its base map (roadstyle 0.26.2)
    theme = "dark" if dark else "light"
    state = lambda: page.evaluate("duckMap.getGlobalState().rs_theme")  # noqa: E731
    shown = lambda: page.evaluate("duckMap.getStyle().layers.filter((l) => /^rs-ov\\d/.test(l.id) && l.layout?.visibility !== 'none').length")  # noqa: E731
    bg = lambda: page.evaluate("duckMap.getPaintProperty('bg', 'background-color')")  # noqa: E731
    assert state() == theme and page.evaluate("document.documentElement.dataset.rsTheme") == theme, ("the editor's map has the page's theme", state())
    assert shown() > 0, "the area's layers show inside the editor"
    tap("[data-rs-tool=basemap] button")
    page.wait_for_selector(".bm-menu .rs-bm-layers", state="visible")
    assert "Map layers" in page.inner_text(".bm-menu .rs-bm-layers"), "the Base map box has the switch of the area's layers inside the editor"
    tap(".bm-menu .rs-bm-layers label")
    page.wait_for_function("duckMap.getStyle().layers.filter((l) => /^rs-ov\\d/.test(l.id) && l.layout?.visibility !== 'none').length === 0", timeout=30_000)
    page.screenshot(path=str(out / f"{name}-1b-layers-off-in-editor.png"))
    tap(".bm-menu .rs-bm-layers label")
    page.wait_for_function("duckMap.getStyle().layers.filter((l) => /^rs-ov\\d/.test(l.id) && l.layout?.visibility !== 'none').length > 0", timeout=30_000)
    page.keyboard.press("Escape")
    page.evaluate("rs.tools.open('legend')")
    assert "water" in page.inner_text("#rs-color-box"), "the legend box lists the area's layers inside the editor"
    page.evaluate("rs.tools.close('legend')")
    # the base maps: Blank (its colour follows the theme), then OpenFreeMap (its dark twin Fiord in the dark theme)
    page.evaluate("rsSetBasemap('blank')")
    page.wait_for_function(f"duckMap.getPaintProperty('bg', 'background-color') === '{'#14181d' if dark else '#efede8'}'", timeout=30_000)
    page.evaluate("rsSetBasemap('ofm_liberty')")
    page.wait_for_function("duckMap.getStyle().layers.some((l) => l.id.startsWith('vbm-'))", timeout=60_000)
    page.wait_for_timeout(1500)
    page.screenshot(path=str(out / f"{name}-1c-basemap-in-editor.png"))
    # the theme changes while the editor is open: the map follows
    other = "light" if dark else "dark"
    page.click("[data-rs-tool=theme] button") if not phone else page.tap("[data-rs-tool=theme] button")
    page.wait_for_function(f"duckMap.getGlobalState().rs_theme === '{other}'", timeout=30_000)
    page.click("[data-rs-tool=theme] button") if not phone else page.tap("[data-rs-tool=theme] button")
    page.wait_for_function(f"duckMap.getGlobalState().rs_theme === '{theme}'", timeout=30_000)
    page.evaluate("rsSetBasemap('blank')")
    # two roads picked with real clicks (taps)
    w, h = context["viewport"]["width"], context["viewport"]["height"]
    page.evaluate("duckMap.jumpTo({center: [7.4225, 43.7345], zoom: 15.2, pitch: 0, bearing: 0})")
    page.wait_for_function("window.duckMap.loaded()")
    page.wait_for_timeout(1500)
    spots = page.evaluate("""() => { const m = duckMap, L = m.getStyle().layers.filter((l) => l.id.startsWith('rs-roads-simple') && l.layout?.visibility !== 'none').map((l) => l.id), out = [],
        a = rs.freeArea(); for (let y = a.top + 20; y < a.bottom - 20 && out.length < 40; y += 23) for (let x = a.lo + 20; x < a.hi - 20; x += 23) {
        const f = m.queryRenderedFeatures([[x - 2, y - 2], [x + 2, y + 2]], {layers: L}); if (f.length) out.push([x, y, f[0].id]); } return out; }""")
    picked, ids = [], []
    for x, y, i in spots:
        if i not in ids and all(abs(x - px) + abs(y - py) > 60 for px, py in picked):
            ids.append(i)
            picked.append((x, y))
        if len(picked) == 2:
            break
    assert len(picked) == 2, "two roads to pick"
    # roadstyle's editor page: the hover is a lighter colour of the road that the next click picks (light red for the first, light blue for the second), the
    # picks are red and blue, and there is no tooltip or popup of the page's own dashboard
    paint = lambda: page.evaluate("JSON.stringify(duckMap.getStyle().layers.filter((l) => l.id.startsWith('rs-roads')).map((l) => l.paint))").lower()  # noqa: E731
    popups = lambda: page.evaluate("document.querySelectorAll('.maplibregl-popup').length")  # noqa: E731
    HOVER1, HOVER2, ROAD1, ROAD2 = "#ff8a80", "#82b1ff", "#e53935", "#1e63d6"
    assert HOVER1 in paint() and HOVER2 not in paint(), "no pick: the hover is the light red"
    for k, (x, y) in enumerate(picked):
        if not phone:
            page.mouse.move(x - 30, y - 30)
            page.mouse.move(x, y, steps=4)
            page.wait_for_timeout(500)
            assert popups() == 0, "no tooltip of the page while the editor is open"
        (page.touchscreen.tap if phone else page.mouse.click)(x, y)
        page.wait_for_timeout(900)
        assert popups() == 0, "no popup of the page while the editor is open"
        assert [ROAD1, ROAD2][k] in paint(), ("the pick colour of road", k + 1)
        if k == 0:
            assert HOVER2 in paint(), "one pick: the hover is the light blue (the next click picks road 2)"
    page.screenshot(path=str(out / f"{name}-1b-picks.png"))
    assert "BETWEEN THESE TWO ROADS" in page.inner_text("#sb").upper(), "two roads picked"
    # the order of the pair: road 1 on top, added to the list (the change waits)
    page.evaluate("""() => { const b = [...document.querySelectorAll('#sb button')].find((x) => /^1\\S/.test(x.textContent.trim()) && x.getBoundingClientRect().width > 0); b.scrollIntoView({block: 'center'}); }""")
    page.wait_for_timeout(400)
    x, y = page.evaluate("""() => { const b = [...document.querySelectorAll('#sb button')].find((x) => /^1\\S/.test(x.textContent.trim()) && x.getBoundingClientRect().width > 0), r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }""")
    (page.touchscreen.tap if phone else page.mouse.click)(x, y)
    page.wait_for_timeout(600)
    tap("#lv-add")
    page.wait_for_function("/^1 waiting/.test((document.getElementById('lv-wait') || {}).textContent || '')", timeout=10_000)
    page.screenshot(path=str(out / f"{name}-2-waiting.png"))
    # back with the change waiting: the bar asks; Stay keeps the editor
    tap("#lv-back")
    page.wait_for_selector("#lv-ask-stay", state="visible", timeout=10_000)
    assert [page.inner_text(f"#lv-ask-{k}").strip() for k in ("stay", "discard", "apply")] == ["Stay", "Discard", "Apply"]
    page.screenshot(path=str(out / f"{name}-3-asks.png"))
    tap("#lv-ask-stay")
    page.wait_for_timeout(500)
    assert page.evaluate("!!window.levelEditorOpen") and "1 waiting" in page.inner_text("#lv-wait"), "Stay: the editor and the change stay"
    # Apply and solve, then back: the steps come back with the edit in the tables
    tap("#lv-apply")
    page.wait_for_function("(() => { const w = document.getElementById('lv-wait'); return !w || w.getBoundingClientRect().width === 0 || /^0/.test(w.textContent.trim()); })()", timeout=120_000)
    tap("#lv-back")
    page.wait_for_function("!window.levelEditorOpen", timeout=120_000)
    page.wait_for_function("/Applied|failed/.test(document.getElementById('editnote').textContent)", timeout=120_000)
    assert "Applied" in page.inner_text("#editnote") and "your rules: 1" in page.inner_text("#editnote"), page.inner_text("#editnote")
    page.wait_for_function("!window.mapDrawing && window.duckMap.loaded()", timeout=300_000)
    assert page.evaluate("getComputedStyle(document.querySelector('#sb .sb-body')).display") != "none", "the steps are back"
    assert page.evaluate("getComputedStyle(document.querySelector('.sb-foot')).display") != "none", "the footer is back"
    assert page.evaluate(ROADS), "the roads are drawn again"
    page.screenshot(path=str(out / f"{name}-4-steps.png"))
    page.context.close()
    print(f"editor path ({name}): open, two roads picked, a change added, back asks, Stay, Apply and solve, back: the edit is in the tables")


with sync_playwright() as p:
    browser = p.chromium.launch()
    run(browser, "desktop", viewport={"width": 1400, "height": 900})
    run(browser, "desktop-dark", dark=True, viewport={"width": 1400, "height": 900})
    run(browser, "phone", viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    browser.close()
server.shutdown()
assert not errors, errors
print("editor path: the editor in the page's one panel on a computer (light and dark) and on a phone; no page errors")
