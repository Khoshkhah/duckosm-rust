# Development

## Where the engine lives

Since the engine move (2026-11), the Rust engine (`duckosm-core`, `duckosm-parquet`, `duckosm-duckdb`,
`duckosm-build`, `duckosm-cli`, `duckosm-py`) is in the [duckOSM](https://github.com/Khoshkhah/duckOSM) repository, in
`rust/`. It has the engine tests (the Monaco golden files), the wheels and the release. This repository has the browser
page (`crates/duckosm-wasm`, `www/`) and these docs. `crates/duckosm-wasm/Cargo.toml` takes `duckosm-core` and
`duckosm-build` from duckOSM with a Git dependency at one `rev`.

To change the engine and the page together, check out duckOSM beside this repository. Then add a `[patch]` table to the
root `Cargo.toml` (do not commit it):

```toml
[patch."https://github.com/Khoshkhah/duckOSM"]
duckosm-core = { path = "../duckOSM/rust/duckosm-core" }
duckosm-build = { path = "../duckOSM/rust/duckosm-build" }
```

To use a new engine in the page, merge the engine change in duckOSM. Then set the new commit as `rev` in
`crates/duckosm-wasm/Cargo.toml` and run `cargo update -p duckosm-core -p duckosm-build`.

## Where the editors come from

The page has no copy of its two editors. Each editor is in the repository of its owner, and `build.sh` copies it at one pin. Git ignores
the copies.

| Card | Editor | Owner and folder | Pin | Copy in the page |
|---|---|---|---|---|
| 7 Edit OSM data | the fixes editor | duckOSM, `web/fixes_editor/` | the `rev` of the duckOSM dependency in `crates/duckosm-wasm/Cargo.toml` (the engine's rev) | `www/duckosm/fixes_editor/` |
| 9 Edit design | the design panel | roadstyle, `rust/roadstyle-assets/files/static/dashboard/design/` | `ROADSTYLE_COMMIT` in `crates/duckosm-wasm/build.sh` | `www/map/roadstyle/dashboard/design/` |

`build.sh` reads the duckOSM rev from `Cargo.toml`, so one rev gives the engine and the fixes editor. It stops if `Cargo.toml` has more
than one duckOSM rev. `e2e.py` checks that the served files of both editors are equal to the files at their pins. To change an editor,
change it in its owner's repository, merge it there, and then move the pin here. The unit tests of the fixes editor are in duckOSM
(`node web/fixes_editor/fixes_units.mjs`).

## Toolchain status (2026-10-21)

| Tool | Status |
|---|---|
| `rustc`, `cargo`, `rustup` | Installed on 2026-10-21 with `rustup` at user level (`~/.cargo`, `~/.rustup`, profile `default`, channel `stable`). Version 1.99.1. The installer added `~/.cargo/bin` to the `PATH` in the shell profile. |
| `g++`, `cmake`, `make` | Installed (system). The `duckdb` crate needs a C++ compiler. |
| `maturin` | Not installed. It is needed from M3 (Python wheel). |
| `wasm32-unknown-unknown` target | Installed (`rustup target add`). See section 7 of the design. |
| `wasm-bindgen` | `wasm-bindgen-cli` 0.2.129, installed with `cargo install` at user level (`~/.cargo/bin`). Its version must be the same as the `wasm-bindgen` crate in `Cargo.lock`. |
| `node` | Version 24, installed (system). It runs the WebAssembly build without a browser. |
| `nightly-2026-10-15` with `rust-src` | Installed on 2026-10-22 (`rustup toolchain install`). Only for the WebAssembly module with threads: it builds the standard library again with atomics. |

## Install Rust

Done on this machine. On a new machine:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile default
source "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown   # M4
cargo install wasm-bindgen-cli --version 0.2.129 --locked
rustup toolchain install nightly-2026-10-15 --profile minimal --component rust-src --target wasm32-unknown-unknown
```

## Build and test

```bash
cargo build --release -p duckosm-wasm --target wasm32-unknown-unknown   # the first build takes minutes
cargo test --release -p duckosm-wasm   # the browser build equals duckosm_build::build, byte for byte
```

The engine tests (hash vectors, geometry, the Monaco golden test, the lane profile, the levels) and the native program
`duckosm-rust` (`duckosm-cli`) are in duckOSM: run `cargo test --release` in its `rust/` folder.

## One shared build folder

On Kaveh's machine, all worktrees of duckosm-rust and of roadstyle use one build folder for each repository:
`<main checkout>/.shared-target`. Thus the dependencies (DuckDB is the largest) compile one time, not one time
for each worktree. The `cargo` wrapper `tools/cargo` does this. Install it before `~/.cargo/bin` in `PATH`:

```bash
install -m 755 tools/cargo ~/.local/bin/cargo
```

For `build`, `check`, `clippy`, `doc`, `fix`, `run`, `rustc`, `test` and `bench` in a checkout of one of the two
repositories, the wrapper does these steps:

1. If the workspace has no `target`, it makes `target` a link to `.shared-target`. Paths such as
   `target/release/duckosm-rust` thus stay correct. A workspace that has a `target/` folder of its own keeps
   that folder: the change starts when you delete the old folder.
2. Cargo finds a crate "fresh" from the file times, and it identifies a workspace crate by its relative path.
   Thus a worktree with older files can get the binary of the worktree that built last. To prevent this, the
   wrapper keeps the path of the last workspace in `.shared-target/.last-tree`. When another workspace builds,
   the wrapper touches all files of that workspace that Git tracks. The workspace crates then compile again, but
   the dependencies do not.
3. A lock (`.shared-target/.lock`) lets the cargo commands of only one workspace use the folder at a time. The
   commands of the same workspace can run together. When a command waits, the wrapper tells which workspace it
   waits for. A `cargo run` that does not stop (a server) thus stops the builds of the other worktrees: run the
   program from `target/` instead.

`build.sh` puts roadstyle's clone in `target/roadstyle-<commit>`, one folder for each `ROADSTYLE_COMMIT`, and it keeps
a complete clone. The clone is a different Git repository, so it builds in its own `rust/target`. The test
`tests/native.rs` writes to `target/tmp/<checkout>/`. CI has no wrapper and uses a plain `target/`.

To stop the shared folder, delete `~/.local/bin/cargo`, or set `CARGO_TARGET_DIR` or `--target-dir` to a
folder outside `.shared-target`. `cargo clean` deletes the shared folder of all worktrees.

## Engine checks (moved to duckOSM)

The checks of the network step against duckOSM (the golden files, `compare_with_duckosm.py`, `compare_tables.py`,
`compare_levels.py`, `edge_id_reference.py`, the OSM fixes, another area such as Tartu) and the benchmark
(`bench/run_bench.py`) are in the duckOSM repository now: `tests/data/`, `tools/`, `bench/` and `rust/`. The docs there
describe them. [benchmark.md](benchmark.md) keeps the results.

## WebAssembly

Build the two modules and their JavaScript bindings (Git ignores both folders):

```bash
./crates/duckosm-wasm/build.sh
```

- `www/pkg/`: one thread, stable Rust.
- `www/pkg-threads/`: rayon on Web Workers (`wasm-bindgen-rayon`), nightly Rust. The browser gives
  WebAssembly threads only to a cross-origin isolated page, so the server must send the headers
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Without them,
  the page uses `pkg/`. duckdb-wasm (from cdn.jsdelivr.net), Nominatim and Overpass work with these headers.
  `?threads=N` in the address sets the number of threads (the default: the cores, at most 8).
  GitHub Pages cannot send the two headers: there, `www/coi-serviceworker.js` (one `<script>` line in
  `index.html`) adds them in the browser and loads the page again. The first load has one thread.
- `www/map/pkg/`: roadstyle's Rust module for the roads map. `build.sh` fetches the commit `ROADSTYLE_COMMIT` (a full SHA)
  of roadstyle into `target/roadstyle-<commit>` and builds the crate `roadstyle-wasm` of its Rust engine (`rust/`). With
  `ROADSTYLE_REPO=/home/kaveh/projects/roadstyle`, it fetches from the local copy. `duckosm-build` and `duckosm-parquet`
  take the drawing levels from the crate `roadstyle-levels` of the same commit (a dependency by `rev` in both `Cargo.toml` files).
  Change the three places together ([levels.md](levels.md)).

Open the page (`index.html`, the plan is [browser.md](browser.md)). A browser does not load a module from
a `file://` address, so use a local server. `serve.py` sends the two headers; `python3 -m http.server` does
not (then the page has one thread):

```bash
python3 crates/duckosm-wasm/www/serve.py 8000
```

`serve.py` also has the relay of the page ([relay.md](relay.md)): open `http://localhost:8000/?relay=relay`, and
**Get** in step 3 downloads a Geofabrik extract into the browser.

Then go to `http://localhost:8000`. The page is one app ([app.md](app.md)): choose an area on the map (a
search, a drawing or a file), select a region PBF file that covers it (the page names the smallest Geofabrik
extracts), the modes and an optional OSM fixes file, and click **Build**. The data can also come from the
Overpass API, or from a PBF file that is already cut. The build runs in a Web Worker (`build_worker.js`), which
reads the region file piece by piece. The page loads the tables into duckdb-wasm and shows the roads on the
same map. You can run SQL on the tables, and download the Parquet files and `load.sql`, which makes a
`.duckdb` file from them (`duckdb area.duckdb < load.sql`). The build side of the page is `app/duck.js`. The
page loads MapLibre, terra-draw, polyclip-ts and duckdb-wasm from cdn.jsdelivr.net, and the map from
OpenFreeMap.

Run the same `.wasm` file in Node. The script writes all files and prints the time and the WebAssembly memory:

```bash
node crates/duckosm-wasm/www/run_node.mjs tests/data/monaco.osm.pbf out-wasm driving,walking,cycling [fixes.yaml] [tags|solve|none]
```

Checks:

```bash
cargo test --release -p duckosm-wasm     # the browser build equals duckosm_build::build, byte for byte (Monaco, 3 modes, a fixes file)
python crates/duckosm-wasm/www/e2e.py tests/data/monaco.osm.pbf out-page --fixes fixes.yaml   # the page in headless Chromium (Playwright)
python crates/duckosm-wasm/www/e2e.py tests/data/monaco_sample.osm.pbf out-area --boundary tests/data/monaco.geojson   # the cut to a boundary (add --one-thread for pkg/)
duckosm-rust tests/data/monaco_sample.osm.pbf --boundary tests/data/monaco.geojson -m driving,walking,cycling -f geoparquet -o out-cli   # the same, native
```

The test writes its files to `target/tmp/<checkout>/duckosm-wasm-native/` (`<checkout>`: the folder name of the
checkout, for example `duckosm-rust`). Compare them with `cmp` to the files of
`run_node.mjs` or `e2e.py` (built with the same fixes text as the test). `e2e.py` also prints the times of
the page as JSON. The CLI writes zstd and the page writes snap, so compare `out-area` and `out-cli` by rows,
not with `cmp`.

Check the level editor of the page (card 8) in headless Chromium: open, one edit, Apply, the tables and the `.duckdb`
download, "← Steps". It writes `editor.png` and `editor-dark.png` and prints the time to open the editor:

```bash
python crates/duckosm-wasm/www/editor_e2e.py out-editor
```

Check the look of the exports in QGIS and kepler.gl (`docs/proposals/export-look.md`): QGIS with no screen draws the GeoPackage with its own
style, and kepler.gl 3.2.6 in headless Chromium draws the kepler.gl map file, at zoom 13, 15, 17 and 18 of Monaco. The script compares each
picture with the page's roads at the same view. It needs a conda environment with `qgis` from conda-forge (`QGIS_ENV`, default
`~/miniconda3/envs/qgis-headless`), and it gets kepler.gl and React from CDNs. CI has no QGIS: run it before a merge of export work.

```bash
conda create -n qgis-headless -c conda-forge qgis python=3.12                # one time; qgis=3.40 for the LTR
python crates/duckosm-wasm/www/qgis_e2e.py out-qgis
```

Check the level editor as a person uses it (real clicks, no test hook): two roads, a change, "← Steps" with the change waiting, Apply and solve.
On a computer (light and dark) and on a phone (390 × 844, touch):

```bash
python crates/duckosm-wasm/www/editor_path_e2e.py out-editor-path
```

Check the panel (the cards that follow the steps, the help windows and their links, collapse all, the main button) and the action buttons (disabled until
their inputs are ready, with the reason under them). On a computer (light and dark) and on a phone:

```bash
python crates/duckosm-wasm/www/panel_e2e.py out-panel
python crates/duckosm-wasm/www/buttons_e2e.py out-buttons
```

Check the H3 tab of card 1 (hexagons picked with clicks; the area, the cap and a build of Monaco from the cells; a phone too):

```bash
python crates/duckosm-wasm/www/h3_e2e.py out-h3
```

Check the generation of the tiles (the dashboard's red message and the hidden vector layers when the tiles are of another road set,
and the normal path):

```bash
python crates/duckosm-wasm/www/generation_e2e.py
```

Check the tile format (Monaco): MVT is the default, the style and the tile address have the format, MLT gives
the same picture, and the page keeps the choice:

```bash
python crates/duckosm-wasm/www/tile_format_e2e.py out-tile-format
```

Check the page on a phone (390 × 664, touch): roadstyle's sheet with its three heights, the map's padding, and the level editor with
its bar ([app.md](app.md), "On a phone"). It writes `phone-*.png`:

```bash
python crates/duckosm-wasm/www/phone_e2e.py out-phone
```

Check the form of roadstyle's dashboard (the bar and its tools, the panel, one look for the cards in both themes, the boxes, the settings
and the Google key, the windows; and the phone form at 390 × 844). The test needs no build of an area. It writes `dashboard-*.png`
([app.md](app.md), "roadstyle's dashboard look"):

```bash
python crates/duckosm-wasm/www/dashboard_e2e.py out-dashboard
```

Check the Design card (step 9) and the tile profile. `profile_units.mjs` runs in Node and needs no browser: the default design changes nothing in the
page's look, each theme loads in roadstyle's `Look.fromJson`, the profile repairs wrong values, the tile writers follow the profile. `design_e2e.py` builds Monaco and changes the style in each tab, then
reads the live map, the Export card, the PMTiles files and the stored design. `phone_design_e2e.py` opens each tab at 390 × 844
([app.md](app.md), "Step 9: design"):

```bash
node crates/duckosm-wasm/www/profile_units.mjs
python crates/duckosm-wasm/www/design_e2e.py out-design
python crates/duckosm-wasm/www/phone_design_e2e.py out-phone-design
```

### The deployed page: a version on each file

GitHub Pages sends `cache-control: max-age=600`. After a deploy, a browser can thus get the new `index.html` with an
old `app/duck.js` from its cache, and the page fails (for example "duck.roadstyle is not a function"). The workflow
`pages.yml` therefore runs `www/version_refs.py` on the deployed copy: it adds `?v=<the commit's short SHA>` to each
relative reference of a `.js`, `.wasm`, `.css`, `.json` or `.html` file in the `.js` and `.html` files (the imports,
`new URL(...)` of the workers and the wasm files, `fetch(...)`, and `src=` / `href=`). A new deploy thus gives new
addresses, and the browser cannot use an old file. Addresses on other sites (MapLibre, duckdb-wasm) do not change. The
script then makes sure that no relative reference of these types is left without a version, else it stops the job.
The service worker gets a version too: a new deploy installs it again, and the page loads one time more.

Test it on a copy, never on `www/` itself (the script changes the files in place):

```bash
mkdir -p /tmp/www-v && cp -r crates/duckosm-wasm/www/. /tmp/www-v/
python3 crates/duckosm-wasm/www/version_refs.py /tmp/www-v test123        # prints the number of references with a version
python crates/duckosm-wasm/www/e2e.py tests/data/monaco_sample.osm.pbf out-area --boundary tests/data/monaco.geojson --www /tmp/www-v
python crates/duckosm-wasm/www/editor_e2e.py out-editor /tmp/www-v
```

With a folder that has versions, both tests also record each request of the page and its workers. A request for a
`.js`, `.wasm`, `.json` or `.css` file of the site with no `?v=` stops the test. Add `--one-thread` to `e2e.py` to
serve the copy with no COOP and COEP headers, as GitHub Pages does: the service worker then adds them, and the build
has more than one thread.

Check the area steps of the page in headless Chromium (a file, two rectangles drawn with the mouse, a
Nominatim search, and the Build button; `--no-search` skips the search):

```bash
python crates/duckosm-wasm/www/boundary_e2e.py
```

The boundary tool uses `www/geofabrik.json`, a small copy of Geofabrik's list of extracts (Geofabrik sends no
CORS header). Make it again when Geofabrik changes its extracts:

```bash
curl -o index-v1.json https://download.geofabrik.de/index-v1.json
python tools/make_geofabrik_index.py index-v1.json crates/duckosm-wasm/www/geofabrik.json   # needs shapely
```

## Check the base-map layers

The `raw.*` cut and the base-map layers (`features.*`) of [features.md](features.md). The engine side of the check
(the raw cut against osmium's smart cut, `tools/compare_features.py`, and `crates/duckosm-build/sql/features.sql`) is in
duckOSM now, in `rust/` and `tools/`. The page side stays here: run the page on the Monaco sample with the boundary and
compare its `features_*.parquet` with the native result of duckOSM's `tools/compare_features.py --page`:

```bash
python crates/duckosm-wasm/www/e2e.py tests/data/monaco_sample.osm.pbf out-page --boundary tests/data/monaco.geojson \
    --fixes ../duckOSM/osm_overrides/osm_overrides.yaml
```

## The Python wheel and the release

The Python module (`duckosm._rust`), the wheels for 5 systems, the sdist and the CLI archives are built and tested in
duckOSM (`.github/workflows/release.yml`). This repository publishes only the page (`pages.yml`).
