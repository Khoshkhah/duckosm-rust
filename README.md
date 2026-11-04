# duckosm-rust

**Turn an OpenStreetMap file into a routable road network.** Give an `.osm.pbf` file (a country, a region or a city). Get the driving, walking and cycling networks as GeoParquet files and one DuckDB file: edges, nodes, the edge graph and the turn restrictions. Every row is equal to the output of [duckOSM](https://github.com/Khoshkhah/duckOSM) 0.6.0, and so is every `edge_id`, the key that other projects join on.

Use it in a browser page, from the command line, or from Python. All three run the same Rust code. Estonia takes 19 seconds and 1.5 GB (duckOSM in Python: 1,545 seconds and 10 GB).

![The browser page after a build: the roads of Monaco on the map](docs/img/dashboard/12-map-after-build.png)

## Start

### In the browser

Open <https://khoshkhah.github.io/duckosm-rust/>. Search for a place, press the download button of the region file that covers it, and press **Build**. The page runs on your computer, and no server receives your data. It also fixes OSM data, draws the roads with [roadstyle](https://github.com/Khoshkhah/roadstyle) and exports to PMTiles, GeoPackage, GeoJSON, MATSim and SUMO.
Next: [Your first map](docs/first_map.md) and [the page guide](docs/dashboard.md).

### On the command line

```bash
curl -LO https://github.com/Khoshkhah/duckosm-rust/releases/download/v0.3.0/duckosm-rust-0.3.0-linux-x86_64.tar.gz
tar xzf duckosm-rust-0.3.0-linux-x86_64.tar.gz
./duckosm-rust monaco.osm.pbf -o out --name monaco --modes driving,walking,cycling
```

This writes `out/monaco.duckdb` and one `.parquet` file for each table. Archives for macOS, Windows and Linux aarch64 are on the [Releases](https://github.com/Khoshkhah/duckosm-rust/releases) page.
Next: [the CLI guide](docs/cli.md).

### In Python

```bash
pip install https://github.com/Khoshkhah/duckosm-rust/releases/download/v0.3.0/duckosm_rust-0.3.0-cp39-abi3-manylinux_2_28_x86_64.whl
```

```python
import duckosm_rust as dr
res = dr.build("monaco.osm.pbf", "out/", modes=["driving", "walking"], name="monaco")
res["modes"]["driving"]["edges"]
```

The wheel has DuckDB inside and needs Python 3.9 or newer. There is no PyPI package yet.
Next: [the Python guide](docs/python.md).

## Documents

| For | Read |
|---|---|
| Users | [First map](docs/first_map.md), [page guide](docs/dashboard.md), [CLI](docs/cli.md), [Python](docs/python.md), [concepts](docs/concepts.md), [output tables](docs/output-tables.md), [troubleshooting](docs/troubleshooting.md) |
| Developers | [Development](docs/development.md), [design](docs/design.md), [page code](docs/app.md), [benchmark](docs/benchmark.md), [to do](docs/todo.md) |
| Decisions | [Name](docs/proposals/name.md), [hosting](docs/proposals/hosting.md), [disk store for the result](docs/proposals/disk-store.md) |
| History | [Changelog](CHANGELOG.md) |

The user documents are also a [mkdocs](https://www.mkdocs.org) site, as in duckOSM and roadstyle. To read it on your computer, run `pip install mkdocs mkdocs-material` and then `mkdocs serve`.

## Status

Version 0.3.0. The network step is complete. The driving, walking and cycling networks of Monaco, Tartu and Estonia equal duckOSM row for row. Only the direction labels of some connectors differ, which duckOSM does not fix. Python duckOSM uses the wheel with `options.engine: rust`.

Decided on 2026-11-04: the Rust engine moves into the duckOSM repository, as the Rust engine moved into roadstyle. This repository then keeps the browser page. The name is open: [name.md](docs/proposals/name.md).

## License

MIT, as duckOSM.
