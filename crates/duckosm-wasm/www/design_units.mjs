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
// the boundary: the page's blue line is the default; each theme, the file and a repair keep it in range
assert.deepEqual(base.boundary, D.defaultBoundary());
assert.deepEqual(base.boundary, { show: true, color: "#2563eb", width: 2.5, dash: "solid", fill: "#2563eb", fillOpacity: 0.18, fillOnRoads: false });
for (const t of D.THEMES) { const d = t.make(base); assert.deepEqual(D.normalize(d, base).boundary, d.boundary, `${t.id}: the boundary is in range`); }
assert.equal(D.THEMES.find((t) => t.id === "print").make(base).boundary.color, "#000000");
const bb = D.normalize({ boundary: { show: 0, color: "blue", width: 99, dash: "wavy", fill: "#ABCDEF", fillOpacity: -1, fillOnRoads: 1 } }, base).boundary;
assert.deepEqual(bb, { show: false, color: "#2563eb", width: 8, dash: "solid", fill: "#abcdef", fillOpacity: 0, fillOnRoads: true });
assert.ok(JSON.stringify(D.applyToLook(look, { ...base, boundary: { ...base.boundary, color: "#000000", show: false } })) === JSON.stringify(look), "the boundary is not in the look");
assert.deepEqual(Object.keys(D.BOUNDARY_DASH), ["solid", "dashed", "dotted", "dash-dot"]);

// the themes are data: one plain object each, with every style value; the roads differ from theme to theme
assert.ok(D.THEME_DATA.length >= 13 && new Set(D.THEME_DATA.map((t) => t.id)).size === D.THEME_DATA.length, "ids are unique");
assert.deepEqual(D.THEME_DATA, JSON.parse(JSON.stringify(D.THEME_DATA)), "a theme is plain data (JSON)");
const sig = new Set();
for (const t of D.THEME_DATA) {
  if (!t.look) {
    assert.ok(["light", "dark", "print", "overlay", "roadstyle"].includes(t.group) && typeof t.dark === "boolean", `${t.id}: group and dark`);
    for (const k of ["fill", "casing"]) assert.ok(t.roadsOnly || t.roads[k]["*"], `${t.id}: roads.${k} has the key *`);
    if (t.roadsOnly) assert.ok(!t.base && !t.labels && D.CLASSES.filter((c) => t.roads.fill[c] && t.roads.casing[c]).length >= 10, `${t.id}: a road palette names its classes and has no base map`);
  }
  if (!t.look && !t.roadsOnly) {
    for (const k of ["fill", "casing"]) assert.ok(t.roads[k]["*"], `${t.id}: roads.${k} has the key *`);
    assert.ok(t.roads.width["*"] || D.GROUPS.every(([g]) => t.roads.width[g]), `${t.id}: width`);
    for (const k of ["color", "halo_color", "halo_width"]) assert.ok(k in t.labels, `${t.id}: labels.${k}`);
    assert.ok(t.arrows.color, `${t.id}: arrows.color`);
    for (const k of ["color", "width", "dash", "fill", "fillOpacity"]) assert.ok(k in t.boundary, `${t.id}: boundary.${k}`);
    for (const k of Object.keys(base.base).filter((x) => !["m_per_level", "max_height", "height_opacity"].includes(x))) assert.ok(t.base[k], `${t.id}: base.${k}`);
  }
  const d = D.makeTheme(base, t);
  assert.ok(D.normalize(d, base).roads.fill.primary === d.roads.fill.primary, `${t.id}: the colors are valid`);
  assert.deepEqual(d.profile, base.profile, `${t.id} keeps the profile`);
  sig.add(JSON.stringify(d.roads));
}
assert.equal(sig.size, D.THEME_DATA.length, "every theme has its own road colors");
// a road palette keeps the base map and the other values of the design that is on now; a base-map theme sets them
const nightD = D.makeTheme(base, D.THEME_DATA.find((t) => t.id === "night"));
const amberOnNight = D.makeTheme(base, D.THEME_DATA.find((t) => t.id === "amber"), nightD);
assert.deepEqual(amberOnNight.base, nightD.base); assert.deepEqual(amberOnNight.labels, nightD.labels);
assert.equal(amberOnNight.roads.fill.motorway, "#f28c28"); assert.equal(amberOnNight.roads.fill.pedestrian, nightD.roads.fill.pedestrian, "a class that the palette lacks keeps its color");
assert.equal(D.makeTheme(base, D.THEME_DATA.find((t) => t.id === "google"), nightD).base.background, "#f5f4f1");
assert.deepEqual(D.THEME_DATA.filter((t) => t.group === "roadstyle").map((t) => t.id), ["google", "grey", "roadstyle", "osmcarto", "amber", "cartoroads", "highsat", "monoroads"]);
assert.deepEqual(D.THEME_DATA.slice(0, 10).map((t) => t.id).slice(0, 2), ["light", "dark"], "Light and Dark are the first, the roadstyle themes come next");
// the ground and the layers
assert.deepEqual(base.ground, { transparent: false, opacity: 0 }); assert.equal(D.groundAlpha(base), 1);
assert.equal(D.groundAlpha({ ground: { transparent: true, opacity: 0.3 } }), 0.3);
assert.equal(base.visible.arrows, false); assert.equal(base.visible.railways, false); assert.equal(base.visible.buildings, true); assert.equal(base.visible.motorway, true);
assert.deepEqual(Object.keys(base.visible), D.VISIBLE_KEYS);
assert.equal(D.classGroup("motorway_link"), "motorway"); assert.equal(D.classGroup("ferry"), null); assert.equal(D.classGroup("footway"), "paths");
const ov = D.makeTheme(base, D.THEME_DATA.find((t) => t.id === "overlay"));
assert.equal(ov.ground.transparent, true); assert.equal(D.groundAlpha(ov), 0);
assert.ok(D.OVERLAY_KEYS.every((k) => ov.visible[k] === false) && ov.visible.names === true && ov.visible.primary === true && ov.visible.buildings3d === false, "the overlay hides every base-map layer and keeps the roads and the names");
assert.equal(D.normalize({ visible: { water: "no", buildings: false }, ground: { transparent: 1, opacity: 7 } }, base).visible.water, true);
assert.equal(D.normalize({ visible: { buildings: false }, ground: { transparent: 1, opacity: 7 } }, base).visible.buildings, false);
assert.deepEqual(D.normalize({ ground: { transparent: 1, opacity: 7 } }, base).ground, { transparent: true, opacity: 1 });
assert.deepEqual(D.PROFILES.roads.make().layers, { roads: true, base: false, edges: true });
assert.ok(JSON.stringify(D.applyToLook(look, { ...base, ground: { transparent: true, opacity: 0 }, visible: { ...base.visible, water: false } })) === JSON.stringify(look), "the ground and the layers are not in the look");

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

// the themes that a person saves (app/user_themes.js): a fake storage, a list in it
const UT = await import("./app/user_themes.js");
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
const st = mem();
assert.deepEqual(UT.readAll(st), []);
let mine = UT.put([], "My print", D.THEMES.find((t) => t.id === "print").make(base));
assert.equal(mine.length, 1); assert.equal(mine[0].id, "my-print"); assert.equal(mine[0].design.profile, undefined, "no tile profile unless asked"); assert.equal(mine[0].design.name, "My print");
assert.ok(UT.writeAll(mine, st)); assert.deepEqual(UT.readAll(st), mine, "the list is read back");
mine = UT.put(mine, "my PRINT", { ...base, roads: base.roads }, true);              // the same name (any case) replaces: one theme, the same id, the profile now kept
assert.equal(mine.length, 1); assert.equal(mine[0].id, "my-print"); assert.equal(mine[0].keepProfile, true); assert.ok(mine[0].design.profile);
mine = UT.put(mine, "Night 2", base);
assert.deepEqual(mine.map((t) => t.id), ["my-print", "night-2"]);
assert.equal(UT.put(mine, "Night!", base).find((t) => t.name === "Night!").id, "night", "an id is a slug of the name");
assert.equal(UT.put(UT.put([], "A b", base), "A-b", base).map((t) => t.id).join(), "a-b,a-b-2", "two names with one slug have two ids");
assert.throws(() => UT.put(mine, "  ", base), /Give the theme a name/); assert.throws(() => UT.put(mine, "x".repeat(41), base), /at most 40/);
assert.equal(UT.rename(mine, "night-2", "Evening").find((t) => t.id === "night-2").design.name, "Evening");
assert.throws(() => UT.rename(mine, "night-2", "my print"), /exists/); assert.doesNotThrow(() => UT.rename(mine, "night-2", "NIGHT 2"));
assert.deepEqual(UT.remove(mine, "my-print").map((t) => t.id), ["night-2"]);
assert.deepEqual(UT.readAll({ getItem: () => "{bad" }), []); assert.equal(UT.writeAll(mine, { setItem() { throw new Error("full"); } }), false);
// the file
const file = UT.toFile(mine);
assert.deepEqual(UT.fromFile(file), mine);
assert.throws(() => UT.fromFile("x"), /not JSON/); assert.throws(() => UT.fromFile("{}"), /not a duckOSM themes file/);
assert.throws(() => UT.fromFile(JSON.stringify({ format: UT.FILE_FORMAT, version: 9, themes: [] })), /version 9/);
assert.throws(() => UT.fromFile(JSON.stringify({ format: UT.FILE_FORMAT, version: 1, themes: [{ name: "x" }] })), /no theme in the file is complete/);
const merged = UT.merge(UT.put([], "Night 2", base), mine);
assert.deepEqual([merged.added, merged.replaced, merged.list.length], [1, 1, 2]);
console.log("design_units: your themes passed");

// the opacity of the roads: the defaults, the repair, the themes, and the expressions for roadstyle's road layers
assert.deepEqual(base.roads.opacity, { fill: 1, casing: 1, outline: false }); assert.equal(base.labels.halo_opacity, 1); assert.equal(base.arrows.opacity, 0.7);
const ov2 = D.normalize({ roads: { opacity: { fill: 9, casing: -1, outline: 1 } }, labels: { halo_opacity: "x" }, arrows: { opacity: 0.2 } }, base);
assert.deepEqual(ov2.roads.opacity, { fill: 1, casing: 0, outline: true }); assert.equal(ov2.labels.halo_opacity, 1); assert.equal(ov2.arrows.opacity, 0.2);
const T = (id) => D.makeTheme(base, D.THEME_DATA.find((t) => t.id === id));
assert.deepEqual(T("overlay").roads.opacity, { fill: 0.6, casing: 0.85, outline: true }); assert.deepEqual(T("overlaydark").roads.opacity, { fill: 0.6, casing: 0.85, outline: true });
assert.deepEqual(T("hollow").roads.opacity, { fill: 0, casing: 1, outline: true }); assert.deepEqual(T("ghost").roads.opacity, { fill: 0.35, casing: 0.7, outline: true });
assert.deepEqual(T("print").roads.opacity, { fill: 1, casing: 1, outline: false }, "a theme with no opacity has the default");
const nightHollow = D.makeTheme(base, D.THEME_DATA.find((t) => t.id === "amber"), T("hollow"));
assert.deepEqual(nightHollow.roads.opacity, T("hollow").roads.opacity, "a road palette keeps the opacity of the design");
const rowExpr = ["+", ["*", ["at", ["+", ["*", ["get", "__rs_k"], 8], 0], ["literal", [0, 1, 2]]], 13], 5];
const widthExpr = ["let", "row", rowExpr, ["interpolate", ["linear"], ["zoom"], 12, ["*", ["at", ["var", "row"], ["literal", [6, 4]]], 1], 14, ["*", ["at", ["var", "row"], ["literal", [12, 8]]], 1]]];
const opExpr = ["interpolate", ["linear"], ["zoom"], 14, ["case", ["==", ["get", "__rs_k"], 2], 0, 1], 17, 1];
const o1 = D.roadOpacity(opExpr, 0.4, 0.8);
assert.equal(o1[0], "interpolate"); assert.deepEqual(o1.slice(0, 4), ["interpolate", ["linear"], ["zoom"], 14]); assert.equal(o1[4][0], "*"); assert.equal(o1[6][0], "*");
assert.deepEqual(o1[4][2], ["case", ["==", ["get", "__rs_k"], 0], 0.8, ["==", ["get", "__rs_k"], 1], 0.4, 1], "casing at 0.8, fill at 0.4, other pieces as they are");
assert.deepEqual(D.roadOpacity(0.7, 0.5, 1)[0], "*"); assert.deepEqual(D.roadOpacity(undefined, 0.5, 1)[1], 1);
const out = D.roadOutline(widthExpr);
assert.equal(out.width[0], "let"); assert.equal(out.width.length, 6); assert.equal(out.width[3], "row1");
assert.ok(JSON.stringify(out.width[2]).includes("__rs_k") && !JSON.stringify(out.width[4]).includes("__rs_k"), "row has the kind of the piece; row1 has the kind 1 (the fill)");
assert.deepEqual(out.gap[5].slice(0, 4), ["interpolate", ["linear"], ["zoom"], 12], "the zoom stays at the top");
assert.equal(D.roadOutline(["literal", 3]), null); assert.equal(D.roadOutline(undefined), null);
assert.equal(D.withAlpha("#ff8000", 0.5), "rgba(255,128,0,0.5)");
