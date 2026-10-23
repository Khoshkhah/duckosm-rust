# The boundary tool: design and plan

Status: agreed by Kaveh and implemented on 2026-10-22. The decisions on the open questions are in
[Decisions](#decisions).

The boundary tool (`crates/duckosm-wasm/www/boundary.html`) makes the area that duckOSM builds: a boundary
(GeoJSON) and a name. Kaveh (2026-10-22): "the boundary tools is not nice and user friendly! it should have map
and show area on the map. also have drawing tools for creating area too."

The tool today is a form: a name search, a file, a box of four numbers, and a text summary. It has no map, so
the user cannot see the area before the build.

## What stays the same

- The tool is a separate page. `index.html` does not change.
- The output format is the format of `duckosm boundary`: a FeatureCollection with one Feature. The properties
  are `name`, `osm_id`, `admin_level`, `area_km2`, `source` and `geofabrik` (the 3 smallest extracts that cover
  the area, each `{id, name, pbf}`). The file works in Python duckOSM, in `duckosm-rust --boundary` and in
  `index.html`.
- `area_km2` is the spherical ring area (radius 6378137 m), rounded to 2 decimals: 2.39 for Monaco
  (`tests/data/monaco.geojson`), as in duckOSM.
- The hand-off: **Use in duckOSM in the browser** writes the GeoJSON text to `localStorage["duckosm.boundary"]`
  and opens `index.html`, which reads it.
- `www/geofabrik.json` gives the extracts (Geofabrik sends no CORS header).

## The layout

On a computer, the map fills the window. A panel of 370 px is on the left side, over the map, from the top to
the bottom of the window. Kaveh asked for a more professional design after the first version (2026-10-22), so
the panel has three numbered steps:

```
+--------------------------+------------------------------------------+
| [#] Boundary tool  [☾][<]|                                   [+][-] |
|                          |                                          |
| 1 CHOOSE AN AREA         |               the map                    |
| [Search | Draw | File ]  |     (the area: a blue fill and line)     |
|  (the controls of the    |                                          |
|   selected tab)          |                                          |
|                          |                                          |
| 2 THE AREA               |                                          |
| [Tartu linn           ]  |                                          |
| [38.91 km²][1 pol.][271] |                                          |
| (warning, if large)      |                                          |
|                          |                                          |
| 3 REGION FILE            |                                          |
| (o) Estonia      [down]  |                                          |
|--------------------------|                                          |
| [GeoJSON] [Use in duckOSM]|  scale    MapLibre | OpenFreeMap | OSM  |
+--------------------------+------------------------------------------+
```

- Step 1 has three tabs: **Search** (the name search and **What is here?**), **Draw** (the drawing tools) and
  **File**. Steps 2 and 3 show the area and the region files. The two output buttons stay at the bottom of the
  panel.
- The area shows as three tiles: km², polygons and vertices. Below them are the source and, for a large area,
  a yellow warning.
- The page has no legend. A legend was first on the map and then in the panel, and Kaveh found it unnecessary
  (2026-10-22): the panel tells the user what each line is when it shows.
- The header has two buttons:
  - The theme button changes between the light and the dark theme. At the start, the page uses the theme of
    the system.
  - The collapse button moves the panel out of the view, and the map then fills the window. A button
    "Boundary tool" at the top left opens the panel again.

  The browser keeps the two choices (`localStorage`, the keys `duckosm.theme` and `duckosm.panel`).
- Short messages (for example "Click a point on the map.") show at the top of the map and go away.
- The buttons have icons (inline SVG, no icon library) and text.
- On a narrow screen (700 px wide or less, a phone), the map is at the top (52 % of the height) and the panel
  is below it. The page scrolls, and the output buttons stay at the bottom of the screen. The buttons and the
  tabs are 44 px high, for a finger. The scale is not shown. The collapse button keeps only the header of the
  panel, and the map becomes higher.
- The map style stays light in the two themes (the style of OpenFreeMap has no dark variant).

## The map

- MapLibre GL JS 5.24.0 (the version of roadstyle), from cdn.jsdelivr.net.
- The base map: OpenFreeMap, style `https://tiles.openfreemap.org/styles/liberty`. It is free, it needs no key,
  and it sends a CORS header, so it works with the COOP and COEP headers of `www/serve.py`.
- The area shows as a blue fill and a blue line. When the area comes from a search or a file, the map zooms to
  it.
- A drawn area shows only as the shapes of terra-draw. The tool does not draw a copy of them: a copy stays at
  the old position while the user moves a shape (found by Kaveh, 2026-10-22).
- A preview (a dashed purple line) shows an area that the user points to in the list of matches. A click on a
  point match zooms the map to it.
- The outline of a suggested Geofabrik extract shows as a dashed orange line when the user selects it, and the
  map zooms out to show all of it.
- When the user points to a match that is not fully in the view, the map moves to show it.

## The ways to make an area

The area is one list of polygons. Each way below replaces the area, except drawing, which adds shapes to it.

### 1. Search: a name search

1. The user types a name and pushes Enter or clicks **Search**. The tool does not search while the user types.
2. The tool asks Nominatim (`/search`, `format=geojson`, `polygon_geojson=1`, `extratags=1`, `limit=8`).
3. The matches show as a list of cards. Each card has the name, the type (for example `city`), and the rest of
   the address.
4. When the user points to a match, or moves to it with the arrow keys, the map shows it as a preview. A match
   without a polygon (a point) shows as a marker, and its line says "a point: no boundary". The user cannot
   select it.
5. When the user selects a match, it becomes the area. The name, `osm_id` (a relation only) and `admin_level`
   come from Nominatim.

### 2. Draw

The drawing tools come from terra-draw 1.38.0 with its MapLibre adapter 1.5.0 (MIT, from cdn.jsdelivr.net).

| Button | Key | What it does |
|---|---|---|
| Select | S | Click a shape to select it. Drag the shape to move it. Drag a corner of a rectangle to resize it (the opposite corner stays). Drag the point of a circle to change the radius. Drag a vertex of a polygon or a freehand shape, or drag the midpoint of a side to add a vertex. Drag the empty map to move the map. |
| Rectangle | R | Drag on the map, or click two corners. |
| Polygon | P | Click each vertex. Click the first vertex, or push Enter, to close the polygon. |
| Circle | C | Drag from the center, or click the center and then a point on the circle. The circle is a polygon of 64 vertices. |
| Freehand | F | Drag the outline. |
| Merge | | Join the shapes that overlap into one shape on the map. The new shape is a polygon, selected, and the user can edit it. Shapes that do not touch stay separate. The button is on only when shapes overlap. |
| Delete | Delete | Delete the selected shape. |
| Clear | | Delete all shapes. |

- When a shape is complete, the tool changes to **Select** and selects the new shape. The user can then move
  it or change it at once, and drag the map. Kaveh found that the first version did not let him move a shape:
  it could do that only after a click on **Edit**, and while a drawing tool was on, a drag on the map drew a
  new shape.
- The panel shows a hint for the selected tool.
- Each shape is one polygon of the area. One shape gives a Polygon, more shapes that do not touch give a
  MultiPolygon.
- Escape stops the drawing of a shape.
- A shape that crosses itself is not accepted (terra-draw's validation).
- When the area comes from a search or a file, a drawn shape replaces it (decision 1).
- Shapes that overlap are merged into one polygon in the output (decision 2), also without a click on
  **Merge**. On the map they stay separate shapes until the user clicks **Merge** (Kaveh, 2026-10-22).

### 3. File

- The user selects a GeoJSON file, or drags it onto the map or the panel.
- The tool accepts a FeatureCollection, a Feature, a Polygon or a MultiPolygon, as the Rust reader
  (`crates/duckosm-core/src/boundary.rs`). Of a FeatureCollection, the tool uses all Polygon and MultiPolygon
  features (today: only the first feature).
- The name, `osm_id`, `admin_level` and `source` come from the properties of the file, if it has them. Else the
  name is the file name.

### 4. What is here (Nominatim reverse)

- The user clicks **What is here?** and then a point on the map.
- The tool asks Nominatim `/reverse` for 5 levels: `zoom` 3 (country), 5 (state), 8 (county), 10 (city) and
  14 (suburb), one request each second, with `polygon_geojson=1`.
- The answers show in the same list as the matches of a search, and they work the same way.

### The box of four numbers

The box goes away. The rectangle tool does the same work, and the user sees the box.

## The panel: the area

| Item | Detail |
|---|---|
| Name | A text box. The user can change it. Its value goes into `name`. |
| The area | In km², with 2 decimals. |
| Polygons and vertices | For example "2 polygons, 140 vertices". |
| A warning for a large area | Above 10,000 km² (decision 3). The text: "A large area. The cut can take minutes, and the build can need more than 1 GB of memory." |
| The source | For example "Nominatim relation 2179440", "drawn" or "file tartu.geojson". |
| The region files | The 3 smallest Geofabrik extracts that cover the area, each with its size in km² and its download link. A radio button shows the outline of the extract on the map. |

If no extract covers the area, the panel says so, as today.

The page also shows the last boundary from `localStorage["duckosm.boundary"]` when it opens, so the user sees
the area again after a return from `index.html`.

## The output

- **Download boundary.geojson**: the file in the format of `duckosm boundary`.
- **Use in duckOSM in the browser**: the hand-off to `index.html`.
- `source` for a drawn area is `drawn`. `osm_id` and `admin_level` are `null` for a drawn area.
- The two buttons are disabled when there is no area.

## The rules

### Nominatim

The tool obeys the usage policy of the public Nominatim server
(<https://operations.osmfoundation.org/policies/nominatim/>):

- At most 1 request each second. All requests go through one queue that waits 1 s between requests.
- No search while the user types. A search starts only from Enter or **Search**.
- The browser sends the address of the page in the `Referer` header, which identifies the application. The
  tool does not send an email address or other personal data.
- The panel shows "Search: Nominatim, data © OpenStreetMap contributors".
- The tool keeps the results of the last 20 searches, so the same search does not go to the server again.

### The map tiles

- The map shows the attribution of the style: OpenFreeMap, © OpenMapTiles, data from OpenStreetMap. The
  attribution stays open, also on a phone, where it uses two lines.

### Accessibility

- The search and the file work with the keyboard only. The drawing tools need a mouse, a pen or a finger.
  The panel says so, and gives the other two ways.
- Each button has a text label. The tool buttons have `aria-pressed`, so a screen reader knows which tool is
  on.
- The list of matches is a group of radio buttons, so the arrow keys move in it.
- The messages (searching, errors, the area) are in a region with `aria-live="polite"`.
- The map has `role="region"` and an `aria-label`.
- The focus is visible on each control. The text has a contrast of at least 4.5:1 in the two themes.
- The colors of the area (blue) and of the extract (orange, dashed) are different in color and in line style.

## Decisions

Kaveh's answers to the open questions of the draft (2026-10-22):

1. **A drawn shape when the area comes from a search or a file: the shape replaces the area.** The tool does
   not move a search polygon into the drawing tool. A search polygon can have more than 10,000 vertices, and
   the edit is then slow.
2. **Shapes that overlap: the tool merges them** with polyclip-ts 0.16.8 (MIT, from cdn.jsdelivr.net, 17 KB
   with gzip, loaded at the first drawn shape). The output has no overlap, and `area_km2` is correct. Without the merge, Python duckOSM (osmium) can treat an
   overlap as a hole, if it uses one even-odd rule over all rings. The Rust reader accepts an overlap (a point
   in any polygon is inside). The polygons of a file are not merged: they stay as they are in the file.
3. **The warning for a large area: above 10,000 km².**
4. **What is here (Nominatim reverse): in this version.**

## The plan

1. Agree this document with Kaveh. Done on 2026-10-22.
2. Write the new `boundary.html` in one file, as now. The geometry functions (the area, the even-odd rule, the
   covering extracts) stay as they are.
3. Add `www/boundary_e2e.py` (Playwright, headless Chromium, in the style of `www/e2e.py`). It does these
   checks:
   - A search for "Monaco", when Nominatim answers: the list has matches, and a selected match gives an area.
   - A rectangle drawn with mouse drags: the area is a Polygon of 5 points, and `source` is `drawn`.
   - The file `tests/data/monaco.geojson`: `area_km2` is 2.39, and the first extract in `geofabrik` is `monaco`.
   - The downloaded file has the format of `duckosm boundary`.
   - The hand-off: **Use in duckOSM in the browser** opens `index.html`, and its area text shows the name.
4. Update `docs/browser.md` (step B4) and `docs/development.md` (the WebAssembly section).
5. One commit on the branch. No push and no merge without Kaveh's OK.

## Result (2026-10-22)

Done. `python crates/duckosm-wasm/www/boundary_e2e.py` passed with the network:

| Check | Result |
|---|---|
| The file `tests/data/monaco.geojson` | 2.39 km². The extracts: `monaco`, `provence-alpes-cote-d-azur`, `alps`. |
| Two rectangles that overlap, drawn with mouse drags | One Polygon of 8 vertices, `source` is `drawn`. |
| A drag of the second rectangle (selected after the draw) away from the first | A MultiPolygon of 2 polygons. |
| A third rectangle over the two, then **Merge** | One Polygon of 12 vertices. **Delete** then removes all of it: it is one shape on the map. |
| A search for "Monaco" | Nominatim relation 1124039, 79.82 km² (the boundary of the country includes the sea). |
| The hand-off | `index.html` shows "Monaco, 2.39 km², from the boundary tool." |

Each downloaded file has the format of `duckosm boundary`: a FeatureCollection with one Feature, the 6
properties, and `{id, name, pbf}` for each extract. A manual check at a width of 390 px (a phone) showed no
horizontal scroll. What is here, at the center of Monaco, gave Monte-Carlo, Monaco (a suburb) and Monaco (the
country).

The test does not check the polygon, circle and freehand tools, the resize of a shape, the drag of a file,
and the keyboard use. I did not examine these in a real browser.

Not in this plan: a simplification of large polygons, undo and redo of the drawing, a dark map style, and a
search of the Geofabrik extracts by name.
