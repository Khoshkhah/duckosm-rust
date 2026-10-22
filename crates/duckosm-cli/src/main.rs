use clap::Parser;
use duckosm_build::{build, parse_modes, NetworkMode, NetworkOptions, Params};
use std::path::PathBuf;

/// duckosm-rust: build the driving network of an .osm.pbf file (a spike).
#[derive(Parser)]
#[command(version)]
struct Cli {
    /// The input .osm.pbf file (already cut to the area).
    pbf: PathBuf,
    /// The output folder.
    #[arg(short, long, default_value = ".")]
    out: PathBuf,
    /// The name of the area: the .duckdb file is <out>/<name>.duckdb.
    #[arg(long, default_value = "area")]
    name: String,
    /// Output formats, comma separated: duckdb, geoparquet. Default: both, or geoparquet when this
    /// program is built without the cargo feature "duckdb".
    #[arg(short, long)]
    format: Option<String>,
    /// Modes, comma separated: driving, walking, cycling.
    #[arg(short, long, default_value = "driving")]
    modes: String,
    /// Cycling without the footways that are walked (dismount).
    #[arg(long)]
    no_cycling_dismount: bool,
    /// Cut each mode at its own junctions (duckOSM option global_junctions: false).
    #[arg(long)]
    no_global_junctions: bool,
    /// Do not infer sidewalk=separate on roads that have a sidewalk line on both sides (duckOSM option infer_separate_sidewalks).
    #[arg(long)]
    no_sidewalk_inference: bool,
    /// Do not connect the dangling path ends to the network (duckOSM option connectivity_rescue: false).
    #[arg(long)]
    no_connect_paths: bool,
    /// The distance in metres within which a dangling path end is connected.
    #[arg(long, default_value_t = 10.0)]
    snap_m: f64,
    /// Do not compute maxspeed_kmh (the raw maxspeed text stays; duckOSM option process_speeds: false).
    #[arg(long)]
    no_speeds: bool,
    /// Do not compute cost_s, the travel time (duckOSM option calculate_costs: false).
    #[arg(long)]
    no_costs: bool,
    /// Do not join the chains of edges that are one road (duckOSM option merge_segments).
    #[arg(long)]
    no_merge_segments: bool,
    /// Do not keep only the largest connected part of the graph.
    #[arg(long)]
    no_component_filter: bool,
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
    let mut p = Params {
        name: cli.name.clone(),
        geoparquet: false,
        duckdb: false,
        ..Params::default()
    };
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
    };
    let sum = build(&cli.pbf, &cli.out, &p)?;
    if sum.sidewalk_roads > 0 || p.modes.contains(&NetworkMode::Walking) {
        eprintln!(
            "sidewalk rule: {} roads get sidewalk=separate",
            sum.sidewalk_roads
        );
    }
    for m in &sum.modes {
        eprintln!(
            "{}: {} edges, {} nodes, {} private edges, {} connectors, {} edge_id_map rows",
            m.mode.name(),
            m.edges,
            m.nodes,
            m.private_edges,
            m.connectors,
            m.edge_id_map
        );
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
