# Development

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
cargo build --release          # the first build takes several minutes: it compiles DuckDB
cargo test --release           # hash vectors, geometry tests, and the Monaco golden test
cargo build --release --no-default-features -p duckosm-cli   # without DuckDB: GeoParquet only, 7.9 MB program, builds in under a minute
./target/release/duckosm-rust tests/data/monaco.osm.pbf -o out --name monaco --no-component-filter
```

The binary is `target/release/duckosm-rust`. `--timing` prints the time of each step.

## Check the result against duckOSM

`tests/data/golden_monaco.yaml` builds the golden database with duckOSM 0.6.0 (run it in an empty
folder, with `duckosm build --config`). Then compare every row, column and geometry byte:

```bash
python tools/compare_with_duckosm.py monaco_golden.duckdb out/monaco.duckdb [driving|walking|cycling]   # or the GeoParquet folder
```

`tests/data/golden_monaco_modes.yaml` is the config of the three-mode golden (four variants; the comments say which lines to change). `tools/make_golden_summary.py` writes `tests/data/monaco_modes_summary.tsv` from those databases. `tools/make_golden.py` writes `tests/data/monaco_driving_edges.tsv` from such a database.
`tools/edge_id_reference.py` is the `edge_id` hash in plain Python. It compares itself with the
installed DuckDB, and with every edge of a duckOSM database:

```bash
pip install duckdb
python tools/edge_id_reference.py                       # random checks
python tools/edge_id_reference.py path/to/area.duckdb   # every edge of a duckOSM database
```

## Benchmark

See [benchmark.md](benchmark.md). The runner is `bench/run_bench.py`.

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
- `www/map/pkg/`: roadstyle's Rust module for the roads map. `build.sh` clones geolibre-roadstyle into
  `target/geolibre-roadstyle` and builds its `spike/rust` at the commit `ROADSTYLE_COMMIT`. With
  `ROADSTYLE_REPO=/home/kaveh/projects/geolibre-roadstyle`, it clones the local copy.

Open the page (`index.html`, the plan is [browser.md](browser.md)). A browser does not load a module from
a `file://` address, so use a local server. `serve.py` sends the two headers; `python3 -m http.server` does
not (then the page has one thread):

```bash
python3 crates/duckosm-wasm/www/serve.py 8000
```

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
node crates/duckosm-wasm/www/run_node.mjs tests/data/monaco.osm.pbf out-wasm driving,walking,cycling [fixes.yaml]
```

Checks:

```bash
cargo test --release -p duckosm-wasm     # the browser build equals duckosm_build::build, byte for byte (Monaco, 3 modes, a fixes file)
python crates/duckosm-wasm/www/e2e.py tests/data/monaco.osm.pbf out-page --fixes fixes.yaml   # the page in headless Chromium (Playwright)
python crates/duckosm-wasm/www/e2e.py tests/data/monaco_sample.osm.pbf out-area --boundary tests/data/monaco.geojson   # the cut to a boundary (add --one-thread for pkg/)
duckosm-rust tests/data/monaco_sample.osm.pbf --boundary tests/data/monaco.geojson -m driving,walking,cycling -f geoparquet -o out-cli   # the same, native
```

The test writes its files to `target/tmp/duckosm-wasm-native/`. Compare them with `cmp` to the files of
`run_node.mjs` or `e2e.py` (built with the same fixes text as the test). `e2e.py` also prints the times of
the page as JSON. The CLI writes zstd and the page writes snap, so compare `out-area` and `out-cli` by rows,
not with `cmp`.

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

## Check the OSM fixes

`monaco.duckdb` of duckOSM is built with its OSM fixes file, so all driving rows must be equal:

```bash
./target/release/duckosm-rust tests/data/monaco.osm.pbf -o out-fixes --fixes ../duckOSM/osm_overrides/osm_overrides.yaml
python tools/compare_with_duckosm.py ../duckOSM/monaco.duckdb out-fixes driving
```

## Check another area (example: Tartu)

Build the golden with duckOSM, then run duckosm-rust with the matching flags and compare. The yaml is
`tests/data/golden_monaco_modes.yaml` with `pbf_path` changed and the switches set (see the comments in it).

```bash
# duckOSM (in an empty folder; the lane profile step is switched off because it is slow and not part of the network step)
python bench/python_steps.py g.yaml --no-lane-profile
# duckosm-rust, same settings as g.yaml (here: no boundary, merge on, global junctions on, sidewalk rule on, connector on)
duckosm-rust area.osm.pbf -o out --format geoparquet --modes driving,walking,cycling --no-component-filter
python tools/compare_with_duckosm.py golden.duckdb out walking
```

Switches: `--no-functional-types`, `--no-speeds`, `--no-costs`, `--no-merge-segments`, `--no-global-junctions`, `--no-sidewalk-inference`, `--no-connect-paths`,
`--no-component-filter`. With a boundary in the yaml (and `build_graph`, `process_speeds` and
`calculate_costs` on, because duckOSM runs the component filter only then), give duckosm-rust the cut file
that duckOSM wrote in `pbf/` and leave the component filter on.

Known difference: a connector between two facing dangling ends can have the other direction label
(`edge_ref`, `is_reverse`, sometimes `highway`). See section 6 of the design.

## Build and test the Python wheel

```bash
python3 -m venv .venv && .venv/bin/pip install maturin
.venv/bin/maturin build --release -m crates/duckosm-py/Cargo.toml -o wheels          # with DuckDB (the first build takes minutes)
.venv/bin/maturin build --release -m crates/duckosm-py/Cargo.toml --no-default-features -o wheels_small   # without DuckDB: 2 MB
python3 -m venv /tmp/t && /tmp/t/bin/pip install wheels/duckosm_rust-*.whl duckdb && /tmp/t/bin/python tests/test_wheel.py
```

## Wheels for other systems

`.github/workflows/ci.yml` builds the wheel on 5 targets (Linux x86_64 and aarch64 with manylinux 2_28, macOS
x86_64 and arm64, Windows x64), plus the sdist, runs `tests/test_wheel.py` on each wheel, runs the Rust tests and
the WebAssembly build with the test of `duckosm-wasm`. It runs on each push to `main` of
[Khoshkhah/duckosm-rust](https://github.com/Khoshkhah/duckosm-rust) (private) and on each pull request. The
results are on the Actions page of the repository. It does not publish.

What was checked on this machine (Linux x86_64, 2026-10-21):

```bash
pip install maturin ziglang
maturin build --release --zig --compatibility manylinux2014 -m crates/duckosm-py/Cargo.toml -o wheels   # 13.6 MB, glibc 2.17 or newer
maturin sdist -m crates/duckosm-py/Cargo.toml -o sdist                                                  # 46 KB, contains all crates
```

The `manylinux2014` wheel with DuckDB needs only glibc 2.17 (it has no libstdc++ dependency) and passed
`tests/test_wheel.py` in a new virtual environment. The wheel from a plain `maturin build` needs glibc 2.35.
Not checked: macOS, Windows, aarch64, and a real old Linux distribution.
