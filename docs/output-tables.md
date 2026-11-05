# The output tables

A build writes one table for each part of the road network. This page lists the tables and their columns. The numbers come from a build of the Monaco sample (`tests/data/monaco_sample.osm.pbf`, three networks).

- To learn what each table is for, read [The tables](manual/tables.md).
- To make the tables, read [Your first map](first_map.md).
- To see how the tables are made and tested against duckOSM, read [design.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/design.md).
- To see the tables that are not made yet, read [tables.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/tables.md).
- duckOSM has the same reference for its own tables: [database.md](https://github.com/Khoshkhah/duckOSM/blob/main/docs/reference/database.md).

## Where the tables are

The page and duckOSM write the same tables in two forms:

| Form | Name | Notes |
|---|---|---|
| GeoParquet | `<table>_<network>.parquet`, for example `edges_driving.parquet` | One file for each table and network. The tables that do not depend on a network end in `_main`, `_mm` or `_visualization`. |
| DuckDB | `<name>.duckdb` | One schema for each network (`driving`, `walking`, `cycling`), and the schemas `main`, `mm` and `visualization`. The table names have no network suffix: `driving.edges`. |

duckOSM writes the DuckDB form. The page gives both forms as downloads (step 5 of the [manual](manual/result.md)).

## Keys that join the tables

- `edge_id` (BIGINT) is a hash of `osm_id`, `source` and `target`. It is the same value that duckOSM 0.6.0 writes. Other projects join on it. Keep it a BIGINT in every join: a program that reads it as a floating-point number loses digits.
- `source` and `target` (BIGINT) are the `node_id` values of the ends of an edge.
- `osm_id` (BIGINT) is the OpenStreetMap way that the edge comes from. A way that has more than one edge gives more than one row with the same `osm_id`.
- Geometry columns are `GEOMETRY('OGC:CRS84')` (longitude and latitude).

## Tables of each network

The network is `driving`, `walking` or `cycling`. All rows below are from the driving network of the Monaco sample.

### `edges`

One row for each directed piece of road between two junctions. 3,022 rows.

| Column | Type | Meaning |
|---|---|---|
| `edge_id` | BIGINT | The key of the edge (see above). |
| `edge_ref` | VARCHAR | A text name of the edge: the way ID, a segment number and a direction letter (`167625756#1f`). |
| `source`, `target` | BIGINT | The node at the start and the node at the end. |
| `osm_id` | BIGINT | The OSM way. |
| `highway` | VARCHAR | The road class of OSM (`primary`, `residential`, `footway`, and so on). |
| `name` | VARCHAR | The street name. NULL when OSM has none. |
| `oneway` | BOOLEAN | True when the edge is one-way. |
| `lanes` | INTEGER | The number of lanes. |
| `surface`, `access`, `junction`, `layer`, `bridge`, `tunnel`, `service` | VARCHAR | The OSM tags of the same name. |
| `refs` | BIGINT[] | The OSM nodes along the edge, in order. |
| `geometry` | GEOMETRY | The edge as a LineString. |
| `is_reverse` | BOOLEAN | True when the edge runs against the direction of the OSM way. |
| `length_m` | FLOAT | The length in meters. |
| `maxspeed_kmh` | FLOAT | The speed limit, or a default for the class. |
| `cost_s` | FLOAT | The travel time in seconds. |

### `nodes`

The junctions and the ends of the edges. 1,859 rows.

| Column | Type | Meaning |
|---|---|---|
| `node_id` | BIGINT | The key of the node. |
| `geometry` | GEOMETRY | The node as a Point. |

### `private_edges`

The roads that the network cannot use, moved out of `edges`: private roads, bus-only roads and pedestrian streets (for driving). The columns are the columns of `edges`. 724 rows.

### `edge_graph`

The graph of the legal moves from one edge to the next. A turn restriction removes a row. 7,170 rows.

| Column | Type | Meaning |
|---|---|---|
| `from_edge`, `to_edge` | BIGINT | The edge that you leave and the edge that you take. |
| `via_edge` | BIGINT | The edge that the move goes through. |
| `cost` | FLOAT | The cost of the move in seconds. |
| `uses` | VARCHAR | Who can make the move: `car`, `bus`, `pedestrian` or `private`. |

### `turn_permission`

The turn rules as allowed or not allowed moves. 0 rows for Monaco.

| Column | Type | Meaning |
|---|---|---|
| `from_edge`, `to_edge` | BIGINT | The move. |
| `allowed` | BOOLEAN | True when the move is allowed. |
| `vehicles`, `except_vehicles`, `condition` | VARCHAR | The vehicles that the rule applies to, the vehicles that it does not apply to, and the condition of the rule. |
| `restriction_id` | BIGINT | The OSM relation that the rule comes from. |

### `turn_restrictions` (driving only)

The OSM turn restrictions with one via node. 43 rows.

| Column | Type | Meaning |
|---|---|---|
| `restriction_id` | BIGINT | The OSM relation. |
| `restriction_type` | VARCHAR | The OSM value, for example `only_straight_on` or `no_left_turn`. |
| `except_vehicles`, `applies_to`, `condition` | VARCHAR | The OSM tags of the restriction. |
| `via_node` | BIGINT | The junction of the turn. |
| `from_edge_id`, `to_edge_id` | BIGINT | The edge before the turn and the edge after it. |

### `turn_path_restrictions` (driving only)

The OSM turn restrictions with a via way. 0 rows for Monaco.

| Column | Type | Meaning |
|---|---|---|
| `restriction_id`, `restriction_type`, `except_vehicles`, `applies_to`, `condition` | | As in `turn_restrictions`. |
| `from_edge`, `to_edge` | BIGINT | The first and the last edge of the path. |
| `via_edges` | BIGINT[] | The edges in between, in order. |

### `edge_id_map`

For each merged edge, the edges that it was made from. 0 rows when no roads merge (`--no-global-junctions` gives rows on Monaco).

| Column | Type | Meaning |
|---|---|---|
| `old_edge_id`, `new_edge_id` | BIGINT | The key before the merge, and the key of the merged edge. |
| `seq` | INTEGER | The place of the old edge in the merged edge. |
| `is_reverse` | BOOLEAN | The direction. |
| `osm_id` | BIGINT | The OSM way. |

### `ways` and `way_nodes`

The OSM ways that the network kept, and their nodes in order. 1,294 ways and 9,555 rows.

| Table | Columns |
|---|---|
| `ways` | `osm_id`, `highway`, `name`, `maxspeed`, `oneway`, `bus_back`, `surface`, `service`, `access`, `junction`, `layer`, `bridge`, `tunnel`, `lanes_fwd`, `lanes_bwd`, `tags` (a map of all other tags), `refs` (the nodes) |
| `way_nodes` | `way_id`, `node_id`, `seq` (the place of the node in the way) |

### `virtual_nodes`

The columns `node_id` and `geometry`. The table is always empty, as in duckOSM: the virtual nodes are in `nodes`.

### `lane_profile` (driving only)

One row for each lane of each driving edge, from left to right. 3,510 rows. The method is in [lane_profile.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/lane_profile.md).

| Column | Type | Meaning |
|---|---|---|
| `edge_id` | BIGINT | The edge. |
| `lane_num` | INTEGER | The number of the lane, from 1. |
| `use` | VARCHAR | What the lane is for, for example `auto`. |
| `width_m` | DOUBLE | The width in meters. |
| `turn` | VARCHAR | The turn arrows of the lane. NULL when OSM has none. |
| `source`, `width_source` | VARCHAR | Where the lane and its width come from (`default`, or an OSM tag). |

## Tables of the area

| Table | File | Rows | Columns |
|---|---|---|---|
| `main.global_junctions` | `global_junctions_main.parquet` | 4,527 | `node_id`, `is_road_junction`. The nodes where every network cuts its ways. |
| `main.visualization_metadata` | `visualization_metadata_main.parquet` | 1 | `boundary_geojson`, `center_lat`, `center_lon`, `initial_zoom`, `timezone`, `built_at`, `duckosm_version`. |
| `mm.transfers` | `transfers_mm.parquet` | 12,352 | `node_id`, `from_mode`, `to_mode`, `cost_s`, `kind`. The changes of network at a node (`park`, `retrieve`, `bike_park`, `bike_unpark`). |
| `mm.edges` | In the `.duckdb` file only | A view | All edges of all networks, with their network. |
| `visualization.edge_levels` | `edge_levels_visualization.parquet` | 13,953 | The drawing order of the roads (a bridge over a road): `edge_id`, `casing_start`, `casing_level`, `casing_end`, `fill_level`, `head_start_m`, `head_end_m`, `cap_start`, `cap_end`. The method is in [levels.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/levels.md). |
| `visualization.edge_levels_meta` | `edge_levels_meta_visualization.parquet` | 1 | How the levels were made (`source`: `tags` or `solve`). |

## Tables that need more input

These tables exist only when you give the build more than an `.osm.pbf` file.

| Tables | You need | Where to read |
|---|---|---|
| `raw.nodes`, `raw.ways`, `raw.relations` and the base-map layers `features.*` | A boundary (`--boundary` in duckOSM, an area in the page) | [features.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/features.md) |
| `main.building_faces`, `main.building_info`, `main.building_entrances` | The base-map layers (the page makes them) | [osm-editing.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/osm-editing.md) |
| `bus.routes`, `bus.route_edges` | A boundary, and the driving network | [bus.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/bus.md) |
| `nodes.ele`, `edges.z_from`, `z_to`, `z_vertices` | A DEM file (`--dem`) | [CHANGELOG.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/CHANGELOG.md) |
