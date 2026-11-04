---
hide:
  - navigation
  - toc
---

# duckosm-rust

Turn an OpenStreetMap file (`.osm.pbf`) into a routable road network: edges, nodes, the edge graph and the turn restrictions, for driving, walking and cycling. The output is GeoParquet files and one DuckDB file. Every row equals the output of [duckOSM](https://github.com/Khoshkhah/duckOSM) 0.6.0, and so does every `edge_id`, the key that other projects join on.

![The browser page after a build: the roads of Monaco on the map](img/dashboard/12-map-after-build.png)

[Make your first map](first_map.md){ .md-button .md-button--primary }
[View on GitHub](https://github.com/Khoshkhah/duckosm-rust){ .md-button }

## Choose a way to work

| You want to | Use | Guide |
|---|---|---|
| Choose an area on a map, see the roads, fix OSM data, export to QGIS, MATSim or SUMO | The browser page | [The browser page](dashboard.md) |
| Build an area from a file, in a script or on a server | The CLI program | [The CLI](cli.md) |
| Build an area inside Python code | The Python wheel | [The Python wheel](python.md) |

All three run the same Rust code and give the same tables. Estonia takes 19 seconds and 1.5 GB ([benchmark](benchmark.md)). duckOSM in Python takes 1,545 seconds and 10 GB.

## What you get

- **Edges and nodes** for each network, with road class, speed limit, lanes, length and travel time.
- **The edge graph and the turn restrictions**: the moves that a vehicle can make from one edge to the next.
- **Drawing levels and lane profiles**, for bridges, tunnels and lanes.
- **Base-map layers** (water, land use, buildings) and the OSM data of the area, when you give a boundary.

[The output tables](output-tables.md) lists every table and column. [Concepts](concepts.md) explains the words: area, network, edge and `edge_id`.
