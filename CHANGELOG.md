# Changelog

All versions are on the GitHub Releases page of `Khoshkhah/duckosm-rust`. There is no PyPI package yet
(design.md, open question 2).

## Not released

### Changed

- The page uses roadstyle `2fc8477` (branch `rust-engine`): tile contract 2. A piece has the road's row as its feature id, so the source has no `promoteId`. The keys `__rs_edge`, `__rs_edge2` and `__rs_s` and the colour text are not in the tiles any more. The popup reads the road table by row. The tile handler `rs://` removes the query `?g=` before it reads the tile address. The new dashboard (`overlays.js`, `index.js`, `editor/level_editor.js`) is copied from `rust/roadstyle-assets/files/static/`. The 20 tiles of a Burnaby view (driving, pitch 60) are 1.54 MB, not 3.35 MB. The wasm function `makeSources` is now `styleSources`.
- The level editor draws on the page's own map (roadstyle `f0a161b`, host mode): the same colours and profile as the roads of the page. The map worker keeps a `LiveMap`, and a change of the editor redraws only the changed edges.
- `duckosm-build` and `duckosm-parquet` take the levels from the crate `roadstyle-levels` at roadstyle `f0a161b` (the crossing rule). The values of `edge_levels` change; the columns do not.
- The page uses roadstyle `fc59e6c` (branch `rust-engine`): the base map has the theme "liberty" and stops at the area's boundary. `node crates/duckosm-wasm/make_look.mjs` makes `map/look.json` again after each pin.

### Added

- The browser page: card 7 **Edit levels**, roadstyle's level editor on the map (docs/app.md, "Step 7: edit the
  levels"). **Apply** writes the edited drawing order into `visualization.edge_levels` and the downloads.

### Changed

- The page uses roadstyle `083224c` (branch `rust-engine`) for its map (the style, the tiles, the dashboard, the SQL files). The levels of
  `duckosm-core` stay at roadstyle `aba5884`.
- The page's map: **Show on map** and the draw after a build first show a veil with a spinner over the map, then set the blank
  base map and put the area in view when the roads are ready (docs/app.md, step 6).
- The level editor (roadstyle `083224c`): it starts from the build's levels with no solve, and the page makes the level
  area only when the area's edges changed. A head or a line end is saved and drawn at once, with no solve.

### Fixed

- The page: with the level editor open, a collapse of the side panel made the editor's panel white and inert. The
  editor's panel is now out of the page's panel.

## 0.3.0 (2026-10-23)

The tables of duckOSM that 0.2.0 did not make, the browser page and its map.

### Added

- The tables of group 1 (docs/tables.md): `ways`, `way_nodes`, `main.*` and `mm.*`, equal to duckOSM on Monaco.
- The raw cut (`--raw`, with `--boundary`): duckOSM's `raw.*` of an area, as osmium's smart cut.
- The base-map layers (`features.*`) in the browser page, from duckOSM's feature SQL.
- The drawing levels (`visualization.edge_levels`, option `--levels tags|solve|none`), from the tags or
  solved by roadstyle's Rust engine (roadstyle-rs, a git dependency).
- The lane profile (`driving.lane_profile`), equal to duckOSM on Monaco and Tartu.
- The bus routes (`bus.routes`, `bus.route_edges`), equal to duckOSM on Monaco and Tartu.
- The browser page: an area from a place name or a drawn boundary, the region file through the relay, the
  build, the data downloads, and a map of the roads as vector tiles that Rust makes.
- The page: a "Download .duckdb" button. The file is equal to the file that the zip's `make_duckdb.sql` makes
  (`tools/compare_duckdb.py`).

### Changed

- The GitHub Release has the CLI program for the 5 systems too (a `.tar.gz` or `.zip` archive for each).
- The cut to a boundary reads only the blocks of the PBF that each pass needs.
- The way lines of the layers step are made in Rust (two times faster).
- The page finds the time zone in a table of the Geofabrik regions, not in the world map of `tzf-rs`.

### Fixed

- A `.duckdb` build without costs (`calculate_costs=False`, CLI `--no-costs`) failed in the view `mm.edges`.
  Now, as in duckOSM, such a build has no `mm.*`.
- The map: in the 3D view, OpenFreeMap's 3D buildings show over every base map when the duckOSM 3D buildings
  do not show.

## 0.2.0 (2026-10-22)

### Added

- The edge graph (`edge_graph`, `turn_permission`) and the turn restrictions (`turn_restrictions`,
  `turn_path_restrictions`), equal to duckOSM on Monaco and Tartu (docs/edge_graph.md).

## 0.1.0 (2026-10-22)

The first release: the network step of duckOSM in Rust.

### Added

- The CLI program `duckosm-rust`: an `.osm.pbf` file in, the edges and nodes of duckOSM out, in DuckDB and
  GeoParquet. Every `edge_id` is the same as in duckOSM.
- The driving, walking and cycling modes, `merge_segments`, `edge_id_map`, `global_junctions`, the component
  filter, the sidewalk rule, the dangling-path connector, speeds and costs, `walk_type` and `cycle_type`.
- The OSM fixes file of duckOSM (`--fixes`).
- A duckOSM config file as the input (`--config`, Python `build_from_config`).
- The Python wheel `duckosm_rust` (abi3, Python 3.9 and newer) for Linux, macOS and Windows, with DuckDB 1.5.6
  in it.
- A WebAssembly build of the network step for the browser.
- GeoParquet in the column order of duckOSM, and `layers.json`.
- The Estonia test: equal to duckOSM, 19 s and 1.5 GB for three modes (duckOSM: 1,545 s and 10 GB).
