// Makes www/map/look.json (the page's look) with the wasm that build.sh made: node crates/duckosm-wasm/make_look.mjs
// The args are those of the Monaco map the page began with; the base map (roads' colours too) is the theme "liberty", paths "google".
import { readFileSync, writeFileSync } from "node:fs";
import init, { resolveLook } from "./www/map/pkg/roadstyle_wasm.js";

const dir = new URL("./www/map/", import.meta.url);
await init({ module_or_path: readFileSync(new URL("pkg/roadstyle_wasm_bg.wasm", dir)) });
const args = {
  name: "monaco (all, google)", tooltip: ["edge_id", "osm_id", "highway", "name", "access"], copy_field: "edge_id", basemap: "blank",
  basemaps: ["blank", "voyager_nolabels", "voyager", "positron", "osm", "satellite"],
  casing_start_col: "casing_start", casing_level_col: "casing_level", casing_end_col: "casing_end", fill_level_col: "fill_level",
  head_start_m_col: "head_start_m", head_end_m_col: "head_end_m", cap_start_col: "cap_start", cap_end_col: "cap_end",
  directed_col: "is_directed", driving_col: "has_arrows", arrows: true, labels: true, view_3d: false,
  // a dashboard page has a live look (as the CLI, the MCP server and roadstyle's page writer make it): the style has the controls of the
  // dashboard (the layers of the base map for its Layers box and its 3D switch, the colour options for "Colour by")
  state: "live", color_options: { "Road class": {} },
};
const look = resolveLook(JSON.stringify({
  args,
  base_map: { mode: "all", theme: "liberty", paths: "google", place: "monaco" },
}));
// tiles.maxzoom 18 is the default; the page keeps it in the file too.
// The tiles' buffer is the strokes' need times BUFFER_HEADROOM, so a design with roads up to this much wider keeps the map's tiles (roadstyle's
// LiveMap.setLook, docs/design/restyle_without_retile.md in roadstyle). 1.35 covers 32 of the 33 themes of the Design panel (all but Access, x1.7);
// the cost on a Burnaby sample: 4.3% more tile bytes.
const BUFFER_HEADROOM = 1.35;
const out = JSON.parse(look.toJson());
out.tiles.buffer_headroom = BUFFER_HEADROOM;
writeFileSync(new URL("look.json", dir), JSON.stringify(out));
