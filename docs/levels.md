# Design: the drawing levels in Rust

Status: design, 2026-10-22, for Kaveh's review. No code yet. Kaveh's decision: "we can have simple tag version as
default but we should have real optimization version like what we have already for python version too."

This document is about the table `visualization.edge_levels` (and `edge_levels_meta`), group 2 of
[tables.md](tables.md). It ports roadstyle's solver, `compute_levels(method="solve")`, to Rust, next to the tags
rule that the page has today.

## The short version

- There are two methods. `tags` is the default: the rule that the page has today in SQL (`TAG_LEVELS` in
  `www/map/roads_sql.js`), written again in Rust. `solve` is roadstyle's optimization.
- roadstyle solves in two ways: a minimum-cost flow (OR-tools) when all the rules can hold, and HiGHS (a MILP in
  four stages) when some rules must be broken. Monaco needs the HiGHS way: 16 order wishes cannot hold.
- A test on Monaco (section "The finding") shows that each HiGHS stage is a linear program with a whole-number
  answer. Thus a minimum-cost flow can solve each stage. The Rust port is one algorithm in pure Rust, for all the
  cases: no OR-tools, no HiGHS, no WebAssembly build of a C++ solver.
- The code goes in `duckosm-core` (a module `levels`). The CLI, the Python package and the page all get it.
- On Tartu (flow only), the numbers can be equal to roadstyle's, row for row. On Monaco (stages), the values of
  the four stages can be equal, but some edges can get other numbers: many answers have the same best value, and
  HiGHS and the flow choose different ones. Kaveh decides if that is sufficient (see "Questions for Kaveh").

## What the levels are

A road is drawn in two layers: the casing (the dark edge line) and the fill (the color on top of it). Each edge
gets four numbers: `casing_start`, `casing_level`, `casing_end` (the casing in three parts: a head at the start,
the main part, a head at the end) and `fill_level`. The map paints number by number, the lowest first. At each
number it paints all the casings, then all the fills. 0 is the ground.

With these numbers, a bridge covers the road under it, a tunnel goes under the road over it, and two roads that
meet join with no casing line across the joint. duckOSM's table also has `head_start_m`, `head_end_m` (the length
of each head as drawn, 5 m) and `cap_start`, `cap_end` (the shape of the line end: `round`, `square` or `flat`).

## What the solver does

The source is `roadstyle/src/roadstyle/levels.py` (816 lines). duckOSM's `duckosm levels` calls it through
`roadstyle.level_area` (`make_area`, then `solve_area`) with the default parameters. The steps:

1. **The edges.** All the edges of all modes, `edges` and `private_edges`, one row for each `edge_id`
   (duckOSM's `load_roads`). Monaco: 13,298 edges. Tartu: 63,965.
2. **The roads.** Edges with the same line (the same points, in one direction or the other) and the same
   `highway`, `tunnel`, `bridge` and `layer` are one road. The two directions of a street are one road. Monaco:
   6,830 roads. Tartu: 32,741.
3. **The band of each road.** A non-zero `layer`, else 1 for a bridge, -1 for a tunnel, else 0.
4. **The priority of each road.** The class order of the map (roadstyle's `class_order` of `highway`), plus 300
   for a roundabout, 200 for a tunnel, 100 for a bridge.
5. **The relations** (in metres, in the UTM zone of the area):
   - `meet`: two roads have an end at the same node.
   - `stack`: two roads of different bands come within 10 m of each other. A pair that meets is a stack only if
     the roads come within 10 m of each other at a distance of more than 10 m from the nodes they share. The road
     of the higher band is the upper road.
   - `order`: two roads meet and have different priorities (and the same band, or they only meet). The road with
     the higher priority wants its fill on top. This is a wish, not a rule.
6. **The casing parts.** Each road has a start head and an end head, 5 m long, and the main part between them. A
   stack gets one row for each part of the upper road that crosses the lower road. A head that meets the lower
   road (or a road that meets the lower road) is not lifted.
7. **The numbers.** Each road gets a fill number `b` and three casing numbers `a`. The rules:
   - H1: each casing part is not above the fill of its road (`a <= b`).
   - H2: where two roads meet, the head of each one is not above the fill of the other.
   - H3 (stack): the lifted casing part of the upper road is above the fill of the lower road (`a_upper >= b_lower + 1`).
   - H4 (order wish): the fill of the higher road is above the fill of the lower road (`b_high >= b_low + 1`).

   Each rule has the form `x_i - x_j <= w`, with `w` 0 or -1. The solver minimizes, in this sequence:
   1. the stack rules that it must break,
   2. the order wishes that it must break,
   3. the "near" rules (off in duckOSM),
   4. the cost: the sum of `b - a` over all the casing parts, plus a large weight on the span of the numbers.

   Stage 0: if all the rules can hold, one minimum-cost flow (OR-tools) solves the problem. The numbers are then
   the shortest distances in the flow's residual graph. Else, HiGHS solves the stages 1 to 4 as MILPs. Each stage
   keeps the best value of the stage before it.
8. **The result.** The casing number that most edges have becomes 0 (the ground). The numbers are then made
   consecutive (negative to -1, -2, ..., positive to 1, 2, ...). Each edge gets its road's numbers. An edge that runs
   against its road gets the two heads in the other sequence. The heads are 5 m. A cap is `round`, but `square` at
   the dead end of a two-way road.

duckOSM writes `edge_levels_meta` with `source` = `area` and the path of the level area folder. The level editor
of roadstyle reads the folder and changes the numbers with your edits (`level_edits`, `level_heads`, `level_caps`).

## The finding: the stages need no MILP

roadstyle uses a MILP for the stages because an LP gave fractional numbers ("a staged problem has fractional
corners", in `_solve_intervals`). I did a test on Monaco: the same stages as an LP (no integer variables), with
the row "keep the stage before" at its exact value, not at the value plus roadstyle's tolerance of `1e-7`:

| Monaco, no edits | Stage 1 | Stage 2 | Stage 4 | Fractional numbers |
|---|---|---|---|---|
| MILP (roadstyle) | 0 | 37 | 6,562,870 | 0 |
| LP, with the tolerance `1e-7` | 0 | 37 | 6,562,866.97 | 13,796 |
| LP, exact | 0 | 37 | 6,562,870 | 0 |

The tolerance is the cause of the fractions, not the problem. This is also the theory. Every rule is
`x_i - x_j <= w` (a network matrix). A broken rule adds one slack variable to its row only. The best answers of
a stage are the answers that agree with the stage's flow (complementary slackness):

- A rule with flow on it holds as an equality.
- A rule of the stage with flow below its capacity must hold (its slack is 0).
- A broken rule (flow at its capacity) holds in the other direction (`x_i - x_j >= w`).

These are again rules of the form `x_i - x_j <= w`. Thus each stage is a minimum-cost flow on the rules that the
stage before leaves, and its answer is whole numbers. The script of the test is `tools/levels_lp_check.py`.
Edits do not change this. With Kaveh's 58 edits (`monaco.levels/edits.csv`), the exact LP and the MILP also
agree at each stage: 0, 46 and 7,382,499, with no fractional number.

## The Rust design

### Where it runs

A module `crates/duckosm-core/src/levels/` (pure Rust, no new dependency):

| File | What it does | Lines (estimate) |
|---|---|---|
| `mod.rs` | `levels(net, method) -> EdgeLevels`: the edges of all modes, the roads, the result rows and the meta row | 150 |
| `tags.rs` | the tags rule (the same SQL as `TAG_LEVELS`, in Rust) | 50 |
| `input.rs` | the roads, the bands, the priorities, the relations and the casing parts (roadstyle's `level_input`) | 450 |
| `flow.rs` | a minimum-cost flow: a network simplex (as LEMON's), with whole numbers (`i64`) | 350 |
| `solve.rs` | stage 0, the stages 1 to 4, the shortest distances, the ground and the compaction | 250 |

`duckosm-build` writes the two tables in the `.duckdb` file and in the GeoParquet folder
(`visualization/edge_levels.parquet`, `visualization/edge_levels_meta.parquet`), as it writes the other
tables. The page gets them in its zip and in `load.sql`.

The geometry of `input.rs` must give the same pairs as shapely and GEOS. Thus it copies their rules, not only
their idea:

- The metres: the UTM zone of the center of the area's box (as pyproj's `estimate_utm_crs` for Monaco and
  Tartu), and the transverse Mercator formulas of PROJ (Poder/Engsager, 6th order).
- The roads near each other: an R-tree (`rstar`, already in `duckosm-core`) and the exact distance between two
  lines.
- The circle around a node (GEOS `buffer`): a polygon of 32 sides, with the same vertices as GEOS. A real
  circle gives other answers at the limit of 10 m.
- The part of a line out of the circles, the crossing of a part and a road (`_crosses`, with circles of 0.5 m
  at the ends), and the cut of a line at 5 m (`substring`, already in `geom.rs`).

The flow finds the best value of each stage. For the numbers, the solver uses roadstyle's rule of stage 0 at all
stages: the shortest distances from an extra node, shifted to start at 0. There is only one such answer for a
given set of rules. Thus the result does not change with the flow algorithm or the sequence of the edges.

After each solve, the solver checks its answer: every hard rule holds, and the flow and the numbers agree
(complementary slackness). This is a proof that the answer is the best. A failed check is an error, not a
warning.

### The options

- CLI: `--levels tags|solve|none`. The default is `tags`.
- A duckOSM config: `options.levels: true` gives `solve` (duckOSM solves there too). `false`, or no option, gives
  `tags`.
- Python package: the same option as the CLI.
- The page: under **Options**, "Drawing order: from the tags | solved". The default is "from the tags". The map
  then reads `visualization.edge_levels` and does not compute `TAG_LEVELS` again.

### What the meta row says

| Column | `tags` | `solve` |
|---|---|---|
| `source` | `tags` | `solve` |
| `area` | NULL | NULL |
| `n_edges`, `edge_hash` | as roadstyle (`sha256` of the sorted `edge_id` values, 32 characters) | the same |
| `roadstyle_version` | the roadstyle version that the port follows (0.24.2) | the same |
| `created` | the time of the build | the same |

The page's check (`checkLevels` in `roads_sql.js`) accepts `area` only. It must also accept `tags` and
`solve`. roadstyle's level editor (`load_area_levels`) also accepts `area` only. To edit the levels of a Rust
build, run `duckosm levels` on the file: it makes a level area and replaces the two tables.

### Not in the port

These parts of roadstyle are for the level editor or are off in duckOSM. Each one can come later, when a user
needs it:

- the edits, heads and caps of the editor (`level_edits`, `level_heads`, `level_caps`);
- `auto_ends` (heads and caps from the geometry; duckOSM uses the fixed 5 m and the round caps);
- `near_rules`, `band_col` and an `order` other than `priority`;
- the local solve of the editor (`solve_local`, `fixed`);
- the time limit: the flow has no time limit, because it always ends.

## The equality check

The golden `monaco.duckdb` of duckOSM is not the correct reference: its levels contain Kaveh's 58 edits and a
local solve of the editor. Tartu's golden has no levels. Thus the reference is a new solve by roadstyle, with
no edits:

- `tools/make_golden_levels.py` (duckOSM's virtual environment, roadstyle 0.24.2): `load_roads`, `level_input`
  and `solve_levels` with the default parameters. It writes `tests/data/monaco_levels.tsv` (the 13,298 rows of
  `edge_levels`) and `tests/data/monaco_level_pairs.tsv` (the roads and the pairs).
- For Tartu, the same script writes the files to a folder out of the repository, and
  `tools/compare_with_duckosm.py` compares them (as for the other tables of Tartu).

The tests:

1. **The input.** The roads (their edges, band and priority) and the pairs (`meet`, `stack` with its part,
   `order`) are equal as sets. Monaco: 14,715 meets, 485 stacks, 6,276 orders. Tartu: 72,176, 190 and 26,051.
2. **The numbers, Tartu** (flow only): the eight columns of each edge are equal.
3. **The numbers, Monaco** (stages): the values of the stages are equal (0 broken stacks, 37 for the order
   wishes, 6,562,870 for the cost), and every hard rule holds. The test counts the edges whose numbers are not
   equal to roadstyle's and prints them. It does not fail on them (see question 1).
4. **The tags rule.** The Rust `tags` result is equal to the result of `TAG_LEVELS` in duckdb on the same
   edges, and to roadstyle's `compute_levels(method="tags")`.
5. **Small cases.** A bridge over a road, a tunnel under a road, a ramp, a loop of wishes that cannot all hold,
   and an empty area, each with the numbers written by hand.

## Time and memory

roadstyle today (this machine, 2026-10-22, the whole Python process):

| Area | Edges | Roads | `level_input` | Solve | Way | Memory (peak) |
|---|---|---|---|---|---|---|
| Monaco | 13,298 | 6,830 | 2.3 s | 14.3 s | stages (4 HiGHS solves) | 630 MB |
| Tartu | 63,965 | 32,741 | 11.1 s | 9.7 s | flow (OR-tools, then a slow relaxation in numpy) | 670 MB |

The Rust problem for Monaco: 27,322 numbers and about 111,000 rules (55,000 of them keep the numbers between
the lowest and the highest number, for the span). A network
simplex on a graph of this size takes less than 1 s. My targets for step 2, to measure and to write here:

- Monaco: less than 1 s for input and solve, native. Tartu: less than 3 s.
- In the page (WebAssembly, one thread): less than three times the native time.
- Memory: less than 50 MB more than the build without levels.
- The `tags` rule: less than 50 ms on Tartu.

## Risks

- **Points at the limit.** The pairs depend on distances of 10 m and 0.5 m. A small difference in the projection
  or in the circles can add or remove a pair. The input test (test 1) finds such a difference first, before the
  numbers.
- **The UTM zone.** pyproj chooses the zone from its database. The center of the box gives the same zone for
  Monaco and Tartu. An area across two zones can get another zone. That changes the metres a little, not the
  rules.
- **The network simplex.** A simplex can cycle on degenerate pivots. LEMON's rules (a strongly feasible tree)
  prevent it. The check of each answer (complementary slackness) finds an error in the algorithm.
- **Monaco's numbers.** The flow and HiGHS can choose different answers with the same best value (question 1).

## The steps after the review

1. `tools/make_golden_levels.py` and the reference files (Monaco in `tests/data`, Tartu out of the repository).
2. `tags.rs`, its test, and the tables in the `.duckdb` file, the Parquet folder and the page (the default method).
3. `input.rs`, and test 1 on Monaco and Tartu.
4. `flow.rs`, `solve.rs`, and the tests 2, 3 and 5.
5. The option `--levels` in the CLI and the config, the Python package, and the option in the page.
6. The times and the memory in this document. Update `docs/tables.md` and `docs/browser.md`.

## Questions for Kaveh

1. **Monaco's numbers.** On the stages, the Rust port gets the same best values as roadstyle, but some edges can
   get other numbers (the same quality, another choice). Is that sufficient? If you want equal rows on Monaco too,
   I can change roadstyle to solve the stages with the same flow (in Python, with OR-tools). Then both programs make
   the same choice, and roadstyle also does not need HiGHS. Monaco's solve then takes less than 1 s, not 14 s.
2. **The meta row.** Are `source` = `tags` and `solve` (and `area` = NULL) correct? The map of roadstyle and of
   mapstyle must then accept them (the page's copy of `roads_sql.js` changes in this work).
3. **The edits.** The port has no edits (the editor stays in Python, through `duckosm levels`). Is that correct
   for now?
4. **The config.** Does `options.levels: true` give `solve`?
