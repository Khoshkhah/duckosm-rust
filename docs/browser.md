# duckOSM in the browser

Status: B1, B2, B3 and B4 done on 2026-10-22 (the results are under each step). B2 depends on public Overpass
servers, which were full during the test. Decision by Kaveh (2026-10-22): **the main goal of duckosm-rust is that duckOSM runs
in the browser.** The speed of the native program is a side effect. First without the map (the visualization
part); the map comes after.

## What the user gets

One web page, no server, no Python:

1. The user makes the boundary of the area with the boundary tool (a name search), or gives a boundary file.
2. The page gets the OpenStreetMap data of that area (from a region file that the user downloaded one time),
   cuts it to the boundary, and builds duckOSM's tables for the modes the user
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

**Result of B2 (2026-10-22).** Done in code, not usable every day:
- `osmjson.rs` reads OSM JSON. Its test writes the Monaco PBF as OSM JSON (coordinates with 7 decimals, as Overpass
  writes them) and reads it back: the same ways, tags, coordinate bits and restriction relations as the PBF reader.
  A coordinate becomes whole nanodegrees and then `1e-9 * nanodegrees`, the formula of the PBF reader, so the
  bits are equal.
- `build_osm_json` in the wasm module; the page finds a place with Nominatim and asks three Overpass servers in
  turn (the area of a relation or a closed way, else the bounding box of a point).
- **The public Overpass servers were full during the test** (2026-10-22): overpass-api.de "at capacity, all query
  workers are busy" (502), maps.mail.ru 504 at once, overpass.private.coffee a timeout after 4 minutes. Earlier the
  same day, a small query took 21 to 72 s. So a place name works only when a server has room, and the page says
  so. A PBF file always works.
- Geofabrik's extracts have no CORS header, so a page cannot download them. A source of PBF extracts with CORS, or
  a proxy (a server), is a decision for Kaveh.

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

**Result of B3 (2026-10-22).** The same input (the cut file that duckOSM wrote for the boundary), the same
options (three modes, merge, global junctions, the sidewalk rule, the connector, speeds, costs, the types, the
edge graph, the turn restrictions, the component filter; no lane profile, H3, base map or drawing order), and the
same tables: the page's tables equal duckOSM's tables on every row (the connector labels apart, item 3c of the
design). Three runs each; the computer had a load average of about 5 from other work.

| Monaco (0.7 MB PBF) / Tartu (3.1 MB PBF) | duckOSM (Python, native) | duckosm-rust (native) | Browser (Chromium) |
|---|---|---|---|
| Build of the three modes | 3.4 s / 10–11 s | 0.31 s / 1.2 s | 0.19 s / 0.9–1.0 s |
| Delay: from the start until the first query can run | 3.4 s / 10–11 s (the program) | 0.31 s / 1.2 s | 0.75 s / 1.7 s after the click (build, then the tables into duckdb-wasm in 0.5 s / 0.7 s) |
| Peak memory | 460 MB / 720 MB | 80–100 MB / 200–215 MB | 21 MiB / 77 MiB WebAssembly memory (duckdb-wasm's worker not counted) |
| Before the first build | the program is installed (`pip install duckosm`) | the program is installed | the page opens and duckdb-wasm starts in 0.6 s, while the user chooses the file; downloads on the first visit: duckosm-rust 0.97 MB (gzip; 5.0 MB), duckdb-wasm 7.3 MB (brotli) |

- The first duckOSM run of an area also cuts it with osmium: 5.4 s / 12.0 s, and up to 3.3 GB.
- The browser is 4.5 times faster than duckOSM on Monaco, and about 6 times on Tartu, from the click until the
  first query, on the same computer. The native duckosm-rust is 10 times faster than duckOSM.
- The input from a place name is not in the table: the public Overpass servers were full (B2). When a server
  answers, its time comes in front of the build (earlier the same day: 21 to 72 s for a small query).
- Commands: `bench/python_steps.py <config> --no-lane-profile` (duckOSM), the CLI with `-m
  driving,walking,cycling` (native), and `crates/duckosm-wasm/www/e2e.py <cut file> <folder>` (the page; it
  prints the times as JSON).

**B4: a boundary and a name as the input** (Kaveh, 2026-10-22). duckOSM works from an area: a boundary (GeoJSON)
with a name, as a duckOSM config with `name` and `boundary`. Decisions:

- **A separate boundary tool** (`www/boundary.html`, its own module). The user types a name, the tool shows the
  matches (Nominatim), and the user selects one. The tool writes the boundary in the format of `duckosm
  boundary`: a FeatureCollection with one Feature, and the properties `name`, `osm_id`, `admin_level`,
  `area_km2`, `source`. It also names the smallest Geofabrik extract that covers the boundary, with its download
  link (`geofabrik`). The file works in Python duckOSM and in the page.
- **The data: a region PBF, cut in Rust (A+).** The user downloads the extract that the tool names, one time, and
  selects it in the page. The page reads the file piece by piece (no copy of the whole file in WebAssembly
  memory) and cuts it to the boundary as osmium's `complete_ways` does: every way with a node inside is kept
  whole. Then the build runs, with the component filter, as duckOSM does with a boundary.
- **Overpass as an option (C)**, with the polygon of the boundary, for a small area when a server has room.
- No automatic download: the extract servers send no CORS header (checked 2026-10-22: Geofabrik,
  openstreetmap.fr, BBBike), so that needs a server of our own.
- The native program gets the same cut: `--boundary` in the CLI, and a config with a boundary needs no osmium.
- Check: the Rust cut gives the same network as duckOSM's osmium cut.

**Result of B4 (2026-10-22).** Done:
- `boundary.rs` reads a boundary (a FeatureCollection, a Feature, a Polygon or a MultiPolygon). A point on the
  border is inside, as in osmium. `pbf::read_area` cuts in three passes, and each pass reads only the blocks of
  the file that it needs:
  1. The node blocks: the nodes inside, and the position and the range of node IDs of each block. In a file
     sorted by type (`Sort.Type_then_ID`, as all Geofabrik files), the pass stops at the first block of ways.
  2. From the first block of ways: the ways with a node inside, and the restriction relations.
  3. Only the node blocks that hold a node of these ways outside the boundary (Tartu: 173 of 1,649 blocks).
- The CLI has `--boundary`, the Python package `boundary=`, and a config with a boundary needs no osmium.
- The wasm module has `build_area(blob, boundary, ...)`. It reads the region file piece by piece (`Blob.slice`
  and `FileReaderSync` in the worker), so the file is not copied into WebAssembly memory. `build_osm_json` also
  takes the boundary: Overpass gives the ways in the box of each outer ring, and Rust keeps the ways with a node
  inside, as in the cut of a region file.
- `www/boundary.html` is the boundary tool: a map (MapLibre, OpenFreeMap) with a side panel. The area comes from
  a Nominatim search, a click on the map (what is here), the drawing tools (rectangle, polygon, circle,
  freehand, edit), or a GeoJSON file. The design is in [boundary_tool.md](boundary_tool.md). It writes the format of `duckosm boundary` (the area in km² is the same as duckOSM's: 2.39 for Monaco),
  with `geofabrik`: the three smallest extracts that cover the area, with their links. "Use in duckOSM" gives
  the boundary to `index.html` through the storage of the site.
- `www/geofabrik.json` (1.6 MB, 0.5 MB gzip, 554 extracts) comes from Geofabrik's `index-v1.json`
  (`tools/make_geofabrik_index.py`). The polygons are about 1 km larger than the extracts, so an area at the
  border of an extract is not lost (with the simplified polygons only, Monaco was not in its own extract).

Checks:
- The Rust cut of `monaco_sample.osm.pbf` with `monaco.geojson` gives the same ways, tags and coordinates as
  duckOSM's osmium cut (`tests/boundary.rs`). The cut of OSM JSON keeps the same ways (`tests/osmjson.rs`).
- The page (headless Chromium) with the boundary and the region file against the native CLI `--boundary`:
  Monaco and Tartu from the Estonia file (121 MB), all 20 tables equal on every row.
- The Overpass option was not tested in the page: all three public servers gave 504 on 2026-10-22.

| Tartu from the Estonia file (121 MB) | Time | Memory |
|---|---|---|
| osmium cut (duckOSM) | 1.97 s | |
| duckosm-rust native, cut and build | 0.97 s | 220 MB |
| duckosm-rust native on one thread | 2.4 s (the cut 1.9 s) | 110 MB |
| The page: cut and build | 3.7 s | 81 MiB WebAssembly memory |
| The page with the cut file (B3) | 0.9–1.0 s | 77 MiB |

The first version read all blocks in each pass, and the restrictions in a fourth pass: the page took 11.3 s
and 116 MiB, and native on one thread 9.4 s. On one thread, passes 1 and 2 now take 0.9 s each, and they must
unzip each block one time (1.4 s for all blocks of Estonia). The `zlib-rs` unzip code was 4 % faster than the
default `miniz_oxide` in the page and not faster natively, so it is not used.

**WebAssembly threads (2026-10-22).** A second module (`www/pkg-threads/`, nightly Rust, `wasm-bindgen-rayon`)
decodes the blocks of the cut on a pool of Web Workers. The page uses it when it is cross-origin isolated
(`www/serve.py` sends the headers), else the module with one thread. Tartu from the Estonia file, three runs
each, the computer had a load average of about 6 from other work:

| The page | Build | From the click to the first query | WebAssembly memory |
|---|---|---|---|
| One thread (`pkg/`) | 3.8–3.9 s | 4.6–4.9 s | 81 MiB |
| 8 threads (`pkg-threads/`) | 1.7–1.8 s | 2.5–2.6 s | 130 MiB |

- All 20 tables are equal to the native build on every row, with and without threads (Tartu and Monaco).
- The allocator of the standard library has one global lock in WebAssembly. With 4 threads, pass 2 (the blocks
  of ways, millions of small allocations) took 2.2 s instead of 1.2 s. `src/alloc.rs` gives each thread its
  own lists of free small blocks: pass 2 then took 0.5 s.
- More than 8 threads gave no more speed, only more memory (20 threads: 195 MiB), so the default is the number
  of cores, at most 8. The network step after the cut (about 0.8 s) stays on one thread.
- For a public page, the host must send the two headers. GitHub Pages cannot; a service worker
  (`coi-serviceworker`) can add them. Not done: the page has no public host yet. The file is read from the disk each time; a file kept in the browser storage (OPFS) does not make it
faster. Not done: keep the
region file in OPFS (the user selects the file again, which costs nothing), and an automatic download of the
extract (it needs a server with CORS).

**After B4: the visualization part.** The map from the tables in duckdb-wasm, with the Rust style module of
geolibre-roadstyle. It needs the base-map layers and the drawing order in Rust (or a page without them).
