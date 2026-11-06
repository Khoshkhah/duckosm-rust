# Steps 1 and 2: The area

The area is the part of the world that you build. In step 1, you make its shape. In step 2, you name it and add a buffer.

## Step 1: Choose an area

Step 1 has four tabs. Use one of them.

### Search for a place

![The Search tab with the matches for Monaco](../img/dashboard/02-search.png)

1. Type a city, a region or a country. The page shows up to 10 matches.
2. Click a match. The page draws its boundary.
3. To remove the area, click the match again, or press **Unselect**.

If the page cannot get the boundary, press **use the box of the place**.

### Draw a shape

![The Draw tab with the drawing tools](../img/dashboard/03-draw.png)

| Tool | Key | How |
|---|---|---|
| Rectangle | R | Drag from corner to corner. |
| Polygon | P | Click each corner. Press **Enter** to close the shape. |
| Circle | C | Drag from the center out. |
| Freehand | F | Drag around the area. |

**Merge** joins shapes that overlap. **Delete** removes the selected shape.

### Load a file

![The File tab: select or drop a GeoJSON file](../img/dashboard/04-file.png)

Select a GeoJSON file, or drop it on the map. The page uses every polygon in the file.

### Pick hexagons

![The H3 tab with seven hexagons picked](../img/dashboard/05-h3.png)

1. Choose the [H3](https://h3geo.org) level, from 5 to 10.
2. Click a hexagon to add it. Click it again to remove it.

The area can have 500 cells and 5,000 km² at most.

## Step 2: Name the area

![Card 2: the name, the buffer and the size of the area](../img/dashboard/06-area.png)

| Part | What it does |
|---|---|
| **Name** | The name of your files and of the saved area. |
| **Buffer around the area (m)** | Makes the area larger on all sides, from 0 to 50,000 m. |
| **Boundary** | Downloads the area as `boundary.geojson`. |

The area shows on the map in blue:

![The boundary of the area on the map](../img/dashboard/06b-area-on-map.png)

## Next

[Steps 3 and 4](build.md) get the data and build the network.
