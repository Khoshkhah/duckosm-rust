# The tables that duckOSM makes and duckosm-rust does not make yet

Status: plan, 2026-10-22. Kaveh: "there are many tables is missed yet. we should first try to create them".

The list comes from duckOSM's Monaco database (`/home/kaveh/projects/duckOSM/monaco.duckdb`, a build with the
default options) and from duckOSM's reference `docs/reference/database.md`. duckosm-rust makes today, for each
mode: `edges`, `nodes`, `private_edges`, `edge_graph`, `edge_id_map`, `turn_permission`, and for driving
`turn_restrictions` and `turn_path_restrictions`.

## The missing tables

| Group | Table | What it holds (duckOSM) | Monaco rows | Work |
|---|---|---|---|---|
| 1 | `<mode>.ways` | The OSM ways that the mode kept, after the road filter and the fixes. | 1,196 / 3,188 / 2,986 | Small: the build has these ways. |
| 1 | `<mode>.way_nodes` | The nodes of `ways`, one row per node, in order. | 8,407 / 16,841 / 17,135 | Small. |
| 1 | `<mode>.virtual_nodes` | Always empty in duckOSM (the virtual nodes are in `nodes`). | 0 | Very small: an empty table with its columns. |
| 1 | `main.boundary` | The boundary file: one row per feature, its properties, and `geom`. | 1 | Small: the page and the CLI have the boundary. |
| 1 | `main.global_junctions` | The nodes where every mode cuts its ways. | 4,318 | Small: the build computes them. |
| 1 | `main.visualization_metadata` | One row: the boundary, the center, the zoom, the time zone, the build time and version. | 1 | Small, except the time zone (see below). |
| 1 | `mm.edges` (a view) and `mm.transfers` | Routing across modes: all edges with their mode, and the changes of mode at the nodes that walking shares with another mode. | view / 11,620 | Small to medium: SQL on the tables of the build. |
| 2 | `visualization.edge_levels`, `edge_levels_meta` | The drawing order of the roads (bridges over roads). | 13,298 / 1 | Medium: duckOSM solves an optimization (OR-tools). The tags rule of the map (`www/map/roads_sql.js`) is simpler and gives other numbers. |
| 2 | `driving.lane_profile` | Each lane of each driving edge and bus-only edge, left to right. | 3,176 | Medium: a port of duckOSM's lane rules (`docs/design/gmns_lane_profile.md`). |
| 2 | `bus.routes`, `bus.route_edges` | The bus routes (OSM relations) as the driving edges they travel, in order. | 56 / 5,609 | Medium: the relations, and a walk along the edges (as the turn restrictions through a way). |
| 3 | `raw.nodes`, `raw.ways`, `raw.relations` | The OSM data of the area as read from the PBF. | 34,326 / 5,715 / 336 | In the session "Base map features" (its approach A writes `raw.*`). |
| 3 | `features.*` (12 tables) | The base map: buildings, land, water, POIs, place labels, … | 1 to 3,496 each | In the session "Base map features" (`docs/features.md`). |

Not in this list: `visualization.level_edits`, `level_heads`, `level_caps` and `level_unmatched` (the manual
edits of the drawing levels in duckOSM's level editor), `main.boundary_cells` and the H3 columns (duckOSM option
H3), `main.elevation_metadata` (elevation), `main.admin_boundaries` (the boundaries for `duckosm boundary`).
They come from separate duckOSM tools or options.

## Open points

- **The time zone** (`visualization_metadata.timezone`): duckOSM finds it from the coordinates (Python
  `timezonefinder`) and fails without it. The browser has no such lookup. Choices: a small Rust crate with the
  time zone polygons (`tzf-rs`, a few MB more in the wasm module), or a JavaScript library in the page, or
  NULL in the browser.
- **The drawing levels**: the tags rule (fast, in the page today) or a port of duckOSM's solver (slow, and
  OR-tools has no WebAssembly build). The tags rule is the realistic choice; `edge_levels_meta.source` then says
  `tags`, so nobody takes it for a solved level area.
- **The check**: each new table is compared with duckOSM's table, row for row, on Monaco and Tartu, as the
  network tables are.

## The plan

1. Group 1, in Rust (`duckosm-core`, `duckosm-build`), so the CLI, the Python package and the page get the same
   tables. One test against duckOSM's Monaco golden for each table. The page adds them to SQL, the zip and
   `load.sql`.
2. Group 2: `lane_profile` and `bus`, then the levels table from the tags rule.
3. Group 3 stays in the session "Base map features". Its `raw.*` tables are also the input that group 2 can use
   for the bus relations.
