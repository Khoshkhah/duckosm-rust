# Wall types: a better rule for front, back and side

Status: built, 2026-11-04 (`wall_types` in `crates/duckosm-core/src/building_faces.rs`). One change from the first design: no `type_confidence` column; the reason `corner` and the existing `type_reason` carry the information. The method that exists today is in [osm-editing.md](osm-editing.md) (section M4) and in `crates/duckosm-core/src/building_faces.rs`.

The wall types are `front`, `back`, `side`, `party` and `court`. This design changes the rules for `front`, `back` and `side` only. A wall with a shared pair of nodes stays `party`. A wall of an inner ring stays `court`. A user rule (an edit) still wins over the computed type.

## What is wrong today

Measured on Monaco with the build of this branch (10,874 walls, 1,262 buildings; command at the end of this document):

| Type | Walls | Share |
| --- | --- | --- |
| front | 5,384 | 50% |
| side | 2,952 | 27% |
| party | 1,130 | 10% |
| back | 1,044 | 10% |
| court | 364 | 3% |

- Half of all walls are `front`. 277 buildings have 6 or more front walls.
- The reason is the second-front rule. A wall is also a front wall when it faces a street with a cosine of at least 0.65 (`CORNER_ALIGN`) and the street is at most 30 m away (`CORNER_DIST_M`). In a dense city almost every outer wall is within 30 m of some street, so almost every wall passes.
- 713 buildings (56%) have no `back` wall. A back wall must point away from the front wall (`BACK_DOT`) and must face no street at all (`BACK_ALIGN`). In a dense city every wall faces some street, so the back wall is rare.
- 191 buildings have two or more back walls.
- 5 buildings have no front wall.
- Party walls are not a problem on Monaco: only 39 walls touch a neighbour building without being `party` (0.4%). This design does not change the party rule.

The numbers show a pattern. They do not show which wall is right, because there is no reference data. Check the result of the new rules by eye (see "Checks").

## Idea

A front wall is the wall where a person reaches the building from a street. The rule must ask "is this wall as much a front as the main front wall is?", not "is a street somewhere near?". The test must adapt to the building: the same rule must work in a village and in a dense block.

## Rules

The rules run for one building, after the main front wall is chosen. The choice of the main front wall does not change: entrance, then the address street, then the best street score, then the inferred street.

### 1. Join short walls into runs

A run is a chain of consecutive walls of one ring that a person sees as one wall.

1. Walk the ring. A wall joins the run before it when the turn angle between the two walls is less than 25 degrees and neither wall is `party`.
2. A wall shorter than 3 m (a chamfer, a bay, a step) joins the longer neighbour, whatever the angle.
3. The run gets one type. Its street and its distance are the street and the distance of its longest wall.

This step stops a curved facade from getting a mix of `front`, `side` and `back`.

### 2. Decide the extra front runs

A run other than the main front run is also `front` only when all of these are true:

1. **Different street, or same facade.** The run faces another street than the main front run (a different name; when a name is missing, a different `osm_id`), or its normal is within 25 degrees of the normal of the main front run. A run that faces the same street at a clearly different angle is not a front.
2. **As near as the main front.** `dist <= front_dist + 8 m` and `dist <= 20 m`. The first limit follows the building, and the second keeps the old 30 m from letting every wall pass.
3. **A street of about the same class.** The class weight of the street is at least 0.6 times the class weight of the main front street (primary 1.3, secondary 1.25, tertiary 1.15, service 0.7, others 1.0). A service lane does not give a front to a building that has a primary road on the other side. An entrance on the run or the street of the `addr:street` tag overrides this test.
4. **A good view.** `align >= 0.65` (as today), and the line of sight to the street is free (as today).

An extra front run that passes all four tests gets the reason `corner`.

Keep at most the two best extra front runs (by street score). Every other run that passed becomes `side`.

### 3. Decide the back runs

A run is `back` when it is not `front`, not `party` and not `court`, and both of these are true:

1. It points away from the main front run: `dot(normal, front_normal) <= -0.4` (as today).
2. It has no street that it faces closely: `align <= 0.1` (as today), **or** the nearest street that it faces is farther than 25 m.

A building with no run that passes still has no back wall. This is correct for a building that stands in a row between two streets.

### 4. The rest is `side`

Every other run is `side`.

### 5. A short run takes the type of its neighbour

A run shorter than 3 m in total (a chamfer, a step) has the type and the reason of its longer neighbour run, unless the run is the main front, has an entrance, or is `party`.

## What does not change

- The key of a wall, `(building id, node, node)`.
- The rows of `main.building_faces` for `party` and `court` walls.
- The order of the rows. The output is the same on each run. A tie goes to the lower `edge_id`.
- The contract with duckOSM. `main.building_faces` is not in duckOSM, so the golden files do not cover it.

## Checks

1. The unit tests in `building_faces.rs` stay green. `a_corner_building_has_two_fronts` must still give two fronts (two different streets at a corner).
2. New unit tests, one for each rule: a facade of 6 short walls is one run; a wall that faces the same street at 60 degrees is `side`; a lane next to a primary road gives no front; a back wall with a street 40 m away.
3. Monaco numbers before and after, in the same table as above. Targets: front walls under 35% of all walls; no building with 6 or more front walls unless it has 3 streets or more; fewer than 400 buildings with no back wall.
4. A sheet of 12 Monaco buildings, before and after, drawn on the map. Kaveh looks at the sheet and decides. A number is a hint, not a proof.
5. Tartu, only if Kaveh asks for a second city.
6. `docs/osm-editing.md`, `docs/manual/edit-osm.md` (the list of rules) and `CHANGELOG.md` change in the same pull request.

## Command for the numbers

```bash
CARGO_BUILD_JOBS=4 cargo build --release --no-default-features -p duckosm-cli
target/release/duckosm-rust tests/data/monaco.osm.pbf -o out --boundary tests/data/monaco.geojson --building-faces -m driving,walking -f geoparquet
```

Then count the rows of `out/building_faces_main.parquet` by `face_type` and `type_reason`.

## Result on Monaco

Same command and data as the table at the top.

| | Before | After |
| --- | --- | --- |
| front walls | 5,384 (50%) | 3,134 (29%) |
| side walls | 2,952 | 4,632 |
| back walls | 1,044 | 1,614 |
| buildings with no back wall | 713 | 509 |
| buildings with 6 or more front walls | 277 | 98 |
| buildings with two or more back walls | 191 | 316 |

The target "fewer than 400 buildings with no back wall" is not met (509). The count of back walls is by wall, not by run, so a long back facade with many segments counts many times.

## Open questions

1. Is the limit of two extra front runs right? A building on a block corner with three streets has three real fronts.
