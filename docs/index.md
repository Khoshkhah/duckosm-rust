---
hide:
  - navigation
  - toc
---

# duckOSM Studio

**Make a routable road network from OpenStreetMap data, in your browser.**

Choose an area. The page builds the driving, walking and cycling networks. Fix the OSM data, build again, and export. The build runs in your browser.

![The page after a build: the roads of Monaco on the map](img/dashboard/12-map-after-build.png)

[Open duckOSM Studio](https://khoshkhah.github.io/duckosm-studio/){ .md-button .md-button--primary }
[Make your first map](first_map.md){ .md-button }
[View on GitHub](https://github.com/Khoshkhah/duckosm-studio){ .md-button }

## What you get

- **Nothing to install.** Open the page and start.
- **A routable network.** Each edge has a length, a speed and a travel time. The build applies the turn restrictions.
- **A stable `edge_id`.** The same road has the same `edge_id` in every build.
- **Fast.** Estonia takes 19 seconds ([benchmark](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/benchmark.md)).
- **The same tables as [duckOSM](https://github.com/Khoshkhah/duckOSM).**
- **A fix loop.** Change a road, a building, a node or a turn rule. Build again.
- **Export** to PMTiles, MBTiles, GeoPackage, GeoJSON, kepler.gl, MATSim and SUMO.

## Read the manual

| Page | Use it to |
|---|---|
| [The editing cycle](manual/cycle.md) | See all the work on one picture. |
| [The page](dashboard.md) | Know the parts of the window. |
| [Steps 1 and 2](manual/area.md) | Choose the area. |
| [Steps 3 and 4](manual/build.md) | Get the data and build. |
| [Steps 5 and 6](manual/result.md) | Download the result and show the map. |
| [Step 7](manual/edit-osm.md) and [the fixes file](manual/fixes-file.md) | Fix the OSM data. |
| [Step 8](manual/edit-levels.md) | Fix bridges and tunnels. |
| [Step 9](manual/edit-design.md) | Set the look of the map. |
| [Step 10](manual/export.md) | Export the network. |
| [Ask and query the data](manual/ask.md) | Query the tables with SQL, or ask in words. |
| [The tables](manual/tables.md), [the roads](manual/roads.md), [the columns](output-tables.md) | Know what the result holds. |
| [Concepts](concepts.md) | Learn the words. |
| [Command line and Python](cli.md) | Build from a script. |

## Built on

[roadstyle](https://github.com/Khoshkhah/roadstyle) (the map and the dashboard), [duckOSM](https://github.com/Khoshkhah/duckOSM) (the engine and the fixes editor), [MapLibre GL JS](https://maplibre.org/), [DuckDB](https://duckdb.org/), [OpenFreeMap](https://openfreemap.org/) (the base map) and [OpenStreetMap](https://www.openstreetmap.org/copyright) (the data, © OpenStreetMap contributors, ODbL).
