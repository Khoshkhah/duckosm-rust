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

## roadstyle's dashboard look

Since 2026-10-29 (Kaveh's request), the page has the look of roadstyle's dashboard (roadstyle `docs/design/dashboard_templates.md`
and `docs/guides/dashboard-layout.md`). The page uses the template `dashboard` with the layout `overlay`.

- **The map fills the window.** The panel floats over it, at the left, in roadstyle's frame look. The panel does not change the size
  of the map. The panel hides with the button in its title row (the button at the corner shows it again); the page keeps the choice
  (`duckosm.panel`).
- **The bar.** roadstyle's toolbar holds the map buttons, in this order: theme, navigate, Street View, Google 3D, base map, roads, 3D
  buildings, colour and legend, settings. **Navigate** (the compass needle, roadstyle's default since `6fdc893`) is one button in place of
  zoom in, zoom out, the compass and 2D/3D: its box has a zoom slider, a turn slider, a tilt slider and a reset button, and Ctrl + drag on
  the map turns and tilts it. The credits (attribution) are in the corner box of the map on a computer, and at the end of the bar on a
  phone. The page does not add navigation buttons (the default is used). The toolbox is fixed: a tool that the page cannot use
  stays in its place, greyed out (the legend: the page has no colour options). The bar is next to the panel. It goes to the edge of the window when the
  panel is hidden. The settings button lets the person move the bar and the panel, change the transparency, and save the Google key.
- **The base map is roadstyle's.** The page has no tool, box or base-map code of its own. It gives the dashboard the `basemaps` and
  `ontop` options of `map/roadstyle/host_options.json` (roadstyle's list with the twins), and a map that has the two layers `bg` and
  `basemap`. The tool, the box (the rows, **Hillshade**, **Labels**, **3D buildings**), the order of the layers under the roads, the rules
  of a box and the 3D buildings tool are roadstyle's. A map with a dark twin is one row, and it follows the theme: the dark theme shows the
  twin (OpenFreeMap Liberty: Fiord), and the light theme shows the map again. A dark map that the person picks (Satellite) makes the page
  dark. The page starts on OpenFreeMap Liberty and keeps the light key of the choice (`duckosm.basemap`). It does one thing for the
  module: it puts the active map first in the list and keeps the choice. "Show on map" calls `rsSetBasemap("blank")`, and roadstyle gives
  the dark twin in the dark theme.
- **The duckOSM layers.** The page has no switch of its own for the layers of the area (`ov<i>`: landcover, water, buildings and more).
  The look of the page is live (`state: "live"`, `make_look.mjs`), so each roads style has `roadstyle:controls.overlays`, and roadstyle gives:
  - one switch **Map layers** for all of them (the footprints of the buildings too) in the Base map box. A switch that is off stays off in
    the next draw. `rsSetOverlays(on)` is the call.
  - their list in the legend box ("Map layers", each with its colour; a layer that is hidden is dimmed).
  - the row **Buildings 3D** and the 3D buildings tool, for the 3D layer of the buildings.
  A page with a bar has no floating Layers box (before, the box was at the bottom right of the map, and the phone's sheet covered it).
- **Roads.** The tool **Roads** (roadstyle `6205d9c`, after the base map button) is the road filter in the bar. It is greyed out until
  roads are drawn. Its box has a row for each road class (a check box, the colour, the name and the number of roads), **All** and
  **None**, the rows **Bridges** and **Tunnels**, and the restricted kinds (private roads, bus lanes, pedestrian streets). A click on
  a class name shows only that class. The page does not make a filter of its own. `e2e.py` checks the rows, None, All, one class, Bridges and Tunnels on Monaco.
- **Colour by.** The look has the colour option **Road class** (`color_options`), so the tool "Colour by and legend" is on after the roads
  are drawn: its box has **Colour by** (Road class), the **Legend** of the road classes and the **Map layers**.
- **The cards.** The seven cards are in the panel's body. A card has no color of its own: all cards have one neutral look (a line
  around the card, a number in the theme's accent color) that follows the light and the dark theme of the panel. Before, each card
  had a color (the number of a step had the color of its line on the map). Each card still folds (see "The cards fold").
  The cards are not `rs.sections`: a section of roadstyle sets the text style of its content (size, color, the tables, the details),
  and the cards are forms with their own style.
- **The theme** is one value: `data-rs-theme` on `<html>`. The theme tool of the bar sets it, and the panel, the bar, the boxes, the
  popup and the tooltip read it. The page keeps the choice (`duckosm.theme`; the system's theme if there is none) and copies it to
  `data-theme`, which the level editor's panel reads.
- **The Google key** is in roadstyle's settings (the gear button), in the browser's storage (`rs-key:google`) and never in a file.
  Card 6 has a text and a button that opens the settings. The Google 3D tool is always on the bar. Without a key, its window says
  so and has a button for the settings. The key that the card of an earlier version saved (`duckosm.googleKey`) moves to the new
  place at the first visit.
- **A select** is roadstyle's list (`selectbox.js`). The `<select>` stays in the page, hidden, and a button and a list take its place.
  The page reads and sets `select.value` and the `change` event as before. A test that uses a select must click the list, or set the
  value in the page.
- **The options of the dashboard** are in `map/roadstyle/host_options.json` (roadstyle's file, copied by `build.sh` at
  `ROADSTYLE_COMMIT`): the typed `dashboard`, its `first_paint`, the `basemaps` and the `ontop`, as a page that roadstyle writes has them.
  The page fetches the file (with a `preload` link) before it makes the map, and gives it only its own: the panel 370 px wide, with no hidden
  section (the page has none of roadstyle's own sections), and the active base map. `rsFirstPaint` sets the classes of `<html>` and
  the panel's width. The panel is hidden (`visibility`) until then, so no frame shows another form. The page has no copy of the defaults and
  no copy of the panel's shell rules (position, tokens, title row, hide and show buttons): they are in `dashboard.css`. The page keeps the
  rules for its own title in the panel. No WebAssembly module loads before the map.
- **The free part of the map.** The panel, the bar and the phone's sheet cover a part of the full-window map. `rs.freeArea()` gives the
  free part. `freeInsets()` in the script turns it into insets, for the zoom to an area (`fitTo`), the veil of a draw (`#mapbusy`), the
  message (`#status`) and, on a phone, the map's bottom padding. `rs.sheet()` and `rs.sheet(n)` read and set the height of the phone's sheet.
  roadstyle's windows (Street View, Google 3D) use their own rule (`windows.clamp`) and stay in the free part.
- **The boxes** stay inside the screen. roadstyle moves a box left or right as well as up or down, so on a phone the base-map,
  attribution and settings boxes are inside the 390 px screen.

The check: `dashboard_e2e.py` (no build needed). On a computer (1400 × 900) it checks the classes of `<html>`, the tools and their
order, the places of the bar and the panel, the panel that hides and shows, the seven cards in both themes (the same colors, no
`--c`), the base-map box (opens inside the window; the Escape key, a click outside and another box close it), the base map that
follows the theme, the raster base map under the page's layers, the 3D buildings tool of roadstyle, the Google key (saved and cleared in the settings, the key of an earlier version moves) and the Street View window in the
free part of the map. On a phone (390 × 844, touch) it checks that the page does not scroll sideways, the bar at the top, each tool
32 px or more and reachable, the three heights of the sheet and the map's padding for each, that the full sheet does not cover the
bar, `rs.sheet()` and `rs.freeArea()`, each box (it must be inside the screen), and that a window is a bottom sheet that closes the panel's sheet. It writes `dashboard-*.png`.

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

- **The panel is roadstyle's sheet** (2026-10-29; before it was the page's own sheet, 2026-10-25, Kaveh: "The mechanism of side panel
  scroll is not right"). The map fills the screen, and the panel (the title and the seven cards) is a sheet at its bottom. A grip
  above the sheet taps through three heights: 40 % of the screen (the first height), the full height (under the bar), and closed (the
  grip alone). The page does not keep the height. The cards scroll inside the sheet; the page itself does not scroll, so a scroll
  in the sheet does not move the map. The Build bar (GeoJSON, Build) is at the sheet's bottom edge.
- The bar is at the top, in two rows (eleven tools at 390 px). Each tool is 32 px or more. The settings box has no layout choices on a
  phone.
- The map's padding at the bottom is the part of the screen under the grip, so the area and the roads stay above the sheet. The sheet
  moves in a transition of 0.15 s, so `padMap()` runs at each frame of it and at its end. (Before, the page read the height 220 ms after
  the change; when a draw kept the main thread busy, the height was not at its end value yet.) The scale bar and the zoom number do not
  show, and the attribution is in the corner box (the bar, on a phone).
- The view stays still when the map's box or padding changes (the editor's panel or sheet opens or closes, the page's sheet moves): the page keeps the same point at the same screen position, with no animation, and the editor does not fit the map to the area. `editor_e2e.py` and `phone_e2e.py` check this within 2 px.
- The 3D building layers are after every road layer (a line over an extrusion is not hidden by it) and before the labels; `editor_e2e.py` checks the order in 3D.
- OpenFreeMap is roadstyle's vector base map: its layers have the prefix `vbm-` and are under the roads. Inside the area our base-map layers are above them. An Esri or blank base map hides them.
- After a build, the sheet shows card 5 (the result); from the closed state it opens to 40 %.
- The cards' scroll box has a background that is 1 % transparent. With an opaque one over the map's canvas, Chromium
  (2026-10, also headless) left a band of the map undrawn, at the size of the scroll box but near the top of the screen.
- Before (2026-10-24), the map was at the top (42 %) and the cards scrolled with the page under it; the map then had
  less room, and a scroll in the cards moved the page.
- **The level editor: one panel at a time.** The page has one panel (`#sb`), and the editor draws into it (roadstyle's `levelEditor({panel})`):
  the page's steps, its title and its footer are hidden while the editor is open, and **← Steps** at the top of the panel brings them
  back. The panel is roadstyle's: on a phone it is the sheet (closed, 40 %, full), and the editor's bar with **Apply and solve** is fixed at
  its bottom. A finger can pick a road (a wide line that takes the taps). After **← Steps**, the page's panel comes back in the
  state it had, with card 7 in view and the map's padding for it.
- Before 2026-10-24 the editor's panel (400 px wide) covered the whole screen of a phone, and Apply and Close were
  under it.

The check: `phone_e2e.py` (Playwright's "iPhone 13": a 390 × 664 page, touch). It taps the sheet's grip through its three
heights (the map's padding each time), builds Monaco from the 40 % sheet, and checks that a scroll in the sheet moves
neither the map nor the page. Then, with taps, it opens the editor, picks a road above the sheet, makes its end head shorter
(the editor saves and draws it at once, with no solve, since roadstyle `6be68c2`), applies in the page's bar, opens the editor again, moves the sheet with its handle and
closes it. It checks the places of the bar, the map and the sheets, and that the page's sheet comes back in its state,
and writes `phone-*.png`.

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

**The tiles in a fast zoom.** The roads source `rs-roads` has the roads and all the layers of the area map (land, water, buildings), so a tile that is not loaded leaves a square of the whole map empty. MapLibre draws such a tile from loaded parents and from loaded children up to 3 zooms deeper (`maxOverzooming`), so a fast zoom out, past zooms that have no loaded tile, showed the background colour for 0.5 to 1.7 s (Burnaby, pitch 60, headless Chromium, software GL). Two changes (`app/duck.js` `tile()`, `index.html` `addOverview()`): the page keeps the waiting tile requests, sends the newest first, two at a time, and skips a request that MapLibre aborted; and a second source `rs-low` (the same tiles, zoom 6 to 9) gives copies of the opaque fill layers under the real layers, so the area always has land and water. The test `tile-lag/zoom/black.py` (not in the repository) measured black time 0 ms in 7 of 8 zoom-out runs (path from zoom 9, zoom 7 and zoom 6.3; one run from zoom 8: 0.4 s), against 0.26 to 1.7 s without. The zoom in was never black in these paths. A tile of zoom 10 to 13 has 0.5 to 0.9 MB, and MapLibre needs 0.4 to 0.7 s to parse it: smaller low-zoom tiles are roadstyle's to make.

**Size and held bytes.** The map worker reports two numbers. `memoryMiB` is the size of the WebAssembly memory. It never gets smaller, and
roadstyle's allocator grows it ahead in steps of a quarter (16 to 64 MiB), so it can rise when the program holds less. `liveMiB` is
`[held now, most held]` (`liveBytes()`). The step table of the page shows the held value. Burnaby, "Driving", 64,221 roads, after the
tile index: tile contract 1 had a size of 210 MiB and 154 MiB held; tile contract 2 has 232 MiB and 143 MiB held (peak 161 and 150 MiB).
After 28 tiles at zoom 14 with pitch 60, the size is 263 MiB with contract 1 and 232 MiB with contract 2.

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
- **Map tiles**: MLT (the default) or MVT. See "Map tiles: MVT or MLT" below.
- **Show on map** draws the roads of the network. After a build, the page draws them at once only for a small area
  (fewer than 20,000 roads: Monaco has 13,298). A larger area waits for the click (Tartu: 64,828 roads).
- **Show on map** and the draw after a build set the blank base map (Blank, or Blank dark with the dark theme) and put the
  area in view (Kaveh, 2026-10-25: "set base map to blank and zoom on the selected area"). Out of the area, OpenFreeMap's
  own colors (the water, the wetland pattern) made the two sides of the boundary look different. After the user chooses a
  base map (the layers button of the bar), the later draws of the page keep that choice. On a phone the area stays above the sheet.
- The order of a draw (Kaveh, 2026-10-25: "a loading map processing shows first, then change base map to blank and zoom
  to that area"). At the click, a light veil with a spinner and the step of the draw ("drawing: the roads table and the
  style…", then "drawing: the first tiles…") covers the map. The map stays as it is under the veil. When the roads are
  ready (the new style is set and the first tiles are on the map), the page sets the blank base map and puts the area in
  view in one move, then removes the veil. Every draw shows the veil: also a change of the network and the draw after
  **Apply**, which do not move the view. If the draw fails, the veil goes and the note under the button gives the error.
  The veil covers only the part of the map that the panel (on a desktop) or the sheet (on a phone) does not cover.
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
- roadstyle's zoom read-out ("z 13.8") is in the scale box with the scale bar. Since 2026-10-29 the box is in the corner of the map
  that is opposite to the panel, and it is hidden at the start (the settings button shows it).
- The base map and the layers are tools of the bar (see "The map"). For one commit they were in this card; Kaveh
  wants them on the map ("it has a good design").

### Map tiles: MLT or MVT

The map gets its roads as vector tiles. The setting **Map tiles** in step 6 sets the format of these tiles.

- **MLT** (MapLibre Tile) is the default since 2026-10-29 (Kaveh's order). It stores the data of a tile in columns. MLT needs MapLibre 5.12 or newer. The page has MapLibre 5.24.
- **MVT** (Mapbox Vector Tile) is the second choice.

To switch, choose the format in the list **Map tiles**. If the roads show on the map, the page draws them again with the new format at once. If they do not show, the next draw uses the new format. The page keeps the choice in the browser (`duckosm.tileformat`), so the next visit has it. A visit with no stored choice starts on MLT; a stored MVT (the choice of an earlier visit) stays.

A change of format does not build the roads again. The map worker keeps its tiles and gives the style of the new format (`LiveMap.style(format)`: the vector source has `encoding: "mlt"`). The tile address has the format after the generation: `rs://<generation>/roads/{z}/{x}/{y}?g=<generation>&f=<format>`. A tile of the other format has another address, so the page never uses it.

**Measurements.** Burnaby (driving), headless Chromium with software GL, roadstyle `beffdc9`, the blank base map. Each row is the mean over the tiles of the view, in 2 runs for each format. The page set the same view, then changed the format. "Cut" is the time that the map worker needs to make the tile. "Parse" is the time that MapLibre needs to parse the tile and make its layout, from the answer of the page to the loaded tile.

| Zoom | Tiles | KB for each tile, MVT / MLT | Cut (ms), MVT / MLT | Parse (ms), MVT / MLT |
|---|---|---|---|---|
| 11 | 14 | 113 / 45 | 0.4 / 5.3 | 128 / 122 |
| 13 | 10 | 248 / 90 | 1.1 / 12.8 | 173 / 211 |
| 15 | 9 | 113 / 49 | 0.6 / 7.2 | 133 / 103 |

- An MLT tile has about 40 % of the bytes of an MVT tile.
- The parse time is about the same. The difference is within the noise of the runs.
- The worker needs more time to cut an MLT tile. The MVT times are low because the Rust code can keep the MVT tiles it cut before.
- The picture is the same. On Monaco, with the blank base map, no pixel differs between MVT and MLT (`tile_format_e2e.py`).

**These results can depend on the browser and on the device.** The measurements used one browser (Chromium), software rendering and 2 runs. A phone or another browser can give other times. MLT is the default by Kaveh's order of 2026-10-29. A comparison of MVT and MLT in several browsers is still open; MVT stays as the second choice.

### Step 7: edit the levels

Kaveh's words (2026-10-24): "Add editing dashboard to duckosm rust github io dashboard". The card **Edit levels** puts
roadstyle's level editor on the page's map. The drawing order (`visualization.edge_levels`, [levels.md](levels.md)) comes
from the tags or from the solver. With the editor, the user changes it by hand: which road goes over which road, where two
roads join, the length of the heads and the shape of the line ends. Everything runs in the page: GitHub Pages has no server.

The card shows after a build that has `visualization.edge_levels` (each build of the page has it). The flow:

1. **Edit levels.** The page follows roadstyle's `docs/rust/browser.md`, "The level editor in a page". It makes the level
   area only when the area's edges changed: `areaIsFor(store, edge_hash)` compares the `edge_hash` of
   `visualization.edge_levels_meta` with the hash in the store's `edges.json`. To make the area, the page runs roadstyle's
   query `level_edges` in DuckDB (`duckosmPlan`: the edges of duckOSM's `load_roads`, one row for each `edge_id` of all
   modes) and writes `edges.parquet`. roadstyle's `makeArea` makes the level area from it, and `saveArea` keeps it in
   this browser (`roads.parquet`, `pairs.csv`, `edges.json`, and `edits.csv` only when the store has none, so the edits
   of an earlier session show again). The store is `browserStore("duckosm:<area name>")`, in the private file system of
   the site. The card gives the number of roads and the warnings of `makeArea`.
2. The editor (`levelEditor({map, container, pkgUrl, store, dashboard: rs, levels, host: {edgeIdCol, replaceRoads}, colors})`) draws on the page's own
   map, roads and dashboard (roadstyle `f0a161b`, host mode): the editor has the same colours and profile as the roads of the page.
   `replaceRoads` sends the changed edges to the map worker (`LiveMap.relevel`) and the visible tiles load again; the tables change at **Apply**. `levels` is the build's `visualization.edge_levels` as CSV text,
   with the `edge_hash` of `edge_levels_meta` (`duck.storedLevels()`). The editor starts from its stored `levels.csv`
   when it was solved for the same inputs (roadstyle `6be68c2`: the SHA-256 of `roads.parquet`, `pairs.csv` and
   `edits.csv`), else from the build's levels (since `083224c`); it solves the whole area only when neither fits. Its panel (roadstyle's `level_editor.html`) is on the right of the
   map. A click on a road picks it. The panel has the cards with the ends and the heads, and the tabs Edit, History and
   Issues (roadstyle's guide `docs/guides/levels.md`, "Fix it by hand"). The editor solves again only for a change of
   the order rules (in the roads around the change). Since roadstyle `6be68c2`, a head or a line end (a cap) is drawing
   only: the editor saves it and draws the map again at once, with no solve and no **Apply and solve**.
   The check (`editor_e2e.py` counts the `solve` messages to the editor's worker, 2026-10-25, a busy machine): on
   Monaco (6,830 roads) the first open starts from the build's levels (`given`) and the second from the stored ones
   (`stored`), with no solve on either. The opens take 2.2–7.5 s; at `6be68c2` the first open solved (0.13–0.20 s). On
   Burnaby (76,189 roads) the first open takes 14.1 s and the second 11.5 s, with no solve. A head or a cap change takes
   4–13 s until the map is drawn again; of this time, the worker makes the new tiles and the road table in 1.6–2.2 s
   (`build`), and the rest is the map's new tiles on the page.
3. **← Steps** (after the editor's own *Apply and solve*) writes the editor's `levels.csv` into `visualization.edge_levels`. `edge_levels_meta` gets `source = 'area'`,
   `area = 'this browser: <area name>'` and a new `created` time. `n_edges` and `edge_hash` do not change, because the
   edges are the same. The user's own files go into `level_edits`, `level_heads` and `level_caps`, as roadstyle's
   `save_area_levels` writes them (duckOSM's `duckosm levels` reads them back). The Parquet files, the zip and the
   `.duckdb` download then have the new tables. The editor closes, and the map draws the roads in the new order.
4. **← Steps** removes the editor (`destroy()`), which puts the page's road layers and the page's panel back. With changes
   waiting, the editor first asks: apply, discard or stay. If the editor applied a change in this session, the page then writes
   the editor's `levels.csv` into the tables as step 3 says; if it applied nothing, the tables do not change.
5. The editor's History tab has the download of `edits.csv` (`editor.download`); the page's downloads have the files of the tables.

How the editor shares the map:

- A page has one roadstyle dashboard, because its state is in the module. Thus the editor uses the page's dashboard and
  its prefix `rs-`. It does not make a second dashboard.
- The page's roads and its base-map layers (the duckOSM layers) are in one tile source, `rs-roads`. The editor takes off
  only the page's road layers (it finds them by their source and source layer) and keeps them to put back. Its own
  sources have their own names (`rs-lv-roads`), so the duckOSM base-map layers and OpenFreeMap stay while the editor is
  open. (Until roadstyle `8208486`, the editor needed the name `rs-roads`, and the base-map layers went away.)
- The editor's tiles come from the protocol `lv://`, from roadstyle's module in the editor's own worker (`pkgUrl`: the URL of
  `map/pkg/roadstyle_wasm.js`), not in the map worker.
- The panel follows the page's theme (the theme tool of the bar and the system's theme): its colors are variables, with a dark set
  for `:root[data-theme=dark]` and for the system's dark theme.
- The editor's panel is the page's own panel (`#sb`), as roadstyle's standard host panel: the editor hides the page's steps and title and puts
  them back with `destroy()`. There is no second panel and no page bar (before 2026-10-30 the editor had a frame, `#lvhost`, and the page had
  a bar with Apply and Close).
- The dashboard checks the interaction contract of each roads style (`roadstyle:contract`, since `6be68c2`). The page's
  look is not "live", so its styles have no contract. The dashboard reads them as version 1 and writes an info line in
  the console, not an error.

Limits:

- One editor at a time. A new build closes it.
- The editor's panel covers the right side of the map (400 px). It is not in the page's side panel.
- The store is for each area name. If a different area gets the same name, the old edits can name roads that the new
  area does not have.
- Until roadstyle `65af6e6`, roadstyle's store kept the text files in `localStorage`, which has about 5 MB for the site,
  and Burnaby's `pairs.csv` (12.2 MB) was larger (Kaveh, 2026-10-25: "exceeded the quota"). Since `65af6e6` every file
  of the editor is in the site's private file system (OPFS); `localStorage` keeps only the save times. Burnaby's editor
  now opens with its files kept (76,189 roads, 232,831 pairs, 23 s). If the private file system fails too (a full
  storage), a file that the browser cannot keep stays in memory for the page, the editor opens, and card 7 says: "The browser could not keep the area files (N MB): your edits stay only until you
  close the page; download edits.csv to keep them." `editor_e2e.py` tests it with a private file system that refuses each file over 100 KB (Monaco: 2.7 MB stays in
  memory).
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
`window.lvApi` (an end head of 7 m) and leaves with **← Steps**, which applies it. Then it checks the tables in the page and in the
`.duckdb` download, a map of one mode, the duckOSM base-map layers while the editor is open, and **← Steps** with no change. It writes `editor.png` and
`editor-dark.png` (the dark theme).

## The map

- The roads of roadstyle's style go onto the same map: their sources and layers are added with the prefix
  `rs-`, as GeoLibre's roadstyle plugin does. The sources are vector tiles that the map worker makes when the map
  asks for them (protocol `rs://`, [browser.md](browser.md)). They are over the base map and under the area line, the
  matches, the extracts and the drawn shapes. The style's images (the one-way arrow) are added under the same
  prefix. A layer with `text-font` gets a font of OpenFreeMap (Noto Sans).
- When the roads show, the fill of the area goes away and only its line stays, so the fill does not change
  the colors of the roads.
- The base map (since roadstyle `fc59e6c`, 2026-10-25) has the theme "liberty" and stops at the area's boundary. `map/look.json` is version 2: `make_look.mjs` makes it, and the worker sets `levels` with `withArg`.
- The tiles (since roadstyle `b976864`, 2026-10-25). At a low zoom only the roads of the classes that the look's profile
  shows there are in the tiles (each class's `minzoom`), and a casing narrower than 1 px is left out. The tiles go to
  zoom 18 (`config.tiles.maxzoom` in `map/look.json`, before 15): MapLibre scales the last zoom's tiles up, and at
  zoom 21–22 a casing piece of a zoom-15 tile stood up to 4–5 px off its fill (Kaveh saw it on Burnaby's edge
  1069319787511741120: a step at the join of two pieces). Monaco, the centre tile at zoom 12: 1.24 MB before, 186 KB
  after; at zoom 14: 796 KB before, 223 KB after. The time of a cold view at zoom 12 or 14 (the jump to the map's idle) is
  about 0.35–0.65 s before and after: the base map and MapLibre take most of it. Burnaby, all networks: the tab after the
  draw is 2,570 MiB (before 3,002 MiB).
- **roadstyle's dashboard** (2026-10-23, Kaveh: "go") does the map's interaction: the 2D/3D button, Street View with
  its marker, Google 3D, the road popup, the hover tooltip, the purple glow of the selected road, and the legend of a
  `color_by`. It is roadstyle's one module `rust/roadstyle-assets/files/static/dashboard/`, which `build.sh` takes at
  `ROADSTYLE_COMMIT` into `www/map/roadstyle/dashboard/` (not in git; `e2e.py` checks that the served files are
  roadstyle's). The page calls `rsDashboard(map, {prefix: "rs-", tiles: true})` with no `pick` option: roadstyle picks the road layers of the style (`roads-simple` and one layer for each band of zooms)
  once, before the roads; after each build or network change, `showRoads` adds the roads style's sources and layers
  with the prefix (the one vector source `rs-roads`, with no `promoteId`: since tile contract 2 the id of each piece is the road's row in the road table, and one feature state lights all pieces of a road) and gives the
  style to `rs.setStyle`. The map worker sends the road table (the fields of each road) with the style, and the page
  puts it in `window.RS_SIDE`, where the dashboard reads the fields of a clicked road. (Until roadstyle `aba5884`, the
  dashboard asked the map worker for each road with `engine.props`; roadstyle removed that option.) The page removes the
  popup and the selection while the user draws or uses **What is here?**. The legend sits beside the panel.
- The tools of the map (since 2026-10-29 in roadstyle's bar, see "roadstyle's dashboard look"; before, the buttons under the zoom
  buttons, Kaveh's design of 2026-10-23, from roadstyle's map): navigate, Street View, Google 3D, the base map and the 3D buildings switch:
  - **Navigate** (the compass needle) opens a box with a zoom slider, a turn slider and a tilt slider; its reset button sets north
    and the flat view. The tilt does not change the buildings.
  - **3D buildings** (the building icon) is roadstyle's tool. It is on for a vector base map (OpenFreeMap) and greyed out for the
    others. It switches the 3D buildings of that base map, in the tilted view. The same switch is a row in the base-map box.
  - **Base map** (the layers icon) opens roadstyle's box: OpenFreeMap (Liberty, Positron), OpenStreetMap, Esri (Gray, Streets,
    Satellite) and Blank. A map with a dark twin follows the theme. The box has the rows **Hillshade**, **Labels** and
    **3D buildings** under "On top". The page keeps the base map.
  - **Street View** (the person) opens roadstyle's floating window. A click on a road shows Google Street View there.
    The window can be dragged and resized, stays inside the map, and the page keeps whether it is open and where. No
    key is needed; it loads only in a page served over http(s). Open (at roadstyle `aba5884`): with tiles, the
    dashboard does not find the clicked road's line (`_svFeat` in `svspot.js` does not use `_svTiled`), so Street View
    stands at the click and looks north, and the map has no marker. The fix is in roadstyle's dashboard.
  - **Your Google Maps key** (the gear button of the bar, or the button in card 6): the key stays in this browser
    (`localStorage`, `rs-key:google`), never in the address or the code. The dashboard reads it when the page opens (the settings box
    has a **Reload** button); with it, the Street View window has roadstyle's **Linked** mode beside **Classic**, and the
    **Google 3D** window works (its camera and the map's linked both ways). Without a key, the Google 3D window asks for one.
  - No button hides the footprints: the style alone decides if they show (Kaveh's rule).
- The 3D buildings of the area (the duckOSM layers) have a switch: roadstyle's 3D buildings tool (and a row **Buildings 3D** where a page
  has a Layers box). roadstyle's tool for a vector base map (OpenFreeMap) is replaced by the tool of the area when the
  style has a 3D layer, and comes back when it has none.
- The height of a building (roadstyle-rs, rule C of mapstyle's `docs/design/buildings_3d.md`): the higher of
  `height` and (`building:levels` + `roof:levels`) × 3.66 m (as OpenMapTiles), or the one that is there, else the
  height of its kind. The higher of the two keeps Tartu's buildings correct, where `height` is often an ETAK code.
  Its base is `min_height`, else `building:min_level` × 3.66 m. A building with no tags has the height of its kind (9 m
  by default); OpenFreeMap gives it 5 m.
- Until roadstyle `65af6e6` the SQL read only the first character of each height tag (`tags['k'][1]` on a text: "25"
  became "2"), so every tower was short (Metrotower 7.3 m in place of 91.5 m). The number of the earlier text, "0.36 m on
  Monaco", was measured with that fault and is not valid. The measurement of 2026-10-25 (each of our buildings against
  the OpenFreeMap building that holds its centre, in the page at z 16 / 15.5 with the 3D buildings on):

  | | Buildings matched | Median difference (all) | Towers (OpenFreeMap 30 m or more) | Towers within 10 % | Median difference of the towers |
  |---|---|---|---|---|---|
  | Burnaby, Metrotown, before (`bcea0ae`) | 3,876 | 0 m | 81 | 0 | 70 m (ours at most 25.6 m) |
  | Burnaby, Metrotown, after (`65af6e6`) | 3,876 | 0 m | 81 | 74 | 0.6 m |
  | Monaco, before | 1,155 | +4 m | 106 | 35 | 37 m (ours at most 32.9 m) |
  | Monaco, after | 1,155 | +4 m | 106 | 97 | 0.4 m |

  The median of all buildings is mostly houses with no tags, so it does not change. Monaco's +4 m is the height of the
  kind (9 m) against OpenFreeMap's 5 m. A tower that is higher than OpenFreeMap (Le Millefiori: 135 m, OpenFreeMap 111 m)
  has `building:levels` × 3.66 m above its `height` tag; rule C takes the higher of the two.

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

## Gaps in roadstyle (2026-10-29)

Kaveh's rule: the page uses the standard dashboard and the standard toolbox, and does not change them. The page does not make its own version
of what the standard lacks. One gap is open (roadstyle `9d745c9`, the pin of 2026-10-30):

1. **The editor's full sheet on a phone** starts under roadstyle's top bar (the sheet is `100% - 48px` high), so its handle is under the bar
   (`[0, 49, 390, 73]`). It was reachable at `6fdc893` and `4d61862`, and it is covered again at `9d745c9`. `phone_e2e.py` prints `GAP` and clicks
   the handle with a script. The page does not correct it.

Fixed in roadstyle `6d37af5`, `f460335`, `dd08231`, `6fdc893` and `4d61862` (the page has no adapter for them): a box that leaves a phone's screen sideways; a raster base
map that goes on top of the roads of a host page; the list of base maps and the typed `dashboard` with its first paint for a JavaScript host
(`data/host_options.json`, `rsFirstPaint`); `rsSetBasemap("blank")` that gives the dark twin in the dark theme; OpenFreeMap's sprite;
the panel's shell rules (now in `dashboard.css`); the sheet and the free part of the map (`rs.sheet()`, `rs.freeArea()`); a tool found by
`data-rs-tool`. The switch of the area's layers (in the Base map box), their list in the legend box, the 3D switch and "Colour by and legend" need a live look (`state: "live"`): a page with a dashboard has one.
`dashboard_e2e.py` and `e2e.py` check each of them. The switch **Map layers** hides every layer of the area's own data (`e2e.py` lists the visible layers with the switch off: only the base map, the roads and the page's own layers). A page with a bar has no floating box (the Roads box is gone).

Load time (headless Chromium, 1400 × 900, no CPU throttle, median of 5 runs, local server): the panel has its form after 81 ms (before, with
`hostOptions` in the WebAssembly module on the main thread: 189 ms), and the map is shown after 1,458 ms (before: 1,551 ms). The first visit
(a new profile; the service worker installs and reloads the page once) shows the map after 1,663 ms (before: 1,775 ms).
