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

### On a phone

Kaveh tests the page on his phone (2026-10-24: "I couldn't test editing dashboard. It's not workable on mobile phone").
On a screen of 700 px or less:

- The map is at the top (42 % of the height) and stays there while the cards scroll under it. The footer with **Build**
  stays at the bottom. The scale bar does not show. The zoom read-out is at the bottom left of the map, and the
  attribution starts folded (an "i" button), so it does not cover the read-out.
- The button at the right of the page's header folds the panel to one bar at the bottom, and the map gets the screen.
- **The level editor: one panel at a time.** The page's panel goes away. A bar at the top keeps the counts, **Apply** and
  **Close** in view, and the map fills the rest of the screen. The editor's panel is roadstyle's sheet at the bottom of
  the map (since roadstyle `d25601e`, its layout `"auto"` up to 700 px): half the height, and its handle changes it to
  the full height or to one row. The editor keeps the roads above the sheet, a finger can pick a road (a wide line that
  takes the taps), and the buttons are 44 px high. After Apply or Close, the page's panel comes back with card 7 in view.
- Before 2026-10-24 the editor's panel (400 px wide) covered the whole screen of a phone, and Apply and Close were
  under it.

The check: `phone_e2e.py` (Playwright's "iPhone 13": a 390 × 664 page, touch). It builds Monaco, scrolls the cards and
folds the panel. Then, with taps, it opens the editor, picks a road above the sheet, makes its end head shorter, solves
("Apply and solve" in the sheet), applies in the page's bar, opens the editor again, moves the sheet with its handle and
closes it. It checks the places of the bar, the map and the sheet, and writes `phone-*.png`.

### The memory of the page

Kaveh (2026-10-25): "I tried the dashboard for burnaby on my mobile phone, it couldnt handle visualization and drawing map
part". A phone's tab has about 1.5 GB for everything. Burnaby (151,770 roads with all networks; duckOSM's cut
`burnaby.complete_ways.osm.pbf` as the region file, with its boundary and the base-map layers) took 3.7 GB of the tab after
the draw. The measurements are of the renderer process (the page, its workers and their WebAssembly memory) in desktop
Chromium:

| Burnaby, all networks | Before | After |
|---|---|---|
| The tab after the build | 1,799 MiB | 1,273 MiB |
| The tab after the draw | 3,660 to 3,825 MiB | 3,174 MiB |
| DuckDB after the draw | 462 MiB | 321 MiB |
| The build worker (WebAssembly) after the build | 402 MiB, kept | 0: the worker ends |
| The road table of the dashboard (`window.RS_SIDE`, as JSON) | 118 MB | 71 MB |
| The map worker (WebAssembly) | 796 MiB | 796 MiB |
| Network "Driving": roads on the map / the tab after the draw | 151,770 / 3,229 MiB | 62,453 / 2,512 MiB |

The changes:

- **The build worker ends after each build.** Its WebAssembly memory only grows; the files are then in DuckDB and in the
  page. A new build makes a new worker, so a panic or an out-of-memory error of one build does not stop the next one.
- **DuckDB:** the Parquet file of each table goes away when the table is made; `raw.*` goes away when the base-map layers
  are made (no download has it, the map does not read it); roadstyle's temporary tables of a draw go away after the draw
  (since roadstyle `bcea0ae`: each reading is a "run" with tables of its own names, and its "drop" removes them). Before,
  they stayed, and the later draws had fewer base-map layers: 34 of 52 on Monaco.
- **The road table** keeps only the fields that the popup and the dashboard read (about 15 of 32), and it comes from the
  map worker as an object, not as a 118 MB text that the page parsed again.
- **One network:** "Driving", "Walking" or "Cycling" draws only the roads of that network and its private roads:
  roadstyle's reading of one mode alone (`duckosmPlan(..., only = true)`; Monaco: driving 3,454, walking 11,910, cycling
  11,257 of 13,298 roads). Before, the page drew every road with the access of that mode. The stored drawing order is
  checked for these roads (the plan's "subset" queries and `duckosmSubsetLevels`).

**The limit on a small device.** About 1,000 MiB plus 14 KB for each road on the map fits the measurements (Monaco
13,298 roads: 1,077 MiB; Tartu 64,828: 2,050 MiB; Burnaby 151,770: 3,174 MiB). With 1.5 GB, a phone can thus show about
40,000 roads. On a small device (`navigator.deviceMemory` 4 GB or less, or a touch screen; Safari has no
`deviceMemory`), the page draws at most 40,000 roads. A larger map gives the note "This map has N roads; on this device
the map can show up to 40,000. Choose a network that is smaller, use a desktop browser, or a smaller area. SQL and the
downloads work." The level editor (all the roads of the area) has the same limit. A draw that fails with a memory error
gives the same advice. `?maxroads=N` in the address changes the limit (`?maxroads=0`: no limit), so a phone with more
memory can try. Burnaby on a phone: the build, SQL and the downloads work; its map (151,770 roads, or 62,453 for
"Driving") is over the limit.

Not done: the map worker's memory (roadstyle's engine: about 5 KB for each road, with the base map), and the page's own
copy of each Parquet file for the downloads (75 MiB for Burnaby; DuckDB can write them again, but the files of the
downloads must stay equal to the native build's).

### The cards fold

Kaveh (2026-10-24): "the result card is not well designed and take many space and its not collapsable". Each
numbered card (1 to 7) folds: a click on its heading, or on the chevron at the right of the heading (a button that the
keyboard can reach, with `aria-expanded`), hides the card's body. The heading stays. The page keeps the fold of each
card in this browser (`duckosm.card.<n>`), so a fold stays after a reload. All cards are open at first. When a step
becomes active, the page opens its card: card 4 at the click on **Build**, cards 5, 6 and 7 after a build.

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
- **Drawing order**: "Optimized (slower)" (roadstyle's solver) by default since 2026-10-24, or "From the tags (fast)"
  ([levels.md](levels.md)). Monaco: the build takes about 0.5 s more with the solver.
- **Base map layers** (a check box, on): with a region file, the build also makes duckOSM's base-map layers
  (`features.*`), see [features.md](features.md).
- **Build** (in the footer) starts the build in the Web Worker (`build_worker.js`, with threads when the page
  is cross-origin isolated). The card shows the progress, then one line: "Built in 2.3 s · 8 threads · 52 MiB" (the
  time from the click on Build until the tables are in DuckDB, the threads, the memory of the build module; with
  Overpass also the size of the download). An error stays in the same place (`#buildstatus`).
- **Build details** (folded at first, Kaveh 2026-10-24: "This part need redesign or maybe remove"): one small table.
  A row for each mode with its edges, nodes, private edges, the rows of `edge_graph` ("graph") and the turn
  restrictions ("turns"); then one row each for the bus routes, the raw cut (nodes, ways, relations), the levels (the
  method, edges, roads, the stack pairs given up, the order wishes not kept) and the lane profile. The solver's stage
  values go to the browser console only. Before, the card had all of it as long text.
  A panic hook in the build module keeps the panic message, so the card shows it and not only
  "RuntimeError: unreachable".
- A new build replaces the result of the last build.
- **Time and memory of each step**: a table under the progress (open; a click closes it), with one row for each
  step and its time and memory. The line above it gives the total: from the click on Build until the tables are in
  DuckDB. The Rust build records its steps (`run()` in
  `duckosm-build/src/lib.rs`: the read of the file, the sidewalk rule, the network and the files of each mode, the bus
  routes, the area tables, the raw files, the drawing levels, the lane profile). The page adds its own steps (the
  download, the module load, the transfer of the files, DuckDB's tables and base-map layers, the map). The memory is
  the WebAssembly memory of the build module (it only grows, so it is the largest size until then), DuckDB's
  buffers (`duckdb_memory()`) or the memory of the map module.

### Step 5: the result (the data)

Kaveh's layout of 2026-10-23: the data in card 5, the map in card 6. Since 2026-10-24 the card is short: one line
with the edges and nodes of each mode and the time of the build (card 4 keeps the full text), then two folded sections
and the two download buttons between them. With three modes, the line takes three lines of the panel.

- **SQL** (folded at first): a text box, **Run**, and the result as a table (the first 200 rows) in the card.
- **Download all (.zip)** and **Download .duckdb** show on one row at all times.
- **Downloads: each table** (folded at first): two sentences on the two files, the link to the columns of each table,
  and one block for each table.
- The downloads (changed after Kaveh found that the files had no structure):
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
- One draw at a time (2026-10-24, after two faults that Kaveh got on the live page). A draw makes temporary tables in
  DuckDB (roadstyle's `duckosmPlan`) and writes `roads.parquet`. Two draws at the same time broke each other ("Table with
  name e does not exist"), and the next draw then failed too ("File is not opened in write mode"). Now:
  - A draw that is asked for while one runs (a second click, the draw after **Apply**) comes after it, one time only.
  - **Show on map** and the network list are off while a draw runs ("drawing…") and while the level editor is open.
  - A new build and the level editor wait until the draw stops.
  - The page removes `roads.parquet` and `features.parquet` from DuckDB before and after each draw, also after a draw
    that failed, so the next draw starts clean.
  - Since roadstyle `bcea0ae` the temporary tables of each reading have names of their own (its "run"), and the page
    drops them after the draw ("drop"). Two readings at the same time thus do not meet either; the page keeps its one
    draw at a time, because the draws also share `roads.parquet`.
- roadstyle's zoom read-out ("z 13.8") is beside the scale bar of the map. roadstyle puts it at a fixed place, which on
  this page is under the side panel, next to the Build bar.
- The base map and the layers are buttons on the map (see "The map"). For one commit they were in this card; Kaveh
  wants them on the map ("it has a good design").

### Step 7: edit the levels

Kaveh's words (2026-10-24): "Add editing dashboard to duckosm rust github io dashboard". The card **Edit levels** puts
roadstyle's level editor on the page's map. The drawing order (`visualization.edge_levels`, [levels.md](levels.md)) comes
from the tags or from the solver. With the editor, the user changes it by hand: which road goes over which road, where two
roads join, the length of the heads and the shape of the line ends. Everything runs in the page: GitHub Pages has no server.

The card shows after a build that has `visualization.edge_levels` (each build of the page has it). The flow:

1. **Edit levels.** The page runs roadstyle's query `level_edges` in DuckDB (`duckosmPlan`: the edges of duckOSM's
   `load_roads`, one row for each `edge_id` of all modes) and writes `edges.parquet`. roadstyle's `makeArea` makes the
   level area from it (`roads.parquet`, `pairs.csv` and an empty `edits.csv`). The page keeps the area in this browser
   (`browserStore("duckosm:<area name>")`: the text files in `localStorage`, `roads.parquet` in the private file system
   of the site). If the store already has `edits.csv` for this area name, the page keeps it: the edits of an earlier
   session show again. The card gives the number of roads and pairs and the warnings of `makeArea`.
2. The editor (`levelEditor({map, container, pkgUrl, store, dashboard: rs, prefix: "rs-"})`) solves the area and draws its
   roads on the page's map, with the page's dashboard. Its panel (roadstyle's `level_editor.html`) is on the right of the
   map. A click on a road picks it. The panel has the cards with the ends and the heads, and the tabs Edit, History and
   Issues (roadstyle's guide `docs/guides/levels.md`, "Fix it by hand"). The page solves each change again.
3. **Apply** writes the editor's `levels.csv` into `visualization.edge_levels`. `edge_levels_meta` gets `source = 'area'`,
   `area = 'this browser: <area name>'` and a new `created` time. `n_edges` and `edge_hash` do not change, because the
   edges are the same. The user's own files go into `level_edits`, `level_heads` and `level_caps`, as roadstyle's
   `save_area_levels` writes them (duckOSM's `duckosm levels` reads them back). The Parquet files, the zip and the
   `.duckdb` download then have the new tables. The editor closes, and the map draws the roads in the new order.
4. **Close** removes the editor (`destroy()`), which puts the page's road layers back. Without Apply, the tables do not
   change.
5. While the editor is open, the card has two downloads: `edits.csv` and `levels.csv` (`editor.download`).

How the editor shares the map:

- A page has one roadstyle dashboard, because its state is in the module. Thus the editor uses the page's dashboard and
  its prefix `rs-`. It does not make a second dashboard.
- The page's roads and its base-map layers (the duckOSM layers) are in one tile source, `rs-roads`. The editor takes off
  only the page's road layers (it finds them by their source and source layer) and keeps them to put back. Its own
  sources have their own names (`rs-lv-roads`), so the duckOSM base-map layers and OpenFreeMap stay while the editor is
  open. (Until roadstyle `8208486`, the editor needed the name `rs-roads`, and the base-map layers went away.)
- The editor's tiles come from the protocol `lv://`, from roadstyle's module in the editor's own worker (`pkgUrl`: the URL of
  `map/pkg/roadstyle_wasm.js`), not in the map worker.
- The panel follows the page's theme (the theme button and the system's theme): its colors are variables, with a dark set
  for `:root[data-theme=dark]` and for the system's dark theme.

Limits:

- One editor at a time. A new build closes it.
- The editor's panel covers the right side of the map (400 px). It is not in the page's side panel.
- The store is for each area name. If a different area gets the same name, the old edits can name roads that the new
  area does not have.
- A build of the page has no `level_edits`, `level_heads` or `level_caps` tables. Thus the editor starts from the store
  only, not from the tables of a file.
- Monaco takes 2.2 to 2.9 s to open (6,830 roads, 21,476 pairs). Since roadstyle `7d4534f`, the editor solves, makes
  its map and cuts its tiles in a Web Worker, so the page does not stop: the longest task of the main thread while
  Monaco opens is 0.16 s. `makeArea` still runs in the main thread. A larger area was not tested in the page.
- If the editor's worker stops (no memory, a file that does not load), its waiting calls fail, and card 7 says so.
  Close the editor and open it again.
- `edge_levels_meta.roadstyle_version` keeps the value of the build: the page does not know the version of roadstyle's
  module.

The check: `editor_e2e.py` (headless Chromium, Monaco through the File tab). It opens the editor, makes one edit with
`window.lvApi` (an end head of 7 m) and applies it. Then it checks the tables in the page and in the `.duckdb` download, a
map of one mode, the duckOSM base-map layers while the editor is open, and Close. It writes `editor.png` and
`editor-dark.png` (the dark theme).

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
  roadstyle's). The page calls `rsDashboard(map, {prefix: "rs-", tiles: true, simple: "roads-simple"})`
  once, before the roads; after each build or network change, `showRoads` adds the roads style's sources and layers
  with the prefix (the one vector source `rs-roads`, with `promoteId: {simple: "__rs_edge"}` for the glow) and gives the
  style to `rs.setStyle`. The map worker sends the road table (the fields of each road) with the style, and the page
  puts it in `window.RS_SIDE`, where the dashboard reads the fields of a clicked road. (Until roadstyle `aba5884`, the
  dashboard asked the map worker for each road with `engine.props`; roadstyle removed that option.) The page removes the
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
- `serve.py` does not change. `build_worker.js` sends the kept panic message after a panic. `map/map_worker.js` makes the
  style and the road table.
- Card 7 is in `index.html`. `app/duck.js` has `levelEdges` (the edges of the level area) and `saveLevels` (Apply).
- `e2e.py` uses the new page: the boundary goes in through the File tab. `boundary_e2e.py` opens `index.html`
  and checks that **Build** is on after an area and a region file.

The deployed page has a version on each of its own files (2026-10-24). GitHub Pages lets a browser keep a file for
10 minutes, so after a deploy Kaveh got the new `index.html` with the old `app/duck.js` ("duck.roadstyle is not a
function"). At each deploy, `www/version_refs.py` adds `?v=<commit>` to every relative reference of a `.js`, `.wasm`,
`.css`, `.json` or `.html` file, so the files of one deploy always go together ([development.md](development.md), "The
deployed page: a version on each file").

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

