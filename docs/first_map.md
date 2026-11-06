# Your first map

Make a map of Monaco. It takes about five minutes.

1. Open <https://khoshkhah.github.io/duckosm-studio/>. If the page loads a second time, wait. This is normal ([When the page does not work](troubleshooting.md)).
2. In step 1, type `Monaco` in the search field. Click the match for Monaco. The map shows the boundary.

    ![Step 1: the search and its matches](img/dashboard/02-search.png)

3. In step 3, under **Region file**, press **Get** for the Geofabrik file that covers the area. The page keeps the file. The next time, press **Use**.

    ![Step 3: the region files that cover the area](img/dashboard/07-data.png)

4. In step 4, press **Build**. **Driving**, **Walking** and **Cycling** are on by default.
5. Look at the map. The page draws an area of fewer than 20,000 roads by itself. For a larger area, press **Show on map** in step 6.

    ![The roads of Monaco on the map after a build](img/dashboard/12-map-after-build.png)

6. In step 5, press **.zip** to download the tables as Parquet files. Or press **.duckdb** to get one DuckDB file.

The page saves the build. Next time, find it in **Your areas** and press **Open** ([Your areas](dashboard.md#your-areas)).

## Next

- [Fix the OSM data and build again](manual/edit-osm.md).
- [Export the network to QGIS, MATSim, SUMO or a tile server](manual/export.md).
- [Query the tables with SQL](manual/ask.md).
- [See all the steps](manual/cycle.md).
