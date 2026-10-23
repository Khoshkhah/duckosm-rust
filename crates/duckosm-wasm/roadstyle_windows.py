"""roadstyle's Street View and Google 3D windows for the page's map, taken from roadstyle's page template at build time
(build.sh: ROADSTYLE_COMMIT), so the page has no copy of them in git (docs/app.md).

    python3 crates/duckosm-wasm/roadstyle_windows.py <roadstyle>/src/roadstyle/static/web_template.html <out>/windows.js

It takes these parts of the template, word for word: the windows' CSS; _gmLoad, _rsFloat, the Street View window and the
Google 3D window; the Street View spot, its marker and the step buttons. Then it applies the page's changes. Each change is
an exact text that must occur once: when roadstyle changes one of them, this script stops and says which.

The page's changes:
- the template's placeholders: the Street View window is on, the key is the user's (or none), the selection colour;
- the Street View frame is credentialless, so it loads in the cross-origin isolated page (serve.py's headers);
- a key given later turns on the Linked mode and adds Google 3D (no reload: the build would be lost);
- the roads' layer is rs-roads-fill (the page adds roadstyle's layers with the prefix rs-);
- the page has no roads' full lines in memory (they come from DuckDB on a click): no snapping to another drawn road in
  the Linked mode (the marker follows the viewer freely off the clicked road, as roadstyle does when no road is near),
  and the Google 3D window draws the clicked road from the click's line.
"""
import sys

src = open(sys.argv[1], encoding="utf-8").read()
lines = src.split("\n")


def block(start, end):
    """The lines from the one that starts with `start` to the next one that starts with `end`."""
    try:
        i = next(k for k, s in enumerate(lines) if s.startswith(start))
        j = next(k for k in range(i, len(lines)) if lines[k].startswith(end))
    except StopIteration:
        sys.exit(f"roadstyle_windows.py: the template has no block from {start!r} to {end!r}")
    return "\n".join(lines[i:j + 1])


def change(text, old, new):
    if text.count(old) != 1:
        sys.exit(f"roadstyle_windows.py: the template changed, {text.count(old)} times: {old[:70]!r}")
    return text.replace(old, new)


css = block("/* Street View window", ".rs-svm{pointer-events:none}")
windows = block("// GOOGLE'S MAPS JAVASCRIPT API", "window.rsSetGoogle3D = rsSetGoogle3D;")
spot = block("const _SV_LANE_M = 2.5", "window.rsSetStreetViewMarker = rsSetStreetViewMarker;")

windows = change(windows, "const _svWindow = __SV_WINDOW__;", "const _svWindow = true;")
windows = change(windows, "const _svKey = __SV_WINDOW_KEY__;", "let _svKey = opts.key || null, _svLinked = () => {};")
# the Linked / Classic switch, also for a key given later
windows = change(windows, '  if(_svKey){ mode="linked"; try{ mode=localStorage.getItem(MODE_KEY)||"linked"; }catch(e){}',
                 '  const linked=()=>{ if(!_svKey || !flip.hidden) return; mode="linked"; try{ mode=localStorage.getItem(MODE_KEY)||"linked"; }catch(e){}')
windows = change(windows, "      if(!rsStreetViewStep(0)) show();\n    }); }",
                 "      if(!rsStreetViewStep(0)) show();\n    }); };\n  linked(); _svLinked=linked;")
# Google 3D: once there is a key, at the start or later
windows = change(windows, "const _g3d = __GOOGLE_3D__;\nfunction rsSetGoogle3D(){}\nif(_g3d){",
                 "let _g3dOn = false;\nfunction google3d(key){\nif(_g3dOn || !key) return;\n_g3dOn = true;\nfunction rsSetGoogle3D(){}\n{")
windows = change(windows, '    _gmLoad(_svKey).then(()=>google.maps.importLibrary("maps3d"))', '    _gmLoad(key).then(()=>google.maps.importLibrary("maps3d"))')
windows = change(windows, "strokeColor:__SELECT_COLOR__", 'strokeColor:"#7c4dff"')
# the frame loads in a cross-origin isolated page (serve.py's COEP, for the WebAssembly threads) only without credentials
windows = change(windows, """'<iframe title="Google Street View" allowfullscreen hidden></iframe>""",
                 """'<iframe title="Google Street View" allowfullscreen credentialless hidden></iframe>""")
windows = change(windows, "const F=_feats(), cs=_svLine((F && F[d.id]) || _svTiled(d.id)); if(cs.length<2) return;",
                 "const cs=d.coords || []; if(cs.length<2) return;")
windows = change(windows, "window.rsSetGoogle3D = rsSetGoogle3D;", "window.rsSetGoogle3D = rsSetGoogle3D;\n}\ngoogle3d(_svKey);")
spot = change(spot, 'const e=map.getPaintProperty("roads-fill", "line-offset");',
              'const e=map.getLayer("rs-roads-fill") ? map.getPaintProperty("rs-roads-fill", "line-offset") : 0;')

out = f"""// roadstyle's Street View and Google 3D windows, MADE BY crates/duckosm-wasm/roadstyle_windows.py from roadstyle's
// src/roadstyle/static/web_template.html at build.sh's ROADSTYLE_COMMIT. Do not edit: change the script or roadstyle.
const CSS = {css!r};

export function roadstyleWindows(map, opts = {{}}) {{
const style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
// the parts of roadstyle's page that the page does not have: no roads' full lines in memory, no lean pieces
const _streetView = true, RS_TILED = false, RS_LEAN = null, RS_FILL_LAYERS = [];
const _feats = () => null, srcOf = () => null, _roadOfPiece = (f) => f;
{spot}
{windows}
// a road click of the page: the road's whole line (from DuckDB) and its properties; Street View stands at the point nearest
// the click (roadstyle's _svPick), and the windows follow the rs:select event
function select(line, lngLat, properties, id) {{
  const f = {{type: "Feature", id, geometry: {{type: "LineString", coordinates: line}}, properties}};
  const url = line.length > 1 ? _svPick(lngLat, f, id) : _svUrlOf(lngLat);
  document.dispatchEvent(new CustomEvent("rs:select", {{detail: {{properties, streetView: url, id, coords: line}}}}));
}}
// a key given later: the Linked mode of Street View, and Google 3D
function setKey(key) {{ _svKey = key; _svLinked(); google3d(key); }}
return {{ select, setKey }};
}}
"""
open(sys.argv[2], "w", encoding="utf-8").write(out)
