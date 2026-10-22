// The style of the roads map in a Web Worker: roadstyle's Rust module (geolibre-roadstyle, spike/rust, built into map/pkg/ by
// crates/duckosm-wasm/build.sh) makes a complete MapLibre style from roads.parquet (map/roads_sql.js) and the look (map/look.json).
// In: {roads: Uint8Array, name}. Out: {style: JSON text, seconds, memoryMiB} or {error}.
// The page starts a new worker for each style: WebAssembly memory only grows, and a worker that ends gives it back.
import init, { makeStyle } from "./pkg/roadstyle_spike.js";

onmessage = async ({ data }) => {
  try {
    const [wasm, look] = await Promise.all([init(), fetch(new URL("./look.json", import.meta.url)).then((r) => r.text())]);
    const t = performance.now();
    const style = makeStyle(data.roads, look, undefined, undefined, data.name);
    postMessage({ style, seconds: (performance.now() - t) / 1000, memoryMiB: Math.round(wasm.memory.buffer.byteLength / 2 ** 20) });
  } catch (e) {
    postMessage({ error: String((e && e.message) || e) });
  }
};
