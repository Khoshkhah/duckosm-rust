# duckosm-rust

Status: **design**. There is no Rust code yet.

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

## Read next

- [docs/design.md](docs/design.md): the design, the `edge_id` decision, the test plan and the milestones.
- [docs/development.md](docs/development.md): the toolchain status and the install steps.
- [tools/edge_id_reference.py](tools/edge_id_reference.py): the `edge_id` hash in plain Python.

## License

MIT, as duckOSM.
