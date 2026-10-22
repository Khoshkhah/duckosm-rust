# duckosm-rust

Status: **the network step is complete, release 0.1.0 is in preparation**. The driving, walking and cycling networks of Monaco, Tartu and Estonia equal the output of duckOSM (every row of every table; only the direction labels of some connectors differ, which duckOSM does not fix). Estonia takes 19 s and 1.5 GB, against 1,545 s and 10 GB in duckOSM. It also builds the edge graph and the turn restrictions. Python duckOSM can use it with `options.engine: rust`. A WebAssembly build runs the same network step in a browser tab. See [docs/design.md](docs/design.md) and [docs/benchmark.md](docs/benchmark.md).

The repository is [Khoshkhah/duckosm-rust](https://github.com/Khoshkhah/duckosm-rust) (private).

`duckosm-rust` is the Rust part of [duckOSM](https://github.com/Khoshkhah/duckOSM). It is a Cargo
workspace. The first crate, `duckosm-core`, reads an `.osm.pbf` file and writes the road edges and
nodes of duckOSM as GeoParquet files. Every `edge_id` is the same as the `edge_id` that duckOSM writes.

## Goal

Make the first step of duckOSM easy to install and easy to run:

- `pip install` a wheel. The wheel does not need DuckDB.
- One CLI program, with no Python.
- A WebAssembly build for the browser: a PBF file in, GeoParquet files out, with no server.

## How it fits with duckOSM

The first scope is the network step: OSM ways in, edges and nodes out. The long-term goal is larger.
Over time, each part of duckOSM that suits Rust moves to its own crate. Python duckOSM keeps its API
and calls the Rust wheel part by part. The parts that use Python libraries or external tools stay in
Python. Section 11 of the design rates every part.

```text
.osm.pbf --> duckosm-rust --> GeoParquet (edges, nodes) --> roadstyle, mapstyle, GeoPandas, DuckDB
                                                         \-> duckOSM (later: the rest of the pipeline)
```

## Use it

```bash
# the program (a CLI)
cargo build --release          # target/release/duckosm-rust
duckosm-rust area.osm.pbf -o out --name area --modes driving,walking,cycling   # out/area.duckdb and out/*.parquet
duckosm-rust --config area.yaml --allow-skipped                                # a duckOSM config file
duckosm-rust area.osm.pbf -o out --fixes osm_overrides.yaml                    # with the OSM fixes file of duckOSM

# the Python wheel
pip install maturin && maturin build --release -m crates/duckosm-py/Cargo.toml    # then pip install the wheel
```

```python
import duckosm_rust as dr
res = dr.build("area.osm.pbf", "out/", modes=["driving", "walking"], name="area",
               osm_overrides="osm_overrides.yaml")     # optional: the OSM fixes file of duckOSM
res["modes"]["driving"]["edges"]
res = dr.build_from_config("area.yaml", strict=False)   # res["skipped"]: duckOSM steps that are not here
dr.edge_id_hash(osm_id, source, target)
```

```bash
# the browser page (WebAssembly): build it, then open http://localhost:8000 and select a PBF file
cargo build --release --target wasm32-unknown-unknown -p duckosm-wasm
wasm-bindgen --target web --out-dir crates/duckosm-wasm/www/pkg target/wasm32-unknown-unknown/release/duckosm_wasm.wasm
python3 -m http.server 8000 -d crates/duckosm-wasm/www
```

In the browser, a city or a region fits: Estonia (121 MB PBF) uses 710 MiB, and Kentucky (148 MB)
uses 2,053 MiB of the 4 GB limit. Section 7 of the design has the numbers.

## Read next

- [docs/design.md](docs/design.md): the design, the `edge_id` decision, the test plan and the milestones.
- [docs/development.md](docs/development.md): the toolchain status, the install steps and the WebAssembly build.
- [tools/edge_id_reference.py](tools/edge_id_reference.py): the `edge_id` hash in plain Python.

## License

MIT, as duckOSM.
