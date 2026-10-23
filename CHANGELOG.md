# Changelog

All versions are on the GitHub Releases page of `Khoshkhah/duckosm-rust`. There is no PyPI package yet
(design.md, open question 2).

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

### Changed

- The GitHub Release has the CLI program for the 5 systems too (a `.tar.gz` or `.zip` archive for each).
- The cut to a boundary reads only the blocks of the PBF that each pass needs.
- The way lines of the layers step are made in Rust (two times faster).
- The page finds the time zone in a table of the Geofabrik regions, not in the world map of `tzf-rs`.

### Fixed

- A `.duckdb` build without costs (`calculate_costs=False`, CLI `--no-costs`) failed in the view `mm.edges`.
  Now, as in duckOSM, such a build has no `mm.*`.

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
