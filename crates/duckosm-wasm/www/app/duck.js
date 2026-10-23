// The build side of the app (docs/app.md): duckdb-wasm, the build worker (../build_worker.js), the load of the tables, the style of
// the roads map (../map/), SQL, load.sql, and the data of an area from the Overpass API. The page (../index.html) calls it.
import { writeRoads } from "../map/roads_sql.js";

// duckdb-wasm with DuckDB 1.5: the GEOMETRY type of the tables is core from 1.5 (the version that the geolibre-roadstyle spike tested)
const DUCKDB = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.33.1-dev57.0/+esm";

export const MACROS = `
CREATE OR REPLACE MACRO edge_id_hash(osm_id, source, target) AS
    (hash(osm_id::BIGINT, source::BIGINT, target::BIGINT) >> 1)::BIGINT;
CREATE OR REPLACE MACRO edge_id_hash_v1(osm_id, source, target, is_reverse) AS
    (hash(osm_id::BIGINT, source::BIGINT, target::BIGINT, is_reverse::BOOLEAN) >> 1)::BIGINT;`;

let db = null, conn = null;
export let tables = [];   // {mode, table, name, bytes} of the last build

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

// the files of a build into DuckDB, one schema for each mode; the old tables go away
export async function loadTables(files) {
  await duckReady;
  for (const m of new Set(tables.map((t) => t.mode))) await conn.query(`DROP SCHEMA IF EXISTS ${m} CASCADE`);
  tables = [];
  for (const [name, bytes] of Object.entries(files)) {
    const { mode, table } = split(name);
    // registerFileBuffer moves the buffer into DuckDB's worker, so DuckDB gets a copy and the page keeps the file for its download.
    // ponytail: two copies of each file; read them back from DuckDB if memory matters.
    await db.registerFileBuffer(name, bytes.slice());
    await conn.query(`CREATE SCHEMA IF NOT EXISTS ${mode}`);
    await conn.query(`CREATE OR REPLACE TABLE ${mode}.${table} AS ${select(table)} FROM read_parquet('${name}')`);
    tables.push({ mode, table, name, bytes });
  }
  await conn.query(MACROS);
}

export const query = (sql) => conn.query(sql);

// load.sql: it makes a .duckdb file from the Parquet files (duckdb-wasm 1.33.1-dev57.0 keeps a written .duckdb file locked after
// DETACH, so the page cannot give that file)
export function loadSql(areaName) {
  const file = areaName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "area";
  const lines = [`-- duckOSM tables of ${areaName.replace(/\n/g, " ")}, from the Parquet files of duckosm-rust in the browser.`,
    `-- In the folder of the files: duckdb ${file}.duckdb < load.sql`];
  for (const m of new Set(tables.map((t) => t.mode))) lines.push(`CREATE SCHEMA IF NOT EXISTS ${m};`);
  for (const t of tables) lines.push(`CREATE TABLE ${t.mode}.${t.table} AS ${select(t.table)} FROM read_parquet('${t.name}');`);
  lines.push(MACROS.trim());
  return lines.join("\n") + "\n";
}

// the style of the roads map: duckdb-wasm writes roads.parquet (the drawing levels from the tags), and roadstyle's Rust module makes
// the MapLibre style in a new worker (map/map_worker.js; a worker that ends gives its memory back)
export async function roadsStyle(mode, name) {
  const t = performance.now();
  const q = async (sql) => (await conn.query(sql)).toArray().map((r) => r.toJSON());
  await db.dropFile("roads.parquet").catch(() => {});     // duckdb-wasm does not see a second COPY to a kept file name
  await writeRoads(q, "memory", mode, { levels: "tags" });
  const roads = await db.copyFileToBuffer("roads.parquet");
  const roadsSeconds = (performance.now() - t) / 1000;
  const out = await new Promise((ok, fail) => {
    const w = new Worker(new URL("../map/map_worker.js", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => { w.terminate(); data.error ? fail(new Error(data.error)) : ok(data); };
    w.onerror = (e) => { w.terminate(); fail(new Error(e.message || "the map worker failed")); };
    w.postMessage({ roads, name }, [roads.buffer]);
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
