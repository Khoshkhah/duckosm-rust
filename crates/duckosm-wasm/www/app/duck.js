// The build side of the app (docs/app.md): duckdb-wasm, the build worker (../build_worker.js), the load of the tables, the style of
// the roads map (../map/), SQL, load.sql, and the data of an area from the Overpass API. The page (../index.html) calls it.
import { writeRoads } from "../map/roads_sql.js";
import { writeFeatures } from "../map/features_sql.js";

// duckdb-wasm with DuckDB 1.5: the GEOMETRY type of the tables is core from 1.5 (the version that the geolibre-roadstyle spike tested)
const DUCKDB = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.33.1-dev57.0/+esm";

export const MACROS = `
CREATE OR REPLACE MACRO edge_id_hash(osm_id, source, target) AS
    (hash(osm_id::BIGINT, source::BIGINT, target::BIGINT) >> 1)::BIGINT;
CREATE OR REPLACE MACRO edge_id_hash_v1(osm_id, source, target, is_reverse) AS
    (hash(osm_id::BIGINT, source::BIGINT, target::BIGINT, is_reverse::BOOLEAN) >> 1)::BIGINT;`;

let db = null, conn = null;
export let tables = [];   // {mode, table, name, bytes, rows} of the last build

// the tables of a mode, in the order of the downloads, with what each one holds (duckOSM docs/reference/database.md, docs/edge_graph.md)
export const TABLES = {
  edges: "The network of the mode: one row for each direction of a road, with its line, length, speed and cost.",
  nodes: "The ends of the edges: the junctions and the dead ends.",
  private_edges: "The roads that the mode may not use: private, bus only, or a pedestrian street for cars.",
  edge_graph: "The legal turns: each pair of edges that can follow each other. Routing with turns uses it.",
  turn_restrictions: "Driving: the OpenStreetMap turn restrictions at a node, as pairs of edges.",
  turn_path_restrictions: "Driving: the turn restrictions through a via way, as paths of edges.",
  turn_permission: "The turn rules that the graph cannot hold: a rule for some vehicles or with a condition.",
  lane_profile: "Driving: each lane of each edge and bus-only edge, from left to right, with its use, width and arrow.",
  edge_id_map: "For each merged edge, the edges that it was made from.",
  ways: "The OpenStreetMap ways that the mode kept, with all their tags and nodes.",
  way_nodes: "The nodes of each way, in order.",
  virtual_nodes: "Always empty, as in duckOSM: the virtual nodes are in nodes.",
  global_junctions: "The nodes where all modes cut their roads, so an edge has the same id in each mode.",
  boundary: "The area: the boundary and its properties.",
  visualization_metadata: "One row: the center and zoom of the area for a map, its time zone, and the build time.",
  transfers: "The changes of mode (walk to car or bike, and back) at the nodes that the modes share.",
  routes: "The bus lines (OpenStreetMap route relations): their number, name and operator, and the ways that could not be followed.",
  route_edges: "The driving edges that each bus line travels, in order and in its direction.",
  edge_levels: "The drawing order of each edge: a bridge over the road under it, a tunnel under the road over it.",
  edge_levels_meta: "One row: how the drawing order was made (from the tags, or solved) and for which edges.",
};
export const REFERENCE = "https://khoshkhah.github.io/duckOSM/reference/database/";
export const FEATURES_TEXT = "The base-map layers (duckOSM features.*): water, land use, buildings, streets and railways, sites, paved areas, " +
  "public transport, points of interest, traffic signals and crossings, place names. The files have no tags column, as duckOSM's export.";
export const FEATURES_REFERENCE = "https://khoshkhah.github.io/duckOSM/reference/features/";
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "area";

// DuckDB starts when the page opens, while the user makes the area
const t0 = performance.now();
export const duckReady = (async () => {
  const duckdb = await import(DUCKDB);
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const url = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }));
  db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(url));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(url);
  // Direct IO: DuckDB opens a .duckdb file past the page buffer of duckdb-wasm. That buffer keeps the write lock of the file after
  // DETACH ("already locked exclusively"), and then the page cannot read the file for its download (duckdbFile).
  await db.open({ path: ":memory:", useDirectIO: true });
  conn = await db.connect();
  // Each build registers its files under the same names (edges_driving.parquet, ...). DuckDB's external file cache keeps parts of
  // a file by its name, so a second build read old parts with the new file ("Snappy decompression failure").
  await conn.query("SET enable_external_file_cache = false");
  return (performance.now() - t0) / 1000;
})();

// the build in a Web Worker; onStep(text) gets its steps
const worker = new Worker(new URL("../build_worker.js", import.meta.url), { type: "module" });
export function build(msg, onStep) {
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.step) onStep(data.step);
      else if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.postMessage(msg, msg.pbf || msg.json ? [msg.pbf || msg.json] : []);
  });
}

// the schema and the table of a file name: edges_driving.parquet -> driving.edges
const split = (name) => {
  const base = name.replace(/\.parquet$/, "");
  return { mode: base.slice(base.lastIndexOf("_") + 1), table: base.slice(0, base.lastIndexOf("_")) };
};
// the same SQL as the native .duckdb writer (crates/duckosm-duckdb)
// the same rules as the native .duckdb writer (crates/duckosm-duckdb, select): duckOSM's names and types
const select = (table) => ({
  nodes: "SELECT node_id, geometry AS geom",
  virtual_nodes: "SELECT node_id, geometry AS geom",
  boundary: "SELECT * EXCLUDE (geometry), geometry AS geom",
  visualization_metadata: "SELECT boundary_geojson::JSON AS boundary_geojson, center_lat, center_lon, initial_zoom, timezone, built_at, duckosm_version",
}[table] ?? "SELECT *");
export const MODES = ["driving", "walking", "cycling"];
// duckOSM's view mm.edges: the edges of all modes with a mode column, the modes in name order
const mmEdges = (modes) => `CREATE OR REPLACE VIEW mm.edges AS ` + [...modes].sort().map((m) =>
  `SELECT '${m}' AS mode, edge_id, source, target, cost_s, length_m, highway, name, geometry FROM ${m}.edges`).join(" UNION ALL ");
// The page reads the geometry as WKB and makes a GEOMETRY without a CRS, the type of duckOSM's tables: when DuckDB's spatial extension
// (the base-map layers) loads before the first value of the type GEOMETRY('OGC:CRS84'), duckdb-wasm 1.33.1-dev57.0 (spatial 28db190)
// fails on each such value ("stoi: no conversion"), and a GeoParquet file gives that type. 'EPSG:4326' works; native DuckDB has no
// such error. https://github.com/duckdb/duckdb-wasm/issues/2199
const GEOM = "ST_GeomFromWKB(geometry)";
const selectWkb = (table, cols) => {
  const sql = select(table);
  if (sql.includes("geometry AS geom")) return sql.replace("geometry AS geom", `${GEOM} AS geom`);
  return sql === "SELECT *" && cols.includes("geometry") ? `SELECT * REPLACE (${GEOM} AS geometry)` : sql;
};

// the files of a build into DuckDB, one schema for each mode; the old tables go away
export async function loadTables(files) {
  await duckReady;
  // the schemas of the last build go away; main cannot, so its tables do
  for (const t of tables) await conn.query(t.mode === "main" ? `DROP TABLE IF EXISTS main.${t.table}` : `DROP SCHEMA IF EXISTS ${t.mode} CASCADE`);
  await conn.query("DROP SCHEMA IF EXISTS raw CASCADE; SET enable_geoparquet_conversion = false");
  tables = [];
  for (const [name, bytes] of Object.entries(files)) {
    if (name.startsWith("raw_")) continue;     // loadFeatures reads them
    const { mode, table } = split(name);
    // registerFileBuffer moves the buffer into DuckDB's worker, so DuckDB gets a copy and the page keeps the file for its download.
    // ponytail: two copies of each file; read them back from DuckDB if memory matters.
    await db.registerFileBuffer(name, bytes.slice());
    await conn.query(`CREATE SCHEMA IF NOT EXISTS ${mode}`);
    const cols = (await conn.query(`DESCRIBE SELECT * FROM read_parquet('${name}')`)).toArray().map((r) => r.column_name);
    await conn.query(`CREATE OR REPLACE TABLE ${mode}.${table} AS ${selectWkb(table, cols)} FROM read_parquet('${name}')`);
    const rows = Number((await conn.query(`SELECT count(*) AS n FROM ${mode}.${table}`)).toArray()[0].n);
    tables.push({ mode, table, name, bytes, rows });
  }
  await conn.query("SET enable_geoparquet_conversion = true");
  const modes = MODES.filter((m) => tables.some((t) => t.mode === m && t.table === "edges"));
  if (tables.some((t) => t.mode === "mm")) await conn.query(mmEdges(modes));
  await conn.query(MACROS);
}

export const query = (sql) => conn.query(sql);
// the memory of DuckDB in MiB (its buffers: the tables, the caches), for the log of the steps
export const memoryMiB = async () =>
  Number((await conn.query("SELECT sum(memory_usage_bytes) AS b FROM duckdb_memory()")).toArray()[0].b) / 2 ** 20;

// the base-map layers (docs/features.md): DuckDB's spatial extension, loaded once (the first time, the browser downloads it, 4.5 MB)
let spatial = null;
export const loadSpatial = () => (spatial ??= duckReady.then(() => conn.query("INSTALL spatial; LOAD spatial")));

// duckOSM's raw.* files of the build, then duckOSM's SQL of the layers (features.sql, from the wasm module) makes features.*; raw.* stays
// for SQL, as in a duckOSM .duckdb file. Each features table also becomes features_<table>.parquet, as duckOSM's GeoParquet export
// (every column but tags).
export async function loadFeatures(files, sql) {
  await loadSpatial();
  for (const name of ["raw_nodes.parquet", "raw_ways.parquet", "raw_relations.parquet"]) await db.registerFileBuffer(name, files[name]);
  await conn.query(sql);
  for (const name of ["raw_nodes.parquet", "raw_ways.parquet", "raw_relations.parquet"]) await db.dropFile(name);
  const names = (await conn.query("SELECT table_name AS t FROM information_schema.tables WHERE table_catalog = 'memory' " +
    "AND table_schema = 'features' ORDER BY 1")).toArray().map((r) => r.t);
  for (const table of names) {
    const name = `features_${table}.parquet`;
    await db.dropFile(name).catch(() => {});     // duckdb-wasm does not see a second COPY to a kept file name
    await conn.query(`COPY (SELECT * EXCLUDE (tags) FROM features.${table}) TO '${name}' (FORMAT parquet)`);
    const bytes = await db.copyFileToBuffer(name);
    const rows = Number((await conn.query(`SELECT count(*) AS n FROM features.${table}`)).toArray()[0].n);
    tables.push({ mode: "features", table, name, bytes, rows });
  }
}

// the .duckdb file of the tables of the build, as make_duckdb.sql makes it: the tables, mm.edges and the macros. DuckDB writes it
// in its worker, and the page gets a copy of the bytes.
export async function duckdbFile(areaName) {
  const name = slug(areaName) + ".duckdb";
  const drop = () => Promise.all([name, name + ".wal"].map((f) => db.dropFile(f).catch(() => {})));
  await drop();
  const c = await db.connect();     // USE goes to this connection only, not to the SQL box
  try {
    await c.query(`ATTACH '${name}' AS out; USE out`);
    for (const m of new Set(tables.map((t) => t.mode))) await c.query(`CREATE SCHEMA IF NOT EXISTS ${m}`);
    for (const t of tables) await c.query(`CREATE TABLE ${t.mode}.${t.table} AS FROM memory.${t.mode}.${t.table}`);
    if (tables.some((t) => t.mode === "mm")) await c.query(mmEdges(MODES.filter((m) => tables.some((t) => t.mode === m))));
    await c.query(MACROS);
    await c.query("USE memory; DETACH out");
    return { blob: new Blob([await db.copyFileToBuffer(name)], { type: "application/vnd.duckdb" }), name };
  } finally {
    await c.query("USE memory; DETACH DATABASE IF EXISTS out").catch(() => {});
    await c.close();
    await drop();
  }
}

// make_duckdb.sql: it makes a .duckdb file from the Parquet files, for a browser where duckdbFile fails
export function loadSql(areaName) {
  const file = slug(areaName);
  const lines = [`-- duckOSM tables of ${areaName.replace(/\n/g, " ")}, from the Parquet files of duckosm-rust in the browser.`,
    `-- In the folder of the files: duckdb ${file}.duckdb < make_duckdb.sql`];
  for (const m of new Set(tables.map((t) => t.mode))) lines.push(`CREATE SCHEMA IF NOT EXISTS ${m};`);
  for (const t of tables) lines.push(`CREATE TABLE ${t.mode}.${t.table} AS ${select(t.table)} FROM read_parquet('${t.name}');`);
  if (tables.some((t) => t.mode === "mm")) lines.push(mmEdges(MODES.filter((m) => tables.some((t) => t.mode === m))) + ";");
  lines.push(MACROS.trim());
  return lines.join("\n") + "\n";
}

// all files of the build in one zip, in a folder named after the area: the Parquet files (the names of duckOSM's GeoParquet export),
// layers.json (its list of the map layers, which the roadstyle GeoLibre plugin opens), make_duckdb.sql, the boundary and a README. The Parquet
// files are compressed already, so the zip only stores them.
export async function zipAll(areaName, boundary) {
  const { zipSync, strToU8 } = await import("https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js");
  const dir = slug(areaName) + "/";
  const layers = tables.filter((t) => t.mode !== "features" && (t.table === "edges" || t.table === "nodes"))
    .map((t) => ({ file: t.name, kind: t.table, mode: t.mode, count: t.rows }))
    .concat(tables.filter((t) => t.mode === "features").map((t) => ({ file: t.name, kind: "features", table: t.table, count: t.rows })));
  const readme = [`duckOSM tables of ${areaName}, built by duckosm-rust in the browser.`, "",
    "<table>_<mode>.parquet: GeoParquet files, one for each table and mode:",
    ...Object.entries(TABLES).map(([t, d]) => `  ${t}: ${d}`), "",
    ...(tables.some((t) => t.mode === "features") ? [`features_<table>.parquet: ${FEATURES_TEXT}`, `  The layers and their columns: ${FEATURES_REFERENCE}`, ""] : []),
    "make_duckdb.sql: makes one .duckdb file from them. In this folder, run:",
    `  duckdb ${slug(areaName)}.duckdb < make_duckdb.sql`,
    "layers.json: the list of the map layers, as duckOSM's GeoParquet export writes it.",
    "boundary.geojson: the area, in the format of duckosm boundary.", "", `The columns of each table: ${REFERENCE}`, ""].join("\n");
  const files = { [dir + "README.txt"]: strToU8(readme), [dir + "make_duckdb.sql"]: strToU8(loadSql(areaName)),
                  [dir + "layers.json"]: strToU8(JSON.stringify({ layers }, null, 1)) };
  if (boundary) files[dir + "boundary.geojson"] = strToU8(boundary);
  for (const t of tables) files[dir + t.name] = [t.bytes, { level: 0 }];
  return { blob: new Blob([zipSync(files)], { type: "application/zip" }), name: slug(areaName) + ".zip" };
}

// the style of the roads map: duckdb-wasm writes roads.parquet (the drawing levels of visualization.edge_levels, else from the tags)
// and, with the base-map layers, features.parquet; roadstyle's Rust module makes the MapLibre style in a new worker
// (map/map_worker.js), with vector-tile sources rs://<generation>/<source>/{z}/{x}/{y}. The worker stays to make the tiles that the
// map asks for (tile()), until the next style (a worker that ends gives its memory back). keep: the road properties that the page
// reads (its popup); the tiles have only these and the ones the style reads.
let look = null, mapWorker = null, generation = 0, tileId = 0;
const tileCalls = new Map();
function endMapWorker() {
  mapWorker?.terminate();
  mapWorker = null;
  for (const done of tileCalls.values()) done(undefined);
  tileCalls.clear();
}
export async function roadsStyle(mode, name, keep = []) {
  const t = performance.now();
  const q = async (sql) => (await conn.query(sql)).toArray().map((r) => r.toJSON());
  await db.dropFile("roads.parquet").catch(() => {});     // duckdb-wasm does not see a second COPY to a kept file name
  const stored = tables.some((t) => t.mode === "visualization" && t.table === "edge_levels");
  await writeRoads(q, "memory", mode, { levels: stored ? "stored" : "tags" });
  const roads = await db.copyFileToBuffer("roads.parquet");
  // the base-map layers, when the build made them: features.parquet, the rows of the look's layers (map/features_sql.js)
  let features;
  if (tables.some((t) => t.mode === "features")) {
    look ??= fetch(new URL("../map/look.json", import.meta.url)).then((r) => r.json());
    await db.dropFile("features.parquet").catch(() => {});
    if (await writeFeatures(q, "memory", (await look).features.layers_yaml.layers)) features = await db.copyFileToBuffer("features.parquet");
  }
  const roadsSeconds = (performance.now() - t) / 1000;
  endMapWorker();
  const w = (mapWorker = new Worker(new URL("../map/map_worker.js", import.meta.url), { type: "module" }));
  const prefix = `rs://${++generation}/`;
  const out = await new Promise((ok, fail) => {
    w.onmessage = ({ data }) => {
      if (data.id != null) {
        tileCalls.get(data.id)?.(data.data);
        tileCalls.delete(data.id);
      } else if (data.error) {
        endMapWorker();
        fail(new Error(data.error));
      } else ok(data);
    };
    w.onerror = (e) => { endMapWorker(); fail(new Error(e.message || "the map worker failed")); };
    w.postMessage({ roads, features, name, prefix, keep }, [roads.buffer, ...(features ? [features.buffer] : [])]);
  });
  return { style: JSON.parse(out.style), roadsSeconds, styleSeconds: out.seconds, memoryMiB: out.memoryMiB };
}

// a question to the map worker, answered by its id
const ask = (msg, none) => !mapWorker ? Promise.resolve(none) : new Promise((done) => {
  const id = ++tileId;
  tileCalls.set(id, done);
  mapWorker.postMessage({ ...msg, id });
});
// a tile of the roads map (MapLibre's request for rs://<generation>/<source>/<z>/<x>/<y>); a tile of an older style is empty
export function tile(url) {
  const [gen, source, z, x, y] = url.slice("rs://".length).split("/");
  return +gen !== generation ? Promise.resolve(new ArrayBuffer(0)) : ask({ tile: [source, +z, +x, +y] }, new ArrayBuffer(0));
}
// the line of the road edge_id (its popup's value) as [[lon, lat], ...]: from the first mode table that has it, or null. The map's
// tiles cut the roads, and roadstyle's Street View and Google 3D need the whole line (map/roadstyle_windows.js).
export async function roadLine(edgeId) {
  if (!/^-?\d+$/.test(String(edgeId))) return null;
  const parts = tables.filter((t) => MODES.includes(t.mode) && (t.table === "edges" || t.table === "private_edges"))
    .map((t) => `SELECT ST_AsGeoJSON(geometry) AS g FROM ${t.mode}.${t.table} WHERE edge_id = ${edgeId}`);
  if (!parts.length) return null;
  const row = (await conn.query(parts.join(" UNION ALL ") + " LIMIT 1")).toArray()[0];
  return row ? JSON.parse(row.g).coordinates : null;
}
// the properties of road number `edge` of the map (the property __rs_edge of what the map draws), or null
export const roadProps = async (edge) => JSON.parse((await ask({ props: ["roads", edge] }, "null")) || "null");

// the data of an area from the Overpass API: the highway ways and ferry lines in the bounding box of each outer ring, with all their
// nodes, and the type=restriction relations of these ways. duckosm-rust then keeps the ways with a node inside the boundary, as in
// the cut of a region file. A public server can be busy, so the next one is tried.
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
                  "https://overpass.private.coffee/api/interpreter"];

export async function overpass(polys, onStep) {
  const boxes = polys.map((p) => {
    const xs = p[0].map((c) => c[0]), ys = p[0].map((c) => c[1]);
    return `(${Math.min(...ys)},${Math.min(...xs)},${Math.max(...ys)},${Math.max(...xs)})`;
  });
  const ways = boxes.map((b) => `way["highway"]${b};way["route"="ferry"]${b};`).join("");
  const data = `[out:json][timeout:600][maxsize:2147483648];(${ways})->.w;rel(bw.w)["type"="restriction"]->.r;(.w;.w >;.r;);out body qt;`;
  const failed = [];
  for (const url of OVERPASS) {
    const host = new URL(url).host;
    onStep(`getting the OpenStreetMap data from ${host}`);
    try {
      const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data }) });
      if (r.ok) return { bytes: await r.arrayBuffer(), server: host };
      failed.push(`${host}: ${r.status}`);
    } catch (e) {
      failed.push(`${host}: ${e.message}`);
    }
  }
  throw new Error(`no Overpass server answered (${failed.join("; ")}). The public servers are often full: try again later, or use a region file`);
}
