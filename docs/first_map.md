# Your first map

This procedure makes a map of Monaco in the browser. It takes about five minutes. Each step names the part of [the page guide](dashboard.md) that has the details.

1. Open <https://khoshkhah.github.io/duckosm-rust/>. If the page loads a second time, wait. This is normal (see [When the page does not work](troubleshooting.md)).
2. In step 1, type `Monaco` in **Search** and click the match for Monaco. The map shows the boundary. ([Step 1](dashboard.md#step-1-choose-an-area))
3. In step 3, under **Region file**, press the download button of the Geofabrik extract that covers the area. The page gets the file through a relay and keeps it in your browser. You can also select an `.osm.pbf` file that you have. ([Step 3](dashboard.md#step-3-the-data))
4. In step 4, keep **Driving** on, then press **Build**. ([Step 4](dashboard.md#step-4-build))
5. In step 6, press **Show on map**. The roads of Monaco show on the map. ([Step 6](dashboard.md#step-6-visualization))
6. In step 5, press **.zip** to download the tables, or run an SQL query on them. ([Step 5](dashboard.md#step-5-the-result))

The page saves the build in your browser. When you come back, **Your areas** lists it and **Open** loads it with no new build. ([Your areas](dashboard.md#your-areas))

## Next

| Task | Where |
|---|---|
| Choose an area with a drawing, a GeoJSON file or H3 hexagons | [Step 1](dashboard.md#step-1-choose-an-area) |
| Add a buffer around the area | [Step 2](dashboard.md#step-2-the-area) |
| Build from Overpass or from a file that is already cut | [Step 3](dashboard.md#step-3-the-data) |
| Change a road, a building, a node or a turn rule, then build again | [Step 7](dashboard.md#step-7-fix-osm-data) |
| Edit the drawing levels of bridges and tunnels | [Step 8](dashboard.md#step-8-edit-levels) |
| Give the network to QGIS, MATSim, SUMO or a tile server | [Step 9](dashboard.md#step-9-export) |
| Build the same area from a script | [The CLI](cli.md), [the Python wheel](python.md) |
| Know the size limits | [Limits](dashboard.md#limits-and-things-to-know) |
