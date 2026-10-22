# duckOSM in the browser

Status: plan of 2026-10-22. Decision by Kaveh (2026-10-22): **the main goal of duckosm-rust is that duckOSM runs
in the browser.** The speed of the native program is a side effect. First without the map (the visualization
part); the map comes after.

## What the user gets

One web page, no server, no Python:

1. The user types the name of a place (or gives a PBF file).
2. The page gets the OpenStreetMap data of that place, and builds duckOSM's tables for the modes the user
   chooses: `edges`, `private_edges`, `nodes`, `edge_id_map`, `edge_graph`, `turn_permission`, and in driving
   `turn_restrictions` and `turn_path_restrictions`. The OSM fixes file is optional.
3. The tables go into DuckDB in the page (duckdb-wasm). The user can run SQL on them, as on a duckOSM `.duckdb`
   file.
4. The user can download the tables: one `.duckdb` file, or the GeoParquet files.

Not in this plan (the visualization part, later): the map, the base-map layers `features.*`, the drawing order
`visualization.edge_levels`, the bus routes, the multimodal graph `mm.*` of the route planner. The map side is
in progress in the geolibre-roadstyle repository (`docs/design/rust-spike.md`): a Rust WebAssembly module that
makes the style from a duckOSM database in duckdb-wasm.

## What exists today

| Part | State |
|---|---|
| The network step in WebAssembly (`crates/duckosm-wasm`) | Done for one mode at a time, without the edge graph, the restrictions and the fixes. Equal to the native program. Kentucky (148 MB PBF) fits. |
| The edge graph and the turn restrictions (`graph.rs`) | Done natively (0.2.0), equal to duckOSM. Switched off in the browser build. |
| The OSM fixes (`fixes.rs`) | Done natively. The reader takes a file path, so not in the browser. |
| A page | A demo: a PBF file in, four files out. The build runs on the main thread, so the tab freezes. |
| The input from a place name | Not started. |

## Result of B1 (2026-10-22)

Done. `build(pbf_bytes, modes, fixes_yaml)` builds all chosen modes with the edge graph, the turn restrictions
and the fixes, through the same `write_tables` as the native build. The page builds in a Web Worker, loads the
tables into duckdb-wasm (1.33.1-dev57.0, DuckDB 1.5.4), runs SQL, and gives the files and `load.sql`.

Checks on Monaco (3 modes, a fixes file):
- `cargo test -p duckosm-wasm`: the 20 Parquet files equal the native build, byte for byte.
- The real WebAssembly module in Node, and the page in headless Chromium (`www/e2e.py`): the same 20 files, byte
  for byte.
- `load.sql` makes a `.duckdb` file that equals the native `.duckdb` file: the same 20 tables, column types,
  rows and macros.

The page on Monaco, in headless Chromium: DuckDB starts in 0.6 s (while the user chooses the file); after the
click, the build takes 0.19 s, the load of the tables into DuckDB 0.5 s, and the first query can run after
0.76 s. The `.wasm` file is 4.9 MB.

Two changes from the plan:
- **No `.duckdb` download from the page.** duckdb-wasm 1.33.1-dev57.0 keeps a written `.duckdb` file locked
  after `DETACH` ("already locked exclusively"), so `copyFileToBuffer` and `read_blob` fail. Closing the
  connection, `flushFiles` and an empty file buffer do not help. The page gives `load.sql` instead. Check
  again with a newer duckdb-wasm.
- duckdb-wasm moves a registered buffer into its worker, so the page gives it a copy and keeps the file for the
  download. Without the copy, the downloads had 0 bytes (found by `e2e.py`).

## Steps

**B1: everything that duckOSM builds for the network, in the browser.**
- The wasm module builds all chosen modes in one run, with the edge graph, the turn restrictions (the relations
  from the PBF bytes) and the fixes (the YAML text). The fixes reader gets a variant that reads text.
- The build runs in a Web Worker, so the page stays responsive. The files go to the page as `Uint8Array` parts.
- The page loads the files into duckdb-wasm (one schema for each mode, the same table names as duckOSM, the macros
  `edge_id_hash` and `edge_id_hash_v1`), and has a SQL box with a result table.
- Downloads: a `.duckdb` file made by duckdb-wasm, and the GeoParquet files.
- Check: in Node and in headless Chromium, every table of Monaco and Tartu equals the native program (bytes for
  the Parquet files, rows for the `.duckdb` file). duckdb-wasm needs DuckDB 1.5 for the geometry type: pin the
  build that geolibre-roadstyle tested (1.33.1-dev, DuckDB 1.5.x).

**B2: the input from a place name.**
- Nominatim finds the place and its boundary. The Overpass API gives the OSM data inside the boundary: the
  highway ways and ferry lines with all their nodes (complete ways, as osmium's `complete_ways`), and the
  `type=restriction` relations. Both services allow calls from a browser.
- duckosm-rust gets a second reader: OSM JSON (the output format of Overpass), into the same `Way`, `Coords` and
  `Relation` values as the PBF reader. A test compares it with the PBF reader on the same data.
- With a boundary, the component filter runs, as in duckOSM.
- Limits: the Overpass servers have a size and time limit for each query, so the target is a city or a region.
  The page says so, and a PBF file stays possible for larger areas.

**B3: the comparison with the Python version** (Kaveh, 2026-10-22). On the same areas (Monaco and Tartu; Estonia
when Kaveh agrees), the same options, and the same tables:

| Measure | Python duckOSM (`duckosm build`, native) | duckosm-rust native | Browser (Chromium) |
|---|---|---|---|
| Build time (the network step of all modes) | | | |
| Delay: from the start until the user can run the first query | | | |
| Peak memory | | | |
| Download size before the first build (wasm, duckdb-wasm) | — | — | |

The delay includes, for the browser, the download and start of the wasm module and of duckdb-wasm, and the load
of the tables; for Python, the start of the program. The input from a place name (B2) is measured apart, because
it depends on the Overpass server.

**After B3: the visualization part.** The map from the tables in duckdb-wasm, with the Rust style module of
geolibre-roadstyle. It needs the base-map layers and the drawing order in Rust (or a page without them).
