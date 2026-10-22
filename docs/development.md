# Development

## Toolchain status (2026-10-21)

| Tool | Status |
|---|---|
| `rustc`, `cargo`, `rustup` | Installed on 2026-10-21 with `rustup` at user level (`~/.cargo`, `~/.rustup`, profile `default`, channel `stable`). Version 1.99.1. The installer added `~/.cargo/bin` to the `PATH` in the shell profile. |
| `g++`, `cmake`, `make` | Installed (system). The `duckdb` crate needs a C++ compiler. |
| `maturin` | Not installed. It is needed from M3 (Python wheel). |
| `wasm32-unknown-unknown` target | Installed (`rustup target add`). Compile checks only; see section 7 of the design. |

## Install Rust

Done on this machine. On a new machine:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile default
source "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown   # M4 (compile check done)
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

## WebAssembly compile check

```bash
cargo build --release -p duckosm-core --target wasm32-unknown-unknown
cargo build --release -p duckosm-parquet --no-default-features --features snap --target wasm32-unknown-unknown
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
the WebAssembly compile check. **It has never run**: the repository has no remote. It does not publish.

What was checked on this machine (Linux x86_64, 2026-10-21):

```bash
pip install maturin ziglang
maturin build --release --zig --compatibility manylinux2014 -m crates/duckosm-py/Cargo.toml -o wheels   # 13.6 MB, glibc 2.17 or newer
maturin sdist -m crates/duckosm-py/Cargo.toml -o sdist                                                  # 46 KB, contains all crates
```

The `manylinux2014` wheel with DuckDB needs only glibc 2.17 (it has no libstdc++ dependency) and passed
`tests/test_wheel.py` in a new virtual environment. The wheel from a plain `maturin build` needs glibc 2.35.
Not checked: macOS, Windows, aarch64, and a real old Linux distribution.
