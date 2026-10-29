# Changelog

All versions are on the GitHub Releases page of `Khoshkhah/duckosm-rust`. There is no PyPI package yet
(design.md, open question 2).

## Not released

### Added

- The test `dashboard_e2e.py`: the form of roadstyle's dashboard on a computer (1400 × 900) and on a phone (390 × 844): the bar and its tools, the panel, one look for the cards in both themes, the boxes, the settings and the Google key, the windows, the sheet.
- The setting **Map tiles** in card 6: MVT (the default) or MLT. MLT (MapLibre Tile) is the second tile format of roadstyle. The page keeps the choice in the browser (`duckosm.tileformat`). A change gives the roads on the map the style of the new format (the source's `encoding`) and puts the format in each tile address (`rs://<generation>/roads/{z}/{x}/{y}?g=<generation>&f=<format>`), so the page never uses a tile of the other format. The map worker keeps its tiles. MLT needs MapLibre 5.12 or newer (the page has 5.24). Burnaby, headless Chromium, software GL: an MLT tile has about 40 % of the bytes of an MVT tile, MapLibre needs about the same time to parse it, and the worker needs more time to cut it. The picture is the same: no pixel differs on Monaco. The results can depend on the browser and on the device. MVT stays the default until MVT and MLT are compared in several browsers. The numbers are in `docs/app.md`, "Map tiles: MVT or MLT".
- The test `tile_format_e2e.py` (Monaco): MVT is the default, the address and the style have the format, MLT gives the same picture, and the page keeps the choice.
- The region download reads the file in up to 8 parts at the same time (HTTP `Range`) through the relay, from the dated file that "latest" points to. The relay passes `Range` and gives `Content-Location`; `serve.py` does the same. The page needs a new deploy of the relay for this; with the old relay it reads one stream, as before (docs/relay.md).

### Fixed

- The button that shows the hidden panel had a filled black square in place of its icon: its SVG had none of the attributes (`fill="none"`, `stroke`) that roadstyle's template gives it, and the page's own rule for SVGs does not reach a button outside the panel. The page now has the markup of the template's two buttons (`#sb-hide`, `#sb-show`) and no rule of its own for their SVGs. `dashboard_e2e.py` checks the icon, its size and its place. No other SVG of the page has this fault: the filled ones are roadstyle's own tool icons.

- The source files `app/duck.js`, `build_worker.js`, `index.html` and `map/map_worker.js` had the version `?v=check` in their references (PR #27: `version_refs.py` was run in the work folder with the version `check`, not with `--check`). The deploy script adds a version only to a reference that has none, so the deployed page kept `?v=check` and a browser could take an old file from its cache after a deploy. The references have no version in the source again; the deploy adds it. `version_refs.py` now refuses to change the page's own folder (use a copy; `--check` only reads).
- A zoom out no longer makes the area black for 0.5 to 1.7 s (Burnaby, pitch 60, headless Chromium): the page draws the opaque fill layers (land, water) also from a second source `rs-low` of the same tiles with the last zoom 9, so MapLibre always has a loaded tile to over-zoom.
- The page sends the tile requests to the map worker newest first and skips a request that MapLibre aborted (a zoom step that passed): in a fast zoom, 71 tile calls and 4 MB, not 153 to 177 calls and 8 to 9 MB.

### Removed

- The page's own copies of standard parts: the base-map box and its code (`BASEMAPS`, `BLANKS`, `setBase`), the 3D buildings tool, the **duckOSM layers** check box, `keepInside` (the page moved the boxes inside the window), the CSS of the page's box, and the correction of the editor's full sheet.
- The page's adapters for gaps that roadstyle `6d37af5` fixed: `window.DASHBOARD` and the first-paint script, the list of base maps (`basemaps.json`, `tilesOf`, `solid`), `withBase` and the move of the raster layer, the choice of `blank_dark`, the copy of the panel's shell rules, the import of `setSheet`, the code that reads the panel and the bar for the free part of the map, and the `data-t` tags in the tests. `build.sh` copies `host_options.json` in place of `basemaps.json`.

### Changed

- The base map is roadstyle's (Kaveh's rule of 2026-10-29: every dashboard uses the standard template and toolbox, and the page does not change them). The page gives the dashboard the base maps of `host_options.json` (roadstyle's file) and a map with the layers `bg` and `basemap`. The tool, the box, the link to the theme (a map with a dark twin follows the theme) and the 3D buildings tool are roadstyle's. The page starts on OpenFreeMap Liberty. The page keeps the light key of the choice (`duckosm.basemap`). **Show on map** sets Blank (roadstyle gives the dark twin in the dark theme).
- The page uses roadstyle `6fdc89373663a00ab837f6d8c519e91505b2d745` (branch `claude/page-gaps-38e9d3`, with `design-dashboard-d25`): the fixed toolbox, the base-map tool and the fixes for a JavaScript host page (`rsFirstPaint`, `rs.sheet()`, `rs.freeArea()`, `data-rs-tool`, boxes that stay inside the screen sideways, the dark twin for `rsSetBasemap`, the sprite of a vector base map, one switch for the area's layers in the Base map box and their list in the legend box, the 3D switch, and every control of a style for each `rs.setStyle`). The options of the dashboard (`dashboard`, `first_paint`, `basemaps`, `ontop`) are `data/host_options.json` of roadstyle (`build.sh` copies it; no WebAssembly module loads before the map): the page has no copy of the defaults.
- The bar has roadstyle's default toolbox of `6fdc893`: one **navigate** button (the compass needle; a box with zoom, turn and tilt sliders and a reset button; Ctrl + drag on the map turns and tilts it) in place of zoom in, zoom out, the compass and 2D/3D. The credits are in the corner box of the map on a computer (in the bar on a phone) and have no tooltip. The page uses the default as it is. `dashboard_e2e.py` checks the tools, the navigate box, Ctrl + drag and the corner box.
- The look of the page is live (`state: "live"`) and has the colour option "Road class" (`make_look.mjs`), as the look of a roadstyle dashboard page is. The roads style then has the controls of the dashboard. The Base map box has one switch **Map layers** for all the layers of the area (landcover, water, buildings and more: the **duckOSM layers** switch is back), the legend box lists them with their colours, and "Colour by and legend" is on. A page with a bar has no floating Layers box (it was at the bottom right, and the phone's sheet covered it). `e2e.py` checks all of it.
- The panel has its form after 81 ms and the map is shown after 1,458 ms (before: 189 ms and 1,551 ms; headless Chromium, no CPU throttle, median of 5 runs).
- `docs/app.md` has one open gap in roadstyle: the pattern layer of landcover that the switch of the area's layers leaves on the map. The handle of the editor's sheet on a phone is reachable at `6fdc893` (`phone_e2e.py` prints no gap).
- The page has the look of roadstyle's dashboard (the template `dashboard`, the layout `overlay`; Kaveh asked for it on 2026-10-29). The map fills the window. The panel floats over it in roadstyle's frame look. roadstyle's toolbar holds the map buttons: theme, zoom, compass, 2D/3D, Street View, Google 3D, base map, 3D buildings, settings and attribution. The page adds the base-map box and the 3D buildings switch as tools of the bar. The seven cards have one neutral look in the light and the dark theme: the colors `--c` of the cards are gone. On a phone (700 px or less), the bar is at the top and the panel is roadstyle's sheet with three heights (closed, 40 %, full), in place of the page's own sheet. The selects are roadstyle's lists. `docs/app.md` ("roadstyle's dashboard look") has the details.
- The Google key is in roadstyle's settings (the gear button), as `rs-key:google` in the browser's storage. Card 6 has a button that opens the settings in place of the key field. The Google 3D tool is always on the bar. The key that an earlier version saved (`duckosm.googleKey`) moves to the new place at the first visit.
- The tests `e2e.py`, `editor_e2e.py` and `tile_format_e2e.py` use roadstyle's lists (a click, or the value in the page) and the new ids of the panel. `phone_e2e.py` checks roadstyle's sheet.
- The page uses roadstyle `91344c3` (branch `main`, D15 of the dashboard): the frame look of the panel, the typed `dashboard` options, the panel's left side, no scale box at the start, and the settings box. `build.sh` pins the full SHA.
- The page uses roadstyle `52b5728` (branch `main`, the Rust engine): smaller low-zoom tiles, the road width as one table lookup, the second tile format MLT, and one road layer for each band of zooms (`roads-simple`, `roads-simple-z14`, `roads-simple-z15`, and the `-dash` layers). The page no longer gives the option `pick` to `rsDashboard`: roadstyle picks all the road layers of the style (`RS_LEANS`), so the hover, the tooltip and the click work at every zoom. `editor_e2e.py` and `phone_e2e.py` query all the `rs-roads-simple*` layers. The page keeps its own dashboard look. `build.sh` has the full SHA.
- The page uses roadstyle `71af6fe` (branch `rust-engine`). The tiles hold no colour text: the colours of a piece are places in two tables of the style. The new dashboard module `generation.js` compares `roadstyle:generation` of the style with the `?g=` of the tile URL. If they differ, it shows a red message and hides the vector layers. The page keeps the `?g=` on the tile URL and does not hide the message. The page reads no colour text of a tile. `generation_e2e.py` checks the normal path and a stale generation.
- The map worker also reports `liveBytes()` (the bytes held now, and the most held). The step table of the page and `docs/app.md` give the live value. `memoryBytes()` is the size of the WebAssembly memory. The allocator grows it ahead in steps of a quarter (16 to 64 MiB), so it can rise when the held bytes fall (Burnaby driving, PR #26: 210 to 232 MiB size, 154 to 143 MiB held).
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
