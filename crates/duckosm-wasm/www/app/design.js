// The design of the map (docs/dashboard.md, card 9): the style of the roads and the base map, and the profile of the tiles.
// This file has no page code, so Node can run it (design_units.mjs). A design is one plain object. It holds every value, not only the changes,
// so a design file does not depend on the look that it was made from.
//
//   style    roads (fill, casing, width factor), labels, arrows, base map (water, land, buildings, railways), 3D buildings, dark mode
//   boundary the line and the fill of the boundary of the area on the map: `design.boundary` = {show, color, width, dash, fill, fillOpacity, fillOnRoads}.
//            It is not in the look (the page paints its layers `area-line`, `area-casing` and `area-fill`), so a change draws no new map.
//            Other modules (the PNG and SVG exports) read this one object. `dash` is a key of BOUNDARY_DASH.
//   opacity  `design.roads.opacity` = {fill, casing, outline}: the opacity of the road fill and of the road casing (0 to 1, a factor of the style's own), and `outline`: the
//            casing is drawn only outside the fill, so a transparent fill shows the map under it. `design.labels.halo_opacity` and `design.arrows.opacity` are the opacity of the
//            text halo and of the arrows. They are not in the look: the page writes them into the paint of the road layers (`roadOpacity`, `roadOutline`), so a change draws no new map.
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
export const defaultRoadOpacity = () => ({ fill: 1, casing: 1, outline: false });
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
      opacity: defaultRoadOpacity(),
    },
    labels: { color: toHex(look.labels.color) ?? "#5b5b5b", halo_color: toHex(look.labels.halo_color) ?? "#ffffff", halo_width: num(look.labels.halo_width, 0), halo_opacity: 1, minzoom: num(look.labels.minzoom, 14), size: 1 },
    arrows: { color: toHex(look.arrows.color) ?? "#5b5b5b", opacity: num(look.arrows.opacity, 0.7), minzoom: num(look.arrows.minzoom, 15), size: 1 },
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
  const ro = d.roads?.opacity ?? {};
  out.roads.opacity = { fill: clamp(num(ro.fill, out.roads.opacity.fill), [0, 1]), casing: clamp(num(ro.casing, out.roads.opacity.casing), [0, 1]), outline: !!(ro.outline ?? out.roads.opacity.outline) };
  const l = d.labels ?? {};
  Object.assign(out.labels, { color: hex(l.color, out.labels.color), halo_color: hex(l.halo_color, out.labels.halo_color), halo_width: clamp(num(l.halo_width, out.labels.halo_width), [0, 4]), halo_opacity: clamp(num(l.halo_opacity, out.labels.halo_opacity), [0, 1]),
    minzoom: clamp(Math.round(num(l.minzoom, out.labels.minzoom)), [0, 20]), size: clamp(num(l.size, 1), [0.5, 2]) });
  const a = d.arrows ?? {};
  Object.assign(out.arrows, { opacity: clamp(num(a.opacity, out.arrows.opacity), [0, 1]), color: hex(a.color, out.arrows.color), minzoom: clamp(Math.round(num(a.minzoom, out.arrows.minzoom)), [0, 20]), size: clamp(num(a.size, 1), [0.5, 3]) });
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

// ---- the opacity of the roads: expressions for the paint of roadstyle's road layers ----
// roadstyle's road layer draws the casing (`__rs_k` 0) and the fill (`__rs_k` 1) of a road as two features with one `line-opacity` (0 or 1: its zoom stops hold the cases) and one
// `line-width` (a `let` of the row of the width table, then an `interpolate` of the zoom). The functions give new expressions from the originals and keep the zoom at the top.
const KIND = ["get", "__rs_k"];
const subst = (x, from, to) => (JSON.stringify(x) === JSON.stringify(from) ? to : Array.isArray(x) ? x.map((e) => subst(e, from, to)) : x);
const atStops = (expr, f) => [...expr.slice(0, 3), ...expr.slice(3).map((v, i) => (i % 2 === 1 ? f(v) : v))];          // an interpolate: [name, curve, input, stop, output, stop, output, ...]
const byZoom = (e) => Array.isArray(e) && e[0] === "interpolate" && JSON.stringify(e[2]) === '["zoom"]';
/** The `line-opacity` of the original with the fill and the casing at the factors `fill` and `casing` (the other kinds of piece stay as they are). */
export function roadOpacity(orig, fill, casing) {
  const f = ["case", ["==", KIND, 0], casing, ["==", KIND, 1], fill, 1];
  return byZoom(orig) ? atStops(orig, (o) => ["*", o, f]) : ["*", orig ?? 1, f];
}
/**
 * The paint of a casing that is drawn only outside the fill, from the original `line-width`: {width, gap} for `line-width` and `line-gap-width`. The casing piece gets the gap
 * of the fill width and a width of half the difference. Gives null when the original has not the shape that roadstyle makes now (then the casing stays under the fill).
 */
export function roadOutline(width) {
  if (!(Array.isArray(width) && width[0] === "let" && width.length === 4 && width[1] === "row" && byZoom(width[3]))) return null;
  const [, , rows, zoom] = width;
  const fillRows = subst(rows, KIND, 1), fillOf = (o) => subst(o, ["var", "row"], ["var", "row1"]);          // the same piece, as the fill: its width
  const make = (f) => ["let", "row", rows, "row1", fillRows, atStops(zoom, f)];
  return {
    width: make((o) => ["case", ["==", KIND, 0], ["max", 0, ["/", ["-", o, fillOf(o)], 2]], o]),
    gap: make((o) => ["case", ["==", KIND, 0], fillOf(o), 0]),
  };
}
/** The CSS color of a hex color with an alpha. */
export const withAlpha = (hexColor, a) => `rgba(${[1, 3, 5].map((i) => parseInt(hexColor.slice(i, i + 2), 16)).join(",")},${+a.toFixed(3)})`;

// ---- the ready themes ----
// A theme is one plain object (data, no code). It sets every style value: the fill and the casing of the road classes, the width of the groups, the text, the arrows,
// the boundary and the colors of the base map. In a map of classes (`fill`, `casing`, `width`) the key "*" is the value of every class that is not named.
// The Light theme has `look: true`: it is the design of the look itself. A theme keeps the tile profile and the dark ranges of the page.
// `group` and `dark` are for the filter of the theme list: group is "light", "dark", "print", "overlay" or "roadstyle"; `dark: true` is a dark ground. A theme with
// `roadsOnly: true` (a road palette) sets only the road colors and keeps the other values of the design that is on now.

const PASSIVE = { "*": 1 };
export const THEME_DATA = [
  { id: "light", group: "light", dark: false, name: "Light (Liberty)", look: true, note: "The look of the page: the colors of OpenFreeMap Liberty (roadstyle's theme liberty) and the google paths. Light roads with a casing on a light ground." },
  { id: "dark", group: "dark", dark: true, name: "Dark", note: "Dim roads and ground, light text. For a dark screen or a projector.",
    roads: { fill: { motorway: "#e0a458", trunk: "#d6b36a", primary: "#c9b98a", secondary: "#9aa7b4", tertiary: "#8793a0", cycleway: "#4f9a6a", "*": "#6b7683" }, casing: { "*": "#14181c" }, width: PASSIVE },
    labels: { color: "#d8dde3", halo_color: "#12161a", halo_width: 1.5 }, arrows: { color: "#c6ccd3" },
    boundary: { color: "#7cc4ff", width: 2.5, dash: "solid", fill: "#7cc4ff", fillOpacity: 0.12 },
    base: { background: "#1b1f24", water: "#1d3a56", green: "#233427", land: "#20252b", sand: "#3a3a2e", buildings: "#2d333a", buildingLine: "#3a424a", railways: "#6b7280", waterways: "#2b5278" } },
  // the themes of roadstyle (rust/roadstyle-assets/files/data/): the base-map themes `basemap/themes/*.yaml` and `basemap/osm_carto.yaml` (the road colors, and the land, water, green,
  // buildings and lines), and the road palettes `palettes/*.yaml` (road colors only: `roadsOnly`, the base map stays the one of the design that is on now). The colors are the files'.
  // A road class that a file does not name has the key "*" (a theme) or keeps the color of the design (a palette). A class with no casing in the file has its fill as casing.
  // Grey's sand is not in its file: it is the sand of osm_carto with the file's transform (saturation 0.12, then 35 % to white).
  { id: "google", group: "roadstyle", dark: false, name: "Google like", note: "roadstyle's theme google: a light land, white streets with soft gray edges, yellow main roads, light blue water, soft green parks, calm paths.",
    roads: { fill: { motorway: "#f8d16c", trunk: "#fbdd8a", primary: "#fde9a6", pedestrian: "#f2f1ee", track: "#f2ecdc", cycleway: "#1e8e3e", "*": "#ffffff" },
      casing: { motorway: "#e2ad45", trunk: "#e7bc63", primary: "#ead08a", secondary: "#d6d6d6", tertiary: "#dadada", living_street: "#e3e3e3", service: "#e6e6e6", pedestrian: "#e1e0dc", footway: "#c4c4c4", path: "#c4c4c4", track: "#c9bb9a", cycleway: "#ffffff", "*": "#e0e0e0" }, width: PASSIVE },
    labels: { color: "#5b5b5b", halo_color: "#ffffff", halo_width: 0 }, arrows: { color: "#5b5b5b" },
    boundary: { color: "#2563eb", width: 2.5, dash: "solid", fill: "#2563eb", fillOpacity: 0.18 },
    base: { background: "#f5f4f1", water: "#aadaff", green: "#cdeacf", land: "#f1f0ec", sand: "#f8edc9", buildings: "#e9e8e5", buildingLine: "#dcdbd7", railways: "#bdbdbd", waterways: "#8fc8f5" } },
  { id: "grey", group: "roadstyle", dark: false, name: "Grey", note: "roadstyle's theme grey: a quiet, light gray map for data. White roads with gray outlines, a hint of blue in the water.",
    roads: { fill: { motorway: "#ececec", trunk: "#ececec", living_street: "#f7f7f7", pedestrian: "#f2f2f2", footway: "#c9c9c9", path: "#c9c9c9", track: "#c9c9c9", cycleway: "#bcc3cc", "*": "#ffffff" },
      casing: { motorway: "#a9a9a9", trunk: "#b0b0b0", primary: "#b9b9b9", secondary: "#c2c2c2", tertiary: "#cbcbcb", service: "#dcdcdc", pedestrian: "#d6d6d6", footway: "#c4c4c4", path: "#c4c4c4", track: "#c9bb9a", cycleway: "#ffffff", "*": "#d4d4d4" }, width: PASSIVE },
    labels: { color: "#5b5b5b", halo_color: "#ffffff", halo_width: 0 }, arrows: { color: "#5b5b5b" },
    boundary: { color: "#2563eb", width: 2.5, dash: "solid", fill: "#2563eb", fillOpacity: 0.18 },
    base: { background: "#f5f5f3", water: "#d5dde0", green: "#e7ece5", land: "#f0f0ee", sand: "#ebeae7", buildings: "#e6e5e2", buildingLine: "#d9d8d4", railways: "#c4c4c4", waterways: "#c3cfd4" } },
  { id: "roadstyle", group: "roadstyle", dark: false, name: "roadstyle", note: "roadstyle's own look: the amber road palette on the OSM Carto base map.",
    roads: { fill: { motorway: "#f28c28", trunk: "#f5a623", primary: "#f4c542", secondary: "#f7df72", tertiary: "#b8d986", residential: "#d7dee8", living_street: "#cbd5e1", service: "#94a3b8", pedestrian: "#dddde8", footway: "#c59d9d", path: "#c59d9d", track: "#a3a3a3", cycleway: "#5c7cb6", "*": "#ffffff" },
      casing: { motorway: "#dc2a48", trunk: "#c84e2f", primary: "#a06b00", secondary: "#707d00", living_street: "#cccccc", service: "#d4d4d4", pedestrian: "#b3b3c2", footway: "#c59d9d", path: "#c59d9d", track: "#9e7b54", cycleway: "#5c7cb6", "*": "#bcbcbc" }, width: PASSIVE },
    labels: { color: "#5b5b5b", halo_color: "#ffffff", halo_width: 0 }, arrows: { color: "#5b5b5b" },
    boundary: { color: "#2563eb", width: 2.5, dash: "solid", fill: "#2563eb", fillOpacity: 0.18 },
    base: { background: "#e8e6df", water: "#aad3df", green: "#cdebb0", land: "#e8e6df", sand: "#f5e9c6", buildings: "#d9d0c9", buildingLine: "#c2b8ac", railways: "#707070", waterways: "#4a90d9" } },
  { id: "osmcarto", group: "roadstyle", dark: false, name: "OSM Carto", note: "roadstyle's theme osm_carto: the colors of the standard OpenStreetMap map (pink motorways, salmon footpaths, blue cycleways).",
    roads: { fill: { motorway: "#e892a2", trunk: "#f9b29c", primary: "#fcd6a4", secondary: "#f7fabf", living_street: "#ededed", pedestrian: "#dddde8", footway: "#fa8072", path: "#fa8072", track: "#ac8327", cycleway: "#6666ff", "*": "#ffffff" },
      casing: { motorway: "#c24e6b", trunk: "#c84e2f", primary: "#a06b00", secondary: "#707d00", tertiary: "#8f8f8f", pedestrian: "#b3b3c2", footway: "#fa8072", path: "#fa8072", track: "#ac8327", cycleway: "#6666ff", "*": "#bbbbbb" }, width: PASSIVE },
    labels: { color: "#5b5b5b", halo_color: "#ffffff", halo_width: 0 }, arrows: { color: "#5b5b5b" },
    boundary: { color: "#2563eb", width: 2.5, dash: "solid", fill: "#2563eb", fillOpacity: 0.18 },
    base: { background: "#e8e6df", water: "#aad3df", green: "#cdebb0", land: "#e8e6df", sand: "#f5e9c6", buildings: "#d9d0c9", buildingLine: "#c2b8ac", railways: "#707070", waterways: "#4a90d9" } },
  { id: "amber", group: "roadstyle", dark: false, roadsOnly: true, name: "Amber roads", note: "roadstyle's palette amber: an orange motorway with a red casing, yellow primary roads, light green tertiary roads. It changes only the road colors; the base map of the design stays.",
    roads: { fill: { motorway: "#f28c28", trunk: "#f5a623", primary: "#f4c542", secondary: "#f7df72", tertiary: "#b8d986", unclassified: "#ffffff", residential: "#d7dee8", living_street: "#cbd5e1", service: "#94a3b8", track: "#a3a3a3", cycleway: "#5c7cb6", footway: "#c59d9d", path: "#c59d9d" },
      casing: { motorway: "#dc2a48", trunk: "#c84e2f", primary: "#a06b00", secondary: "#707d00", tertiary: "#bcbcbc", unclassified: "#bcbcbc", residential: "#bcbcbc", living_street: "#cccccc", service: "#d4d4d4", track: "#9e7b54", cycleway: "#5c7cb6", footway: "#c59d9d", path: "#c59d9d" } } },
  { id: "cartoroads", group: "roadstyle", dark: false, roadsOnly: true, name: "Carto roads", note: "roadstyle's palette carto: the muted colors of the OpenStreetMap Carto roads. It changes only the road colors; the base map of the design stays.",
    roads: { fill: { motorway: "#e892a2", trunk: "#f9b29c", primary: "#fcd6a4", secondary: "#f7fabf", tertiary: "#ffffff", unclassified: "#ffffff", residential: "#ffffff", living_street: "#ededed", service: "#ffffff", track: "#9e7b54", cycleway: "#5c7cb6", footway: "#c59d9d", path: "#c59d9d" },
      casing: { motorway: "#dc2a48", trunk: "#c84e2f", primary: "#a06b00", secondary: "#707d00", tertiary: "#bcbcbc", unclassified: "#bcbcbc", residential: "#bcbcbc", living_street: "#cccccc", service: "#d4d4d4", track: "#9e7b54", cycleway: "#5c7cb6", footway: "#c59d9d", path: "#c59d9d" } } },
  { id: "highsat", group: "roadstyle", dark: false, roadsOnly: true, name: "High saturation", note: "roadstyle's palette highsat: bright, high contrast fills. It changes only the road colors; the base map of the design stays.",
    roads: { fill: { motorway: "#00e5ff", trunk: "#ff007f", primary: "#ff9100", secondary: "#ffea00", tertiary: "#00e676", unclassified: "#ffffff", residential: "#ffffff", living_street: "#dddddd", pedestrian: "#dddddd", service: "#f0f0f0", track: "#9e7b54", cycleway: "#2980b9", footway: "#d98880", path: "#d98880" },
      casing: { motorway: "#bcbcbc", trunk: "#bcbcbc", primary: "#bcbcbc", secondary: "#bcbcbc", tertiary: "#bcbcbc", unclassified: "#bcbcbc", residential: "#bcbcbc", living_street: "#dddddd", pedestrian: "#dddddd", service: "#f0f0f0", track: "#9e7b54", cycleway: "#2980b9", footway: "#d98880", path: "#d98880" } } },
  { id: "monoroads", group: "roadstyle", dark: false, roadsOnly: true, name: "Mono roads", note: "roadstyle's palette mono: grays only, a quiet base for your own data colors. It changes only the road colors; the base map of the design stays.",
    roads: { fill: { motorway: "#707070", trunk: "#7a7a7a", primary: "#8a8a8a", secondary: "#9c9c9c", tertiary: "#b0b0b0", unclassified: "#c4c4c4", residential: "#c4c4c4", living_street: "#d4d4d4", service: "#e4e4e4", track: "#9a9a9a", cycleway: "#888888", footway: "#ababab", path: "#ababab" },
      casing: { motorway: "#3c3c3c", trunk: "#444444", primary: "#4f4f4f", secondary: "#5c5c5c", tertiary: "#6e6e6e", unclassified: "#828282", residential: "#828282", living_street: "#9a9a9a", service: "#bcbcbc", track: "#9a9a9a", cycleway: "#888888", footway: "#ababab", path: "#ababab" } } },
  { id: "traffic", group: "light", dark: false, name: "Traffic", note: "Quiet grey roads and a pale ground. The colors of flow or speed stand out.",
    roads: { fill: { motorway: "#8d939a", trunk: "#9a9fa6", primary: "#a6abb1", secondary: "#b3b7bc", "*": "#c5c8cc" }, casing: { "*": "#9ea2a8" }, width: { major: 1.15, primary: 1.15, secondary: 1.15, "*": 1 } },
    labels: { color: "#6b7078", halo_color: "#ffffff", halo_width: 1.2 }, arrows: { color: "#6b7078" },
    boundary: { color: "#1d4ed8", width: 2, dash: "dashed", fill: "#1d4ed8", fillOpacity: 0.1 },
    base: { background: "#eeeeec", water: "#cfdce8", green: "#e5e9df", land: "#f3f3f1", sand: "#ecebe3", buildings: "#e3e3e1", buildingLine: "#d3d3d0", railways: "#c2c4c7", waterways: "#bfd0e0" } },
  { id: "print", group: "print", dark: false, name: "Print", note: "White ground, dark outlines, black text. Roads are wider. Good on paper.",
    roads: { fill: { motorway: "#f4b183", trunk: "#f8cbad", primary: "#fff2cc", cycleway: "#c9dcf0", "*": "#ffffff" }, casing: { "*": "#3a3a3a" }, width: { "*": 1.25 } },
    labels: { color: "#000000", halo_color: "#ffffff", halo_width: 2 }, arrows: { color: "#000000" },
    boundary: { color: "#000000", width: 1.5, dash: "dashed", fill: "#000000", fillOpacity: 0 },
    base: { background: "#ffffff", water: "#d4e6f6", green: "#e8f1de", land: "#fafafa", sand: "#f6f0d6", buildings: "#dcdcdc", buildingLine: "#8a8a8a", railways: "#000000", waterways: "#9cc3e6" } },
  { id: "pastel", group: "light", dark: false, name: "Pastel", note: "Soft colors and thin casings. For slides and posters on a screen.",
    roads: { fill: { motorway: "#f7b6c2", trunk: "#f9c9a8", primary: "#fbe3a1", secondary: "#fff3c4", tertiary: "#d6ecc0", cycleway: "#b6d4f2", footway: "#f2cfd3", path: "#f2cfd3", track: "#e6dcc9", "*": "#ffffff" }, casing: { "*": "#ddd6d0" }, width: { "*": 0.85 } },
    labels: { color: "#7a6f78", halo_color: "#ffffff", halo_width: 1.5 }, arrows: { color: "#9a8f99" },
    boundary: { color: "#c78fd6", width: 2, dash: "solid", fill: "#c78fd6", fillOpacity: 0.12 },
    base: { background: "#f6f1ec", water: "#cfe6f5", green: "#e1f1d6", land: "#faf6f2", sand: "#f8efd2", buildings: "#efe3df", buildingLine: "#e0d0cb", railways: "#cfc6c0", waterways: "#bcdcf0" } },
  { id: "blueprint", group: "dark", dark: true, name: "Blueprint", note: "A dark blue ground with white and light blue lines.",
    roads: { fill: { motorway: "#ffffff", trunk: "#e6f2ff", primary: "#cfe6fb", secondary: "#b3d6f5", tertiary: "#96c3ee", cycleway: "#8fd3ff", footway: "#4f8fc6", path: "#4f8fc6", track: "#4f8fc6", "*": "#6fa8dc" }, casing: { "*": "#1d5d94" }, width: { "*": 0.9 } },
    labels: { color: "#e8f3ff", halo_color: "#0b2a4a", halo_width: 1.5 }, arrows: { color: "#cfe6fb" },
    boundary: { color: "#ffffff", width: 2, dash: "dashed", fill: "#ffffff", fillOpacity: 0.06 },
    base: { background: "#0b2a4a", water: "#0e3a63", green: "#10375c", land: "#0d2f52", sand: "#123d66", buildings: "#14406b", buildingLine: "#5aa0d8", railways: "#7fb7e6", waterways: "#2a6aa3" } },
  { id: "night", group: "dark", dark: true, name: "Night", note: "A very dark ground, dim small roads and bright main roads. For a screen in a dark room.",
    roads: { fill: { motorway: "#ffb347", trunk: "#ffc76a", primary: "#ffe08a", secondary: "#9fb3c8", tertiary: "#7e8fa1", cycleway: "#46a36b", footway: "#5a6169", path: "#5a6169", track: "#5a6169", "*": "#4a525b" }, casing: { "*": "#0b0c0e" }, width: PASSIVE },
    labels: { color: "#aab2bb", halo_color: "#0b0c0e", halo_width: 1.5 }, arrows: { color: "#8b95a1" },
    boundary: { color: "#4da3ff", width: 2.5, dash: "solid", fill: "#4da3ff", fillOpacity: 0.1 },
    base: { background: "#121417", water: "#16222e", green: "#17211b", land: "#16181b", sand: "#25241d", buildings: "#1e2125", buildingLine: "#2a2e33", railways: "#4a4f57", waterways: "#1f3a52" } },
  { id: "minimal", group: "light", dark: false, name: "Minimal gray", note: "Gray roads of one color. Only the width shows the class. For data on top: flow, speed.",
    roads: { fill: { "*": "#b5b5b5" }, casing: { "*": "#9a9a9a" }, width: { major: 1.4, primary: 1.2, secondary: 1.1, tertiary: 1, residential: 0.9, living_street: 0.8, service: 0.7, pedestrian: 0.7, path: 0.6 } },
    labels: { color: "#7a7a7a", halo_color: "#f2f2f2", halo_width: 1.2 }, arrows: { color: "#7a7a7a" },
    boundary: { color: "#555555", width: 1.5, dash: "dashed", fill: "#555555", fillOpacity: 0.04 },
    base: { background: "#f2f2f2", water: "#e6e6e6", green: "#eeeeee", land: "#f5f5f5", sand: "#efefef", buildings: "#e9e9e9", buildingLine: "#dcdcdc", railways: "#cccccc", waterways: "#dddddd" } },
  { id: "contrast", group: "light", dark: false, name: "High contrast", note: "A white ground, black casings, bright fills, wide roads and large text. For easy reading.",
    roads: { fill: { motorway: "#ff1744", trunk: "#ff9100", primary: "#ffea00", secondary: "#00e5ff", tertiary: "#76ff03", cycleway: "#2979ff", footway: "#ff4081", path: "#ff4081", track: "#b26a00", "*": "#ffffff" }, casing: { "*": "#000000" }, width: { "*": 1.4 } },
    labels: { color: "#000000", halo_color: "#ffffff", halo_width: 2.5, size: 1.3 }, arrows: { color: "#000000", size: 1.4 },
    boundary: { color: "#000000", width: 4, dash: "solid", fill: "#000000", fillOpacity: 0 },
    base: { background: "#ffffff", water: "#a9d4ff", green: "#c6f0b2", land: "#ffffff", sand: "#fff2a8", buildings: "#d9d9d9", buildingLine: "#000000", railways: "#000000", waterways: "#4aa3ff" } },
  { id: "colorblind", group: "light", dark: false, name: "Colorblind safe", note: "The Okabe-Ito colors. They stay clear for red-green color blindness.",
    roads: { fill: { motorway: "#d55e00", trunk: "#e69f00", primary: "#f0e442", secondary: "#56b4e9", tertiary: "#0072b2", cycleway: "#009e73", footway: "#cc79a7", path: "#cc79a7", track: "#999999", "*": "#ffffff" }, casing: { "*": "#4d4d4d" }, width: PASSIVE },
    labels: { color: "#222222", halo_color: "#ffffff", halo_width: 1.5 }, arrows: { color: "#222222" },
    boundary: { color: "#0072b2", width: 2.5, dash: "solid", fill: "#0072b2", fillOpacity: 0.12 },
    base: { background: "#f5f5f5", water: "#cfe3f3", green: "#dcebd5", land: "#fafafa", sand: "#f5efd0", buildings: "#e5e5e5", buildingLine: "#cfcfcf", railways: "#888888", waterways: "#9cc7e6" } },
  { id: "vintage", group: "light", dark: false, name: "Vintage", note: "A sepia ground and brown roads. For posters.",
    roads: { fill: { motorway: "#b5572b", trunk: "#c27a3a", primary: "#d19a5b", secondary: "#dcb77f", tertiary: "#e6cc9c", cycleway: "#8a7a3a", footway: "#a9865a", path: "#a9865a", track: "#a9865a", "*": "#f3e8d0" }, casing: { "*": "#6b4f3a" }, width: { "*": 1.05 } },
    labels: { color: "#5a3f2a", halo_color: "#f3e8d0", halo_width: 1.8 }, arrows: { color: "#6b4f3a" },
    boundary: { color: "#7a3b1d", width: 2.5, dash: "dash-dot", fill: "#7a3b1d", fillOpacity: 0.08 },
    base: { background: "#e9dcc0", water: "#b9c9c4", green: "#cdc79a", land: "#eee0c3", sand: "#e8d6a8", buildings: "#d9c4a0", buildingLine: "#b39b78", railways: "#6b4f3a", waterways: "#9fb5ae" } },
  { id: "overlay", group: "overlay", dark: false, name: "Roads overlay", note: "Only the roads, with a transparent ground. Strong colors and a dark casing, for a light map, a dark map, a satellite map or 3D buildings under it.",
    roads: { fill: { motorway: "#ff7a00", trunk: "#ff9f1a", primary: "#ffc400", secondary: "#ffe14d", tertiary: "#ffffff", cycleway: "#00b36b", footway: "#ff6fa5", path: "#ff6fa5", track: "#c08a4a", "*": "#ffffff" }, casing: { "*": "#1a1a1a" }, width: { "*": 1.15 }, opacity: { fill: 0.6, casing: 0.85, outline: true } },
    labels: { color: "#111111", halo_color: "#ffffff", halo_width: 2.5 }, arrows: { color: "#111111" },
    boundary: { show: false, color: "#ffffff", width: 2, dash: "solid", fill: "#ffffff", fillOpacity: 0 },
    base: { background: "#808080", water: "#808080", green: "#808080", land: "#808080", sand: "#808080", buildings: "#808080", buildingLine: "#808080", railways: "#808080", waterways: "#808080" },
    ground: { transparent: true, opacity: 0 }, visible: { buildings: false, buildings3d: false, landcover: false, water: false, waterways: false, paved: false, railways: false, raceway: false, other_ways: false, platform: false, parking: false, parking_p: false, bus_stations: false, train_stations: false, bicycle: false, traffic_signals: false, crossings: false } },
  { id: "overlaydark", group: "overlay", dark: true, name: "Roads overlay, dark", note: "The same overlay with light roads and a dark casing. For a dark map or a satellite map under it.",
    roads: { fill: { motorway: "#ffd166", trunk: "#ffe08a", primary: "#fff1b8", secondary: "#e6f0ff", tertiary: "#cfe3ff", cycleway: "#7bf2b2", footway: "#ffb3d1", path: "#ffb3d1", track: "#e0c9a6", "*": "#f5f5f5" }, casing: { "*": "#101418" }, width: { "*": 1.15 }, opacity: { fill: 0.6, casing: 0.85, outline: true } },
    labels: { color: "#f5f5f5", halo_color: "#101418", halo_width: 2.5 }, arrows: { color: "#f5f5f5" },
    boundary: { show: false, color: "#ffffff", width: 2, dash: "solid", fill: "#ffffff", fillOpacity: 0 },
    base: { background: "#808080", water: "#808080", green: "#808080", land: "#808080", sand: "#808080", buildings: "#808080", buildingLine: "#808080", railways: "#808080", waterways: "#808080" },
    ground: { transparent: true, opacity: 0 }, visible: { buildings: false, buildings3d: false, landcover: false, water: false, waterways: false, paved: false, railways: false, raceway: false, other_ways: false, platform: false, parking: false, parking_p: false, bus_stations: false, train_stations: false, bicycle: false, traffic_signals: false, crossings: false } },
  { id: "hollow", group: "overlay", dark: false, name: "Roads hollow", note: "Only the outline of each road, in the color of its class, with no fill. The map under the roads shows through. For a satellite map or 3D buildings.",
    roads: { fill: { motorway: "#ff7a00", trunk: "#ff9f1a", primary: "#ffc400", secondary: "#ffe14d", tertiary: "#ffffff", cycleway: "#00b36b", footway: "#ff6fa5", path: "#ff6fa5", track: "#c08a4a", "*": "#ffffff" },
      casing: { motorway: "#ff7a00", trunk: "#ff9f1a", primary: "#ffc400", secondary: "#ffe14d", tertiary: "#ffffff", cycleway: "#00b36b", footway: "#ff6fa5", path: "#ff6fa5", track: "#c08a4a", "*": "#ffffff" }, width: { "*": 1.1 }, opacity: { fill: 0, casing: 1, outline: true } },
    labels: { color: "#111111", halo_color: "#ffffff", halo_width: 2.5 }, arrows: { color: "#111111" },
    boundary: { show: false, color: "#ffffff", width: 2, dash: "solid", fill: "#ffffff", fillOpacity: 0 },
    base: { background: "#808080", water: "#808080", green: "#808080", land: "#808080", sand: "#808080", buildings: "#808080", buildingLine: "#808080", railways: "#808080", waterways: "#808080" },
    ground: { transparent: true, opacity: 0 }, visible: { buildings: false, buildings3d: false, landcover: false, water: false, waterways: false, paved: false, railways: false, raceway: false, other_ways: false, platform: false, parking: false, parking_p: false, bus_stations: false, train_stations: false, bicycle: false, traffic_signals: false, crossings: false } },
  { id: "ghost", group: "overlay", dark: false, name: "Roads ghost", note: "Pale roads: the fill at 35 percent and a thin casing at 70 percent. The map under the roads shows through.",
    roads: { fill: { motorway: "#ff9640", trunk: "#ffb347", primary: "#ffd75e", secondary: "#fff08a", tertiary: "#f0f0f0", cycleway: "#3fc990", footway: "#ff9cc0", path: "#ff9cc0", track: "#d2a870", "*": "#f5f5f5" }, casing: { "*": "#1a1a1a" }, width: { "*": 0.9 },
      opacity: { fill: 0.35, casing: 0.7, outline: true } },
    labels: { color: "#111111", halo_color: "#ffffff", halo_width: 2.5 }, arrows: { color: "#111111" },
    boundary: { show: false, color: "#ffffff", width: 2, dash: "solid", fill: "#ffffff", fillOpacity: 0 },
    base: { background: "#808080", water: "#808080", green: "#808080", land: "#808080", sand: "#808080", buildings: "#808080", buildingLine: "#808080", railways: "#808080", waterways: "#808080" },
    ground: { transparent: true, opacity: 0 }, visible: { buildings: false, buildings3d: false, landcover: false, water: false, waterways: false, paved: false, railways: false, raceway: false, other_ways: false, platform: false, parking: false, parking_p: false, bus_stations: false, train_stations: false, bicycle: false, traffic_signals: false, crossings: false } },
];

const expand = (map, keys, now) => Object.fromEntries(keys.map((k) => [k, map[k] ?? map["*"] ?? now[k]]));
/**
 * The design of a theme (an object of THEME_DATA) on top of `b`, the design of the look: it has every style value, and keeps the profile and the dark ranges of `b`.
 * A theme with `roadsOnly` (a road palette) changes only the road colors of `now`, the design that is on now (`b` when none): the base map stays.
 */
export function makeTheme(b, t, now = b) {
  const d = clone(t.roadsOnly ? now : b);
  d.name = t.name; d.theme = t.id;
  if (t.look) return d;
  d.roads = { fill: expand(t.roads.fill, CLASSES, d.roads.fill), casing: expand(t.roads.casing, CLASSES, d.roads.casing), width: t.roads.width ? expand(t.roads.width, GROUPS.map(([g]) => g), d.roads.width) : d.roads.width,
    opacity: { ...(t.roadsOnly ? d.roads.opacity : defaultRoadOpacity()), ...t.roads.opacity } };
  if (t.roadsOnly) return d;
  Object.assign(d.labels, t.labels); Object.assign(d.arrows, t.arrows); Object.assign(d.boundary, t.boundary); Object.assign(d.base, t.base);
  Object.assign(d.ground, t.ground); Object.assign(d.visible, t.visible);          // a theme names the layers that it hides (visible: false) and the ground that it makes transparent
  return d;
}
/** The ready themes, for the panel: `make(base)` gives the design of a theme. */
export const THEMES = THEME_DATA.map((t) => ({ id: t.id, name: t.name, note: t.note, group: t.group, dark: t.dark, roadsOnly: !!t.roadsOnly, make: (b, now) => makeTheme(b, t, now) }));

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
