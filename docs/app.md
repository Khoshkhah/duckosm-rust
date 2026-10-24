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
- **Base map layers** (a check box, on): with a region file, the build also makes duckOSM's base-map layers
  (`features.*`), see [features.md](features.md).
- **Build** (in the footer) starts the build in the Web Worker (`build_worker.js`, with threads when the page
  is cross-origin isolated). The card shows the progress, then the summary and the times, as the old page.
- A new build replaces the result of the last build.
- **Time and memory of each step**: a table under the progress (open; a click closes it), with one row for each
  step and its time and memory. The line above it gives the total: from the click on Build until the tables are in
  DuckDB. The Rust build records its steps (`run()` in
  `duckosm-wasm/src/lib.rs`: the read of the file, the sidewalk rule, the network and the files of each mode, the bus
  routes, the area tables, the raw files, the drawing levels, the lane profile). The page adds its own steps (the
  download, the module load, the transfer of the files, DuckDB's tables and base-map layers, the map). The memory is
  the WebAssembly memory of the build module (it only grows, so it is the largest size until then), DuckDB's
  buffers (`duckdb_memory()`) or the memory of the map module.

### Step 5: the result (the data)

Kaveh's layout of 2026-10-23: the data in card 5, the map in card 6.

- **SQL**: a text box, **Run**, and the result as a table (the first 200 rows) in the card.
- **Downloads** (changed after Kaveh found that the files had no structure):
  - **Download all (.zip)**: a folder named after the area, with the Parquet files (the names of duckOSM's
    GeoParquet export, `<table>_<mode>.parquet`), `layers.json` (its list of the map layers, which the roadstyle
    GeoLibre plugin opens), `make_duckdb.sql`, `boundary.geojson` and a `README.txt` that says what each table holds.
    `README.txt` gives the command that makes one `.duckdb` file: `duckdb <area>.duckdb < make_duckdb.sql`. (The
    file was `load.sql`, with its own button; the button is gone.)
  - **Download .duckdb** (next to the zip): `<area>.duckdb`, a duckOSM database with all tables of the build,
    `mm.edges` and the macros: the same file that `make_duckdb.sql` makes. The `features.*` tables also have
    their `tags` column. DuckDB writes the file in the page (`duckdbFile()` in `app/duck.js`). It needs
    DuckDB with direct IO, which the page sets when DuckDB starts (the cause:
    [browser.md](browser.md), "The .duckdb download"). If the file fails, a message says that the zip has
    `make_duckdb.sql`.
  - One block for each table: its name, one sentence on what it holds, and a link for each mode with the number
    of rows. A link goes to duckOSM's reference of the columns. With the base-map layers, one more block,
    `features`, has a tile for each layer (its name and number of rows; a click downloads it); the zip has them as
    `features_<table>.parquet`, in `layers.json` too.

### Step 6: visualization

- **Network**: All, Driving, Walking, Cycling: only the modes of the build, and no list for a build with one mode.
  (It was "Roads of" in step 5; Kaveh did not understand the name.) A change draws the map again when it shows.
- **Show on map** draws the roads of the network. After a build, the page draws them at once only for a small area
  (fewer than 20,000 roads: Monaco has 13,298). A larger area waits for the click (Tartu: 64,828 roads).
- One line under it: the number of roads and the time of the last drawing. The table in step 4 has each step.
- The base map and the layers are buttons on the map (see "The map"). For one commit they were in this card; Kaveh
  wants them on the map ("it has a good design").

## The map

- The roads of roadstyle's style go onto the same map: their sources and layers are added with the prefix
  `rs-`, as GeoLibre's roadstyle plugin does. The sources are vector tiles that the map worker makes when the map
  asks for them (protocol `rs://`, [browser.md](browser.md)). They are over the base map and under the area line, the
  matches, the extracts and the drawn shapes. The style's images (the one-way arrow) are added under the same
  prefix. A layer with `text-font` gets a font of OpenFreeMap (Noto Sans).
- When the roads show, the fill of the area goes away and only its line stays, so the fill does not change
  the colors of the roads.
- **roadstyle's dashboard** (2026-10-23, Kaveh: "go") does the map's interaction: the 2D/3D button, Street View with
  its marker, Google 3D, the road popup, the hover tooltip, the purple glow of the selected road, and the legend of a
  `color_by`. It is roadstyle's one module `src/roadstyle/static/dashboard/`, which `build.sh` takes at
  `ROADSTYLE_COMMIT` into `www/map/roadstyle/dashboard/` (not in git; `e2e.py` checks that the served files are
  roadstyle's). The page calls `rsDashboard(map, {prefix: "rs-", tiles: true, simple: "roads-simple", engine: {props}})`
  once, before the roads; after each build or network change, `showRoads` adds the roads style's sources and layers
  with the prefix (the one vector source `rs-roads`, with `promoteId: {simple: "__rs_edge"}` for the glow) and gives the
  style to `rs.setStyle`. A click asks the map worker for the road's properties (`engine.props`). The page removes the
  popup and the selection while the user draws or uses **What is here?**. The legend sits beside the panel.
- The buttons under the zoom buttons (Kaveh's design of 2026-10-23, from roadstyle's map: the same icons, sizes and
  spacing): 3D, the 3D buildings switch, Street View, Google 3D (only with a key), and the base map (▦) last:
  - **3D** (roadstyle's 2D/3D button) tilts the map; it then shows "2D", which makes it flat again. It does not change
    the buildings.
  - **3D buildings** (the building icon, Kaveh's choice A of 2026-10-23) gives the footprints that show their height.
    Off (the default), they stay flat. So the map can be tilted with flat buildings, or flat with 3D buildings. The
    page keeps the switch (`duckosm.buildings`).
  - **Base map** (▦) opens a list: OpenFreeMap, Light gray (Esri), Satellite (Esri World Imagery), Blank (`#efede8`)
    and Blank dark (`#14181d`): roadstyle's two blank base maps, which do not follow the page's theme. All except
    OpenFreeMap hide all of
    OpenFreeMap's layers, also its labels (with 3D buildings on and without the duckOSM 3D buildings, its 3D buildings stay). After a
    build with the base-map layers, the list also has **duckOSM layers**. Satellite turns them off, because they
    cover the photo. The page keeps the base map.
  - **Street View** (the person) opens roadstyle's floating window. A click on a road shows Google Street View there.
    The window can be dragged and resized, stays inside the map, and the page keeps whether it is open and where. No
    key is needed; it loads only in a page served over http(s). Open (at roadstyle `aba5884`): with tiles, the
    dashboard does not find the clicked road's line (`_svFeat` in `svspot.js` does not use `_svTiled`), so Street View
    stands at the click and looks north, and the map has no marker. The fix is in roadstyle's dashboard.
  - **Your Google Maps key** (card 6, "Google 3D: your Google Maps key"): the key stays in this browser
    (`localStorage`), never in the address or the code. The dashboard reads it when the page opens; with it, the
    Street View window has roadstyle's **Linked** mode beside **Classic**, and the **Google 3D** button comes before
    the base map (its camera and the map's linked both ways).
  - No button hides the footprints: the style alone decides if they show (Kaveh's rule).
- Only one 3D building layer shows: roadstyle's own when the duckOSM layers show (from the zoom of their buildings,
  15; below it OpenFreeMap's), else OpenFreeMap's. Before, the
  two layers drew over each other at different heights. With 3D buildings off, OpenFreeMap's 3D layer is flat (height 0),
  so that its footprints stay.
- The height of a building (roadstyle-rs, rule C of mapstyle's `docs/design/buildings_3d.md`): the higher of
  `height` and (`building:levels` + `roof:levels`) × 3.66 m (as OpenMapTiles), or the one that is there, else the
  height of its kind. The higher of the two keeps Tartu's buildings correct, where `height` is often an ETAK code.
  Its base is `min_height`, else `building:min_level` × 3.66 m. On Monaco (2026-10-23), for the 490 buildings with these tags, the median
  difference to OpenFreeMap went from 3.0 m to 0.36 m. A building with no tags has the height of its kind (9 m by
  default); OpenFreeMap gives it 5 m.

## The Google Maps key (plan for publishing)

Street View's Linked mode and Google 3D need a Google Maps JavaScript API key. Kaveh has two keys (2026-10-23):

- **Local work (localhost):** the environment variable `GOOGLE_MAPS_KEY` of his shell. The page does not read it: the
  user enters the key once (card 6; the page uses it the next time it opens), and the page keeps it in this
  browser (`localStorage`). The headless tests read it from the environment only for the test, and never write it to
  a file, a log or a screenshot.
- **The published page (later, GitHub Pages):** the repository secret `GOOGLE_MAPS_KEY`, as roadstyle does for its
  manual's live maps (roadstyle `.github/workflows/docs.yml`, step "Build the live maps"). The plan: the Pages workflow
  reads the secret into the environment, stops when it is empty, and writes it into the page that it deploys (for
  example as the default of the key field); the key is never in git. A key in a deployed page is visible to its
  readers, so it must be limited to the site's address (for example `https://khoshkhah.github.io/*`) and to the Maps
  JavaScript API (roadstyle `docs/guides/google-key.md`). Not set up yet.

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

