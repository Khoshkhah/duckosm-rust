// A check of the relay without Cloudflare: Node 24 has the fetch, Request and Response of a Worker. It asks Geofabrik for the
// Monaco extract (about 0.7 MB), so the computer needs the network.
//   node crates/duckosm-wasm/relay/check.mjs
import assert from "node:assert/strict";
import worker from "./worker.js";

const env = { ALLOWED_ORIGINS: "https://khoshkhah.github.io" };
const MONACO = "https://download.geofabrik.de/europe/monaco-latest.osm.pbf";
const ask = (url, origin, method = "GET", extra = {}) =>
  worker.fetch(new Request(`https://relay.example/?url=${encodeURIComponent(url)}`, { method, headers: { ...(origin ? { Origin: origin } : {}), ...extra } }), env);

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

// Range: the dated file of "latest" (Content-Location) answers 206 with Content-Range; the parts join to the whole file
assert.equal((await ask(MONACO, "http://localhost:8000", "GET", { Range: "bytes=0-1,5-9" })).status, 416, "more than one range");
assert.match(pre.headers.get("Access-Control-Allow-Headers"), /Range/);
const dated = head.headers.get("Content-Location");
assert.match(dated, /monaco-\d{6}\.osm\.pbf$/, "Content-Location");
assert.equal(head.headers.get("Accept-Ranges"), "bytes");
const half = Math.floor(size / 2);
const [p1, p2] = await Promise.all([[0, half - 1], [half, size - 1]].map(([a, b]) => ask(dated, "https://khoshkhah.github.io", "GET", { Range: `bytes=${a}-${b}` })));
assert.equal(p1.status, 206);
assert.equal(p1.headers.get("Content-Range"), `bytes 0-${half - 1}/${size}`);
assert.equal(p1.headers.get("ETag"), head.headers.get("ETag"), "the same version");
const joined = Buffer.concat([Buffer.from(await p1.arrayBuffer()), Buffer.from(await p2.arrayBuffer())]);
assert.ok(joined.equals(Buffer.from(bytes)), "the parts equal the whole file");
console.log(`relay: ok (Monaco ${size} bytes, ${r.headers.get("Last-Modified")})`);
