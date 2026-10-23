// A check of the relay without Cloudflare: Node 24 has the fetch, Request and Response of a Worker. It asks Geofabrik for the
// Monaco extract (about 0.7 MB), so the computer needs the network.
//   node crates/duckosm-wasm/relay/check.mjs
import assert from "node:assert/strict";
import worker from "./worker.js";

const env = { ALLOWED_ORIGINS: "https://khoshkhah.github.io" };
const MONACO = "https://download.geofabrik.de/europe/monaco-latest.osm.pbf";
const ask = (url, origin, method = "GET") =>
  worker.fetch(new Request(`https://relay.example/?url=${encodeURIComponent(url)}`, { method, headers: origin ? { Origin: origin } : {} }), env);

assert.equal((await ask(MONACO, "https://evil.example")).status, 403, "another page");
assert.equal((await ask(MONACO, null)).status, 403, "no Origin (not a browser page)");
assert.equal((await ask("https://example.com/x-latest.osm.pbf", "https://khoshkhah.github.io")).status, 400, "not Geofabrik");
assert.equal((await ask("https://download.geofabrik.de/index-v1.json", "http://localhost:8000")).status, 400, "not a .osm.pbf");
assert.equal((await ask(MONACO, "https://khoshkhah.github.io", "POST")).status, 405, "POST");
const pre = await ask(MONACO, "http://127.0.0.1:8000", "OPTIONS");
assert.equal(pre.status, 204);
assert.equal(pre.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:8000");

const head = await ask(MONACO, "https://khoshkhah.github.io", "HEAD");
assert.equal(head.status, 200);
const size = Number(head.headers.get("Content-Length"));
assert.ok(size > 100_000, "Content-Length");
const r = await ask(MONACO, "https://khoshkhah.github.io");
assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://khoshkhah.github.io");
assert.equal(r.headers.get("Cross-Origin-Resource-Policy"), "cross-origin");
const bytes = new Uint8Array(await r.arrayBuffer());
assert.equal(bytes.length, size, "the whole file");
assert.equal(new TextDecoder().decode(bytes.slice(6, 15)), "OSMHeader", "a PBF file");
console.log(`relay: ok (Monaco ${size} bytes, ${r.headers.get("Last-Modified")})`);
