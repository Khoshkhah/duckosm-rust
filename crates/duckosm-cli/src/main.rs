use clap::Parser;
use duckosm_build::{
    build, config, parse_modes, LevelsMethod as Method, NetworkMode, NetworkOptions, Params,
};
use std::path::PathBuf;

/// duckosm-rust: build the driving network of an .osm.pbf file (a spike).
#[derive(Parser)]
#[command(version)]
struct Cli {
    /// The input .osm.pbf file (already cut to the area). Not with --config.
    #[arg(required_unless_present = "config", conflicts_with = "config")]
    pbf: Option<PathBuf>,
    /// A duckOSM config file (YAML). It gives the input, the output, the modes and the options.
    #[arg(short, long)]
    config: Option<PathBuf>,
    /// With --config: the PBF is already cut to the boundary of the config (this program does not cut).
    #[arg(long, requires = "config")]
    pbf_is_cut: bool,
    /// With --config: go on when the config asks for a duckOSM step that this program does not have.
    #[arg(long, requires = "config")]
    allow_skipped: bool,
    /// The output folder (default: the current folder, or output_path of the config).
    #[arg(short, long)]
    out: Option<PathBuf>,
    /// The name of the area: the .duckdb file is <out>/<name>.duckdb.
    #[arg(long, default_value = "area", conflicts_with = "config")]
    name: String,
    /// Output formats, comma separated: duckdb, geoparquet. Default: both, or geoparquet when this
    /// program is built without the cargo feature "duckdb".
    #[arg(short, long)]
    format: Option<String>,
    /// Modes, comma separated: driving, walking, cycling.
    #[arg(short, long, default_value = "driving", conflicts_with = "config")]
    modes: String,
    /// Cycling without the footways that are walked (dismount).
    #[arg(long, conflicts_with = "config")]
    no_cycling_dismount: bool,
    /// Cut each mode at its own junctions (duckOSM option global_junctions: false).
    #[arg(long, conflicts_with = "config")]
    no_global_junctions: bool,
    /// Do not infer sidewalk=separate on roads that have a sidewalk line on both sides (duckOSM option infer_separate_sidewalks).
    #[arg(long, conflicts_with = "config")]
    no_sidewalk_inference: bool,
    /// Do not connect the dangling path ends to the network (duckOSM option connectivity_rescue: false).
    #[arg(long, conflicts_with = "config")]
    no_connect_paths: bool,
    /// The distance in metres within which a dangling path end is connected.
    #[arg(long, default_value_t = 10.0, conflicts_with = "config")]
    snap_m: f64,
    /// Do not compute maxspeed_kmh (the raw maxspeed text stays; duckOSM option process_speeds: false).
    #[arg(long, conflicts_with = "config")]
    no_speeds: bool,
    /// Do not compute cost_s, the travel time (duckOSM option calculate_costs: false).
    #[arg(long, conflicts_with = "config")]
    no_costs: bool,
    /// Do not add walk_type and cycle_type (duckOSM option functional_types: false).
    #[arg(long, conflicts_with = "config")]
    no_functional_types: bool,
    /// Do not join the chains of edges that are one road (duckOSM option merge_segments).
    #[arg(long, conflicts_with = "config")]
    no_merge_segments: bool,
    /// Do not keep only the largest connected part of the graph.
    #[arg(long, conflicts_with = "config")]
    no_component_filter: bool,
    /// Do not build edge_graph and turn_permission (duckOSM option build_graph: false).
    #[arg(long, conflicts_with = "config")]
    no_graph: bool,
    /// Do not build turn_restrictions and turn_path_restrictions (duckOSM option extract_restrictions: false).
    #[arg(long, conflicts_with = "config")]
    no_restrictions: bool,
    /// Do not write ways and way_nodes (duckOSM writes them always; off saves memory in a large area).
    #[arg(long)]
    no_ways_tables: bool,
    /// Do not make the bus routes, bus.routes and bus.route_edges (duckOSM option bus_routes: false). They need
    /// --boundary and the driving mode.
    #[arg(long, conflicts_with = "config")]
    no_bus_routes: bool,
    /// A duckOSM OSM fixes file (YAML). With --config, it replaces the config's osm_overrides.
    #[arg(long, value_name = "FILE")]
    fixes: Option<PathBuf>,
    /// A boundary (GeoJSON, as `duckosm boundary` writes it): the PBF is cut to it (as osmium complete_ways).
    #[arg(long, value_name = "FILE", conflicts_with = "config")]
    boundary: Option<PathBuf>,
    /// With --boundary: also write duckOSM's raw.* of the area (raw_nodes.parquet, raw_ways.parquet,
    /// raw_relations.parquet, as osmium's smart cut), the input of the base-map layers (docs/features.md).
    #[arg(long, requires = "boundary")]
    raw: bool,
    /// The drawing order of the roads (visualization.edge_levels, docs/levels.md): tags (a rule on layer,
    /// bridge and tunnel), solve (roadstyle's optimization) or none. Default: tags, or the config's
    /// options.levels (on: solve).
    #[arg(long, value_name = "METHOD")]
    levels: Option<String>,
    /// Print the time of each step.
    #[arg(long)]
    timing: bool,
}

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let cli = Cli::parse();
    let default_format = if cfg!(feature = "duckdb") {
        "duckdb,geoparquet"
    } else {
        "geoparquet"
    };
    let (pbf, out, mut p) = if let Some(cfg) = &cli.config {
        let c = config::read(cfg, cli.pbf_is_cut, !cli.allow_skipped)?;
        for s in &c.skipped {
            eprintln!("skipped: {s}");
        }
        for s in &c.ignored {
            eprintln!("ignored: {s}");
        }
        (c.pbf, cli.out.clone().unwrap_or(c.out), c.params)
    } else {
        let mut p = Params {
            name: cli.name.clone(),
            ..Params::default()
        };
        p.modes = parse_modes(&cli.modes)?;
        p.infer_sidewalks = !cli.no_sidewalk_inference;
        p.options = NetworkOptions {
            keep_largest_component: !cli.no_component_filter,
            cycling_dismount: !cli.no_cycling_dismount,
            merge_segments: !cli.no_merge_segments,
            global_junctions: !cli.no_global_junctions,
            connect_paths: !cli.no_connect_paths,
            snap_m: cli.snap_m,
            process_speeds: !cli.no_speeds,
            calculate_costs: !cli.no_speeds && !cli.no_costs,
            functional_types: !cli.no_functional_types,
            build_graph: !cli.no_graph,
            extract_restrictions: !cli.no_restrictions,
            ways_tables: !cli.no_ways_tables,
            bus_routes: !cli.no_bus_routes,
            ..NetworkOptions::default()
        };
        (
            cli.pbf.clone().unwrap(),
            cli.out.clone().unwrap_or_else(|| PathBuf::from(".")),
            p,
        )
    };
    if let Some(m) = &cli.levels {
        p.options.levels = Method::parse(m)
            .ok_or_else(|| format!("--levels: '{m}' is not tags, solve or none"))?;
    }
    if let Some(f) = &cli.fixes {
        p.osm_fixes = Some(f.clone());
    }
    if cli.boundary.is_some() {
        p.boundary = cli.boundary.clone();
        p.raw = cli.raw;
    }
    p.geoparquet = false;
    p.duckdb = false;
    for f in cli
        .format
        .as_deref()
        .unwrap_or(default_format)
        .split(',')
        .map(str::trim)
    {
        match f {
            "duckdb" => p.duckdb = true,
            "geoparquet" => p.geoparquet = true,
            _ => return Err(format!("unknown format '{f}' (use duckdb or geoparquet)")),
        }
    }
    let sum = build(&pbf, &out, &p)?;
    if p.infer_sidewalks && p.modes.contains(&NetworkMode::Walking) {
        eprintln!(
            "sidewalk rule: {} roads get sidewalk=separate",
            sum.sidewalk_roads
        );
    }
    for m in &sum.modes {
        eprintln!(
            "{}: {} edges, {} nodes, {} private edges, {} connectors, {} edge_id_map rows, {} OSM fixes, {} edge_graph rows, {} turn restrictions",
            m.mode.name(),
            m.edges,
            m.nodes,
            m.private_edges,
            m.connectors,
            m.edge_id_map,
            m.osm_fixes,
            m.edge_graph,
            m.turn_restrictions
        );
    }
    for l in sum.levels.iter().chain(&sum.lanes) {
        eprintln!("{l}");
    }
    if cli.timing {
        for (what, secs) in &sum.steps {
            eprintln!("  {what}: {secs:.3} s");
        }
        eprintln!(
            "  total: {:.3} s",
            sum.steps.iter().map(|s| s.1).sum::<f64>()
        );
    }
    Ok(())
}
