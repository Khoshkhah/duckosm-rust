# Proposal: a disk-backed store for the result of a build

Status: proposal for Kaveh, 2026-11-04. Nothing is built. This note is about what happens **after** the build has made the network. The build itself (its memory limit) is a separate note that comes next ([The build part](#the-build-part-comes-next)).

## Summary

Today the page keeps the whole result in memory: the roads for the map, and the tables for SQL. This sets the size of the area that the map can show (the guards of 200,000 roads on a computer and 40,000 on a small device).

The proposal: the Rust code, which already runs in the browser as WebAssembly, writes the result to the disk of the browser (OPFS) as **tile files**, and reads them back when a tile is needed. The drawing and the data tables use the same tile path. The page holds only the tiles in view, in a small cache.

- No server and no port. Everything stays in the browser, and the data stays on the computer of the user.
- It does not change the memory limit of the build. That is the next note.

## The limits

These are the limits that stop something from working, from the first that you hit. The sizes of the browser limits are from memory, not measured here. "Measured" marks a number from a test of this repository.

| # | Limit | What it stops | Kind | Can we solve it? |
|---|---|---|---|---|
| 1 | RAM of the computer | Build and map | Physical | No. We can only use less memory. |
| 2 | 4 GB for one WebAssembly module (32-bit addresses) | The build of a very large region. Kentucky uses 2,053 MiB of it (measured). | Platform | Partly: 64-bit addresses (Memory64, support not settled), or a build in smaller steps. |
| 3 | The JavaScript heap (about 4 GB in Chrome) | The map: roads held as JavaScript values | Platform | Yes, by design. **This note.** |
| 4 | About 14 KB of tab memory for each road, a base of about 1,000 MiB, and all roads in memory at once | The map: the size of the area | Design | Yes. **This note.** |
| 5 | The guards of 200,000 roads (computer) and 40,000 (small device) | The page refuses to draw a larger map | Design (our rule) | Yes. 200,000 is an estimate. |

Not limits that stop the work:

- **The graphics card.** Without it, the browser draws with software rendering. The map is slower, but it works.
- **Network speed, the storage quota of the browser, and one thread for parsing tiles.** They make things slow, or limit one feature (a download, saved areas).

The 4 GB limit of a WebAssembly module is not a limit of DuckDB data alone. The page has three modules, and each has its own 4 GB. The Burnaby measurement (151,770 roads, all networks, desktop Chromium, [app.md](../app.md), "The memory of the page"):

| Part | Memory | Near 4 GB? |
|---|---|---|
| The tab after the draw | 3,174 MiB | The whole tab, mostly the JavaScript side |
| The map worker (roadstyle's module) | 796 MiB | No |
| DuckDB-wasm | 321 MiB | No |
| The build module | 402 MiB after the build. Kentucky: 2,053 MiB. | Only for a very large region |

## The idea

Store the result like a tile map stores its data:

- The area is cut into tiles. Each tile file has all roads, nodes and other items that are **inside the tile or cross it**. A road that crosses a border is in each tile that it touches, clipped to the tile, for drawing.
- A small index in memory tells where each tile is on the disk.
- The page asks for a tile and gets it in one read of one block. The tiles used last stay in a cache.

```text
build (Rust, WebAssembly) --> tile files and an index on OPFS
                                   |
        MapLibre asks a tile --> map worker reads the tile file --> draws it
        click on a road ------>  the rows of that tile -----------> popup, fixes panel
        SQL query ------------>  DuckDB-wasm reads Parquet files on OPFS, scans only what it needs
```

## What it solves, and what it does not

| Part | Today | With the store |
|---|---|---|
| The road table of the map | All roads in memory | One tile at a time, from disk |
| The tables for SQL | Loaded into DuckDB-wasm memory | Parquet on disk, read when a query needs it |
| A saved area | On OPFS, but loaded into memory when you open it | Read from OPFS only when needed |
| The size limit of the map | 200,000 roads (an estimate) | Disk space and time, not memory |
| The memory of the **build** | 4 GB for the module | **Not changed** |

Two kinds of data, with different jobs:

- **Display tiles.** Roads clipped to the tile, with their attributes. A crossing road is in more than one tile. They are good for the map and for the click on a road.
- **Data for SQL.** Counts and sums need each road one time. Keep Parquet files ordered by place, and give each road to **one** tile (the tile of its first node), with no duplicates.

## What exists today

- **A saved area on OPFS.** Each build is saved with its tables, its drawing cache and its cut file ([dashboard.md](../dashboard.md), "Your areas"). **Open** loads it into memory again.
- **The map worker makes tiles on demand** from a road table that is in memory (`map/map_worker.js`, roadstyle's module).
- **The export of tiles** makes a PMTiles file with a layer `edges`. It holds each piece of a road, clipped to the tile with a small buffer, with every column of the edge. It is made in memory, for at most 40,000 tiles ([dashboard.md](../dashboard.md), "Step 9: Export").
- **DuckDB-wasm opens a `.duckdb` file with direct IO** (`app/duck.js`).
- **roadstyle's own design** says that a larger area "uses tiles made before" (`docs/design/target_architecture.md` in the roadstyle repository), and `docs/design/duckdb_server.md` describes a server for this. This note is the same idea, on the user's disk.

## The speed of the disk

The number that decides the design: **each call to OPFS costs about 0.2 ms, whatever its size.** One block of 1 MB is as cheap as one read of 16 bytes. So the store must read big blocks, never single records.

Measured with `tools/opfs_bench.py` (512 MB in headless Chromium on WSL2, four runs on 2026-11-04). The numbers change from run to run, and they change with the browser, the system and the disk.

| Access | Speed |
|---|---|
| Write, blocks of 1 MB | 130 to 295 MB/s |
| Read, blocks of 1 MB | 610 to 890 MB/s |
| Small reads (16 bytes or 4 KB), in order or at random | 3,600 to 5,300 reads per second |
| Copy in memory (the base) | 1,150 to 1,810 MB/s |

One tile of 1 MB then takes about 1.5 to 3 ms. A view of 30 tiles takes under 0.1 s of disk time. A read of one record at a time is at least 1,000 times slower than a read in memory.

## The plan

Each step has a check. A step starts only when the step before it is done.

| Step | Work | Check |
|---|---|---|
| 0 | **Baseline.** Record the memory of the tab, the map worker and DuckDB-wasm for Monaco and Tartu, with the `?maxroads=0` option. Larger areas need Kaveh's word. | The numbers are in this note. |
| 1 | **Prototype.** Build Monaco, write its roads as tile files to OPFS, and let the map worker draw from them. | The map looks the same as today. The memory of the tab is lower, and it does not grow with the number of tiles in the cache. |
| 2 | **Tables on disk.** DuckDB-wasm queries Parquet files on OPFS without loading them. Open a saved area without loading its tables. | The test of saved areas (`saved_e2e.py`) passes. A query on Tartu gives the same rows as today. |
| 3 | **The build writes the tile files** as the results come out, so they never sit in memory again. | The same files and rows as today (`e2e.py`), and the memory of the build is not larger. |
| 4 | **Store the global roadstyle steps** (the drawing levels, the twins, the slots) next to the tiles. | The drawing is equal to the drawing of today on Monaco and Tartu. |
| 5 | **The fixes panel** changes the tiles that a rule touches. | `fixes_e2e.py` passes. |
| 6 | **Remove the guards** of 200,000 and 40,000 roads, and replace them with a limit by disk space. | `roads_limit_e2e.py` and `phone_e2e.py` are changed to match. |

## Compared with other tools

kepler.gl (since 3.1, January 2025) has DuckDB-wasm with an SQL panel, vector tile layers (MVT and PMTiles) that load by view and zoom, and DuckDB that reads only the partitions of spatially partitioned GeoParquet that a query needs. In that design, the big data is on a server or at a URL. I found no sign that kepler.gl stores data on the disk of the user. I read the release notes and a summary, not the source.

What this note adds: the data is made and kept on the user's own disk, and the table rows follow the same tile path as the drawing. Sources: [Foursquare: Kepler.gl 3.1](https://foursquare.com/resources/blog/products/foursquare-brings-enterprise-grade-spatial-analytics-to-your-browser-with-kepler-gl-3-1/), [kepler.gl release notes](https://docs.kepler.gl/release-notes).

The page already writes plain GeoJSON, so kepler.gl can open a network that we built.

## Other ways to give the data to the browser

| Way | Server? | Note |
|---|---|---|
| This proposal: tiles and tables on the disk of the browser | No | The data stays on the computer of the user. The size is limited by the disk and the time. |
| A static tile file (PMTiles) and Parquet files on object storage, read in parts | No code, only storage | For published data. It needs a host that allows large files ([hosting.md](hosting.md)). |
| A tile server from a database | Yes | Live colors and filters. It costs a running server. |
| A local server on the user's computer | A program on `127.0.0.1` | Not wanted (Kaveh, 2026-11-04). |

## Risks

- The tile files must be written while the build runs. Otherwise the result sits in memory first, and the limit of the build stays.
- OPFS differs between browsers. Safari and some private windows limit it. The page must say so and fall back to the memory mode for small areas.
- A change by the fixes panel must update every tile that it touches, and must not leave a stale tile in the cache.
- The numbers of the disk are from one browser on one computer.

## Open questions for Kaveh

1. What is the size of a tile? A tile of about 1 MB fits the speed of the disk. The zoom level is then set by the density of the roads.
2. Do you accept that step 0 and step 1 use only Monaco and Tartu, and a large area comes after step 1?
3. Does the memory mode stay for small areas, or does the store replace it for every area?

## The build part comes next

This note does not change the memory of the build. The options, from the discussion of 2026-11-04, for a separate note:

1. Use less memory for each edge (now about 1 KiB), by measuring each step and packing the data.
2. Build one network at a time, and free the memory between them.
3. WebAssembly with 64-bit addresses (Memory64).
4. Keep the big intermediate data on disk. Never look up one record at a time: sort it and read it in blocks of 1 MB (the speed table above).
5. Split the area into tiles and build each tile alone, with a margin. Each way belongs to one tile and keeps its whole node list. A first global pass flags the junctions.

In all of them, the output must keep the same rows as duckOSM. The golden tests check it.
