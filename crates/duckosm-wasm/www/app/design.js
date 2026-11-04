// The design of the map (docs/dashboard.md, card 10): the style of the roads and the base map, and the profile of the tiles.
// This file has no page code, so Node can run it (design_units.mjs). A design is one plain object. It holds every value, not only the changes,
// so a design file does not depend on the look that it was made from.
//
//   style    roads (fill, casing, width factor), labels, arrows, base map (water, land, buildings, railways), 3D buildings, dark mode
//   profile  zoom range, layers, columns of the layer `edges`, the zoom where each road class starts, extent, buffer, tile limit, format
//
// The style is written into roadstyle's look (map/look.json, the sections of its version 2) with `applyToLook`. The map worker then makes the
// style and the tiles from that look, so the map and the tile export have the same design.

export const FORMAT = "duckosm-design";
export const VERSION = 1;

/** The road classes that have a colour of their own, in the order of the list on the page. */
export const CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service", "pedestrian", "cycleway", "footway", "path", "track"];
/** The width groups of roadstyle's road model (roads.model.group): a width factor is for a group. */
export const GROUPS = [
  ["major", "Motorway, trunk"], ["primary", "Primary"], ["secondary", "Secondary"], ["tertiary", "Tertiary"], ["residential", "Residential, unclassified"],
  ["living_street", "Living street"], ["service", "Service"], ["pedestrian", "Pedestrian"], ["path", "Footway, path, cycleway, track"],
];
export const GROUP_OF = { motorway: "major", trunk: "major", primary: "primary", secondary: "secondary", tertiary: "tertiary", unclassified: "residential", residential: "residential",
  living_street: "living_street", service: "service", pedestrian: "pedestrian", cycleway: "path", footway: "path", path: "path", track: "path" };
/** The land-use classes of the base map (base_map.style.areas.landcover) that one colour on the page covers. */
export const LAND = {
  green: ["forest", "wood", "grass", "grassland", "meadow", "park", "garden", "allotments", "shrubbery", "zoo", "scrub", "heath", "recreation_ground", "village_green", "nature_reserve", "golf_course", "playground", "dog_park", "flowerbed", "orchard", "vineyard"],
  built: ["default", "residential", "commercial", "retail", "industrial", "railway", "farmland", "farmyard", "garages", "greenfield", "quarry", "brownfield", "religious", "military", "prison", "construction"],
  sand: ["sand", "beach", "beach_resort"],
};
/** The columns of the layer `edges` (the networks of a road are flags, always in the layer). */
export const EDGE_COLUMNS = ["edge_id", "osm_id", "edge_ref", "name", "highway", "oneway", "lanes", "surface", "maxspeed_kmh", "bridge", "tunnel", "junction", "layer", "service", "access", "length_m", "cost_s", "source", "target"];
/** The zoom where each road class starts in the layer `edges` (a lower class is left out at a lower zoom). Other classes start at `OTHER_FROM`. */
export const CLASS_FROM = { motorway: 0, trunk: 0, primary: 0, secondary: 8, tertiary: 10, unclassified: 11, residential: 12, living_street: 12 };
export const OTHER_FROM = 13;
export const LIMITS = { zoom: [0, 18], extent: [1024, 8192], buffer: [0, 256], tiles: [1000, 200000] };

const clone = (x) => JSON.parse(JSON.stringify(x));
const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== "" ? +v : d);
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const COLOR = /^#[0-9a-f]{6}$/i;
const hex = (v, d) => (typeof v === "string" && COLOR.test(v) ? v.toLowerCase() : d);
/** A colour that the look holds (hex, short hex, or rgba) as #rrggbb; the page's colour input takes only this form. */
export function toHex(c) {
  if (typeof c !== "string") return null;
  if (COLOR.test(c)) return c.toLowerCase();
  const s = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (s) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  const r = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c);
  return r ? "#" + [r[1], r[2], r[3]].map((x) => (+x).toString(16).padStart(2, "0")).join("") : null;
}

// ---- the profile of the tiles ----

// The default is what the Export card did before the profile (the old "Everything"): the layer `edges` with every column, from zoom 0 to the highest zoom under the limit.
export const defaultProfile = () => ({
  preset: "analysis", minzoom: 0, maxzoom: 14, auto: true,       // auto: the highest zoom that keeps the tiles under the limit
  layers: { roads: true, base: true, edges: true },              // roadstyle's road layers, the base-map layers, the layer `edges` (all networks)
  columns: [...EDGE_COLUMNS], classFrom: { ...CLASS_FROM },
  extent: 4096, buffer: 64, maxTiles: 40000, format: "mlt",      // extent and buffer: in tile units; format: the format of the map's tiles (the files are MVT)
});
export const PROFILES = {
  web: { name: "Web map small", note: "The map as it is on the page. Zoom 0 to 14, the road and base-map layers, no layer edges. A small file.",
    make: () => ({ ...defaultProfile(), preset: "web", maxzoom: 14, auto: false, layers: { roads: true, base: true, edges: false } }) },
  analysis: { name: "Analysis", note: "Adds the layer edges: every road of every network with all its attributes. The highest zoom is the highest that fits the limit.",
    make: () => defaultProfile() },
  simulation: { name: "Simulation preview", note: "Zoom 10 and higher. Only the roads and the layer edges, with the columns that a simulation needs.",
    make: () => ({ ...defaultProfile(), preset: "simulation", minzoom: 10, maxzoom: 16, auto: true, layers: { roads: true, base: false, edges: true },
      columns: EDGE_COLUMNS.filter((c) => ["edge_id", "osm_id", "name", "highway", "oneway", "lanes", "maxspeed_kmh", "bridge", "tunnel", "length_m", "cost_s", "source", "target"].includes(c)),
      classFrom: Object.fromEntries(Object.keys(CLASS_FROM).map((c) => [c, 0])) }) },
};

/** A profile that has every field in its range: a file or a stored value may miss a field or hold a wrong one. */
export function normalizeProfile(p = {}) {
  const d = defaultProfile(), L = LIMITS;
  const minzoom = clamp(Math.round(num(p.minzoom, d.minzoom)), L.zoom);
  const columns = Array.isArray(p.columns) ? EDGE_COLUMNS.filter((c) => p.columns.includes(c)) : d.columns;
  return {
    preset: typeof p.preset === "string" ? p.preset : "custom", minzoom, maxzoom: Math.max(minzoom, clamp(Math.round(num(p.maxzoom, d.maxzoom)), L.zoom)), auto: p.auto ?? d.auto,
    layers: { roads: p.layers?.roads !== false, base: p.layers?.base !== false, edges: p.layers?.edges ?? d.layers.edges },
    columns: columns.includes("edge_id") ? columns : ["edge_id", ...columns], classFrom: Object.fromEntries(Object.keys(CLASS_FROM).map((c) => [c, clamp(Math.round(num(p.classFrom?.[c], CLASS_FROM[c])), L.zoom)])),
    extent: clamp(Math.round(num(p.extent, d.extent)), L.extent), buffer: clamp(Math.round(num(p.buffer, d.buffer)), L.buffer),
    maxTiles: clamp(Math.round(num(p.maxTiles, d.maxTiles)), L.tiles), format: p.format === "mvt" ? "mvt" : "mlt",
  };
}

// ---- the style: read from a look, written into a look ----

/** The design that a look (map/look.json, version 2) has now. */
export function defaultsOf(look) {
  const cls = look.roads.styles.classes, w = look.roads.model.width, areas = look.base_map.style.areas, lc = areas.landcover, b3 = look.base_map.style.buildings_3d;
  const first = (list) => toHex(lc[list.find((k) => lc[k])]) ?? "#e2ebd6";
  return {
    format: FORMAT, version: VERSION, name: "Light", theme: "light",
    roads: {
      fill: Object.fromEntries(CLASSES.map((c) => [c, toHex(cls[c]?.[0]?.fill) ?? "#ffffff"])),
      casing: Object.fromEntries(CLASSES.map((c) => [c, toHex(cls[c]?.[0]?.casing) ?? toHex(cls[c]?.[0]?.fill) ?? "#bbbbbb"])),
      width: Object.fromEntries(GROUPS.map(([g]) => [g, 1])),
    },
    labels: { color: toHex(look.labels.color) ?? "#5b5b5b", halo_color: toHex(look.labels.halo_color) ?? "#ffffff", halo_width: num(look.labels.halo_width, 0), minzoom: num(look.labels.minzoom, 14), size: 1 },
    arrows: { color: toHex(look.arrows.color) ?? "#5b5b5b", minzoom: num(look.arrows.minzoom, 15), size: 1 },
    base: {
      background: toHex(look.background.light) ?? "#e8e6e1", water: toHex(areas.water?.fill) ?? "#9ebdff", green: first(LAND.green), land: first(LAND.built), sand: first(LAND.sand),
      buildings: toHex(areas.buildings?.fill) ?? "#e5e2df", buildingLine: toHex(areas.buildings?.outline) ?? "#cdcac6",
      railways: toHex(look.base_map.style.lines?.railways?.color) ?? "#bbbbbb", waterways: toHex(look.base_map.style.lines?.waterways?.color) ?? "#a0c8f0",
      m_per_level: num(b3?.m_per_level, 3.66), max_height: num(b3?.max_height, 200), height_opacity: num(b3?.opacity, 0.9),
    },
    dark: { roads: [...look.dark.line.lightness], casing: [...look.dark.casing.lightness], areas: [...look.dark.area.lightness], labels: [...look.dark.label.lightness], background: toHex(look.background.dark) ?? "#0e1113" },
    profile: defaultProfile(),
  };
}

/** A design with every field right: the missing ones come from `base` (a design), the wrong ones are dropped. */
export function normalize(d, base) {
  const out = clone(base);
  if (!d || typeof d !== "object") return out;
  if (typeof d.name === "string" && d.name.trim()) out.name = d.name.trim().slice(0, 60);
  if (typeof d.theme === "string") out.theme = d.theme.slice(0, 30);
  for (const k of ["fill", "casing"]) for (const c of CLASSES) out.roads[k][c] = hex(d.roads?.[k]?.[c], out.roads[k][c]);
  for (const [g] of GROUPS) out.roads.width[g] = clamp(num(d.roads?.width?.[g], 1), [0.2, 4]);
  const l = d.labels ?? {};
  Object.assign(out.labels, { color: hex(l.color, out.labels.color), halo_color: hex(l.halo_color, out.labels.halo_color), halo_width: clamp(num(l.halo_width, out.labels.halo_width), [0, 4]),
    minzoom: clamp(Math.round(num(l.minzoom, out.labels.minzoom)), [0, 20]), size: clamp(num(l.size, 1), [0.5, 2]) });
  const a = d.arrows ?? {};
  Object.assign(out.arrows, { color: hex(a.color, out.arrows.color), minzoom: clamp(Math.round(num(a.minzoom, out.arrows.minzoom)), [0, 20]), size: clamp(num(a.size, 1), [0.5, 3]) });
  const b = d.base ?? {};
  for (const k of ["background", "water", "green", "land", "sand", "buildings", "buildingLine", "railways", "waterways"]) out.base[k] = hex(b[k], out.base[k]);
  Object.assign(out.base, { m_per_level: clamp(num(b.m_per_level, out.base.m_per_level), [1, 10]), max_height: clamp(num(b.max_height, out.base.max_height), [10, 500]),
    height_opacity: clamp(num(b.height_opacity, out.base.height_opacity), [0.1, 1]) });
  for (const k of ["roads", "casing", "areas", "labels"]) {
    const r = d.dark?.[k];
    if (Array.isArray(r) && r.length === 2 && r.every((x) => Number.isFinite(+x))) out.dark[k] = [clamp(+r[0], [0, 1]), clamp(+r[1], [0, 1])];
  }
  out.dark.background = hex(d.dark?.background, out.dark.background);
  out.profile = normalizeProfile(d.profile ?? out.profile);
  return out;
}

const scaleStops = (stops, f) => Object.fromEntries(Object.entries(stops).map(([z, v]) => [z, +(v * f).toFixed(3)]));

/**
 * The look (a version 2 look as an object) with the design written into it. The look is not changed: the result is a copy. The paths are those
 * that the engine reads: roads.styles.classes (the colours of a class, and of its link), roads.model.width (the width curve of a group),
 * labels, arrows, base_map.style (the base-map layers), dark and background. The profile is not in the look: roadstyle's tiles have the extent 4096.
 */
export function applyToLook(look, d) {
  const L = clone(look), base = defaultsOf(look);
  d = normalize(d, base);
  const diff = (a, b) => JSON.stringify(a) !== JSON.stringify(b);       // a value that the design did not change keeps what the look has (a group colour covers classes that differ)
  for (const c of CLASSES) {
    const g = GROUP_OF[c], f = d.roads.width[g] / base.roads.width[g];
    for (const s of L.roads.styles.classes[c] ?? []) {
      if (diff(d.roads.fill[c], base.roads.fill[c])) s.fill = d.roads.fill[c];
      if (s.casing != null && diff(d.roads.casing[c], base.roads.casing[c])) s.casing = d.roads.casing[c];
      if (f !== 1) for (const k of ["width", "casing_width"]) if (s[k] != null) s[k] = +(s[k] * f).toFixed(3);
    }
  }
  for (const [g] of GROUPS) {
    const f = d.roads.width[g] / base.roads.width[g];
    if (f !== 1 && L.roads.model.width[g]) L.roads.model.width[g] = scaleStops(L.roads.model.width[g], f);
    if (f !== 1 && L.roads.width?.[g]) L.roads.width[g] = scaleStops(L.roads.width[g], f);
  }
  const lb = L.labels, lo = look.labels, la = d.labels, ba = base.labels;
  for (const k of ["color", "halo_color", "halo_width"]) if (diff(la[k], ba[k])) lb[k] = la[k];
  if (la.minzoom !== ba.minzoom) { lb.minor_minzoom = (lo.minor_minzoom ?? 16) + (la.minzoom - ba.minzoom); lb.minzoom = la.minzoom; }
  if (la.size !== 1) lb.base_size = lo.base_size.map(([z, s]) => [z, +(s * la.size).toFixed(2)]);
  const ar = L.arrows, ao = look.arrows, aa = d.arrows;
  if (diff(aa.color, base.arrows.color)) ar.color = aa.color;
  if (aa.minzoom !== base.arrows.minzoom) { ar.minor_minzoom = (ao.minor_minzoom ?? 16) + (aa.minzoom - base.arrows.minzoom); ar.minzoom = aa.minzoom; }
  if (aa.size !== 1) { ar.size.base = +(ao.size.base * aa.size).toFixed(3); ar.size.stops = ao.size.stops.map(([z, s]) => [z, +(s * aa.size).toFixed(3)]); }
  const st = L.base_map.style, lc = st.areas.landcover, bs = d.base, b0 = base.base;
  if (diff(bs.water, b0.water)) for (const k of ["ocean", "water"]) if (st.areas[k]) st.areas[k].fill = bs.water;
  for (const [key, list] of Object.entries(LAND)) {
    const name = key === "built" ? "land" : key;
    if (diff(bs[name], b0[name])) for (const k of list) if (k in lc) lc[k] = bs[name];
  }
  if (st.areas.buildings) for (const [k, to] of [["buildings", "fill"], ["buildingLine", "outline"]]) if (diff(bs[k], b0[k])) st.areas.buildings[to] = bs[k];
  if (st.lines?.railways && diff(bs.railways, b0.railways)) st.lines.railways.color = bs.railways;
  if (st.lines?.waterways && diff(bs.waterways, b0.waterways)) st.lines.waterways.color = bs.waterways;
  for (const o of [st.buildings_3d, L.base_map.buildings_3d, st.areas.buildings_3d].filter(Boolean)) {
    for (const [k, to] of [["m_per_level", "m_per_level"], ["max_height", "max_height"], ["height_opacity", "opacity"]]) if (diff(bs[k], b0[k])) o[to] = bs[k];
  }
  if (diff(bs.background, b0.background)) L.background.light = bs.background;
  if (diff(d.dark.background, base.dark.background)) L.background.dark = d.dark.background;
  for (const [k, to] of [["roads", "line"], ["casing", "casing"], ["areas", "area"], ["labels", "label"]]) if (diff(d.dark[k], base.dark[k])) L.dark[to].lightness = d.dark[k];
  return L;
}

// ---- the ready themes ----

const paint = (base, over) => {
  const d = clone(base);
  for (const [k, v] of Object.entries(over)) {
    if (k === "roads") for (const [kk, vv] of Object.entries(v)) Object.assign(d.roads[kk], vv);
    else if (typeof v === "object" && !Array.isArray(v)) Object.assign(d[k], v);
    else d[k] = v;
  }
  return d;
};
const ALL = (v) => Object.fromEntries(CLASSES.map((c) => [c, v]));
const BY = (map, rest) => Object.fromEntries(CLASSES.map((c) => [c, map[c] ?? rest]));

/** The ready themes. `make(base)` gives a design from the design of the look (the Light theme is that design). */
export const THEMES = [
  { id: "light", name: "Light", note: "The look of the page: light roads with a casing on a light ground.", make: (b) => ({ ...clone(b), name: "Light", theme: "light" }) },
  { id: "dark", name: "Dark", note: "Dim roads and ground, light text. For a dark screen or a projector.", make: (b) => paint(b, {
    name: "Dark", theme: "dark",
    roads: { fill: BY({ motorway: "#e0a458", trunk: "#d6b36a", primary: "#c9b98a", secondary: "#9aa7b4", tertiary: "#8793a0", cycleway: "#4f9a6a" }, "#6b7683"),
      casing: ALL("#14181c"), width: Object.fromEntries(GROUPS.map(([g]) => [g, 1])) },
    labels: { color: "#d8dde3", halo_color: "#12161a", halo_width: 1.5 }, arrows: { color: "#c6ccd3" },
    base: { background: "#1b1f24", water: "#1d3a56", green: "#233427", land: "#20252b", sand: "#3a3a2e", buildings: "#2d333a", buildingLine: "#3a424a", railways: "#6b7280", waterways: "#2b5278" } }) },
  { id: "traffic", name: "Traffic", note: "Quiet grey roads and a pale ground. The colours of flow or speed stand out.", make: (b) => paint(b, {
    name: "Traffic", theme: "traffic",
    roads: { fill: BY({ motorway: "#8d939a", trunk: "#9a9fa6", primary: "#a6abb1", secondary: "#b3b7bc" }, "#c5c8cc"), casing: ALL("#9ea2a8"),
      width: Object.fromEntries(GROUPS.map(([g]) => [g, ["major", "primary", "secondary"].includes(g) ? 1.15 : 1])) },
    labels: { color: "#6b7078", halo_color: "#ffffff", halo_width: 1.2 }, arrows: { color: "#6b7078" },
    base: { background: "#eeeeec", water: "#cfdce8", green: "#e5e9df", land: "#f3f3f1", sand: "#ecebe3", buildings: "#e3e3e1", buildingLine: "#d3d3d0", railways: "#c2c4c7", waterways: "#bfd0e0" } }) },
  { id: "print", name: "Print", note: "White ground, dark outlines, black text. Roads are wider. Good on paper.", make: (b) => paint(b, {
    name: "Print", theme: "print",
    roads: { fill: BY({ motorway: "#f4b183", trunk: "#f8cbad", primary: "#fff2cc", secondary: "#ffffff", cycleway: "#c9dcf0" }, "#ffffff"), casing: ALL("#3a3a3a"),
      width: Object.fromEntries(GROUPS.map(([g]) => [g, 1.25])) },
    labels: { color: "#000000", halo_color: "#ffffff", halo_width: 2 }, arrows: { color: "#000000" },
    base: { background: "#ffffff", water: "#d4e6f6", green: "#e8f1de", land: "#fafafa", sand: "#f6f0d6", buildings: "#dcdcdc", buildingLine: "#8a8a8a", railways: "#000000", waterways: "#9cc3e6" } }) },
];

// ---- the design file ----

/** The text of a design file. */
export const toFile = (d) => JSON.stringify({ ...d, format: FORMAT, version: VERSION }, null, 2);
/** A design from the text of a file, on top of `base`. An error is thrown with a message for the person. */
export function fromFile(text, base) {
  let o;
  try { o = JSON.parse(text); } catch (e) { throw new Error("the file is not JSON"); }
  if (o?.format !== FORMAT) throw new Error("the file is not a duckOSM design file");
  if (!(o.version <= VERSION)) throw new Error(`the file has version ${o.version}; this page reads version ${VERSION} and lower`);
  return normalize(o, base);
}
/** The differences between a design and its base, as a list of paths (for the count on the tab). */
export function changes(d, base) {
  const out = [];
  const walk = (a, b, p) => {
    if (a && typeof a === "object") for (const k of Object.keys(a)) walk(a[k], b?.[k], p ? `${p}.${k}` : k);
    else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(p);
  };
  walk(d, base, "");
  return out;
}
