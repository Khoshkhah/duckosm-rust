"""The look of the exports in QGIS and kepler.gl (docs/proposals/export-look.md), compared with the page's map.

    python crates/duckosm-wasm/www/qgis_e2e.py [out folder]

Headless Chromium builds Monaco (tests/data/monaco_sample.osm.pbf) on the page, draws the driving network, and saves the page's roads (the base map
hidden) at four views. QGIS, with no screen, draws the GeoPackage with the style that the file has (layer_styles), and kepler.gl 3.2.6 (in Chromium)
draws the kepler.gl map file, at the same views. For each picture: the pixels of the roads (not the background) must cover the page's roads
(`overlap`, intersection over union), and the color of the roads must be near the page's.

QGIS: a conda environment with `qgis` from conda-forge, QGIS_ENV (default ~/miniconda3/envs/qgis-headless). kepler.gl, React 18 and their modules load
from unpkg.com and esm.sh. The check runs on the build machine before a merge; CI has no QGIS.
"""
import json
import os
import pathlib
import subprocess
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

from serve import WWW, start

ROOT = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "out-qgis").resolve()
out.mkdir(parents=True, exist_ok=True)
QGIS_ENV = pathlib.Path(os.environ.get("QGIS_ENV", pathlib.Path.home() / "miniconda3/envs/qgis-headless"))
BG = (239, 237, 232)                    # the page's background (look: background.light), also in QGIS and kepler.gl
W, H = 900, 700
VIEWS = [("z13", [7.4210, 43.7365], 13), ("z15", [7.4230, 43.7360], 15), ("z17", [7.4228, 43.7352], 17), ("z18", [7.4282, 43.7393], 18)]
# the least overlap of the roads with the page's, for each view (QGIS, kepler.gl): kepler.gl draws widths in meters of zoom 17 (narrower at
# zoom 13 and 15, wider at 18) and has no first zoom of a class
LIMITS = {"qgis": {"z13": 0.75, "z15": 0.7, "z17": 0.55, "z18": 0.55}, "kepler": {"z13": 0.25, "z15": 0.35, "z17": 0.5, "z18": 0.5}}

# QGIS: the GeoPackage's layer `roads` with its own style, at the page's zoom (512 px tiles, 96 dpi) in Web Mercator. The expression context
# has the map scope (@map_scale, @map_crs), as the QGIS map canvas has.
QGIS_DRAW = r"""
import json, math, sys
from qgis.core import *
from qgis.PyQt.QtCore import QSize
from qgis.PyQt.QtGui import QColor
gpkg, prefix, views, bg = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), sys.argv[4]
app = QgsApplication([], False); app.initQgis()
layer = QgsVectorLayer(f"{gpkg}|layername=roads", "roads", "ogr")
msg, ok = layer.loadDefaultStyle()
assert layer.isValid() and ok and layer.renderer().type() == "RuleRenderer", (msg, layer.renderer().type())
QgsProject.instance().addMapLayer(layer)
merc = QgsCoordinateReferenceSystem("EPSG:3857")
for vid, (lon, lat), z, w, h in views:
    res = 40075016.686 / (512 * 2 ** z)
    x, y = math.radians(lon) * 6378137, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * 6378137
    ms = QgsMapSettings(); ms.setLayers([layer]); ms.setDestinationCrs(merc); ms.setOutputSize(QSize(w, h)); ms.setOutputDpi(96)
    ms.setBackgroundColor(QColor(bg)); ms.setExtent(QgsRectangle(x - w / 2 * res, y - h / 2 * res, x + w / 2 * res, y + h / 2 * res))
    ms.setTransformContext(QgsProject.instance().transformContext())
    ec = QgsExpressionContext(QgsExpressionContextUtils.globalProjectLayerScopes(layer)); ec.appendScope(QgsExpressionContextUtils.mapSettingsScope(ms)); ms.setExpressionContext(ec)
    job = QgsMapRendererSequentialJob(ms); job.start(); job.waitForFinished()
    assert not job.errors(), [e.message for e in job.errors()]
    job.renderedImage().save(f"{prefix}_{vid}.png")
print(Qgis.version(), flush=True)
import os; os._exit(0)            # QGIS can crash at its own exit
"""

# kepler.gl 3.2.6 in a page: its UMD bundle needs React 18, Redux and styled-components as globals (kepler.gl's examples/umd-client)
KEPLER_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<script>window.esmsInitOptions = {shimMode: true};</script>
<script src="https://unpkg.com/es-module-shims@2.8.1/dist/es-module-shims.js" crossorigin="anonymous"></script>
<script type="importmap-shim">{"imports": {"react": "https://esm.sh/react@18.3.1", "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
  "react-dom": "https://esm.sh/react-dom@18.3.1?external=react", "react-dom/client": "https://esm.sh/react-dom@18.3.1/client?external=react",
  "redux": "https://esm.sh/redux@4.2.1", "react-redux": "https://esm.sh/react-redux@8.1.3?external=react,react-dom,redux",
  "styled-components": "https://esm.sh/styled-components@6.1.8?external=react,react-dom"}}</script>
<script type="module-shim">
import * as React from 'react'; import * as ReactDOM from 'react-dom'; import * as ReactDOMClient from 'react-dom/client';
import * as Redux from 'redux'; import * as ReactRedux from 'react-redux'; import * as SC from 'styled-components';
window.React = React.default || React; window.ReactDOM = Object.assign({}, ReactDOM.default || ReactDOM, ReactDOMClient);
window.Redux = Redux.default || Redux; window.ReactRedux = ReactRedux.default || ReactRedux; window.styled = Object.assign(SC.default, SC);
const s = document.createElement('script'); s.src = 'https://unpkg.com/kepler.gl@3.2.6/umd/keplergl.min.js'; s.crossOrigin = 'anonymous';
s.onload = () => {
  const K = window.KeplerGl, r = Redux.combineReducers({keplerGl: K.keplerGlReducer.initialState({uiState: {readOnly: true, activeSidePanel: null, currentModal: null}})});
  const store = Redux.createStore(r, {}, Redux.applyMiddleware(...K.enhanceReduxMiddleware([])));
  ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(ReactRedux.Provider, {store},
    React.createElement(K.KeplerGl, {id: 'map', width: innerWidth, height: innerHeight, mapboxApiAccessToken: ''})));
  window.keplerStore = store;
};
document.head.appendChild(s);
</script><style>body{margin:0;overflow:hidden}</style></head><body><div id="app"></div></body></html>"""


def clip(page, path):
    """the view's middle W x H of a 1600 x 1000 page (the map's center is the middle of the window)"""
    page.screenshot(path=str(path), clip={"x": 800 - W / 2, "y": 500 - H / 2, "width": W, "height": H})


def compare(page_png, other_png):
    """the overlap of the road pixels (intersection over union) and the mean color difference where both have a road"""
    a, b = (Image.open(f).convert("RGB").tobytes() for f in (page_png, other_png))
    road = lambda p: sum(abs(p[i] - BG[i]) for i in range(3)) > 24
    both = one = 0
    diff = 0.0
    for k in range(0, len(a), 3):
        pa, pb = a[k:k + 3], b[k:k + 3]
        ra, rb = road(pa), road(pb)
        one += ra or rb
        if ra and rb:
            both += 1
            diff += sum(abs(pa[i] - pb[i]) for i in range(3)) / 3
    return both / max(one, 1), diff / max(both, 1)


errors = []
with sync_playwright() as p:
    server = start(0, quiet=True, directory=WWW)
    browser = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"http://127.0.0.1:{server.server_address[1]}/index.html")
    page.wait_for_function("window.mapReady && window.timings && window.timings.duckdbStart", timeout=120_000)
    page.set_input_files("#file", str(ROOT / "tests/data/monaco.geojson"))
    page.wait_for_function("window.areas >= 1", timeout=60_000)
    page.click("#tab-region")
    page.set_input_files("#region", str(ROOT / "tests/data/monaco_sample.osm.pbf"))
    page.click("#run")
    page.wait_for_function("!document.getElementById('run').hasAttribute('aria-busy') && !document.getElementById('step7-card').classList.contains('off')", timeout=600_000)
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    # the map of the driving network, as the files of the driving network
    page.evaluate("async () => { const m = document.getElementById('mapmode'); m.value = 'driving'; await m.onchange(); await window.mapDrawing; }")
    page.wait_for_function("/drawn|failed/.test(document.getElementById('mapnote').textContent) && !window.mapDrawing", timeout=600_000)
    if "folded" in (page.get_attribute("#step10-card", "class") or ""):
        page.click("#step10")
    files = {}
    for fmt in ("gpkg", "kepler"):
        with page.expect_download(timeout=120_000) as d:
            page.click(f"#export-list [data-fmt={fmt}]")
        files[fmt] = out / d.value.suggested_filename
        d.value.save_as(files[fmt])
    page.add_style_tag(content="body > *:not(#map):not(script):not(style) { visibility: hidden !important; } .maplibregl-control-container { display: none !important; }")
    page.evaluate("for (const l of window.duckMap.getStyle().layers) if (l.id !== 'bg' && !l.id.startsWith('rs-roads-simple')) window.duckMap.setLayoutProperty(l.id, 'visibility', 'none', {validate: false})")
    page.evaluate(f"window.duckMap.setPaintProperty('bg', 'background-color', 'rgb{BG}'); window.duckMap.setPadding({{top: 0, left: 0, right: 0, bottom: 0}})")
    for vid, center, z in VIEWS:
        page.evaluate(f"window.duckMap.jumpTo({{center: {center}, zoom: {z}, bearing: 0, pitch: 0}})")
        page.wait_for_function("window.duckMap.loaded() && window.duckMap.areTilesLoaded()", timeout=60_000)
        page.wait_for_timeout(1500)
        clip(page, out / f"page_{vid}.png")

    # QGIS
    env = dict(os.environ, QT_QPA_PLATFORM="offscreen", PYTHONPATH=str(QGIS_ENV / "share/qgis/python"), PROJ_DATA=str(QGIS_ENV / "share/proj"), GDAL_DATA=str(QGIS_ENV / "share/gdal"))
    views = json.dumps([[vid, center, z, W, H] for vid, center, z in VIEWS])
    r = subprocess.run([str(QGIS_ENV / "bin/python"), "-c", QGIS_DRAW, str(files["gpkg"]), str(out / "qgis"), views, "#%02x%02x%02x" % BG], env=env, capture_output=True, text=True, timeout=600)
    assert r.returncode == 0, r.stderr[-2000:]
    qgis_version = r.stdout.strip().splitlines()[-1]

    # kepler.gl: the map file over no base map
    kp = browser.new_page(viewport={"width": 1600, "height": 1000})
    kp.on("pageerror", lambda e: errors.append(f"kepler.gl: {e}"))
    kp.route("http://kepler.test/", lambda route: route.fulfill(status=200, content_type="text/html", body=KEPLER_PAGE))
    kp.goto("http://kepler.test/")
    kp.wait_for_function("window.keplerStore", timeout=120_000)
    mp = json.loads(files["kepler"].read_text())
    mp["config"]["config"]["mapStyle"] = {"styleType": "no_map", "backgroundColor": list(BG)}
    kp.evaluate("(m) => { const K = window.KeplerGl; window.keplerStore.dispatch(K.addDataToMap({...K.KeplerGlSchema.load(m.datasets, m.config), options: {centerMap: false, readOnly: true}})); }", mp)
    kp.wait_for_timeout(4000)
    for vid, center, z in VIEWS:
        kp.evaluate(f"window.keplerStore.dispatch(window.KeplerGl.updateMap({{longitude: {center[0]}, latitude: {center[1]}, zoom: {z}, bearing: 0, pitch: 0}}))")
        kp.wait_for_timeout(3000)
        clip(kp, out / f"kepler_{vid}.png")
    browser.close()

assert not errors, errors
bad = []
for tool in ("qgis", "kepler"):
    for vid, _, z in VIEWS:
        overlap, color = compare(out / f"page_{vid}.png", out / f"{tool}_{vid}.png")
        ok = overlap >= LIMITS[tool][vid] and color <= 40
        print(f"{tool} {vid}: overlap {overlap:.2f} (limit {LIMITS[tool][vid]}), color difference {color:.1f} (limit 40){'' if ok else '  <- FAILED'}")
        bad += [] if ok else [f"{tool} {vid}"]
print(f"QGIS {qgis_version}; pictures in {out}")
assert not bad, f"not the page's look: {bad}"
print("ok")
