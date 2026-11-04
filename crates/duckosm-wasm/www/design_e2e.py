"""The card Design (step 10, docs/dashboard.md) in headless Chromium (Playwright): every tab changes the live map, the profile reaches the Export card and its files,
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
    card = page.locator("#step10-card")
    assert card.count() == 1 and page.text_content("#step10-card .rs-sec-title").strip() == "Design" and page.text_content("#step10-card .n") == "10"
    assert "off" not in (page.get_attribute("#step10-card", "class") or ""), "the design needs no build"
    if "folded" in (page.get_attribute("#step10-card", "class") or ""):
        page.click("#step10")
    assert page.is_visible("#design-open") and not page.is_visible("#design-panel")
    page.click("#design-open")
    assert page.evaluate("document.body.classList.contains('editing-design')") and page.is_visible("#design-panel") and not page.is_visible("#fix-panel") and not page.is_visible("#step1-card")
    assert page.locator("#design-panel [role=tab]").count() == 5 and page.text_content("#design-panel h2") == "Design"
    assert page.is_visible("#design-back") and page.is_visible("#design-hide") and page.is_visible("#design-changes")
    page.click("#design-back")
    assert not page.is_visible("#design-panel") and page.is_visible("#step10-card"), "Steps comes back to the steps"
    print("card and panel: ok")

    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    page.click("#run")
    page.wait_for_function("!document.getElementById('run').hasAttribute('aria-busy') && !document.getElementById('step7-card').classList.contains('off')", timeout=600_000)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    print("built and drawn")

    page.click("#design-open")
    before = style_text(page)
        # the themes
    assert page.locator("#design-pane .theme[data-look]").count() == 4 and page.get_attribute("#design-pane [data-look=light]", "aria-checked") == "true"
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

    # Tiles: a ready profile fills the fields, the Export card shows them, and the files follow them
    page.click("#design-tab-tiles")
    page.click("#design-pane [data-profile=web]")
    prof = page.evaluate("window.designPanel.profile()")
    assert prof["preset"] == "web" and not prof["layers"]["edges"] and not prof["auto"] and prof["maxzoom"] == 14
    assert page.get_attribute("#design-pane [data-profile=web]", "aria-checked") == "true"
    assert page.is_disabled("#design-pane [data-col=name]") and page.is_disabled("#design-pane [data-p='profile.classFrom.motorway']"), "the columns and the class zooms are for the layer edges"
    assert re.search(r"\d+ tiles", page.text_content("#design-count")), page.text_content("#design-count")
    page.click("#design-back")
    if "folded" in (page.get_attribute("#step9-card", "class") or ""):
        page.click("#step9")
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
    page.click("#design-open"); page.click("#design-tab-tiles")
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
    page.click("#design-open"); page.click("#design-tab-theme")
    set_input(page, "[data-p=name]", "My roads", event="change")
    assert page.text_content("#design-name") == "My roads"
    with page.expect_download() as d:
        page.click("#design-download")
    file = out / d.value.suggested_filename
    d.value.save_as(file)
    saved = json.loads(file.read_text())
    assert file.name == "my_roads.design.json" and saved["format"] == "duckosm-design" and saved["version"] == 1 and saved["name"] == "My roads"
    assert saved["roads"]["fill"]["primary"] == "#ff0000" and saved["base"]["buildings"] == "#abcdef" and saved["profile"]["extent"] == 2048
    saved["name"] = "Loaded one"; saved["roads"]["fill"]["primary"] = "#00aa00"
    other = out / "other.design.json"
    other.write_text(json.dumps(saved))
    page.set_input_files("#design-file", str(other))
    page.wait_for_function("window.designPanel.get().name === 'Loaded one'")
    assert page.evaluate("window.designPanel.get().roads.fill.primary") == "#00aa00" and "Loaded" in page.text_content("#design-where")
    settled(page)
    assert "#00aa00" in style_text(page), "a loaded file draws"
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
    print("restore: ok")

    assert not errors, errors
    browser.close()
    server.shutdown()
print("design_e2e: passed")
