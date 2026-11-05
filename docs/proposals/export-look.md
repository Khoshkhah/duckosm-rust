# Proposal: the look of the page's map in the QGIS and kepler.gl exports

Status: approved by Kaveh on 2026-11-05 and built (branch `claude/export-look`). The answers to the questions below are the proposed defaults: Kaveh approved the design and gave no other answer.

## The problem

Two faults make the exports of step 10 not useful (Kaveh, 2026-11-05):

1. **The two directions lie on top of each other.** Since PR #62, the GeoJSON file and the GeoPackage have one feature for each direction of a two-way road. Both features use the center line. In QGIS and in kepler.gl, the feature that is drawn last hides the other one. If you color the roads by direction or by a value for each direction, you see only one color for each road.
2. **The styles are hand-made copies.** `app/export_style.js` writes a QGIS style and a kepler.gl configuration from the palette only. They do not have the width curve of each class, the offsets of the two directions, the drawing positions (bridges over roads, tunnels under roads), the first zoom of each class or the tunnel look. In QGIS, each road has one fixed width at all zooms. Kaveh: "QGIS style (.qml) doesnt support zooming and after zoom shows roads as just one line without width".
3. **kepler.gl shows one line for each two-way road**, with the option "One feature for a two-way road" on or off. Kaveh: "without checkbox the visualization is not fixed in kepler". kepler.gl cannot offset a line, so the file itself must have each direction on its side.
4. **A layout fault on the card.** On the rows "GeoJSON roads" and "GeoPackage", the checkbox "One feature for a two-way road" has a wide empty frame. The cause is `#export-list .imgw input { width: 80px; }` (`index.html`): the rule is for the number box "Width" of the pictures, but it also applies to each checkbox. The fix: `#export-list .imgw input[type=number]`.

## The decision

Take the look from one source: **roadstyle's `exportLook`**. This function is in the roadstyle module that the page has already (`map/pkg`). roadstyle made it for this purpose: "MapLibre layers with no source that read the raw duckOSM columns" for another program (the GeoLibre plugin uses it too). It gives, for each drawing position, one casing layer and one fill layer with these values for each feature:

- the fill color and the casing color of the class (with the bridge casing and the tunnel color),
- the width of each class group at each zoom (the curve of the look, the casing ratio of each group),
- the offset of each direction of a two-way road, and its narrower width, from zoom 15 to zoom 17 (`roads.split`: offset 0.28, width 0.6 of the road),
- the first zoom of each class, and the sort key (the class order) inside a drawing position.

The export reads the look that the map has now: the page's look with the changes of the Design panel (`lookText ?? pageLookText()`, as the map worker). If you change the design, the export changes with it.

The export translates these MapLibre expressions into the language of each program. It does not keep a second copy of colors or widths.

The center line of the tables does not change. The GeoPackage keeps the true geometry. Only the files that are only for drawing (kepler.gl, GeoJSON for viewing) have moved lines. No table row changes, so the `edge_id` contract is safe.

## Each format

### GeoPackage with its QGIS style (and the `.qml` file)

The layer `roads` stays as it is today: one feature for each direction, on the center line, with all columns. It gets one more column, `casing_level`, next to `fill_level` (both from `visualization.edge_levels`).

The style in `layer_styles` (and in the `.qml` file) is a rule-based style:

| Part of the look | How QGIS shows it |
|---|---|
| Drawing positions | Two rules for each position in the data: casing at the position, fill at the position. The symbol levels draw them in the order of roadstyle (all casings and fills of position −1 under those of position 0, and so on). |
| Order of classes in one position | "Control feature rendering order" with roadstyle's sort key. |
| Colors | A data-defined color on each line: the expression of `exportLook`, translated. |
| Width at each zoom | A data-defined width in millimeters: the page's pixels × 25.4 / 96, from the width curve of the class group (`roads.model.width`) at the zoom of the QGIS map. The zoom comes from the map scale, as the page's zoom: `round(log2(295829355.45 × k / scale), 3)` (k = 1 in Web Mercator; k = cos(latitude) in a CRS with a ground scale, for example EPSG:4326). The round makes the scale of zoom 13 give 13, not 12.99999, so a class with first zoom 13 shows. When you zoom in or out, the roads get wider or narrower as on the page, with the casing and the fill as two lines. |
| Two directions apart | A data-defined offset: each direction moves to its right side, as on the page. Each direction is half of the road. QGIS can select each half and color it by its own data. |
| First zoom of each class | A part of the rule filter, as in the page. |
| Tunnels | A data-defined dash on the casing. |
| Casing ends | Flat. A round end of a higher casing covers the fill of the next, lower edge (roadstyle's pieces also use a flat end where a road goes on). |

The translator knows the operators that `exportLook` uses: `interpolate` (linear, zoom), `match`, `case`, `get`, `coalesce`, `in`, `all`, `any`, `!`, `==`, `>=`, `*`, `+`, `downcase`, `to-string`, `literal`. An unknown operator stops the export with its name. A `match` on a column becomes `array_get(array(...), @k_highway)`: the index of the class is calculated one time for each expression. This keeps the style small: about 33 KB for each drawing position, 590 KB for Monaco (9 positions).

QGIS cannot show these parts of the page's look:

- the junction heads of the level step (`casing_start`, `casing_end`, `head_start_m`, `head_end_m`): a casing has one position on all its length;
- the bridge decks and their shadows, and the 3D view;
- the live colors of data (flow, speed) that the page puts on the map. You can color the layer by your own column instead.

The one-way arrows and the street names stay separate layers (`arrows`, `names`), as today.

### kepler.gl map file

kepler.gl cannot offset a line, and its widths are not a curve of the zoom. From zoom 14, it draws a width in meters (`lineWidthScale` = thickness × 8). The file uses this:

- Each direction of a two-way road is **moved to its side** by the page's offset at the reference zoom. The reference zoom is 17, the zoom where the look has the full split of the two directions (`offset_zoom` + `ramp_zooms`).
- Each feature has the columns `fill_color`, `fill_width_m`, `casing_color`, `casing_width_m` and `offset_m`: the page's values at zoom 17, as meters on the ground.
- One dataset for each drawing position. Each dataset has a casing layer under a fill layer. The layers color and size by the columns with identity scales (thickness 0.125, so 1 unit is 1 meter).

At zoom 17, kepler.gl shows the page's widths. At other zooms, the roads keep their width in meters: a little wider than the page at zoom 18, narrower at zoom 15. Below zoom 14, kepler.gl keeps the width in pixels of zoom 14.

kepler.gl cannot show the first zoom of each class, dashes, or round ends. The tooltip shows `name`, `highway`, `direction` and `edge_id`.

### GeoJSON roads

The same moved lines and columns as the kepler.gl file, and also `stroke` (the fill color, the simplestyle name that geojson.io and GitHub read) and `level`. A plain drop of this file on kepler.gl uses kepler's default style. Use the kepler.gl map file for the look.

The option "One feature for a two-way road" stays. It gives the center lines, with no move.

### The notes on the card

Each note says what the format is for, not where it fails. Branch `claude/boundary-card2` removes "kepler.gl cannot open it" from the note of the GeoPackage. This work starts from `main` after that branch is merged, so that the two changes do not clash.

### Not changed

SVG, PNG, the tiles, the web map, MATSim and SUMO stay as they are. The base-map layers of the GeoPackage (buildings, water, land use) keep their styles. Their colors can come from the live style later, with the same translator.

## Changes in roadstyle first

The prototype found three differences between `exportLook` and the page's map. They are roadstyle faults. Repair them in roadstyle, then move `ROADSTYLE_COMMIT`:

1. **Colors.** `exportLook` reads `palettes[active.palette]` ("amber" in the page's look). The map reads the class styles (`roads.styles.classes`), where the page's palette ("ms_all_google_liberty") and the Design panel's colors are. `exportLook` must read the same table as the map.
2. **Opacity.** `exportLook` gives fill opacity 0.9 and casing opacity 0.75. The page's road layer draws them at 1. In QGIS, an opacity on each feature makes dark dots where two edges meet.
3. **Ends.** `exportLook` must give a flat casing end, as the page's pieces have where a road goes on.

The dashes of `steps` (the page draws them dashed) are a small fourth difference.

## Tests (Monaco only)

1. `export_e2e.py`: the files have one feature for each edge, the columns, the moved lines (each forward and reverse pair lies on two sides), and a style for each drawing position.
2. A QGIS check without a screen (`www/qgis_e2e.py`, a conda environment with `qgis` from conda-forge): it draws the GeoPackage with its own style at zoom 13, 15, 17 and 18 and compares each picture with the page's map at the same view (roads only). The check fails when the pixels of the roads differ by more than a limit.
3. A kepler.gl check in headless Chromium (kepler.gl 3.2.6 from a CDN): the same four views.
4. `phone_e2e.py` on the Export card: each checkbox is a normal checkbox at phone width.

CI does not have QGIS (the conda environment is about 2 GB). The QGIS check runs before each merge on the build machine, as `phone_e2e.py`.

## Questions for Kaveh

1. GeoJSON: moved lines by default (they show the two directions apart), and the center lines with the option. Is this correct?
2. kepler.gl: reference zoom 17 for the meters. Is this correct?
3. Which QGIS version do you use? The prototype used QGIS 4.2.3. The build will also test QGIS 3.40 LTR.
4. Do the roadstyle changes first (a roadstyle pull request), then this work. Is this correct?
