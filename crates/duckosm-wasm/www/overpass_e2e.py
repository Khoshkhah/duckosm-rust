"""The base-map layers from the Overpass API (docs/features.md): the page builds Monaco from a saved Overpass answer
(tests/data/monaco_overpass.json.gz) with the box Layers on. The build must have the layer tables (features_*.parquet,
with rows), and the page's query must ask for the objects of the layers. Then the page builds again with Layers off,
from the same answer: the road tables must have the same bytes (raw.* does not change the roads).

Each request to an Overpass server gets the saved answer, so the test does not need the public servers.

    python crates/duckosm-wasm/www/overpass_e2e.py out-overpass [--record]

--record sends the page's query to the first Overpass server one time and saves its answer as the fixture. Build the
page first (docs/development.md, "WebAssembly"). The page loads duckdb-wasm from cdn.jsdelivr.net.
"""
import argparse
import base64
import gzip
import pathlib
import re
import urllib.parse

from playwright.sync_api import sync_playwright

from serve import start

WWW = pathlib.Path(__file__).resolve().parent
DATA = WWW.parents[2] / "tests" / "data"
FIXTURE = DATA / "monaco_overpass.json.gz"

a = argparse.ArgumentParser()
a.add_argument("out")
a.add_argument("--record", action="store_true", help="get the answer from the Overpass API and save it as the fixture")
args = a.parse_args()
out = pathlib.Path(args.out)
out.mkdir(parents=True, exist_ok=True)

server = start(0, isolated=True, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
queries = []


SERVERS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
           "https://overpass.private.coffee/api/interpreter"]


def answer(route):
    query = urllib.parse.parse_qs(route.request.post_data)["data"][0]
    queries.append(query)
    if args.record and not FIXTURE.exists():
        # a busy public server admits a small query sooner (90 s, 256 MB); each server two times
        small = re.sub(r"\[timeout:\d+\]\[maxsize:\d+\]", "[timeout:90][maxsize:268435456]", query)
        for server in SERVERS * 2:
            r = route.fetch(url=server, post_data=urllib.parse.urlencode({"data": small}), timeout=300_000)
            print(f"record: {server}: {r.status}")
            if r.ok:
                FIXTURE.write_bytes(gzip.compress(r.body(), 9))
                print(f"recorded {FIXTURE.name}: {len(r.body())} bytes")
                break
        assert FIXTURE.exists(), "no Overpass server answered"
    route.fulfill(status=200, content_type="application/json", body=gzip.decompress(FIXTURE.read_bytes()))


def build(browser, layers):
    page = browser.new_page()
    page.on("pageerror", lambda e: print("page error:", e))
    page.route("**/api/interpreter", answer)
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    page.set_input_files("#file", str(DATA / "monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-overpass")
    for box in page.query_selector_all("input[name=mode]"):
        box.set_checked(True)
    page.set_checked("#features", layers)
    page.click("#run")
    page.wait_for_function("!document.getElementById('step5-card').classList.contains('off') || document.getElementById('buildstatus').textContent.startsWith('Error')",
                           timeout=600_000)
    status = page.inner_text("#buildstatus")
    assert not status.startswith("Error"), status
    print(f"layers {'on' if layers else 'off'}:", status)
    files = page.evaluate("""async () => Promise.all([...document.querySelectorAll('#files a[download]')].map(async (a) => {
        const b = new Blob([await (await fetch(a.href)).arrayBuffer()]);
        const url = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(b); });
        return [a.download, url.slice(url.indexOf(',') + 1)];
    }))""")
    d = out / ("layers" if layers else "roads")
    d.mkdir(exist_ok=True)
    for name, data in files:
        (d / name).write_bytes(base64.b64decode(data))
    page.close()
    return d


with sync_playwright() as p:
    browser = p.chromium.launch()
    with_layers = build(browser, True)
    roads = build(browser, False)
    browser.close()

# the query: the roads, and with Layers also the objects of the layers with their members
assert len(queries) == 2, queries
assert '(.w;.w >;.r;.f;.f >;)' in queries[0] and 'way[~"^(building|' in queries[0], queries[0]
assert '.f' not in queries[1], queries[1]

import duckdb  # noqa: E402  (only for the checks of the files)

features = sorted(f.name for f in with_layers.glob("features_*.parquet"))
rows = {f: duckdb.sql(f"SELECT count(*) FROM '{with_layers / f}'").fetchone()[0] for f in features}
print("layers:", rows)
for t in ("buildings", "land", "streets", "pois", "water_polygons"):
    assert rows.get(f"features_{t}.parquet", 0) > 0, f"no rows in features.{t}"
assert not list(roads.glob("features_*.parquet")), "Layers off: no layer tables"

# the road tables: the same bytes with and without raw.*
for mode in ("driving", "walking", "cycling"):
    for t in ("edges", "nodes", "edge_graph"):
        name = f"{t}_{mode}.parquet"
        a, b = (with_layers / name).read_bytes(), (roads / name).read_bytes()
        assert a == b, f"{name} differs with Layers on"
print("road tables: the same bytes with Layers on and off")
