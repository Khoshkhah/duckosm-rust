//! The whole build, shared by the CLI and the Python module: read a PBF, build the networks of the modes,
//! write GeoParquet and/or a `.duckdb` file.

use duckosm_core::boundary::Boundary;
use duckosm_core::filter::Mode;
use duckosm_core::fixes::OsmFixes;
use duckosm_core::model::Network;
use duckosm_core::network::{build_network_with, Options};
use duckosm_core::raw::Raw;
use duckosm_core::{pbf, sidewalks};
use std::io::Write;
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
    /// A boundary (GeoJSON): the PBF is cut to it as osmium's `complete_ways` does. None: the PBF is the area.
    pub boundary: Option<PathBuf>,
    /// Also write duckOSM's `raw.*` of the area (`raw_nodes.parquet`, ...), the input of the base-map layers
    /// (docs/features.md). Needs a boundary.
    pub raw: bool,
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
            boundary: None,
            raw: false,
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
    pub edge_graph: usize,
    pub turn_restrictions: usize,
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

/// Write the tables of one mode, each to a writer from `file`, which gets the file name (for example
/// `edges_driving.parquet`). The native build and the browser build (duckosm-wasm) both use it, so they
/// write the same tables: the edges, the private edges, the nodes, `edge_id_map` (with `merge_segments`),
/// and the tables of the edge graph and the turn restrictions that the options made.
pub fn write_tables<W: Write + Send>(
    net: &Network,
    mode: Mode,
    opts: &Options,
    mut file: impl FnMut(&str) -> Result<W, String>,
) -> Result<(), String> {
    use duckosm_parquet as pq;
    let n = mode.name();
    let mut out = |table: &str| file(&format!("{table}_{n}.parquet"));
    let oc = pq::EdgeCols::of(mode, opts);
    pq::write_edges_to(out("edges")?, &net.edges, oc)?;
    pq::write_edges_to(out("private_edges")?, &net.private_edges, oc)?;
    pq::write_nodes_to(out("nodes")?, &net.nodes)?;
    if opts.merge_segments {
        pq::write_edge_id_map_to(out("edge_id_map")?, &net.edge_id_map)?;
    }
    let g = &net.graph;
    if let Some(rows) = &g.edge_graph {
        pq::write_edge_graph_to(out("edge_graph")?, rows)?;
    }
    if let Some(rows) = &g.turn_permission {
        pq::write_turn_permission_to(out("turn_permission")?, rows)?;
    }
    if let Some(rows) = &g.turn_restrictions {
        pq::write_turn_restrictions_to(out("turn_restrictions")?, rows)?;
    }
    if let Some(rows) = &g.turn_path_restrictions {
        pq::write_turn_path_restrictions_to(out("turn_path_restrictions")?, rows)?;
    }
    Ok(())
}

/// Write duckOSM's `raw.*` tables, each to a writer from `file`: `raw_nodes.parquet`, `raw_ways.parquet` and
/// `raw_relations.parquet`. `features.sql` loads them and makes the base-map layers.
pub fn write_raw<W: Write + Send>(
    raw: &Raw,
    mut file: impl FnMut(&str) -> Result<W, String>,
) -> Result<(), String> {
    use duckosm_parquet as pq;
    pq::write_raw_nodes_to(file("raw_nodes.parquet")?, &raw.nodes)?;
    pq::write_raw_ways_to(file("raw_ways.parquet")?, &raw.ways)?;
    pq::write_raw_relations_to(file("raw_relations.parquet")?, &raw.relations)
}

/// duckOSM's SQL of the base-map layers (`features.*`), from the `raw.*` files of [`write_raw`]: made by
/// tools/make_features_sql.py from duckOSM's `FeaturesBuilder`. It needs DuckDB's spatial extension.
pub const FEATURES_SQL: &str = include_str!("../sql/features.sql");

/// `layers.json`: the list of the edge and node files with their counts, as `duckosm export-gis`
/// writes it, so the roadstyle GeoLibre plugin opens the folder in one step.
fn write_layers_json(dir: &Path, sum: &Summary) -> Result<(), String> {
    let mut rows = Vec::new();
    for m in &sum.modes {
        let n = m.mode.name();
        for (kind, count) in [("edges", m.edges), ("nodes", m.nodes)] {
            rows.push(format!(
                "  {{\"file\": \"{kind}_{n}.parquet\", \"kind\": \"{kind}\", \"mode\": \"{n}\", \"count\": {count}}}"
            ));
        }
    }
    let json = format!("{{\"layers\": [\n{}\n]}}\n", rows.join(",\n"));
    std::fs::write(dir.join("layers.json"), json).map_err(|e| e.to_string())
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
    if p.raw && p.boundary.is_none() {
        return Err("raw.* (the base-map layers) needs a boundary".into());
    }
    let mut raw = None;
    let (mut ways, mut coords, area_relations) = match &p.boundary {
        // duckOSM with a boundary: cut the PBF (osmium complete_ways, or smart for raw.*), then the fixes on the raw ways
        Some(path) => {
            let text =
                std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
            let boundary = Boundary::parse(&text)?;
            let (mut ways, coords, relations) = if p.raw {
                let open = || pbf::BlobReader::from_path(pbf_path).map_err(|e| e.to_string());
                let (w, c, r, mut rw) = pbf::read_area_raw(open, &boundary)?;
                rw.apply_fixes(&fixes);
                raw = Some(rw);
                (w, c, r)
            } else {
                pbf::read_area_path(pbf_path, &boundary)?
            };
            lap("cut to the boundary", &mut sum);
            fixes.apply_to_ways(&mut ways)?;
            (ways, coords, Some(relations))
        }
        None => {
            let mut ways = pbf::read_ways(pbf_path)?;
            lap("read ways", &mut sum);
            // duckOSM: the fixes on the raw ways come before any step reads them
            fixes.apply_to_ways(&mut ways)?;
            let coords = pbf::read_coords(pbf_path, &ways)?;
            lap("read nodes", &mut sum);
            (ways, coords, None)
        }
    };
    fixes.add_new_nodes(&mut ways, &mut coords);
    if let Some(r) = raw.as_mut() {
        r.set_arrows(&fixes, |id| {
            ways.binary_search_by_key(&id, |w| w.id).is_ok()
        });
    }
    let relations = if p.options.extract_restrictions && p.modes.contains(&Mode::Driving) {
        match area_relations {
            Some(r) => r,
            None => {
                let r = pbf::read_restrictions(pbf_path)?;
                lap("read restrictions", &mut sum);
                r
            }
        }
    } else {
        Vec::new()
    };
    if p.infer_sidewalks && p.modes.contains(&Mode::Walking) {
        let ids = sidewalks::infer_separate_sidewalks(&mut ways, &coords);
        sum.sidewalk_roads = ids.len();
        if let Some(r) = raw.as_mut() {
            r.mark_sidewalks(&ids);
        }
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
        let net = build_network_with(&ways, &coords, *mode, &p.options, &fixes, &relations)?;
        lap(&format!("build {}", mode.name()), &mut sum);
        let n = mode.name();
        write_tables(&net, *mode, &p.options, |name| {
            let path = pq_dir.join(name);
            sum.files
                .push((name.trim_end_matches(".parquet").to_string(), path.clone()));
            std::fs::File::create(&path).map_err(|e| e.to_string())
        })?;
        lap(&format!("write geoparquet {n}"), &mut sum);
        sum.modes.push(ModeSummary {
            mode: *mode,
            edges: net.edges.len(),
            nodes: net.nodes.len(),
            private_edges: net.private_edges.len(),
            edge_id_map: net.edge_id_map.len(),
            connectors: net.stats.connectors,
            osm_fixes: net.stats.osm_fixes,
            edge_graph: net.graph.edge_graph.as_ref().map_or(0, Vec::len),
            turn_restrictions: net.graph.turn_restrictions.as_ref().map_or(0, Vec::len),
        });
    }
    if let Some(r) = &raw {
        write_raw(r, |name| {
            let path = out.join(name);
            sum.files
                .push((name.trim_end_matches(".parquet").to_string(), path.clone()));
            std::fs::File::create(&path).map_err(|e| e.to_string())
        })?;
        lap("write raw", &mut sum);
    }
    if p.geoparquet {
        write_layers_json(&pq_dir, &sum)?;
        sum.files
            .push(("layers".to_string(), pq_dir.join("layers.json")));
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
