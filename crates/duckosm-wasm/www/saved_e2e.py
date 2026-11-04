"""Saved areas (docs/app.md, "Saved areas"): build Monaco in headless Chromium, open the page again in the same browser
profile, restore the area from the browser storage (OPFS), and compare the result card. A rebuild with fewer modes must
not bring back the tables of the old build. Writes saved-restored.png.

    python crates/duckosm-wasm/www/saved_e2e.py <out folder> [--www folder]
"""
import argparse
import pathlib

from playwright.sync_api import sync_playwright

from serve import start

WWW = pathlib.Path(__file__).resolve().parent
DATA = WWW.parents[2] / "tests" / "data"

a = argparse.ArgumentParser()
a.add_argument("out")
a.add_argument("--www", default=str(WWW))
args = a.parse_args()
out = pathlib.Path(args.out)
out.mkdir(parents=True, exist_ok=True)

server = start(0, quiet=True, directory=args.www)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
errors = []


def open_page(ctx):
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    return page


def build(page, modes, features=False):
    if not page.evaluate("window.areas >= 1"):
        page.set_input_files("#file", str(DATA / "monaco.geojson"))   # the File tab of step 1
        page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-region")
    page.set_input_files("#region", str(DATA / "monaco_sample.osm.pbf"))   # the page cuts it to the boundary
    for box in page.query_selector_all("input[name=mode]"):
        box.set_checked(box.get_attribute("value") in modes)
    page.set_checked("#features", features)          # the layers need a region file; with them the build makes the cut file
    page.click("#run")
    page.wait_for_function("!document.getElementById('step5-card').classList.contains('off') || document.getElementById('buildstatus').textContent.startsWith('Error')",
                           timeout=600_000)
    assert not page.inner_text("#buildstatus").startswith("Error"), page.inner_text("#buildstatus")
    # the drawing cache is written after the build
    for _ in range(240):
        if any(a["hasViz"] for a in saved(page)):
            break
        page.wait_for_timeout(500)
    return " ".join(page.inner_text("#resultline").split())


def saved(page):
    return page.evaluate("""async () => (await (await import('./app/area_store.js')).listSavedAreas()).map((a) => ({slug: a.slug, tables: a.tables.map((t) => t.mode + '.' + t.table), hasViz: a.hasViz}))""")


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(accept_downloads=True)   # one profile: the storage stays between the pages
    page = open_page(ctx)
    assert page.evaluate("document.getElementById('areas-card').hidden") and page.is_hidden("#areas-card"), "no saved area, no card \"Your areas\""
    before = build(page, ["driving", "walking"], features=True)
    page.wait_for_function("!document.getElementById('areas-card').hidden", timeout=10_000)   # the card can be folded: the attribute, not the sight
    cut_len = page.evaluate("import('./app/duck.js').then((d) => (d.cut ? d.cut.length : 0))")
    assert cut_len > 1000, "the build made a cut file"
    s = saved(page)
    print("saved:", s[0]["slug"], s[0]["tables"][:40], s[0]["hasViz"])
    assert len(s) == 1 and s[0]["hasViz"] and any(t.startswith("walking.") for t in s[0]["tables"]), (len(s), s[0]["hasViz"], [t for t in s[0]["tables"] if "walk" in t][:3])
    page.close()

    page = open_page(ctx)                                 # a new visit
    page.wait_for_timeout(3000)
    assert not page.evaluate("document.getElementById('areas-card').hidden"), "the card \"Your areas\" shows on a new visit"
    assert page.get_attribute("#tab-find", "aria-selected") == "true", "Search stays the first tab"
    page.wait_for_selector("#areas-card .load-saved-area-btn", state="visible", timeout=30_000)
    # a new visit shows the OpenFreeMap base map; a click on the row shows the boundary and zooms to it, a second click hides it, Open loads the area
    page.wait_for_function("'vbm-openmaptiles' in duckMap.getStyle().sources", timeout=30_000)   # OpenFreeMap's vector style, although the build before set the blank base map
    row = page.locator("#areas-card .saved-area")
    # the row: the whole name, the date and size on one line, a pill that says that the map opens fast, two buttons of one size, and a tint under the pointer
    assert page.evaluate("(() => { const n = document.querySelector('#areas-card .sa-name'); return n.scrollWidth <= n.clientWidth + 1 && getComputedStyle(n).textOverflow !== 'ellipsis'; })()"), "the name is not cut"
    assert "Opens fast" in page.inner_text("#areas-card .sa-pill") and page.evaluate("(() => { const [a, b] = [...document.querySelectorAll('#areas-card .sa-actions .btn')].map((x) => x.getBoundingClientRect()); return Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1; })()"), "Open and Delete have one size"
    assert "sidewalk rule" not in page.inner_text("#areas-card") and page.locator("#areas-card .sa-chip").count() >= 1 and page.locator("#areas-card .sa-chip svg").count() == page.locator("#areas-card .sa-chip").count() and "roads" in page.get_attribute("#areas-card .sa-chip", "title"), "the chips list the networks with an icon, not the build log"
    page.mouse.move(5, 5)
    still = row.evaluate("(r) => getComputedStyle(r).backgroundColor")
    row.hover()
    assert row.evaluate("(r) => getComputedStyle(r).backgroundColor") != still, "the row has a tint under the pointer"
    row.locator("strong").click()
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['preview-line']}).length > 0 && !duckMap.isMoving()", timeout=30_000)
    assert "picked" in row.get_attribute("class") and page.evaluate("duckMap.getZoom()") > 8, "the boundary shows"
    row.locator("strong").click()
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['preview-line']}).length === 0", timeout=10_000)
    row.locator("strong").click()
    page.wait_for_function("duckMap.queryRenderedFeatures({layers: ['preview-line']}).length > 0", timeout=10_000)
    page.click(".load-saved-area-btn")
    page.wait_for_function("duckMap.getSource('preview').serialize().data.features?.length === 0", timeout=30_000)
    page.wait_for_function("document.getElementById('buildstatus').textContent.startsWith('Restored') || document.getElementById('buildstatus').textContent.startsWith('Failed')", timeout=300_000)
    status = page.inner_text("#buildstatus")
    print(status)
    assert status.startswith("Restored"), status
    after = " ".join(page.inner_text("#resultline").split())
    assert after == before, (before, after)
    page.screenshot(path=str(out / "saved-restored.png"))
    print("restored result equals the build:", after)
    # the cut file was saved with the area: the .osm.pbf button is there after a restore, and the file is the same
    assert not page.evaluate("document.getElementById('cutpbf').hidden"), "the .osm.pbf button shows for a restored area"
    with page.expect_download() as dl:
        page.evaluate("document.getElementById('cutpbf').click()")
    assert pathlib.Path(dl.value.path()).stat().st_size == cut_len, (pathlib.Path(dl.value.path()).stat().st_size, cut_len)
    print(f"the cut file ({cut_len} bytes) is kept with the area and downloads after a restore")

    # a new build with fewer modes replaces the area: no walking table may come back
    page.close()
    page = open_page(ctx)
    build(page, ["driving"])
    s = saved(page)
    print("saved after a driving-only build:", s)
    assert len(s) == 1 and not any(t.startswith("walking.") for t in s[0]["tables"]), s
    page.close()
    page = open_page(ctx)
    page.wait_for_selector("#areas-card .load-saved-area-btn", state="visible", timeout=30_000)
    page.click(".load-saved-area-btn")
    page.wait_for_function("document.getElementById('buildstatus').textContent.startsWith('Restored') || document.getElementById('buildstatus').textContent.startsWith('Failed')", timeout=300_000)
    assert page.inner_text("#buildstatus").startswith("Restored")
    n = page.evaluate("""async () => (await (await import('./app/duck.js')).query("select count(*) n from information_schema.schemata where schema_name = 'walking'")).toArray()[0].n""")
    assert int(n) == 0, "the old walking tables came back"

    # an area with a buffer: the restore gives the same grown area, not an area grown twice
    km2 = lambda pg: float(pg.inner_text("#summary .stat b").replace(",", ""))
    page.close()
    page = open_page(ctx)
    page.set_input_files("#file", str(DATA / "monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.fill("#buffer", "300")
    page.wait_for_function("document.getElementById('summary').textContent.includes('+300 m')", timeout=60_000)
    grown = km2(page)
    build(page, ["driving"])
    page.close()
    page = open_page(ctx)
    page.wait_for_selector("#areas-card .load-saved-area-btn", state="visible", timeout=30_000)
    page.click(".load-saved-area-btn")
    page.wait_for_function("document.getElementById('buildstatus').textContent.startsWith('Restored')", timeout=300_000)
    assert page.input_value("#buffer") == "300", page.input_value("#buffer")
    assert abs(km2(page) - grown) < 0.01, ("the restored area is not the grown area", km2(page), grown)
    print(f"restore with a buffer: {km2(page)} km2, as before the build ({grown} km2)")
    # the card folds when an area is chosen (the restore chose one); the page has no Saved tab
    assert "folded" in (page.get_attribute("#areas-card", "class") or ""), "the list folds when an area is chosen"
    assert page.locator("#tab-saved").count() == 0
    # Delete asks for a second click on the same button, in place; then the area is gone
    page.click("#areas-card .rs-sec-title")               # open the card again
    page.click("#areas-card .del-saved-area-btn")
    assert "Click again" in page.inner_text("#areas-card .del-saved-area-btn") and len(saved(page)) == 1, "one click does not delete"
    page.click("#areas-card .del-saved-area-btn")
    page.wait_for_function("document.getElementById('areas-card').hidden", timeout=20_000)
    assert saved(page) == [], saved(page)
    print("Delete: the first click asks in place, the second deletes the area, and the card goes when no area is left")
    browser.close()

assert not errors, errors
print("OK")
