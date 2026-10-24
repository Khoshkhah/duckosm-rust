// The roads map in a Web Worker: roadstyle's Rust module (geolibre-roadstyle, wasm/, built into map/pkg/ by
// crates/duckosm-wasm/build.sh) makes a MapLibre style with vector-tile sources from roads.parquet (map/roadstyle/roads_sql.js), the
// base-map layers (features.parquet, map/roadstyle/features_sql.js; optional) and the look (map/look.json), and then makes each tile when
// the map asks for it.
// In: {roads: Uint8Array, features: Uint8Array or undefined, name, prefix, keep, levels: the look's keyword levels (roads_sql.js
// makeRoads)}. Out: {style: JSON text, roadTable: JSON text (the road fields that roadstyle's dashboard reads), seconds, memoryMiB} or
// {error}. Then in: {tile: [source, z, x, y], id}. Out: {id, data: ArrayBuffer} (empty when nothing is in the tile).
// The page starts a new worker for each style: WebAssembly memory only grows, and a worker that ends gives it back.
import init, { Look, makeSources, tileSources, memoryBytes } from "./pkg/roadstyle_wasm.js";

let tiler = null;

onmessage = async ({ data }) => {
  if (data.tile) {
    const [source, z, x, y] = data.tile;
    const bytes = tiler.tile(source, z, x, y);
    postMessage({ id: data.id, data: bytes.buffer }, [bytes.buffer]);
    return;
  }
  try {
    const [, look] = await Promise.all([init(), fetch(new URL("./look.json", import.meta.url)).then((r) => r.text())]);
    const t = performance.now();
    const l = JSON.parse(look);
    l.args.levels = data.levels;   // "tags", or the stored levels' {edge_hash, n_edges}, which the engine checks
    // stage 1 (the sources and the road table), then the vector tiles of stage 2
    const sources = makeSources(data.roads, Look.fromJson(JSON.stringify(l)), data.features, undefined, data.name);
    tiler = tileSources(sources, data.prefix, data.keep);
    const roadTable = new TextDecoder().decode(sources.roadTable());
    sources.free();
    postMessage({ style: tiler.style(), roadTable, seconds: (performance.now() - t) / 1000, memoryMiB: Math.round(memoryBytes() / 2 ** 20) });
  } catch (e) {
    postMessage({ error: String((e && e.message) || e) });
  }
};
