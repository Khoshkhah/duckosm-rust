"""Make www/geofabrik.json, the list of Geofabrik's extracts for the boundary tool (docs/browser.md, step B4).

    python tools/make_geofabrik_index.py index-v1.json crates/duckosm-wasm/www/geofabrik.json

index-v1.json is https://download.geofabrik.de/index-v1.json. Geofabrik sends no CORS header, so the page cannot
read it: this copy goes with the page. For each extract: id, name, parent, the URL of the PBF, the bounding box,
and the polygon, made about 1 km larger and then simplified and rounded to 3 decimals (enough to choose the file).
The larger polygon contains the original, so an area at the border of an extract is not lost; an area up to about 1
km outside an extract can be shown as covered. Needs shapely.
"""
import json
import sys

from shapely.geometry import mapping, shape

src, out = sys.argv[1], sys.argv[2]
rows = []
for f in json.load(open(src))["features"]:
    p = f["properties"]
    if not f.get("geometry") or "pbf" not in p.get("urls", {}):
        continue
    g = shape(f["geometry"])
    s = g.buffer(0.01).simplify(0.005, preserve_topology=True)
    coords = mapping(s)["coordinates"]
    if s.geom_type == "Polygon":
        coords = [coords]
    rows.append({
        "id": p["id"], "name": p["name"], "parent": p.get("parent"), "pbf": p["urls"]["pbf"],
        "bbox": [round(v, 3) for v in g.bounds],
        "polygon": [[[[round(x, 3), round(y, 3)] for x, y in ring] for ring in poly] for poly in coords],
    })
doc = {"source": "https://download.geofabrik.de/index-v1.json (Geofabrik GmbH, data: OpenStreetMap contributors)",
       "extracts": rows}
json.dump(doc, open(out, "w"), separators=(",", ":"))
print(f"{len(rows)} extracts")
