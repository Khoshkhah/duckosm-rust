# Benchmark: network step, duckOSM and duckosm-rust

Date: 2026-10-21. Machine: Intel Core i5-13600K (20 threads), 23 GB memory, WSL2 (Linux 6.6.87.2), warm file cache.

| Program | Version |
|---|---|
| duckOSM (Python) | 0.6.0 (git `b857caf`), DuckDB 1.5.3 in the Python environment |
| duckosm-rust | this repository at commit `bd7e158` (the later commits change only the default `--format` and docs), `cargo build --release`, `lto = "thin"` |
| Rust | rustc 1.99.1 |
| DuckDB inside duckosm-rust | 1.5.6 (crate `duckdb` 1.10506.1, `bundled`) |

## What is compared

The **network step of the driving mode**: PBF in, driving edges and nodes out. The settings are the same
for both programs:

- one mode (driving), no boundary (so no `osmium` cut and no component filter), global junctions on,
  `merge_segments` off (duckosm-rust does not have it yet);
- duckOSM: the config `bench/python_network_step.yaml`, with every other step switched off (graph of
  legal turns, H3, speeds, costs, turn restrictions, features, bus routes, drawing order);
- duckosm-rust: `duckosm-rust <pbf> -o <dir> --name <name> --no-component-filter --format duckdb` and
  `--format geoparquet`.

**The results are equal.** On both areas, every edge, private edge and node matches (section "Check").
Only the three tables that both programs write are compared: `driving.edges`, `driving.private_edges` and
`driving.nodes`. The other tables of duckOSM (`edge_graph`, `lane_profile`, `ways`, `raw.*`, and so on)
are not written by duckosm-rust, so they are not compared.

## Method

`bench/run_bench.py --pbf <file> --label <name> --runs 3`. For each command: one untimed warm-up run,
then 3 timed runs under `/usr/bin/time -v`. The table shows the minimum and the median of the wall time,
and the largest peak memory (maximum resident set size). "Network steps" is the sum of the times that the
program reports for its own steps:

- duckOSM: `_load_pbf`, `_build_global_junctions`, `_filter_roads`, `_build_edges`, `_simplify_graph`,
  `_split_private`. `bench/python_steps.py` wraps these methods of `DuckOSM` and prints their time. The
  code that runs is the code of `duckosm build`.
- duckosm-rust (`--timing`): read ways, read nodes, build network.

**Lane profile.** duckOSM always runs the step `_lane_profile` for the driving mode and has no switch for
it. It is not part of the network step. It adds a large cost
(see "The lane profile step is slow"). `bench/python_steps.py ... --no-lane-profile` replaces it with an empty
function. The row "lane profile off" is therefore **not** the command `duckosm build`.

## Results

### Monaco (0.6 MB, 2,765 driving edges)

| Program | runs | wall min (s) | wall median (s) | peak memory (MB) | network steps min (s) | network steps median (s) |
|---|---|---|---|---|---|---|
| duckOSM: `duckosm build --config config.yaml` | 3 | 22.01 | 23.40 | 309 | - | - |
| duckOSM: same, lane profile off | 3 | 1.60 | 1.65 | 317 | 0.45 | 0.45 |
| duckosm-rust: `--format duckdb` | 3 | 0.12 | 0.12 | 63 | 0.02 | 0.02 |
| duckosm-rust: `--format geoparquet` | 3 | 0.03 | 0.03 | 41 | 0.02 | 0.02 |

### Estonia (`estonia-latest.osm.pbf`, 120.9 MB, 821,074 driving edges)

| Program | runs | wall min (s) | wall median (s) | peak memory (MB) | network steps min (s) | network steps median (s) |
|---|---|---|---|---|---|---|
| duckOSM: `duckosm build --config config.yaml` | 1, stopped | more than 33 min (see below) | - | - | - | - |
| duckOSM: same, lane profile off | 3 | 217.70 | 225.83 | 2,460 | 214.51 | 222.68 |
| duckosm-rust: `--format duckdb` | 3 | 7.22 | 7.65 | 1,908 | 3.55 | 3.65 |
| duckosm-rust: `--format geoparquet` | 3 | 6.30 | 7.10 | 1,708 | 4.54 | 5.02 |

Wall times of each run (s): duckOSM lane profile off 228.51, 217.70, 225.83; duckosm-rust `duckdb` 7.22, 7.65,
9.13; `geoparquet` 7.10, 8.45, 6.30.

Plain `duckosm build` on Estonia: I started one run and stopped it after 33 min, inside the lane profile
step. The steps before it finished after about 4 min (same as the row "lane profile off"). So there is no
number and no 3 runs. The cause of the lane profile time is measured (next section).

### The lane profile step is slow because of `executemany`

`driving.lane_profile` is written with `con.executemany("INSERT INTO ... VALUES (?, ?, ...)", rows)`
(`processors/lane_profile.py`, line 158). Test on a copy of `monaco.duckdb`, on this disk:

| How the rows are inserted | time |
|---|---|
| `executemany`, 3,000 rows, one commit for each row (the code of duckOSM) | 30.0 s (10 ms for each row) |
| `executemany`, 3,000 rows, inside one `BEGIN ... COMMIT` | 1.4 s |
| 300,000 rows in one `INSERT ... SELECT * FROM <DataFrame>` | 0.2 s |

Monaco has only 3,176 lane rows, and the step takes 28-35 s. Estonia has about 845,000 edges and so
about 2 million lane rows. At 10 ms for each row, the step needs more than 5 hours. With one
`INSERT ... SELECT` from a DataFrame it would need seconds for the insert. The Python loop that decides
the lanes of each edge is a second cost that I did not measure. Other places in duckOSM use the same
call for large lists (for example `component_filter.py` line 67 and `restrictions.py` line 203).

### Where the time goes

duckOSM, Estonia, one run (seconds): `_connect` 0.07, `_load_pbf` 3.76, `_build_global_junctions` 0.24,
`_filter_roads` 1.24, `_build_edges` 0.61, **`_simplify_graph` 201.82**, `_split_private` 0.11,
`_create_indexes` 1.29, the rest under 0.1. I did not profile inside `_simplify_graph`. The log shows that
the cut into edges and the splits finish in about 5 s, so the long part comes after them. The code there is the unique-id
check, `edge_ref` and the length correction (my guess, not measured).

duckosm-rust, Estonia, one run with `--timing`: read ways 0.50, read nodes 0.50, build network 2.19,
write GeoParquet 0.86, write `.duckdb` 1.87.

Monaco, duckOSM, one run: `_simplify_graph` 0.31 s of 0.50 s in the network steps.

## Check: the outputs are equal

`tools/compare_with_duckosm.py <duckOSM db> <duckosm-rust db>` joins on `edge_id` and compares every
column, with the geometry as exact bytes (WKB), and `length_m` as exact 32-bit floats.

| Area | edges | private edges | nodes | result |
|---|---|---|---|---|
| Monaco (golden build, no OSM fixes) | 2,765 | 689 | 1,719 | 0 rows differ, in any column |
| Estonia (benchmark build) | 821,074 | 24,752 | 378,420 | 0 rows differ, in any column |
| Monaco, `monaco.duckdb` of 2026-10-21 | 2,765 | 689 | 1,719 | 78 edges differ in `lanes`, nothing else |

The 78 `lanes` differences of the last row are the OSM fixes (`osm_overrides.yaml` sets the lanes of
Boulevard du Larvotto, Avenue Albert II and others). duckosm-rust has no fixes yet. A golden build with no
fixes gives 0 differences.

## Caveats

- **The machine was shared.** Other sessions ran builds and servers at the same time. The load average was
  between 2 and 19 during the runs. The Rust times for Estonia vary from 6.3 s to 9.1 s for this reason.
  The ratio is large enough to survive this noise, but the second digit is not reliable.
- **The programs do not do the same work in every way.** duckOSM also loads all OSM ways, nodes and
  relations into `raw.*`, and writes `ways`, `way_nodes`, `main.global_junctions`, `lane_profile`,
  metadata and the time zone. Its Estonia file is 794 MB. duckosm-rust keeps only the highway ways and the
  nodes they use. Its `.duckdb` file is 148 MB. Both give the same `edges`, `private_edges` and `nodes`.
- **Threads.** duckOSM runs on DuckDB, which uses all threads for the SQL steps. duckosm-rust reads the PBF
  with all threads (rayon) and then builds the network on one thread.
- **Memory** is the peak of the whole process. In Python it includes the interpreter and DuckDB.
- **Not measured:** `merge_segments`, the component filter, the walking and cycling modes. They are not
  in duckosm-rust yet. The component filter is in the code and is tested on Monaco (79 edges dropped,
  equal to duckOSM). It is off in the benchmark because duckOSM runs it only with a boundary.
- **One area of each size.** Two areas are not enough to say how the speed grows with the size.
- **The `.duckdb` writer** loads the GeoParquet files with DuckDB, so the time of `--format duckdb`
  includes writing GeoParquet to disk first (about 1 s on Estonia).
- Estonia is the data of 2026-05-20. Its PBF is in `osm-traffic-enrichment/map`. It was not downloaded
  for this benchmark.
