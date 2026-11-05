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
- Geometry columns are `GEOMETRY('OGC:CRS84')` (longitude and latitude). The base-map layers and the doors have a `GEOMETRY` with no CRS, also in longitude and latitude.
- In the `.duckdb` file, the geometry column of `nodes`, `virtual_nodes` and `main.boundary` has the name `geom`, as in duckOSM. In the Parquet files, its name is `geometry`.

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
| `dismount` | BOOLEAN | Cycling only. True on a footway or a pedestrian street where you push the bike. |
| `maxspeed_kmh` | FLOAT | The speed limit, or a default for the class. |
| `cost_s` | FLOAT | The travel time in seconds. |
| `walk_type` | VARCHAR | Walking only. The kind of path: `sidewalk`, `crossing`, `footpath`, `steps`, `path`, `platform`, `plaza` and more. |
| `cycle_type` | VARCHAR | Cycling only. The kind of bike way: `cycle_lane`, `shared_path`, `bus_cycle_lane`, `mixed_traffic`, `dismount` and more. |

### `nodes`

The junctions and the ends of the edges. 1,859 rows.

| Column | Type | Meaning |
|---|---|---|
| `node_id` | BIGINT | The key of the node. |
| `geometry` | GEOMETRY | The node as a Point. The name is `geom` in the `.duckdb` file. |

### `private_edges`

The roads that the network cannot use, moved out of `edges`: private roads, bus-only roads and pedestrian streets (for driving). The columns are the columns of `edges`. 724 rows.

### `edge_graph`

The graph of the legal moves from one edge to the next. A turn restriction removes a row. 7,170 rows.

| Column | Type | Meaning |
|---|---|---|
| `from_edge`, `to_edge` | BIGINT | The edge that you leave and the edge that you take. |
| `via_edge` | BIGINT | The edge that the move goes through. |
| `cost` | FLOAT | The cost of the move in seconds. |
| `uses` | VARCHAR | Who can make the move. Between two edges of the network, it is the user of the network: `car` (driving), `walk` or `bike`. When one edge is in `private_edges`, it is the label of that edge: `bus`, `private`, `pedestrian` or `delivery`. |

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
| `ways` | `osm_id` BIGINT, `highway` VARCHAR, `name` VARCHAR, `maxspeed` VARCHAR, `oneway` BOOLEAN, `bus_back` BOOLEAN, `surface`, `service`, `access`, `junction`, `layer`, `bridge`, `tunnel` (VARCHAR), `lanes_fwd` INTEGER, `lanes_bwd` INTEGER, `tags` MAP(VARCHAR, VARCHAR) (all other tags), `refs` BIGINT[] (the nodes) |
| `way_nodes` | `way_id` BIGINT, `node_id` BIGINT, `seq` BIGINT (the place of the node in the way) |

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
| `main.boundary` | `boundary_main.parquet` | 1 | The area: `geometry` (`geom` in the `.duckdb` file), and one column for each property of the boundary GeoJSON, for example `name`, `osm_id`, `admin_level`, `area_km2` and `source`. |
| `main.global_junctions` | `global_junctions_main.parquet` | 4,527 | `node_id` BIGINT, `is_road_junction` BOOLEAN. The nodes where every network cuts its ways. |
| `main.visualization_metadata` | `visualization_metadata_main.parquet` | 1 | `boundary_geojson` (VARCHAR, JSON in the `.duckdb` file), `center_lat` DOUBLE, `center_lon` DOUBLE, `initial_zoom` INTEGER, `timezone` VARCHAR, `built_at` TIMESTAMP, `duckosm_version` VARCHAR. |
| `mm.transfers` | `transfers_mm.parquet` | 12,352 | `node_id` BIGINT, `from_mode` VARCHAR, `to_mode` VARCHAR, `cost_s` DOUBLE, `kind` VARCHAR. The changes of network at a node (`park`, `retrieve`, `bike_park`, `bike_unpark`). |
| `mm.edges` | In the `.duckdb` file only | A view | All edges of all networks: `mode` VARCHAR, `edge_id`, `source`, `target` (BIGINT), `cost_s`, `length_m` (FLOAT), `highway`, `name` (VARCHAR), `geometry`. The key is (`mode`, `edge_id`). |

## Tables of the drawing order

The schema `visualization`. The method is in [levels.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/levels.md).

### `visualization.edge_levels`

The drawing order of the roads: a bridge is over the road under it. One row for each edge ID in `edges` and `private_edges` of all networks. 13,953 rows. File: `edge_levels_visualization.parquet`.

| Column | Type | Meaning |
|---|---|---|
| `edge_id` | BIGINT | The edge. |
| `casing_start`, `casing_level`, `casing_end` | BIGINT | The casing number of the head at the start, of the main part, and of the head at the end. |
| `fill_level` | BIGINT | The fill number. |
| `head_start_m`, `head_end_m` | DOUBLE | The length of each head, in meters. |
| `cap_start`, `cap_end` | VARCHAR | The shape of each end: `round`, `square` or `flat`. |

The map paints the numbers from low to high. At each number, it paints all casings before all fills. 0 is the ground.

### `visualization.edge_levels_meta`

One row: how the levels were made. File: `edge_levels_meta_visualization.parquet`.

| Column | Type | Meaning |
|---|---|---|
| `source` | VARCHAR | `tags` (from the OSM tags), `solve` (solved by roadstyle) or `area` (saved by the level editor). |
| `area` | VARCHAR | The level area of the editor. NULL when `source` is not `area`. |
| `n_edges` | BIGINT | The number of edges. |
| `edge_hash` | VARCHAR | A hash of the edge IDs. The levels are correct only for these edges. |
| `roadstyle_version` | VARCHAR | The roadstyle version that made the levels. |
| `created` | VARCHAR | The time when the levels were made. |

### `visualization.level_edits`, `level_heads`, `level_caps`

Your rules from the level editor ([step 8](manual/edit-levels.md)). A table exists only when it has rules. The values are text, and the IDs are BIGINT. Files: `level_edits_visualization.parquet`, `level_heads_visualization.parquet`, `level_caps_visualization.parquet`.

| Table | Columns |
|---|---|
| `level_edits` | `relation` (`order`, `stack` or `meet`), `a` and `b` (the two roads, BIGINT), `a_end`, `b_end`, `enabled`. |
| `level_heads` | `road` (BIGINT), `start_m`, `end_m`: the head length at each end, in meters. |
| `level_caps` | `road` (BIGINT), `start`, `end`: `round`, `square` or `flat`. |

## Tables of the bus routes

The schema `bus`. A build makes it when it has the driving network and the raw OSM data of the area (a boundary). The method is in [bus.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/bus.md).

### `bus.routes`

One row for each OSM bus route relation (`route` is `bus`, `trolleybus` or `share_taxi`). File: `routes_bus.parquet`.

| Column | Type | Meaning |
|---|---|---|
| `osm_id` | BIGINT | The OSM relation. |
| `route` | VARCHAR | `bus`, `trolleybus` or `share_taxi`. |
| `ref`, `name`, `operator`, `from`, `to`, `network` | VARCHAR | The tags of the relation. |
| `edges` | INTEGER | The number of rows in `bus.route_edges`. |
| `outside` | INTEGER | The number of member ways that are not in the area. |
| `gaps` | VARCHAR[] | `'<way_id> <kind>'` for each way that the route could not follow. Empty when the route is complete. |

### `bus.route_edges`

One row for each edge of each route, in order and in the direction of travel. File: `route_edges_bus.parquet`.

| Column | Type | Meaning |
|---|---|---|
| `route_id` | BIGINT | The relation (`bus.routes.osm_id`). |
| `ref` | VARCHAR | The line number of the route. |
| `seq` | INTEGER | The place of the edge in the route, from 1. |
| `edge_id`, `edge_ref` | BIGINT, VARCHAR | The driving edge. |
| `bus_lane` | BOOLEAN | True when the edge is in `driving.private_edges` (a bus lane or a bus-only road). |

## Tables of the buildings

The schema `main`. These tables need a build with **Layers** on. [Step 7](manual/edit-osm.md) edits their data.

### `main.building_faces`

One row for each wall of each building: a segment of the outline. A wall shorter than 0.1 m has no row. File: `building_faces_main.parquet`.

| Column | Type | Meaning |
|---|---|---|
| `building_id` | BIGINT | The OSM way or relation of the building. |
| `building_type` | VARCHAR | `way` or `relation`. |
| `face_index` | INTEGER | The place of the wall in the ring, from 0. |
| `from_node`, `to_node` | BIGINT | The OSM nodes at the two ends of the wall. |
| `face_type` | VARCHAR | The type of the wall: `front`, `back`, `side`, `party` or `court`. A rule of the fixes file can change it. |
| `computed_type` | VARCHAR | The type that the method found. |
| `edited` | BOOLEAN | True when a rule gives a type that is not `computed_type`. |
| `type_reason` | VARCHAR | Why the wall has its type: `entrance`, `address`, `street`, `corner`, `inferred`, `inner`, `opposite`, `shared`, `other` or `none`. |
| `door` | VARCHAR | The kind of door that a rule gives the wall (for example `main`). NULL when the wall has no door. |
| `length_m` | FLOAT | The length in meters. |
| `azimuth_deg` | FLOAT | The direction that the wall faces, in degrees from north (90 is east). |
| `street_osm_id`, `street_edge_id` | BIGINT | The OSM way and the edge of the street that the wall faces. NULL when there is none. |
| `street_name` | VARCHAR | The name of that street. |
| `distance_m` | FLOAT | The distance to that street, in meters. |
| `geometry` | GEOMETRY | The wall as a LineString. |

### `main.building_info`

One row for each building of `features.buildings`, with values from its OSM tags. A value that the page cannot read is NULL. File: `building_info_main.parquet`.

| Column | Type | Meaning |
|---|---|---|
| `osm_id` | BIGINT | The OSM way or relation. |
| `osm_type` | VARCHAR | `way` or `relation`. |
| `kind`, `name` | VARCHAR | As in `features.buildings`. |
| `levels`, `roof_levels` | INTEGER | From `building:levels` and `roof:levels`. |
| `height_m` | DOUBLE | From `height`, in meters. A value in feet is changed to meters. |
| `roof_shape` | VARCHAR | From `roof:shape`. |
| `roof_color`, `facade_color` | VARCHAR | From `roof:colour` and `building:colour`, as `#rrggbb`. |
| `material`, `roof_material` | VARCHAR | From `building:material` and `roof:material`. |

### `main.building_entrances`

One row for each door of the area: a node with an `entrance` or `door` tag. File: `building_entrances_main.parquet`.

| Column | Type | Meaning |
|---|---|---|
| `osm_id` | BIGINT | The OSM node. |
| `osm_type` | VARCHAR | Always `node`. |
| `kind` | VARCHAR | The `entrance` tag, or `door` when the node has only a `door` tag. |
| `door`, `access`, `level`, `wheelchair`, `name` | VARCHAR | The tags of the same name. |
| `housenumber`, `street` | VARCHAR | The tags `addr:housenumber` and `addr:street`. |
| `building_id` | BIGINT | The building way that has the node in its outline (the lowest ID when two buildings share it). NULL when there is none. |
| `tags` | MAP(VARCHAR, VARCHAR) | All tags of the node. Only in DuckDB: the Parquet file has no `tags` column. |
| `geom` | GEOMETRY | The node as a Point. |

## Tables of the base map

The schema `features`. These tables need a build with **Layers** on. Each table is a layer of the map. duckOSM has the full reference: [Base-map layers](https://github.com/Khoshkhah/duckOSM/blob/main/docs/reference/features.md).

| Table | What it holds |
|---|---|
| `features.buildings` | The buildings. |
| `features.land` | Land use and natural areas. |
| `features.water_polygons`, `features.water_lines` | Lakes, the sea and rivers. |
| `features.streets` | Every way with a `highway` tag, and the railways (for drawing, not for routing). |
| `features.paved` | Squares, pedestrian areas and piers. |
| `features.sites` | Parking, bus stations, schools, hospitals and more. |
| `features.public_transport` | Stops and stations. |
| `features.pois` | Points of interest. |
| `features.traffic` | Traffic signals and crossings. |
| `features.place_labels` | Place names. |

All tables have the same columns. `features.traffic` has one more column. Files: `features_<table>.parquet`, for example `features_buildings.parquet`.

| Column | Type | Meaning |
|---|---|---|
| `osm_id` | BIGINT | The OSM object. |
| `osm_type` | VARCHAR | `node`, `way` or `relation`. |
| `kind` | VARCHAR | The kind in the layer, for example `residential` or `forest`. |
| `name` | VARCHAR | The `name` tag. |
| `tags` | MAP(VARCHAR, VARCHAR) | All tags. Only in DuckDB: the Parquet files have no `tags` column. |
| `geom` | GEOMETRY | The shape. |
| `bearing` | DOUBLE | `features.traffic` only. On a crossing, the direction of its road, in degrees from north. NULL on the other rows. |

## Tables that need more input

These tables exist only when you give the build more than an `.osm.pbf` file.

| Tables | You need | Where to read |
|---|---|---|
| `raw.nodes`, `raw.ways`, `raw.relations` | A boundary (`--boundary` in duckOSM). The page uses them for the layers and then drops them: no download has them. | [features.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/features.md) |
| The base-map layers `features.*` | A boundary, and **Layers** on in the page | [Tables of the base map](#tables-of-the-base-map) |
| `main.building_faces`, `main.building_info`, `main.building_entrances` | The base-map layers. Only the page makes them. | [Tables of the buildings](#tables-of-the-buildings) |
| `bus.routes`, `bus.route_edges` | A boundary, and the driving network | [Tables of the bus routes](#tables-of-the-bus-routes) |
| `visualization.level_edits`, `level_heads`, `level_caps` | Rules from the level editor | [Tables of the drawing order](#tables-of-the-drawing-order) |
| `nodes.ele`, `edges.z_from`, `z_to`, `z_vertices` | A DEM file (`--dem`) | [CHANGELOG.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/CHANGELOG.md) |
