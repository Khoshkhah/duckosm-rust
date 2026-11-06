"""The card Export (step 10, docs/dashboard.md) in headless Chromium (Playwright): build Monaco, download each format, and check the files against the tables.

    python crates/duckosm-wasm/www/export_e2e.py [out folder]

It uses tests/data/monaco_sample.osm.pbf and tests/data/monaco.geojson. The page loads fflate from cdn.jsdelivr.net.
"""
import io
import math
import json
import struct
import pathlib
import sys
import xml.etree.ElementTree as ET
import zipfile

from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-export")
out.mkdir(parents=True, exist_ok=True)
server = start(0, quiet=True, directory=WWW)
url = f"http://127.0.0.1:{server.server_address[1]}/index.html"
errors = []


def rows(page, sql):
    return page.evaluate(f"window.duckApi.query({sql!r}).then((r) => r.toArray().map((x) => x.toJSON()))")


def serve_range(route, body):
    """answer a request of the pmtiles library for a range of the file"""
    rng = route.request.headers.get("range")
    if rng:
        a_, b_ = rng.replace("bytes=", "").split("-")
        part = body[int(a_): int(b_) + 1]
        route.fulfill(status=206, body=part, headers={"Content-Range": f"bytes {a_}-{int(a_) + len(part) - 1}/{len(body)}", "Accept-Ranges": "bytes", "Content-Type": "application/octet-stream"})
    else:
        route.fulfill(status=200, body=body)


def download(page, fmt):
    page.evaluate("window.lastCheck = null")
    try:
        with page.expect_download(timeout=60_000) as d:
            page.click(f"#export-list [data-fmt={fmt}]")
    except Exception:
        print("DEBUG", fmt, page.inner_text("#export-status"), errors)
        raise
    path = out / d.value.suggested_filename
    d.value.save_as(path)
    page.wait_for_function("window.lastCheck !== null", timeout=120_000)
    chk = page.evaluate("window.lastCheck")
    assert chk["ok"], (fmt, "the page's own check found a problem", chk)
    assert page.locator(f"#export-list [data-fmt={fmt}]").locator("xpath=ancestor::div[contains(@class,'exp')]").locator(".chk.ok").count() == 1, "the check line shows under the format"
    print(f"  check {fmt}: {chk['text'][:150]}")
    return path


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 900}, accept_downloads=True)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    assert "off" in (page.get_attribute("#step10-card", "class") or ""), "the card is off before a build"
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    page.click("#run")
    page.wait_for_function("!document.getElementById('run').hasAttribute('aria-busy') && !document.getElementById('step7-card').classList.contains('off')", timeout=600_000)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    assert "off" not in (page.get_attribute("#step10-card", "class") or ""), "the card is on after a build"
    if "folded" in (page.get_attribute("#step10-card", "class") or ""):
        page.click("#step10")
    assert page.locator("#export-list [data-fmt]").count() == 14
    # each check box of the card is a plain check box (the rule of the 80 px number box "Width" took them too), also at the width of a phone
    for vw, vh in ((1400, 900), (390, 844)):
        page.set_viewport_size({"width": vw, "height": vh})
        page.locator("#export-list .exp:has([data-fmt=geojson]) .export-merge").scroll_into_view_if_needed()
        ws = page.eval_on_selector_all("#export-list input[type=checkbox]", "(l) => l.map((x) => x.getBoundingClientRect().width)")
        assert ws and 0 < max(ws) <= 24, ("the check boxes are their own size", vw, ws)
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "no page wider than the window"
    page.screenshot(path=str(out / "export_card_phone.png"))
    page.set_viewport_size({"width": 1400, "height": 900})
    assert page.evaluate("document.getElementById('export-zmax').compareDocumentPosition(document.getElementById('export-seg')) & Node.DOCUMENT_POSITION_FOLLOWING"), "the network control comes after the tile section (it is for the files)"
    assert page.locator("#export-list .expsec").count() == 4 and page.locator("#export-seg [data-m]").count() == 3 and page.get_attribute("#export-seg [data-m=driving]", "aria-checked") == "true"
    assert [t.strip() for t in page.eval_on_selector_all("#export-list .expsec h3", "(l) => l.map((x) => x.textContent)")] == ["Tiles", "Network", "Visualization", "Simulation"], "tiles, the network, visualization and simulation are four sections"
    assert page.evaluate("getComputedStyle(document.querySelector('#export-full').closest('.rs-opt')).display") == "flex", "the Everything row has the card's option style"
    n_edges = rows(page, "SELECT count(*)::INTEGER AS n FROM driving.edges")[0]["n"]
    n_nodes = rows(page, "SELECT count(*)::INTEGER AS n FROM driving.nodes")[0]["n"]
    ids = {str(r["edge_id"]) for r in rows(page, "SELECT edge_id::VARCHAR AS edge_id FROM driving.edges")}
    n_pairs = rows(page, "SELECT count(*)::INTEGER AS n FROM driving.edges WHERE is_reverse")[0]["n"]        # a two-way road is a forward edge and a reverse edge
    n_roads = n_edges - n_pairs
    assert n_pairs > 100 and n_roads < n_edges

    # GeoJSON: plain files (kepler.gl cannot open a .zip): one feature for each edge and for each node, the ids as text (a BIGINT hash is more than 2^53), no NaN
    gj = download(page, "geojson")
    assert gj.name.endswith("_roads.geojson") and not gj.name.endswith(".zip")
    roads = json.loads(gj.read_text())
    gn = download(page, "geojson_nodes")
    nodes = json.loads(gn.read_text())
    # by default every direction is a feature of its own, as on the page's map: a two-way road is two features with their own id and their own geometry (the line in the direction of travel)
    assert roads["type"] == "FeatureCollection" and len(roads["features"]) == n_edges and len(nodes["features"]) == n_nodes, (len(roads["features"]), n_edges)
    assert {f["properties"]["edge_id"] for f in roads["features"]} == ids, "the edge ids are the ids of the table, as text"
    two = [f for f in roads["features"] if f["properties"]["twoway"]]
    assert len(two) == 2 * n_pairs and {f["properties"]["direction"] for f in two} == {"forward", "reverse"}
    byid = {f["properties"]["edge_id"]: f for f in roads["features"]}
    for f in two[:200]:
        other = byid[f["properties"]["edge_id_pair"]]
        assert other["properties"]["edge_id_pair"] == f["properties"]["edge_id"] and other["properties"]["direction"] != f["properties"]["direction"]
        # each direction is moved to its right (kepler.gl cannot offset a line): the start of one is apart from the end of the other by the two offsets
        (ax, ay), (bx, by) = f["geometry"]["coordinates"][0], other["geometry"]["coordinates"][-1]
        gap = math.hypot((ax - bx) * 111320 * math.cos(math.radians(ay)), (ay - by) * 110540)
        want = f["properties"]["offset_m"] + other["properties"]["offset_m"]
        assert want > 0 and abs(gap - want) < 0.05 + 0.02 * want, ("the two directions lie on two sides of the road", gap, want)
    assert all(not f["properties"]["twoway"] and f["properties"]["edge_id_pair"] is None for f in roads["features"] if f["properties"]["oneway"])
    # the option "One feature for a two-way road": the forward edge with the id of the reverse edge
    page.check("#export-list .exp:has([data-fmt=geojson]) .export-merge")
    gm = json.loads(download(page, "geojson").read_text())
    page.uncheck("#export-list .exp:has([data-fmt=geojson]) .export-merge")
    assert len(gm["features"]) == n_roads
    both = [f["properties"]["edge_id"] for f in gm["features"]] + [f["properties"]["edge_id_reverse"] for f in gm["features"] if f["properties"]["edge_id_reverse"]]
    assert set(both) == ids and len(both) == n_edges and sum(1 for f in gm["features"] if f["properties"]["twoway"]) == n_pairs
    assert all(f["geometry"]["type"] == "LineString" for f in roads["features"][:50]) and all(f["geometry"]["type"] == "Point" for f in nodes["features"][:50])
    assert "NaN" not in gj.read_text() and "Infinity" not in gj.read_text()
    props = roads["features"][0]["properties"]
    assert all(k in props for k in ("casing_level", "fill_level", "bridge", "tunnel", "layer", "surface", "highway", "twoway")), ("the roads carry the levels and the bridge and tunnel columns", sorted(props))
    look_cols = ("fill_color", "fill_width_m", "casing_color", "casing_width_m", "offset_m", "stroke")
    assert all(k in props for k in look_cols) and all(f["properties"]["fill_color"] and f["properties"]["fill_width_m"] > 0 for f in roads["features"]), ("the look's columns", sorted(props))
    assert any(f["properties"]["fill_color"] == "#ffeeaa" for f in roads["features"] if f["properties"]["highway"] == "primary"), "the colors of the page's palette (liberty), not amber"
    # the other layers as GeoJSON files: buildings, water, land use ..., the street names and the one-way arrows
    lz = zipfile.ZipFile(download(page, "geojson_layers"))
    lnames = sorted(lz.namelist())
    assert "features_buildings.geojson" in lnames and "names.geojson" in lnames and "arrows.geojson" in lnames, lnames
    bl = json.loads(lz.read("features_buildings.geojson"))
    assert len(bl["features"]) > 500 and bl["features"][0]["geometry"]["type"] in ("Polygon", "MultiPolygon")
    ar = json.loads(lz.read("arrows.geojson"))
    assert ar["features"] and all(0 <= f["properties"]["bearing"] < 360 for f in ar["features"][:50]) and ar["features"][0]["geometry"]["type"] == "Point"
    nm = json.loads(lz.read("names.geojson"))
    assert nm["features"] and nm["features"][0]["properties"]["name"]
    print(f"GeoJSON layers: {', '.join(lnames)}")
    print(f"GeoJSON: {n_edges} edges (each direction of a two-way road is a feature; merged: {n_roads}) and {n_nodes} nodes, plain files")

    # GeoPackage: a SQLite file with the GeoPackage tables, one row for each edge and node, and a geometry blob with the "GP" header and a WKB line
    import sqlite3
    import struct
    gp = sqlite3.connect(download(page, "gpkg"))
    assert gp.execute("PRAGMA application_id").fetchone()[0] == 0x47504B47
    assert gp.execute("SELECT count(*) FROM roads").fetchone()[0] == n_edges and gp.execute("SELECT count(*) FROM nodes").fetchone()[0] == n_nodes
    assert gp.execute("SELECT count(*) FROM roads WHERE twoway = 1").fetchone()[0] == 2 * n_pairs and gp.execute("SELECT count(DISTINCT direction) FROM roads WHERE twoway = 1").fetchone()[0] == 2
    assert gp.execute("SELECT count(*) FROM gpkg_spatial_ref_sys WHERE srs_id = 4326").fetchone()[0] == 1
    blob, eid = gp.execute("SELECT geom, edge_id FROM roads ORDER BY fid LIMIT 1").fetchone()
    assert blob[:2] == b"GP" and blob[3] == 1 and struct.unpack("<i", blob[4:8])[0] == 4326 and blob[8] == 1 and struct.unpack("<I", blob[9:13])[0] == 2, "GP header, then a little-endian WKB LineString"
    npts = struct.unpack("<I", blob[13:17])[0]
    x0, y0 = struct.unpack("<dd", blob[17:33])
    first = rows(page, f"SELECT ST_NPoints(geometry)::INTEGER AS n, ST_X(ST_StartPoint(geometry)) AS x, ST_Y(ST_StartPoint(geometry)) AS y FROM driving.edges WHERE edge_id = {eid}")[0]
    assert npts == first["n"] and abs(first["x"] - x0) < 1e-9 and abs(first["y"] - y0) < 1e-9, "the GeoPackage has the center line of the table"
    tables = {r[0] for r in gp.execute("SELECT table_name FROM gpkg_contents")}
    assert {"roads", "nodes", "names", "arrows", "features_buildings"} <= tables, tables
    assert gp.execute("SELECT count(*) FROM features_buildings").fetchone()[0] == len(bl["features"]) and gp.execute("SELECT count(*) FROM arrows").fetchone()[0] == len(ar["features"])
    import xml.etree.ElementTree as XML
    styles = dict(gp.execute("SELECT f_table_name, styleQML FROM layer_styles").fetchall())
    assert {"roads", "features_buildings", "names", "arrows"} <= set(styles), sorted(styles)
    for t, q in styles.items():
        XML.fromstring(q.split("\n", 1)[1])          # the QML parses (the first line is the DOCTYPE)
    rq = XML.fromstring(styles["roads"].split("\n", 1)[1])
    levels = {v for r in gp.execute("SELECT DISTINCT casing_level, fill_level FROM roads") for v in r}
    rules = [r.get("key") for r in rq.iter("rule")]
    assert rq.find("renderer-v2").get("type") == "RuleRenderer" and rq.find("renderer-v2").get("symbollevels") == "1"
    assert sorted(rules) == sorted(f"{k}-{v}" for v in levels for k in ("casing", "fill")), ("a casing and a fill rule for each drawing position", rules, levels)
    dd = [o.get("name") for o in rq.iter("Option") if o.get("type") == "Map" and o.get("name") in ("outlineWidth", "outlineColor", "offset")]
    assert dd.count("outlineWidth") == len(rules) and dd.count("offset") == len(rules), "each line has a data-defined width and offset"
    assert all("@map_scale" in o.get("value") for o in rq.iter("Option") if o.get("name") == "expression"), "each expression reads the zoom of the QGIS map"
    print(f"GeoPackage: {n_edges} roads and {n_nodes} nodes, layers {sorted(tables)}, QGIS styles for {sorted(styles)}")
    # the QGIS style as a file
    qf = download(page, "qml")
    XML.fromstring(qf.read_text().split("\n", 1)[1])
    assert qf.name.endswith("_roads.qml")

    # SVG: the roads as paths (casings and fills), the buildings and water as polygons; a picture that opens in a browser
    sv = download(page, "svg")
    sd = XML.fromstring(sv.read_text().split("\n", 1)[1])
    ns = "{http://www.w3.org/2000/svg}"
    moves = sum(p.get("d").count("M") for p in sd.iter(ns + "path") if p.getparent is None or True) if False else 0
    fills = [p for g in sd.iter(ns + "g") if g.get("id") == "road-fills" for p in g.iter(ns + "path")]
    assert fills and sum(p.get("d").count("M") for p in fills) == n_roads, "one line for each road in the SVG"
    assert any(g.get("id") == "buildings" for g in sd.iter(ns + "g")) and any(g.get("id") == "water" for g in sd.iter(ns + "g"))
    assert any((g.get("id") or "").startswith("land-marina") for g in sd.iter(ns + "g")), "the land use is colored by kind (the harbour is `marina`)"
    assert sd.find(ns + "rect") is not None, "a background rectangle by default"
    vp = browser.new_page(viewport={"width": 1200, "height": 1100})
    (out / "view.html").write_text(f'<body style="margin:0"><img src="{sv.resolve().as_uri()}" style="width:1200px;display:block">')
    vp.goto((out / "view.html").resolve().as_uri())
    vp.wait_for_timeout(1000)
    vp.screenshot(path=str(out / "map_svg.png"))
    vp.close()
    # a transparent background: no rectangle in the SVG
    page.check("#export-list .exp:has([data-fmt=svg]) .export-img-t")
    sv2 = download(page, "svg")
    assert XML.fromstring(sv2.read_text().split("\n", 1)[1]).find(ns + "rect") is None, "no background rectangle when it is transparent"
    page.uncheck("#export-list .exp:has([data-fmt=svg]) .export-img-t")
    print(f"SVG: {len(fills)} classes, {n_roads} road lines")

    # the MapLibre style as a file, and a PNG picture of the area (the width is the field of its row)
    sty = json.loads(download(page, "style").read_text())
    assert all(v["url"] == "pmtiles://tiles.pmtiles" for v in sty["sources"].values()) and "rs_theme" in sty["state"] and len(sty["layers"]) > 30
    page.fill("#export-list .exp:has([data-fmt=png]) .export-img-w", "1600")
    pg_png = download(page, "png")
    head = pg_png.read_bytes()[:24]
    wpx, hpx = struct.unpack(">II", head[16:24])
    assert head[:8] == b"\x89PNG\r\n\x1a\n" and wpx == 1600 and hpx > 500, (wpx, hpx)
    print(f"PNG: {wpx} x {hpx} px")
    page.check("#export-list .exp:has([data-fmt=png]) .export-img-t")
    tp = download(page, "png")
    from PIL import Image
    im = Image.open(tp).convert("RGBA")
    assert im.getpixel((2, 2))[3] == 0 and any(im.getpixel((x, y))[3] > 200 for x in range(0, im.width, 97) for y in range(0, im.height, 89)), "a transparent corner, and map pixels that are not"
    page.uncheck("#export-list .exp:has([data-fmt=png]) .export-img-t")
    print("PNG with a transparent background: the corner has alpha 0")

    # kepler.gl: a map file with one dataset for each drawing position, each with a casing layer under a fill layer that read the look's columns
    kp = json.loads(download(page, "kepler").read_text())
    sets, klayers = [d["data"] for d in kp["datasets"]], kp["config"]["config"]["visState"]["layers"]
    assert sum(len(d["allData"]) for d in sets) == n_edges and all(d["fields"][0]["type"] == "geojson" for d in sets) and len(klayers) == 2 * len(sets)
    assert {l["visualChannels"]["strokeColorField"]["name"] for l in klayers} == {"casing_color", "fill_color"} and all(l["config"]["visConfig"]["thickness"] == 0.125 for l in klayers)
    order = [l["config"]["dataId"] for l in klayers[::-1]]          # kepler.gl draws the last layer of the list first
    assert order == sorted(order, key=lambda i: [d["id"] for d in sets].index(i)), "the drawing positions from the lowest up"
    print(f"kepler.gl: {sum(len(d['allData']) for d in sets)} edges, {len(sets)} drawing positions, {len(klayers)} layers")

    # the segmented control picks the network of the files: Walking gives the walking edges
    page.click("#export-seg [data-m=walking]")
    assert page.get_attribute("#export-seg [data-m=walking]", "aria-checked") == "true" and page.input_value("#export-mode") == "walking"
    walk = sqlite3.connect(download(page, "gpkg"))
    n_walk = rows(page, "SELECT count(*)::INTEGER AS n FROM walking.edges")[0]["n"]
    assert walk.execute("SELECT count(*) FROM roads").fetchone()[0] == n_walk and n_walk != n_edges, (n_walk, n_edges)
    page.click("#export-seg [data-m=driving]")
    print(f"Network control: Walking gives {n_walk} roads")

    # MATSim: the DTD line, one link for each edge, meters (not degrees), free speed and capacity above 0, every link between two nodes
    path = download(page, "matsim")
    root = ET.parse(path).getroot()
    mn, ml = root.findall("./nodes/node"), root.findall("./links/link")
    assert len(mn) == n_nodes and len(ml) == n_edges, (len(mn), len(ml))
    assert "network_v2.dtd" in path.read_text()[:300] and "EPSG:326" in path.read_text()[:600]
    node_ids = {n.get("id") for n in mn}
    assert all(l.get("from") in node_ids and l.get("to") in node_ids and float(l.get("freespeed")) > 0 and int(l.get("capacity")) > 0 and l.get("modes") == "car" for l in ml)
    assert max(abs(float(n.get("x"))) for n in mn) > 1000, "meters, not degrees"
    assert {l.get("id") for l in ml} == ids
    print(f"MATSim: {len(ml)} links, {len(mn)} nodes")

    # SUMO: the three files parse, the edges have shapes that start and end at their nodes, the connections are the edge graph, the README has netconvert
    z = zipfile.ZipFile(download(page, "sumo"))
    nod = ET.fromstring(z.read("monaco_driving.nod.xml")) if "monaco_driving.nod.xml" in z.namelist() else None
    slug = next(n for n in z.namelist() if n.endswith(".nod.xml"))[:-8]
    nod, edg, con = (ET.fromstring(z.read(f"{slug}.{k}.xml")) for k in ("nod", "edg", "con"))
    pos = {n.get("id"): (float(n.get("x")), float(n.get("y"))) for n in nod}
    es = edg.findall("edge")
    assert len(es) == n_edges and len(pos) == n_nodes
    for e in es[:200]:
        pts = [tuple(map(float, q.split(","))) for q in e.get("shape").split()]
        a, b = pos[e.get("from")], pos[e.get("to")]
        assert abs(pts[0][0] - a[0]) < 0.02 and abs(pts[0][1] - a[1]) < 0.02 and abs(pts[-1][0] - b[0]) < 0.02 and abs(pts[-1][1] - b[1]) < 0.02, "the shape starts and ends at the nodes"
    want = rows(page, "SELECT count(*)::INTEGER AS n FROM driving.edge_graph WHERE from_edge IN (SELECT edge_id FROM driving.edges) AND to_edge IN (SELECT edge_id FROM driving.edges)")[0]["n"]
    cs = con.findall("connection")
    assert len(cs) == want and all(c.get("from") in ids and c.get("to") in ids for c in cs), (len(cs), want)
    assert "netconvert" in z.read("README.txt").decode()
    print(f"SUMO: {len(es)} edges, {len(cs)} connections")
    # Web map: a .zip with the tiles, the style, a viewer and a small server; run the server, open the viewer in a new browser page, and the roads are drawn with no errors
    import socket
    import subprocess
    import time
    assert page.locator("#export-list [data-tiles]").count() == 5
    wm = download(page, "webmap")
    z = zipfile.ZipFile(wm)
    assert sorted(z.namelist()) == ["README.txt", "index.html", "serve.py", "style.json", "tiles.pmtiles"], z.namelist()
    site = out / "webmap_site"
    site.mkdir(exist_ok=True)
    z.extractall(site)
    st = json.loads((site / "style.json").read_text())
    assert all(s["url"] == "pmtiles://tiles.pmtiles" for s in st["sources"].values()) and "rs_theme" in st["state"] and len(st["layers"]) > 30
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); wport = sock.getsockname()[1]; sock.close()
    srv = subprocess.Popen(["python3", "serve.py", str(wport)], cwd=site)
    try:
        time.sleep(1.5)
        wp = browser.new_page(viewport={"width": 1100, "height": 800})
        werrs = []
        wp.on("console", lambda m: m.type == "error" and werrs.append(m.text[:160]))
        wp.on("pageerror", lambda e: werrs.append(str(e)))
        wp.goto(f"http://127.0.0.1:{wport}/index.html#15/43.7384/7.4246")
        wp.wait_for_function("window.map && map.loaded() && map.areTilesLoaded()", timeout=90_000)
        wp.wait_for_timeout(1500)
        drawn = wp.evaluate("map.queryRenderedFeatures({layers: map.getStyle().layers.filter((l) => l.source === 'rs-roads' && l.type === 'line').map((l) => l.id)}).length")
        assert drawn > 200 and not werrs, (drawn, werrs[:3])
        wp.screenshot(path=str(out / "webmap.png"))
        print(f"Web map: the viewer draws {drawn} road features from the package, no errors")
        wp.close()
    finally:
        srv.terminate()
    # tiles: the zooms of the card, a count; PMTiles that the pmtiles library reads (the header, the metadata, a tile that is MVT), and MBTiles (SQLite) with the same tiles
    assert page.locator("#export-list [data-tiles]").count() == 5 and page.evaluate("[...document.querySelectorAll('#export-list [data-tiles]')].every((b) => !b.disabled)"), "the tile buttons are on after the map is drawn"
    # the profile at the first visit (Analysis, step 9): the layer edges, zoom 0 to the highest that fits, all networks, every road attribute in the tiles
    assert page.is_checked("#export-full") and page.is_checked("#export-auto") and page.is_disabled("#export-zmax") and page.input_value("#export-zmin") == "0"
    assert "Analysis" in page.text_content("#export-profile")
    zmax = int(page.input_value("#export-zmax"))
    assert zmax >= 14, zmax
    page.wait_for_function("/\\d+ tiles\\./.test(document.getElementById('export-tiles').textContent)")
    full_path = download(page, "pmtiles")
    served = {"body": full_path.read_bytes()}
    page.route("**/__dl/full.pmtiles", lambda route: serve_range(route, served["body"]))
    page.add_script_tag(url="https://cdn.jsdelivr.net/npm/pmtiles@3.2.1/dist/pmtiles.js")
    ev = page.evaluate("""async (zmax) => {
        const mvt = await import('./app/mvt.js'), p = new pmtiles.PMTiles('/__dl/full.pmtiles'), h = await p.getHeader();
        const n = 2 ** zmax, x0 = Math.floor((7.40 + 180) / 360 * n), x1 = Math.floor((7.45 + 180) / 360 * n);
        const lat = (d) => { const r = d * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
        const ids = new Set(); let sample = null, pieces = 0;
        for (let x = x0; x <= x1; x++) for (let y = lat(43.76); y <= lat(43.72); y++) {
            const t = await p.getZxy(zmax, x, y);
            if (!t) continue;
            const L = mvt.decodeTile(new Uint8Array(t.data)).find((l) => l.name === 'edges');
            if (!L) continue;
            for (const f of L.features) { const q = mvt.propsOf(L, f); ids.add(q.edge_id); sample ??= q; pieces++; }
        }
        const low = await p.getZxy(5, Math.floor((7.4246 + 180) / 360 * 32), Math.floor((1 - Math.log(Math.tan(43.7384 * Math.PI / 180) + 1 / Math.cos(43.7384 * Math.PI / 180)) / Math.PI) / 2 * 32));
        const Ll = low ? mvt.decodeTile(new Uint8Array(low.data)).find((l) => l.name === 'edges') : null;
        return {min: h.minZoom, max: h.maxZoom, ids: [...ids], pieces, sample, lowClasses: Ll ? [...new Set(Ll.features.map((f) => mvt.propsOf(Ll, f).highway))] : null};
    }""", zmax)
    assert ev["min"] == 0 and ev["max"] == zmax, ev
    union = rows(page, "SELECT count(*)::INTEGER AS n FROM (SELECT edge_id FROM driving.edges UNION SELECT edge_id FROM walking.edges UNION SELECT edge_id FROM cycling.edges)")[0]["n"]
    assert len(ev["ids"]) == union, ("every edge of every network is in the tiles of the highest zoom", len(ev["ids"]), union)
    assert all(k in ev["sample"] for k in ("osm_id", "edge_id", "edge_ref", "highway", "driving", "walking", "cycling", "length_m", "source", "target")), ev["sample"]
    assert ev["lowClasses"] is None or set(ev["lowClasses"]) <= {"motorway", "trunk", "primary", "primary_link", "motorway_link", "trunk_link"}, ev["lowClasses"]
    print(f"Everything: zoom 0 to {zmax}, {len(ev['ids'])} edges of {union} in the tiles of zoom {zmax} ({ev['pieces']} pieces), low zoom classes {ev['lowClasses']}")
    page.uncheck("#export-full")
    page.uncheck("#export-auto")
    page.fill("#export-zmin", "12")
    page.fill("#export-zmax", "14")
    page.wait_for_function("/\\d+ tiles\\./.test(document.getElementById('export-tiles').textContent)")
    count = int(page.inner_text("#export-tiles").split()[0].replace(",", ""))
    path = download(page, "pmtiles")
    data = path.read_bytes()
    assert data[:7] == b"PMTiles" and data[7] == 3
    page.route("**/__dl/t.pmtiles", lambda route: serve_range(route, data))
    got = page.evaluate("""async () => {
        const p = new pmtiles.PMTiles('/__dl/t.pmtiles'), h = await p.getHeader(), m = await p.getMetadata();
        const z = 14, n = 2 ** z, x = Math.floor((7.4246 + 180) / 360 * n), r = 43.7384 * Math.PI / 180, y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
        const t = await p.getZxy(z, x, y);
        return {tiles: h.numAddressedTiles, min: h.minZoom, max: h.maxZoom, type: h.tileType, layers: (m.vector_layers || []).map((l) => l.id), first: t ? new Uint8Array(t.data)[0] : null, len: t ? t.data.byteLength : 0};
    }""")
    assert got["min"] == 12 and got["max"] == 14 and got["type"] == 1 and 0 < got["tiles"] <= count, got
    assert got["first"] == 0x1a and got["len"] > 100, ("a tile of the middle of Monaco is an MVT with layers", got)
    assert "simple" in got["layers"] and len(got["layers"]) >= 2, got["layers"]       # roadstyle: `simple` has the roads, `ov*` the base-map layers
    print(f"PMTiles: {got['tiles']} tiles of {count} addresses, layers {got['layers'][:6]}")
    mb = download(page, "mbtiles")
    c = sqlite3.connect(mb)
    n_rows = c.execute("SELECT count(*) FROM tiles").fetchone()[0]
    meta = dict(c.execute("SELECT name, value FROM metadata").fetchall())
    assert n_rows == got["tiles"] and meta["format"] == "pbf" and meta["minzoom"] == "12" and json.loads(meta["json"])["vector_layers"], (n_rows, meta)
    blob = c.execute("SELECT tile_data FROM tiles LIMIT 1").fetchone()[0]
    assert blob[:2] == b"\x1f\x8b", "gzip tiles"
    assert c.execute("SELECT min(zoom_level), max(zoom_level) FROM tiles").fetchone() == (12, 14)
    print(f"MBTiles: {n_rows} tiles")
    # more than 4,000 tiles: leaf directories; the pmtiles library finds a tile of the middle and of the end
    leaf = page.evaluate("""async () => {
        const ex = await import('./app/export.js');
        const enc = new TextEncoder(), tiles = [];
        for (let x = 0; x < 100; x++) for (let y = 0; y < 60; y++) tiles.push({z: 12, x, y, data: new Uint8Array(await new Response(new Blob([enc.encode(`tile ${x} ${y}`)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())});
        const blob = await ex.pmtiles(tiles, {name: 't', bbox: [0, 0, 1, 1], minzoom: 12, maxzoom: 12, layers: ['a']});
        const p = new pmtiles.PMTiles(new pmtiles.FileSource(new File([blob], 't.pmtiles'))), h = await p.getHeader(), out = [h.numAddressedTiles, h.leafDirectoryLength > 0];
        for (const [x, y] of [[0, 0], [57, 31], [99, 59]]) out.push(new TextDecoder().decode((await p.getZxy(12, x, y)).data));
        out.push(await p.getZxy(12, 100, 0));
        return out;
    }""")
    assert leaf == [6000, True, "tile 0 0", "tile 57 31", "tile 99 59", None], leaf
    print("PMTiles: 6,000 tiles with leaf directories are read back")
    # a file that is wrong is reported: a MATSim file with no nodes and no links
    bad = page.evaluate("""async () => { const ex = await import('./app/export.js'); return ex.verify('matsim', {blob: new Blob(['<network><nodes/><links/></network>'])}, {query: (sql) => window.duckApi.query(sql).then((r) => r.toArray().map((x) => x.toJSON())), mode: 'driving'}); }""")
    assert bad["ok"] is False and "the file has 0" in bad["text"], bad
    assert "tiles" in page.inner_text("#export-status")
    page.screenshot(path=str(out / "export.png"))
    browser.close()

assert not errors, errors
print("ok")
