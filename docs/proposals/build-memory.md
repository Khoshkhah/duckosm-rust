# Proposal: less memory in the browser build

Status: proposal for Kaveh, 2026-11-04. Nothing is built. This note is the build part that [the disk store](disk-store.md) leaves open: the memory of the build module in the browser (the step that reads the `.osm.pbf` file and makes the networks).

## Summary

The build runs in one WebAssembly module. A 32-bit module can use at most 4 GB, and a build that goes over this stops with `RuntimeError: unreachable`. Today the largest area that is known to fit is Kentucky (2,114,699 driving edges, 2,053 MiB). Iran (219 MB file) failed at 3,816 MiB. These two numbers are from 2026-10-21 and 2026-10-22. I measured a smaller area with the build of 2026-10-29 (below), and the cost of each edge there is higher than in the old numbers.

The proposal has three levels, from cheap to large:

1. **Measure first, and fail with a clear message.** A memory probe for each step, a re-measure of the largest known areas, and a message before the module runs out of memory.
2. **Use less memory for each edge,** with no change of the output. Perhaps 1.3 to 2 times more edges (my estimate).
3. **Remove the limit by design,** with an out-of-core build (the data on disk, read in blocks of 1 MB) or with 64-bit WebAssembly. Choose between them only after level 2.

The output must stay equal to duckOSM 0.6.0 in every level.

## What is measured today

The page shows the memory after each step ("Time and memory of each step"). I read the same log in Node with the build of 2026-10-29 (`crates/duckosm-wasm/www/pkg`), on Nacka (a 3.5 MB file) with the default options. The memory of a WebAssembly module only grows, so each number is the peak until then. All numbers are MiB.

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

Walking in Nacka has 56,120 edges and 165,754 rows in `edge_graph`. Facts from the table:

- **The peak is the largest network, not the sum.** The memory of the first network is reused. Three networks cost 26% more than walking alone, because the memory of the module does not shrink and some of it does not get reused.
- **Walking alone: reading the file is 21% of the peak, the network 49%, the files 29%.** These are three separate places to save memory.
- **About 1.6 KiB for each edge** in this small area (89 MiB ÷ 56,120 edges, my own division, with the fixed costs inside). The old measurements of large areas give 0.94 to 1.07 KiB for each edge. I do not know if the cost at scale is 1 KiB or 1.6 KiB with the current code. A small area has fixed costs. This needs a re-measure.

At 1 KiB for each edge, 4 GB holds about 4 million edges. At 1.6 KiB, it holds about 2.6 million. Walking has about 1.8 times more edges than driving for the same area.

Native numbers, from [design.md](../design.md), section 7: Kentucky has a heap peak of 2,145 MiB on one thread. Iran has a heap peak of 5,222 MiB. So the native CLI also needs more than 4 GB for Iran, and a 64-bit module needs about the same.

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
| 0 | **Measure.** Add the probe (option 1). Run Monaco, Nacka and Tartu with the page's step log. Then, with Kaveh's word, Estonia and Kentucky with the current build and all networks. | The table of this note has the current numbers. The real cost for each edge is known. |
| 1 | **The clear error** (option 6). | A test with a small limit shows the message, and no `RuntimeError: unreachable`. |
| 2 | **Cheap savings** (options 2 and 3, then 4 if the probe shows it). | `cargo test -p duckosm-wasm` (the same 33 files as the native build), `tools/compare_tables.py` on Monaco and Tartu, and the memory in the table is lower. |
| 3 | **Instances for each network** (option 5), if the probe shows that three networks cost much more than one. | Same checks. The time of a three-network build is not much worse. |
| 4 | **Decide** between options 7, 8 and 9 with the numbers of step 0 and step 2. | A short design note for the chosen option. |

The golden tests are the safety net for every change: the tests of the workspace, the 33 files that the WebAssembly build writes, and the comparison with the duckOSM output.

## What I do not know

- The memory at scale with the current code. The old numbers are from before the speed step, the sidewalk rule, the connectors, the graph, the restrictions and the lane profile.
- Where the 26 MiB of the "files" step goes.
- If the later steps (levels, lane profile, area tables) add memory in a large area. They add 0 in Nacka.
- How much time the options cost in a large area.
- If Memory64 works in the browsers and with the Rust tools that we use.

## Open questions for Kaveh

1. Do you allow Estonia and Kentucky for step 0? They are the largest areas of the notes.
2. Is "a clear error and about 1.5 times more area" enough for now, or must the build handle a whole country in the browser? The answer chooses between steps 2 and 3, and the large options.
3. The page and the CLI share the same build code. Is a saving that helps only the browser (for example, options 5 and 6) acceptable?
