# duckOSM in the browser: one app

Status: done, 2026-10-22 (the result is at the end). Kaveh's decision: "One app, one map". The button **Use in duckOSM** of the boundary
tool opened another page (`index.html`, with its old design). Now the build is part of the boundary tool's page:
the user makes the area, builds it, and sees the roads on the same map, with no change of page.

## What changes

- The boundary tool (`boundary.html`, its design is in [boundary_tool.md](boundary_tool.md)) becomes the app,
  as `index.html`. `boundary.html` is removed. The old `index.html` (the form) is removed: its functions move
  into the app.
- The steps 1, 2 and 3 of the boundary tool stay as they are: choose an area, the area, the region file.
- The footer button **Use in duckOSM** becomes **Build**. It is on when the area and the data are ready.
- The map is one map: the base map (OpenFreeMap), the area, the search matches, the extracts, the drawn shapes,
  and after the build the roads.

## The panel

```
+----------------------------+
| [#] duckOSM          [☾][<]|
| (1) CHOOSE AN AREA         |   unchanged: Search | Draw | File
| (2) THE AREA               |   unchanged: name, km², polygons, vertices
| (3) THE DATA               |   [Region file | Overpass | Cut file]
|     Region file: [select]  |   the suggested extracts below, as today
| (4) BUILD                  |   modes [x] driving [x] walking [x] cycling
|     > Options              |   the OSM fixes file
|     (the progress)         |   loading..., building..., the times
| (5) THE RESULT             |   after the build only
|     Roads of [all modes v] |   the roads on the map
|     Base map [OpenFreeMap v]
|     SQL [............] [Run]
|     Downloads: load.sql, the Parquet files
|----------------------------|
| [GeoJSON]       [Build  >] |
+----------------------------+
```

### Step 3: the data

Three tabs, as the three sources of the old page:

| Tab | What the user does | The build |
|---|---|---|
| Region file (the default) | Selects a `.osm.pbf` file that covers the area. The suggested Geofabrik extracts stay below, with their download links and their outline on the map. | `build_area`: the file is cut to the boundary while it is read. |
| Overpass | Nothing more. A note says that the public servers are often full and that the area must be small. | `build_osm_json`, cut to the boundary. |
| Cut file | Selects a `.osm.pbf` file that is already cut to the area. | `build`; the boundary is not used. |

The page keeps the selected file only in memory. After a reload, the user selects it again.

### Step 4: build

- The modes (three check boxes) and, under **Advanced: corrections to the map data**, the OSM fixes file
  (duckOSM `osm_overrides`), with one sentence that tells what it is (Kaveh found the first label unclear).
- **Build** (in the footer) starts the build in the Web Worker (`build_worker.js`, with threads when the page
  is cross-origin isolated). The card shows the progress, then the summary and the times, as the old page.
- A new build replaces the result of the last build.

### Step 5: the result

- **Roads of**: all modes, or one mode. The roads show on the map in roadstyle's style (`map/`), as in step
  M1 of [browser.md](browser.md).
- **Base map**: OpenFreeMap (the default), light gray (Esri), or none. The base map of the map stays
  OpenFreeMap; the other two are a layer over it, under the roads.
- **SQL**: a text box, **Run**, and the result as a table (the first 200 rows) in the card.
- **Downloads**: `load.sql` and the Parquet files.

## The map

- The roads of roadstyle's style go onto the same map: their sources and layers are added with the prefix
  `rs-`, as GeoLibre's roadstyle plugin does. They are over the base map and under the area line, the
  matches, the extracts and the drawn shapes. The style's images (the one-way arrow) are added under the same
  prefix. A layer with `text-font` gets a font of OpenFreeMap (Noto Sans).
- When the roads show, the fill of the area goes away and only its line stays, so the fill does not change
  the colors of the roads.
- A click on a road shows its data, but not while the user draws or uses **What is here?**.

## The code

- `index.html`: the page (the boundary tool's HTML and CSS, and the new steps).
- `app/duck.js`: a new module with the build side of the old page: duckdb-wasm, the build worker, the load of
  the tables, the roads style, SQL, `load.sql`. The page calls it.
- `build_worker.js`, `map/` and `serve.py` do not change.
- `e2e.py` uses the new page: the boundary goes in through the File tab. `boundary_e2e.py` opens `index.html`
  and checks that **Build** is on after an area and a region file.

## Later: the relay

A region file can come into the page without a manual download: [relay.md](relay.md).

## Not in this plan

- Several areas in one session (a list of builds).
- A kept region file (in the browser storage).
- A result table in a large window over the map.

## Result (2026-10-22)

Done as planned, with two additions:
- While the duckOSM roads show, the roads of the base map (OpenFreeMap's `transportation` layers) go away, so
  the two do not compete. Water, land, buildings and place names stay.
- Steps 3 and 4 show at all times, so a cut file can be built without an area. Until there is an area, the
  list of extracts asks for one.

Checks in headless Chromium:
- `e2e.py`: Monaco and Tartu (from the Estonia file) go in through the File tab and are built with a region
  file. All 20 tables of Tartu are equal to the native build on every row. The roads show on the map with the
  area line (Monaco: the map 1.4–1.7 s after the tables; Tartu 8.3 s).
- `boundary_e2e.py`: the file, the drawn and moved rectangles, Merge, the search, and Build: off without a
  region file, on with a region file or with Overpass.

The build of Tartu took 3.1 s in the app, against 1.7 s on the old page; the map (OpenFreeMap's vector tiles)
works in the same tab during the build, and the computer had other load. Not measured more.

