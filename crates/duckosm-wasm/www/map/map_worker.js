// The roads map in a Web Worker: roadstyle's Rust module (geolibre-roadstyle, wasm/, built into map/pkg/ by
// crates/duckosm-wasm/build.sh) makes a MapLibre style with vector-tile sources from roads.parquet (map/roads_sql.js), the
// base-map layers (features.parquet, map/features_sql.js; optional) and the look (map/look.json), and then makes each tile when
// the map asks for it.
// In: {roads: Uint8Array, features: Uint8Array or undefined, name, prefix, keep}. Out: {style: JSON text, seconds, memoryMiB} or
// {error}. Then in: {tile: [source, z, x, y], id}. Out: {id, data: ArrayBuffer} (empty when nothing is in the tile). And in:
// {props: [source, feature id], id}. Out: {id, data: the feature's properties as JSON text, or "null"}.
// The page starts a new worker for each style: WebAssembly memory only grows, and a worker that ends gives it back.
import init, { Tiler, memoryBytes } from "./pkg/roadstyle_wasm.js";

let tiler = null;

onmessage = async ({ data }) => {
  if (data.props) {
    postMessage({ id: data.id, data: tiler.props(...data.props) });
    return;
  }
  if (data.tile) {
    const [source, z, x, y] = data.tile;
    const bytes = tiler.tile(source, z, x, y);
    postMessage({ id: data.id, data: bytes.buffer }, [bytes.buffer]);
    return;
  }
  try {
    const [, look] = await Promise.all([init(), fetch(new URL("./look.json", import.meta.url)).then((r) => r.text())]);
    const t = performance.now();
    tiler = new Tiler(data.roads, look, data.features, data.name, data.prefix, data.keep);
    postMessage({ style: tiler.style(), seconds: (performance.now() - t) / 1000, memoryMiB: Math.round(memoryBytes() / 2 ** 20) });
  } catch (e) {
    postMessage({ error: String((e && e.message) || e) });
  }
};
