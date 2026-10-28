// The roads map in a Web Worker: roadstyle's Rust module (geolibre-roadstyle, wasm/, built into map/pkg/ by
// crates/duckosm-wasm/build.sh) makes a MapLibre style with vector-tile sources from roads.parquet (map/roadstyle/roads_sql.js), the
// base-map layers (features.parquet, map/roadstyle/features_sql.js; optional) and the look (map/look.json), and then makes each tile when
// the map asks for it.
// In: {roads: Uint8Array, features: Uint8Array or undefined, name, prefix, keep, levels: the look's keyword levels (roads_sql.js
// makeRoads)}. Out: {style: JSON text, tableBytes: the road table as JSON bytes (each road's fields, middle, box and line), seconds, memoryMiB: the size of the WebAssembly memory, liveMiB: [held now, most held]} or
// {error}. Then in: {tile: [source, z, x, y], id}. Out: {id, data: ArrayBuffer} (empty when nothing is in the tile).
// The page starts a new worker for each style: WebAssembly memory only grows, and a worker that ends gives it back.
import init, { Look, styleSources, LiveMap, memoryBytes, liveBytes } from "./pkg/roadstyle_wasm.js?v=check";

let tiler = null;   // a LiveMap: the tiles, and relevel (the level editor's changes) with no new style

onmessage = async ({ data }) => {
  if (data.lines || data.ends) {
    // {lines: rows, id}: the lines of these rows of the road table (LiveMap.roadLines). Out: {id, lines: [[lon, lat]...] | null for each row}
    // {ends: true, id}: LiveMap.roadEnds. Out: {id, ends: Float64Array, 4 numbers for each row (start lon, lat, end lon, lat; NaN: no line)}
    try {
      if (data.ends) {
        const ends = tiler.roadEnds();
        postMessage({ id: data.id, ends }, [ends.buffer]);
      } else postMessage({ id: data.id, lines: JSON.parse(new TextDecoder().decode(tiler.roadLines(Uint32Array.from(data.lines)))) });
    } catch (e) {
      postMessage({ id: data.id, error: String((e && e.message) || e) });
    }
    return;
  }
  if (data.relevel) {
    // {relevel: rows, id}: the rows of the editor's replaceRoads. Out: {id, counts: {edges, pieces_gone, sources, style_changed}} or {id, error}
    try {
      const counts = JSON.parse(tiler.relevel(JSON.stringify(data.relevel)));
      postMessage({ id: data.id, counts, style: counts.style_changed ? tiler.style() : undefined });
    } catch (e) {
      postMessage({ id: data.id, error: String((e && e.message) || e) });
    }
    return;
  }
  if (data.tile) {
    const [source, z, x, y] = data.tile;
    const t = performance.now();
    const bytes = tiler.tile(source, z, x, y);
    postMessage({ id: data.id, data: bytes.buffer, ms: performance.now() - t }, [bytes.buffer]);
    return;
  }
  try {
    const [, look] = await Promise.all([init(), fetch(new URL("./look.json?v=check", import.meta.url)).then((r) => r.text())]);
    const t = performance.now();
    // levels: "tags", or the stored levels' {edge_hash, n_edges}, which the engine checks
    const l = Look.fromJson(look).withArg("levels", JSON.stringify(data.levels));
    // stage 1 (the sources and the road table), then the vector tiles of stage 2
    const laps = [];
    const lap = (n) => laps.push([n, +((performance.now() - t) / 1000).toFixed(2)]);   // seconds since the start, for the page's step table
    const sources = styleSources(data.roads, l, data.features, undefined, data.name);
    lap("worker: styleSources (stage 1)");
    // the road table with only the fields that the page and roadstyle's dashboard read (data.tableFields): the popup's (keep), and the
    // dashboard's own (lvl, oneway, length and the engine's __rs_* fields). The bytes go to the page, which parses them after the first tiles.
    const tableBytes = sources.roadTable(data.tableFields);
    lap("worker: road table bytes");
    tiler = new LiveMap(sources, l, data.prefix, data.keep);   // takes the sources
    lap("worker: LiveMap (tile index)");
    postMessage({ style: tiler.style(), tableBytes, laps, seconds: (performance.now() - t) / 1000, memoryMiB: Math.round(memoryBytes() / 2 ** 20),
      liveMiB: [...liveBytes()].map((b) => Math.round(b / 2 ** 20)) }, [tableBytes.buffer]);
  } catch (e) {
    postMessage({ error: String((e && e.message) || e) });
  }
};
