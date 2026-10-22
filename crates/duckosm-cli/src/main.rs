use clap::Parser;
use duckosm_core::network::{build_driving, Options};
use duckosm_core::pbf;
use std::path::PathBuf;
use std::time::Instant;

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
    /// Output formats, comma separated: duckdb, geoparquet.
    #[arg(short, long, default_value = "duckdb,geoparquet")]
    format: String,
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
    let formats: Vec<&str> = cli.format.split(',').map(str::trim).collect();
    for f in &formats {
        if !["duckdb", "geoparquet"].contains(f) {
            return Err(format!("unknown format '{f}' (use duckdb or geoparquet)"));
        }
    }
    std::fs::create_dir_all(&cli.out).map_err(|e| e.to_string())?;
    let t0 = Instant::now();
    let lap = |what: &str, t: &mut Instant| {
        if cli.timing {
            eprintln!("  {what}: {:.3} s", t.elapsed().as_secs_f64());
        }
        *t = Instant::now();
    };
    let mut t = Instant::now();
    let ways = pbf::read_ways(&cli.pbf)?;
    lap("read ways", &mut t);
    let coords = pbf::read_coords(&cli.pbf, &ways)?;
    lap("read nodes", &mut t);
    let net = build_driving(
        &ways,
        &coords,
        &Options {
            keep_largest_component: !cli.no_component_filter,
        },
    )?;
    lap("build network", &mut t);
    eprintln!(
        "driving: {} edges, {} nodes, {} private edges ({:?})",
        net.edges.len(),
        net.nodes.len(),
        net.private_edges.len(),
        net.stats
    );
    let pq_dir = if formats.contains(&"geoparquet") {
        cli.out.clone()
    } else {
        std::env::temp_dir().join(format!("duckosm-{}", std::process::id()))
    };
    std::fs::create_dir_all(&pq_dir).map_err(|e| e.to_string())?;
    duckosm_parquet::write_edges(&pq_dir.join("edges_driving.parquet"), &net.edges)?;
    duckosm_parquet::write_edges(
        &pq_dir.join("private_edges_driving.parquet"),
        &net.private_edges,
    )?;
    duckosm_parquet::write_nodes(&pq_dir.join("nodes_driving.parquet"), &net.nodes)?;
    lap("write geoparquet", &mut t);
    if formats.contains(&"duckdb") {
        #[cfg(feature = "duckdb")]
        {
            duckosm_duckdb::write_database(
                &cli.out.join(format!("{}.duckdb", cli.name)),
                &pq_dir,
                "driving",
            )?;
            lap("write duckdb", &mut t);
        }
        #[cfg(not(feature = "duckdb"))]
        return Err("this build has no DuckDB output (cargo feature 'duckdb' is off)".into());
    }
    if !formats.contains(&"geoparquet") {
        let _ = std::fs::remove_dir_all(&pq_dir);
    }
    if cli.timing {
        eprintln!("  total: {:.3} s", t0.elapsed().as_secs_f64());
    }
    Ok(())
}
