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


def build(page, modes):
    if not page.evaluate("window.areas >= 1"):
        page.set_input_files("#file", str(DATA / "monaco.geojson"))   # the File tab of step 1
        page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-region")
    page.set_input_files("#region", str(DATA / "monaco_sample.osm.pbf"))   # the page cuts it to the boundary
    for box in page.query_selector_all("input[name=mode]"):
        box.set_checked(box.get_attribute("value") in modes)
    page.set_checked("#features", False)
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
    assert page.evaluate("document.getElementById('tab-saved').hidden") and page.is_hidden("#tab-saved"), "no saved area, no Saved tab"
    before = build(page, ["driving", "walking"])
    page.wait_for_function("!document.getElementById('tab-saved').hidden", timeout=10_000)   # the card can be folded: the attribute, not the sight
    s = saved(page)
    print("saved:", s[0]["slug"], s[0]["tables"][:40], s[0]["hasViz"])
    assert len(s) == 1 and s[0]["hasViz"] and any(t.startswith("walking.") for t in s[0]["tables"]), (len(s), s[0]["hasViz"], [t for t in s[0]["tables"] if "walk" in t][:3])
    page.close()

    page = open_page(ctx)                                 # a new visit
    page.wait_for_timeout(3000)
    assert not page.evaluate("document.getElementById('tab-saved').hidden"), "the Saved tab shows on a new visit"
    page.wait_for_selector("#restore-banner", state="visible", timeout=30_000)
    page.click("#restore-btn")
    page.wait_for_function("document.getElementById('buildstatus').textContent.startsWith('Restored') || document.getElementById('buildstatus').textContent.startsWith('Failed')", timeout=300_000)
    status = page.inner_text("#buildstatus")
    print(status)
    assert status.startswith("Restored"), status
    after = " ".join(page.inner_text("#resultline").split())
    assert after == before, (before, after)
    page.screenshot(path=str(out / "saved-restored.png"))
    print("restored result equals the build:", after)

    # a new build with fewer modes replaces the area: no walking table may come back
    page.close()
    page = open_page(ctx)
    build(page, ["driving"])
    s = saved(page)
    print("saved after a driving-only build:", s)
    assert len(s) == 1 and not any(t.startswith("walking.") for t in s[0]["tables"]), s
    page.close()
    page = open_page(ctx)
    page.wait_for_selector("#restore-banner", state="visible", timeout=30_000)
    page.click("#restore-btn")
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
    page.wait_for_selector("#restore-banner", state="visible", timeout=30_000)
    page.click("#restore-btn")
    page.wait_for_function("document.getElementById('buildstatus').textContent.startsWith('Restored')", timeout=300_000)
    assert page.input_value("#buffer") == "300", page.input_value("#buffer")
    assert abs(km2(page) - grown) < 0.01, ("the restored area is not the grown area", km2(page), grown)
    print(f"restore with a buffer: {km2(page)} km2, as before the build ({grown} km2)")
    browser.close()

assert not errors, errors
print("OK")
