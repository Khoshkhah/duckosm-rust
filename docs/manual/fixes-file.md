# The fixes file (YAML)

The fixes file is a YAML file of rules. Each rule corrects one error in the OSM data of your area. The build applies the rules before it makes the tables, and the OSM data itself does not change. Read this page when you write a fixes file by hand, or when you want to know what a rule from the panel does.

The smallest useful fixes file has one rule:

```yaml
overrides:
  - osm_id: 93137596
    lanes: 1
```

## Where the file comes from and where it goes

| Step | What happens |
|---|---|
| 1. You make the rules | The panel [Edit OSM data](edit-osm.md) keeps your rules in your browser, for each area. **Build again** in the tab **Changes** builds with them at once, with no file. |
| 2. You download the file | **Download** in the tab **Changes** writes your rules to `osm_fixes.yaml`. The button **.yaml** of [step 5](result.md) downloads the rules of the last build. After a build with no fixes, it downloads an empty fixes file (`overrides: []`, `new_ways: []`, `turn_restrictions: []`) to start from. |
| 3. You load the file again | The field **Fixes** of [step 4](build.md) takes a `.yaml` or `.yml` file. Its rules replace the rules in the panel, and the next build uses them. |
| 4. duckOSM reads the same file | `duckosm build --fixes osm_fixes.yaml` applies it on the command line. In a duckOSM configuration file, the key is `osm_overrides`. |

The page reads the file into the panel, and writes it again from the rules. Thus the page does not keep the comments of a file that you load, and it writes the keys in its own order.

## The structure

The file is one YAML map. All its keys are optional. An empty file has no rules.

| Key | Type | What it holds |
|---|---|---|
| `overrides` | list of maps | Rules for OSM ways: one-way, lanes, layer, networks, removal, tags, a part of a way, lane arrows. |
| `new_ways` | list of maps | Roads that OSM does not have. |
| `turn_restrictions` | list of maps | Turn rules that OSM does not have. |
| `extra` | map | The rules that only the page applies in full. It has the two keys below. |
| `extra.tag_edits` | list of maps | Tags to set and to delete on a way, a node or a relation. |
| `extra.building_faces` | list of maps | The type and the door of one wall of a building. |

- The build stops with an error when the file has a key that is not on this page, for example `unknown key 'bad' in the file`. It also stops when a value has the wrong type.
- A list can be empty or `null`.
- You can add the key `note` to each rule. It is free text for your own record, and the build does not read it.

## How to write the IDs and the values

- Write each OSM ID as a whole number, with no quotes and no letter: `93137596`, not `w93137596`.
- The key gives the type of the ID. `osm_id` is a way. `via_node` is a node. In `extra.tag_edits`, the key `type` gives the type.
- In a wall rule, the building is the ID of its way, or of its relation when the building is a multipolygon relation.
- Write the value of a tag as text. A number is also accepted and becomes text. `true` and `false` are not accepted as tag values. Write `"yes"` or `"no"` in quotes.

## `overrides`: rules for a way

Each rule is for one OSM way: a road, a building or any other way.

| Key | Type | Required | What the build does |
|---|---|---|---|
| `osm_id` | integer | Yes | The way of the rule. |
| `oneway` | `true` or `false` | No | Makes the way one-way (`true`) or two-way (`false`). A one-way way has no edge against its direction. |
| `lanes` | integer | No | The number of lanes in each direction. On a one-way way, only the forward direction, unless the same rule has `oneway: false`. |
| `lanes_forward` | integer | No | The number of lanes in the direction of the way. |
| `lanes_backward` | integer | No | The number of lanes against the direction of the way. |
| `layer` | integer | No | The vertical level of the way. It replaces the OSM tag `layer`. |
| `exclude_modes` | list of `driving`, `walking`, `cycling` | No | Removes the way from the networks in the list. The other keys of the rule still act in the other networks. |
| `remove` | `true` or `false` | No | `true` removes the way from all of the build: no road, no building and no layer. |
| `tags` | map of tag to text | No | Sets these tags on the way before any step reads it. |
| `keep_nodes` | list of two node IDs | No | Keeps only the part of the way from the first node to the second node, both included. Nothing changes when the first node is not before the second node in the way. |
| `turn_lanes_forward` | text | No | The arrows of the lanes in the direction of the way, as the OSM tag `turn:lanes:forward` (`left|through`). |
| `turn_lanes_backward` | text | No | The arrows against the direction of the way, as the OSM tag `turn:lanes:backward`. |
| `note` | text | No | Free text. |

- In `driving.lane_profile`, the lanes of a way with `lanes`, `lanes_forward` or `lanes_backward` have the source `override`.
- The tab **Road** of the panel writes `oneway`, the lanes, the arrows, `layer`, `exclude_modes` and `remove`. The button **Delete** writes `remove: true`.
- The panel writes the other tags of a road to `extra.tag_edits`, not to `tags`.
- The panel does not write `keep_nodes`. It keeps a `keep_nodes` that a loaded file has.

```yaml
overrides:
  - osm_id: 93137596
    lanes: 1
    note: "OSM has lanes=2. Street View shows one lane."
  - osm_id: 167625756
    exclude_modes: [cycling]
  - osm_id: 93091320
    remove: true
```

## `new_ways`: new roads

Each item is a way that OSM does not have. The tab **New road** of the panel writes these items.

| Key | Type | Required | What the build does |
|---|---|---|---|
| `id` | integer | Yes | The ID of the new way: 9000000000000 or more, and different for each new way. Do not change it, because the `edge_id` values come from it. |
| `nodes` | list | Yes | The nodes in the direction of the way. Each node is an OSM node ID, or `[lon, lat]` for a new node. |
| `tags` | map of tag to text | No | The tags of the way, for example `highway`, `name` and `oneway`. |
| `tags_from` | integer | No | An OSM way. The new way gets the tags that this way had before the fixes. `tags` replaces the same keys. |
| `source` | text | No | Free text. The build does not read it. |
| `note` | text | No | Free text. |

- An OSM node in `nodes` joins the new way to the roads at that node. Make the two ends OSM nodes, so that the way connects to the network.
- A new node at `[lon, lat]` gets the ID `id × 1000 + its place in the list` (the first node is place 1).
- A way needs a `highway` tag to be a road. The panel does not let you finish a road without one.
- To keep the part of a way that `keep_nodes` cuts off, add that part as a new way with `tags_from`.
- The build stops with an error when an `id` is less than 9000000000000 or is used two times.

```yaml
new_ways:
  - id: 9000000000001
    nodes: [25185687, [7.4220000, 43.7405000], 280703049]
    tags:
      highway: residential
      name: "Rue Nouvelle"
      oneway: "yes"
```

## `turn_restrictions`: turn rules

Each rule forbids or orders one turn at a junction, in the driving network only. The tab **Turn** of the panel writes these rules.

| Key | Type | Required | What the build does |
|---|---|---|---|
| `from_way` | integer | Yes | The way before the turn. |
| `via_node` | integer | Yes | The node of the junction. |
| `to_way` | integer | Yes | The way after the turn. |
| `restriction` | text | No | `no_left_turn`, `no_right_turn`, `no_straight_on`, `no_u_turn`, `no_entry`, `no_exit`, `only_left_turn`, `only_right_turn`, `only_straight_on` or `only_u_turn`. The default is `no_u_turn`. |
| `note` | text | No | Free text. |

- The build finds each edge of `from_way` that ends at `via_node`, and each edge of `to_way` that starts there. Each pair is a row of `driving.turn_restrictions`, and `driving.edge_graph` follows the rule.
- The `restriction_id` of a rule is negative: -1 for the first rule of the list, -2 for the second, and so on. Thus it is not the same as the ID of an OSM relation.
- The build skips a rule with no `from_way`, `via_node` or `to_way`, or with a `restriction` value that is not in the list. It gives no error.

```yaml
turn_restrictions:
  - from_way: 167625756
    via_node: 25185687
    to_way: 1243224906
    restriction: no_left_turn
```

## `extra.tag_edits`: tag edits

Each edit sets and deletes tags of one way, node or relation. The tabs **Road**, **Building** and **Node** of the panel write these edits. The doors of a building are node edits of the tag `entrance`.

| Key | Type | Required | What the build does |
|---|---|---|---|
| `type` | `way`, `node` or `relation` | Yes | The type of the OSM object. |
| `id` | integer | Yes | The ID of the OSM object. |
| `set` | map of tag to text | No | Sets these tags. A tag that the object has gets the new value. |
| `delete` | list of tags | No | Deletes these tags. |
| `was` | map of tag to text or `null` | No | The values before your change (`null`: the object did not have the tag). The panel uses it to show "was" and "now". The build does not read it. |
| `note` | text | No | Free text. |

- The build sets the tags first, then it deletes the tags. A tag in `set` and in `delete` is deleted.
- An edit of a way changes the road networks and the raw OSM data of the area. Thus the base-map layers and the buildings also show the new tags.
- An edit of a node or a relation changes only the raw OSM data of the area. The road networks do not read it. The base-map layers, the building tables and the bus routes read it. To see these edits, build with **Layers** on.
- The panel writes `building:levels`, `height`, `roof:shape`, the colors and the materials of a building as edits of its way or relation.
- **Delete** on a building that is a relation deletes its tag `building`. **Delete** on a node deletes its tags `highway` and `crossing`.
- duckOSM accepts the key `extra`, but does not apply it to its raw tables or to its base-map layers.

```yaml
extra:
  tag_edits:
    - type: node
      id: 21911886
      set:
        crossing: marked
      was:
        crossing: zebra
```

## `extra.building_faces`: wall rules

Each rule gives one wall of a building a type, a door, or both. The list **Walls** of the tab **Building** writes these rules. The walls are in `main.building_faces`, so the rules need a build with **Layers** on.

| Key | Type | Required | What the build does |
|---|---|---|---|
| `building` | integer | Yes | The way or the relation of the building (`building_id`). |
| `from_node` | integer | Yes | The node at one end of the wall. |
| `to_node` | integer | Yes | The node at the other end of the wall. The two nodes can be in either order. |
| `type` | `front`, `back`, `side`, `party` or `court` | Yes | The type of the wall. |
| `door` | a word of letters, digits and `_` | No | The kind of door of the wall, for example `main` or `service`. The door belongs to the wall and has no place on it. |
| `note` | text | No | Free text. |

- The build writes the type of the rule to `face_type`, and keeps the type that the method found in `computed_type`. `edited` is true when the two types are not the same.
- The build writes `door` to the column `door`.
- The panel removes a rule that gives the computed type and no door.

```yaml
extra:
  building_faces:
    - building: 23715051
      from_node: 256791677
      to_node: 256791676
      type: front
      door: main
```

## The order of the fixes in the build

The build applies the rules in this order:

1. It reads the OSM data of the area.
2. On the raw OSM data of the area (only when the build keeps it, for example with **Layers** on): it removes the ways of `remove`, applies `keep_nodes` and `tags`, applies `extra.tag_edits` to the ways, nodes and relations, and adds `new_ways`.
3. On the ways of the networks: it removes the ways of `remove`, applies `keep_nodes` and `tags`, applies `extra.tag_edits` to the ways, and adds `new_ways`. `tags_from` copies the tags from before steps 2 and 3.
4. It adds the new nodes of `new_ways`.
5. For each network, after it selects the roads of the network: it applies `exclude_modes`, `oneway`, the lanes and `layer`. In the driving network, it adds `turn_restrictions`. After the network, it adds the arrows of `turn_lanes_forward` and `turn_lanes_backward` as tags of the way, so the next networks and the lane profile read them.
6. It makes the walls of the buildings with `extra.building_faces`.
7. It makes the lane profile.
8. The page makes the base-map layers, `main.building_info` and `main.building_entrances` from the raw OSM data of step 2.

The new ways come after `remove`, `keep_nodes`, `tags` and `extra.tag_edits`, so these keys do not act on a way of `new_ways`. The keys of step 5 also act on a new way.

## Many rules for one object

The build applies every rule in the order of the file. It does not join or refuse two rules for one road. Where two rules set the same thing, the later rule wins.

The panel writes one rule for each object. Thus two rules for one road come only from a file that you edit or join by hand. When you pick such an object in the panel, a box shows how many rules it has, and **Edit it** joins them into one (see [An object that is already in your changes](edit-osm.md#an-object-that-is-already-in-your-changes)).

| What the rules set | Two or more rules for one way |
|---|---|
| `remove: true` | If one rule removes the way, the build removes it first. The other rules for the way then do nothing. |
| `tags` | Each rule sets its tags in the order of the file. For the same key, the later rule wins. Different keys add up. |
| `extra.tag_edits` | They come after all the `tags` of `overrides`, so a tag edit wins over `tags` for the same key. Two tag edits act in the order of the file. |
| `keep_nodes` | They act in order. The second rule cuts what the first rule kept, and only when its two nodes are still on the way, in that order. |
| `oneway`, `lanes`, `lanes_forward`, `lanes_backward`, `layer` | They act for each network, in the order of the file. For the same key, the later rule wins. A key that the later rule does not have keeps the value of the earlier rule. |
| `exclude_modes` | If one rule removes the way from a network, the way is not in that network. |
| `new_ways` | Two new ways with the same `id` stop the build with an error. |
| `turn_restrictions` | Two rules for the same turn give two turn restrictions. |

An example: rule 1 has `lanes: 2` and `tags: {name: "A"}`, and rule 2 has `tags: {name: "B", surface: asphalt}`. The road gets 2 lanes, the name B and the surface asphalt.

## A rule for an object that is not in the area

One fixes file can hold the rules of many areas. A rule for an object that is not in the area does nothing, and the build gives no error. This is true for each kind of rule:

- A rule of `overrides` or `extra.tag_edits` for an object that the area does not have.
- A new way with an OSM node that the area does not have. The build does not add this way.
- A turn rule with no edge of `from_way` that ends at `via_node`, or no edge of `to_way` that starts there.
- A wall rule for a wall that the area does not have.

## A complete example

This file has each kind of rule, with real Monaco IDs.

```yaml
# The fixes of Monaco: one example of each kind of rule.
overrides:
  - osm_id: 93137596               # Boulevard du Larvotto
    lanes: 1
    note: "OSM has lanes=2. Street View shows one lane."
  - osm_id: 25103774               # Boulevard Louis II
    turn_lanes_forward: "left|through"
    layer: 0
  - osm_id: 167625756
    exclude_modes: [cycling]
  - osm_id: 155085119              # Avenue Hector Otto: keep the part up to node 280703049
    keep_nodes: [25200453, 280703049]
  - osm_id: 93091320               # a parking aisle that is not there
    remove: true

new_ways:
  - id: 9000000000000              # the part of Avenue Hector Otto that keep_nodes cut off
    tags_from: 155085119
    nodes: [280703049, 1780610255, 257076289, 1780610254, 1079750637, 257076290, 12020011640, 13299092407]
  - id: 9000000000001              # a road that OSM does not have
    nodes: [25185687, [7.4220000, 43.7405000], 280703049]
    tags:
      highway: residential
      name: "Rue Nouvelle"
      oneway: "yes"
    source: "survey 2026-11-05"

turn_restrictions:
  - from_way: 167625756
    via_node: 25185687
    to_way: 1243224906
    restriction: no_left_turn
    note: "sign at the junction"

extra:
  tag_edits:
    - type: way                    # a building
      id: 23715051
      set:
        building:levels: "3"
        roof:shape: flat
      was:
        building:levels: "2"
        roof:shape: null
    - type: node                   # a crossing
      id: 21911886
      set:
        crossing: marked
      delete: [crossing_ref]
      was:
        crossing: zebra
    - type: relation               # a building that is a multipolygon relation
      id: 393481
      set:
        name: "Lycée Albert Ier"
      note: "the name on the gate"
  building_faces:
    - building: 23715051
      from_node: 256791677
      to_node: 256791676
      type: front
      door: main
```

A build of Monaco with this file and **Layers** on gives these results:

- `driving.turn_restrictions` has a row with `restriction_id` -1.
- `driving.edges` has the new ways 9000000000000 and 9000000000001, and no edge of way 93091320.
- `cycling.edges` has no edge of way 167625756.
- The wall 256791677 to 256791676 of building 23715051 has `face_type` `front`, `computed_type` `side`, `edited` true and `door` `main`.

## Next

[Step 7](edit-osm.md) tells you how to make the rules in the panel. [The tables](tables.md) tells you where the results are.
