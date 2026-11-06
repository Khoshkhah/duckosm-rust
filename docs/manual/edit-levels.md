# Step 8: Edit levels

Use card 8 when two roads cross or meet on the map and the wrong road is on top. The card opens the level editor in a panel.

![The level editor: two roads are picked, and the apply bar has one change](../img/dashboard/36-levels-editor.png)

## What a level is

Each edge has a level for its outline and a level for its fill. A bridge has a higher level than the road under it. The map draws the lowest level first. The build finds the levels from the OSM tags and the road class. [levels.md](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/levels.md) has the method.

## Pick two roads

1. Click a road on the map. It is **road 1** (red). You can also type an `edge_id` or an `edge_ref` in **Find a road**.
2. Click a second road. It is **road 2** (blue). The panel shows the pairs of the two roads that the build found.

## Add a rule

1. Choose the kind of rule:

    | Rule | What it says |
    |---|---|
    | **Order** | Which fill is on top where the two roads meet. |
    | **Stack** | One road is over the other. You pick the parts of its outline: the whole road, the start head, the main part or the end head. |
    | **Meet** | The two roads join end to end. You pick the end of each road: **start** or **end**. No road is on top. |

2. Press **Add to the list**.

The page tells you if the rule is already in the list, or if it makes a loop (A over B, B over C and C over A).

To replace a stack that the build found, **Switch off** its rows and then add your own parts.

## Apply the changes

Use the apply bar at the bottom of the panel:

| Button | What it does |
|---|---|
| **Apply and solve** | Solves all the changes and draws the changed roads again. If the solver refuses them, the page saves nothing. |
| **Discard** | Removes the changes and goes back to the steps. |
| **Download edits.csv** | Saves your rules as a file. |

The tab **History** shows your changes. The tab **Issues** shows the crossings that the solver did not keep.

## Keep your changes

- If the area is saved, the browser keeps your rules for the next visit.
- If the area is not saved, the rules go away when you close the page. Press **Download edits.csv** to keep them.

## Next

Go to [step 9](edit-design.md) to set the look of the map, or [step 10](export.md) to export.
