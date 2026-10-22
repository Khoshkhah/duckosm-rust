# duckosm-core

Status: **design**. There is no Rust code yet.

`duckosm-core` is a Rust core for [duckOSM](https://github.com/Khoshkhah/duckOSM). It reads an
`.osm.pbf` file and writes the road edges and nodes of duckOSM as GeoParquet files. Every `edge_id`
is the same as the `edge_id` that duckOSM writes.

## Goal

Make the first step of duckOSM easy to install and easy to run:

- `pip install` a wheel. The wheel does not need DuckDB.
- One CLI program, with no Python.
- Later, a WebAssembly build for the browser.

## How it fits with duckOSM

duckOSM stays as it is. It keeps the exporters (GMNS, SUMO, MATSim, OpenDrive, Lanelet2, railML),
routing, elevation and the base-map layers. `duckosm-core` is not a rewrite of duckOSM. It does only
the network step: OSM ways in, edges and nodes out.

```text
.osm.pbf --> duckosm-core --> GeoParquet (edges, nodes) --> roadstyle, mapstyle, GeoPandas, DuckDB
                                                         \-> duckOSM (later: the rest of the pipeline)
```

## Read next

- [docs/design.md](docs/design.md): the design, the `edge_id` decision, the test plan and the milestones.
- [docs/development.md](docs/development.md): the toolchain status and the install steps.
- [tools/edge_id_reference.py](tools/edge_id_reference.py): the `edge_id` hash in plain Python.

## License

MIT, as duckOSM.
