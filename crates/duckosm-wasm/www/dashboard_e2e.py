"""The page's form in roadstyle's dashboard (docs/app.md, "roadstyle's dashboard look"), in headless Chromium (Playwright), with no build:
the bar and its tools in their order, the bar beside the panel, the panel that hides and shows, one neutral look for the seven cards
and the theme that all parts follow, the base-map box and its rules (a click outside, the Escape key, one box at a time), the 3D buildings
switch, the settings box with the Google key (kept in the browser only; the key of an earlier version moves there), a window in the free
part of the map, and the phone form at 390 x 844 (the bar at the top, the sheet with three heights, the boxes and the windows inside the
screen, the tools 32 px or more and reachable). It writes dashboard-*.png.

    python crates/duckosm-wasm/www/dashboard_e2e.py [out folder] [page folder]

Build the page first (docs/development.md, "WebAssembly"). The page loads its libraries from cdn.jsdelivr.net. The test key is not a key.
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

from serve import WWW, start

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-dashboard")
out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=sys.argv[2] if len(sys.argv) > 2 else WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
BOX = "(s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }"
TOOLS = ["Light / dark", "Zoom in", "Zoom out", "Drag to rotate map, click to reset north", "Tilt the view", "Street View", "Google 3D",
         "Base map", "3D buildings", "Settings", "Attribution"]
FAKE = "not-a-key-test-value"
errors = []


def open_page(browser, **context):
    page = browser.new_context(**context).new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script("if (!sessionStorage.cleared) { localStorage.clear(); sessionStorage.cleared = '1'; }")
    page.goto(url)
    page.wait_for_function("window.mapReady && document.getElementById('rs-toolbar') && !document.getElementById('rs-toolbar').dataset.held", timeout=120_000)
    page.evaluate("document.querySelectorAll('#rs-toolbar button').forEach((b) => (b.dataset.t = b.title))")   # tip.js takes the title after a hover
    page.wait_for_timeout(800)
    return page


def inside(box, w, h, gap=0):
    return box[0] >= gap and box[1] >= gap and box[2] <= w - gap and box[3] <= h - gap


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---- a computer: 1400 x 900 ----
    page = open_page(browser, viewport={"width": 1400, "height": 900})
    shot = lambda name: page.screenshot(path=str(out / f"dashboard-{name}.png"))  # noqa: E731
    classes = page.evaluate("document.documentElement.className")
    for c in ("rs-tpl-dashboard", "rs-overlay", "rs-has-toolbar", "rs-panel-left"):
        assert c in classes.split(), (c, classes)
    assert page.evaluate("[...document.querySelectorAll('#rs-toolbar button')].map((b) => b.title)") == TOOLS
    for old in ("theme", "collapse", "open", "mapctl", "basectl", "panel", "sheet-handle"):
        assert page.query_selector(f"#{old}") is None, f"the old #{old} is still in the page"
    # the bar is beside the panel; the panel hides, and the bar goes to the edge; the panel shows again
    bar, sb = page.evaluate(BOX, "#rs-toolbar"), page.evaluate(BOX, "#sb")
    assert sb[0] <= 1 and sb[2] - 12 <= bar[0] < sb[2] + 20, ("the bar beside the panel's card (the frame is 8 px)", bar, sb)
    shot("1-light")
    page.click("#sb-hide")
    page.wait_for_timeout(500)
    assert page.is_hidden("#sb") and page.is_visible("#sb-show") and page.evaluate(BOX, "#rs-toolbar")[0] < 20, "the panel hides"
    page.click("#sb-show")
    page.wait_for_timeout(500)
    assert page.is_visible("#sb") and page.evaluate(BOX, "#rs-toolbar")[0] >= sb[2] - 12, "the panel shows again"
    # a map that is full-window: the panel does not change its box
    assert page.evaluate(BOX, "#map") == [0, 0, 1400, 900]

    # one neutral look for the seven cards: no card has a color of its own, in both themes
    def looks():
        return page.evaluate("""() => [...document.querySelectorAll('section.step')].map((s) => {
            const n = s.querySelector('h2 .n'), c = getComputedStyle(s);
            return [getComputedStyle(n).backgroundColor, getComputedStyle(n).color, c.borderTopColor, c.backgroundColor, c.getPropertyValue('--c')];
        })""")
    for theme in ("light", "dark"):
        if theme == "dark":
            page.click("#rs-toolbar button[data-t='Light / dark']")
            page.wait_for_timeout(600)
            assert page.evaluate("[document.documentElement.dataset.rsTheme, document.documentElement.dataset.theme, "
                                 "document.getElementById('sb').dataset.theme, localStorage.getItem('duckosm.theme')]") == ["dark"] * 4
            shot("2-dark")
        seen = looks()
        assert len(seen) == 7 and all(x == seen[0] for x in seen) and seen[0][4] == "", (theme, seen)
    page.click("#rs-toolbar button[data-t='Light / dark']")
    page.wait_for_timeout(300)
    assert page.evaluate("document.documentElement.dataset.rsTheme") == "light"

    # the base-map box (the page's own tool): opens beside the bar, inside the window; the Escape key and a click outside close it; one box at a time
    box = lambda: page.evaluate("document.getElementById('basebox').classList.contains('open')")  # noqa: E731
    page.click("#bbase")
    page.wait_for_timeout(300)
    assert box() and inside(page.evaluate(BOX, "#basebox"), 1400, 900, 11), page.evaluate(BOX, "#basebox")
    shot("3-basemap-box")
    page.keyboard.press("Escape")
    assert not box()
    page.click("#bbase")
    page.mouse.click(900, 400)
    assert not box(), "a click outside closes the box"
    page.click("#bbase")
    page.click("#rs-toolbar button[data-t='Attribution']")
    page.wait_for_timeout(200)
    assert not box() and page.is_visible("#rs-attr-box"), "one box at a time: the attribution box closes the base-map box"
    page.click("#bbase")
    page.wait_for_timeout(200)
    assert box() and page.is_hidden("#rs-attr-box"), "and the base-map box closes the attribution box"
    page.click("input[name=base][value=blank_dark]")
    page.wait_for_function("window.duckMap.getLayer('base-over')?.type === 'background'")
    assert page.evaluate("localStorage.getItem('duckosm.basemap')") == "blank_dark"
    page.keyboard.press("Escape")

    # the 3D buildings switch
    assert page.evaluate("document.getElementById('bbld').ariaPressed") == "false"
    page.click("#bbld")
    assert page.evaluate("[document.getElementById('bbld').ariaPressed, document.getElementById('bbld').classList.contains('rs-on'), "
                         "localStorage.getItem('duckosm.buildings')]") == ["true", True, "1"]
    page.click("#bbld")
    assert page.evaluate("document.getElementById('bbld').ariaPressed") == "false"

    # the Google key: roadstyle's settings box (the gear). The browser keeps it; the page's card has no field for it
    page.click("#rs-toolbar button[data-t=Settings]")
    page.wait_for_selector("#rs-settings-box .rs-set-key", state="visible")
    assert "Google Maps key" in page.inner_text("#rs-settings-box")
    shot("4-settings")
    page.fill("#rs-settings-box .rs-set-key input", FAKE)
    page.click("#rs-settings-box .rs-set-key button:has-text('Save')")
    assert page.evaluate("localStorage.getItem('rs-key:google')") == FAKE and page.evaluate("localStorage.getItem('duckosm.googleKey')") is None
    page.click("#rs-settings-box .rs-set-key button:has-text('Clear')")
    assert page.evaluate("localStorage.getItem('rs-key:google')") is None
    page.keyboard.press("Escape")
    assert page.query_selector("#gkey") is None and page.is_visible("#gkey-open")
    page.click("#gkey-open")
    assert page.is_visible("#rs-settings-box"), "card 6 opens the settings"
    page.keyboard.press("Escape")

    # Street View opens in the free part of the map: not under the panel, not under the bar
    page.click("#rs-toolbar button[data-t='Street View']")
    page.wait_for_selector(".rs-svw", state="visible")
    page.wait_for_timeout(600)
    win, bar, sb = page.evaluate(BOX, ".rs-svw"), page.evaluate(BOX, "#rs-toolbar"), page.evaluate(BOX, "#sb")
    assert win[0] >= max(bar[2], sb[2] - 8) and inside(win, 1400, 900), ("the window in the free part", win, bar, sb)
    shot("5-street-view")
    page.close()

    # the key of an earlier version (card 6) moves to the settings, and is gone from its old place
    page = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
    # once: the page's service worker (the COOP and COEP headers) reloads it, and the script runs again
    page.add_init_script(f"if (!sessionStorage.old) {{ sessionStorage.old = '1'; localStorage.setItem('duckosm.googleKey', '{FAKE}'); }}")
    page.goto(url)
    page.wait_for_function("window.mapReady", timeout=120_000)
    moved = page.evaluate("[localStorage.getItem('rs-key:google'), localStorage.getItem('duckosm.googleKey')]")
    assert moved == [FAKE, None], [m is None for m in moved]
    page.close()

    # ---- a phone: 390 x 844, touch ----
    page = open_page(browser, viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    shot = lambda name: page.screenshot(path=str(out / f"dashboard-{name}.png"))  # noqa: E731
    W, H = 390, 844
    assert "rs-phone" in page.evaluate("document.documentElement.className").split()
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth"), "a horizontal scroll"
    bar = page.evaluate(BOX, "#rs-toolbar")
    assert page.evaluate("document.getElementById('rs-toolbar').dataset.edge") == "top" and bar[1] < 20 and bar[2] <= W, bar
    # each tool 32 px or more, and a tap reaches it (nothing covers it)
    for i, b in enumerate(page.query_selector_all("#rs-toolbar button")):
        r = b.bounding_box() or {"width": 0, "height": 0}
        assert r["width"] >= 32 and r["height"] >= 32, (i, r)
    reach = page.evaluate("""() => [...document.querySelectorAll('#rs-toolbar button')].filter((b) => {
        const r = b.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !(e === b || b.contains(e));
    }).map((b) => b.title)""")
    assert not reach, ("covered tools", reach)

    # the sheet: three heights, closed, 40 %, full; the bar stays in view; the map's padding is the sheet's part (down to the grip)
    state = lambda: page.evaluate("[0, 1, 2].find((n) => document.documentElement.classList.contains('rs-sheet-' + n))")  # noqa: E731
    pad = lambda: page.evaluate("window.duckMap.getPadding().bottom")  # noqa: E731
    grip = lambda: page.evaluate(BOX, ".rs-grip")  # noqa: E731
    assert state() == 1
    sb = page.evaluate(BOX, "#sb")
    assert abs((sb[3] - sb[1]) - H * 0.4) < 6 and abs(pad() - (H - grip()[1])) < 2 and page.evaluate(BOX, "#run")[3] <= H, (sb, pad())
    assert H - (H - grip()[1]) >= H * 0.5, "the map has 50 % of the height or more at 40 %"
    shot("6-phone-sheet-40")
    for want in (2, 0, 1):
        page.tap(".rs-grip")
        page.wait_for_timeout(500)
        assert state() == want, (want, state())
        assert abs(pad() - (H - grip()[1])) < 2, (want, pad(), grip())
        sb, bar = page.evaluate(BOX, "#sb"), page.evaluate(BOX, "#rs-toolbar")
        if want == 2:
            assert sb[1] >= bar[3] - 1, ("the full sheet does not cover the bar", sb, bar)
            shot("7-phone-sheet-full")
        if want == 0:
            assert page.is_hidden("#sb") and grip()[3] >= H - 1
            shot("8-phone-sheet-closed")
    # a box is inside the screen
    for title, sel in (("Base map", "#basebox"), ("Attribution", "#rs-attr-box"), ("Settings", "#rs-settings-box")):
        page.tap(f"#rs-toolbar button[data-t='{title}']")
        page.wait_for_timeout(400)
        assert inside(page.evaluate(BOX, sel), W, H), (title, page.evaluate(BOX, sel))
        if title == "Base map":
            shot("9-phone-basemap-box")
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
    # a window is a bottom sheet, and only one sheet is open at a time: the panel's sheet closes
    page.tap("#rs-toolbar button[data-t='Street View']")
    page.wait_for_selector(".rs-svw", state="visible")
    page.wait_for_timeout(500)
    win = page.evaluate(BOX, ".rs-svw")
    assert win[0] == 0 and win[2] == W and abs(win[3] - H) < 2 and state() == 0, (win, state())
    shot("10-phone-street-view")
    page.close()

    assert not errors, errors
    browser.close()
server.shutdown()
print("dashboard: the bar and its tools, the panel, one neutral card look in both themes, the boxes, the settings and the key, the windows; "
      "the phone form (390 x 844): the bar at the top, the sheet, the boxes and the windows inside the screen")
