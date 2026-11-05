# Steps 3 and 4: Data and build

In step 3 you tell the page where the OSM data comes from. In step 4 you choose the networks and press **Build**. The build runs in your browser.

## Step 3: The data

![Card 3 with the Region file tab and the Geofabrik files that cover the area](../img/dashboard/07-data.png)

Card 3 has three tabs. Choose one.

| Tab | Use it when | Notes |
|---|---|---|
| **Region file** | You have an `.osm.pbf` file of a country or a region. | The file must cover the area. It gives all layers. |
| **Overpass** | You have a small area and no file. | The page asks the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API). It needs no file. |
| **Cut file** | You have a file that is already cut to the area. | Use the cut file of an earlier build. It gives no layers. |

### Region file

Select a file with the button at the top of the tab. Under it, the page lists the [Geofabrik](https://download.geofabrik.de) files that cover your area. Each row has these buttons:

- **Get.** The page downloads the file and keeps it in your browser.
- **Use.** The page uses a file that it already keeps. The row says **kept**.
- The arrow downloads the file to your computer.
- The circle at the left shows the extent of the file on the map.

A kept file stays in the browser for the next visit. Press **Delete** under the list to remove it.

### Overpass

![Card 3 with the Overpass tab](../img/dashboard/39-overpass.png)

The page asks the Overpass servers for the data of the area. The page sets the time and the memory of the query to fit the size of the area. It tries three servers, two times each. Use this tab for a small area. A large area can fail because a server limits the answer.

### Cut file

Select an `.osm.pbf` file that is already cut to the area. The build does not cut it again.

## Step 4: Build

![Card 4: the networks, the layers, the fixes file and the Build button](../img/dashboard/08-build-options.png)

| Part | What it does |
|---|---|
| **Networks** | Driving, walking and cycling. A network is a set of roads that one way of travel can use. Each network gives its own tables. |
| **Layers** | Water, land use, buildings, railways and more. They make the base map of the area. A cut file gives no layers. With layers on, the build also makes the tables of walls and doors that step 7 needs. |
| **Fixes** | A fixes file (`.yaml`). The build applies it to the OSM data. Step 7 writes such a file. [The fixes file](fixes-file.md) gives its format. |
| **Build** | Starts the build. The map shows the step that runs. |

When the build ends, the card shows the time and the memory:

![Card 4 after a build: the time, the memory and the details](../img/dashboard/09-build-done.png)

- **Build details** lists what each step made.
- **Time and memory of each step** is a table with one row for each step.

The page uses threads when the browser allows it. Estonia takes 19 seconds with the Rust engine on the command line. The page is slower, and a large area can fail on a small device. [The limits](../troubleshooting.md) have the numbers.

## What the build does

1. It cuts the OSM data to the area.
2. It cuts the ways at the junctions, and it joins the pieces into edges.
3. It sets the length, the speed and the travel time of each edge.
4. It makes the edge graph and applies the turn restrictions.
5. It finds the drawing levels of bridges and tunnels.
6. It makes the layers.

Each network has its own `edges`, `nodes` and `edge_graph` tables. [The tables](tables.md) explains them. [The roads](roads.md) tells you which roads each network takes, and how the build sets their speed, lanes and travel time.

## Next

[Steps 5 and 6](result.md) show you the result.
