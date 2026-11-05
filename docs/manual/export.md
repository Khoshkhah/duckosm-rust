# Step 10: Export

Card 10 gives the network and its map to other software. It is gray until a build ends. The page makes each file in your browser from the tables. Press **Download** for the format that you want.

![Card 10: the formats of the export, in groups](../img/dashboard/11b-export.png)
<!-- retake: after duckosm-rust #76 and roadstyle #39 (the export redesign) -->

The card has four groups: **Tiles**, **Network**, **Visualization** and **Simulation**. In **Network**, pick **Driving**, **Walking** or **Cycling**. The group shows when you built more than one network. The network sets the files of **Visualization** and **Simulation**. The tiles do not use it.

## Which format to use

| You want to | Use | You get |
|---|---|---|
| Put the map on a web page | **Web map** | A `.zip` with the tiles, the style and a viewer. |
| Make your own web map with MapLibre | **PMTiles** and **MapLibre style** | One tile file, and the style of this page's map. |
| Serve tiles with a tile server, or open them in QGIS | **MBTiles** | The same tiles in a SQLite file. |
| Analyze the roads in QGIS or ArcGIS | **GeoPackage** | Roads and nodes in one `.gpkg` file. |
| Draw the roads in QGIS like the page | **GeoJSON roads** and **QGIS style** | A GeoJSON file, and a `.qml` style for it. |
| Put the roads on kepler.gl | **kepler.gl map** or **GeoJSON roads** | A `.json` file, or a GeoJSON file. |
| Put a picture in a report | **Map image (SVG)** or **Map image (PNG)** | A vector picture, or a bitmap. |
| Use the other layers of the map | **GeoJSON layers** | A `.zip` with one GeoJSON file for each layer. |
| Use the junctions as points | **GeoJSON nodes** | A file of points. |
| Run a traffic simulation | **MATSim network** or **SUMO plain XML** | Input files for the simulator. |

## The formats

`<area>` is the name of the area. `<network>` is `driving`, `walking` or `cycling`.

| Format | File | What it has |
|---|---|---|
| **MapLibre style** | `<area>_style.json` | The style of this page's map. It reads `tiles.pmtiles`. Use it with Maputnik or a MapLibre app. |
| **Web map** | `<area>_webmap.zip` | `tiles.pmtiles`, `style.json`, `index.html` (a MapLibre viewer), `serve.py` and a `README.txt`. Unpack it, run `python serve.py` in the folder, and open `http://localhost:8000/`. The viewer needs internet for MapLibre. |
| **PMTiles** | `<area>_z<min>-<max>.pmtiles` | The tiles of the map as MVT, in one PMTiles v3 file. |
| **MBTiles** | `<area>_z<min>-<max>.mbtiles` | The same tiles in a SQLite file. |
| **GeoPackage** | `<area>_<network>.gpkg` | The tables `roads` (the center lines) and `nodes` (points) in EPSG:4326, and the other layers. The style of `roads` inside is the look of this page's map: colors, casings, a width for each zoom, bridges over tunnels, and each direction on its side. Tested with QGIS 3.40 and 4.2. |
| **Map image (PNG)** | `<area>_map.png` | One picture of the area, in the style of the map. The check box **Transparent background** keeps the alpha channel. |
| **Map image (SVG)** | `<area>_<network>_map.svg` | One vector picture: land, water, buildings and roads with casings. |
| **kepler.gl map** | `<area>_<network>_kepler.json` | The roads of **GeoJSON roads** with a casing and a fill layer, at the widths of this page's map at zoom 17. Drop the file on kepler.gl. |
| **QGIS style** | `<area>_<network>_roads.qml` | The style of the GeoPackage's `roads`, as a file. In QGIS, open Layer Styling, then Style, then Load Style. |
| **GeoJSON roads** | `<area>_<network>_roads.geojson` | A line for each edge, moved to the side of its direction. A two-way road is two features, one for each direction. Each feature has the look of zoom 17: `fill_color`, `fill_width_m`, `casing_color`, `casing_width_m` and `stroke`. |
| **GeoJSON layers** | `<area>_<network>_layers_geojson.zip` | One GeoJSON file for each other layer: buildings, water, land use, railways, street names and arrows. |
| **GeoJSON nodes** | `<area>_<network>_nodes.geojson` | The junctions and the ends of the roads, with `node_id`. |
| **MATSim network** | `<area>_<network>_matsim_network.xml` | A `network_v2.dtd` file. A node for each node. A link for each edge, with its length, free speed, capacity, lanes and mode. Coordinates are meters in the UTM zone. |
| **SUMO plain XML** | `<area>_sumo.zip` | `.nod.xml`, `.edg.xml`, `.con.xml` and a `README.txt` with the `netconvert` command. |

A file that the card made: the **Map image (SVG)** of Monaco.

![The Map image (SVG) of Monaco, made by the card Export](../img/dashboard/40-export-map.svg)

## GeoJSON roads and GeoPackage

A two-way road has two edges in the tables. In GeoJSON and in the GeoPackage, each direction is one feature, with its own `edge_id`. These properties tell the two apart:

- `twoway` is true when the road has two directions.
- `direction` is `forward` or `reverse`.
- `edge_id_pair` is the `edge_id` of the other direction.

The GeoPackage keeps the center lines, and its QGIS style draws each direction on its side. The GeoJSON file moves each line to its side (`offset_m`), because kepler.gl and most web maps cannot offset a line.

For GeoJSON roads, the check box **One feature for a two-way road (the center lines, no look)** gives one center line for the two directions. It is the forward edge, with `edge_id_reverse`.

## Tiles

The tiles are the tiles of the map on the screen. The map worker makes them again as MVT. The [tile profile](edit-design.md#tiles) of step 9 sets what they hold. The card shows the name of the profile, and these fields:

- **Layer edges.** The export has the layer `edges`, with every road of every network and the columns of the profile. If the map shows one network, the page switches it to **All** and draws it again first. Monaco gives a file of about 5.6 MB with the Analysis profile.
- **Zoom from ... to ...** The lowest and the highest zoom, from 0 to 18. **The highest zoom that fits the limit** picks the highest zoom that keeps the tiles under the limit (zoom 16 at most).
- The number of tiles. The limit is 40,000 tiles unless you change it. If the number is higher, the buttons are off. Use fewer zooms, or raise the limit.
- The tile buttons are off until **Show on map** (step 6) has drawn the map.

What a tile has:

| Layer | What it is |
|---|---|
| `edges` | One line for each piece of a road in the tile, with the columns of the profile: `edge_id`, `osm_id`, `source`, `target`, `name`, `highway`, `oneway`, `lanes`, `surface`, `maxspeed_kmh`, `bridge`, `tunnel`, `length_m`, `cost_s` and more. A flag for each network says which network has the edge. A lower road class starts at a higher zoom. |
| `simple`, `slots` | The layers of roadstyle that draw the roads, the names and the arrows. |
| `ov0`, `ov1`, ... | The layers of the base map: water, land use, buildings and more. They need a build with **Layers** on. |

**Tiles have no style.** A tile file has the shapes and the data of the map, not its colors. A program that reads the tiles directly, for example QGIS, draws thin lines. To see the map as the page draws it, use the **Web map** package, or load the **MapLibre style** with the PMTiles file.

## The check

After each download, the page reads the file that it made and compares it with the tables. A line under the format shows the result: a green "Checked" line, for example "2,765 roads and 1,719 nodes, the same as the tables", or a red "Problem" line with the first difference.

The check is not a test with other software. To test with the real tools, open the file in QGIS, in a PMTiles viewer or MapLibre, in MATSim, or with `netconvert`.

## Facts about the files

- The `edge_id` and `node_id` values are 64-bit hashes. The files write them as text. A program that reads them as numbers can lose digits.
- The speed is `maxspeed_kmh` when the edge has it. If not, the page uses a default for the class. The lanes default to 1. The capacity is 2,000 vehicles per hour and lane for a motorway, and 800 for a small road.
- SUMO cannot read the three files directly. Unpack the `.zip` and run the command of the README to make one network file:

```bash
netconvert --node-files area_driving.nod.xml --edge-files area_driving.edg.xml --connection-files area_driving.con.xml -o area_driving.net.xml
```

## All the files that you can download

| Card | Button | File |
|---|---|---|
| 2 The area | **Boundary** | `boundary.geojson` |
| 3 The data | The arrow in a row of the region list | An `.osm.pbf` region file |
| 5 The result | **.zip**, **.duckdb**, **.osm.pbf**, **.yaml** | The tables, the database, the cut area and the fixes ([the fixes file](fixes-file.md)) |
| 7 Edit OSM data | **Download** (tab **Changes**) | The fixes file |
| 8 Edit levels | **Download edits.csv** | Your level rules |
| 9 Edit design | **Download**, **Download all my themes** | `.design.json`, `duckosm-themes.json` |
| 10 Export | **Download** | One of the formats above |

## Next

[The tables](tables.md) explains the tables that the files hold.
