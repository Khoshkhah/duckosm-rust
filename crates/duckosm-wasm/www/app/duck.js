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
  edge_id_map: "For each merged edge, the edges that it was made from.",
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
  conn = await db.connect();
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
const select = (table) => (table === "nodes" ? "SELECT node_id, geometry AS geom" : "SELECT *");
// The page reads the geometry as WKB and makes a GEOMETRY without a CRS, the type of duckOSM's tables: when DuckDB's spatial extension
// (the base-map layers) loads before the first value of the type GEOMETRY('OGC:CRS84'), duckdb-wasm 1.33.1-dev57.0 (spatial 28db190)
// fails on each such value ("stoi: no conversion"), and a GeoParquet file gives that type. 'EPSG:4326' works; native DuckDB has no
// such error. https://github.com/duckdb/duckdb-wasm/issues/2199
const GEOM = "ST_GeomFromWKB(geometry)";
const selectWkb = (table) => (table === "nodes" ? `SELECT node_id, ${GEOM} AS geom`
  : table === "edges" || table === "private_edges" ? `SELECT * REPLACE (${GEOM} AS geometry)` : "SELECT *");

// the files of a build into DuckDB, one schema for each mode; the old tables go away
export async function loadTables(files) {
  await duckReady;
  for (const m of new Set(tables.map((t) => t.mode))) await conn.query(`DROP SCHEMA IF EXISTS ${m} CASCADE`);
  await conn.query("DROP SCHEMA IF EXISTS raw CASCADE; DROP TABLE IF EXISTS main.boundary; SET enable_geoparquet_conversion = false");
  tables = [];
  for (const [name, bytes] of Object.entries(files)) {
    if (name.startsWith("raw_")) continue;     // loadFeatures reads them
    const { mode, table } = split(name);
    // registerFileBuffer moves the buffer into DuckDB's worker, so DuckDB gets a copy and the page keeps the file for its download.
    // ponytail: two copies of each file; read them back from DuckDB if memory matters.
    await db.registerFileBuffer(name, bytes.slice());
    await conn.query(`CREATE SCHEMA IF NOT EXISTS ${mode}`);
    await conn.query(`CREATE OR REPLACE TABLE ${mode}.${table} AS ${selectWkb(table)} FROM read_parquet('${name}')`);
    const rows = Number((await conn.query(`SELECT count(*) AS n FROM ${mode}.${table}`)).toArray()[0].n);
    tables.push({ mode, table, name, bytes, rows });
  }
  await conn.query("SET enable_geoparquet_conversion = true");
  await conn.query(MACROS);
}

export const query = (sql) => conn.query(sql);

// the base-map layers (docs/features.md): DuckDB's spatial extension, loaded once (the first time, the browser downloads it, 4.5 MB)
let spatial = null;
export const loadSpatial = () => (spatial ??= duckReady.then(() => conn.query("INSTALL spatial; LOAD spatial")));

// duckOSM's raw.* files of the build, then duckOSM's SQL of the layers (features.sql, from the wasm module) makes features.*; raw.* stays
// for SQL, as in a duckOSM .duckdb file. main.boundary (the background of the map) comes from the boundary. Each features table also
// becomes features_<table>.parquet, as duckOSM's GeoParquet export (every column but tags).
export async function loadFeatures(files, sql, boundary) {
  await loadSpatial();
  for (const name of ["raw_nodes.parquet", "raw_ways.parquet", "raw_relations.parquet"]) await db.registerFileBuffer(name, files[name]);
  await conn.query(sql);
  for (const name of ["raw_nodes.parquet", "raw_ways.parquet", "raw_relations.parquet"]) await db.dropFile(name);
  if (boundary) {
    const lit = (v) => (v == null ? "NULL" : `'${String(v).replaceAll("'", "''")}'`);
    const feats = JSON.parse(boundary).features ?? [];
    await conn.query("CREATE OR REPLACE TABLE main.boundary AS " + feats.map((f) =>
      `SELECT ${lit(f.properties?.name)} AS name, ST_GeomFromGeoJSON(${lit(JSON.stringify(f.geometry))}) AS geom`).join(" UNION ALL "));
  }
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

// load.sql: it makes a .duckdb file from the Parquet files (duckdb-wasm 1.33.1-dev57.0 keeps a written .duckdb file locked after
// DETACH, so the page cannot give that file)
export function loadSql(areaName) {
  const file = slug(areaName);
  const lines = [`-- duckOSM tables of ${areaName.replace(/\n/g, " ")}, from the Parquet files of duckosm-rust in the browser.`,
    `-- In the folder of the files: duckdb ${file}.duckdb < load.sql`];
  for (const m of new Set(tables.map((t) => t.mode))) lines.push(`CREATE SCHEMA IF NOT EXISTS ${m};`);
  for (const t of tables) lines.push(`CREATE TABLE ${t.mode}.${t.table} AS ${select(t.table)} FROM read_parquet('${t.name}');`);
  lines.push(MACROS.trim());
  return lines.join("\n") + "\n";
}

// all files of the build in one zip, in a folder named after the area: the Parquet files (the names of duckOSM's GeoParquet export),
// layers.json (its list of the map layers, which the roadstyle GeoLibre plugin opens), load.sql, the boundary and a README. The Parquet
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
    "load.sql: makes one .duckdb file from them (duckdb <name>.duckdb < load.sql, in this folder).",
    "layers.json: the list of the map layers, as duckOSM's GeoParquet export writes it.",
    "boundary.geojson: the area, in the format of duckosm boundary.", "", `The columns of each table: ${REFERENCE}`, ""].join("\n");
  const files = { [dir + "README.txt"]: strToU8(readme), [dir + "load.sql"]: strToU8(loadSql(areaName)),
                  [dir + "layers.json"]: strToU8(JSON.stringify({ layers }, null, 1)) };
  if (boundary) files[dir + "boundary.geojson"] = strToU8(boundary);
  for (const t of tables) files[dir + t.name] = [t.bytes, { level: 0 }];
  return { blob: new Blob([zipSync(files)], { type: "application/zip" }), name: slug(areaName) + ".zip" };
}

// the style of the roads map: duckdb-wasm writes roads.parquet (the drawing levels from the tags) and, with the base-map layers,
// features.parquet; roadstyle's Rust module makes the MapLibre style in a new worker (map/map_worker.js; a worker that ends gives its
// memory back)
let look = null;
export async function roadsStyle(mode, name) {
  const t = performance.now();
  const q = async (sql) => (await conn.query(sql)).toArray().map((r) => r.toJSON());
  await db.dropFile("roads.parquet").catch(() => {});     // duckdb-wasm does not see a second COPY to a kept file name
  await writeRoads(q, "memory", mode, { levels: "tags" });
  const roads = await db.copyFileToBuffer("roads.parquet");
  // the base-map layers, when the build made them: features.parquet, the rows of the look's layers (map/features_sql.js)
  let features;
  if (tables.some((t) => t.mode === "features")) {
    look ??= fetch(new URL("../map/look.json", import.meta.url)).then((r) => r.json());
    await db.dropFile("features.parquet").catch(() => {});
    if (await writeFeatures(q, "memory", (await look).features.layers_yaml.layers)) features = await db.copyFileToBuffer("features.parquet");
  }
  const roadsSeconds = (performance.now() - t) / 1000;
  const out = await new Promise((ok, fail) => {
    const w = new Worker(new URL("../map/map_worker.js", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => { w.terminate(); data.error ? fail(new Error(data.error)) : ok(data); };
    w.onerror = (e) => { w.terminate(); fail(new Error(e.message || "the map worker failed")); };
    w.postMessage({ roads, features, name }, [roads.buffer, ...(features ? [features.buffer] : [])]);
  });
  return { style: JSON.parse(out.style), roadsSeconds, styleSeconds: out.seconds, memoryMiB: out.memoryMiB };
}

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
