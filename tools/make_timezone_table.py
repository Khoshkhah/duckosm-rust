"""Make www/timezones.json: the IANA time zone of each Geofabrik region, for the time zone of an area in the browser
(main.visualization_metadata.timezone; docs/tables.md). The browser module has no world map of the zones (it is
2.7 MB with gzip); the page gives the build the entry of the smallest region that covers the area.

    python tools/make_timezone_table.py crates/duckosm-wasm/www/geofabrik.json crates/duckosm-wasm/www/timezones.json

The zones come from Python timezonefinder, the same data as duckOSM's time zone. For each region (not the continents): the land zones
at the points of a grid over the region, about 10 km inside its edge (200 x 200 at most, at least every 0.25 degree),
that have at least 1 % of the points or are mostly inside the region.
A region with one zone gets its name; a region with more zones gets, for each zone, its part of the region,
simplified to about 2 km (less for a small zone) and rounded to 3 decimals, the smaller zones first:
{"zones": [[name, MultiPolygon coordinates], ...]}. A point gets the first zone whose part has it, else the last.
A grid can miss a very small zone of a region; a point there gets the zone of the nearest part. Needs shapely.
"""
import json
import random
import sys

from shapely.geometry import Point, Polygon, shape
from shapely.ops import unary_union
from shapely.prepared import prep
from timezonefinder import TimezoneFinder

src, out = sys.argv[1], sys.argv[2]
tf = TimezoneFinder()
zones = {}


def zone(name):
    if name not in zones:
        zones[name] = unary_union([Polygon(p[0], p[1:]) for p in tf.get_geometry(tz_name=name, coords_as_pairs=True)])
    return zones[name]


def rounded(g):
    polys = [g] if isinstance(g, Polygon) else [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon)]
    return [[[[round(x, 3), round(y, 3)] for x, y in r.coords] for r in [p.exterior, *p.interiors]] for p in polys if not p.is_empty]


table = {}
checks = []          # (region, point) for the check at the end
random.seed(1)
for x in json.load(open(src))["extracts"]:
    if x["parent"] is None:          # a continent: an area that only a continent covers crosses countries
        table[x["id"]] = None
        continue
    region = shape({"type": "MultiPolygon", "coordinates": x["polygon"]})
    # A Geofabrik region reaches some km into its neighbors. Sample well inside it (about 10 km), so the zones of
    # the neighbors do not count: an area there has the neighbor's own region, which is smaller.
    core = next((c for c in (region.buffer(-d) for d in (0.1, 0.05, 0.02, 0.01)) if not c.is_empty), region)
    inside = prep(core)
    w, s, e, n = core.bounds
    step = min(0.25, max(e - w, n - s) / 200)
    pts = [(w + i * step, s + j * step) for i in range(int((e - w) / step) + 1) for j in range(int((n - s) / step) + 1)]
    pts = [p for p in pts if inside.contains(Point(p))] or [core.representative_point().coords[0]]
    found = [tf.timezone_at(lng=min(180, max(-180, px)), lat=min(90, max(-90, py))) for px, py in pts]
    found = [z for z in found if z and not z.startswith("Etc/")]
    # A zone counts when it has at least 1 % of the points (Kentucky's Chicago part), or when it is mostly inside
    # the region (Louisville in Kentucky, Creston in British Columbia: small, but real). A strip of a neighbor has
    # less than 1 %, and its zone is mostly outside.
    def mostly_inside(z):
        g = zone(z)
        return g.intersection(region).area >= 0.5 * g.area
    land = sorted(z for z in set(found) if found.count(z) >= 0.01 * len(found) or mostly_inside(z))
    if len(land) <= 1:
        table[x["id"]] = land[0] if land else None
        continue
    parts = []
    for name in land:
        part = zone(name).intersection(region)
        # about 2 km, but finer for a small zone (Monaco is 2 km wide): a twentieth of its size
        part = part.simplify(min(0.02, part.area ** 0.5 / 20), preserve_topology=True)
        if not part.is_empty:
            parts.append([name, rounded(part)])
    # smaller zones first: where two zones overlap in the data (Asia/Urumqi in Asia/Shanghai), the first part that has
    # the point wins, and timezonefinder also gives the smaller one
    parts.sort(key=lambda z: sum(Polygon(p[0], p[1:]).area for p in z[1]))
    table[x["id"]] = {"zones": parts}
    checks.extend((x["id"], p) for p in random.sample(pts, min(50, len(pts))))
    print(f"{x['id']}: {len(parts)} zones", file=sys.stderr)

json.dump({"source": "timezonefinder (timezone-boundary-builder), Geofabrik regions of geofabrik.json", "regions": table},
          open(out, "w"), separators=(",", ":"))
single = sum(isinstance(v, str) for v in table.values())
print(f"{len(table)} regions: {single} with one zone, {len(table) - single} with more")


def lookup(entry, px, py):
    """The page's lookup (crates/duckosm-build/src/area.rs): the first zone whose part has the point, else the last
    (the largest)."""
    if not isinstance(entry, dict):
        return entry
    for name, polys in entry["zones"]:
        for p in polys:
            if Polygon(p[0], p[1:]).contains(Point(px, py)):
                return name
    return entry["zones"][-1][0]


# the check: in the regions with more zones, the table gives timezonefinder's zone at random land points inside them
# (the sea, timezonefinder's Etc/..., has no roads)
land_checks = [(r, p, tf.timezone_at(lng=p[0], lat=p[1])) for r, p in checks]
land_checks = [c for c in land_checks if c[2] and not c[2].startswith("Etc/")]
bad = [c for c in land_checks if lookup(table[c[0]], *c[1]) != c[2]]
print(f"check: {len(land_checks) - len(bad)} of {len(land_checks)} random land points give timezonefinder's zone")
for r, p, want in bad[:10]:
    print(f"  {r} {p[0]:.3f},{p[1]:.3f}: table {lookup(table[r], *p)}, timezonefinder {want}")

