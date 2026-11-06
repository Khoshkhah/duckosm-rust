# Steps 5 and 6: Result and map

After a build, step 5 gives you the tables, and step 6 draws the roads on the map.

## Step 5: The result

![Card 5: the result table, the downloads and the list of tables](../img/dashboard/10-result.png)

### The downloads

| Button | File | Use |
|---|---|---|
| **.zip** | All tables as Parquet files | Open them in Python, QGIS or DuckDB. |
| **.duckdb** | One DuckDB database | Open it with DuckDB. |
| **.osm.pbf** | The OSM data, cut to the area. Only when the page cut the data. | Build again without the large file. |
| **.yaml** | The fixes file of this build. With no fixes: an empty fixes file to start from. | Use it in the next build. |

### Query the tables

To query the tables in the page, see [Ask and query the data](ask.md). In DuckDB, write the network before the table name:

```sql
-- the length of the roads of each class, in km
SELECT highway, count(*) AS edges, round(sum(length_m) / 1000, 1) AS km
FROM driving.edges GROUP BY highway ORDER BY edges DESC;
```

### See each table

![The list of tables of a build](../img/dashboard/38-each-table.png)

Open **Each table** to see each table and its number of rows. [The tables](tables.md) explains each table.

## Step 6: Show the roads

![Card 6: the network, the tile format and the button Show on map](../img/dashboard/11-visualization.png)

A small area shows on the map after the build. For an area with more than 20,000 roads, do these steps:

1. If you built more than one network, choose the **Network**.
2. Choose the **Map tiles**: MLT (the default, smaller) or MVT.
3. Press **Show on map**.

The map can show 200,000 roads on a computer and 40,000 on a small device. Click a road to see its data.

![The roads of Monaco on the map after a build](../img/dashboard/12-map-after-build.png)

## Next

- If a road, a building or a turn is wrong, go to [step 7](edit-osm.md).
- If the data is correct, go to [step 8](edit-levels.md) or [step 10](export.md).
