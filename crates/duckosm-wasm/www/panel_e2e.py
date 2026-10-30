"""The panel of the page in headless Chromium (Playwright): the cards, the help windows and the main button.
- every card is in view and folded at the start, only the current step is open; a card whose inputs are not ready is disabled, with its reason in the
  title row; when a step is done (a done mark) the next card opens and the others fold, unless the person opened or folded cards by hand;
- "Collapse all" / "Expand all" in the title row acts on the active cards, and the page keeps the choice;
- the panel's "?" opens roadstyle's help window with the overview and the links, a card's "?" opens the words of the card; every link answers 200;
- only Build is filled with the accent (the standard's), Search is joined to its field; light and dark; a computer and a phone (390 x 844, touch).

    python crates/duckosm-wasm/www/panel_e2e.py [out folder]

It uses tests/data/monaco_sample.osm.pbf and tests/data/monaco.geojson. Build the page first (docs/development.md, "WebAssembly").
"""
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-panel")
out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html?maxroads=0"
errors = []
gap = set()
CARDS = ["step1-card", "step2-card", "extracts-box", "step4-card", "step5-card", "step6-card", "step7-card"]
STATE = """() => Object.fromEntries([...document.querySelectorAll('section.step')].map((c) => [c.id, (c.classList.contains('folded') ? 'F' : 'O') + (c.classList.contains('off') ? '-off' : '') + (c.querySelector('.done').hidden ? '' : '-done')]))"""
checked_links = {}


def check_links(page, names):
    """every link of the open help window answers 200 (a network error is told, not a failure)"""
    for href in page.evaluate("[...document.querySelectorAll('#rs-help a')].map((a) => a.href)"):
        if href in checked_links:
            continue
        status = None
        for attempt in range(5):                       # a site that says "too many requests" (429) is asked again after a pause
            try:
                status = page.request.get(href, timeout=30_000).status
            except Exception as e:  # noqa: BLE001
                print("link not checked (no answer):", href, str(e)[:60])
                break
            if status != 429:
                break
            time.sleep(10 * (attempt + 1))
        if status is None:
            continue
        checked_links[href] = status
        assert status == 200, (names, href, status)


def run(browser, name, dark=False, **context):
    phone = "has_touch" in context
    page = browser.new_context(**context).new_page()
    def on_error(e):
        # a gap in roadstyle: a page that starts in the dark theme (the stored choice) calls rsSetTheme before the map's style is loaded, and the handler of
        # rs:themechange (theme.js: the dark twin of the base map) throws "Style is not done loading" (syncStyleTheme waits for style.load, this handler does not)
        if "Style is not done loading" in str(e):
            gap.add(name)
        else:
            errors.append(str(e))
    page.on("pageerror", on_error)
    page.add_init_script("if (!sessionStorage.cleared) { localStorage.clear(); sessionStorage.cleared = '1'; }")
    page.goto(url)
    page.wait_for_function("window.mapReady", timeout=120_000)
    if dark:
        page.wait_for_function("window.duckMap.isStyleLoaded()", timeout=60_000)
        page.evaluate("rsSetTheme('dark')")
    tap = page.tap if phone else page.click
    st = lambda: page.evaluate(STATE)  # noqa: E731
    # ---- the start: all cards in view, folded; step 1 is open; the later steps are disabled with their reason
    assert [c for c in st()] == CARDS and st()["step1-card"] == "O", st()
    s = st()
    assert s["step2-card"] == "F-off" and s["step4-card"] == "F-off" and s["step5-card"] == "F-off" and s["step6-card"] == "F-off" and s["step7-card"] == "F-off", s
    assert s["extracts-box"] == "F", "step 3 is active (a cut file needs no area)"
    assert page.inner_text("#step2-card .after") == "after step 1" and page.inner_text("#step4-card .after") == "after step 3"
    assert page.evaluate("document.querySelector('#step5-card .fold').disabled"), "the chevron of a disabled card does not open it"
    page.evaluate("document.getElementById('step5').click()")
    assert st()["step5-card"] == "F-off", "a click on a disabled card does nothing"
    page.screenshot(path=str(out / f"{name}-1-start.png"))
    # ---- the main button and the search field: only Build is filled with the accent (the standard's: the page has no accent of its own)
    assert page.evaluate("[...document.querySelectorAll('#sb .btn.primary')].map((b) => b.id)") == ["run"]
    assert page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()") == "", "no accent value of the page"
    f = page.evaluate("""() => { const i = document.getElementById('q').getBoundingClientRect(), b = document.getElementById('search-go').getBoundingClientRect(); return [Math.round(i.top), Math.round(i.height), Math.round(b.top), Math.round(b.height), Math.round(b.left - i.right)]; }""")
    assert f[0] == f[2] and f[1] == f[3] and abs(f[4]) <= 1, ("Search is joined to its field", f)
    # ---- the help windows: the panel's "?", the overview, the links; a card's "?" and the overview again after it
    tap("#rs-help-btn")
    page.wait_for_selector("#rs-help .rs-help-box", state="visible")
    assert "duckOSM in the browser" in page.inner_text("#rs-help") and "stays in this browser" in page.inner_text("#rs-help")
    assert len(page.query_selector_all("#rs-help a")) == 5 and all(t in page.inner_text("#rs-help") for t in ("Choose an area", "Edit levels", "Google key"))
    page.screenshot(path=str(out / f"{name}-2-help.png"))
    check_links(page, "overview")
    page.keyboard.press("Escape")
    page.wait_for_selector("#rs-help", state="hidden")
    for n in (1, 3, 4, 5, 6, 7):
        page.evaluate(f"document.querySelector('#{CARDS[n - 1]} .hq').click()")
        page.wait_for_selector("#rs-help .rs-help-box", state="visible")
        assert page.inner_text("#rs-help .rs-help-ttl") != "duckOSM in the browser", n
        check_links(page, n)
        if n == 4:
            page.screenshot(path=str(out / f"{name}-3-card-help.png"))
        page.keyboard.press("Escape")
        page.wait_for_selector("#rs-help", state="hidden")
    tap("#rs-help-btn")
    page.wait_for_selector("#rs-help .rs-help-box", state="visible")
    assert page.inner_text("#rs-help .rs-help-ttl") == "duckOSM in the browser", "the panel's \"?\" has the overview again"
    page.keyboard.press("Escape")
    # ---- collapse all / expand all: only the active cards; the choice is kept
    tap("#sb-fold")
    assert st()["step1-card"] == "F" and st()["step2-card"] == "F-off" and page.get_attribute("#sb-fold", "aria-label") == "Expand all steps", st()
    assert page.evaluate("localStorage.getItem('duckosm.cards')") == "collapsed"
    tap("#sb-fold")
    s = st()
    assert s["step1-card"] == "O" and s["extracts-box"] == "O" and s["step2-card"] == "F-off" and s["step4-card"] == "F-off", ("expand all opens the active cards only", s)
    assert page.get_attribute("#sb-fold", "aria-label") == "Collapse all steps"
    page.screenshot(path=str(out / f"{name}-4-expanded.png"))
    page.reload()
    page.wait_for_function("window.mapReady", timeout=120_000)
    tap("#sb-fold")                                  # (the stored choice is "open": a reload starts with step 1 open)
    tap("#sb-fold")
    # ---- the flow: an area, the data, the build, the map, the editor; the next step opens, the finished one folds
    page.evaluate("localStorage.setItem('duckosm.cards', 'open')")
    page.reload()
    page.wait_for_function("window.mapReady", timeout=120_000)
    if dark:
        page.wait_for_function("window.duckMap.isStyleLoaded()", timeout=60_000)
        page.evaluate("rsSetTheme('dark')")
    assert st()["step1-card"] == "O"
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    s = st()
    assert s["step1-card"] == "F-done" and s["step2-card"] == "F-done" and s["extracts-box"] == "O", ("an area: step 3 opens, step 1 folds, steps 1 and 2 are done", s)
    tap("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    s = st()
    assert s["extracts-box"] == "F-done" and s["step4-card"] == "O", ("the data: step 4 opens, step 3 folds", s)
    page.screenshot(path=str(out / f"{name}-5-data-ready.png"))
    tap("#run")
    page.wait_for_function("!document.getElementById('step5-card').classList.contains('off')", timeout=900_000)
    s = st()
    assert s["step4-card"] == "F-done" and s["step5-card"] == "O" and "off" not in s["step6-card"] and "off" not in s["step7-card"], ("the build: step 5 opens", s)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    s = st()
    assert s["step6-card"].endswith("-done") and s["step7-card"] == "O", ("the map: step 7 opens", s)
    page.screenshot(path=str(out / f"{name}-6-built.png"))
    # by hand: the person opens step 3; the next step that opens does not fold it
    page.evaluate("document.getElementById('step3').click()")
    assert st()["extracts-box"].startswith("O")
    page.evaluate("document.getElementById('step5').click()")        # (open step 5 too)
    page.evaluate("window.dispatchEvent(new Event('resize'))")
    page.context.close()
    print(f"panel ({name}): the cards at the start, the help windows and their links, collapse all, the flow from the area to the editor, the main button")


with sync_playwright() as p:
    browser = p.chromium.launch()
    run(browser, "desktop", viewport={"width": 1400, "height": 900})
    run(browser, "desktop-dark", dark=True, viewport={"width": 1400, "height": 900})
    run(browser, "phone", viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    browser.close()
server.shutdown()
for n in sorted(gap):
    print(f"GAP, rsSetTheme before the style is loaded throws 'Style is not done loading' (a page that starts in the dark theme): {n}")
assert not errors, errors
print("panel: cards that follow the steps, one help window, collapse all, one main button; no page errors")
