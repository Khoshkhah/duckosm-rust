// The design of the map (docs/dashboard.md, card 9): the style of the roads and the base map, and the profile of the tiles.
// This file has no page code, so Node can run it (design_units.mjs). A design is one plain object. It holds every value, not only the changes,
// so a design file does not depend on the look that it was made from.
//
//   style    roads (fill, casing, width factor), labels, arrows, base map (water, land, buildings, railways), 3D buildings, dark mode
//   boundary the line and the fill of the boundary of the area on the map: `design.boundary` = {show, color, width, dash, fill, fillOpacity, fillOnRoads}.
//            It is not in the look (the page paints its layers `area-line`, `area-casing` and `area-fill`), so a change draws no new map.
//            Other modules (the PNG and SVG exports) read this one object. `dash` is a key of BOUNDARY_DASH.
//   ground   `design.ground` = {transparent, opacity}: the ground of the map (roadstyle's layer `bg`). The alpha of the ground is `groundAlpha(design)`:
//            1 when `transparent` is off, else `opacity` (0 to 1; 0 is fully transparent). A picture export gives no background rectangle at alpha 0.
//   visible  `design.visible` = one boolean for each layer that the map can show (VISIBLE_GROUPS): the road groups, bridges, tunnels, arrows, names, the
//            3D buildings, and the base-map layers. It is the state of roadstyle's switches too (the page calls rsSetOverlay, rsSetClasses and the others, and
//            reads roadstyle's events), so there is one state in two places. The boundary has its own `boundary.show`.
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
/** The dash styles of the boundary line: the pattern in multiples of the line width (MapLibre's `line-dasharray`), or null for a solid line. */
export const BOUNDARY_DASH = { solid: null, dashed: [3, 2], dotted: [1, 1.5], "dash-dot": [4, 1.5, 1, 1.5] };
/** The boundary of the page before the design card: a solid blue line of 2.5 px on a white casing, a blue fill of 0.18 that shows only before the roads are drawn. */
export const defaultBoundary = () => ({ show: true, color: "#2563eb", width: 2.5, dash: "solid", fill: "#2563eb", fillOpacity: 0.18, fillOnRoads: false });
/** The road classes of each switch of `visible` (a class with `_link` is in the group of its main class). A class that is in no group (ferry, raceway) always shows. */
export const ROAD_GROUPS = {
  motorway: ["motorway", "trunk"], primary: ["primary"], secondary: ["secondary"], tertiary: ["tertiary"],
  residential: ["unclassified", "residential", "living_street", "road", "busway"], service: ["service"],
  paths: ["pedestrian", "footway", "path", "steps", "track", "bridleway", "corridor", "platform", "construction"], cycleway: ["cycleway"],
};
export const classGroup = (c) => { const m = String(c).replace(/_link$/, ""); return Object.keys(ROAD_GROUPS).find((g) => ROAD_GROUPS[g].includes(m)) ?? null; };
/** The base-map layers (the labels of roadstyle's overlays, `rsSetOverlay(label, on)`). */
export const OVERLAY_KEYS = ["landcover", "water", "waterways", "paved", "buildings", "raceway", "other_ways", "railways", "parking", "parking_p", "platform", "traffic_signals", "crossings", "bus_stations", "train_stations", "bicycle"];
/** The switches of `design.visible`, by section, with their names on the page. */
export const VISIBLE_GROUPS = [
  ["Roads", [["motorway", "Motorway and trunk"], ["primary", "Primary"], ["secondary", "Secondary"], ["tertiary", "Tertiary"], ["residential", "Residential and below"], ["service", "Service"], ["paths", "Paths and footways"], ["cycleway", "Cycleways"]]],
  ["On the roads", [["bridges", "Bridges"], ["tunnels", "Tunnels"], ["arrows", "One-way arrows"], ["names", "Street names"]]],
  ["Base map", [["buildings", "Buildings"], ["buildings3d", "3D buildings"], ["landcover", "Land use (green and built-up)"], ["water", "Water"], ["waterways", "Waterways"], ["paved", "Paved areas"], ["railways", "Railways"], ["raceway", "Race tracks"], ["other_ways", "Other ways"], ["platform", "Platforms"], ["parking", "Parking areas"]]],
  ["Points", [["parking_p", "Parking"], ["bus_stations", "Bus stops"], ["train_stations", "Train stations"], ["bicycle", "Bicycle points"], ["traffic_signals", "Traffic signals"], ["crossings", "Crossings"]]],
];
export const VISIBLE_KEYS = VISIBLE_GROUPS.flatMap(([, rows]) => rows.map(([k]) => k));
/** The layers at the first visit: the roads, bridges, tunnels and names show; the arrows and the 3D buildings are off (the page's first visit); a base-map layer is on unless the look unticks it (railways, points). */
export function defaultVisible(look) {
  const ticked = Object.fromEntries((look?.base_map?.layers_yaml?.layers ?? []).map((l) => [l.name, l.ticked !== false]));
  return Object.fromEntries(VISIBLE_KEYS.map((k) => [k, k === "arrows" || k === "buildings3d" ? false : OVERLAY_KEYS.includes(k) ? ticked[k] ?? true : true]));
}
export const defaultGround = () => ({ transparent: false, opacity: 0 });
/** The alpha of the ground of the map (roadstyle's layer `bg`): 1, or the opacity when the ground is transparent. */
export const groundAlpha = (d) => (d.ground.transparent ? d.ground.opacity : 1);
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
  roads: { name: "Roads only", note: "The road layers and the layer edges, and no base-map layer. The file is smaller, and nothing in it hides a base map under it.",
    make: () => ({ ...defaultProfile(), preset: "roads", layers: { roads: true, base: false, edges: true } }) },
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
    boundary: defaultBoundary(), ground: defaultGround(), visible: defaultVisible(look),
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
  const bd = d.boundary ?? {};
  out.boundary = {
    show: bd.show ?? out.boundary.show, color: hex(bd.color, out.boundary.color), width: clamp(num(bd.width, out.boundary.width), [0.5, 8]),
    dash: Object.hasOwn(BOUNDARY_DASH, bd.dash) ? bd.dash : out.boundary.dash, fill: hex(bd.fill, out.boundary.fill),
    fillOpacity: clamp(num(bd.fillOpacity, out.boundary.fillOpacity), [0, 1]), fillOnRoads: bd.fillOnRoads ?? out.boundary.fillOnRoads,
  };
  out.boundary.show = !!out.boundary.show; out.boundary.fillOnRoads = !!out.boundary.fillOnRoads;
  out.ground = { transparent: !!(d.ground?.transparent ?? out.ground.transparent), opacity: clamp(num(d.ground?.opacity, out.ground.opacity), [0, 1]) };
  out.visible = Object.fromEntries(VISIBLE_KEYS.map((k) => [k, typeof d.visible?.[k] === "boolean" ? d.visible[k] : out.visible[k]]));
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
// A theme is one plain object (data, no code). It sets every style value: the fill and the casing of the road classes, the width of the groups, the text, the arrows,
// the boundary and the colors of the base map. In a map of classes (`fill`, `casing`, `width`) the key "*" is the value of every class that is not named.
// The Light theme has `look: true`: it is the design of the look itself. A theme keeps the tile profile and the dark ranges of the page.

const PASSIVE = { "*": 1 };
export const THEME_DATA = [
  { id: "light", name: "Light", look: true, note: "The look of the page: light roads with a casing on a light ground." },
  { id: "dark", name: "Dark", note: "Dim roads and ground, light text. For a dark screen or a projector.",
    roads: { fill: { motorway: "#e0a458", trunk: "#d6b36a", primary: "#c9b98a", secondary: "#9aa7b4", tertiary: "#8793a0", cycleway: "#4f9a6a", "*": "#6b7683" }, casing: { "*": "#14181c" }, width: PASSIVE },
    labels: { color: "#d8dde3", halo_color: "#12161a", halo_width: 1.5 }, arrows: { color: "#c6ccd3" },
    boundary: { color: "#7cc4ff", width: 2.5, dash: "solid", fill: "#7cc4ff", fillOpacity: 0.12 },
    base: { background: "#1b1f24", water: "#1d3a56", green: "#233427", land: "#20252b", sand: "#3a3a2e", buildings: "#2d333a", buildingLine: "#3a424a", railways: "#6b7280", waterways: "#2b5278" } },
  { id: "traffic", name: "Traffic", note: "Quiet grey roads and a pale ground. The colors of flow or speed stand out.",
    roads: { fill: { motorway: "#8d939a", trunk: "#9a9fa6", primary: "#a6abb1", secondary: "#b3b7bc", "*": "#c5c8cc" }, casing: { "*": "#9ea2a8" }, width: { major: 1.15, primary: 1.15, secondary: 1.15, "*": 1 } },
    labels: { color: "#6b7078", halo_color: "#ffffff", halo_width: 1.2 }, arrows: { color: "#6b7078" },
    boundary: { color: "#1d4ed8", width: 2, dash: "dashed", fill: "#1d4ed8", fillOpacity: 0.1 },
    base: { background: "#eeeeec", water: "#cfdce8", green: "#e5e9df", land: "#f3f3f1", sand: "#ecebe3", buildings: "#e3e3e1", buildingLine: "#d3d3d0", railways: "#c2c4c7", waterways: "#bfd0e0" } },
  { id: "print", name: "Print", note: "White ground, dark outlines, black text. Roads are wider. Good on paper.",
    roads: { fill: { motorway: "#f4b183", trunk: "#f8cbad", primary: "#fff2cc", cycleway: "#c9dcf0", "*": "#ffffff" }, casing: { "*": "#3a3a3a" }, width: { "*": 1.25 } },
    labels: { color: "#000000", halo_color: "#ffffff", halo_width: 2 }, arrows: { color: "#000000" },
    boundary: { color: "#000000", width: 1.5, dash: "dashed", fill: "#000000", fillOpacity: 0 },
    base: { background: "#ffffff", water: "#d4e6f6", green: "#e8f1de", land: "#fafafa", sand: "#f6f0d6", buildings: "#dcdcdc", buildingLine: "#8a8a8a", railways: "#000000", waterways: "#9cc3e6" } },
  { id: "pastel", name: "Pastel", note: "Soft colors and thin casings. For slides and posters on a screen.",
    roads: { fill: { motorway: "#f7b6c2", trunk: "#f9c9a8", primary: "#fbe3a1", secondary: "#fff3c4", tertiary: "#d6ecc0", cycleway: "#b6d4f2", footway: "#f2cfd3", path: "#f2cfd3", track: "#e6dcc9", "*": "#ffffff" }, casing: { "*": "#ddd6d0" }, width: { "*": 0.85 } },
    labels: { color: "#7a6f78", halo_color: "#ffffff", halo_width: 1.5 }, arrows: { color: "#9a8f99" },
    boundary: { color: "#c78fd6", width: 2, dash: "solid", fill: "#c78fd6", fillOpacity: 0.12 },
    base: { background: "#f6f1ec", water: "#cfe6f5", green: "#e1f1d6", land: "#faf6f2", sand: "#f8efd2", buildings: "#efe3df", buildingLine: "#e0d0cb", railways: "#cfc6c0", waterways: "#bcdcf0" } },
  { id: "blueprint", name: "Blueprint", note: "A dark blue ground with white and light blue lines.",
    roads: { fill: { motorway: "#ffffff", trunk: "#e6f2ff", primary: "#cfe6fb", secondary: "#b3d6f5", tertiary: "#96c3ee", cycleway: "#8fd3ff", footway: "#4f8fc6", path: "#4f8fc6", track: "#4f8fc6", "*": "#6fa8dc" }, casing: { "*": "#1d5d94" }, width: { "*": 0.9 } },
    labels: { color: "#e8f3ff", halo_color: "#0b2a4a", halo_width: 1.5 }, arrows: { color: "#cfe6fb" },
    boundary: { color: "#ffffff", width: 2, dash: "dashed", fill: "#ffffff", fillOpacity: 0.06 },
    base: { background: "#0b2a4a", water: "#0e3a63", green: "#10375c", land: "#0d2f52", sand: "#123d66", buildings: "#14406b", buildingLine: "#5aa0d8", railways: "#7fb7e6", waterways: "#2a6aa3" } },
  { id: "night", name: "Night", note: "A very dark ground, dim small roads and bright main roads. For a screen in a dark room.",
    roads: { fill: { motorway: "#ffb347", trunk: "#ffc76a", primary: "#ffe08a", secondary: "#9fb3c8", tertiary: "#7e8fa1", cycleway: "#46a36b", footway: "#5a6169", path: "#5a6169", track: "#5a6169", "*": "#4a525b" }, casing: { "*": "#0b0c0e" }, width: PASSIVE },
    labels: { color: "#aab2bb", halo_color: "#0b0c0e", halo_width: 1.5 }, arrows: { color: "#8b95a1" },
    boundary: { color: "#4da3ff", width: 2.5, dash: "solid", fill: "#4da3ff", fillOpacity: 0.1 },
    base: { background: "#121417", water: "#16222e", green: "#17211b", land: "#16181b", sand: "#25241d", buildings: "#1e2125", buildingLine: "#2a2e33", railways: "#4a4f57", waterways: "#1f3a52" } },
  { id: "minimal", name: "Minimal gray", note: "Gray roads of one color. Only the width shows the class. For data on top: flow, speed.",
    roads: { fill: { "*": "#b5b5b5" }, casing: { "*": "#9a9a9a" }, width: { major: 1.4, primary: 1.2, secondary: 1.1, tertiary: 1, residential: 0.9, living_street: 0.8, service: 0.7, pedestrian: 0.7, path: 0.6 } },
    labels: { color: "#7a7a7a", halo_color: "#f2f2f2", halo_width: 1.2 }, arrows: { color: "#7a7a7a" },
    boundary: { color: "#555555", width: 1.5, dash: "dashed", fill: "#555555", fillOpacity: 0.04 },
    base: { background: "#f2f2f2", water: "#e6e6e6", green: "#eeeeee", land: "#f5f5f5", sand: "#efefef", buildings: "#e9e9e9", buildingLine: "#dcdcdc", railways: "#cccccc", waterways: "#dddddd" } },
  { id: "contrast", name: "High contrast", note: "A white ground, black casings, bright fills, wide roads and large text. For easy reading.",
    roads: { fill: { motorway: "#ff1744", trunk: "#ff9100", primary: "#ffea00", secondary: "#00e5ff", tertiary: "#76ff03", cycleway: "#2979ff", footway: "#ff4081", path: "#ff4081", track: "#b26a00", "*": "#ffffff" }, casing: { "*": "#000000" }, width: { "*": 1.4 } },
    labels: { color: "#000000", halo_color: "#ffffff", halo_width: 2.5, size: 1.3 }, arrows: { color: "#000000", size: 1.4 },
    boundary: { color: "#000000", width: 4, dash: "solid", fill: "#000000", fillOpacity: 0 },
    base: { background: "#ffffff", water: "#a9d4ff", green: "#c6f0b2", land: "#ffffff", sand: "#fff2a8", buildings: "#d9d9d9", buildingLine: "#000000", railways: "#000000", waterways: "#4aa3ff" } },
  { id: "colorblind", name: "Colorblind safe", note: "The Okabe-Ito colors. They stay clear for red-green color blindness.",
    roads: { fill: { motorway: "#d55e00", trunk: "#e69f00", primary: "#f0e442", secondary: "#56b4e9", tertiary: "#0072b2", cycleway: "#009e73", footway: "#cc79a7", path: "#cc79a7", track: "#999999", "*": "#ffffff" }, casing: { "*": "#4d4d4d" }, width: PASSIVE },
    labels: { color: "#222222", halo_color: "#ffffff", halo_width: 1.5 }, arrows: { color: "#222222" },
    boundary: { color: "#0072b2", width: 2.5, dash: "solid", fill: "#0072b2", fillOpacity: 0.12 },
    base: { background: "#f5f5f5", water: "#cfe3f3", green: "#dcebd5", land: "#fafafa", sand: "#f5efd0", buildings: "#e5e5e5", buildingLine: "#cfcfcf", railways: "#888888", waterways: "#9cc7e6" } },
  { id: "vintage", name: "Vintage", note: "A sepia ground and brown roads. For posters.",
    roads: { fill: { motorway: "#b5572b", trunk: "#c27a3a", primary: "#d19a5b", secondary: "#dcb77f", tertiary: "#e6cc9c", cycleway: "#8a7a3a", footway: "#a9865a", path: "#a9865a", track: "#a9865a", "*": "#f3e8d0" }, casing: { "*": "#6b4f3a" }, width: { "*": 1.05 } },
    labels: { color: "#5a3f2a", halo_color: "#f3e8d0", halo_width: 1.8 }, arrows: { color: "#6b4f3a" },
    boundary: { color: "#7a3b1d", width: 2.5, dash: "dash-dot", fill: "#7a3b1d", fillOpacity: 0.08 },
    base: { background: "#e9dcc0", water: "#b9c9c4", green: "#cdc79a", land: "#eee0c3", sand: "#e8d6a8", buildings: "#d9c4a0", buildingLine: "#b39b78", railways: "#6b4f3a", waterways: "#9fb5ae" } },
  { id: "overlay", name: "Roads overlay", note: "Only the roads, with a transparent ground. Strong colors and a dark casing, for a light map, a dark map, a satellite map or 3D buildings under it.",
    roads: { fill: { motorway: "#ff7a00", trunk: "#ff9f1a", primary: "#ffc400", secondary: "#ffe14d", tertiary: "#ffffff", cycleway: "#00b36b", footway: "#ff6fa5", path: "#ff6fa5", track: "#c08a4a", "*": "#ffffff" }, casing: { "*": "#1a1a1a" }, width: { "*": 1.15 } },
    labels: { color: "#111111", halo_color: "#ffffff", halo_width: 2.5 }, arrows: { color: "#111111" },
    boundary: { show: false, color: "#ffffff", width: 2, dash: "solid", fill: "#ffffff", fillOpacity: 0 },
    base: { background: "#808080", water: "#808080", green: "#808080", land: "#808080", sand: "#808080", buildings: "#808080", buildingLine: "#808080", railways: "#808080", waterways: "#808080" },
    ground: { transparent: true, opacity: 0 }, visible: { buildings: false, buildings3d: false, landcover: false, water: false, waterways: false, paved: false, railways: false, raceway: false, other_ways: false, platform: false, parking: false, parking_p: false, bus_stations: false, train_stations: false, bicycle: false, traffic_signals: false, crossings: false } },
  { id: "overlaydark", name: "Roads overlay, dark", note: "The same overlay with light roads and a dark casing. For a dark map or a satellite map under it.",
    roads: { fill: { motorway: "#ffd166", trunk: "#ffe08a", primary: "#fff1b8", secondary: "#e6f0ff", tertiary: "#cfe3ff", cycleway: "#7bf2b2", footway: "#ffb3d1", path: "#ffb3d1", track: "#e0c9a6", "*": "#f5f5f5" }, casing: { "*": "#101418" }, width: { "*": 1.15 } },
    labels: { color: "#f5f5f5", halo_color: "#101418", halo_width: 2.5 }, arrows: { color: "#f5f5f5" },
    boundary: { show: false, color: "#ffffff", width: 2, dash: "solid", fill: "#ffffff", fillOpacity: 0 },
    base: { background: "#808080", water: "#808080", green: "#808080", land: "#808080", sand: "#808080", buildings: "#808080", buildingLine: "#808080", railways: "#808080", waterways: "#808080" },
    ground: { transparent: true, opacity: 0 }, visible: { buildings: false, buildings3d: false, landcover: false, water: false, waterways: false, paved: false, railways: false, raceway: false, other_ways: false, platform: false, parking: false, parking_p: false, bus_stations: false, train_stations: false, bicycle: false, traffic_signals: false, crossings: false } },
  { id: "osm", name: "OSM like", note: "The colors of the standard OpenStreetMap map.",
    roads: { fill: { motorway: "#e892a2", trunk: "#f9b29c", primary: "#fcd6a4", secondary: "#f7fabf", living_street: "#ededed", pedestrian: "#dddde8", cycleway: "#5c7cb6", footway: "#fa8072", path: "#fa8072", track: "#9e7b54", "*": "#ffffff" },
      casing: { motorway: "#dc2a48", trunk: "#c84e2f", primary: "#a06b00", secondary: "#707d00", living_street: "#cccccc", pedestrian: "#8f8f8f", cycleway: "#5c7cb6", footway: "#fa8072", path: "#fa8072", track: "#9e7b54", "*": "#bbbbbb" }, width: PASSIVE },
    labels: { color: "#333333", halo_color: "#ffffff", halo_width: 1.5 }, arrows: { color: "#555555" },
    boundary: { color: "#6a0dad", width: 2, dash: "dotted", fill: "#6a0dad", fillOpacity: 0 },
    base: { background: "#f2efe9", water: "#aad3df", green: "#cdebb0", land: "#f2efe9", sand: "#f5e9c6", buildings: "#d9d0c9", buildingLine: "#bbaaa4", railways: "#999999", waterways: "#aad3df" } },
];

const expand = (map, keys) => Object.fromEntries(keys.map((k) => [k, map[k] ?? map["*"]]));
/** The design of a theme (an object of THEME_DATA) on top of `b`, the design of the look: it has every style value, and keeps the profile and the dark ranges of `b`. */
export function makeTheme(b, t) {
  const d = clone(b);
  d.name = t.name; d.theme = t.id;
  if (t.look) return d;
  d.roads = { fill: expand(t.roads.fill, CLASSES), casing: expand(t.roads.casing, CLASSES), width: expand(t.roads.width, GROUPS.map(([g]) => g)) };
  Object.assign(d.labels, t.labels); Object.assign(d.arrows, t.arrows); Object.assign(d.boundary, t.boundary); Object.assign(d.base, t.base);
  Object.assign(d.ground, t.ground); Object.assign(d.visible, t.visible);          // a theme names the layers that it hides (visible: false) and the ground that it makes transparent
  return d;
}
/** The ready themes, for the panel: `make(base)` gives the design of a theme. */
export const THEMES = THEME_DATA.map((t) => ({ id: t.id, name: t.name, note: t.note, make: (b) => makeTheme(b, t) }));

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
