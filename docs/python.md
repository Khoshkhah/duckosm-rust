# The Python wheel

The module `duckosm_rust` builds the same tables as the CLI, from Python. DuckDB is inside the wheel, so you do not need to install it. The wheel works with Python 3.9 and newer.

## Install

Each version has wheels for Linux (x86_64, aarch64), macOS (x86_64, arm64) and Windows (x64) on the [Releases](https://github.com/Khoshkhah/duckosm-rust/releases) page. There is no PyPI package yet.

```bash
pip install https://github.com/Khoshkhah/duckosm-rust/releases/download/v0.3.0/duckosm_rust-0.3.0-cp39-abi3-manylinux_2_28_x86_64.whl
```

For another system, choose the file name of your system from the Releases page. To build the wheel from the source, read [development.md](development.md).

## Build an area

```python
import duckosm_rust as dr

res = dr.build("monaco.osm.pbf", "out/", modes=["driving", "walking"], name="monaco")
res["modes"]["driving"]["edges"]      # the number of driving edges
```

`build` writes the files that the [CLI](cli.md) writes. It returns a dict with the numbers of each network, the files that it wrote and the time of each step. The build runs without the Python lock, so other threads go on.

The keyword names are the names of the duckOSM options:

| Keyword | Default | Meaning |
|---|---|---|
| `modes` | `["driving"]` | The networks. |
| `name` | `"area"` | The name of the area. |
| `formats` | both | `["duckdb"]`, `["geoparquet"]` or both. |
| `boundary` | none | A GeoJSON file. The program cuts the PBF to it. |
| `osm_overrides` | none | A duckOSM OSM fixes file (`.yaml`). |
| `levels` | `"tags"` | `"tags"`, `"solve"` or `"none"`. |
| `merge_segments`, `global_junctions`, `keep_largest_component`, `cycling_dismount`, `infer_separate_sidewalks`, `connectivity_rescue`, `process_speeds`, `calculate_costs`, `functional_types`, `build_graph`, `extract_restrictions`, `ways_tables`, `bus_routes` | `True` | The same switches as the `--no-...` options of the CLI. |
| `connect_snap_m` | `10.0` | The distance for the connection of loose path ends, in meters. |

## Use a duckOSM config file

```python
res = dr.build_from_config("area.yaml", strict=False)
res["skipped"]      # the duckOSM steps that this module does not have
```

With `strict=True` (the default), the call raises an error when the config asks for a step that this module does not have. The other keywords are `formats`, `out` and `pbf_is_cut`.

## Compute an `edge_id`

```python
dr.edge_id_hash(167625756, 1790048630, 25185687)     # 16871577064511426, the edge_id in edges.parquet of the Monaco sample
```

[tools/edge_id_reference.py](https://github.com/Khoshkhah/duckosm-rust/blob/main/tools/edge_id_reference.py) has the same hash in plain Python.

## Use it with duckOSM

Python duckOSM uses this wheel with `options.engine: rust` (or `--engine rust`). Python then runs the steps that this module does not have. The tables are the same.

## Read the output

```python
import duckdb
con = duckdb.connect("out/monaco.duckdb")
con.sql("select highway, count(*) from driving.edges group by 1 order by 2 desc").show()
```

[output-tables.md](output-tables.md) lists the tables and columns. GeoPandas reads the `.parquet` files directly with `geopandas.read_parquet`.
