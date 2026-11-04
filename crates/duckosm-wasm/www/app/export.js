// Export of a built network for other software (docs/dashboard.md, "Step 9: Export"): GeoJSON, MATSim and SUMO. Each function reads the tables of one
// network in DuckDB (`query(sql)` gives the rows as objects) and gives `{ name, blob }` for a download. Nothing here changes a table.
//
// Ids: `edge_id` and `node_id` are BIGINT hashes, so they go to the files as text (a JavaScript number loses the low digits).
// Coordinates: GeoJSON has longitude and latitude (EPSG:4326). MATSim and SUMO need meters, so their files use the UTM zone of the middle of the network.

const KMH_BY_CLASS = { motorway: 100, trunk: 80, primary: 60, secondary: 50, tertiary: 40, unclassified: 40, residential: 30, living_street: 10, service: 20, pedestrian: 5, footway: 5, path: 5, steps: 3, cycleway: 18 };
const CAPACITY_BY_CLASS = { motorway: 2000, trunk: 1800, primary: 1500, secondary: 1200, tertiary: 1000 };     // vehicles per hour and lane; other classes: 800
const PRIORITY_BY_CLASS = { motorway: 13, trunk: 12, primary: 11, secondary: 10, tertiary: 9, unclassified: 8, residential: 7, living_street: 6, service: 5 };
const MATSIM_MODES = { driving: "car", walking: "walk", cycling: "bike" };
const SLUG = (s) => String(s || "area").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "area";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cls = (h) => String(h ?? "").replace(/_link$/, "");
const speedKmh = (r) => (r.maxspeed_kmh > 0 ? r.maxspeed_kmh : KMH_BY_CLASS[cls(r.highway)] ?? 30);
const lanesOf = (r) => (r.lanes > 0 ? r.lanes : 1);
const fix = (x, n = 2) => Number(x).toFixed(n);

/** The UTM zone (EPSG code) of the middle of the nodes of a network. */
async function utmOf(query, mode) {
  const [m] = await query(`SELECT avg(ST_X(geom)) AS x, avg(ST_Y(geom)) AS y FROM ${mode}.nodes`);
  const zone = Math.min(60, Math.max(1, Math.floor((m.x + 180) / 6) + 1));
  return `EPSG:${(m.y >= 0 ? 32600 : 32700) + zone}`;
}

const text = (s) => new Blob([s], { type: "application/xml" });
const zipOf = async (files) => {         // files: name to text or bytes
  const { zipSync, strToU8 } = await import("https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js");
  return new Blob([zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])))], { type: "application/zip" });
};

/**
 * The roads for the files of Visualization, one row for each road, not for each direction. A two-way road is two edges in the tables (a forward edge `...f` and a reverse edge `...r`
 * with `is_reverse`, the two nodes swapped): its row is the forward edge, with `edge_id_reverse` and `twoway`. A reverse edge that has no partner stays a row of its own.
 * Gives the rows with `g` (GeoJSON text of the geometry), and the SQL fragment of the count.
 */
const PAIR = (m) => `(SELECT 1 FROM ${m}.edges f WHERE NOT f.is_reverse AND f.osm_id = e.osm_id AND f.source = e.target AND f.target = e.source AND left(f.edge_ref, length(f.edge_ref) - 1) = left(e.edge_ref, length(e.edge_ref) - 1))`;
export const roadCountSql = (m) => `SELECT count(*) AS n FROM ${m}.edges e WHERE NOT e.is_reverse OR NOT EXISTS ${PAIR(m)}`;
async function roadRows(query, m, geometry, extra = "") {
  return query(`SELECT e.edge_id::VARCHAR AS edge_id, p.edge_id::VARCHAR AS edge_id_reverse, (p.edge_id IS NOT NULL) AS twoway, e.osm_id::VARCHAR AS osm_id, e.source::VARCHAR AS source, e.target::VARCHAR AS target,
      e.name, e.highway, e.oneway, e.lanes, e.maxspeed_kmh, e.length_m, ${geometry} AS g${extra}
    FROM ${m}.edges e LEFT JOIN ${m}.edges p ON NOT e.is_reverse AND p.is_reverse AND p.osm_id = e.osm_id AND p.source = e.target AND p.target = e.source AND left(p.edge_ref, length(p.edge_ref) - 1) = left(e.edge_ref, length(e.edge_ref) - 1)
    WHERE NOT e.is_reverse OR NOT EXISTS ${PAIR(m)} ORDER BY e.edge_id`);
}

/** The roads as one GeoJSON file (a plain .geojson that kepler.gl, QGIS and web maps open; a LineString for each road, a two-way road once; the ids as text). */
export async function geojson(query, mode, area) {
  const roads = await roadRows(query, mode, "ST_AsGeoJSON(e.geometry)");
  return { name: `${SLUG(area)}_${mode}_roads.geojson`, blob: featureCollection(roads), rows: roads.length };
}

/** The nodes (the junctions and the ends of the roads) as one GeoJSON file of points. */
export async function geojsonNodes(query, mode, area) {
  const nodes = await query(`SELECT node_id::VARCHAR AS node_id, ST_AsGeoJSON(geom) AS g FROM ${mode}.nodes ORDER BY node_id`);
  return { name: `${SLUG(area)}_${mode}_nodes.geojson`, blob: featureCollection(nodes), rows: nodes.length };
}

// one FeatureCollection, one feature on each line (a file of 100 MB is read by a streaming reader too); a missing number is `null`, never NaN
function featureCollection(rows) {
  const lines = rows.map((r) => {
    const { g, ...p } = r;
    return JSON.stringify({ type: "Feature", properties: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "bigint" ? String(v) : typeof v === "number" && !Number.isFinite(v) ? null : v])), geometry: JSON.parse(g) });
  });
  return new Blob(['{"type":"FeatureCollection","features":[\n', lines.join(",\n"), "\n]}\n"], { type: "application/geo+json" });
}

// ---- the web map: the tiles, the style of this page's map and a viewer in one .zip. The tiles have no style (a viewer like QGIS shows only lines); the style of the live map
// (roadstyle's layers, with its global state) draws them as this page does.

/** The style of the web map from the live style of the page: the layers of the roads and the base-map layers (sources `rs-*`) on the PMTiles file, with the global state of the map. */
export function packageStyle(live, globalState) {
  const sources = {};
  for (const [id, src] of Object.entries(live.sources)) {
    if (!id.startsWith("rs-") || src.type !== "vector") continue;
    const { tiles, encoding, ...rest } = src;            // the tiles of the file are MVT
    sources[id] = { ...rest, url: "pmtiles://tiles.pmtiles" };
  }
  return {
    version: 8, name: "duckOSM", glyphs: live.glyphs, sources,
    state: Object.fromEntries(Object.entries(globalState ?? {}).map(([k, v]) => [k, { default: v }])),   // the layers read `global-state` (theme, switches); without it MapLibre stops on them
    layers: live.layers.filter((l) => l.id === "bg" || (l.source && l.source in sources)),
  };
}

const VIEWER = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>duckOSM map</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css">
<script src="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
<script src="https://cdn.jsdelivr.net/npm/pmtiles@3.2.1/dist/pmtiles.js"></script>
<style>html, body, #map { margin: 0; height: 100%; }</style>
<div id="map"></div>
<script>
// The tiles (tiles.pmtiles) and the style (style.json) are read from this folder. PMTiles needs range requests: start the folder with "python serve.py".
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);
Promise.all([fetch("style.json").then((r) => r.json()), new pmtiles.PMTiles("tiles.pmtiles").getHeader()]).then(([style, h]) => {
  window.map = new maplibregl.Map({ container: "map", style, bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat], fitBoundsOptions: { padding: 20 }, hash: true });
  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.addControl(new maplibregl.ScaleControl(), "bottom-left");
});
</script>
</html>
`;

const SERVER = `"""A small web server with range requests (PMTiles needs them; "python -m http.server" has none). Run:  python serve.py [port]  and open http://localhost:8000/"""
import http.server, os, re, sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        r, p = self.headers.get("Range"), self.translate_path(self.path)
        m = re.match(r"bytes=(\\d+)-(\\d*)", r or "")
        if m and os.path.isfile(p):
            size = os.path.getsize(p)
            a = int(m[1])
            b = min(int(m[2]) if m[2] else size - 1, size - 1)
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {a}-{b}/{size}")
            self.send_header("Content-Length", str(b - a + 1))
            self.send_header("Content-Type", self.guess_type(p))
            self.end_headers()
            with open(p, "rb") as f:
                f.seek(a)
                self.wfile.write(f.read(b - a + 1))
        else:
            super().do_GET()

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8000), Handler).serve_forever()
`;

/** The web map package: tiles.pmtiles, style.json, index.html, serve.py and a README, in one .zip. `ctx.style`: {live, globalState} of the map on screen. */
async function webMap(query, mode, area, ctx) {
  const t = await tileFile("pmtiles", ctx, area);
  const style = packageStyle(ctx.style.live, ctx.style.globalState);
  const readme = `Web map of ${area}, from duckOSM-rust.\n\n1. Unpack this folder.\n2. In the folder run:  python serve.py\n3. Open http://localhost:8000/ in a browser.\n\nThe map is drawn from tiles.pmtiles with style.json (the style of the duckOSM-rust page) by MapLibre GL JS and the pmtiles library, which the page loads from a CDN (internet needed).\n` +
    `The tiles have zoom ${ctx.min} to ${ctx.max}. The layers: ${t.layers.join(", ")}.\nQGIS and other tools that read the tiles directly show the layers with no style: use this web map for the look of the page.\nLimits: the icons of crossings and traffic signals and the arrows are added by the page in the browser and are not in the package.\n`;
  const zip = await zipOf({ "tiles.pmtiles": new Uint8Array(await t.blob.arrayBuffer()), "style.json": JSON.stringify(style), "index.html": VIEWER, "serve.py": SERVER, "README.txt": readme });
  return { name: `${SLUG(area)}_webmap.zip`, blob: zip, rows: t.rows, tiles: t.tiles, layers: t.layers, min: ctx.min, max: ctx.max, style, pmtiles: t.blob, edgeTiles: ctx.extra ?? null };
}

/** A MATSim network (network_v2.dtd): the nodes, and one link for each edge. */
export async function matsim(query, mode, area) {
  const utm = await utmOf(query, mode);
  const tr = (col) => `ST_Transform(${col}, 'EPSG:4326', '${utm}', true)`;
  const nodes = await query(`SELECT node_id::VARCHAR AS id, ST_X(${tr("geom")}) AS x, ST_Y(${tr("geom")}) AS y FROM ${mode}.nodes ORDER BY node_id`);
  const edges = await query(`SELECT edge_id::VARCHAR AS id, source::VARCHAR AS source, target::VARCHAR AS target, osm_id::VARCHAR AS osm_id, highway, oneway, lanes, maxspeed_kmh, length_m FROM ${mode}.edges ORDER BY edge_id`);
  const m = MATSIM_MODES[mode] ?? "car";
  const out = [`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE network SYSTEM "http://www.matsim.org/files/dtd/network_v2.dtd">\n<network name="${esc(area)}">\n<attributes>\n  <attribute name="coordinateReferenceSystem" class="java.lang.String">${utm}</attribute>\n</attributes>\n<nodes>\n`];
  for (const n of nodes) out.push(`  <node id="${n.id}" x="${fix(n.x)}" y="${fix(n.y)}"/>\n`);
  out.push(`</nodes>\n<links capperiod="01:00:00" effectivecellsize="7.5" effectivelanewidth="3.75">\n`);
  for (const e of edges) {
    const lanes = lanesOf(e), cap = (CAPACITY_BY_CLASS[cls(e.highway)] ?? 800) * lanes;
    out.push(`  <link id="${e.id}" from="${e.source}" to="${e.target}" length="${fix(e.length_m)}" freespeed="${fix(speedKmh(e) / 3.6)}" capacity="${cap}" permlanes="${lanes}" oneway="1" modes="${m}">` +
      `<attributes><attribute name="origid" class="java.lang.String">${e.osm_id}</attribute><attribute name="type" class="java.lang.String">${esc(e.highway)}</attribute></attributes></link>\n`);
  }
  out.push("</links>\n</network>\n");
  return { name: `${SLUG(area)}_${mode}_matsim_network.xml`, blob: text(out.join("")), rows: edges.length, nodes: nodes.length };
}

/** SUMO plain XML: node, edge and connection files for `netconvert`, with a README that has the command. */
export async function sumo(query, mode, area) {
  const utm = await utmOf(query, mode);
  const tr = (col) => `ST_Transform(${col}, 'EPSG:4326', '${utm}', true)`;
  const nodes = await query(`SELECT node_id::VARCHAR AS id, ST_X(${tr("geom")}) AS x, ST_Y(${tr("geom")}) AS y FROM ${mode}.nodes ORDER BY node_id`);
  const edges = await query(`SELECT edge_id::VARCHAR AS id, source::VARCHAR AS source, target::VARCHAR AS target, name, highway, lanes, maxspeed_kmh,
    ST_AsText(${tr("geometry")}) AS wkt FROM ${mode}.edges ORDER BY edge_id`);
  const links = await query(`SELECT g.from_edge::VARCHAR AS a, g.to_edge::VARCHAR AS b FROM ${mode}.edge_graph g
    WHERE g.from_edge IN (SELECT edge_id FROM ${mode}.edges) AND g.to_edge IN (SELECT edge_id FROM ${mode}.edges) ORDER BY g.from_edge, g.to_edge`);
  const slug = `${SLUG(area)}_${mode}`;
  const shape = (wkt) => wkt.replace(/^LINESTRING\s*\(|\)$/g, "").split(",").map((p) => p.trim().split(/\s+/).map((v) => fix(v)).join(",")).join(" ");
  const nod = [`<?xml version="1.0" encoding="UTF-8"?>\n<nodes>\n`, ...nodes.map((n) => `  <node id="${n.id}" x="${fix(n.x)}" y="${fix(n.y)}" type="priority"/>\n`), "</nodes>\n"].join("");
  const edg = [`<?xml version="1.0" encoding="UTF-8"?>\n<edges>\n`, ...edges.map((e) =>
    `  <edge id="${e.id}" from="${e.source}" to="${e.target}" numLanes="${lanesOf(e)}" speed="${fix(speedKmh(e) / 3.6)}" priority="${PRIORITY_BY_CLASS[cls(e.highway)] ?? 4}"` +
    `${e.name ? ` name="${esc(e.name)}"` : ""} type="highway.${esc(e.highway)}" shape="${shape(e.wkt)}"/>\n`), "</edges>\n"].join("");
  const con = [`<?xml version="1.0" encoding="UTF-8"?>\n<connections>\n`, ...links.map((l) => `  <connection from="${l.a}" to="${l.b}"/>\n`), "</connections>\n"].join("");
  const readme = `SUMO plain XML of the ${mode} network of ${area}, from duckOSM-rust.\nCoordinates: meters in ${utm}. Run:\n\n  netconvert --node-files ${slug}.nod.xml --edge-files ${slug}.edg.xml --connection-files ${slug}.con.xml -o ${slug}.net.xml\n\n` +
    `The connections are the legal turns of the edge graph (turn restrictions applied). The edge ids are the edge_id values of the tables.\n`;
  return { name: `${slug}_sumo.zip`, blob: await zipOf({ [`${slug}.nod.xml`]: nod, [`${slug}.edg.xml`]: edg, [`${slug}.con.xml`]: con, "README.txt": readme }), rows: edges.length, nodes: nodes.length, connections: links.length };
}

import { decodeTile, encodeTile, addProps, indexOf } from "./mvt.js";

// ---- tiles: the vector tiles of the map that is on screen (the roads and the base-map layers), made again by the map worker as MVT for a range of zooms,
// and packed in one PMTiles v3 file or one MBTiles file. A tile is the layers of all the map's sources: MVT layers are repeated fields, so the bytes of two
// tiles of one address can be joined.
const gzip = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
const lonToX = (lon, z) => Math.min((1 << z) - 1, Math.max(0, Math.floor(((lon + 180) / 360) * (1 << z))));
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.min((1 << z) - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * (1 << z))));
};
const spanOf = ([w, s, e, n], z) => ({ x0: lonToX(w, z), x1: lonToX(e, z), y0: latToY(n, z), y1: latToY(s, z) });
/** The number of tiles of a box (west, south, east, north) for the zooms from `min` to `max`. */
export function tileCount(bbox, min, max) {
  let n = 0;
  for (let z = min; z <= max; z++) { const t = spanOf(bbox, z); n += (t.x1 - t.x0 + 1) * (t.y1 - t.y0 + 1); }
  return n;
}
export const MAX_TILES = 40000;

/** The names of the layers of an MVT tile (a scan of the protobuf: field 3 of the tile is a layer, and field 1 of a layer is its name). */
function layerNames(b) {
  const names = [];
  let i = 0;
  const varint = () => { let v = 0, sh = 0; for (;;) { const c = b[i++]; v += (c & 127) * 2 ** sh; if (c < 128) return v; sh += 7; } };
  while (i < b.length) {
    const tag = varint(), wire = tag & 7, field = tag >> 3;
    if (wire === 2) {
      const len = varint(), end = i + len;
      if (field === 3) {
        let j = i;
        while (j < end) {
          let t = 0, sh = 0; for (;;) { const c = b[j++]; t += (c & 127) * 2 ** sh; if (c < 128) break; sh += 7; }
          if ((t & 7) === 2) { let l = 0; sh = 0; for (;;) { const c = b[j++]; l += (c & 127) * 2 ** sh; if (c < 128) break; sh += 7; } if (t >> 3 === 1) { names.push(new TextDecoder().decode(b.subarray(j, j + l))); break; } j += l; }
          else if ((t & 7) === 0) { for (;;) if (b[j++] < 128) break; }
          else if ((t & 7) === 5) j += 4; else if ((t & 7) === 1) j += 8; else break;
        }
      }
      i = end;
    } else if (wire === 0) varint(); else if (wire === 5) i += 4; else if (wire === 1) i += 8; else break;
  }
  return names;
}

/**
 * Make the tiles. `src`: {urls: the address of a source with {z}, {x} and {y}, tile(url) -> ArrayBuffer}. Gives {tiles: [{z, x, y, data (gzip)}], layers}.
 * The tiles that have nothing are left out.
 */
export async function collectTiles(src, bbox, min, max, progress = () => {}, extra = null) {
  const todo = [];
  for (let z = min; z <= max; z++) { const t = spanOf(bbox, z); for (let x = t.x0; x <= t.x1; x++) for (let y = t.y0; y <= t.y1; y++) todo.push([z, x, y]); }
  const tiles = [], layers = new Set();
  let done = 0;
  const one = async ([z, x, y]) => {
    const parts = [];
    for (const u of src.urls) { const d = new Uint8Array(await src.tile(u.replace("{z}", z).replace("{x}", x).replace("{y}", y))); if (d.length) parts.push(d); }
    const more = extra?.get(`${z}/${x}/${y}`);
    if (more) parts.push(more);                          // the layer `edges` of the full export
    if (parts.length) {
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      parts.reduce((o, p) => (all.set(p, o), o + p.length), 0);
      for (const n of layerNames(all)) layers.add(n);
      tiles.push({ z, x, y, data: await gzip(all) });
    }
    if (++done % 50 === 0 || done === todo.length) progress(done, todo.length);
  };
  for (let i = 0; i < todo.length; i += 16) await Promise.all(todo.slice(i, i + 16).map(one));
  return { tiles, layers: [...layers] };
}

// PMTiles v3: the Hilbert curve order of the tiles, the directories (varints, gzip), and the 127-byte header
function tileId(z, x, y) {
  let acc = 0;
  for (let t = 0; t < z; t++) acc += 4 ** t;
  const n = 2 ** z;
  let d = 0;
  for (let s = n / 2; s > 0; s /= 2) {
    const rx = x & s ? 1 : 0, ry = y & s ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = n - 1 - x; y = n - 1 - y; } [x, y] = [y, x]; }
  }
  return acc + d;
}
const putVarint = (out, v) => { while (v >= 128) { out.push((v % 128) | 128); v = Math.floor(v / 128); } out.push(v); };
function directory(entries) {            // entries: {id, offset, length, run} sorted by id
  const out = [];
  putVarint(out, entries.length);
  let last = 0;
  for (const e of entries) { putVarint(out, e.id - last); last = e.id; }
  for (const e of entries) putVarint(out, e.run);
  for (const e of entries) putVarint(out, e.length);
  entries.forEach((e, i) => putVarint(out, i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length ? 0 : e.offset + 1));
  return new Uint8Array(out);
}

/** One PMTiles v3 file of tiles (gzip MVT). `info`: {name, bbox, minzoom, maxzoom, layers}. */
export async function pmtiles(tiles, info) {
  const sorted = tiles.map((t) => ({ ...t, id: tileId(t.z, t.x, t.y) })).sort((a, b) => a.id - b.id);
  let at = 0;
  const entries = sorted.map((t) => { const e = { id: t.id, offset: at, length: t.data.length, run: 1 }; at += t.data.length; return e; });
  const LEAF = 4000;                    // more entries than this: leaf directories, so that the root stays in the first 16 KB
  let root, leaves = new Uint8Array(0);
  if (entries.length <= LEAF) root = await gzip(directory(entries));
  else {
    const parts = [], rootEntries = [];
    let off = 0;
    for (let i = 0; i < entries.length; i += LEAF) {
      const chunk = entries.slice(i, i + LEAF), bytes = await gzip(directory(chunk.map((e) => ({ ...e }))));
      rootEntries.push({ id: chunk[0].id, offset: off, length: bytes.length, run: 0 });
      parts.push(bytes); off += bytes.length;
    }
    leaves = new Uint8Array(off); parts.reduce((o, p) => (leaves.set(p, o), o + p.length), 0);
    root = await gzip(directory(rootEntries));
  }
  const meta = await gzip(new TextEncoder().encode(JSON.stringify({ name: info.name, type: "overlay", format: "pbf", vector_layers: info.layers.map((id) => ({ id, fields: {} })), generator: "duckosm-rust", minzoom: info.minzoom, maxzoom: info.maxzoom })));
  const data = new Uint8Array(at); sorted.reduce((o, t) => (data.set(t.data, o), o + t.data.length), 0);
  const head = new DataView(new ArrayBuffer(127));
  [..."PMTiles"].forEach((c, i) => head.setUint8(i, c.charCodeAt(0)));
  head.setUint8(7, 3);
  const u64 = (o, v) => head.setBigUint64(o, BigInt(v), true), i32 = (o, v) => head.setInt32(o, Math.round(v * 1e7), true);
  const rootAt = 127, metaAt = rootAt + root.length, leafAt = metaAt + meta.length, dataAt = leafAt + leaves.length;
  u64(8, rootAt); u64(16, root.length); u64(24, metaAt); u64(32, meta.length); u64(40, leafAt); u64(48, leaves.length); u64(56, dataAt); u64(64, data.length);
  u64(72, sorted.length); u64(80, entries.length); u64(88, sorted.length);
  head.setUint8(96, 1); head.setUint8(97, 2); head.setUint8(98, 2); head.setUint8(99, 1);          // clustered, gzip directories, gzip tiles, MVT
  head.setUint8(100, info.minzoom); head.setUint8(101, info.maxzoom);
  const [w, s, e, n] = info.bbox;
  i32(102, w); i32(106, s); i32(110, e); i32(114, n);
  head.setUint8(118, info.maxzoom); i32(119, (w + e) / 2); i32(123, (s + n) / 2);
  return new Blob([head.buffer, root, meta, leaves, data], { type: "application/octet-stream" });
}

let sqlJs = null;
/** sql.js (SQLite in WebAssembly) from a CDN, for MBTiles and GeoPackage. */
export async function sqlite() {
  const base = "https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/";
  sqlJs ??= (async () => {
    if (!window.initSqlJs) await new Promise((ok, no) => { const s = document.createElement("script"); s.src = base + "sql-wasm.js"; s.onload = ok; s.onerror = () => no(new Error("sql.js did not load")); document.head.append(s); });
    return window.initSqlJs({ locateFile: (f) => base + f });
  })();
  return sqlJs;
}

/** One MBTiles file (SQLite, rows of gzip MVT; the row numbers run from the south, TMS). */
export async function mbtiles(tiles, info) {
  const SQL = await sqlite(), db = new SQL.Database();
  db.run("CREATE TABLE metadata (name TEXT, value TEXT); CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB); CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);");
  const meta = { name: info.name, format: "pbf", type: "overlay", version: "1", description: "duckOSM-rust", minzoom: info.minzoom, maxzoom: info.maxzoom, bounds: info.bbox.join(","), center: `${(info.bbox[0] + info.bbox[2]) / 2},${(info.bbox[1] + info.bbox[3]) / 2},${info.maxzoom}`,
    json: JSON.stringify({ vector_layers: info.layers.map((id) => ({ id, fields: {}, minzoom: info.minzoom, maxzoom: info.maxzoom })) }) };
  const m = db.prepare("INSERT INTO metadata VALUES (?, ?)");
  for (const [k, v] of Object.entries(meta)) m.run([k, String(v)]);
  m.free();
  db.run("BEGIN");
  const t = db.prepare("INSERT INTO tiles VALUES (?, ?, ?, ?)");
  for (const x of tiles) t.run([x.z, x.x, (1 << x.z) - 1 - x.y, x.data]);
  t.free();
  db.run("COMMIT");
  const bytes = db.export();
  db.close();
  return new Blob([bytes], { type: "application/vnd.mapbox-vector-tile" });
}

/**
 * The tile exports. `ctx`: {src, bbox, min, max, progress}. They need the map (step 6): the tiles are the ones of the map.
 */
async function tileFile(kind, ctx, area) {
  const { tiles, layers } = await collectTiles(ctx.src, ctx.bbox, ctx.min, ctx.max, ctx.progress, ctx.extra);
  if (!tiles.length) throw new Error("no tile has anything in it: show the map first (step 6), or use other zooms");
  const info = { name: SLUG(area), bbox: ctx.bbox, minzoom: ctx.min, maxzoom: ctx.max, layers };
  const blob = await (kind === "pmtiles" ? pmtiles : mbtiles)(tiles, info);
  return { name: `${SLUG(area)}_z${ctx.min}-${ctx.max}.${kind}`, blob, rows: tiles.length, tiles: tiles.length, layers, min: ctx.min, max: ctx.max, edgeTiles: ctx.extra ?? null };
}
export const pmtilesFile = (query, mode, area, ctx) => tileFile("pmtiles", ctx, area);
export const mbtilesFile = (query, mode, area, ctx) => tileFile("mbtiles", ctx, area);

/** The zoom where a road class starts to show in the layer `edges` (a lower class is left out at a lower zoom, as in any tile set that has to stay small). */
const CLASS_FROM_ZOOM = { motorway: 0, trunk: 0, primary: 0, secondary: 8, tertiary: 10, unclassified: 11, residential: 12, living_street: 12 };
const fromZoom = (h) => CLASS_FROM_ZOOM[cls(h)] ?? 13;

/** The roads of all the networks for the layer `edges`: one feature for each edge_id, with every column of the edge, and a flag for each network that has it. */
export async function roadFeatures(query, modes) {
  const byId = new Map();
  for (const m of modes) {
    for (const e of await query(`SELECT edge_id::VARCHAR AS edge_id, osm_id::VARCHAR AS osm_id, edge_ref, name, highway, oneway, lanes, surface, maxspeed_kmh, bridge, tunnel, junction, layer, service, access,
        length_m, cost_s, source::VARCHAR AS source, target::VARCHAR AS target, ST_AsGeoJSON(geometry) AS g FROM ${m}.edges`)) {
      let f = byId.get(e.edge_id);
      if (!f) {
        const { g, ...props } = e;
        for (const n of modes) props[n] = false;
        byId.set(e.edge_id, (f = { props, line: JSON.parse(g).coordinates }));
      }
      f.props[m] = true;
    }
  }
  return [...byId.values()];
}

/**
 * The layer `edges` of every tile of the zooms from `min` to `max`: a LineString for each road piece in the tile (clipped to the tile with a buffer of 64 units, 4096 units
 * wide), with all the attributes. Gives a map from "z/x/y" to the bytes of an MVT tile with that one layer.
 */
export function edgeTiles(features, min, max) {
  const EXT = 4096, BUF = 64, out = new Map();
  for (let z = min; z <= max; z++) {
    const scale = 2 ** z * EXT, tiles = new Map();
    for (const f of features) {
      if (z < fromZoom(f.props.highway)) continue;
      const pts = f.line.map(([lon, lat]) => { const r = (lat * Math.PI) / 180; return [((lon + 180) / 360) * scale, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * scale]; });
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const tx0 = Math.max(0, Math.floor((x0 - BUF) / EXT)), tx1 = Math.min(2 ** z - 1, Math.floor((x1 + BUF) / EXT)), ty0 = Math.max(0, Math.floor((y0 - BUF) / EXT)), ty1 = Math.min(2 ** z - 1, Math.floor((y1 + BUF) / EXT));
      for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
          const runs = clipLine(pts.map(([x, y]) => [x - tx * EXT, y - ty * EXT]), -BUF, EXT + BUF);
          if (!runs.length) continue;
          const key = `${z}/${tx}/${ty}`;
          if (!tiles.has(key)) tiles.set(key, []);
          tiles.get(key).push({ props: f.props, runs });
        }
      }
    }
    for (const [key, list] of tiles) out.set(key, edgeTile(list));
  }
  return out;
}

/** The pieces of a polyline inside a square (lo to hi in both axes), as arrays of integer points; a piece of one point is dropped (Liang-Barsky on each segment). */
function clipLine(pts, lo, hi) {
  const runs = [];
  let run = null;
  const push = (x, y) => { x = Math.round(x); y = Math.round(y); if (!run) run = []; const l = run[run.length - 1]; if (!l || l[0] !== x || l[1] !== y) run.push([x, y]); };
  const end = () => { if (run && run.length > 1) runs.push(run); run = null; };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, ax - lo], [dx, hi - ax], [-dy, ay - lo], [dy, hi - ay]]) {
      if (p === 0) { if (q < 0) { t0 = 2; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { t0 = 2; break; } if (r > t0) t0 = r; } else { if (r < t0) { t0 = 2; break; } if (r < t1) t1 = r; }
    }
    if (t0 > t1) { end(); continue; }
    if (t0 > 0) end();                                   // the line comes in from outside: a new piece
    push(ax + dx * t0, ay + dy * t0);
    push(ax + dx * t1, ay + dy * t1);
    if (t1 < 1) end();                                   // and leaves
  }
  end();
  return runs;
}

/** An MVT tile with the layer `edges`: each piece is a feature (MoveTo and LineTo commands, zigzag deltas). */
function edgeTile(list) {
  const layer = { name: "edges", extent: 4096, version: 2, keys: [], values: [], features: [] }, idx = indexOf(layer);
  const zig = (v) => (v << 1) ^ (v >> 31);
  for (const { props, runs } of list) {
    const g = [];
    let cx = 0, cy = 0;
    const put = (v) => { v = zig(v) >>> 0; while (v >= 128) { g.push((v & 127) | 128); v >>>= 7; } g.push(v); };
    for (const run of runs) {
      put0(g, (1 & 7) | (1 << 3)); put(run[0][0] - cx); put(run[0][1] - cy); [cx, cy] = run[0];
      put0(g, (2 & 7) | ((run.length - 1) << 3));
      for (let i = 1; i < run.length; i++) { put(run[i][0] - cx); put(run[i][1] - cy); [cx, cy] = run[i]; }
    }
    const feat = { id: undefined, tags: [], type: 2, geometry: Uint8Array.from(g) };
    addProps(layer, feat, props, idx);
    layer.features.push(feat);
  }
  return encodeTile([layer]);
}
const put0 = (g, v) => { while (v >= 128) { g.push((v & 127) | 128); v >>>= 7; } g.push(v); };

/** A GeoPackage (OGC GeoPackage 1.2, SQLite): the tables `roads` (LineString, a two-way road once) and `nodes` (Point) in EPSG:4326, with no spatial index. */
export async function geopackage(query, mode, area) {
  const SQL = await sqlite(), db = new SQL.Database();
  const edges = await roadRows(query, mode, "ST_AsWKB(e.geometry)", ", ST_XMin(e.geometry) AS x0, ST_YMin(e.geometry) AS y0, ST_XMax(e.geometry) AS x1, ST_YMax(e.geometry) AS y1");
  for (const e of edges) e.wkb = e.g;
  const nodes = await query(`SELECT node_id::VARCHAR AS node_id, ST_AsWKB(geom) AS wkb, ST_X(geom) AS x, ST_Y(geom) AS y FROM ${mode}.nodes ORDER BY node_id`);
  const WGS84 = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';
  db.run(`PRAGMA application_id = 1196444487; PRAGMA user_version = 10200;
    CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
    CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER);
    CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name));
    CREATE TABLE roads (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom LINESTRING, edge_id TEXT, edge_id_reverse TEXT, twoway INTEGER, osm_id TEXT, source TEXT, target TEXT, name TEXT, highway TEXT, oneway INTEGER, lanes INTEGER, maxspeed_kmh REAL, length_m REAL);
    CREATE TABLE nodes (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom POINT, node_id TEXT);`);
  db.run("INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', NULL), ('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', NULL), ('WGS 84', 4326, 'EPSG', 4326, ?, NULL)", [WGS84]);
  const geom = (wkb) => { const g = new Uint8Array(8 + wkb.length); g.set([0x47, 0x50, 0, 1, 0xe6, 0x10, 0, 0]); g.set(wkb, 8); return g; };      // "GP", version 0, flags (little endian, no envelope), srs_id 4326 (little endian)
  db.run("BEGIN");
  const r = db.prepare("INSERT INTO roads (geom, edge_id, edge_id_reverse, twoway, osm_id, source, target, name, highway, oneway, lanes, maxspeed_kmh, length_m) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  let box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const e of edges) { r.run([geom(e.wkb), e.edge_id, e.edge_id_reverse, e.twoway ? 1 : 0, e.osm_id, e.source, e.target, e.name, e.highway, e.oneway ? 1 : 0, e.lanes, e.maxspeed_kmh, e.length_m]); box = [Math.min(box[0], e.x0), Math.min(box[1], e.y0), Math.max(box[2], e.x1), Math.max(box[3], e.y1)]; }
  r.free();
  const n = db.prepare("INSERT INTO nodes (geom, node_id) VALUES (?,?)");
  for (const p of nodes) n.run([geom(p.wkb), p.node_id]);
  n.free();
  db.run("COMMIT");
  db.run("INSERT INTO gpkg_contents (table_name, data_type, identifier, min_x, min_y, max_x, max_y, srs_id) VALUES ('roads', 'features', 'roads', ?, ?, ?, ?, 4326), ('nodes', 'features', 'nodes', ?, ?, ?, ?, 4326)", [...box, ...box]);
  db.run("INSERT INTO gpkg_geometry_columns VALUES ('roads', 'geom', 'LINESTRING', 4326, 0, 0), ('nodes', 'geom', 'POINT', 4326, 0, 0)");
  const bytes = db.export();
  db.close();
  return { name: `${SLUG(area)}_${mode}.gpkg`, blob: new Blob([bytes], { type: "application/geopackage+sqlite3" }), rows: edges.length, nodes: nodes.length };
}

// ---- the check of a file: the page reads the file that it made, and compares it with the tables. `verify` gives {ok, text}.
const unzip = async (blob) => {
  const { unzipSync } = await import("https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js");
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
};
const count = async (query, sql) => Number((await query(sql))[0].n);
const xml = (bytes) => {
  const d = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  if (d.querySelector("parsererror")) throw new Error("the XML does not parse");
  return d;
};
const gunzip = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
const fmt = (n) => Number(n).toLocaleString("en-US");

/** Read the directories of a PMTiles file: [{id, offset, length}] of every tile, and the header numbers. */
async function readPmtiles(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), u64 = (o) => Number(v.getBigUint64(o, true));
  if (new TextDecoder().decode(bytes.subarray(0, 7)) !== "PMTiles" || bytes[7] !== 3) throw new Error("the file is not PMTiles v3");
  const h = { rootAt: u64(8), rootLen: u64(16), leafAt: u64(40), leafLen: u64(48), dataAt: u64(56), tiles: u64(72), min: bytes[100], max: bytes[101] };
  const dir = async (at, len) => {
    const b = await gunzip(bytes.subarray(at, at + len));
    let i = 0;
    const varint = () => { let x = 0, sh = 0; for (;;) { const c = b[i++]; x += (c & 127) * 2 ** sh; if (c < 128) return x; sh += 7; } };
    const n = varint(), e = Array.from({ length: n }, () => ({}));
    let id = 0;
    for (const x of e) { id += varint(); x.id = id; }
    for (const x of e) x.run = varint();
    for (const x of e) x.length = varint();
    e.forEach((x, k) => { const o = varint(); x.offset = o === 0 && k > 0 ? e[k - 1].offset + e[k - 1].length : o - 1; });
    return e;
  };
  const tiles = [];
  for (const e of await dir(h.rootAt, h.rootLen)) {
    if (e.run > 0) tiles.push(e);
    else for (const l of await dir(h.leafAt + e.offset, e.length)) tiles.push(l);
  }
  return { h, tiles, tileBytes: (e) => bytes.subarray(h.dataAt + e.offset, h.dataAt + e.offset + e.length) };
}

export async function verify(id, r, { query, mode, modes = [mode] }) {
  const nEdges = id === "pmtiles" || id === "mbtiles" || id === "webmap" || id === "geojson_nodes" ? 0 : await count(query, id === "geojson" || id === "gpkg" ? roadCountSql(mode) : `SELECT count(*) AS n FROM ${mode}.edges`);
  const nNodes = id === "pmtiles" || id === "mbtiles" || id === "webmap" || id === "geojson" ? 0 : await count(query, `SELECT count(*) AS n FROM ${mode}.nodes`);
  const same = (what, got, want) => { if (got !== want) throw new Error(`${what}: the file has ${fmt(got)}, the tables have ${fmt(want)}`); };
  try {
    if (id === "geojson" || id === "geojson_nodes") {
      const g = JSON.parse(await r.blob.text()), want = id === "geojson" ? nEdges : nNodes;
      if (g.type !== "FeatureCollection") throw new Error("the file is not a FeatureCollection");
      same(id === "geojson" ? "roads" : "nodes", g.features.length, want);
      if (id === "geojson") {                          // every edge of the table is a feature (forward) or the reverse of one
        const ids = new Set(g.features.flatMap((f) => [f.properties.edge_id, f.properties.edge_id_reverse]).filter(Boolean));
        same("edge ids", ids.size, await count(query, `SELECT count(*) AS n FROM ${mode}.edges`));
      }
      const type = id === "geojson" ? "LineString" : "Point";
      if (g.features.some((f) => f.geometry?.type !== type)) throw new Error(`a feature is not a ${type}`);
      return { ok: true, text: `${fmt(want)} ${id === "geojson" ? "roads" : "nodes"}, the same as the tables; plain GeoJSON, every feature a ${type}` };
    }
    if (id === "gpkg") {
      const db = new (await sqlite()).Database(new Uint8Array(await r.blob.arrayBuffer()));
      const q = (sql) => db.exec(sql)[0].values[0][0];
      same("roads", q("SELECT count(*) FROM roads"), nEdges); same("nodes", q("SELECT count(*) FROM nodes"), nNodes);
      if (q("PRAGMA application_id") !== 1196444487) throw new Error("the application id is not GPKG");
      const g = db.exec("SELECT geom FROM roads LIMIT 1")[0].values[0][0];
      if (g[0] !== 0x47 || g[1] !== 0x50) throw new Error("the geometry has no GeoPackage header");
      db.close();
      return { ok: true, text: `${fmt(nEdges)} roads and ${fmt(nNodes)} nodes, the same as the tables; the header of the geometry is right` };
    }
    if (id === "matsim") {
      const d = xml(new Uint8Array(await r.blob.arrayBuffer()));
      const nodes = d.querySelectorAll("nodes > node"), links = d.querySelectorAll("links > link");
      same("nodes", nodes.length, nNodes); same("links", links.length, nEdges);
      const ids = new Set([...nodes].map((n) => n.getAttribute("id")));
      for (const l of links) if (!ids.has(l.getAttribute("from")) || !ids.has(l.getAttribute("to"))) throw new Error(`link ${l.getAttribute("id")} has a node that is not in the file`);
      return { ok: true, text: `${fmt(links.length)} links and ${fmt(nodes.length)} nodes, the same as the tables; every link joins two nodes of the file` };
    }
    if (id === "sumo") {
      const z = await unzip(r.blob), name = Object.keys(z).find((n) => n.endsWith(".nod.xml")).slice(0, -8);
      const nod = xml(z[`${name}.nod.xml`]), edg = xml(z[`${name}.edg.xml`]), con = xml(z[`${name}.con.xml`]);
      same("nodes", nod.querySelectorAll("node").length, nNodes); same("edges", edg.querySelectorAll("edge").length, nEdges);
      const want = await count(query, `SELECT count(*) AS n FROM ${mode}.edge_graph WHERE from_edge IN (SELECT edge_id FROM ${mode}.edges) AND to_edge IN (SELECT edge_id FROM ${mode}.edges)`);
      same("connections", con.querySelectorAll("connection").length, want);
      const ids = new Set([...nod.querySelectorAll("node")].map((n) => n.getAttribute("id")));
      for (const e of edg.querySelectorAll("edge")) if (!ids.has(e.getAttribute("from")) || !ids.has(e.getAttribute("to"))) throw new Error(`edge ${e.getAttribute("id")} has a node that is not in the file`);
      return { ok: true, text: `${fmt(nEdges)} edges, ${fmt(nNodes)} nodes and ${fmt(want)} connections, the same as the tables. Not run through netconvert here` };
    }
    if (id === "webmap") {
      const z = await unzip(r.blob), want = ["tiles.pmtiles", "style.json", "index.html", "serve.py", "README.txt"];
      for (const n of want) if (!z[n]) throw new Error(`the .zip has no ${n}`);
      const style = JSON.parse(new TextDecoder().decode(z["style.json"]));
      const srcs = Object.values(style.sources);
      if (!srcs.length || srcs.some((x) => x.url !== "pmtiles://tiles.pmtiles")) throw new Error("a source of the style does not read tiles.pmtiles");
      if (!style.state || !("rs_theme" in style.state)) throw new Error("the style has no global state (the layers need it)");
      const keys = new Set([...JSON.stringify(style.layers).matchAll(/\["global-state","([^"]+)"\]/g)].map((m) => m[1]));
      for (const k of keys) if (!(k in style.state)) throw new Error(`the layers read the global state ${k}, which the style does not have`);
      const p = await readPmtiles(z["tiles.pmtiles"]);
      same("tiles", p.tiles.length, r.tiles);
      if (!new TextDecoder().decode(z["index.html"]).includes("pmtiles://") && !new TextDecoder().decode(z["index.html"]).includes("addProtocol")) throw new Error("the viewer does not read PMTiles");
      return { ok: true, text: `${style.layers.length} layers on tiles.pmtiles (${fmt(p.tiles.length)} tiles, zoom ${p.h.min} to ${p.h.max}); the global state of every layer is in the style; the viewer and serve.py are in the .zip` };
    }
    if (id === "pmtiles") {
      const p = await readPmtiles(new Uint8Array(await r.blob.arrayBuffer()));
      same("tiles", p.tiles.length, r.tiles); same("tiles in the header", p.h.tiles, r.tiles);
      if (p.h.min !== r.min || p.h.max !== r.max) throw new Error(`the zooms in the header are ${p.h.min} to ${p.h.max}, not ${r.min} to ${r.max}`);
      const biggest = p.tiles.reduce((a, b) => (b.length > a.length ? b : a)), names = layerNames(await gunzip(p.tileBytes(biggest)));      // the biggest tile has the most layers
      if (!names.length) throw new Error("a tile that I read back has no layers");
      return { ok: true, text: `${fmt(p.tiles.length)} tiles, zoom ${p.h.min} to ${p.h.max}, directories read back; a tile has the layers ${names.slice(0, 4).join(", ")}${names.length > 4 ? "…" : ""}${r.edgeTiles ? await edgesCheck(r, query, modes) : ""}` };
    }
    if (id === "mbtiles") {
      const db = new (await sqlite()).Database(new Uint8Array(await r.blob.arrayBuffer()));
      same("tiles", db.exec("SELECT count(*) FROM tiles")[0].values[0][0], r.tiles);
      const [lo, hi] = db.exec("SELECT min(zoom_level), max(zoom_level) FROM tiles")[0].values[0];
      if (lo < r.min || hi > r.max) throw new Error(`the tiles have zooms ${lo} to ${hi}`);
      const t = db.exec("SELECT tile_data FROM tiles LIMIT 1")[0].values[0][0];
      if (t[0] !== 0x1f || t[1] !== 0x8b) throw new Error("a tile is not gzip");
      db.close();
      return { ok: true, text: `${fmt(r.tiles)} tiles, zoom ${lo} to ${hi}, gzip MVT in SQLite` };
    }
  } catch (e) {
    return { ok: false, text: e.message };
  }
  return { ok: true, text: "" };
}

/** Every edge of every network is in the layer `edges` of the tiles of the highest zoom (the tiles that the export made). */
async function edgesCheck(r, query, modes) {
  const ids = new Set();
  for (const [key, bytes] of r.edgeTiles) {
    if (!key.startsWith(`${r.max}/`)) continue;
    for (const l of decodeTile(bytes)) for (const f of l.features) for (let t = 0; t < f.tags.length; t += 2) if (l.keys[f.tags[t]] === "edge_id") ids.add(l.values[f.tags[t + 1]]);
  }
  const want = await count(query, "SELECT count(*) AS n FROM (" + modes.map((m) => `SELECT edge_id FROM ${m}.edges`).join(" UNION ") + ")");
  if (ids.size !== want) throw new Error(`the tiles of zoom ${r.max} have ${fmt(ids.size)} edges, the tables have ${fmt(want)}`);
  return `; all ${fmt(want)} edges of all networks are in the tiles of zoom ${r.max}`;
}

/** The formats of the card Export: id, title, what it is for, the group, the function, and the networks that it takes. */
export const FORMATS = [
  { id: "webmap", group: "Tiles", title: "Web map (tiles, style and viewer)", note: "A .zip with the tiles, the style of this page's map and a viewer page. Run \"python serve.py\" in the folder and open it in a browser: the map looks like this page. Needs the map (step 6).", run: webMap, tiles: true },
  { id: "pmtiles", group: "Tiles", title: "PMTiles", note: "The vector tiles of the map (MVT) in one file, for MapLibre, roadstyle and any static server. Needs the map (step 6).", run: pmtilesFile, tiles: true },
  { id: "mbtiles", group: "Tiles", title: "MBTiles", note: "The same tiles in a SQLite file, for QGIS and tile servers. Needs the map (step 6).", run: mbtilesFile, tiles: true },
  { id: "gpkg", group: "Visualization", title: "GeoPackage", note: "Roads (lines) and nodes (points) in one .gpkg file, for QGIS and ArcGIS. kepler.gl cannot open it: use GeoJSON there.", run: geopackage, modes: ["driving", "walking", "cycling"] },
  { id: "geojson", group: "Visualization", title: "GeoJSON roads", note: "One .geojson file of lines, one for each edge. For kepler.gl, QGIS and web maps.", run: geojson, modes: ["driving", "walking", "cycling"] },
  { id: "geojson_nodes", group: "Visualization", title: "GeoJSON nodes", note: "One .geojson file of points: the junctions and the ends of the roads.", run: geojsonNodes, modes: ["driving", "walking", "cycling"] },
  { id: "matsim", group: "Simulation", title: "MATSim network", note: "network.xml: nodes, and a link for each edge with length, free speed, capacity and lanes. Meters in the UTM zone of the area.", run: matsim, modes: ["driving", "walking", "cycling"] },
  { id: "sumo", group: "Simulation", title: "SUMO plain XML", note: "Three XML files and a README (a .zip). Run the command of the README (netconvert, a SUMO tool) to make the SUMO network file.", run: sumo, modes: ["driving", "walking", "cycling"] },
];
