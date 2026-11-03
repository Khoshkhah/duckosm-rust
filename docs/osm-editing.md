# Editing OSM data in the page: design and plan

Status: design, 2026-11-03. Kaveh asked for a good design to edit OSM data in the page, and to add information that OSM does not give
in a usable form: building faces, roof type, colors and floors. Only the section "What exists today" is built.

## What the user gets

- Click a road, a building, or a node (a crossing or a traffic signal). The panel shows all its data and a form to change it.
- Change the tags of the object: sidewalk, cycleway, crossing, surface, speed, access, lanes, floors, roof shape, colors.
- Give each wall of a building a type (front, back, side, party wall) and see it on the map.
- See every change in a list. Select a change to see it on the map, in a different color, with its full data in the panel.
- Build the networks and the layers again. The tables have the changes. The user never sees YAML.

## What exists today

- A fixes file has three keys: `overrides`, `new_ways` and `turn_restrictions`. The Rust parser (`crates/duckosm-build/src/config.rs`) rejects
  all other keys. This is the format of duckOSM's `osm_overrides`.
- A tag rule (`overrides[].tags`) sets tags on a way. It acts on the network ways, and on the raw ways of the cut (`Raw::apply_fixes`,
  `crates/duckosm-core/src/raw.rs`). So a tag rule on a building way already reaches `raw.ways` and `features.buildings.tags`.
- `set_tags` sets a tag. It cannot delete one. This is the behavior of duckOSM (`map_concat`).
- Nodes and relations have no tag rules. A crossing or a signal (a node) and a building that is a multipolygon relation cannot change.
- `features.buildings` has the columns `osm_id`, `osm_type`, `kind`, `name`, `tags` and `geom`. Floors, roof and colors are in `tags`. No column holds them.
- The branch `claude/fixes-panel` has card 7 (version 1): a panel, the rules as data (`app/fixes.js`), a road form, a turn form and a YAML tab.
  It has no building form, and its road form starts empty.

## Design

### Principles

1. **The rules are the one source.** The page changes the rules as data. Rust applies them. The CLI, the wheel and the page give the same tables.
2. **An edit acts at the start of the build, on OSM tags.** A mapper edits OSM in the same way. The network, the sidewalks, the layers and the faces
   all derive from the edited tags, so there is no second code path.
3. **Output without edits stays equal to duckOSM, byte for byte.** A new key is read only when it is in the file. A new table is made only when the user asks for it.
4. **The page does not show YAML.** It shows items. The file is for download and upload only.

### The kinds of edit

| Kind | Rule | Acts on | State |
|---|---|---|---|
| Road attribute | `overrides[]`: `oneway`, `lanes`, `lanes_forward`, `lanes_backward`, `layer`, `exclude_modes`, `remove` | network, for each mode | built |
| Tag set on a way | `overrides[].tags` | network ways and raw ways (so buildings too) | built, no building form |
| Turn rule | `turn_restrictions[]` | edge graph, driving | built |
| New road | `new_ways[]` | network and raw | built, no form |
| Tag set and delete on a way, node or relation | `extra.tag_edits[]`: `type`, `id`, `set`, `delete` | ways as read (network) and `raw.*` (layers); nodes and relations: `raw.*` | built (M1, 2026-11-03) |
| Face type of a building wall | `building_faces[]` | `features.building_faces` | new (M4) |

The new keys go under one top-level key, `extra`. Then a file with only duckOSM keys stays a valid duckOSM file. I checked duckOSM (Python): it reads only `overrides`, so it ignores `extra`.

### One tag editor, with presets

One editor serves every object. This is the iD editor model: preset fields on top, the raw tag list below.

- **Preset fields.** A JSON file (`www/app/presets.json`) lists, for each kind of object, the fields: key, label, type (choice, text, whole number, color) and the values.
  A new field is a new line in the file. No code changes.
- **Raw tags.** Under the preset fields, a table shows every tag of the object. The user can change a value, add a tag, or delete a tag.
- **The form starts with the data.** When the user selects an object, each field shows the value that the data has now. Edited fields show a mark and a **Revert** button.
  A saved rule holds only the keys that differ from the data.
- **Where a key goes.** `oneway`, `lanes*` and `layer` go to the rule's own keys, which act for each mode as in duckOSM. All other keys go to `tags`.

| Kind | Preset fields |
|---|---|
| Road | name, class, `oneway`, `lanes`, `lanes:forward`, `lanes:backward`, `layer`, `maxspeed`, `surface`, `access`, `sidewalk` (both, left, right, no, separate), `cycleway` (lane, track, shared lane, no), `bridge`, `tunnel` |
| Crossing | `crossing` (marked, unmarked, uncontrolled, signals), `crossing:island`, `kerb`, `tactile_paving` |
| Building | `building` (kind), `building:levels` (floors), `height`, `roof:shape`, `roof:levels`, `roof:colour`, `building:colour` (facade), `building:material`, `roof:material`, `name` |
| Node | `highway` (traffic signals, crossing, stop), `traffic_signals:direction`, `name` |

### Changes are visible

- **The map.** An edited object has an amber outline (roads and buildings) or an amber ring (nodes). The selected object is blue. A legend in the panel shows both.
  A click selects an object with no popup. The hover tooltip stays.
- **A filter picks what a click selects.** Roads, buildings and nodes overlap. Three toggle buttons (Roads, Buildings, Nodes) set which kind a click selects.
- **Old and new values.** When a rule is applied, the build writes `main.fixes_applied` (rule number, kind, `osm_type`, `osm_id`, key, old value, new value). A build with no rules writes
  no table. The panel shows "lanes 2 → 3" from this table.
- **Undo and redo.** The rules are data, so the page keeps a history. **Undo** and **Redo** act on the rule list.

### Building info

A new table, `features.building_info`, is made on request (option `building_info`; on in the page, off in the CLI). One row for each building:

| Column | Source |
|---|---|
| `osm_id`, `osm_type` | `features.buildings` |
| `kind`, `name` | `building`, `name` |
| `levels` | `building:levels` (a whole number) |
| `height_m` | `height` (meters; a unit is read and converted) |
| `roof_shape` | `roof:shape` |
| `roof_levels` | `roof:levels` |
| `roof_color`, `facade_color` | `roof:colour`, `building:colour`, as `#rrggbb` (CSS names and hex are read) |
| `material` | `building:material` |

A value that does not parse is NULL. The raw text stays in `tags`. A rule that sets `building:levels` changes `levels` after the next build.

### Building faces

A face is one wall of a building: one segment of the outer ring. `crates/duckosm-core/src/building_faces.rs` makes them from the raw cut and the street edges. Built in M4 (2026-11-03).

- **The key.** A face is `(building id, from node, to node)`. This key does not change when the ring has more nodes elsewhere. A position number does, so `face_index` is only a place in the ring. The two nodes of a rule can be in either order.
- **The types.** `front` (faces a street that the wall can see), `back` (opposite the front wall and faces no street), `party` (two buildings have the same two nodes) and `side` (all other walls). A corner building has two or more `front` walls.
  A building with no street near it has no front and no back. The type `court` (a wall of an inner ring) waits for buildings that are multipolygon relations (M5).
- **The method.** One local scale for the whole area (the middle of the buildings). Each ring is made counter-clockwise, so the outward normal of a wall is `(dy, -dx)`.
  For each wall, the streets within 60 m that the wall points at (the cosine of the angle is more than 0) are candidates, with the score `align / sqrt(distance + 1) * (1 + ln(length + 1))`. The best candidate that the wall can **see** is its street:
  the line from the wall to the street must cross no wall of any building. The front wall is the wall with the best score among those with a cosine of at least 0.5. Another wall is a front wall too when its cosine is at least 0.65 and its street is within 30 m.
  A back wall is a wall whose normal has a cosine of at most -0.4 with the front wall's normal, and whose street cosine is at most 0.1. These numbers are named constants in the file.
  The streets are the edges of the driving and walking modes, except footways, paths, steps, corridors, bridleways, cycleways and tracks.
- **The same rows each time.** The order is the order of the ways and of the ring. A tie between two streets goes to the lower `edge_id`.
- **The table.** `main.building_faces` ([tables.md](tables.md)). It is made on request (`Params.building_faces`; the CLI option `--building-faces`; the page always makes it with the layers). A wall that is shorter than 0.1 m has no row.
- **Rules.** `extra.building_faces: [{building, from_node, to_node, type, note}]` gives a wall another type. The table has the new type in `face_type`, the computed type in `computed_type`, and `edited` true. A rule that gives the computed type is not an edit.
- **The map.** The walls of the selected building show in the panel with one color for each type (front green, back red, side grey, party wall purple), and a wall with a rule has an amber glow. A check box shows the walls of all buildings in view (zoom 16 or more).
- **What the first version did wrong.** The earlier branch (`osm-fixes-editor`) used one origin from the first node, gave a front wall to a building with no street near it (the best of zero scores), wrote the distance 0 for a wall with no street, and numbered the walls after it skipped the short ones.
  It did not look at the line of sight: on Monaco, 5,743 of 9,907 walls were `front`. With the line of sight: 4,869 `front`, 970 `back`, 1,055 `party`, 3,013 `side`.
- **Limits.** The method is a rule of thumb. A curved building has many short front walls. A building behind a courtyard can have no front. A wall color for one wall waits for M5.

### The panel

Three tabs. The panel is the page's one panel, as the level editor is.

1. **Edit.** The selected object. Top: the name, the kind, and the ids. Then **Data**: all tags, and the derived data (the edge for each mode, the length, the junction nodes, the faces of a building).
   Then the preset fields. Then the raw tags. **Save** and **Delete rule** are at the bottom of the tab.
2. **Turns.** The selected road, the junction at each end, and a rule for each road that leaves it. The list of all turn rules is below. The turn rules show on the map as an amber ring at the junction.
3. **Changes.** All rules, in groups (Roads, Buildings, Nodes, Turns, Faces). Each item has a one-line summary ("Way 123, Main Street: lanes 2 → 3, sidewalk both") and a **Delete** button.
   A click on an item selects the object, zooms to it, and opens its data in the **Edit** tab. At the bottom: **Undo**, **Redo**, **Download**, **Clear all**.

**Apply and build again** is fixed at the bottom of the panel. It shows the number of changes that wait. The edits act when the build runs. The page keeps the area, so the build takes seconds on Monaco.

### Limits

- The edits act at the build, not live. A live preview is possible later, as the level editor does for levels, but it needs the network step on a few ways.
- The page does not send edits to OSM. An export as an osmChange file (`.osc`) is possible later.
- The cut `.osm.pbf` download stays the original cut, before the edits.
- A rule on a relation changes tags only. It does not change the geometry of the relation.

## Plan

Each milestone is one pull request. Each one has tests on Monaco, a phone-viewport check, an update of `docs/app.md` and `CHANGELOG.md`, and a green golden test (no change in the output without rules).

| # | Work | Main files | Proof |
|---|---|---|---|
| M0 | Split `claude/fixes-panel`: the download speed and the cursor change go first, as a small pull request. The panel version 1 stays in the branch. | `app/regions.js`, `index.html` | Tests of the page; South Coast first bytes in 3 s. |
| M1 | Rust core: `extra.tag_edits` (set and delete tags of a way, a node or a relation); the parser. Then the wasm rebuild. The table `main.fixes_applied` moved to M5. | `config.rs`, `fixes.rs`, `raw.rs`, `duckosm-build` | Unit tests. Goldens unchanged. A Monaco file with a sidewalk tag changes the walking network. |
| M2 (built, 2026-11-03) | Panel version 2: selection with a kind filter, full data, preset tag editor, **Changes** tab with map colors, undo and redo, no YAML text, the turn flow fixed. Presets for roads and crossings. | `index.html`, `app/fixes.js`, `app/presets.json` | `fixes_e2e.py` extended: select a road, the form has its data; `sidewalk` and `cycleway` change the tables; a change shows amber. |
| M3 (built, 2026-11-03) | Building info: preset fields for buildings and `features.building_info`. Check that the 3D buildings tool shows height and levels. | `features` SQL step, `presets.json` | A rule that sets `building:levels` changes `levels` in the table. |
| M4 (built, 2026-11-03) | Building faces: `building_faces.rs` (port, fix, tests), the table, the map layer, face edits in the panel. | `duckosm-core`, `duckosm-parquet`, `index.html` | A Monaco test of the faces (counts for each type, the fault of the old branch). The same rows on two builds. |
| M5 | Later: draw a new road, a color for one wall, an `.osc` export. | | |

Order: M0, M1, M2, M3, M4. M2 can start while M1 is in review, because the page can use the tag rules that exist today.

## Open points for Kaveh

1. **"Floor".** I read it as the roof type and the number of floors. The plan has both (`roof:shape`, `building:levels`).
2. **The new keys under `extra`.** This keeps the file valid for duckOSM. The alternative is new top-level keys. I choose `extra` unless Kaveh says no.
3. **Edits act at the build.** A build takes seconds on Monaco. It takes longer on a large area. A live preview costs more work. I choose the build for now.
4. **Face types.** `front`, `back`, `side`, `party`, `court`. A color for one wall waits for M5.

## Risks

- The audit table `main.fixes_applied` (old and new values) is not in M1. M2 shows the new values from the rules. The old values need the table, so it moves to M5 unless M2 needs it.
- A tag rule can make a bad file (a wrong value for `lanes`). The page checks the types before it saves a rule. The Rust parser is the last check, and its error shows in the panel.
- Face classes depend on thresholds (distance, angle). M4 makes them named constants with a test for each, and shows them in the docs.
- The 3D buildings tool of roadstyle ignores `height`, `levels` and colors: it draws the OpenFreeMap base map, not `features.buildings`. M3 found this. The fixes panel therefore draws its own 3D preview of the edited buildings. A 3D layer for all buildings from `main.building_info` needs a change in roadstyle or tiles for the page, and it is not planned yet.
