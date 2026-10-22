//! The whole build, shared by the CLI and the Python module: read a PBF, build the networks of the modes,
//! write GeoParquet and/or a `.duckdb` file.

use duckosm_core::filter::Mode;
use duckosm_core::fixes::OsmFixes;
use duckosm_core::network::{build_network_with, Options};
use duckosm_core::{pbf, sidewalks};
use std::path::{Path, PathBuf};
use std::time::Instant;

pub mod config;

pub use duckosm_core::filter::Mode as NetworkMode;
pub use duckosm_core::network::Options as NetworkOptions;

/// What to build and write.
#[derive(Clone, Debug)]
pub struct Params {
    pub modes: Vec<Mode>,
    /// Write `edges_<mode>.parquet`, `nodes_<mode>.parquet`, ... in the output folder.
    pub geoparquet: bool,
    /// Write `<name>.duckdb` in the output folder (needs the cargo feature `duckdb`).
    pub duckdb: bool,
    /// The name of the area: the file is `<out>/<name>.duckdb`.
    pub name: String,
    pub options: Options,
    /// Run the sidewalk rule when the walking mode is built (duckOSM `infer_separate_sidewalks`).
    pub infer_sidewalks: bool,
    /// A duckOSM OSM fixes file (duckOSM `osm_overrides`).
    pub osm_fixes: Option<PathBuf>,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            modes: vec![Mode::Driving],
            geoparquet: true,
            duckdb: cfg!(feature = "duckdb"),
            name: "area".to_string(),
            options: Options::default(),
            infer_sidewalks: true,
            osm_fixes: None,
        }
    }
}

/// The numbers of one mode.
#[derive(Clone, Debug)]
pub struct ModeSummary {
    pub mode: Mode,
    pub edges: usize,
    pub nodes: usize,
    pub private_edges: usize,
    pub edge_id_map: usize,
    pub connectors: usize,
    /// The per-mode OSM fixes that matched a way of this mode.
    pub osm_fixes: usize,
}

#[derive(Clone, Debug, Default)]
pub struct Summary {
    pub modes: Vec<ModeSummary>,
    /// The files that were written: (kind, path).
    pub files: Vec<(String, PathBuf)>,
    /// The time of each step in seconds.
    pub steps: Vec<(String, f64)>,
    /// Roads that got `sidewalk=separate`.
    pub sidewalk_roads: usize,
}

pub fn parse_modes(s: &str) -> Result<Vec<Mode>, String> {
    s.split(',')
        .map(|m| {
            Mode::parse(m.trim())
                .ok_or_else(|| format!("unknown mode '{m}' (use driving, walking or cycling)"))
        })
        .collect()
}

pub fn build(pbf_path: &Path, out: &Path, p: &Params) -> Result<Summary, String> {
    if p.duckdb && !cfg!(feature = "duckdb") {
        return Err("this build has no DuckDB output (cargo feature 'duckdb' is off)".into());
    }
    if !p.geoparquet && !p.duckdb {
        return Err("no output format: use geoparquet, duckdb or both".into());
    }
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let mut sum = Summary::default();
    let mut t = Instant::now();
    let mut lap = |what: &str, sum: &mut Summary| {
        sum.steps
            .push((what.to_string(), t.elapsed().as_secs_f64()));
        t = Instant::now();
    };
    let fixes = match &p.osm_fixes {
        Some(f) => config::read_osm_fixes(f)?,
        None => OsmFixes::default(),
    };
    let mut ways = pbf::read_ways(pbf_path)?;
    lap("read ways", &mut sum);
    // duckOSM: the fixes on the raw ways come before any step reads them
    fixes.apply_to_ways(&mut ways)?;
    let mut coords = pbf::read_coords(pbf_path, &ways)?;
    fixes.add_new_nodes(&mut ways, &mut coords);
    lap("read nodes", &mut sum);
    if p.infer_sidewalks && p.modes.contains(&Mode::Walking) {
        sum.sidewalk_roads = sidewalks::infer_separate_sidewalks(&mut ways, &coords);
        lap("sidewalk rule", &mut sum);
    }
    // the GeoParquet files are the input of the .duckdb writer, so they always go to a folder
    let pq_dir = if p.geoparquet {
        out.to_path_buf()
    } else {
        std::env::temp_dir().join(format!("duckosm-{}", std::process::id()))
    };
    std::fs::create_dir_all(&pq_dir).map_err(|e| e.to_string())?;
    for mode in &p.modes {
        let net = build_network_with(&ways, &coords, *mode, &p.options, &fixes)?;
        lap(&format!("build {}", mode.name()), &mut sum);
        let oc = duckosm_parquet::EdgeCols::of(*mode, &p.options);
        let n = mode.name();
        let put = |kind: &str, file: String, sum: &mut Summary| {
            sum.files.push((format!("{kind}_{n}"), pq_dir.join(file)));
        };
        duckosm_parquet::write_edges(&pq_dir.join(format!("edges_{n}.parquet")), &net.edges, oc)?;
        put("edges", format!("edges_{n}.parquet"), &mut sum);
        duckosm_parquet::write_edges(
            &pq_dir.join(format!("private_edges_{n}.parquet")),
            &net.private_edges,
            oc,
        )?;
        put(
            "private_edges",
            format!("private_edges_{n}.parquet"),
            &mut sum,
        );
        duckosm_parquet::write_nodes(&pq_dir.join(format!("nodes_{n}.parquet")), &net.nodes)?;
        put("nodes", format!("nodes_{n}.parquet"), &mut sum);
        if p.options.merge_segments {
            duckosm_parquet::write_edge_id_map(
                &pq_dir.join(format!("edge_id_map_{n}.parquet")),
                &net.edge_id_map,
            )?;
            put("edge_id_map", format!("edge_id_map_{n}.parquet"), &mut sum);
        }
        lap(&format!("write geoparquet {n}"), &mut sum);
        sum.modes.push(ModeSummary {
            mode: *mode,
            edges: net.edges.len(),
            nodes: net.nodes.len(),
            private_edges: net.private_edges.len(),
            edge_id_map: net.edge_id_map.len(),
            connectors: net.stats.connectors,
            osm_fixes: net.stats.osm_fixes,
        });
    }
    #[cfg(feature = "duckdb")]
    if p.duckdb {
        let names: Vec<&str> = p.modes.iter().map(|m| m.name()).collect();
        let db = out.join(format!("{}.duckdb", p.name));
        duckosm_duckdb::write_database(&db, &pq_dir, &names)?;
        sum.files.push(("duckdb".to_string(), db));
        lap("write duckdb", &mut sum);
    }
    if !p.geoparquet {
        let _ = std::fs::remove_dir_all(&pq_dir);
        sum.files.retain(|(k, _)| k == "duckdb");
    }
    Ok(sum)
}
