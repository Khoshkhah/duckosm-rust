// Checks of the page's tile profile (app/profile.js) and the tile writers (app/export.js) without a browser: node crates/duckosm-wasm/www/profile_units.mjs
// Also: roadstyle's design model (map/roadstyle/dashboard/design/, build.sh copies it) on the page's look: the default design changes nothing, and each ready
// theme makes a look that roadstyle's module reads. roadstyle's own tests check the rest of the design model.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import init, { Look } from "./map/pkg/roadstyle_wasm.js";
import * as D from "./map/roadstyle/dashboard/design/design.js";
import * as P from "./app/profile.js";

await init({ module_or_path: readFileSync(new URL("./map/pkg/roadstyle_wasm_bg.wasm", import.meta.url)) });
const look = JSON.parse(readFileSync(new URL("./map/look.json", import.meta.url), "utf8"));
const hosts = [{ key: "profile", make: P.defaultProfile, normalize: P.normalizeProfile }];
const base = D.defaultsOf(look, hosts);
assert.ok(JSON.stringify(D.applyToLook(look, base)) === JSON.stringify(look), "the default design changes nothing in the page's look");
const themes = D.themesOf(JSON.parse(readFileSync(new URL("./map/roadstyle/dashboard/design/themes.json", import.meta.url), "utf8")).themes);
for (const t of themes) {
  const d = t.make(base);
  Look.fromJson(JSON.stringify(D.applyToLook(look, d))).free();     // roadstyle reads the look
  assert.deepEqual(d.profile, base.profile, `${t.id} keeps the tile profile`);
}
// an old design file of this page still loads, with its profile
const old = D.fromFile(JSON.stringify({ format: "duckosm-design", version: 1, name: "Old", profile: { ...P.defaultProfile(), preset: "web", maxzoom: 12 } }), base, hosts);
assert.equal(old.name, "Old"); assert.equal(old.profile.preset, "web"); assert.equal(old.profile.maxzoom, 12);

// the profile: the repair of wrong values, and each ready profile is in range
const bad = P.normalizeProfile({ minzoom: 30, maxzoom: 2, extent: 3, maxTiles: "x", columns: ["name", "nope"] });
assert.equal(bad.minzoom, 18); assert.equal(bad.maxzoom, 18); assert.equal(bad.extent, 1024);
assert.equal(bad.maxTiles, 40000); assert.deepEqual(bad.columns, ["edge_id", "name"]);
for (const [id, p] of Object.entries(P.PROFILES)) assert.deepEqual(P.normalizeProfile(p.make()), p.make(), `profile ${id} is in range`);
console.log("profile_units: passed");

// the tile writers take the profile: columns, extent and the zoom where a class starts; a layer can be left out of a tile
const EX = await import("./app/export.js"), M = await import("./app/mvt.js");
const feats = [
  { props: { edge_id: "1", highway: "motorway", name: "A", lanes: 2, driving: true, walking: false }, line: [[7.40, 43.73], [7.43, 43.75]] },
  { props: { edge_id: "2", highway: "residential", name: "B", lanes: 1, driving: true, walking: true }, line: [[7.41, 43.74], [7.42, 43.745]] },
];
const tiles = EX.edgeTiles(feats, 12, 13, { columns: ["edge_id", "highway"], modes: ["driving", "walking"], extent: 2048, classFrom: { motorway: 0, residential: 13 } });
const idsAt = (z) => [...tiles].filter(([k]) => k.startsWith(`${z}/`)).flatMap(([, b]) => M.decodeTile(b)).flatMap((l) => l.features.map((f) => l.values[f.tags[f.tags.indexOf(l.keys.indexOf("edge_id")) + 1]]));
assert.deepEqual([...new Set(idsAt(12))], ["1"], "the residential road starts at zoom 13");
assert.deepEqual([...new Set(idsAt(13))].sort(), ["1", "2"]);
const lay = M.decodeTile([...tiles.values()][0])[0];
assert.equal(lay.name, "edges"); assert.equal(lay.extent, 2048);
assert.deepEqual(lay.keys.slice().sort(), ["driving", "edge_id", "highway", "walking"], "only the chosen columns and the network flags");
const two = new Uint8Array([...M.encodeTile([{ name: "simple", extent: 4096, version: 2, keys: [], values: [], features: [] }]), ...M.encodeTile([{ name: "water", extent: 4096, version: 2, keys: [], values: [], features: [] }])]);
assert.deepEqual(M.decodeTile(EX.keepLayers(two, (n) => n !== "water")).map((l) => l.name), ["simple"]);
assert.deepEqual(M.decodeTile(EX.keepLayers(two, () => true)).map((l) => l.name), ["simple", "water"]);
console.log("profile_units: tile writers passed");
