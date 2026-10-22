// Run the WebAssembly build in Node, with the same .wasm file as the page.
//   node run_node.mjs <file.osm.pbf> <out folder> [mode]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { initSync, build } from "./pkg/duckosm_wasm.js";

const [pbfPath, out, mode = "driving"] = process.argv.slice(2);
const wasm = initSync({ module: readFileSync(new URL("./pkg/duckosm_wasm_bg.wasm", import.meta.url)) });
// WebAssembly memory only grows, so its size at the end is the peak.
const memory = () => `${(wasm.memory.buffer.byteLength / 2 ** 20).toFixed(0)} MiB wasm memory`;
const t0 = performance.now();
let net;
try {
  net = build(readFileSync(pbfPath), mode);
} catch (e) {
  console.error(`failed with ${memory()}: ${e}`);
  process.exit(1);
}
console.log(`${net.summary} in ${((performance.now() - t0) / 1000).toFixed(3)} s, ${memory()}`);
mkdirSync(out, { recursive: true });
for (const name of ["edges", "nodes", "private_edges", "edge_id_map"]) {
  writeFileSync(`${out}/${name}_${mode}.parquet`, net[name]);
}
