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
python tools/compare_with_duckosm.py monaco_golden.duckdb out/monaco.duckdb   # or the GeoParquet folder
```

`tools/make_golden.py` writes `tests/data/monaco_driving_edges.tsv` from such a database.
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
