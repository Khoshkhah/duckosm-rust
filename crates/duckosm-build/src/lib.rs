//! The whole build, shared by the CLI, the Python module and the browser (duckosm-wasm): read a PBF, build the
//! networks of the modes, write GeoParquet and/or a `.duckdb` file.

use duckosm_core::boundary::Boundary;
use duckosm_core::filter::Mode;
use duckosm_core::fixes::OsmFixes;
use duckosm_core::graph::Relation;
use duckosm_core::lanes::LaneEdges;
use duckosm_core::levels::LevelEdges;
use duckosm_core::model::{Network, Way};
use duckosm_core::network::{build_network_with, Coords, Options};
use duckosm_core::osmjson::OsmJson;
use duckosm_core::raw::Raw;
use duckosm_core::{pbf, sidewalks};
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};

pub mod area;
pub mod config;

pub use area::{write_area_tables, write_lane_profile, write_levels, Area};

pub use duckosm_core::filter::Mode as NetworkMode;
pub use duckosm_core::levels::Method as LevelsMethod;
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
    /// The boundary of the area for `main.boundary` and `main.visualization_metadata`, when the PBF is
    /// already cut to it (a config with `--pbf-is-cut`). `boundary` is used when this is None.
    pub area_boundary: Option<PathBuf>,
    /// The build time in `main.visualization_metadata` (microseconds since 1970, UTC). None: now. A fixed
    /// value makes the output the same on each run.
    pub built_at: Option<i64>,
    /// The entry of the area's Geofabrik region in the page's time zone table (`www/timezones.json`, JSON text):
    /// the browser build has no world map of the zones. None: the map of `tzf-rs` (the cargo feature `tzf`).
    pub timezone_entry: Option<String>,
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
            area_boundary: None,
            built_at: None,
            timezone_entry: None,
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
    /// Roads that got `sidewalk=separate`, when the sidewalk rule ran.
    pub sidewalk_roads: Option<usize>,
    /// The number of bus routes, when they were made.
    pub bus_routes: Option<usize>,
    /// The rows of `raw.nodes`, `raw.ways` and `raw.relations`, when they were written.
    pub raw: Option<(usize, usize, usize)>,
    /// A summary of the drawing levels, when they were made.
    pub levels: Option<String>,
    /// A summary of the lane profile, when the driving mode was built.
    pub lanes: Option<String>,
}

impl Summary {
    /// The result as lines of text: the CLI prints them and the page shows them.
    pub fn lines(&self) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(n) = self.sidewalk_roads {
            out.push(format!("sidewalk rule: {n} roads get sidewalk=separate"));
        }
        for m in &self.modes {
            out.push(format!(
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
            ));
        }
        if let Some(n) = self.bus_routes {
            out.push(format!("bus: {n} routes"));
        }
        if let Some((n, w, r)) = self.raw {
            out.push(format!("raw: {n} nodes, {w} ways, {r} relations"));
        }
        out.extend(self.levels.iter().chain(&self.lanes).cloned());
        out
    }
}

/// Write the tables of one mode, each to a writer from `file`, which gets the file name (for example
/// `edges_driving.parquet`). The native build and the browser build (duckosm-wasm) both use it, so they
/// write the same tables: the edges, the private edges, the nodes, `edge_id_map` (with `merge_segments`),
/// and the tables of the edge graph and the turn restrictions that the options made.
pub fn write_tables<W: Write + Send>(
    net: &Network,
    mode: Mode,
    opts: &Options,
    all_ways: &[Way],
    mut file: impl FnMut(&str) -> Result<W, String>,
) -> Result<(), String> {
    use duckosm_parquet as pq;
    let n = mode.name();
    let mut out = |table: &str| file(&format!("{table}_{n}.parquet"));
    let oc = pq::EdgeCols::of(mode, opts);
    pq::write_edges_to(out("edges")?, &net.edges, oc)?;
    pq::write_edges_to(out("private_edges")?, &net.private_edges, oc)?;
    pq::write_nodes_to(out("nodes")?, &net.nodes)?;
    // duckOSM: left over from its build and always empty (the virtual nodes are in `nodes`)
    pq::write_nodes_to(out("virtual_nodes")?, &[])?;
    if opts.ways_tables {
        pq::write_ways_to(out("ways")?, &net.ways, all_ways)?;
        pq::write_way_nodes_to(out("way_nodes")?, &net.ways)?;
    }
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

/// Write `bus.routes` and `bus.route_edges` (docs/bus.md) of the driving network `net`, from the route relations and
/// the ways of the raw cut: `routes_bus.parquet` and `route_edges_bus.parquet`. Returns the number of routes.
pub fn write_bus<W: Write + Send>(
    raw: &Raw,
    net: &Network,
    mut file: impl FnMut(&str) -> Result<W, String>,
) -> Result<usize, String> {
    let (routes, edges) =
        duckosm_core::bus::routes(&raw.relations, &raw.ways, &net.edges, &net.private_edges);
    duckosm_parquet::write_routes_to(file("routes_bus.parquet")?, &routes)?;
    duckosm_parquet::write_route_edges_to(file("route_edges_bus.parquet")?, &edges)?;
    Ok(routes.len())
}

/// Write duckOSM's `raw.*` tables, each to a writer from `file`: `raw_nodes.parquet`, `raw_ways.parquet` and
/// `raw_relations.parquet`. `features.sql` loads them and makes the base-map layers.
pub fn write_raw<W: Write + Send>(
    raw: &Raw,
    mut file: impl FnMut(&str) -> Result<W, String>,
) -> Result<(), String> {
    use duckosm_parquet as pq;
    pq::write_raw_nodes_to(file("raw_nodes.parquet")?, &raw.nodes)?;
    pq::write_raw_ways_to(file("raw_ways.parquet")?, &raw.ways, &raw.nodes)?;
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

impl Params {
    /// Set the output formats from their names: `duckdb`, `geoparquet`. Without a call, the formats are both, or
    /// geoparquet when the cargo feature `duckdb` is off.
    pub fn set_formats<S: AsRef<str>>(&mut self, formats: &[S]) -> Result<(), String> {
        self.geoparquet = false;
        self.duckdb = false;
        for f in formats {
            match f.as_ref().trim() {
                "duckdb" => self.duckdb = true,
                "geoparquet" => self.geoparquet = true,
                f => return Err(format!("unknown format '{f}' (use duckdb or geoparquet)")),
            }
        }
        Ok(())
    }
}

/// The method of the drawing levels from its name: tags, solve or none.
pub fn parse_levels(name: &str) -> Result<LevelsMethod, String> {
    LevelsMethod::parse(name).ok_or_else(|| format!("levels: '{name}' is not tags, solve or none"))
}

/// A file that the cut can read and seek in.
pub trait Source: Read + Seek + Send {}
impl<T: Read + Seek + Send> Source for T {}

/// A new reader of a PBF file for each pass of the cut.
pub type Open<'a> = &'a dyn Fn() -> Result<pbf::BlobReader<Box<dyn Source + 'a>>, String>;

/// The input of [`run`]: a `.osm.pbf` file (its path, or its bytes in WebAssembly), OSM JSON (the output of the
/// Overpass API; with a boundary, only the ways with a node inside are kept), or a region PBF and a boundary (the
/// PBF is cut to the boundary, as osmium's `complete_ways` does).
#[derive(Clone, Copy)]
pub enum Input<'a> {
    Path(&'a Path),
    Pbf(&'a [u8]),
    OsmJson(&'a [u8], Option<&'a Boundary>),
    Area(Open<'a>, &'a Boundary),
}

/// The time and the memory of each step of [`run`]. The caller gives the clock: WebAssembly has no clock in std.
pub struct StepLog {
    clock: fn() -> f64,
    memory: fn() -> f64,
    last: f64,
    /// The name of each step, its milliseconds, and the memory in MiB after it (0 when not known).
    pub rows: Vec<(String, f64, f64)>,
}

impl StepLog {
    /// `clock` gives milliseconds, `memory` the memory in MiB.
    pub fn new(clock: fn() -> f64, memory: fn() -> f64) -> StepLog {
        StepLog {
            clock,
            memory,
            last: clock(),
            rows: Vec::new(),
        }
    }

    /// The system clock and no memory (not in WebAssembly).
    pub fn system() -> StepLog {
        StepLog::new(
            || {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0.0, |d| d.as_secs_f64() * 1000.0)
            },
            || 0.0,
        )
    }

    /// The end of a step: its time since the step before, and the memory now.
    pub fn step(&mut self, name: &str) {
        let t = (self.clock)();
        self.rows
            .push((name.to_string(), t - self.last, (self.memory)()));
        self.last = t;
    }

    /// The steps as JSON (the names are plain text, with no quotes).
    pub fn json(&self) -> String {
        let rows: Vec<String> = self
            .rows
            .iter()
            .map(|(s, ms, mib)| format!(r#"{{"step":"{s}","ms":{ms:.1},"mib":{mib:.1}}}"#))
            .collect();
        format!("[{}]", rows.join(","))
    }
}

/// Read a PBF file in passes: the ways, the OSM fixes on them, the coordinates of their nodes, and the turn
/// restrictions when `relations` is true.
fn read_pbf(
    ways: impl FnOnce() -> Result<Vec<Way>, String>,
    coords: impl FnOnce(&[Way]) -> Result<Coords, String>,
    restrictions: impl FnOnce() -> Result<Vec<Relation>, String>,
    relations: bool,
    fixes: &OsmFixes,
    log: &mut StepLog,
) -> Result<(Vec<Way>, Coords, Vec<Relation>), String> {
    let mut ways = ways()?;
    log.step("read ways");
    // duckOSM: the fixes on the raw ways come before any step reads them
    fixes.apply_to_ways(&mut ways)?;
    let coords = coords(&ways)?;
    log.step("read nodes");
    let mut rels = Vec::new();
    if relations {
        rels = restrictions()?;
        log.step("read restrictions");
    }
    Ok((ways, coords, rels))
}

/// The whole build without a file system, for the native build and the browser build (duckosm-wasm): read the
/// input with the OSM fixes, the sidewalk rule, each mode (written with [`write_tables`]), the bus routes, `raw.*`,
/// the area tables (`boundary` is the boundary file, GeoJSON text), the drawing levels and the lane profile. Each
/// file goes to a writer from `file`, which gets the file name. `log` gets the end of each step.
pub fn run<W: Write + Send>(
    input: Input,
    fixes: &OsmFixes,
    boundary: Option<&str>,
    p: &Params,
    log: &mut StepLog,
    mut file: impl FnMut(&str) -> Result<W, String>,
) -> Result<Summary, String> {
    let opts = &p.options;
    let driving = p.modes.contains(&Mode::Driving);
    let need_relations = opts.extract_restrictions && driving;
    // the bus routes need the route relations and the member ways of the raw cut (docs/bus.md)
    let bus = opts.bus_routes && driving;
    if p.raw && !matches!(input, Input::Area(..)) {
        return Err("raw.* (the base-map layers) needs a boundary".into());
    }
    let mut raw = None;
    let (mut ways, mut coords, relations) = match input {
        Input::Path(path) => read_pbf(
            || pbf::read_ways(path),
            |w| pbf::read_coords(path, w),
            || pbf::read_restrictions(path),
            need_relations,
            fixes,
            log,
        )?,
        Input::Pbf(bytes) => read_pbf(
            || pbf::read_ways_bytes(bytes),
            |w| pbf::read_coords_bytes(bytes, w),
            || pbf::read_restrictions_bytes(bytes),
            need_relations,
            fixes,
            log,
        )?,
        // duckOSM with a boundary: cut the PBF (osmium complete_ways, or smart for raw.*), then the fixes on the raw ways
        Input::Area(open, boundary) => {
            let (mut ways, coords, relations) = if p.raw || bus {
                let (w, c, r, mut rw) = pbf::read_area_raw(open, boundary)?;
                rw.apply_fixes(fixes);
                raw = Some(rw);
                (w, c, r)
            } else {
                pbf::read_area(open, boundary)?
            };
            log.step("cut to the boundary");
            fixes.apply_to_ways(&mut ways)?;
            (ways, coords, relations)
        }
        Input::OsmJson(bytes, boundary) => {
            let mut data = OsmJson::read(bytes)?;
            if let Some(b) = boundary {
                data.cut(b);
            }
            let mut ways = std::mem::take(&mut data.ways);
            fixes.apply_to_ways(&mut ways)?;
            let coords = data.coords(&ways);
            log.step("read the file");
            (ways, coords, data.relations)
        }
    };
    let relations = if need_relations {
        relations
    } else {
        Vec::new()
    };
    fixes.add_new_nodes(&mut ways, &mut coords);
    let mut sum = Summary::default();
    if p.infer_sidewalks && p.modes.contains(&Mode::Walking) {
        sum.sidewalk_roads = Some(sidewalks::infer_separate_sidewalks(&mut ways, &coords));
        log.step("sidewalk rule");
    }
    let mut mode_nodes = Vec::new();
    let mut level_edges = LevelEdges::default();
    let mut lane_edges = LaneEdges::default();
    for mode in &p.modes {
        let n = mode.name();
        let net = build_network_with(&ways, &coords, *mode, opts, fixes, &relations)?;
        log.step(&format!("build {n}"));
        write_tables(&net, *mode, opts, &ways, &mut file)?;
        log.step(&format!("write geoparquet {n}"));
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
        // duckOSM: the arrows of the fixes go into the raw tags after this mode, so the next modes see them
        fixes.set_arrows(&mut ways, &net.ways, *mode);
        lane_edges.add(*mode, &net);
        if opts.levels != LevelsMethod::None {
            level_edges.add(*mode, false, &net.edges);
            level_edges.add(*mode, true, &net.private_edges);
        }
        if let Some(r) = raw.as_ref().filter(|_| *mode == Mode::Driving && bus) {
            sum.bus_routes = Some(write_bus(r, &net, &mut file)?);
            log.step("bus routes");
        }
        mode_nodes.push((*mode, net.nodes));
    }
    if let Some(r) = raw.as_mut().filter(|_| p.raw) {
        // the tags that the steps set on the network's ways (the sidewalk rule, the arrows of the fixes)
        r.sync_tags(&ways);
        write_raw(r, &mut file)?;
        sum.raw = Some((r.nodes.len(), r.ways.len(), r.relations.len()));
        log.step("write raw");
    }
    let built_at = p.built_at.unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_micros() as i64)
    });
    let area = Area {
        boundary,
        ways: &ways,
        coords: &coords,
        nodes: &mode_nodes,
        opts,
        built_at,
        timezone_entry: p.timezone_entry.as_deref(),
    };
    write_area_tables(&area, &mut file)?;
    log.step("write the area tables");
    sum.levels = write_levels(&level_edges, opts.levels, built_at, &mut file)?;
    if sum.levels.is_some() {
        log.step("levels");
    }
    sum.lanes = write_lane_profile(&lane_edges, &ways, fixes, &mut file)?;
    if sum.lanes.is_some() {
        log.step("lane profile");
    }
    Ok(sum)
}

/// Build from the PBF file `pbf_path` (cut to `p.boundary` when there is one) and write the files into `out`.
pub fn build(pbf_path: &Path, out: &Path, p: &Params) -> Result<Summary, String> {
    if p.duckdb && !cfg!(feature = "duckdb") {
        return Err("this build has no DuckDB output (cargo feature 'duckdb' is off)".into());
    }
    if !p.geoparquet && !p.duckdb {
        return Err("no output format: use geoparquet, duckdb or both".into());
    }
    std::fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let mut log = StepLog::system();
    let fixes = match &p.osm_fixes {
        Some(f) => config::read_osm_fixes(f)?,
        None => OsmFixes::default(),
    };
    let read = |path: &PathBuf| {
        std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
    };
    let cut = match &p.boundary {
        Some(path) => Some(Boundary::parse(&read(path)?)?),
        None => None,
    };
    if p.options.bus_routes && p.modes.contains(&Mode::Driving) && cut.is_none() {
        eprintln!("no bus tables: the build has no area outline (--boundary)");
    }
    let area_boundary = match p.area_boundary.as_ref().or(p.boundary.as_ref()) {
        Some(path) => Some(read(path)?),
        None => None,
    };
    let open = || -> Result<pbf::BlobReader<Box<dyn Source>>, String> {
        let f =
            std::fs::File::open(pbf_path).map_err(|e| format!("{}: {e}", pbf_path.display()))?;
        let r: Box<dyn Source> = Box::new(std::io::BufReader::new(f));
        pbf::BlobReader::new_seekable(r).map_err(|e| e.to_string())
    };
    let input = match &cut {
        Some(b) => Input::Area(&open, b),
        None => Input::Path(pbf_path),
    };
    // the GeoParquet files are the input of the .duckdb writer, so they always go to a folder
    let pq_dir = if p.geoparquet {
        out.to_path_buf()
    } else {
        std::env::temp_dir().join(format!("duckosm-{}", std::process::id()))
    };
    std::fs::create_dir_all(&pq_dir).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    let mut sum = run(
        input,
        &fixes,
        area_boundary.as_deref(),
        p,
        &mut log,
        |name| {
            // raw.* is not in the .duckdb file, so it goes to the output folder
            let path = if name.starts_with("raw_") {
                out
            } else {
                &pq_dir
            }
            .join(name);
            files.push((name.trim_end_matches(".parquet").to_string(), path.clone()));
            std::fs::File::create(&path).map_err(|e| e.to_string())
        },
    )?;
    sum.files = files;
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
        log.step("write duckdb");
    }
    if !p.geoparquet {
        let _ = std::fs::remove_dir_all(&pq_dir);
        sum.files.retain(|(k, _)| k == "duckdb");
    }
    sum.steps = log
        .rows
        .iter()
        .map(|(s, ms, _)| (s.clone(), ms / 1000.0))
        .collect();
    Ok(sum)
}
