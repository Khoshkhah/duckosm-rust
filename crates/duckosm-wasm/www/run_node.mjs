// Run the WebAssembly build in Node, with the same .wasm file as the page.
//   node run_node.mjs <file.osm.pbf> <out folder> [modes] [fixes.yaml] [levels]
// modes: comma separated (default: driving,walking,cycling). fixes.yaml: an OSM fixes file of duckOSM ("" for none).
// levels: the drawing order, tags (the default), solve or none (docs/levels.md).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { initSync, build } from "./pkg/duckosm_wasm.js";

const [pbfPath, out, modes = "driving,walking,cycling", fixesPath, levels] = process.argv.slice(2);
const wasm = initSync({ module: readFileSync(new URL("./pkg/duckosm_wasm_bg.wasm", import.meta.url)) });
// WebAssembly memory only grows, so its size at the end is the peak.
const memory = () => `${(wasm.memory.buffer.byteLength / 2 ** 20).toFixed(0)} MiB wasm memory`;
const fixes = fixesPath ? readFileSync(fixesPath, "utf8") : undefined;
const t0 = performance.now();
let res;
try {
  res = build(readFileSync(pbfPath), modes, fixes, undefined, levels);
} catch (e) {
  console.error(`failed with ${memory()}: ${e}`);
  process.exit(1);
}
console.log(`${res.summary}\nin ${((performance.now() - t0) / 1000).toFixed(3)} s, ${memory()}`);
mkdirSync(out, { recursive: true });
for (const name of Object.keys(res.files)) {
  writeFileSync(`${out}/${name}`, Buffer.concat(res.files[name]));
}
