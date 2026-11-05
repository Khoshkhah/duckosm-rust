# The page

The page is duckOSM Studio, the portal. It runs in your browser, and no server receives your area or your data. This page names the parts of the window. The other pages of the manual tell you how to use each card.

![The page at the start: the base map and the panel with the ten steps](img/dashboard/01-start.png)

## The three parts

| Part | Where | What it does |
|---|---|---|
| The map | The whole window | Shows the base map, your area, and the roads after a build. |
| The panel | The left side. On a phone, a sheet at the bottom. | Holds the cards: **Your areas**, then the steps 1 to 10. |
| The bar | The right side of the map | Holds the tools of the map: theme, zoom, street view, base map and more. |

A step is a card. A card is gray until the card before it is ready. For example, **Build** stays gray until you choose an area and give the data. Each card has a **?** button that opens its help. A check mark on the title means that the step is done.

Cards 7, 8 and 9 open a panel. Click the card. The panel takes the place of the steps. Press **Steps** in the panel to go back.

After a build, the map shows the roads:

![The page after a build: the roads of Monaco on the map](img/dashboard/12-map-after-build.png)

## Your areas

![The card Your areas with one saved area and its boundary on the map](img/dashboard/24-your-areas.png)

The card shows only when the browser has a saved area. The page saves each build in your browser, with its tables and its drawing of the roads.

- Click a row to see the boundary on the map. Click it again to hide it.
- Press **Open** to load the area with no new build. Monaco takes 1.6 seconds.
- Press **Delete**, then press it a second time to confirm.

The pill **Opens fast** means that the drawing of the roads is saved too. The area stays in this browser only. If you clear the site data, the area goes.

## The bar of tools

![The bar of tools at the right side of the map](img/dashboard/13-bar.png)

The bar belongs to [roadstyle](https://github.com/Khoshkhah/roadstyle). From the top to the bottom:

| Tool | What it does |
|---|---|
| Chevron | Folds the bar to one button. |
| Sun or moon | Changes between the light and the dark theme. |
| Compass | Zoom in, zoom out and the compass. Press Ctrl and drag to turn and tilt the map. |
| Person | Shows Street View photos of a point that you click. It needs a key. |
| Cube | Opens the Google 3D window for a place. It needs a key. |
| Layers | Opens the base-map box. |
| Building | Shows the buildings of the base map in 3D. |
| Gear | The keys for Google and Mapillary. |
| (i) | The sources of the base maps. |

## The base-map box

![The base-map box with the base maps and the layers on top](img/dashboard/14-base-map-box.png)

The box has three groups:

- **Base map.** Choose one map: OpenFreeMap, OpenStreetMap, Esri Gray, Esri Streets, Esri Satellite or Blank.
- **On top.** Hillshade, Labels, 3D buildings and Arrows (the direction of one-way roads). The arrows are off at the first visit.
- **Map layers and H3 hexagons.** **Map layers** shows or hides the layers of the build (water, land use, buildings). **H3 hexagons** shows or hides the H3 grid.

A build sets the Blank base map for its first drawing, so that the roads are easy to see. Your saved choice does not change.

## The dark theme and the phone

![The page in the dark theme](img/dashboard/15-dark.png)

Press the sun or the moon in the bar to change the theme. At the first visit, the page follows your system.

![The page on a phone: the panel is a sheet at the bottom](img/dashboard/25-phone.png)

On a phone, drag the grip of the sheet to make it taller or shorter. The map has the full width.

## Keys

Street View and Google 3D need a key. Press the gear and save your Google key or your Mapillary token there. The deployed page has its own Google key.

## Next

- [Steps 1 and 2](manual/area.md) choose the area.
- [The limits](troubleshooting.md) tell you what the page cannot do.
