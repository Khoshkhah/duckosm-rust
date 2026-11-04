// Checks of app/design.js without a browser: node crates/duckosm-wasm/www/design_units.mjs
// The default design written into the look changes nothing; each theme and a profile make a look that roadstyle's module reads.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import init, { Look } from "./map/pkg/roadstyle_wasm.js";
import * as D from "./app/design.js";

await init({ module_or_path: readFileSync(new URL("./map/pkg/roadstyle_wasm_bg.wasm", import.meta.url)) });
const text = readFileSync(new URL("./map/look.json", import.meta.url), "utf8"), look = JSON.parse(text);
const base = D.defaultsOf(look);

assert.ok(JSON.stringify(D.applyToLook(look, base)) === JSON.stringify(look), "the default design changes nothing in the look");
assert.deepEqual(D.changes(base, base), []);
for (const t of D.THEMES) {
  const d = t.make(base), L = D.applyToLook(look, d);
  Look.fromJson(JSON.stringify(L)).free();                       // roadstyle reads the look
  assert.equal(L.roads.styles.classes.motorway[0].fill, d.roads.fill.motorway, `${t.id}: motorway fill`);
  assert.equal(L.roads.styles.classes.motorway[1].fill, d.roads.fill.motorway, `${t.id}: the link has the colour of its class`);
  assert.equal(L.base_map.style.areas.water.fill, d.base.water, `${t.id}: water`);
  assert.equal(L.labels.color, d.labels.color);
  if (t.id !== "light") assert.ok(D.changes(d, base).length > 10, `${t.id}: the theme changes the design`);
}
// a width factor scales the curve of its group only
const w = structuredClone(base); w.roads.width.major = 2;
const W = D.applyToLook(look, w);
assert.equal(W.roads.model.width.major["14"], look.roads.model.width.major["14"] * 2);
assert.equal(W.roads.model.width.primary["14"], look.roads.model.width.primary["14"]);
// labels and arrows
const x = structuredClone(base); x.labels.size = 2; x.labels.minzoom = 12; x.arrows.minzoom = 13; x.base.m_per_level = 5;
const X = D.applyToLook(look, x);
assert.equal(X.labels.base_size[0][1], look.labels.base_size[0][1] * 2);
assert.equal(X.labels.minzoom, 12); assert.equal(X.labels.minor_minzoom, 14); assert.equal(X.arrows.minor_minzoom, 14);
assert.equal(X.base_map.style.buildings_3d.m_per_level, 5);
// a design with wrong values is repaired, not thrown away
const bad = D.normalize({ name: "  ", roads: { fill: { motorway: "red", trunk: "#ABCDEF" }, width: { major: 99 } }, profile: { minzoom: 30, maxzoom: 2, extent: 3, maxTiles: "x", columns: ["name", "nope"] } }, base);
assert.equal(bad.name, "Light"); assert.equal(bad.roads.fill.motorway, base.roads.fill.motorway); assert.equal(bad.roads.fill.trunk, "#abcdef");
assert.equal(bad.roads.width.major, 4); assert.equal(bad.profile.minzoom, 18); assert.equal(bad.profile.maxzoom, 18); assert.equal(bad.profile.extent, 1024);
assert.equal(bad.profile.maxTiles, 40000); assert.deepEqual(bad.profile.columns, ["edge_id", "name"]);
// the file
const back = D.fromFile(D.toFile(D.THEMES[1].make(base)), base);
assert.deepEqual(back, D.normalize(D.THEMES[1].make(base), base));
assert.throws(() => D.fromFile("{}", base), /not a duckOSM design file/);
assert.throws(() => D.fromFile("x", base), /not JSON/);
assert.throws(() => D.fromFile(JSON.stringify({ format: D.FORMAT, version: 9 }), base), /version 9/);
// the profiles
for (const [id, p] of Object.entries(D.PROFILES)) assert.deepEqual(D.normalizeProfile(p.make()), p.make(), `profile ${id} is in range`);
console.log("design_units: passed");

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
console.log("design_units: tile writers passed");
