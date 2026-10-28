"""The dashboard's check of the tiles' generation (roadstyle:generation, roadstyle's dashboard/generation.js) in headless Chromium
(Playwright): build Monaco, draw the roads map, and check the normal path (the ?g= of the tile URL is the style's: no message, the roads
show) and a stale generation (the event rs:tiles-generation with another one: the red message and the vector layers hidden;
the right generation again: all back). The page must not hide the message.

    python crates/duckosm-wasm/www/generation_e2e.py

It uses tests/data/monaco.osm.pbf and tests/data/monaco.geojson. Build the page first (docs/development.md, "WebAssembly").
"""
import pathlib
import re

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.on("pageerror", lambda e: print("page error:", e))
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-cut")
    page.set_input_files("#pbf", str(ROOT / "tests/data/monaco.osm.pbf"))
    page.click("#run")
    page.wait_for_function("!document.getElementById('step5-card').hidden", timeout=300_000)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent)", timeout=300_000)
    page.wait_for_function("window.duckMap && window.duckMap.loaded()", timeout=300_000)
    tiles = page.evaluate("Object.values(window.duckMap.getStyle().sources).flatMap((s) => s.tiles ?? [])")
    gen = re.search(r"[?&]g=([0-9a-f]+)", " ".join(tiles)).group(1)
    shown = "(() => { const l = window.duckMap.getStyle().layers.filter((l) => l.id.startsWith('rs-') && l.source !== 'rs-boundary'" \
            " && window.duckMap.getSource(l.source)?.type === 'vector'); return [l.length, l.filter((x) => window.duckMap.getLayoutProperty(x.id, 'visibility') === 'none').length]; })()"

    n, hidden = page.evaluate(shown)
    assert n > 0 and hidden == 0 and not page.evaluate("window.rs.error") and not page.query_selector("#rs-stale"), (n, hidden)
    print(f"normal: generation {gen} in the tile URL; no message, {n} vector layers shown")

    page.evaluate("(g) => document.dispatchEvent(new CustomEvent('rs:tiles-generation', { detail: g }))", "0" * len(gen))
    page.wait_for_selector("#rs-stale", timeout=5_000)
    n, hidden = page.evaluate(shown)
    assert hidden == n, (n, hidden)
    assert page.is_visible("#rs-stale"), "the page hides the message"
    print(f"stale: '{page.inner_text('#rs-stale')[:60]}...'; {hidden} of {n} vector layers hidden")

    page.evaluate("(g) => document.dispatchEvent(new CustomEvent('rs:tiles-generation', { detail: g }))", gen)
    page.wait_for_function("!document.getElementById('rs-stale')", timeout=5_000)
    n, hidden = page.evaluate(shown)
    assert hidden == 0, hidden
    print("right generation again: the message goes, the layers show")
    browser.close()
server.shutdown()
