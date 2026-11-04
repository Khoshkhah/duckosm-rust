# Changelog

All versions are on the GitHub Releases page of `Khoshkhah/duckosm-rust`. There is no PyPI package yet
(design.md, open question 2).

## Not released

### Added

- **Unselect the area, the H3 row and "Your areas" picks in the browser page**: **Unselect the area** (cards 1 and 2, or a second click on the chosen search result) removes the boundary so that another part can be chosen. The base-map box has a row **H3 hexagons** (roadstyle's `rsAddTopRow`) that shows or hides the grid, and a build from hexagons hides it (only the boundary stays). A click on a row of **Your areas** shows its boundary on the map and zooms to it, a second click hides it, and **Open** loads it. The page no longer redraws the boundary of the last build at the start (it showed with the row's boundary), and a build no longer saves the blank base map as the person's choice, so the next visit starts on OpenFreeMap.
- **Hide the Fix OSM data panel**: the header of the panel has a **Hide panel** button (on a computer). The map takes the space, and the button at the corner shows the panel again with the tab and the picks as they were.
- **H3 IDs in the Search tab, and the H3 ID as the name**: type one H3 cell ID, or several separated by spaces or commas (15 hex digits each, one level from 5 to 10), and the page makes the area from the cells with no network, opens the H3 tab and zooms to them. The name that the page suggests for an area from hexagons is the ID of the first cell, with `-plus-N` for N more cells. A name that you typed stays.
- **The Turn tab lists the junctions** like the walls of a building: the junction that the tab picked has the mark, a click picks another, and a click on a road that leaves the junction picks it (the outline stays on the map). Rows under the pointer have a tint, the picked rows use the panel's accent (they show in the dark theme), and a picked row scrolls into view above the bar at the bottom of the panel (this fixes the walls list too).
- **An H3 tab in card 1 of the browser page**: choose the level (5 to 10, with the size of a cell), then click hexagons on the map to add or remove them. The union of the cells is the area (touching cells make one polygon, a ring keeps its hole). The tab shows the number of cells and the area in km², and has **Clear the cells**. The cap is 500 cells and 5,000 km². The page loads `h3-js@4.2.1` from cdn.jsdelivr.net. Card 1 stays open while the tab is open. docs/app.md, "Step 1: the H3 tab". Test: `h3_e2e.py`.
- **Draw a new road, and "was to now", in the fixes panel**: **Draw a new road** takes clicks on the map (a click near a junction joins it), the kind, name, one-way and more, and writes a `new_ways` rule. A rule keeps what the data had before the first change of a key (`was` in `extra.tag_edits`, read by nobody in the build), and **Changes** shows `lanes 7 (was 2)`. The Rust parser accepts `was`. Test: `fixes_e2e.py`, `fixes_units.mjs`.
- **Building faces, `main.building_faces`**: one row for each wall of a building, with a type (`front`, `back`, `side`, `party`) from the streets that the wall can see, the street that it faces, the length and the direction. New: `building_faces.rs` in duckosm-core, `Params.building_faces`, the CLI option `--building-faces`, `write_building_faces_to`. The page makes the table with the layers, lists the walls of a selected building and draws them by type. `extra.building_faces` in the fixes file gives a wall another type; the table keeps the computed type. Tests: `building_faces.rs` (9 cases), `tests/building_faces.rs` (Monaco: 9,907 walls of 1,231 buildings, the same bytes on two runs, a rule), the parser, `fixes_e2e.py`.
- **`main.building_info`** (a table of the page, with the layers on): floors, height in meters, roof shape, roof and facade colors as `#rrggbb`, and materials of each building, read from its tags. Edited buildings are drawn as 3D extrusions in the fixes panel, with their height and color. Checks without a browser: `fixes_units.mjs`.
- **Card 7, Fix OSM data, in the browser page**: **Edit fixes** opens a panel of its own (like the level editor's). Click a road, a building or a node (a traffic signal or a crossing), and the panel shows all its tags and a form of preset fields (road: sidewalk, cycleway, crossing, surface, speed, access, lanes, one-way; building: floors, height, roof shape, roof color, facade color, materials), filled with the data. Other tags can be added and deleted. A **Changes** list shows every rule, with undo and redo, and a click shows the object on the map. Changed objects have an amber glow. Turn rules are in the same list. The page does not show the YAML. The rules are data (`app/fixes.js`) and the page writes the file; tag changes go to `extra.tag_edits`. Presets are in `app/presets.json`. The level editor is now card 8. Test: `fixes_e2e.py`.
- **Tag edits, `extra.tag_edits`, in the fixes file** (an extension for the page's fixes panel): set and delete tags of a way, a node or a relation. The rule acts on the ways as read (the network) and on `raw.*` (the base-map layers). A file with only duckOSM keys gives the same output, and duckOSM (Python) ignores the key. New: `Elem`, `TagEdit`, `OsmFixes.tag_edits`, `Tags::remove`, `Way::remove_tag`. Test: `tag_edits.rs`.
- **The cut area as a download, `.osm.pbf`**: after a build from a region file (with **Base map layers** on), card 5 has a button
  `.osm.pbf` with the nodes, ways and relations of the cut (osmium's `smart` cut, before the OSM fixes), and the page accepts the
  file again as the "Cut file". New: `cutfile.rs` (the PBF writer and an `.osm` XML writer, with `miniz_oxide`), the CLI options
  `--cut-pbf` and `--cut-osm`, `Params.cut_pbf` and `cut_osm`.
- **A buffer around the area** in card 2 of the browser page: **Buffer around the area (m)**, 0 by default, as duckOSM's `boundary.buffer_m` (metres, in the UTM zone of the area's centre). The cut, the Overpass query and the saved GeoJSON use the grown area (docs/app.md, "The buffer"). `buffer_e2e.py` tests it.
- **Saved areas in the browser page**: each build is saved in the browser (OPFS) with its drawing cache. A banner restores the last area with no build, and the **Saved** tab of card 1 lists, opens and deletes areas (docs/app.md, "Saved areas"). `saved_e2e.py` tests it.
- **The elevation step, `--dem FILE`** (duckOSM `duckosm elevation --dem`): the build samples a DEM (a GeoTIFF in EPSG:4326, 32-bit
  floats, uncompressed or deflate) at every node and at every vertex of every edge, as rasterio's `sample` does (the pixel that holds
  the point, 2 decimals). It writes `elevation_nodes_<mode>.parquet`, `elevation_edges_<mode>.parquet` (`z_from`, `z_to` and
  `z_vertices`, one height for each vertex) and `elevation_metadata_main.parquet`; the .duckdb gets duckOSM's columns `nodes.ele`,
  `edges.z_from`, `z_to`, `z_vertices` and `main.elevation_metadata`. On Monaco (Copernicus GLO-30) every value equals Python
  duckOSM's. New crate: `tiff` 0.11.3 (deflate only).

### Changed

- A disabled button or card title has the normal cursor, not the forbidden sign (Kaveh, 2026-11-03).
- **The H3 grid shows in the dark theme.** The lines were dark gray and were not seen on the dark map. The dark theme has light lines, a white hover and a lighter blue for the picked cells. `h3_e2e.py` checks both themes.
- **Fix: a slow start no longer loses the map's `load` event.** The wait for `local_keys.json` (added the same day) came before the page listened for `load`. On a slow link (a test page behind an ssh tunnel) the map loaded during that wait, and then nothing that waits for `load` ran: no area on the map, no zoom, no H3 grid, no layers. The page listens for `load` right after it makes the map, before any wait. `search_e2e.py` has a test with a file that answers after 4 seconds.
- **Search in step 1: the map zooms at once, and a failed boundary shows.** A click on a result moves the map to the box of the place before the boundary comes. When Nominatim fails (a limit such as 429, or a network rule), the text stays under the list, the radio is off again so a second click asks again, and **use the box of the place** makes the area from Photon's box. Before, a failure showed only a short message and the map stayed. `search_e2e.py` checks both paths.
- **H3 tab: the grid shows at once.** The tab zooms in by itself when it opens on a view with too many hexagons (the map starts on Europe), a click on such a view picks nothing and says why (a cell that you cannot see is not picked), and the note has a **Zoom in** button. The test server sends `Cache-Control: no-store` (a browser kept old files and mixed them with new ones), and a page on localhost shows a red bar with the first error of the page.
- **The limit of the map is the same on every page, and the note is clear.** A desktop page drew with no limit, and the engine failed with "this area has 243102 roads, and a browser page draws at most 200000"; the page added "on this device the map can show up to ∞". A desktop page has the limit of the engine (200,000 roads) now, it says so before it draws, and the note lists the networks that fit with their number of roads. `roads_limit_e2e.py` checks it.
- **The H3 tab draws a grid of hexagons**: a transparent layer with every hexagon in view at the chosen level, the hexagon under the pointer lit, and the picked cells filled. Too many hexagons for the view: no grid, and a note says to zoom in or to choose a bigger hexagon.
- **Doors in the Building tab, and a new table `main.building_entrances`.** The page makes the table from `raw.nodes` and `raw.ways` (the nodes with `entrance` or `door`, and the building that has the node in its outline). The Building tab draws the doors as brown dots (zoom 17 or more), lists the doors of the picked building with their kind, address and access, and a door kind is a tag edit of the node. `fixes_e2e.py` checks the list, the dots, the edit and the table after a build.
- **Delete a road or a building, and constraints for signals and crossings.** The Road, Building and Node tabs have a red **Delete** section (the rule `remove`; a relation building loses its `building` tag; a signal or a crossing loses its tags). A deleted object is red on the map and in the list. A traffic signal needs a junction of at least 3 roads, a crossing needs a crossable road class, a motorway or a trunk road takes neither, and a node has one kind. `fixes_e2e.py` checks the rules and the deletes (the tables after a build).
- **A saved area keeps its cut file** (`cut.osm.pbf` in the browser storage, `hasCut` in `meta.json`). The **.osm.pbf** button of card 5 is there after a restore, and it reads the file only when you download it. An older save has no cut file, so it has no button. Monaco: 552 KB.
- **Card 4 (Build) has a new layout**: the networks are three chips, the base map layers are one row with a reason, and Fixes, Build details and Time and memory are flat rows that open. In every card title the row ends with the done mark, the "?" and the chevron; in card 2 the zoom button comes before the done mark. **Card 5 has a .yaml button** (the fixes file that the build used, `osm_fixes.yaml`).
- **The Build card has no "Drawing order" choice.** The page always uses the optimizer ("Optimized (slower)"), as the default was since 2026-10-24. The CLI keeps `--levels tags`.
- **Card 1 opens the Saved tab when areas are saved**, in place of the banner "Open your last area?". The list has **Open** and **Delete** for each area, as before. The fourth tab (Saved) wrapped to a second row and did not look like a tab: the tab bar has one row for all its tabs now (`grid-auto-flow: column`).
- **The map shows the one-way arrows and the street names.** The page's look had `arrows` and `labels` off (`make_look.mjs`). They are on now. The fonts are the base map's (OpenFreeMap): 3.1 MB on Monaco with the names on and off.
- **The Fix OSM data panel has six tabs: Road, Building, Node, Turn, New road and Changes.** The old buttons "A click picks" looked like tabs but kept the form of the last object. Now each of Road, Building and Node has its own picked object, form and draft, and a map click picks the kind of the active tab. A tab has sections (Pick, Selected, the fields in groups, Other tags), and each tab has an **Add to changes** button: nothing is in the rules before it is pressed. **Draw a new road** is the New road tab. The Changes tab shows each field as `was → now` in groups, and it has the one **Build again** button, which waits while a tab has edits that are not added (the tab has an amber dot). The page keeps the changes in this browser for each area name, and the picked objects stay after a build. A wall of the picked building can be selected: click its row or the wall on the map, or step with **Previous** and **Next**; the map outlines the selected wall. Road, Building, Node and Turn have an **Unselect** button. The Turn tab lists the junctions with the number of roads that leave each one, says why when no road leaves, and lists the roads that arrive so that one can be the start road. The Turn tab shows the road that the turn starts on (blue), the junction (a ring) and the roads that leave it (green, with a hover outline from the list). Leaving the panel unselects everything on the map. The Node tab draws the traffic signals and crossings in view as dots (with a legend, and a ring, the pointer cursor and a tooltip on hover). The blue (picked) and amber (changed) layers were never drawn: a BigInt OSM id in a feature property stopped the map's source, so only the counts were right. The ids are numbers now, and `fixes_e2e.py` checks that the layers render. A switch of tab zooms the map to the object of that tab, a click on a change opens it in its tab for edit (a new road opens in the New road tab: its tags change, its points stay), and the check box for the walls of all buildings is only in the Building tab. The groups of the fields are `group` in `app/presets.json`. `fixes_e2e.py` checks the tabs, the guard, the kept changes and the state after a build. See [docs/osm-editing.md](docs/osm-editing.md), "The panel".
- **The page uses roadstyle 0.27.0** (`3ecfca6771c4bcabef8daa20b7a2a7b1825a2fb1`: the tag `v0.27.0` and the five level-editor commits of the branch `editor-fast-open-0.27`, which are the commits of `editor-fast-open` on top of 0.27.0). The panel of 0.27.0 starts empty and a section with a label is a card, so the page's numbered steps take roadstyle's card (its box, padding and gap) and keep only the number, the done mark and the reason in the title row. The page no longer gives `panel.hide` or `phone` (the phone form starts at 700 px). The title button of each card has the id `stepN`.
- Before that, the page used roadstyle `bc2f11f13979b5b6ff601d5c73c59b69df54c6cf` (`0.26.3` and the level editor that opens in the page's map, branch `editor-fast-open`): the level editor's map follows the dashboard theme, and the area's layers (the **Map layers** switch and the legend list) stay inside the editor. The page gives the editor its look (`look`: `map/look.json`), so the editor's roads have the page's palette and colour options. `editor_path_e2e.py` checks the theme, the layers, the Base map box, the legend box and a theme change inside the open editor. `map/look.json` has `roads.split.overlap_px` (0.15), which this version needs: the map failed without it. A two-way road is two halves, one for each direction, so the editor test accepts a hover on either half. The editor marks the start of a road with a circle and its end with a square, on the map and in the panel.
- **Card 5: the networks of the build are a table** (Network with its icon, Roads, Junctions; numbers right-aligned), in roadstyle's table, in place of the line "driving 57,765 / 26,535 · ... (edges / nodes)".
- **The progress of a build is in one place**: the map's busy box (also on a phone: the page opens the sheet only to its middle height, so the box is in view). The Build button is off with a small spinner, and there is no text line under it. Card 4 has only the result of the build or its error. `buttons_e2e.py` checks that only one element says "Building" during a build, that it is in the map's busy box, and (on a phone) that the box is above the sheet.

- **Every card is calm and short** (Kaveh, 2026-10-30: "check every card ... for optimizing and better layout, and remove unnecessary parts"). The explanations moved into the "?" help of the card, the credits into roadstyle's credits box. What changed in each card:
  - **1 Choose an area:** one search field with the "What is here?" icon button inside it (no Search button, no "Type a place first", no "Then click the map", no credits paragraph); the Draw tab is one row of icon tools (rectangle, polygon, circle, freehand, select, merge, delete, delete all; each with a label and a tooltip; 44 px and a sideways scroll on a phone) and one hint line; the File tab has one line. Photon and Nominatim are in the credits box.
  - **2 The area:** the name and one row of three figures; the "Source:" line and the empty box "No area yet" are gone (the card is disabled with its reason until there is an area).
  - **3 The data:** the "The file must cover the area..." paragraph, the Overpass and Cut file explanations and the placeholders ("Choose an area first.") are gone; the list of files shows only when it has files.
  - **4 Build:** the networks and "Layers" in one group of checks; "Advanced: fixes to the map data" is "Fixes" with no paragraph; "Base map layers" text is in the help; the two detail tables are in one scroll area, closed.
  - **5 The result:** "built in N s" is not repeated (the build line has it); the downloads are one row of two icon buttons (.zip, .duckdb); "Downloads: each table" is "Each table"; the result and the list of files scroll in a fixed height.
  - **6 Visualization:** "MLT (default, smaller tiles)" is "MLT"; the note is "13,298 roads, drawn in 2.4 s".
  - **7 Edit levels:** the status lines are short ("Opening the level editor..." is shown once, by the button's reason; "Applied. Rules: 1, heads: 0, line ends: 0. The map draws it.").
  - Spacing: the body of a card is one column with one gap.

- The page uses roadstyle `0.26.1` (`49f948a6ab1f3da5bc5834fbc5f2bbc59f8437a6`) and drops its own versions of what the standard now gives:
  - the step cards are `rs.sections` that fold (`fold: true`); the button of the title row "Collapse all" / "Expand all" is roadstyle's (`#rs-fold-all`); the page's own button is gone;
  - the "?" of a card is `rs.help.button(el, {...})`: the page's code that set the words again for each card and set the overview back is gone;
  - the accent is roadstyle's teal (`--accent`, and `--accent-fill` for Build); the page's `--accent-fg` is gone;
  - a page that starts in the dark theme has no error (the test no longer has a `GAP` for it); the credits button is whole on a 390 px screen (no `GAP`); a tool of the bar is 26 px wide at least on a phone.
  `docs/app.md` has no open gap in roadstyle.

- **The panel follows the steps** (Kaveh, 2026-10-30). All cards are in view and folded at the start; only the current step is open. A card whose inputs are not ready is disabled, grey, with its reason in the title row ("after step 2"). A finished step has a done mark (✓) and can still be opened; when a step is finished the next card opens and the others fold (unless the person opened cards by hand). The page keeps only "collapse all" (`duckosm.cards`), not the fold of each card.
- **A button in the panel's title row: Collapse all / Expand all** (it acts on the active cards; roadstyle's standard has no such control). The panel's title is an `h2`, as in roadstyle's template.
- **Help windows.** The "?" of roadstyle's help window (`rs.help`) is in the panel's title (overview, the data stays in this browser, links to the documentation), and a card with a long explanation has a short card and a "?" in its title row (the same window with the words of the card). The long texts of cards 1, 3, 4, 5, 6 and 7 moved there. `panel_e2e.py` checks that every link answers 200.
- **The Google key card is gone** (the paragraph and the button "Open the settings" in card 6): the gear of the bar has the key row, and the help window says how to get a key.
- **Buttons.** Only Build is filled with the accent; Search, Show on map, Edit levels, Download all (.zip) and the others are the secondary style. Search is joined to its field. An action button is disabled until its inputs are ready, in a clear grey (the panel's tokens, not-allowed cursor, no hover), with the reason as text under it (not a tooltip): Search, GeoJSON, Build, Run (SQL), Show on map and Edit levels. `buttons_e2e.py` checks each of them.
- **The page has no accent of its own** (the `--accent` values of the page are gone): the accent is roadstyle's (`var(--accent)`), so the teal of roadstyle 0.26.1 shows with the next pin.
- **The level editor draws its own roads** on the page's map (`levelEditor({..., dashboard: rs, prefix: "rs-"})`, no `host` option), as roadstyle's own editor page does. The hover and the picks are the editor's: lighter red for the next road that a click picks first, lighter blue for the second, red and blue picks, and no tooltip or popup of the page's dashboard while the editor is open (before, the `host` mode kept the page's violet hover and its popups). The editor opens in 1 to 2 s on Monaco (before: 0.3 s). `editor_path_e2e.py` checks the hover and the pick colours.

- The page uses roadstyle `0.26.0` (`07c85b5036ab229deb5e7fa423f2322ce64aba69`): the editor draws into the host's standard panel (the apply bar, the History tab with edits.csv), the toolbar is at the right edge by default, 7 base maps (no Bright map), MLT is the default tile format. `map/look.json` is made again. `dashboard_e2e.py` and `tile_format_e2e.py` follow the bar at the right edge, `editor_e2e.py` finds the theme tool by its id.
- The test `editor_path_e2e.py`: the editor as a person uses it, with real clicks and on a phone with touch: Edit levels, two roads picked, a change added, "← Steps" with the change waiting (Stay, Discard, Apply), Apply and solve, "← Steps": the edit is in the tables. It runs on a computer (light and dark) and on a phone, and checks the seven base maps.
- **MLT is the default tile format** of the roads map (Kaveh's order, 2026-10-29): the setting **Map tiles** lists MLT first and MVT second, and a stored MVT choice stays (this was PR #36).
- Roadstyle gap: the credits button is outside a phone's screen at 390 px (the bar of ten tools is 372 px wide). `dashboard_e2e.py` prints `GAP`; `docs/app.md` has it.

- **The level editor uses the page's one panel.** roadstyle's editor draws into `#sb` (`levelEditor({panel, backLabel: "Steps"})`): the page's steps, title and footer are hidden while it is open, and **← Steps** brings them back. The page's own bar with Apply and Close, the editor's frame (`#lvhost`) and the page's edits.csv and levels.csv buttons are gone (the editor's History tab has the `edits.csv` download). **← Steps** writes the changes that the editor applied into the tables; with none applied, the tables do not change. On a phone the editor is in the page's sheet. The picked roads are red and blue, and the tabs and rows are roadstyle's segmented control. `build.sh` pins the roadstyle commit with this editor. `editor_e2e.py` and `phone_e2e.py` follow the new flow.

- The test `dashboard_e2e.py`: the form of roadstyle's dashboard on a computer (1400 × 900) and on a phone (390 × 844): the bar and its tools, the panel, one look for the cards in both themes, the boxes, the settings and the Google key, the windows, the sheet.
- The setting **Map tiles** in card 6: MVT (the default) or MLT. MLT (MapLibre Tile) is the second tile format of roadstyle. The page keeps the choice in the browser (`duckosm.tileformat`). A change gives the roads on the map the style of the new format (the source's `encoding`) and puts the format in each tile address (`rs://<generation>/roads/{z}/{x}/{y}?g=<generation>&f=<format>`), so the page never uses a tile of the other format. The map worker keeps its tiles. MLT needs MapLibre 5.12 or newer (the page has 5.24). Burnaby, headless Chromium, software GL: an MLT tile has about 40 % of the bytes of an MVT tile, MapLibre needs about the same time to parse it, and the worker needs more time to cut it. The picture is the same: no pixel differs on Monaco. The results can depend on the browser and on the device. MVT stays the default until MVT and MLT are compared in several browsers. The numbers are in `docs/app.md`, "Map tiles: MVT or MLT".
- The test `tile_format_e2e.py` (Monaco): MVT is the default, the address and the style have the format, MLT gives the same picture, and the page keeps the choice.
- The region download reads the file in up to 8 parts at the same time (HTTP `Range`) through the relay, from the dated file that "latest" points to. The relay passes `Range` and gives `Content-Location`; `serve.py` does the same. The page needs a new deploy of the relay for this; with the old relay it reads one stream, as before (docs/relay.md).

### Fixed

- **The download of a big region started after 30 s, and could end with 502 or 503 from the relay.** Geofabrik answers `<region>-latest.osm.pbf` of a big region after about 30 s, each time. The page now asks for the dated files of the last 5 days and takes the newest that answers within 1.5 s (`app/regions.js`, docs/relay.md). First bytes of `southcoast-admreg`: 2.7 s, not 30 s.
- The button that shows the hidden panel had a filled black square in place of its icon: its SVG had none of the attributes (`fill="none"`, `stroke`) that roadstyle's template gives it, and the page's own rule for SVGs does not reach a button outside the panel. The page now has the markup of the template's two buttons (`#sb-hide`, `#sb-show`) and no rule of its own for their SVGs. `dashboard_e2e.py` checks the icon, its size and its place. No other SVG of the page has this fault: the filled ones are roadstyle's own tool icons.

- The source files `app/duck.js`, `build_worker.js`, `index.html` and `map/map_worker.js` had the version `?v=check` in their references (PR #27: `version_refs.py` was run in the work folder with the version `check`, not with `--check`). The deploy script adds a version only to a reference that has none, so the deployed page kept `?v=check` and a browser could take an old file from its cache after a deploy. The references have no version in the source again; the deploy adds it. `version_refs.py` now refuses to change the page's own folder (use a copy; `--check` only reads).
- A zoom out no longer makes the area black for 0.5 to 1.7 s (Burnaby, pitch 60, headless Chromium): the page draws the opaque fill layers (land, water) also from a second source `rs-low` of the same tiles with the last zoom 9, so MapLibre always has a loaded tile to over-zoom.
- The page sends the tile requests to the map worker newest first and skips a request that MapLibre aborted (a zoom step that passed): in a fast zoom, 71 tile calls and 4 MB, not 153 to 177 calls and 8 to 9 MB.

### Removed

- The page's own copies of standard parts: the base-map box and its code (`BASEMAPS`, `BLANKS`, `setBase`), the 3D buildings tool, the **duckOSM layers** check box, `keepInside` (the page moved the boxes inside the window), the CSS of the page's box, and the correction of the editor's full sheet.
- The page's adapters for gaps that roadstyle `6d37af5` fixed: `window.DASHBOARD` and the first-paint script, the list of base maps (`basemaps.json`, `tilesOf`, `solid`), `withBase` and the move of the raster layer, the choice of `blank_dark`, the copy of the panel's shell rules, the import of `setSheet`, the code that reads the panel and the bar for the free part of the map, and the `data-t` tags in the tests. `build.sh` copies `host_options.json` in place of `basemaps.json`.

### Changed

- The page uses roadstyle `6205d9c585e0f09bf716089b7b78369d5ff16d99` (`design-dashboard-d26`): the tool **Roads** (the road filter in the bar, after the base map button) with a row for each road class, All and None, Bridges, Tunnels and the restricted kinds. The page uses the toolbar as it is. `dashboard_e2e.py` has the new tool list; `e2e.py` checks the Roads tool on Monaco (the rows and their counts, None, All, one class, Bridges, Tunnels), and a phone (390 × 844) shows its box inside the screen.

- **MLT is the default tile format** of the roads map (Kaveh's order, 2026-10-29). The setting **Map tiles** lists MLT first and MVT second. A visit with no stored choice starts on MLT; a stored MVT stays. `tile_format_e2e.py` checks the new default, the choice of MVT and the way back.

- The base map is roadstyle's (Kaveh's rule of 2026-10-29: every dashboard uses the standard template and toolbox, and the page does not change them). The page gives the dashboard the base maps of `host_options.json` (roadstyle's file) and a map with the layers `bg` and `basemap`. The tool, the box, the link to the theme (a map with a dark twin follows the theme) and the 3D buildings tool are roadstyle's. The page starts on OpenFreeMap Liberty. The page keeps the light key of the choice (`duckosm.basemap`). **Show on map** sets Blank (roadstyle gives the dark twin in the dark theme).
- The page uses roadstyle `4d61862f523fdfcd0ea26cb70f6b14dd58784336` (branch `claude/page-gaps-38e9d3`, with `design-dashboard-d25`): the fixed toolbox, the base-map tool and the fixes for a JavaScript host page (`rsFirstPaint`, `rs.sheet()`, `rs.freeArea()`, `data-rs-tool`, boxes that stay inside the screen sideways, the dark twin for `rsSetBasemap`, the sprite of a vector base map, one switch for the area's layers in the Base map box and their list in the legend box, the 3D switch, and every control of a style for each `rs.setStyle`). The options of the dashboard (`dashboard`, `first_paint`, `basemaps`, `ontop`) are `data/host_options.json` of roadstyle (`build.sh` copies it; no WebAssembly module loads before the map): the page has no copy of the defaults.
- The bar has roadstyle's default toolbox of `6fdc893`: one **navigate** button (the compass needle; a box with zoom, turn and tilt sliders and a reset button; Ctrl + drag on the map turns and tilts it) in place of zoom in, zoom out, the compass and 2D/3D. The credits are in the corner box of the map on a computer (in the bar on a phone) and have no tooltip. The page uses the default as it is. `dashboard_e2e.py` checks the tools, the navigate box, Ctrl + drag and the corner box.
- The look of the page is live (`state: "live"`) and has the colour option "Road class" (`make_look.mjs`), as the look of a roadstyle dashboard page is. The roads style then has the controls of the dashboard. The Base map box has one switch **Map layers** for all the layers of the area (landcover, water, buildings and more: the **duckOSM layers** switch is back), the legend box lists them with their colours, and "Colour by and legend" is on. A page with a bar has no floating Layers box (it was at the bottom right, and the phone's sheet covered it). `e2e.py` checks all of it.
- The panel has its form after 81 ms and the map is shown after 1,458 ms (before: 189 ms and 1,551 ms; headless Chromium, no CPU throttle, median of 5 runs).
- The switch **Map layers** hides every layer of the area's own data (the copies `rs-low-*` of the low-zoom source too), and the floating Roads box is gone: with the switch off the map has only the base map, the roads and the page's own layers (the area line, the extracts, the preview, the pin, the drawing tool), and no floating box. `e2e.py` checks the list of the visible layers. `docs/app.md` has one open gap in roadstyle at the pin `9d745c9`: the handle of the editor's sheet on a phone is under the top bar again (`phone_e2e.py` prints it).
- The page has the look of roadstyle's dashboard (the template `dashboard`, the layout `overlay`; Kaveh asked for it on 2026-10-29). The map fills the window. The panel floats over it in roadstyle's frame look. roadstyle's toolbar holds the map buttons: theme, zoom, compass, 2D/3D, Street View, Google 3D, base map, 3D buildings, settings and attribution. The page adds the base-map box and the 3D buildings switch as tools of the bar. The seven cards have one neutral look in the light and the dark theme: the colors `--c` of the cards are gone. On a phone (700 px or less), the bar is at the top and the panel is roadstyle's sheet with three heights (closed, 40 %, full), in place of the page's own sheet. The selects are roadstyle's lists. `docs/app.md` ("roadstyle's dashboard look") has the details.
- The Google key is in roadstyle's settings (the gear button), as `rs-key:google` in the browser's storage. Card 6 has a button that opens the settings in place of the key field. The Google 3D tool is always on the bar. The key that an earlier version saved (`duckosm.googleKey`) moves to the new place at the first visit.
- The tests `e2e.py`, `editor_e2e.py` and `tile_format_e2e.py` use roadstyle's lists (a click, or the value in the page) and the new ids of the panel. `phone_e2e.py` checks roadstyle's sheet.
- The page uses roadstyle `91344c3` (branch `main`, D15 of the dashboard): the frame look of the panel, the typed `dashboard` options, the panel's left side, no scale box at the start, and the settings box. `build.sh` pins the full SHA.
- The page uses roadstyle `52b5728` (branch `main`, the Rust engine): smaller low-zoom tiles, the road width as one table lookup, the second tile format MLT, and one road layer for each band of zooms (`roads-simple`, `roads-simple-z14`, `roads-simple-z15`, and the `-dash` layers). The page no longer gives the option `pick` to `rsDashboard`: roadstyle picks all the road layers of the style (`RS_LEANS`), so the hover, the tooltip and the click work at every zoom. `editor_e2e.py` and `phone_e2e.py` query all the `rs-roads-simple*` layers. The page keeps its own dashboard look. `build.sh` has the full SHA.
- The page uses roadstyle `71af6fe` (branch `rust-engine`). The tiles hold no colour text: the colours of a piece are places in two tables of the style. The new dashboard module `generation.js` compares `roadstyle:generation` of the style with the `?g=` of the tile URL. If they differ, it shows a red message and hides the vector layers. The page keeps the `?g=` on the tile URL and does not hide the message. The page reads no colour text of a tile. `generation_e2e.py` checks the normal path and a stale generation.
- The map worker also reports `liveBytes()` (the bytes held now, and the most held). The step table of the page and `docs/app.md` give the live value. `memoryBytes()` is the size of the WebAssembly memory. The allocator grows it ahead in steps of a quarter (16 to 64 MiB), so it can rise when the held bytes fall (Burnaby driving, PR #26: 210 to 232 MiB size, 154 to 143 MiB held).
- The page uses roadstyle `2fc8477` (branch `rust-engine`): tile contract 2. A piece has the road's row as its feature id, so the source has no `promoteId`. The keys `__rs_edge`, `__rs_edge2` and `__rs_s` and the colour text are not in the tiles any more. The popup reads the road table by row. The tile handler `rs://` removes the query `?g=` before it reads the tile address. The new dashboard (`overlays.js`, `index.js`, `editor/level_editor.js`) is copied from `rust/roadstyle-assets/files/static/`. The 20 tiles of a Burnaby view (driving, pitch 60) are 1.54 MB, not 3.35 MB. The wasm function `makeSources` is now `styleSources`.
- The level editor draws on the page's own map (roadstyle `f0a161b`, host mode): the same colours and profile as the roads of the page. The map worker keeps a `LiveMap`, and a change of the editor redraws only the changed edges.
- `duckosm-build` and `duckosm-parquet` take the levels from the crate `roadstyle-levels` at roadstyle `f0a161b` (the crossing rule). The values of `edge_levels` change; the columns do not.
- The page uses roadstyle `fc59e6c` (branch `rust-engine`): the base map has the theme "liberty" and stops at the area's boundary. `node crates/duckosm-wasm/make_look.mjs` makes `map/look.json` again after each pin.

### Added

- The browser page: card 7 **Edit levels**, roadstyle's level editor on the map (docs/app.md, "Step 7: edit the
  levels"). **Apply** writes the edited drawing order into `visualization.edge_levels` and the downloads.

### Changed

- The page uses roadstyle `083224c` (branch `rust-engine`) for its map (the style, the tiles, the dashboard, the SQL files). The levels of
  `duckosm-core` stay at roadstyle `aba5884`.
- The page's map: **Show on map** and the draw after a build first show a veil with a spinner over the map, then set the blank
  base map and put the area in view when the roads are ready (docs/app.md, step 6).
- The level editor (roadstyle `083224c`): it starts from the build's levels with no solve, and the page makes the level
  area only when the area's edges changed. A head or a line end is saved and drawn at once, with no solve.

### Fixed

- The page: with the level editor open, a collapse of the side panel made the editor's panel white and inert. The
  editor's panel is now out of the page's panel.

## 0.3.0 (2026-10-23)

The tables of duckOSM that 0.2.0 did not make, the browser page and its map.

### Added

- The tables of group 1 (docs/tables.md): `ways`, `way_nodes`, `main.*` and `mm.*`, equal to duckOSM on Monaco.
- The raw cut (`--raw`, with `--boundary`): duckOSM's `raw.*` of an area, as osmium's smart cut.
- The base-map layers (`features.*`) in the browser page, from duckOSM's feature SQL.
- The drawing levels (`visualization.edge_levels`, option `--levels tags|solve|none`), from the tags or
  solved by roadstyle's Rust engine (roadstyle-rs, a git dependency).
- The lane profile (`driving.lane_profile`), equal to duckOSM on Monaco and Tartu.
- The bus routes (`bus.routes`, `bus.route_edges`), equal to duckOSM on Monaco and Tartu.
- The browser page: an area from a place name or a drawn boundary, the region file through the relay, the
  build, the data downloads, and a map of the roads as vector tiles that Rust makes.
- The page: a "Download .duckdb" button. The file is equal to the file that the zip's `make_duckdb.sql` makes
  (`tools/compare_duckdb.py`).

### Changed

- The GitHub Release has the CLI program for the 5 systems too (a `.tar.gz` or `.zip` archive for each).
- The cut to a boundary reads only the blocks of the PBF that each pass needs.
- The way lines of the layers step are made in Rust (two times faster).
- The page finds the time zone in a table of the Geofabrik regions, not in the world map of `tzf-rs`.

### Fixed

- A `.duckdb` build without costs (`calculate_costs=False`, CLI `--no-costs`) failed in the view `mm.edges`.
  Now, as in duckOSM, such a build has no `mm.*`.
- The map: in the 3D view, OpenFreeMap's 3D buildings show over every base map when the duckOSM 3D buildings
  do not show.

## 0.2.0 (2026-10-22)

### Added

- The edge graph (`edge_graph`, `turn_permission`) and the turn restrictions (`turn_restrictions`,
  `turn_path_restrictions`), equal to duckOSM on Monaco and Tartu (docs/edge_graph.md).

## 0.1.0 (2026-10-22)

The first release: the network step of duckOSM in Rust.

### Added

- The CLI program `duckosm-rust`: an `.osm.pbf` file in, the edges and nodes of duckOSM out, in DuckDB and
  GeoParquet. Every `edge_id` is the same as in duckOSM.
- The driving, walking and cycling modes, `merge_segments`, `edge_id_map`, `global_junctions`, the component
  filter, the sidewalk rule, the dangling-path connector, speeds and costs, `walk_type` and `cycle_type`.
- The OSM fixes file of duckOSM (`--fixes`).
- A duckOSM config file as the input (`--config`, Python `build_from_config`).
- The Python wheel `duckosm_rust` (abi3, Python 3.9 and newer) for Linux, macOS and Windows, with DuckDB 1.5.6
  in it.
- A WebAssembly build of the network step for the browser.
- GeoParquet in the column order of duckOSM, and `layers.json`.
- The Estonia test: equal to duckOSM, 19 s and 1.5 GB for three modes (duckOSM: 1,545 s and 10 GB).
