# duckosm-rust

Status: **spike**. The driving, walking and cycling networks of Monaco equal the output of duckOSM (every row), with and without `merge_segments`, with the sidewalk rule, and with the dangling-path connector. See [docs/design.md](docs/design.md) and [docs/benchmark.md](docs/benchmark.md).

`duckosm-rust` is the Rust part of [duckOSM](https://github.com/Khoshkhah/duckOSM). It is a Cargo
workspace. The first crate, `duckosm-core`, reads an `.osm.pbf` file and writes the road edges and
nodes of duckOSM as GeoParquet files. Every `edge_id` is the same as the `edge_id` that duckOSM writes.

## Goal

Make the first step of duckOSM easy to install and easy to run:

- `pip install` a wheel. The wheel does not need DuckDB.
- One CLI program, with no Python.
- Later, a WebAssembly build for the browser.

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

# the Python wheel
pip install maturin && maturin build --release -m crates/duckosm-py/Cargo.toml    # then pip install the wheel
```

```python
import duckosm_rust as dr
res = dr.build("area.osm.pbf", "out/", modes=["driving", "walking"], name="area")
res["modes"]["driving"]["edges"]
res = dr.build_from_config("area.yaml", strict=False)   # res["skipped"]: duckOSM steps that are not here
dr.edge_id_hash(osm_id, source, target)
```

## Read next

- [docs/design.md](docs/design.md): the design, the `edge_id` decision, the test plan and the milestones.
- [docs/development.md](docs/development.md): the toolchain status and the install steps.
- [tools/edge_id_reference.py](tools/edge_id_reference.py): the `edge_id` hash in plain Python.

## License

MIT, as duckOSM.
