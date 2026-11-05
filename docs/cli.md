# The CLI program

`duckosm-rust` reads an `.osm.pbf` file and writes the road networks as GeoParquet files and one DuckDB file. It needs no Python and no installed DuckDB.

## Install

Each version has one archive for each system on the [Releases](https://github.com/Khoshkhah/duckosm-rust/releases) page: Linux (x86_64, aarch64), macOS (x86_64, arm64) and Windows (x64). The Linux program needs glibc 2.35 or newer.

```bash
curl -LO https://github.com/Khoshkhah/duckosm-rust/releases/download/v0.3.0/duckosm-rust-0.3.0-linux-x86_64.tar.gz
tar xzf duckosm-rust-0.3.0-linux-x86_64.tar.gz
./duckosm-rust --version
```

To build it from the source, read [development.md](development.md).

## Build an area

1. Get an `.osm.pbf` file. [Geofabrik](https://download.geofabrik.de) has them for each country and region. For a test, use `tests/data/monaco_sample.osm.pbf` in this repository.
2. Run the program:

```bash
duckosm-rust monaco.osm.pbf -o out --name monaco --modes driving,walking,cycling
```

The program writes to `out/`: `monaco.duckdb`, one `.parquet` file for each table, and `layers.json` (the list of edge and node files with their counts). [output-tables.md](output-tables.md) lists the tables.

The Monaco sample takes less than a second. Estonia (a 121 MB file, three networks) takes 19 seconds and 1.5 GB of memory ([benchmark.md](benchmark.md)).

## Cut to an area

A region file is larger than the area that you want. Give a boundary and the program cuts the file to it:

```bash
duckosm-rust estonia.osm.pbf --boundary tartu.geojson -o out --name tartu --modes driving,walking
```

The boundary is a GeoJSON file with a Polygon or MultiPolygon. The page writes one with the button **Boundary** in step 2 (a GeoJSON file), the area (with its buffer). The cut keeps whole ways, as osmium `complete_ways` does. Without `--boundary`, the program uses the whole file.

With `--boundary`, these options add more output:

| Option | Adds |
|---|---|
| `--raw` | `raw_nodes.parquet`, `raw_ways.parquet`, `raw_relations.parquet`: the OSM data of the area. |
| `--cut-pbf`, `--cut-osm` | `cut.osm.pbf` or `cut.osm`: the cut area as a file. The page accepts `cut.osm.pbf` as a **Cut file**. |
| `--building-faces` | `building_faces_main.parquet`: the walls of the buildings. |

## Use a duckOSM config file

If you have a duckOSM `.yaml` config, give it with `--config`. The config sets the input, the output, the networks and the options.

```bash
duckosm-rust --config area.yaml --allow-skipped
```

duckOSM has steps that this program does not have. Without `--allow-skipped`, the program stops when the config asks for one. With it, the program goes on and lists the steps that it skipped.

## Fix OSM data

`--fixes FILE` gives a duckOSM OSM fixes file (`.yaml`). The program applies the rules before it builds the network. The page writes this file in step 7.

```bash
duckosm-rust area.osm.pbf -o out --fixes osm_overrides.yaml
```

## Options

| Option | Effect |
|---|---|
| `-o`, `--out DIR` | The output folder. The default is the current folder. |
| `--name NAME` | The name of the area. The database is `<out>/<name>.duckdb`. The default is `area`. |
| `-m`, `--modes LIST` | The networks, separated by commas: `driving`, `walking`, `cycling`. The default is `driving`. |
| `-f`, `--format LIST` | `duckdb`, `geoparquet`, or both. The default is both. |
| `--levels METHOD` | The drawing order of the roads: `tags` (the default), `solve` (roadstyle's optimization) or `none`. See [levels.md](levels.md). |
| `--dem FILE` | A GeoTIFF with heights (EPSG:4326, 32-bit floats). Adds heights to nodes and edges. |
| `--timing` | Prints the time of each step. |

Options that switch a step off (all are on by default):

| Option | Switches off |
|---|---|
| `--no-cycling-dismount` | The cycling edges on footways that you walk. |
| `--no-global-junctions` | The shared junctions: each network then cuts at its own junctions. |
| `--no-sidewalk-inference` | The rule that sets `sidewalk=separate` on a road with a sidewalk line on both sides. |
| `--no-connect-paths` | The connection of loose path ends to the network. `--snap-m` sets the distance (the default is 10 m). |
| `--no-speeds`, `--no-costs` | `maxspeed_kmh` and `cost_s`. |
| `--no-functional-types` | `walk_type` and `cycle_type`. |
| `--no-merge-segments` | The join of chains of edges that are one road. |
| `--no-component-filter` | The filter that keeps only the largest connected part of the graph. |
| `--no-graph`, `--no-restrictions` | `edge_graph` and `turn_permission`, or the turn restrictions. |
| `--no-ways-tables` | `ways` and `way_nodes`. Use this for a large area to save memory. |
| `--no-bus-routes` | `bus.routes` and `bus.route_edges`. |

Run `duckosm-rust --help` for the complete list for your version.
