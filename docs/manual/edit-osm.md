# Step 7: Edit OSM data

Card 7 opens the panel **Edit OSM data**. Use it to find and fix errors in the OSM data of your area. A fix is a rule that you add to a list. A rule changes nothing until you build again. [The editing cycle](cycle.md) shows where this step is.

![Card 7: Edit OSM data, with the number of fixes under its title](../img/dashboard/16-fix-card.png)

The card is gray until a build has made the tables that the panel needs. Build with **Layers** on to get walls and doors.

## The panel

![The panel with the Road tab: a road is picked on the map](../img/dashboard/17-fix-road.png)

The panel has a header, six tabs and a bar of buttons at the bottom of each tab.

| Part | What it does |
|---|---|
| **Steps** (top left) | Closes the panel and shows the steps. Your picks go away. They come back when you open the panel again. |
| **Hide panel** (top right) | Gives the map the whole width. The button at the corner of the map shows the panel again. |
| **Add to changes** | Keeps your edits in the list of changes. Until you press it, the edit is a draft. |
| **Reset form** | Drops the draft. |
| **Remove from changes** | Takes the rule of this object out of the list. |
| **Unselect** | Takes the picked object out of the tab. |
| **Review changes** | Opens the tab **Changes**. |

A field that you change gets an amber mark and a ↺ button. Press ↺ to take the change back.

![The panel hidden: the map has the whole width](../img/dashboard/23-fix-panel-hidden.png)

## Road

Click a road on the map, or type its way ID and press **Load**. The form shows the data of the road in groups: Basics, Lanes and speed, Sidewalk, cycleway and crossing, Surface and access, and Level.

- **Modes.** Remove the road from one network. For example, remove it from walking.
- **Other tags.** Add or delete any tag.
- **Delete.** Remove the road from the data.

The tags `highway`, `access`, `foot`, `bicycle`, `oneway`, `maxspeed` and `lanes` decide in which network the road is, and its speed and lanes. [The roads](roads.md) gives the rules.

## Building

![The Building tab with numbered walls on the map](../img/dashboard/18-fix-building.png)

Click a building. To see the walls of all buildings in view, turn on **Show the walls of all buildings in view** (zoom 16 or more). The form has the levels, the height, the roof shape, the roof color and the materials. Below the form are the walls and the doors.

### Walls

The page finds the walls of the building from its outline. It gives each wall a type, and the map draws the wall in the color of its type. The number of the wall (`#1`, `#2`, ...) shows on the map and in the list.

| Type | Color | Meaning |
|---|---|---|
| **front** | Green | The wall faces a street. |
| **back** | Red | The wall faces away from the street. |
| **side** | Gray | The wall is between the front and the back. |
| **party wall** | Purple | Two buildings share the wall. |
| **courtyard wall** | Teal | The wall is part of an inner ring. |

Each row of the list shows the length of the wall, the street that it faces, and a short note when the type is a guess. Click a row, or click a wall on the map, to select it. **Previous** and **Next** go from wall to wall.

You can change the type of a wall. You can also give it a **Door** (main, service and so on). The door belongs to the wall and has no place on it. Both changes wait for **Add to changes**.

### Doors

The list **Doors** has the doors that OSM has on the outline (nodes with `entrance`). You can change the kind of each door.

A building that is a multipolygon relation has walls for its outer ring and for each courtyard.

### How the page chooses the type of a wall

The page tests the rules in this order. The first rule that fits gives the type.

1. A wall with an OSM entrance node is a front wall.
2. The street that the `addr:street` tag names is preferred.
3. A wall faces a street that it can see. A line from one of three points of the wall must reach the street with no wall in the way. A street of a higher class wins.
4. A building that sees no street gets the wall that faces the nearest street within 150 m. The note says "guess".
5. Walls that turn by less than 25 degrees are one run and have one type. A wall shorter than 3 m has the type of its longer neighbor.
6. A second wall is also a front wall when it faces another street, or the same facade. The street must be at most 20 m away, and at most 8 m farther than the main front street. A building has two front runs at most.
7. A wall that points away from the front wall and faces no street within 25 m is a back wall. A wall that two buildings share is a party wall.

Check the walls that say "guess" or "no street seen". [wall-types.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/wall-types.md) has the method.

## Node

![The Node tab: a junction with the kind Traffic signals](../img/dashboard/19-fix-node.png)

A node is one point of OSM. Here it is a traffic signal, a crossing, a stop sign, a give-way sign, a bus stop or a junction of roads. The map shows signals and crossings as dots from zoom 14, and junctions (gray dots) from zoom 16. Click a dot, or type the node ID.

The field **Kind** offers only the kinds that the node can have. The reason shows under the field:

- A node must be on a road of the driving network.
- A traffic signal, a stop sign and a give-way sign need a junction of 3 roads or more.
- A crossing needs a road of the class residential, service, tertiary, secondary or primary.
- A motorway or a trunk road takes none of them.

## Turn

![The Turn tab: junctions, roads that leave, and the rules](../img/dashboard/20-fix-turn.png)

A turn rule says that a driver cannot make a turn at a junction, or must make it. The rules are for the driving network.

1. Click the road that the turn starts on, or type its way ID. Press **Find turns**.
2. The dropdown list **Junction at the end of the road** has each junction and how many roads leave it. The first one is the junction with the most roads that leave it. Pick another one in the list to see its roads.
3. The map shows the start road (blue), the junction (a ring) and the roads that leave it (green). Point at a row to outline its road.
4. For each road that leaves, choose **Allowed**, **No** or **Only**. The page finds the way of the turn (left, right, straight on or U-turn).
5. Press **Add to changes**. All your rules are added at once.

The list **Roads that arrive at this junction** has the roads that you can use as the start road.

## New road

![The New road tab](../img/dashboard/21-fix-new-road.png)

Draw a road that OSM does not have. Click points on the map. A click near a junction joins it. Set the kind, the name, the one-way rule and more. Then finish. The road is a rule [`new_ways`](fixes-file.md#new_ways-new-roads) in the fixes file. You can edit a new road again from the tab **Changes**.

## Changes

![The Changes tab: the list of all the rules](../img/dashboard/22-fix-changes.png)

The list has all your rules: roads, buildings, walls, nodes, other objects, turn rules and new roads. The tab shows the number of changes.

| Button | What it does |
|---|---|
| An item | Shows the item in its tab. |
| × | Takes the item out. |
| **Undo**, **Redo** | Go back and forward in your changes. |
| **Download** | Writes the fixes file. |
| **Clear all** | Removes all rules. |
| **Build again** | Builds again with the rules. The button shows the number of changes. |

## Guards

A choice in one field can close another field, or shorten its list. The reason shows under the field. **Add to changes** refuses a value that a guard closed. Some examples:

| Choice | Effect |
|---|---|
| One-way road: yes | The lanes for each direction are closed. |
| Bridge: yes | The tunnel field is closed. The reverse is also true. |
| Class motorway or trunk | No sidewalk, no cycleway and no crossing. The surface is paved. |
| Class footway, path or steps | No lanes, no speed limit and no sidewalk. |
| Roof shape: flat | The roof levels are closed. |
| Kind of node: not a crossing or a signal | Crossing, kerb and tactile paving are closed. |
| Kind of node: traffic signals | Only the crossing value `traffic_signals` stays. |

## Where your changes go

- The page keeps the rules in your browser, for the area.
- The tab **Changes** and the button **.yaml** of [step 5](result.md) download them as a fixes file. [The fixes file (YAML)](fixes-file.md) explains each key of it.
- The next build applies the rules to the OSM data, before it makes the networks. So the tables, the map and the exports have your fixes.
- [The fixes file](fixes-file.md) gives the format of the file, each key, and the order in which the build applies the rules.
- The fixes file is also the input of duckOSM. [osm-editing.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/osm-editing.md) has the design.

## Next

Press **Build again** in the tab **Changes**. Then check the map. When the data is right, go to [step 8](edit-levels.md).
