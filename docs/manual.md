# User manual

This manual is for people who want to make a road network from OpenStreetMap data. You do not need to know Rust. The developer documents are in [development.md](development.md) and [design.md](design.md).

## What you make

You give a part of the world (an area) and OpenStreetMap data. You get a routable road network for each way of travel (driving, walking, cycling):

- **edges**: the pieces of road between two junctions, with class, speed limit, lanes, length and travel time;
- **nodes**: the junctions;
- **the edge graph and the turn restrictions**: the moves that a vehicle can make from one edge to the next.

The tables are GeoParquet files and one DuckDB file. Every row is equal to the output of [duckOSM](https://github.com/Khoshkhah/duckOSM) 0.6.0, including `edge_id`. Other projects join on that key. [output-tables.md](output-tables.md) lists every table and column.

## Choose a way to work

| You want to | Use | Guide |
|---|---|---|
| Choose an area on a map, see the roads, fix OSM data, export to QGIS, MATSim or SUMO | The browser page | [dashboard.md](dashboard.md) |
| Build an area from a file in a script or on a server | The CLI program | [cli.md](cli.md) |
| Build an area inside Python code | The Python wheel | [python.md](python.md) |

All three ways run the same code. They give the same tables.

## Your first map in the browser

This procedure makes a map of Monaco. It takes about five minutes. Each step names the part of the [page guide](dashboard.md) that has the details.

1. Open <https://khoshkhah.github.io/duckosm-rust/>. If the page loads a second time, wait. This is normal (see [When the page does not work](#when-the-page-does-not-work)).
2. In step 1, type `Monaco` in **Search** and click the match for Monaco. The map shows the boundary. ([Step 1](dashboard.md#step-1-choose-an-area))
3. In step 3, under **Region file**, press the download button of the Geofabrik extract that covers the area. The page gets the file through a relay and keeps it in your browser. You can also select an `.osm.pbf` file that you have. ([Step 3](dashboard.md#step-3-the-data))
4. In step 4, keep **Driving** on, then press **Build**. ([Step 4](dashboard.md#step-4-build))
5. In step 6, press **Show on map**. The roads of Monaco show on the map. ([Step 6](dashboard.md#step-6-visualization))
6. In step 5, press **.zip** to download the tables, or run an SQL query on them. ([Step 5](dashboard.md#step-5-the-result))

The page saves the build in your browser. When you come back, **Your areas** lists it and **Open** loads it with no new build. ([Your areas](dashboard.md#your-areas))

## What the page can do after the first map

| Task | Where |
|---|---|
| Choose an area with a drawing, a GeoJSON file or H3 hexagons | [Step 1](dashboard.md#step-1-choose-an-area) |
| Add a buffer around the area | [Step 2](dashboard.md#step-2-the-area) |
| Build from Overpass or from a file that is already cut | [Step 3](dashboard.md#step-3-the-data) |
| Change a road, a building, a node or a turn rule, then build again | [Step 7](dashboard.md#step-7-fix-osm-data) |
| Edit the drawing levels of bridges and tunnels | [Step 8](dashboard.md#step-8-edit-levels) |
| Give the network to QGIS, MATSim, SUMO or a tile server | [Step 9](dashboard.md#step-9-export) |
| Know the size limits | [Limits](dashboard.md#limits-and-things-to-know) |

## Concepts

**Area.** The part of the world that you build. It is a shape (GeoJSON). The program cuts the OSM data to the shape. The cut keeps whole ways, as osmium `complete_ways` does.

**Region file.** An `.osm.pbf` file for a country or a region. [Geofabrik](https://download.geofabrik.de) publishes them. The area must be inside the region file.

**Network.** The roads that one way of travel can use. The program builds `driving`, `walking` and `cycling`. A road can be in more than one network.

**Edge.** One directed piece of road between two junctions. A two-way street gives two edges.

**`edge_id`.** A number (BIGINT) that the program computes from the OSM way, the source node and the target node. The same road gives the same `edge_id` in every build. The program never numbers edges in order.

## When the page does not work

- **A large area fails.** The page needs memory for the area. Estonia (a 121 MB region file) uses about 710 MiB. A small device can fail on a large area. Choose a smaller area.
- **The page loads twice at the first visit.** The page needs headers that make the browser use threads. The host cannot send them, so a small script in the page adds them and loads the page again. In a test with a fast link, the second load starts after about half a second. A hard reload (Shift + reload) skips the script, and the page then builds with one thread. [hosting.md](proposals/hosting.md) has the reason.
- **A red bar says "the browser may have an old file".** Press Ctrl+Shift+R one time.
- **Street View or Google 3D shows nothing.** These tools need a key. [Keys and settings](dashboard.md#keys-and-settings) tells you how to give one.

## Other documents

| Document | Read it to |
|---|---|
| [output-tables.md](output-tables.md) | See every table and column. |
| [dashboard.md](dashboard.md) | Use each part of the page. |
| [cli.md](cli.md) | Use the CLI program. |
| [python.md](python.md) | Use the Python wheel. |
| [benchmark.md](benchmark.md) | See the time and memory of a build. |
| [CHANGELOG.md](../CHANGELOG.md) | See what changed in each version. |
