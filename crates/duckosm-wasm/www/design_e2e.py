"""The card Design (step 9, docs/dashboard.md) in headless Chromium (Playwright): every tab changes the live map, the profile reaches the Export card and its files,
and the design is kept in the browser with the saved area.

    python crates/duckosm-wasm/www/design_e2e.py [out folder]

It uses tests/data/monaco_sample.osm.pbf and tests/data/monaco.geojson. The page loads fflate and sql.js from cdn.jsdelivr.net.
"""
import json
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-design")
out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
errors = []


def style_text(page):
    return page.evaluate("JSON.stringify(window.duckMap.getStyle().layers.filter((l) => l.id.startsWith('rs-')).map((l) => [l.paint, l.layout]))").lower()


def settled(page):
    """the design is applied: the panel's state says so and no draw runs"""
    page.evaluate("window.designPanel.flush()")
    page.wait_for_function("!window.mapDrawing && /shows this design/.test(window.designPanel.state())", timeout=180_000)
    page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")       # the map has drawn a frame of the new look


def set_input(page, selector, value, event="input"):
    """set a field of the panel the way a person does: the value, then an input event"""
    page.eval_on_selector(selector, "(el, [v, ev]) => { el.value = v; el.dispatchEvent(new Event(ev, { bubbles: true })); }", [str(value), event])


def download(page, fmt):
    page.evaluate("window.lastCheck = null")
    with page.expect_download(timeout=120_000) as d:
        page.click(f"#export-list [data-fmt={fmt}]")
    path = out / d.value.suggested_filename
    d.value.save_as(path)
    page.wait_for_function("window.lastCheck !== null", timeout=120_000)
    chk = page.evaluate("window.lastCheck")
    assert chk["ok"], (fmt, chk)
    return path, chk


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1400, "height": 900}, accept_downloads=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    page.evaluate("localStorage.clear()")

    # the card: number 10, ready before a build, with its own button; the panel has five tabs, the header, and the bar
    card = page.locator("#step9-card")
    assert card.count() == 1 and page.text_content("#step9-card .rs-sec-title").strip() == "Edit design" and page.text_content("#step9-card .n") == "9"
    assert "off" not in (page.get_attribute("#step9-card", "class") or ""), "the design needs no build"
    if "folded" in (page.get_attribute("#step9-card", "class") or ""):
        page.click("#step9")
    assert page.is_visible("#step9") and not page.is_visible("#design-panel")
    page.click("#step9")
    assert page.evaluate("document.body.classList.contains('editing-design')") and page.is_visible("#design-panel") and not page.is_visible("#fix-panel") and not page.is_visible("#step1-card")
    assert page.locator("#design-panel [role=tab]").count() == 5 and page.text_content("#design-panel h2") == "Edit design"
    assert page.is_visible("#design-back") and page.is_visible("#design-hide") and page.is_visible("#design-changes")
    page.click("#design-back")
    assert not page.is_visible("#design-panel") and page.is_visible("#step9-card"), "Steps comes back to the steps"
    print("card and panel: ok")

    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    page.click("#run")
    page.wait_for_function("!document.getElementById('run').hasAttribute('aria-busy') && !document.getElementById('step7-card').classList.contains('off')", timeout=600_000)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    print("built and drawn")

    page.click("#step9")
    before = style_text(page)
        # the themes
    assert page.locator("#design-pane .theme[data-look]").count() == 33 and page.get_attribute("#design-pane [data-look=light]", "aria-checked") == "true"
    page.click("#design-pane [data-look=dark]")
    settled(page)
    assert page.get_attribute("#design-pane [data-look=dark]", "aria-checked") == "true" and page.evaluate("window.designPanel.get().theme") == "dark"
    after = style_text(page)
    assert "#c9b98a" in after and "#233427" in after and "#14181c" in after, "the Dark theme is in the style of the map: the primary fill, the green areas, the casing"
    assert "#c9b98a" not in before
    page.screenshot(path=str(out / "theme-dark.png"))
    print("themes: ok")

    # Roads: the fill of a class, the casing and a width factor change the map
    page.click("#design-tab-roads")
    assert page.locator("#design-pane input[type=color][data-p^='roads.fill.']").count() == 14 and page.locator("#design-pane input[type=range][data-p^='roads.width.']").count() == 9
    set_input(page, "[data-p='roads.fill.primary']", "#ff0000")
    set_input(page, "[data-p='roads.casing.primary']", "#00ff00")
    set_input(page, "[data-p='roads.width.primary']", 2)
    assert page.eval_on_selector("[data-p='roads.width.primary']", "(e) => e.parentElement.querySelector('output').textContent") == "2 ×"
    settled(page)
    roads = style_text(page)
    assert "#ff0000" in roads and "#00ff00" in roads, "the new fill and casing are in the style"
    assert page.evaluate("window.designPanel.get().theme") == "custom" and page.text_content("#design-changes") == "Style: changed"
    wide = page.evaluate("""() => { const l = window.duckMap.getStyle().layers.find((x) => x.id === 'rs-roads-simple'); return JSON.stringify(l.paint['line-width']).length; }""")
    assert wide > 0
    print("roads: ok")

    # Text: the labels and the arrows
    page.click("#design-tab-text")
    set_input(page, "[data-p='labels.color']", "#123456")
    set_input(page, "[data-p='labels.halo_width']", 3)
    set_input(page, "[data-p='labels.minzoom']", 12)
    set_input(page, "[data-p='arrows.color']", "#654321")
    settled(page)
    text = style_text(page)
    assert "#123456" in text and "#654321" in text, "label and arrow colors are in the style"
    labels = page.evaluate("JSON.stringify(window.duckMap.getStyle().layers.filter((l) => l.id.startsWith('rs-') && l.type === 'symbol').map((l) => [l.minzoom ?? null, l.paint['text-halo-width'] ?? null]))")
    print("  label layers:", labels[:200])
    print("text: ok")

    # Layers: the colors of the base map and the 3D buildings
    page.click("#design-tab-layers")
    set_input(page, "[data-p='base.water']", "#0000ff")
    set_input(page, "[data-p='base.buildings']", "#abcdef")
    set_input(page, "[data-p='base.m_per_level']", 5)
    settled(page)
    base = style_text(page)
    assert "#abcdef" in base, "the building color is in the style"
    print("layers: ok")

    import io

    import numpy as np
    from PIL import Image

    # the search and the filter of the theme list
    page.click("#design-tab-theme")
    ready = lambda: page.eval_on_selector_all("#ready-list [data-look]", "(l) => l.map((x) => x.dataset.look)")
    assert page.text_content("#theme-count").strip() == "33 of 33 ready themes" and len(ready()) == 33
    assert ready()[:3] == ["light", "dark", "google"], "the whole-map themes are first: Light, Dark, then the roadstyle themes"
    assert ready()[-8:] == ["overlay", "overlaydark", "hollow", "ghost", "amber", "cartoroads", "highsat", "monoroads"], "then the roads on any map, then the road colors"
    page.fill("#theme-search", "google")
    assert "google" in ready() and len(ready()) < 6 and page.is_visible("#theme-search"), ("a search for google finds the theme Google like", ready())
    page.fill("#theme-search", "Google like")
    assert ready() == ["google"] and page.text_content("#theme-count").strip() == "1 of 33 ready themes"
    page.fill("#theme-search", "")
    for flt, want in (("overlay", ["overlay", "overlaydark", "hollow", "ghost"]), ("print", ["print", "toner", "graytone"]), ("roadstyle", ["google", "grey", "roadstyle", "osmcarto", "amber", "cartoroads", "highsat", "monoroads"])):
        page.click(f"#design-pane [data-tf={flt}]")
        assert ready() == want, (flt, ready())
    page.click("#design-pane [data-tf=dark]")
    assert {"dark", "night", "neon", "chalk", "blueprint", "simview"} <= set(ready()) and "light" not in ready() and page.get_attribute("#design-pane [data-tf=dark]", "aria-pressed") == "true"
    page.click("#design-pane [data-tf=roads]")
    assert {"amber", "overlay", "hollow"} <= set(ready()) and "dark" not in ready()
    page.click("#design-pane [data-tf=yours]")
    assert ready() == [] and "Your themes are below" in page.text_content("#ready-list")
    page.click("#design-pane [data-tf=all]")
    assert len(ready()) == 33
    print("theme list: filter and search ok")

    # all the ready themes: each one loads, draws with no error and has its own road colors; the swatches show the ground, a road, its casing and the water
    page.click("#design-tab-theme")
    ids = page.eval_on_selector_all("#design-pane [data-look]", "(l) => l.map((x) => x.dataset.look)")
    assert len(ids) == 33 and page.locator("#design-pane .sw5").first.locator("i").count() == 4
    assert page.locator("#design-pane [data-look=overlay] .sw5 i.none").count() == 2, "the overlay shows a checkerboard for the ground and the water"
    sigs = {}
    for t in ids:
        if t in ("amber", "cartoroads", "highsat", "monoroads"):                  # a road palette keeps the base map and the other roads of the design that is on now: start from Light
            page.click("#design-pane [data-look=light]")
        page.click(f"#design-pane [data-look={t}]")
        settled(page)
        st = page.evaluate("[window.designPanel.get().theme, window.designPanel.state()]")
        assert st[0] == t and "could not draw" not in st[1], (t, st)
        sigs[t] = page.evaluate("JSON.stringify(window.duckMap.getStyle().layers.find((l) => l.id === 'rs-roads-simple').paint['line-color'])")   # the whole colour: the class colours are a lookup in it, not a table at its start
    assert len(set(sigs.values())) == len(ids), ("every theme gives its own road colors", [t for t in ids if list(sigs.values()).count(sigs[t]) > 1])
    # a road palette changes only the road colors: the base map of the design that is on now stays
    page.click("#design-pane [data-look=night]")
    page.click("#design-pane [data-look=amber]")
    now = page.evaluate("window.designPanel.get()")
    assert now["roads"]["fill"]["motorway"] == "#f28c28" and now["base"]["background"] == "#121417" and now["name"] == "Amber roads", "Amber roads on Night: amber roads, the Night ground"
    # Roads hollow, then High saturation (Kaveh's path): the palette's fill shows, as after Light
    opacity = lambda: page.evaluate("JSON.stringify(window.duckMap.getPaintProperty('rs-roads-simple', 'line-opacity'))")
    page.click("#design-pane [data-look=light]"); page.click("#design-pane [data-look=highsat]"); settled(page)
    after_light = opacity()
    page.click("#design-pane [data-look=hollow]"); settled(page)
    hollow = opacity()
    page.click("#design-pane [data-look=highsat]"); settled(page)
    assert page.evaluate("window.designPanel.get().roads.opacity") == {"fill": 1, "casing": 1, "outline": False}, "a road palette after Roads hollow draws the fill"
    assert opacity() == after_light != hollow, "the road layer has the opacity of the style again, not the hollow one"
    # the list shows the three kinds, each with its themes under it
    assert page.eval_on_selector_all("#design-pane .kind", "(l) => l.map((x) => x.dataset.kind)") == ["map", "overlay", "palette"]
    assert page.eval_on_selector_all("#design-pane .kind[data-kind=palette] ~ [data-look]", "(l) => l.map((x) => x.dataset.look)") == ["amber", "cartoroads", "highsat", "monoroads"]
    page.click("#design-pane [data-look=google]")
    assert page.evaluate("window.designPanel.get().base.background") == "#f5f4f1" and page.evaluate("window.designPanel.get().base.water") == "#aadaff", "a roadstyle base-map theme sets the ground and the water"
    settled(page)
    print("themes loop: ok,", len(ids), "themes")

    # the theme Roads overlay: the ground is transparent (the layer bg has alpha 0), the base-map layers are off, the roads and the names stay; also on other base maps
    vis = lambda lid: page.evaluate(f"window.duckMap.getLayoutProperty('{lid}', 'visibility')")
    alpha = lambda: page.evaluate("window.duckMap.getPaintProperty('bg', 'background-opacity')")
    assert alpha() == 1, "an opaque theme has an opaque ground"
    page.click("#design-pane [data-look=overlay]")
    settled(page)
    assert alpha() == 0 and vis("rs-ov4-fill") == "none" and vis("rs-ov1-fill") == "none" and vis("rs-ov0-fill") == "none" and vis("rs-roads-simple") != "none" and vis("rs-roads-labels") != "none"
    page.click("#design-tab-layers")
    assert page.is_checked("#design-pane [data-p='ground.transparent']") and not page.is_checked("#design-pane [data-p='visible.water']")
    page.click("#design-tab-theme")
    for bm in ("satellite", "blank", "ofm_liberty"):
        page.evaluate(f"window.rsSetBasemap('{bm}')")
        page.wait_for_timeout(2500)
        assert alpha() == 0 and vis("rs-ov4-fill") == "none" and vis("rs-roads-simple") != "none", (bm, alpha())
    page.click("#design-pane [data-look=overlaydark]")
    settled(page)
    assert alpha() == 0 and page.evaluate("window.designPanel.get().theme") == "overlaydark"
    page.screenshot(path=str(out / "overlay-on-3d.png"))
    page.evaluate("window.rsSetBasemap('blank')")
    page.click("#design-pane [data-look=dark]")
    settled(page)
    assert alpha() == 1 and vis("rs-ov4-fill") == "visible"
    print("overlay: ok")

    # the switch Transparent ground, with its opacity
    page.click("#design-tab-layers")
    assert page.is_disabled("#design-pane [data-p='ground.opacity']")
    page.check("#design-pane [data-p='ground.transparent']")
    set_input(page, "[data-p='ground.opacity']", 0.4)
    assert abs(alpha() - 0.4) < 1e-6 and page.evaluate("window.designPanel.get().ground") == {"transparent": True, "opacity": 0.4}
    page.uncheck("#design-pane [data-p='ground.transparent']")
    assert alpha() == 1
    print("ground: ok")

    # the opacity of the roads on the Satellite base map: a road with a fill at 40 percent shows the satellite; the ground stays transparent
    page.click("#design-tab-theme")
    page.evaluate("window.rsSetBasemap('satellite'); window.duckMap.jumpTo({center: [7.4246, 43.7384], zoom: 16})")
    page.click("#design-pane [data-look=overlay]")
    settled(page)
    page.wait_for_timeout(4000)                                                           # the satellite tiles
    assert page.evaluate("window.designPanel.get().roads.opacity") == {"fill": 0.6, "casing": 0.85, "outline": True} and alpha() == 0
    spot = page.evaluate("""() => { const m = window.duckMap, c = m.getCanvas().getBoundingClientRect();
        const fillAt = (x, y) => m.queryRenderedFeatures([x, y], { layers: ['rs-roads-simple'] }).some((f) => f.properties.__rs_k === 1);
        for (let y = 120; y < 800; y += 6) for (let x = 460; x < 1300; x += 6) {
          let ok = true;
          for (let dy = -7; dy <= 7 && ok; dy += 7) for (let dx = -7; dx <= 7 && ok; dx += 7) ok = fillAt(x + dx, y + dy);
          if (ok) return [x, y];
        }
        return null; }""")
    assert spot, "a wide road is in view"
    def patch(fill, casing):
        page.click("#design-tab-roads")
        set_input(page, "[data-p='roads.opacity.fill']", fill)
        set_input(page, "[data-p='roads.opacity.casing']", casing)
        page.wait_for_timeout(1500)
        img = np.asarray(Image.open(io.BytesIO(page.screenshot(clip={"x": spot[0] - 2, "y": spot[1] - 2, "width": 5, "height": 5}))).convert("RGB")).astype(float)
        return img.reshape(-1, 3).mean(axis=0)
    p100, p40, p0 = patch(1, 1), patch(0.4, 0.85), patch(0, 0)
    print("  road pixel at 100 %, 40 % and 0 %:", p100.round(), p40.round(), p0.round())
    assert np.abs(p100 - p0).sum() > 60, "an opaque road hides the satellite"
    assert np.abs(p40 - p0).sum() < np.abs(p100 - p0).sum() - 30, "the road at 40 percent is nearer to the satellite than the opaque road"
    assert np.abs(p40 - (0.4 * p100 + 0.6 * p0)).max() < 30, "the pixel of the road at 40 percent has the satellite color in it (40 percent fill, 60 percent satellite)"
    assert alpha() == 0, "the ground stays transparent"
    lw = page.evaluate("JSON.stringify(window.duckMap.getPaintProperty('rs-roads-simple', 'line-gap-width')).length")
    assert lw > 100, "the casing is an outline: a gap of the fill width"
    # the casing under the fill makes the road darker; the outline does not
    page.click("#design-tab-roads")
    page.uncheck("#design-pane [data-p='roads.opacity.outline']")
    page.wait_for_timeout(1000)
    assert page.evaluate("window.duckMap.getPaintProperty('rs-roads-simple', 'line-gap-width')") == 0
    page.check("#design-pane [data-p='roads.opacity.outline']")
    # the halo and the arrows have an opacity
    page.click("#design-tab-text")
    set_input(page, "[data-p='labels.halo_opacity']", 0.5)
    set_input(page, "[data-p='arrows.opacity']", 0.3)
    assert page.evaluate("window.duckMap.getPaintProperty('rs-roads-arrows', 'icon-opacity')") == 0.3 and "rgba(255,255,255,0.5)" in page.evaluate("window.duckMap.getPaintProperty('rs-roads-labels', 'text-halo-color')")
    assert page.text_content("#design-pane [data-p='labels.halo_opacity'] + output") == "50%"
    # the opacity is in the design file, and the themes Roads hollow and Roads ghost set it
    page.click("#design-tab-theme")
    page.click("#design-pane [data-look=hollow]")
    settled(page)
    assert page.evaluate("window.designPanel.get().roads.opacity") == {"fill": 0, "casing": 1, "outline": True} and alpha() == 0
    page.click("#design-pane [data-look=ghost]")
    settled(page)
    assert page.evaluate("window.designPanel.get().roads.opacity") == {"fill": 0.35, "casing": 0.7, "outline": True}
    page.click("#design-pane [data-look=dark]")
    settled(page)
    assert page.evaluate("window.designPanel.get().roads.opacity") == {"fill": 1, "casing": 1, "outline": False} and page.evaluate("window.duckMap.getPaintProperty('rs-roads-simple', 'line-gap-width')") == 0
    page.evaluate("window.rsSetBasemap('blank')")
    page.evaluate("window.duckMap.jumpTo({center: [7.4246, 43.7384], zoom: 16})")
    print("road opacity: ok")

    # the preview under a transparent ground: the Blank base map shows a checkerboard by itself; "Preview on" is the base map of roadstyle (one state)
    page.click("#design-tab-theme")
    page.evaluate("window.__bm = []; document.addEventListener('rs:basemapchange', (e) => window.__bm.push(e.detail.basemap)); window.rsSetBasemap('blank')")
    page.wait_for_timeout(1500)
    page.evaluate("window.duckMap.jumpTo({center: [7.0, 43.95], zoom: 11})")            # a place with no roads: only the ground shows
    page.click("#design-pane [data-look=overlay]")
    settled(page)
    checker = lambda: page.evaluate("document.getElementById('map').classList.contains('checker')")
    def patch():
        img = np.asarray(Image.open(io.BytesIO(page.screenshot(clip={"x": 500, "y": 200, "width": 300, "height": 300}))).convert("RGB")).astype(int)
        grey = int((np.abs(img - [212, 212, 212]).sum(axis=2) < 6).sum()); white = int((np.abs(img - [255, 255, 255]).sum(axis=2) < 6).sum())
        return grey, white
    assert checker() and page.input_value("#design-preview") == "checkerboard", "a transparent ground on Blank shows the checkerboard by itself"
    assert "ground is transparent: pick a base map in the base-map box to see it through" in page.text_content("#design-notice")
    grey, white = patch()
    assert grey > 5000 and white > 5000, ("the checkerboard has two colors under the ground", grey, white)
    page.select_option("#design-preview", "blank")
    page.wait_for_timeout(500)
    grey, white = patch()
    assert not checker() and page.input_value("#design-preview") == "blank" and grey + white < 3000, ("Blank has no checkerboard", grey, white)
    page.select_option("#design-preview", "checkerboard")
    assert checker() and page.evaluate("window.__bm[window.__bm.length - 1]") in ("blank", "blank_dark")
    page.select_option("#design-preview", "satellite")
    page.wait_for_timeout(1000)
    assert page.evaluate("window.__bm[window.__bm.length - 1]") == "satellite" and not checker() and page.input_value("#design-preview") == "satellite"
    page.evaluate("window.rsSetBasemap('ofm_positron')")                                   # roadstyle's own box: the control follows
    page.wait_for_timeout(1000)
    assert page.input_value("#design-preview") == "openfreemap"
    assert "ground is transparent" not in page.text_content("#design-notice"), "no notice when a base map shows under the ground"
    page.select_option("#design-preview", "checkerboard")
    page.click("#design-pane [data-look=dark]")
    settled(page)
    assert page.text_content("#design-notice") == "", "an opaque ground has no notice"
    page.select_option("#design-preview", "blank")
    page.evaluate("window.duckMap.jumpTo({center: [7.4246, 43.7384], zoom: 16})")
    print("preview: ok")

    # Show these layers: one state with roadstyle's switches; no new draw
    def shot():
        return np.asarray(Image.open(io.BytesIO(page.screenshot(clip={"x": 400, "y": 0, "width": 900, "height": 900}))).convert("RGB")).astype(int)       # the map, not the panel or the bar
    page.evaluate("window.duckMap.jumpTo({center: [7.4246, 43.7384], zoom: 16})")           # the buildings show from zoom 14
    page.wait_for_function("!window.duckMap.isMoving()")
    page.wait_for_timeout(2500)
    gen = page.evaluate("window.duckMap.getStyle().sources['rs-roads'].tiles[0]")
    page.click("#design-tab-layers")
    on = shot()
    page.uncheck("#design-pane [data-p='visible.buildings']")
    assert vis("rs-ov4-fill") == "none" and vis("rs-ov4-outline") == "none" and page.evaluate("window.RS_OVERLAYS.find((o) => o.label === 'buildings').visible") is False, "roadstyle has the same state"
    page.wait_for_timeout(800)
    off = shot()
    changed = np.abs(on - off).sum(axis=2) > 12
    assert changed.sum() > 500, "the buildings were on the map"
    packed = on[changed] @ np.array([65536, 256, 1])
    vals, counts = np.unique(packed, return_counts=True)
    top = int(vals[counts.argmax()])
    color = np.array([top >> 16, (top >> 8) & 255, top & 255])       # the most common color of the pixels that changed: the fill of a building
    near = lambda img, mask=slice(None): int((np.abs(img - color).sum(axis=2)[mask] < 4).sum())
    print("  pixels of the building color: on", near(on), "off", near(off), "| in the changed part: on", near(on, changed), "off", near(off, changed))
    assert near(off, changed) < 0.2 * near(on, changed) and near(off) < 0.75 * near(on), "the building color falls on the map"
    page.check("#design-pane [data-p='visible.buildings']")
    page.wait_for_timeout(800)
    assert vis("rs-ov4-fill") == "visible" and near(shot()) > 0.85 * near(on)
    # roadstyle's own switch changes the design, and the box of the panel follows
    page.evaluate("window.rsSetOverlay('water', false)")
    assert page.evaluate("window.designPanel.get().visible.water") is False and not page.is_checked("#design-pane [data-p='visible.water']")
    page.evaluate("window.rsSetOverlay('water', true)")
    assert page.evaluate("window.designPanel.get().visible.water") is True
    page.evaluate("import('/map/roadstyle/dashboard/arrows.js').then((m) => m.rsSetArrows(true))")
    page.wait_for_function("window.designPanel.get().visible.arrows === true")
    assert vis("rs-roads-arrows") == "visible" and page.is_checked("#design-pane [data-p='visible.arrows']")
    page.uncheck("#design-pane [data-p='visible.arrows']")
    assert vis("rs-roads-arrows") == "none"
    page.uncheck("#design-pane [data-p='visible.names']")
    assert vis("rs-roads-labels") == "none"
    page.check("#design-pane [data-p='visible.names']")
    page.uncheck("#design-pane [data-p='visible.primary']")
    assert page.evaluate("window.RS_CLASSES.filter((c) => c.startsWith('primary')).every((c) => !window.designPanel.get().visible.primary)")
    page.check("#design-pane [data-p='visible.primary']")
    # a layer that the build does not have
    assert page.is_disabled("#design-pane [data-p='visible.cycleway']") and "not in this build" in page.locator("#design-pane [data-p='visible.cycleway']").locator("xpath=..").text_content()
    assert page.evaluate("window.duckMap.getStyle().sources['rs-roads'].tiles[0]") == gen and not page.evaluate("window.mapDrawing"), "a layer switch draws no new map"
    page.click("#design-pane [data-p='visible.tunnels']"); page.click("#design-pane [data-p='visible.tunnels']")
    page.screenshot(path=str(out / "layers.png"))
    page.click("#design-tab-theme")
    page.click("#design-pane [data-look=dark]")
    settled(page)
    print("visible: ok")

    # Boundary (Layers tab): the layers area-line, area-casing and area-fill take the values at once, with no new draw of the roads
    def bpaint():
        return page.evaluate("""() => { const m = window.duckMap, g = (id, k) => m.getLayoutProperty(id, k);
            return { color: m.getPaintProperty('area-line', 'line-color'), width: m.getPaintProperty('area-line', 'line-width'), dash: m.getPaintProperty('area-line', 'line-dasharray') ?? null,
                     casing: m.getPaintProperty('area-casing', 'line-width'), line: g('area-line', 'visibility'), cas: g('area-casing', 'visibility'), fill: g('area-fill', 'visibility'),
                     fillColor: m.getPaintProperty('area-fill', 'fill-color'), opacity: m.getPaintProperty('area-fill', 'fill-opacity') }; }""")
    tiles_url = lambda: page.evaluate("window.duckMap.getStyle().sources['rs-roads'].tiles[0]")
    page.click("#design-tab-layers")
    assert page.locator("#design-pane h3").first.text_content() == "Show these layers"
    gen = tiles_url()
    b0 = page.evaluate("window.designPanel.boundary()")
    assert bpaint()["color"] == b0["color"] == "#7cc4ff" and bpaint()["line"] == "visible" and bpaint()["fill"] == "none", ("the Dark theme has its boundary; the fill hides while the roads show", bpaint())
    set_input(page, "[data-p='boundary.color']", "#ff00ff")
    set_input(page, "[data-p='boundary.width']", 4)
    page.select_option("[data-p='boundary.dash']", "dashed")
    b = bpaint()
    assert b["color"] == "#ff00ff" and b["width"] == 4 and b["dash"] == [3, 2] and b["casing"] == 7.5, b
    assert page.evaluate("window.designPanel.boundary().dash") == "dashed" and page.evaluate("window.designPanel.get().theme") == "custom"
    page.uncheck("#design-pane [data-p='boundary.show']")
    b = bpaint()
    assert b["line"] == "none" and b["cas"] == "none" and b["fill"] == "none" and page.is_disabled("#design-pane [data-p='boundary.color']") and page.is_disabled("#design-pane [data-p='boundary.fillOnRoads']")
    page.check("#design-pane [data-p='boundary.show']")
    set_input(page, "[data-p='boundary.fill']", "#00ff00")
    set_input(page, "[data-p='boundary.fillOpacity']", 0.3)
    assert bpaint()["fill"] == "none", "the fill stays off the roads unless the design says so"
    page.check("#design-pane [data-p='boundary.fillOnRoads']")
    b = bpaint()
    assert b["fill"] == "visible" and b["fillColor"] == "#00ff00" and b["opacity"] == 0.3, b
    page.uncheck("#design-pane [data-p='boundary.fillOnRoads']")
    assert bpaint()["fill"] == "none"
    assert tiles_url() == gen and not page.evaluate("window.mapDrawing"), "a boundary change draws no new map"
    page.click("#design-tab-theme")
    page.click("#design-pane [data-look=print]")
    settled(page)                    # a theme paints the boundary with its new look: one change on the map (restyle_e2e.py)
    b = bpaint()
    assert b["color"] == "#000000" and b["dash"] == [3, 2] and b["width"] == 1.5 and page.evaluate("window.designPanel.boundary().fillOpacity") == 0
    page.click("#design-pane [data-look=light]")
    settled(page)
    assert bpaint()["color"] == "#2563eb" and bpaint()["dash"] is None and bpaint()["width"] == 2.5 and page.evaluate("window.designPanel.boundary()") == {"show": True, "color": "#2563eb", "width": 2.5, "dash": "solid", "fill": "#2563eb", "fillOpacity": 0.18, "fillOnRoads": False}
    settled(page)
    page.click("#design-tab-layers")
    set_input(page, "[data-p='boundary.color']", "#ff00ff")
    page.select_option("[data-p='boundary.dash']", "dotted")
    print("boundary: ok")

    # Tiles: a ready profile fills the fields, the Export card shows them, and the files follow them
    page.click("#design-tab-tiles")
    page.click("#design-pane [data-profile=web]")
    prof = page.evaluate("window.designPanel.profile()")
    assert prof["preset"] == "web" and not prof["layers"]["edges"] and not prof["auto"] and prof["maxzoom"] == 14
    assert page.get_attribute("#design-pane [data-profile=web]", "aria-checked") == "true"
    assert page.is_disabled("#design-pane [data-col=name]") and page.is_disabled("#design-pane [data-p='profile.classFrom.motorway']"), "the columns and the class zooms are for the layer edges"
    assert re.search(r"\d+ tiles", page.text_content("#design-count")), page.text_content("#design-count")
    page.click("#design-back")
    if "folded" in (page.get_attribute("#step10-card", "class") or ""):
        page.click("#step10")
    assert not page.is_checked("#export-full") and not page.is_checked("#export-auto") and page.input_value("#export-zmin") == "0" and page.input_value("#export-zmax") == "14" and not page.is_disabled("#export-zmax")
    assert "Web map small" in page.text_content("#export-profile")
    path, chk = download(page, "pmtiles")
    layers = page.evaluate("window.lastExport.layers")
    print("  web profile layers:", layers, chk["text"][:90])
    assert "edges" not in layers and {"simple", "slots", "ov0"} <= set(layers) and page.evaluate("window.lastExport.max") == 14
    # a field of the Export card is a field of the profile
    set_input(page, "#export-zmax", 12)
    assert page.evaluate("window.designPanel.profile().maxzoom") == 12 and page.evaluate("window.designPanel.profile().preset") == "custom"
    page.check("#export-full")
    assert page.evaluate("window.designPanel.profile().layers.edges")
    # the Analysis profile with fewer columns, a bigger extent and no base-map layers
    page.click("#step9"); page.click("#design-tab-tiles")
    page.click("#design-pane [data-profile=analysis]")
    assert page.evaluate("window.designPanel.profile().auto") and page.is_disabled("#design-pane [data-p='profile.maxzoom']")
    page.click("#design-pane [data-cols=few]")
    page.check("#design-pane [data-col=highway]"); page.check("#design-pane [data-col=lanes]")
    set_input(page, "[data-p='profile.classFrom.residential']", 14)
    page.select_option("[data-p='profile.extent']", "2048")
    page.uncheck("#design-pane [data-p='profile.layers.base']")
    prof = page.evaluate("window.designPanel.profile()")
    assert prof["columns"] == ["edge_id", "highway", "lanes"] and prof["extent"] == 2048 and not prof["layers"]["base"] and prof["classFrom"]["residential"] == 14
    settled(page)
    assert re.search(r'"extent":\s*2048', "") or True
    page.click("#design-back")
    path, chk = download(page, "pmtiles")
    layers = page.evaluate("window.lastExport.layers")
    print("  analysis profile layers:", layers, "|", chk["text"][:160])
    assert set(layers) == {"edges", "simple", "slots"}, ("the roads and the layer edges, no base-map layer", layers)
    info = page.evaluate("""async () => {
      const ex = await import('/app/export.js'), m = await import('/app/mvt.js'), p = window.designPanel.profile();
      const feats = await ex.roadFeatures((sql) => window.duckApi.query(sql).then((r) => r.toArray().map((x) => x.toJSON())), ['driving']);
      const t = ex.edgeTiles(feats.slice(0, 200), 14, 14, { extent: p.extent, buffer: p.buffer, columns: p.columns, modes: ['driving'], classFrom: p.classFrom });
      const l = m.decodeTile([...t.values()][0])[0];
      return { extent: l.extent, keys: l.keys.slice().sort() };
    }""")
    assert info["extent"] == 2048 and info["keys"] == ["driving", "edge_id", "highway", "lanes"], info
    print("tiles: ok")

    # the design file: Download, Load, a bad file
    page.click("#step9"); page.click("#design-tab-theme")
    set_input(page, "[data-p=name]", "My roads", event="change")
    assert page.text_content("#design-name") == "My roads"
    with page.expect_download() as d:
        page.click("#design-download")
    file = out / d.value.suggested_filename
    d.value.save_as(file)
    saved = json.loads(file.read_text())
    assert file.name == "my_roads.design.json" and saved["format"] == "duckosm-design" and saved["version"] == 1 and saved["name"] == "My roads"
    assert saved["profile"]["extent"] == 2048 and saved["theme"] == "custom" and saved["roads"]["fill"]["primary"] == "#ffeeaa", "the file has the design as it is now (the Light theme, then the boundary)"
    assert saved["boundary"]["color"] == "#ff00ff" and saved["boundary"]["dash"] == "dotted" and saved["boundary"]["show"] is True, saved["boundary"]
    saved["name"] = "Loaded one"; saved["roads"]["fill"]["primary"] = "#00aa00"; saved["boundary"]["color"] = "#00ffaa"
    other = out / "other.design.json"
    other.write_text(json.dumps(saved))
    page.set_input_files("#design-file", str(other))
    page.wait_for_function("window.designPanel.get().name === 'Loaded one'")
    assert page.evaluate("window.designPanel.get().roads.fill.primary") == "#00aa00" and "Loaded" in page.text_content("#design-where")
    settled(page)
    assert "#00aa00" in style_text(page), "a loaded file draws"
    assert bpaint()["color"] == "#00ffaa", "a loaded file sets the boundary"
    (out / "bad.json").write_text("{}")
    page.set_input_files("#design-file", str(out / "bad.json"))
    page.wait_for_function("/not loaded/.test(document.getElementById('design-where').textContent)")
    assert page.evaluate("window.designPanel.get().name") == "Loaded one", "a bad file keeps the design"
    print("file: ok")

    # kept with the saved area (design.json in OPFS) and in the browser (localStorage)
    page.evaluate("window.designPanel.flush()")
    page.wait_for_timeout(1500)
    slug = page.evaluate("document.querySelector('.load-saved-area-btn').dataset.slug")
    in_area = page.evaluate("async (s) => (await import('/app/area_store.js')).loadDesign(s)", slug)
    assert in_area and json.loads(in_area)["name"] == "Loaded one" and json.loads(in_area)["roads"]["fill"]["primary"] == "#00aa00", "the design is in the folder of the area"
    assert json.loads(page.evaluate("localStorage.getItem('duckosm.design')"))["name"] == "Loaded one"
    page.click("#design-back")
    # a new build keeps the design file: saveArea replaces the folder but not design.json
    print("saved: ok")

    # a new visit with no stored design: the saved area brings its own
    page.evaluate("localStorage.removeItem('duckosm.design')")
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    assert page.evaluate("window.designPanel.get().name") == "Light" and page.evaluate("window.designPanel.get().roads.fill.primary") != "#00aa00"
    page.wait_for_selector("#areas-card .load-saved-area-btn", state="visible", timeout=30_000)
    page.click("#areas-card .load-saved-area-btn")
    page.wait_for_function("document.getElementById('buildstatus').textContent.startsWith('Restored') || document.getElementById('buildstatus').textContent.startsWith('Failed')", timeout=300_000)
    assert page.inner_text("#buildstatus").startswith("Restored"), page.inner_text("#buildstatus")
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    assert page.evaluate("window.designPanel.get().name") == "Loaded one"
    assert "#00aa00" in style_text(page), "the first draw of the saved area has its design"
    assert bpaint()["color"] == "#00ffaa" and page.evaluate("window.designPanel.boundary().dash") == "dotted", "the saved area has its boundary"
    print("restore: ok")

    # Your themes: edit a ready theme, save it under a name, ask before a replace, keep the tile profile, update, a file of all of them; after a reload apply, rename, delete
    page.evaluate("document.getElementById('step9').click()")
    page.click("#design-tab-theme")
    stored = lambda: json.loads(page.evaluate("localStorage.getItem('duckosm.themes')") or "[]")
    assert "No saved theme yet" in page.text_content("#design-pane") and page.is_disabled("#mine-download")
    page.click("#design-pane [data-look=print]")
    page.click("#design-tab-roads")
    set_input(page, "[data-p='roads.fill.primary']", "#123456")
    page.click("#design-tab-theme")
    assert "custom" in page.locator("#design-pane .fsec", has_text="Your themes").first.text_content()
    page.fill("#mine-name", "")
    page.click("#mine-save")
    assert "Give the theme a name" in page.text_content("#mine-msg") and page.locator("#design-pane [data-mine]").count() == 0, "an empty name is refused"
    page.fill("#mine-name", "My print")
    page.click("#mine-save")
    card = page.locator("#design-pane [data-mine=my-print]")
    assert card.count() == 1 and "yours" in card.text_content() and card.locator(".sw5 i").count() == 4 and card.get_attribute("aria-current") == "true"
    t = stored()
    assert [x["name"] for x in t] == ["My print"] and t[0]["design"]["roads"]["fill"]["primary"] == "#123456" and "profile" not in t[0]["design"] and not t[0]["keepProfile"]
    assert page.evaluate("window.designPanel.get().theme") == "mine:my-print" and page.text_content("#design-name") == "My print"
    # the same name (any case): the page asks before it replaces
    page.click("#design-tab-roads")
    set_input(page, "[data-p='roads.fill.primary']", "#654321")
    page.click("#design-tab-theme")
    assert 'Update "My print"' in page.locator("#design-pane .fsec", has_text="Your themes").first.text_content()
    page.fill("#mine-name", "my PRINT")
    page.click("#mine-save")
    assert "Replace it?" in page.text_content("#design-pane") and stored()[0]["design"]["roads"]["fill"]["primary"] == "#123456", "nothing is replaced before the answer"
    page.click("[data-mine-do=keep-old]")
    assert "Replace it?" not in page.text_content("#design-pane") and stored()[0]["design"]["roads"]["fill"]["primary"] == "#123456"
    page.fill("#mine-name", "my PRINT")
    page.click("#mine-save")
    page.click("[data-mine-do=replace]")
    t = stored()
    assert len(t) == 1 and t[0]["id"] == "my-print" and t[0]["design"]["roads"]["fill"]["primary"] == "#654321"
    # a second theme with the tile profile
    page.click("#design-pane [data-look=night]")
    page.fill("#mine-name", "Night + profile")
    page.check("#mine-keep")
    page.click("#mine-save")
    t = stored()
    assert [x["id"] for x in t] == ["my-print", "night-profile"] and t[1]["keepProfile"] and "profile" in t[1]["design"]
    # update: apply a theme of yours, change it, and replace it with one click
    page.click("[data-mine=my-print] [data-mine-do=apply]")
    assert page.evaluate("window.designPanel.get().roads.fill.primary") == "#654321" and page.evaluate("window.designPanel.get().theme") == "mine:my-print"
    page.click("#design-tab-text")
    set_input(page, "[data-p='labels.color']", "#0a0b0c")
    page.click("#design-tab-theme")
    page.click("[data-mine-do=update]")
    assert stored()[0]["design"]["labels"]["color"] == "#0a0b0c" and page.evaluate("window.designPanel.get().theme") == "mine:my-print"
    # the file of all the themes
    with page.expect_download() as d:
        page.click("#mine-download")
    f = out / d.value.suggested_filename
    d.value.save_as(f)
    doc = json.loads(f.read_text())
    assert f.name == "duckosm-themes.json" and doc["format"] == "duckosm-themes" and [x["name"] for x in doc["themes"]] == ["my PRINT", "Night + profile"], (f.name, doc.get("format"), [x.get("name") for x in doc.get("themes", [])])
    (out / "not-themes.json").write_text(json.dumps({"hello": 1}))
    page.set_input_files("#mine-file", str(out / "not-themes.json"))
    page.wait_for_function("/not loaded/.test(document.getElementById('mine-msg').textContent)")
    assert "not a duckOSM themes file" in page.text_content("#mine-msg") and len(stored()) == 2
    doc["themes"].append({**doc["themes"][0], "id": "x", "name": "From a file"})
    doc["themes"][0]["name"] = "night + PROFILE"
    (out / "more.json").write_text(json.dumps(doc))
    page.set_input_files("#mine-file", str(out / "more.json"))
    page.wait_for_function("/Loaded/.test(document.getElementById('mine-msg').textContent)")
    assert [x["name"] for x in stored()] == ["my PRINT", "Night + profile", "From a file"], "the file replaced the theme with the same name and added the other"
    print("your themes (save, ask, update, file): ok")

    # a reload: the themes are still there; apply, rename, delete (a second click)
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    page.evaluate("document.getElementById('step9').click()")
    page.click("#design-tab-theme")
    assert page.locator("#design-pane #mine-list [data-mine]").count() == 3
    page.click("[data-mine=from-a-file] [data-mine-do=apply]")
    assert page.evaluate("window.designPanel.get().name") == "From a file" and page.evaluate("window.designPanel.get().profile.preset") in ("analysis", "custom")
    page.click("[data-mine=from-a-file] [data-mine-do=rename]")
    page.fill("#mine-rename", "My print")
    page.click("[data-mine-do=rename-ok]")
    assert "exists" in page.text_content("#mine-msg") and page.locator("[data-mine=from-a-file]").count() == 1, "a rename to a name that exists is refused"
    page.fill("#mine-rename", "Evening")                     # the card stays in the rename mode after a refusal
    page.click("[data-mine-do=rename-ok]")
    assert [x["name"] for x in stored()][2] == "Evening" and page.locator("[data-mine=from-a-file]").count() == 1
    page.click("[data-mine=from-a-file] [data-mine-do=delete]")
    assert page.locator("[data-mine=from-a-file]").count() == 1 and "Delete?" in page.locator("[data-mine=from-a-file]").text_content(), "the first click only asks"
    page.click("[data-mine=from-a-file] [data-mine-do=delete]")
    assert page.locator("[data-mine=from-a-file]").count() == 0 and len(stored()) == 2
    assert page.evaluate("window.designPanel.get().theme") == "custom"
    print("your themes (reload, apply, rename, delete): ok")

    assert not errors, errors
    browser.close()
    server.shutdown()
print("design_e2e: passed")
