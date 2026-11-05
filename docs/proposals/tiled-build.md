# Proposal: a build by tiles, and tile files for the browser

Status: proposal for Kaveh, 2026-11-05. Nothing is built. It follows from the discussion of 2026-11-05 and joins two earlier notes: [build-memory.md](build-memory.md) (the memory of the build) and [disk-store.md](disk-store.md) (the result on the disk of the browser).

## Summary

The build keeps all edges of a network in memory, and then it writes. Two rounds of savings removed waste (Estonia walking peak 1,532 to 923 MiB). They cannot take the memory below the size of the data: the edges are 328 bytes each, and an area has millions of them.

The proposal: build the area **tile by tile**. Each tile has the edges that touch it, with a buffer. The memory of the build is then the size of one tile and not the size of the area. The build **keeps the tile files** and does not merge them. The browser reads the same files for the map, for a click on a road and for SQL.

- One algorithm for every size. A small area is one tile.
- The build and the store are one design. The browser needs no second conversion.
- The output of the tile files, merged with a union, must be equal to duckOSM 0.6.0 (the golden tests).

## Why not more patches

Round 1 and round 2 freed memory that the build kept for too long. They changed no data structure. What stays now (Estonia walking, measured with `mem_probe`):

| Part | Memory |
|---|---|
| The edges | 437 MiB (328 bytes for each edge) |
| The edge graph rows | 159 MiB |
| The tables `ways` and `way_nodes` | 79 MiB |
| The input ways | 64 MiB |
| The coordinates | 56 MiB |

A further 25 to 35% is possible with smaller edges (my estimate). The memory still grows with the size of the area, so a country or a planet does not fit in one 4 GB WebAssembly module.

## The design

### The rules

1. **An edge belongs to every tile where it has a vertex, with a buffer.** The buffer is at least the snap distance of the connect step (10 m). Then every neighbor that a rule reads is in the tile. For drawing, an edge also belongs to every tile that one of its segments crosses, because a long segment can cross a tile with no vertex inside it.
2. **An edge can be in more than one tile. The result is the union.** Two tiles that build the same edge must build the same row. When two rows have the same key, the merge keeps one, and it compares them. If they differ, it stops with an error. A hidden tile bug then becomes a clear failure.
3. **A row has the column `is_owner`.** It is true in the tile of the first node of the edge. SQL that counts or sums uses `WHERE is_owner`. Drawing does not use it.
4. **The global steps run first.** Each tile file is final when it is written. No tile is written again.

### The two passes

**Pass A, the light scan** of the file. It keeps only small records:

| Record | Size (my estimate) | Used by |
|---|---|---|
| The flags of the junction nodes | a few bits for each node | The cut of the ways into edges (step 1) |
| The pieces of the chains: first node, last node, direction | 16 to 40 bytes for each piece | The merge of chains (step 2b) |
| The connected part: the union-find over node ids | 16 bytes for each edge | The component filter (step 10) |
| The restriction relations | small | The turn restrictions (step 9b) |

The chain pieces are joined into chains here. Each chain gets its final first node, last node, `edge_id` and owner.

**Pass B, one tile at a time.** The same code as today runs on the ways of the tile. It uses the records of pass A. It writes the rows of the tile to its files, and the memory of the tile is freed.

### What each step of the build needs

From the code of `network.rs` and `graph.rs` (read on 2026-11-05, not tested as a tiled build):

| Step | Needs | In a tile |
|---|---|---|
| 1 Cut the ways, 2 Self-loops, 3 and 4 Parallel and antiparallel arcs, 5 Reverse edges, 6 Edge ids, 7 Lengths, 8c Speeds, 9 Private roads | Only the one way (the keys include `osm_id`). | Local. |
| 1 The junction flags | How many ways use a node. | Exact for nodes in the tile, because every way through the node has a vertex there. The edges that end outside the tile need pass A. |
| 2b Merge chains | A chain joins edges of different ways. It can be longer than a tile. | Pass A joins the pieces. |
| 8b Connect the path ends | The nearest node within 10 m. The tie-break uses the position of the node in the list of nodes. | Local with the buffer. The tie-break must use the node id, so that it does not depend on the order of the tile. |
| 9b Turn restrictions and the edge graph | Edges that meet at a node. | Local, because both edges have a vertex at the node. |
| 10 Component filter | The connectivity of the whole area. | Pass A. |
| The drawing levels, default (the tags rule) | One edge. | Local. |
| The drawing levels, `--levels solve` | A min-cost flow over the whole graph. | Global. It stays a separate step, or it is limited to small areas. |
| `lane_profile`, `ways`, `way_nodes` | One edge or one way. | Local. |
| `global_junctions`, `mm.transfers`, `edge_id_map`, `bus` tables | Not checked yet. | To check one by one in stage 1. |

### The files

```text
area/
  index.json                 the tiles, their bounds, their sizes, the version
  z12/x2345/y1234/
    edges_driving.parquet    the rows of the tile, sorted by edge_id, with is_owner
    edges_walking.parquet
    nodes_*.parquet
    edge_graph_*.parquet
```

- The tile is about 1 MB per table. The zoom level follows the density of the roads (the open question of [disk-store.md](disk-store.md)).
- A file of a tile is sorted by `edge_id` inside the tile. A query over many tiles reads them as one partitioned table.
- A user who wants one `.duckdb` or one Parquet file gets the merge as an export. It streams from the tile files, so the export is also a low-memory job.

### How the browser uses it

It is the plan of [disk-store.md](disk-store.md), with a better start: the build writes the tile files to OPFS as it goes. The map worker reads a tile in one block of about 1 MB (about 2 to 3 ms from OPFS). A click on a road reads the rows of the same tile. DuckDB-wasm reads the Parquet files that a query needs.

The map worker of roadstyle makes tiles from a road table in memory today. A tile source that reads our files is a change on the roadstyle side. The page must use roadstyle's template as it is, so this needs a talk with Kaveh first. This note does not change roadstyle.

## The plan

A stage starts when the stage before it is done. Large areas need Kaveh's word.

| Stage | Work | Check |
|---|---|---|
| 0 | **Make the steps callable on a subset of ways**, with the records of pass A as input. Run the whole area as one tile. | The output is equal to today on Monaco and Tartu. The tests of the workspace pass. |
| 1 | **Pass A** as its own function: the junction flags, the chain pieces joined into chains, the connected part. Check each remaining table of the step table above. | On Tartu and Estonia, the chains, the `edge_id_map` and the dropped edges are equal to today's. |
| 2 | **Tiles in memory.** Cut Tartu into 4 and then 16 tiles with the buffer. Merge the rows with the union and the identity check. The connect step breaks ties by node id. | The merged output is byte equal to the golden (release 0.3.0). The identity check never fires. |
| 3 | **Write the tile files** and the index. The golden test merges the files. | The same check. The export of one file works. |
| 4 | **Measure.** Estonia and Kentucky, with the memory of one tile. The target is a peak that does not grow with the size of the area. | A table of the peak by tile size. The number to reach is set after stage 2. |
| 5 | **The browser** writes the files to OPFS and the map reads them (steps 1 to 4 of [disk-store.md](disk-store.md)). | `e2e.py` and the map tests pass. The memory of the tab does not grow with the number of tiles. |
| 6 | **Remove the guards** of 200,000 and 40,000 roads. Replace them with a limit by disk space. | `roads_limit_e2e.py` and `phone_e2e.py` are changed to match. |

## Risks and what I do not know

- **The length of the chains.** I did not measure it. Pass A joins the pieces whatever the length, so the design does not depend on it. A measure tells the size of the chain records.
- **The buffer is a rule for the neighbors that I know** (the connect step, the edge graph). Another table can read farther. The identity check finds it, but only on the areas that we test.
- **The drawing levels with the solver** are global. I did not check how far the solver looks.
- **The tie-break of the connect step.** Today it uses the position of the node in a list that comes from a hash set. Two nodes at the same distance can change the result when the order changes. The node id is a stable replacement, but it can change the output in a rare case. The golden test will show it.
- **Time.** A tiled build reads the file more than once. I did not measure the cost.
- **The numbers of memory are estimates** until stage 4.
- **OPFS differs between browsers.** The risks of [disk-store.md](disk-store.md) apply.

## Open questions for Kaveh

1. Is the goal "any area with the same code" (this note) or "one large country in the browser"? The second goal can use smaller steps.
2. Do you accept that the tile files are the main store, and that one merged file is an export?
3. Do you accept that stage 2 uses only Tartu, and that Estonia and Kentucky come at stage 4?
4. Can I ask the roadstyle side about a tile source that reads these files (stage 5)?
