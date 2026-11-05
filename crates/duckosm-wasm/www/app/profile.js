// The tile profile of the page (card 9, the Tiles tab of roadstyle's design panel; card 10, Export): the zooms, the layers, the columns of the layer
// `edges`, the zoom where each road class starts, the extent, the buffer, the tile limit and the format of the map's tiles. Only this page makes tile
// files, so the profile is the page's own: roadstyle's design panel keeps it in the design as a host value (`design.profile`, the host tab "Tiles").
// This file has no page code, so Node can run it (profile_units.mjs).

export const LIMITS = { zoom: [0, 18], extent: [1024, 8192], buffer: [0, 256], tiles: [1000, 200000] };
/** The columns of the layer `edges` (the networks of a road are flags, always in the layer). */
export const EDGE_COLUMNS = ["edge_id", "osm_id", "edge_ref", "name", "highway", "oneway", "lanes", "surface", "maxspeed_kmh", "bridge", "tunnel", "junction", "layer", "service", "access", "length_m", "cost_s", "source", "target"];
/** The zoom where each road class starts in the layer `edges` (a lower class is left out at a lower zoom). Other classes start at `OTHER_FROM`. */
export const CLASS_FROM = { motorway: 0, trunk: 0, primary: 0, secondary: 8, tertiary: 10, unclassified: 11, residential: 12, living_street: 12 };
export const OTHER_FROM = 13;

const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== "" ? +v : d);
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

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
