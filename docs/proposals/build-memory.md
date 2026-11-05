# Proposal: less memory in the browser build

Status: proposal for Kaveh, 2026-11-04. Nothing is built. This note is the build part that [the disk store](disk-store.md) leaves open: the memory of the build module in the browser (the step that reads the `.osm.pbf` file and makes the networks).

## Summary

The build runs in one WebAssembly module. A 32-bit module can use at most 4 GB, and a build that goes over this stops with `RuntimeError: unreachable`.

The old numbers (2026-10-21 and 2026-10-22) said that Kentucky (2,114,699 driving edges) uses 2,053 MiB, and that Iran fails at 3,816 MiB. **I measured again on 2026-11-04 with the build of 2026-10-29, and the build now needs much more memory:** Kentucky driving alone uses **3,422 MiB**, which is 84% of the limit, and Estonia with three networks uses 2,305 MiB (it was 710 MiB for driving). The newer steps (the edge graph, the restrictions, the lane profile, the area tables) cost memory. Kentucky with three networks will not fit: walking alone adds more than 1 GB in Estonia (my estimate for Kentucky, not measured).

**Two rounds of savings are done and measured** (below, "A first round of savings" and "A second round of savings"). The peak of the build fell by 38% in Estonia walking (1,532 to 923 MiB) and by 41% in Kentucky driving (3,205 to 1,882 MiB), with no change of the output.

The proposal has three levels, from cheap to large:

1. **Measure first, and fail with a clear message.** A memory probe for each step, a re-measure of the largest known areas, and a message before the module runs out of memory.
2. **Use less memory for each edge,** with no change of the output. Perhaps 1.3 to 2 times more edges (my estimate).
3. **Remove the limit by design,** with an out-of-core build (the data on disk, read in blocks of 1 MB) or with 64-bit WebAssembly. Choose between them only after level 2.

The output must stay equal to duckOSM 0.6.0 in every level.

## What is measured today

The page shows the memory after each step ("Time and memory of each step"). I read the same log in Node with the build of 2026-10-29 (`crates/duckosm-wasm/www/pkg`), with the default options. The memory of a WebAssembly module only grows, so each number is the peak until then. All numbers are MiB. The runner is `crates/duckosm-wasm/www/run_node.mjs` with the step log printed.

**Large areas** (measured on 2026-11-04 with Kaveh's word):

| Area (file) | Network | Edges | Peak | Per edge | Time |
|---|---|---|---|---|---|
| Tartu (cut) | driving, walking, cycling | 28,340 + 60,412 + 59,176 | 127 | | 1.2 s |
| Estonia (121 MB) | driving | 769,662 | 1,045 | 1.39 KiB | 16.8 s |
| Estonia | walking | 1,391,192 | 1,723 | 1.27 KiB | 25.4 s |
| Estonia | driving, walking, cycling | 769,662 + 1,391,192 + 1,359,514 | 2,305 | | 48.8 s |
| Kentucky (148 MB) | driving | 2,114,699 | **3,422** | 1.66 KiB | 61.4 s |
| Kentucky | walking | not known | **failed with an error, not by memory** (see below) | | |

The steps of Kentucky driving: read the file +890 (890), driving network +2,208 (3,098), driving files +324 (3,422). For Estonia with three networks: read the file +379, driving network +570, walking network +894, cycling network +462.

Two cautions:

- The Node runner gives the whole file to the module as bytes. The page reads the file as a `Blob` in pieces, so the peak in the page is probably lower by about the size of the file (121 MB, 148 MB). I did not measure the page.
- The old numbers (Estonia 710 MiB, Kentucky 2,053 MiB) were for driving, before the newer steps. The build now uses 47% more for Estonia and 67% more for Kentucky.

**A small area, step by step** (Nacka, a 3.5 MB file, walking has 56,120 edges and 165,754 rows in `edge_graph`):

| Step | Walking only | Three networks |
|---|---|---|
| Read the file | +19 (19) | +19 (19) |
| Sidewalk rule | +0 | +0 |
| Driving network | | +18 (37) |
| Driving files | | +9 (46) |
| Walking network | +44 (63) | +28 (73) |
| Walking files | +26 (89) | +24 (97) |
| Cycling network | | +0 (97) |
| Cycling files | | +15 (112) |
| Later steps (area tables, levels, lane profile) | +0 | +0 |
| **Peak** | **89** | **112** |

Facts from the tables:

- **The peak is the largest network plus a part of the others,** not the sum. Estonia with three networks (2,305) is 34% more than walking alone (1,723). The memory of an earlier network is reused in part.
- **The cost is 1.3 to 1.7 KiB for each edge** in large areas, and about 1.6 KiB in Nacka. Driving in Kentucky is the highest (1.66 KiB). Walking has about 1.8 times more edges than driving for the same area.
- **4 GB holds about 2.4 to 3 million edges** of one network at this cost. Kentucky driving (2.1 million) is already near the limit. Iran (219 MB) does not fit. I did not run it.
- **Reading the file is a large part for big areas:** 379 of 1,045 MiB in Estonia driving (including the 121 MB of file bytes), and 890 of 3,422 MiB in Kentucky.
- **Walking alone in Nacka:** reading the file 21% of the peak, the network 49%, the files 29%.

**A finding that is not about memory.** The build of Kentucky walking stops with `duplicate (osm_id, source, target) after the splits: 1214406652 11251734036->11251734037`. The same error comes from the native CLI of release 0.3.0 (it used 2.8 GB before it stopped). So it is a fault of the build for this file, not of the browser. I did not investigate it.

Native numbers, from [design.md](../design.md), section 7 (2026-10-22): Kentucky has a heap peak of 2,145 MiB on one thread, and Iran has a heap peak of 5,222 MiB. So the native CLI also needs more than 4 GB for Iran, and a 64-bit module needs about the same.

## A first round of savings (2026-11-04)

I added a memory probe (`crates/duckosm-core/examples/mem_probe.rs` on the branch `claude/mem-probe`, commit `556c8d2`). It uses a counting allocator and prints the live bytes and the peak at the start of each numbered step of `build_network_with`, and what each part of the network holds. The numbers are the Rust heap of one process with one thread, not the WebAssembly memory. The data structures are the same, so the shares are probably the same. Estonia walking, before the fixes:

| Start of step | Live (MiB) | Peak since the step before (MiB) | What happens |
|---|---|---|---|
| 1 Cut the ways | 309 | 362 | |
| 2b Merge chains | 552 | 552 | |
| 3 Parallel arcs | 610 | 845 | **+235 transient** |
| 4 Antiparallel pairs | 568 | 794 | +226 transient |
| 5 Reverse edges | 639 | 752 | |
| 6 Edge ids | 816 | 1,038 | **+222: three blocks of edges at one time** |
| 8b Connect the path ends | 934 | 935 | |
| 8b2 | 1,152 | **1,342** | **The edge list doubled its capacity: +217 live, +407 at the peak** |
| 9b Edge graph | 925 | 1,193 | |
| 10 Component filter | 1,084 | 1,221 | |

Where the final memory is (Estonia walking, 1,394,642 edges): the edges 437 MiB (328 bytes for each edge, with a 160-byte `Edge`), the edge graph 159 MiB (120 bytes for each edge), the tables `ways` and `way_nodes` 79 MiB, the input 64 MiB and the coordinates 56 MiB.

Four changes, all in `duckosm-core` (commit `a4deb7f` on the same branch):

1. The edge list gave back its unused capacity after the connectors were added. Tartu walking had 9.7 MiB unused (22% of the live memory), because 640 pushes doubled a full vector of 160-byte edges.
2. The connect step reserves the room for its edges before it pushes them.
3. Step 5 makes the reverse edges into the vector of all edges, so there is no third block.
4. The edge graph counts its moves first, sorts in place and shrinks to fit.

Result (native heap, one thread, measured with the probe):

| Area and network | Live before | Live after | Peak before | Peak after |
|---|---|---|---|---|
| Tartu driving | 18.8 | 16.2 | 32.7 | 28.4 |
| Tartu walking | 43.6 | 31.2 | 71.5 | 55.8 |
| Estonia driving | 585 | 498 | 864 | 757 |
| Estonia walking | 1,045 | 813 | 1,532 | **1,221** |

Estonia walking peak is **20% lower**. The output is the same: the tests of `duckosm-core` pass (50 tests), and for Tartu and Estonia with three networks, 33 of the 35 Parquet files are byte equal to the files of release 0.3.0. The two others hold the build time (`visualization_metadata`, `edge_levels_meta`).

**What this does not show.** The WebAssembly memory in the page is not measured again. It needs a build of the module with the nightly toolchain, which is a heavy build, so I did not run it.

**What remains** (from the same profile, my estimates for the gain):

- The top peak is now in step 10 (the component filter, 1,221 MiB), then the graph step and the connect step (+200 MiB of temporary maps).
- Steps 2b, 3 and 4 each add about 225 MiB for a moment. The second round found the cause (below).
- The edge graph is 159 MiB in Estonia walking. Writing the rows in sorted order as they are made removes them from memory.
- An `Edge` has 160 bytes. Fields that are rarely set can move to a smaller part.
- The tables `ways` and `way_nodes` hold 79 MiB. They are off with `--no-ways-tables`.

## A second round of savings (2026-11-05)

The first round left two questions: why the live memory at the start of step 10 (1,084 MiB) was 270 MiB more than the finished network (813 MiB), and where the 225 MiB jumps of steps 2b, 3 and 4 come from. Both have the same cause, and a third one is in the turn restrictions.

| Change | File | What it removes |
|---|---|---|
| The maps `groups` (step 3) and `by_key` (step 4) and the set `seen` (step 6) end in a block or with `drop`. | `network.rs` | They stayed alive to the end of the build. Each map has one vector for each key, so they held about 190 MiB in Estonia walking for the whole build. |
| `gj`, `lj`, `raw_refs` and `used` are dropped after their last use. | `network.rs` | About 80 MiB in Estonia walking. |
| `keep_largest` returns the ids that it dropped. | `network.rs` | Two sets of all edge ids (step 10). |
| `WayEnds` keeps only the ways that a restriction relation names. The two edge maps keep only the via nodes of the rules. | `graph.rs` | The temporary data of the turn restrictions. Each question of the code asks only about those ways and nodes. +180 MiB in Estonia driving, and about +1.2 GB in Kentucky driving. |
| `edge_graph` finds the edges of a node in a sorted array (16 bytes for each edge), not in a hash map with one vector for each node (about 100 bytes). | `graph.rs` | About 20 MiB in Estonia driving. |

Peak of the Rust heap, one thread, the same probe (`mem_probe`), MiB. The column "Before" is `main` after the first round.

| Area and network | Before | After | Change |
|---|---|---|---|
| Estonia walking | 1,221 | 923 | −24% (−38% from the first measure, 1,532) |
| Estonia driving | 757 | 568 | −25% |
| Kentucky driving | 3,205 | 1,882 | −41% |

The output is equal: the tests of `duckosm-core` pass, and the CLI of release 0.3.0 and this build write the same bytes in 33 of 35 files for Tartu and Estonia with three networks, and in 15 of 17 files for Kentucky driving. The 2 other files hold the build time.

**What this does not show.** These are numbers of the Rust heap in a native process. The WebAssembly memory in the page is not measured again. In the page, Kentucky driving needed 3,422 MiB when the heap probe gives 3,205 MiB, so the page adds about 220 MiB (the file bytes and the module). My estimate for Kentucky driving in the page is about 2.1 GB. It is an estimate, not a measure.

**What remains.** The top of the profile is flat now. In Estonia walking, three places are close to each other: the split of arcs in step 3 (828 MiB), the connect step (868 MiB, temporary maps of +200 MiB) and the edge graph (923 MiB). A gain of the peak needs a change in all three.

- Step 3 and 4: `split_arcs` builds a new list of all edges while the old one lives (+236 MiB). An in-place version that keeps the order is possible, and the order must stay the same.
- The connect step (`connect_paths`): three hash maps over all segments and nodes.
- The edge graph: the rows are 159 MiB in Estonia walking and 250 MiB in Kentucky driving. They are the result. Writing them to the file in sorted blocks as they are made removes them from memory.
- An `Edge` has 160 bytes, and the edges are 437 MiB in Estonia walking. This is the largest part that stays.

## Where the memory goes

From the code (`crates/duckosm-core/src/model.rs`, `graph.rs`, `pbf.rs`). The sizes in bytes are my estimates, not measurements.

| Part | What it holds | Estimate for each edge |
|---|---|---|
| `Edge` | 128 bytes: ids, flags, lengths, a shared pointer to the attributes of the way. | 128 |
| `Edge.refs` | A `Vec<i64>` with the OSM node of each vertex. A separate heap block for each edge. | 8 for each vertex, plus the block |
| `Edge.geometry` | A `Vec<Pt>` with each vertex as two 64-bit numbers. A second heap block. | 16 for each vertex, plus the block |
| `GraphRow` | `from_edge`, `to_edge`, `cost`, and `uses` as a 16-byte text pointer. About 3 rows for each edge in Nacka walking. | about 120 |
| `ways` (the tables `ways` and `way_nodes`) | The ways of the network, with tags. Off with `--no-ways-tables`. | not estimated |
| Coordinates (`Coords`) | A list sorted by node id, 24 bytes for each node, with a binary search. | 24 for each node, not for each edge |
| The writer | The step "files": it adds 26 MiB in Nacka walking. | not known |

The writer already works in row groups (`ROW_GROUP` in `duckosm-parquet`), so the 26 MiB of the "files" step does not come from one array of all rows. I do not know where it comes from. This is the first thing that the probe must answer.

## The options

| # | Option | Gain (my estimate) | Cost | Risk |
|---|---|---|---|---|
| 1 | **A probe for each step** (a counting allocator in a native build, and the same numbers in the page): live bytes and peak, by the name of the step and the type. | None by itself. It shows where to work. | Small | None |
| 2 | **Find the memory of the "files" step.** | Up to 29% of the peak in Nacka walking. | Small to medium | Low, with the same output |
| 3 | **A smaller `GraphRow`.** Make `uses` one byte, not a 16-byte pointer. | Small: about 35 bytes for each edge. | Small | Low |
| 4 | **No second copy of the geometry.** Keep `refs` and take the coordinates from `Coords` when the file is written, if every vertex is an OSM node. | Up to 96 bytes for each edge with 6 vertices, and one heap block. | Medium | Medium: virtual nodes and the connectors have computed points. |
| 5 | **Build each network in a new module instance.** The memory goes back to the system when the worker ends. | About 20% for three networks. | Medium: the file is read again for each network. | Low |
| 6 | **A clear error before the crash.** After the first pass, the page knows the number of ways and nodes. It estimates the memory and says "choose a smaller area". | The crash becomes a message. The limit stays. | Small | Low |
| 7 | **64-bit WebAssembly (Memory64).** | No 4 GB limit. | High: our Rust tools and the browsers (support is not settled). | High |
| 8 | **An out-of-core build.** The big intermediate data goes to OPFS and is read in blocks of 1 MB, never one record at a time. | The most. | High: a redesign. Slower. | Medium |
| 9 | **A build by tiles.** Each way belongs to one tile with its whole node list. A first global pass flags the junctions. Each tile is built alone, with a margin for the rules that look at neighbors. | The most, and many workers. | High | Medium |

Facts that limit options 8 and 9 (from [design.md](../design.md), section 7): only the merge of chains and the filter for the largest connected part need all edges at once. The filter needs only the node ids and the joins between them. The `edge_id` is a hash of the way and its two end nodes, so it does not depend on how the work is cut. Options 8 and 9 are the large piece of work, and the speed measurements of OPFS are in [disk-store.md](disk-store.md), "The speed of the disk".

## The plan

Each step has a check, and a step starts only when the step before it is done. Large areas need Kaveh's word.

| Step | Work | Check |
|---|---|---|
| 0 | **Measure.** Done in part (2026-11-04): the step log on Nacka, Tartu, Estonia and Kentucky, in Node. Still to do: the probe (option 1), which shows the memory by type and not only by step, and a run in the page with the `Blob` path. | The table of this note has the current numbers. The probe shows where the 1.3 to 1.7 KiB for each edge go. |
| 1 | **The clear error** (option 6). | A test with a small limit shows the message, and no `RuntimeError: unreachable`. |
| 2 | **Cheap savings.** Started: four changes, Estonia walking peak −20% (above). Next: steps 2b, 3, 4 and 10, and the edge graph. | `cargo test -p duckosm-wasm` (the same 33 files as the native build), `tools/compare_tables.py` on Monaco and Tartu, and the memory in the table is lower. |
| 3 | **Instances for each network** (option 5), if the probe shows that three networks cost much more than one. | Same checks. The time of a three-network build is not much worse. |
| 4 | **Decide** between options 7, 8 and 9 with the numbers of step 0 and step 2. | A short design note for the chosen option. |

The golden tests are the safety net for every change: the tests of the workspace, the 33 files that the WebAssembly build writes, and the comparison with the duckOSM output.

## What I do not know

- The memory in the page. The page reads the file as a `Blob`, and the Node runner gives bytes.
- Where the 26 MiB of the "files" step goes.
- If the later steps (levels, lane profile, area tables) add memory in a large area. They add 0 in Nacka.
- How much time the options cost in a large area.
- If Memory64 works in the browsers and with the Rust tools that we use.

## Open questions for Kaveh

1. Do you allow Iran for step 0? Iran is the area that you asked about. I expect it to fail, and it needs about 4 GB of RAM for a short time.
2. Is "a clear error and about 1.5 times more area" enough for now, or must the build handle a whole country in the browser? The answer chooses between steps 2 and 3, and the large options.
3. The page and the CLI share the same build code. Is a saving that helps only the browser (for example, options 5 and 6) acceptable?
