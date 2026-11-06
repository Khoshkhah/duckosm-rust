# The roads

This page tells which OSM ways become roads, which network takes each road, how the build sets the values of each road, and how the map draws the roads. Read it when a road is missing, is in the wrong network, or has a value that you do not expect. The facts come from the code of the engine (the duckOSM repository, `rust/duckosm-core`) and of roadstyle.

- [The tables](tables.md) tells you what each table is for.
- [Columns of the tables](../output-tables.md) lists every column.
- [The fixes file](fixes-file.md) tells you how to change a road.

## The three networks

A network is the set of roads for one way of travel. The build makes three networks.

| Network | Schema | Who travels | Speed |
|---|---|---|---|
| Driving | `driving` | Cars | The speed limit of the road, or the default of its class |
| Walking | `walking` | People on foot | 5 km/h on all roads |
| Cycling | `cycling` | Bicycles | 15 km/h, or 5 km/h where you push the bike |

One OSM way can be in all three networks. Each network has its own `edges` table. A road piece in two networks has the same `edge_id` in both.

## What the build reads

The build reads every OSM way with a `highway` tag, and every ferry line (`route=ferry`). A ferry line has no `highway` tag, so its edges get the class `ferry`.

The value of the `highway` tag is the class of the road, and the column `highway` keeps it. There are two exceptions:

- In the driving network, a `pedestrian` street that cars can use gets the class `living_street`. Cars can use it when `motorcar` or `motor_vehicle` is `yes`, `designated` or `permissive`, or when `access` is `delivery`, `destination` or `agricultural`.
- A connector (see [How a way becomes edges](#how-a-way-becomes-edges)) gets the class of the path that it extends.

## The road classes

The table gives each class that the engine knows, and the networks that take it. "Tag" means that the class is in the network only when a tag of the way allows it:

- Walking: `foot` is `yes`, `designated` or `permissive`, or `sidewalk` is `yes`, `both`, `left` or `right`.
- Cycling: `bicycle` is `yes`, `designated` or `permissive`, or the way has a `cycleway` tag that is not `no`, `none` or `separate`.

| Class (`highway`) | What it is | Driving | Walking | Cycling |
|---|---|---|---|---|
| `motorway` | A road for fast motor traffic only, with separate directions. | Yes | Never | Tag |
| `motorway_link` | A ramp to or from a motorway. | Yes | Never | Tag |
| `trunk`, `trunk_link` | A main road that is not a motorway, and its ramp. | Yes | Yes | Tag |
| `primary`, `primary_link` | A main road between towns, and its ramp. | Yes | Yes | Yes |
| `secondary`, `secondary_link` | A road between towns or city parts, and its ramp. | Yes | Yes | Yes |
| `tertiary`, `tertiary_link` | A road between villages or streets, and its ramp. | Yes | Yes | Yes |
| `unclassified` | A small public road that is not in a street area. | Yes | Yes | Yes |
| `residential` | A street in a residential area. | Yes | Yes | Yes |
| `living_street` | A street where people on foot go first and cars go slowly. | Yes | Yes | Yes |
| `service` | An access road: a driveway, a parking aisle, an alley. | Yes | Yes | Yes |
| `road` | A road of a class that nobody knows yet. | Yes | Yes | Tag |
| `busway` | A road for buses only. | In `private_edges` | Tag | Tag |
| `track` | A road for farm or forest vehicles. | No | Yes | Yes |
| `pedestrian` | A street or a square for people on foot. | In `private_edges`, or `living_street` | Yes | Yes, pushed |
| `footway` | A path for people on foot: a sidewalk, a crossing, a footpath. | No | Yes | Yes, pushed |
| `path` | A path for more than one use. | No | Yes | Yes |
| `cycleway` | A path for bicycles. | No | Tag | Yes |
| `bridleway` | A path for horses. | No | Yes | Yes |
| `steps` | Steps or an escalator. | No | Yes | Tag |
| `corridor` | A corridor inside a building. | No | Yes | Tag |
| `platform` | A platform of a bus stop or a station. | No | Yes | Tag |
| `ferry` | A ferry line (`route=ferry`). | No | Tag | Tag |
| Every other value | For example `construction`, `proposed`, `raceway`, `elevator`. | No | Tag | Tag |

"Pushed" means that the cyclist walks with the bike. The edge has `dismount` true and the speed 5 km/h. A `footway` or `pedestrian` way with `bicycle` set to `yes`, `designated` or `permissive` is not pushed.

!!! note
    The driving network has no `track` and no paths.

### More rules of the walking network

- A `motorway` or a `motorway_link` is never in the walking network, also with `foot=yes`.
- A road is not in the walking network when it has one of these tags, and no `foot` or `sidewalk` tag of the "Tag" rule: `motorroad=yes`, `foot=use_sidepath`, `sidewalk=separate`, `sidewalk:both=separate`, or both `sidewalk:left=separate` and `sidewalk:right=separate`. Such a street has its sidewalks as separate `footway` ways, and the network uses them.

## Access: who can use the road

For each way and network, the build takes the first tag of this list that the way has. That is the access value.

| Network | Tags, in order |
|---|---|
| Driving | `motorcar`, `motor_vehicle`, `vehicle`, `access` |
| Walking | `foot`, `access` |
| Cycling | `bicycle`, `vehicle`, `access`. On a pushed way: `foot`, `access`. |

The column `access` of the edge keeps the value. The value decides where the edge goes:

| Value | Driving | Walking and cycling |
|---|---|---|
| `no` | Not in the network | Not in the network |
| `agricultural`, `forestry`, `emergency` | Not in the network | In `edges` |
| `private` | In `private_edges` | In `private_edges` |
| `bus` (see below) | In `private_edges` | – |
| Every other value (`yes`, `destination`, `customers`, `delivery` and more), or no value | In `edges` | In `edges` |

In the driving network, three more rules set the value:

- A `busway`, or a road with `psv` as its car value, gets `bus`.
- A road with the car value `no` or `private`, and with `bus` or `psv` set to `yes` or `designated`, gets `bus`. It is a bus-only road.
- A `pedestrian` street that cars cannot use gets `pedestrian`, or `delivery` or `private` when that is its car value. All these streets go to `private_edges`.

### The private edges

The table `private_edges` holds the roads that are on the ground but that the network cannot use: private roads, bus-only roads and bus lanes, and (driving) pedestrian streets. It has the same columns as `edges`. The edge graph has the moves between an edge and a private edge, with the label of the private edge in `uses`. The map draws these roads.

### `area=yes`

The tag `area=yes` does not remove a way. The network uses the outline of the area as a road. A `pedestrian` way with `area=yes` gets the `walk_type` `plaza`.

## One-way roads

Each network reads its own tags for the direction.

| Network | One-way as drawn | One-way against the drawing | Two-way |
|---|---|---|---|
| Driving | `junction=roundabout` or `circular`; `oneway=yes`, `1` or `true`; a `motorway` or `motorway_link` with no `oneway` tag | `oneway=-1` | `oneway=no`, `false` or `0`, or no tag |
| Walking | `oneway:foot=yes`, `1` or `true` | `oneway:foot=-1` | Every other way. The walking network does not read `oneway`. |
| Cycling | `oneway:bicycle=yes`, `1` or `true`; else a roundabout, or `oneway=yes`, `1` or `true` | `oneway:bicycle=-1`; else `oneway=-1` | `oneway:bicycle=no`; a pushed way; every other way |

- A one-way street has one edge in the driving network and two edges in the walking network.
- A street with `oneway=yes` and `oneway:bicycle=no` has two edges in the cycling network.
- A roundabout is one-way in the driving network, also when it has `oneway=no`.
- A one-way road with `oneway:bus=no` or `oneway:psv=no` has a bus lane in the other direction. The driving network adds the reverse edge with the access `bus`, so the edge goes to `private_edges`.
- The fixes-file rule `oneway` sets the direction in every network. Each OSM tag acts only in the networks of the table above.

## How a way becomes edges

An edge is one directed piece of road between two junctions. The build makes the edges in these steps:

1. **The junctions.** The build looks at every way with a `highway` tag that is on the ground: not `proposed`, `construction`, `abandoned`, `razed` or `disused`. Here, `footway`, `path`, `cycleway`, `steps`, `pedestrian`, `bridleway` and `corridor` are paths, but a `pedestrian` street that cars can use is a road. A node is a road junction when a road uses it, and two or more ways use it or a road ends at it. A node where two or more paths meet, and no road, is a path junction. The table `main.global_junctions` holds these nodes.
2. **The cut.** The build cuts a road at each road junction. It cuts a path at each junction, and also at each node where the ways of the network meet or end. All networks use the same junctions, so a road piece has the same ends in each network.
3. **Loops and twins.** A way that comes back to its start node gets a virtual node in its middle. Two edges of one way with the same ends also get a virtual node: the build cuts the longer one at its midpoint. A virtual node has a negative `node_id`.
4. **The two directions.** A two-way road gives two edges: one along the node order of the way, and one against it (`is_reverse` true). A one-way road gives one edge in its direction. A road with `oneway=-1` gives one edge against the node order, with `is_reverse` false.
5. **The merge.** At a node that is not a road junction, the build joins a chain of edges with the same tags, direction, lanes and access into one edge. The table `edge_id_map` gives the old edges of each merged edge.
6. **The key.** `edge_id` is `(hash(osm_id, source, target) >> 1)::BIGINT`, the DuckDB `hash` of the way and the two end nodes. It does not depend on the order of the rows, so the same road gives the same `edge_id` in every build. `edge_ref` is a text name: the way, the number of the piece in the way, and `f` (along) or `r` (against). An example: `4230114#2r`.
7. **The connectors (walking and cycling).** A path that ends near the network but does not touch it gets a straight connector to the nearest node within 10 m. The classes are `cycleway`, `footway`, `path`, `steps`, `pedestrian` and `track`. A connector has two edges, a negative `osm_id`, and the class of the path. In the duckOSM config, `clip.connectivity_rescue` turns this step on or off (on by default), and `clip.connect_snap_m` sets the distance.
8. **The speed and the cost.** See [The values of a road](#the-values-of-a-road).
9. **The private edges.** The build moves the private, bus and pedestrian edges to `private_edges` (see [Access](#access-who-can-use-the-road)).
10. **The largest part.** The build keeps only the largest connected part of each network, and drops the edges that the rest of the network cannot reach. The page always has a boundary, so this step always runs.

## The values of a road

### Speed: `maxspeed_kmh`

In the driving network, the build reads the `maxspeed` tag:

1. A number, for example `50` or `30.5`: that number, in km/h.
2. A text with `mph`, for example `30 mph`: the first number times 1.60934.
3. Every other text, or no tag: the default speed of the class. Examples: `50 km/h` (not a plain number), `RU:urban`, `signals`, `none`, `50;60`.

| Class | Default speed (km/h) |
|---|---|
| `motorway`, `motorway_link` | 110 |
| `trunk`, `trunk_link` | 90 |
| `primary`, `primary_link` | 70 |
| `secondary`, `secondary_link` | 60 |
| `tertiary`, `tertiary_link` | 50 |
| `unclassified`, `road` | 40 |
| `residential` | 30 |
| `living_street`, `service` | 20 |
| Every other class | 50 |

- The walking network gives 5 km/h to every edge. The cycling network gives 15 km/h, and 5 km/h to a pushed edge. These two networks do not read `maxspeed`.
- The kind of `service` road and the `surface` do not change the speed.
- The edges have no `maxspeed` column. `maxspeed_kmh` takes its place, and the table `ways` keeps the text of the tag.

### Travel time: `cost_s`

`cost_s` is the time to travel the edge, in seconds: `length_m / 1000 / maxspeed_kmh * 3600`. When the speed is 0 or less (for example `maxspeed=0`), the build uses 50 km/h for the cost.

### Length: `length_m`

The length of the edge line in meters: the sum of the great-circle (haversine) distances between its points, with a radius of 6,371 km.

### Lanes: `lanes`

`lanes` is the number of car lanes in the direction of the edge. The build reads the first number in the tags `lanes`, `lanes:forward`, `lanes:backward` and `lanes:reversible`. A value of 0 counts as no tag.

| Edge | Lanes |
|---|---|
| A path (`footway`, `path`, `cycleway`, `steps`, `pedestrian`, `bridleway`, `corridor`, `platform`) | NULL |
| A one-way road | `lanes:forward` (`lanes:backward` for `oneway=-1`), else `lanes`, else 1. With a bus lane back, `lanes` minus the bus lane. |
| A two-way road, along the way | `lanes:forward`, else `lanes` minus `lanes:backward`, else `lanes` / 2 rounded up, else the default |
| A two-way road, against the way | `lanes:backward`, else `lanes` minus `lanes:forward`, else `lanes` / 2 rounded down, else the default |

- The default is 2 for `motorway` and `trunk`, and 1 for all other classes. A one-way `motorway` with no lane tags has 1 lane.
- The result is never less than 1. The build adds `lanes:reversible` to each direction.
- The walking and cycling networks keep the car lanes of the road.
- The fixes-file rules `lanes`, `lanes_forward` and `lanes_backward` replace these numbers.
- The table `lane_profile` gives each lane of each driving edge, with its use, width and arrows.

### `walk_type` (walking)

The first rule that fits, from the top, gives the value.

| Rule | `walk_type` |
|---|---|
| `steps` with a `conveying` tag | `escalator` |
| `steps` | `steps` |
| `footway` with `footway=sidewalk` | `sidewalk` |
| `footway` with `footway=crossing` | `crossing` |
| Other `footway` | `footpath` |
| `pedestrian` with `area=yes` | `plaza` |
| Other `pedestrian` | `pedestrian_street` |
| `living_street` | `shared_street` |
| A road with a `sidewalk` tag that is not `no`, `none` or `separate` (not `path`, `track`, `bridleway`, `corridor` or `platform`) | `sidewalk` |
| `residential`, `service`, `unclassified`, `road`, `tertiary`, `secondary`, `primary`, `trunk` and their links | `shared_road` |
| `corridor`, or a way with `indoor=yes` | `corridor` |
| `platform` | `platform` |
| `path`, `track`, `bridleway` | `path` |
| Every other way (for example a `cycleway` or a ferry) | `footpath` |

A connector has no tags of its own, so only its class gives its value.

### `cycle_type` (cycling)

Each direction of a road can have its own value. The "side tag" is the first of these tags that the way has:

- The edge along the way: `cycleway:right`, `cycleway:both`, `cycleway`.
- The edge against the way: `cycleway:left`, `cycleway:both`, `cycleway`.

The first rule that fits, from the top, gives the value.

| Rule | `cycle_type` |
|---|---|
| A pushed edge | `dismount` |
| The class `cycleway` | `cycleway` |
| The side tag is `track` | `cycle_track` |
| The side tag is `lane` | `cycle_lane` |
| The side tag is `shared_lane` | `shared_lane` |
| The side tag is `share_busway` | `bus_cycle_lane` |
| `path`, `track` or `bridleway` with `segregated=yes` | `segregated_path` |
| `path`, `track` or `bridleway` | `shared_path` |
| Every other way | `mixed_traffic` |

### `dismount` (cycling)

`dismount` is true on a pushed edge: a `footway` or `pedestrian` way where `bicycle` is not `yes`, `designated` or `permissive`.

- A pushed edge is two-way and has the speed 5 km/h.
- A connector that extends a pushed way is pushed too.
- The config option `cycling_dismount` (on by default) adds these ways to the cycling network. Without it, footways and pedestrian streets are in the cycling network only with the "Tag" rule.

### The other columns

| Column | Value |
|---|---|
| `name` | The `name` tag. |
| `surface` | The `surface` tag. The build does not use it. |
| `service` | The `service` tag: the kind of a `service` road, for example `driveway`, `parking_aisle` or `alley`. The build does not use it. |
| `junction` | The `junction` tag. `roundabout` and `circular` make the road one-way. |
| `bridge`, `tunnel`, `layer` | The tags of the same name, as text. The drawing levels use them. |
| `oneway` | True when the edge is one-way in this network. |

### The drawing levels

The table `visualization.edge_levels` gives the drawing order of each edge. The default method (`tags`) reads `bridge`, `tunnel`, `layer`, `junction` and the class. A bridge has a level above 0, and a tunnel has a level below 0. [Step 8](edit-levels.md) tells you how to change the levels.

## The roads on the map

### Which roads the map draws

Step 6 draws the roads of one network, or of all networks. One network gives its `edges` and its `private_edges`. **All** gives every road of every network, and a road in two networks shows one time.

### The class groups

The Layers tab of [step 9](edit-design.md) has one switch for each group of classes. A `_link` class is in the group of its main class.

| Switch | Classes |
|---|---|
| Motorway and trunk | `motorway`, `trunk` |
| Primary | `primary` |
| Secondary | `secondary` |
| Tertiary | `tertiary` |
| Residential and below | `unclassified`, `residential`, `living_street`, `road`, `busway` |
| Service | `service` |
| Paths and footways | `pedestrian`, `footway`, `path`, `steps`, `track`, `bridleway`, `corridor`, `platform`, `construction` |
| Cycleways | `cycleway` |

A class in no group, for example `ferry` or `raceway`, always shows.

The Roads tab has these settings:

- A fill color and a casing color for 14 classes: `motorway`, `trunk`, `primary`, `secondary`, `tertiary`, `unclassified`, `residential`, `living_street`, `service`, `pedestrian`, `cycleway`, `footway`, `path` and `track`. A link has the colors of its class. The other classes keep the colors of the theme.
- A width factor for 9 groups: motorway and trunk; primary; secondary; tertiary; residential and unclassified; living street; service; pedestrian; and footway, path, cycleway and track.

### The first zoom of each class

In the default look of roadstyle, a class shows from this zoom. A theme can change the zoom.

| Zoom | Classes |
|---|---|
| 4 | `motorway` |
| 5 | `trunk` |
| 7 | `primary` |
| 9 | `secondary` |
| 11 | `tertiary`, `motorway_link`, `trunk_link`, `primary_link` |
| 12 | `secondary_link`, `tertiary_link` |
| 13 | `unclassified`, `residential` |
| 14 | `living_street`, `pedestrian`, `cycleway`, `track` |
| 15 | `service`, `footway`, `path` |
| 0 (all zooms) | Every other class, for example `road`, `steps`, `bridleway`, `platform` |

### Bridges, tunnels, arrows and names

- A road with a level above 0 is a bridge. The map draws it with a deck casing and a shadow, over the roads under it.
- A road with a level below 0 is a tunnel. The map draws it with a dashed casing and paler colors.
- The one-way arrows show on the edges with `oneway` true. Turn them on in the base-map box (**Arrows**). They start at zoom 15 on the main classes (`motorway` to `tertiary` and their links) and at zoom 16.5 on the other classes.
- The street names start at zoom 14. The names of the small classes (`service`, `pedestrian`, `footway`, `path`, `cycleway`, `steps` and `track`) start at zoom 16.

The Text tab of step 9 changes the first zoom of the arrows and of the names.

### The layer `edges` of the tile files

The tile profile (step 9, Tiles tab) adds a layer `edges` to the tile files of [step 10](export.md). The layer holds the edges of the `edges` tables of all networks, with a flag for each network. It does not hold the private edges. A class comes into the layer at its start zoom, and a `_link` class has the zoom of its main class.

| Class | Start zoom |
|---|---|
| `motorway`, `trunk`, `primary` | 0 |
| `secondary` | 8 |
| `tertiary` | 10 |
| `unclassified` | 11 |
| `residential`, `living_street` | 12 |
| Every other class | 13 |

The profile **Simulation preview** sets all these zooms to 0.

## How to check it

Download the `.duckdb` file in [step 5](result.md) and open it with DuckDB. Run the `edge_id` query with DuckDB 1.3 or later, because the `hash` function of older versions gives other numbers.

```sql
-- the classes of each network, with their number of edges
SELECT 'driving' AS network, highway, count(*) AS edges FROM driving.edges GROUP BY ALL
UNION ALL SELECT 'walking', highway, count(*) FROM walking.edges GROUP BY ALL
UNION ALL SELECT 'cycling', highway, count(*) FROM cycling.edges GROUP BY ALL
ORDER BY network, edges DESC;

-- the speeds of the driving classes: the default shows when OSM has no maxspeed tag
SELECT highway, min(maxspeed_kmh) AS low, max(maxspeed_kmh) AS high, count(*) AS edges
FROM driving.edges GROUP BY highway ORDER BY high DESC;

-- why a road is not in the driving network: it is in private_edges, with its access value
SELECT highway, access, count(*) AS edges FROM driving.private_edges GROUP BY ALL ORDER BY edges DESC;

-- the edge_id is the hash of the way and the two end nodes: this query gives 0
SELECT count(*) FROM driving.edges WHERE edge_id <> (hash(osm_id, source, target) >> 1)::BIGINT;

-- the kinds of walking and cycling ways
SELECT walk_type, count(*) FROM walking.edges GROUP BY ALL ORDER BY 2 DESC;
SELECT cycle_type, count(*) FROM cycling.edges GROUP BY ALL ORDER BY 2 DESC;
```
