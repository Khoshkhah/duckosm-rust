//! Read a duckOSM config file (YAML) into the parameters of a build.
//!
//! The keys and their defaults are those of duckOSM (`src/duckosm/config.py`). The rules:
//! - A key that duckOSM does not know is an error (duckOSM only warns, but it is almost always a typo).
//! - A key that changes the result and that this program does not support is an error.
//! - A step that duckOSM runs and that this program does not have (for example H3, the edge graph, the
//!   base-map layers) is an error in strict mode. With `strict = false` the build goes on, and the step
//!   is in the list `skipped`.
//! - A key that only tunes duckOSM's DuckDB (memory, threads, batches) has no effect here. It is in the
//!   list `ignored`.

use crate::Params;
use duckosm_core::filter::Mode;
use duckosm_core::network::Options;
use std::path::{Path, PathBuf};
use yaml_rust2::{Yaml, YamlLoader};

/// A config file read into a build.
#[derive(Clone, Debug)]
pub struct FromConfig {
    pub pbf: PathBuf,
    /// The output folder.
    pub out: PathBuf,
    pub params: Params,
    /// Steps of duckOSM that this program does not run (only with `strict = false`).
    pub skipped: Vec<String>,
    /// Keys that have no effect in this program.
    pub ignored: Vec<String>,
}

const TOP: [&str; 15] = [
    "name",
    "output_path",
    "osm_overrides",
    "modes",
    "options",
    "source",
    "boundary",
    "clip",
    "validation",
    "report",
    "viz",
    "multimodal",
    "pbf_path",
    "boundary_path",
    "h3_cell",
];
const OPTIONS: [&str; 21] = [
    "build_graph",
    "h3_indexing",
    "h3_resolution",
    "merge_segments",
    "global_junctions",
    "infer_separate_sidewalks",
    "functional_types",
    "cycling_dismount",
    "process_speeds",
    "extract_restrictions",
    "calculate_costs",
    "memory_limit",
    "threads",
    "simplify_batches",
    "boundary_cells",
    "boundary_cell_resolutions",
    "build_features",
    "levels",
    "bus_routes",
    "sea",
    "clip_strategy",
];
const SOURCE: [&str; 3] = ["type", "pbf_path", "source_db"];
const BOUNDARY: [&str; 5] = ["path", "place", "bbox", "h3_cell", "buffer_m"];
const CLIP: [&str; 5] = [
    "predicate",
    "keep_largest_component",
    "min_component_edges",
    "connectivity_rescue",
    "connect_snap_m",
];
const VALIDATION: [&str; 7] = [
    "enabled",
    "fail_on_error",
    "assert_single_component",
    "assert_no_stranded_named",
    "assert_unique_node_id",
    "assert_way_length_conserved",
    "warn_layer_without_structure",
];
const REPORT: [&str; 1] = ["enabled"];
const VIZ: [&str; 2] = ["enabled", "basemap"];
const MULTIMODAL: [&str; 3] = ["enabled", "transfer_s", "transfer_costs"];

struct Section<'a> {
    name: &'a str,
    map: Option<&'a yaml_rust2::yaml::Hash>,
}

impl<'a> Section<'a> {
    fn get(&self, key: &str) -> Option<&'a Yaml> {
        self.map
            .and_then(|m| m.get(&Yaml::String(key.to_string())))
            .filter(|v| !v.is_null())
    }
    fn bool(&self, key: &str, default: bool) -> Result<bool, String> {
        match self.get(key) {
            None => Ok(default),
            Some(Yaml::Boolean(b)) => Ok(*b),
            Some(v) => Err(format!(
                "{}.{key}: must be true or false, not {v:?}",
                self.name
            )),
        }
    }
    fn f64(&self, key: &str, default: f64) -> Result<f64, String> {
        match self.get(key) {
            None => Ok(default),
            Some(Yaml::Integer(i)) => Ok(*i as f64),
            Some(Yaml::Real(r)) => r
                .parse()
                .map_err(|_| format!("{}.{key}: not a number", self.name)),
            Some(v) => Err(format!("{}.{key}: must be a number, not {v:?}", self.name)),
        }
    }
    fn str(&self, key: &str) -> Result<Option<String>, String> {
        match self.get(key) {
            None => Ok(None),
            Some(Yaml::String(s)) => Ok(Some(s.clone())),
            Some(v) => Err(format!("{}.{key}: must be a text, not {v:?}", self.name)),
        }
    }
    fn check_keys(&self, known: &[&str]) -> Result<(), String> {
        if let Some(m) = self.map {
            for k in m.keys() {
                let k = k.as_str().unwrap_or("?");
                if !known.contains(&k) {
                    let prefix = if self.name.is_empty() {
                        String::new()
                    } else {
                        format!("{}.", self.name)
                    };
                    return Err(format!("config: unknown key '{prefix}{k}' (duckOSM does not know it either; a typo?)"));
                }
            }
        }
        Ok(())
    }
}

fn section<'a>(root: &'a yaml_rust2::yaml::Hash, name: &'a str) -> Result<Section<'a>, String> {
    match root.get(&Yaml::String(name.to_string())) {
        None | Some(Yaml::Null) => Ok(Section { name, map: None }),
        Some(Yaml::Hash(h)) => Ok(Section { name, map: Some(h) }),
        Some(_) => Err(format!(
            "config: '{name}' must be a section (a map of keys)"
        )),
    }
}

/// Read the config file. `pbf_is_cut`: the PBF is already cut to the boundary of the config (this
/// program does not cut). `strict`: a duckOSM step that this program does not have is an error.
pub fn read(path: &Path, pbf_is_cut: bool, strict: bool) -> Result<FromConfig, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let docs = YamlLoader::load_from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    let empty = yaml_rust2::yaml::Hash::new();
    let root = match docs.first() {
        None | Some(Yaml::Null) => &empty,
        Some(Yaml::Hash(h)) => h,
        Some(_) => return Err("config: the file must be a map of keys".into()),
    };
    let top = Section {
        name: "",
        map: Some(root),
    };
    top.check_keys(&TOP)?;
    let (options, source, boundary, clip) = (
        section(root, "options")?,
        section(root, "source")?,
        section(root, "boundary")?,
        section(root, "clip")?,
    );
    let (validation, report, viz, multimodal) = (
        section(root, "validation")?,
        section(root, "report")?,
        section(root, "viz")?,
        section(root, "multimodal")?,
    );
    options.check_keys(&OPTIONS)?;
    source.check_keys(&SOURCE)?;
    boundary.check_keys(&BOUNDARY)?;
    clip.check_keys(&CLIP)?;
    validation.check_keys(&VALIDATION)?;
    report.check_keys(&REPORT)?;
    viz.check_keys(&VIZ)?;
    multimodal.check_keys(&MULTIMODAL)?;

    let mut skipped: Vec<String> = Vec::new();
    let mut ignored: Vec<String> = Vec::new();
    let mut skip = |what: String| -> Result<(), String> {
        if strict {
            Err(format!("config: {what}. Switch it off (or remove it) in the config, or build with strict=false (CLI: --allow-skipped)"))
        } else {
            skipped.push(what);
            Ok(())
        }
    };

    // the input
    let stype = source.str("type")?.unwrap_or_else(|| "pbf".into());
    if stype != "pbf" {
        return Err(format!(
            "config: source.type: {stype} is not supported (only pbf)"
        ));
    }
    let pbf = source
        .str("pbf_path")?
        .or(top.str("pbf_path")?)
        .filter(|s| !s.is_empty())
        .ok_or("config: pbf_path (or source.pbf_path) is required")?;
    let pbf = PathBuf::from(pbf);
    if !pbf.exists() {
        return Err(format!("PBF file not found: {}", pbf.display()));
    }

    // the area: this program does not cut the PBF
    for k in ["place", "bbox", "h3_cell", "buffer_m"] {
        if boundary.get(k).is_some() {
            return Err(format!(
                "config: boundary.{k} is not supported (cut the PBF first and use boundary.path)"
            ));
        }
    }
    if top.get("h3_cell").is_some() {
        return Err("config: h3_cell is not supported (cut the PBF first)".into());
    }
    let has_boundary = boundary
        .str("path")?
        .or(top.str("boundary_path")?)
        .is_some();
    if has_boundary && !pbf_is_cut {
        return Err("config: a boundary is set, but this program does not cut the PBF. Cut it to the boundary \
                    (osmium, or `duckosm clip-pbf`), and build with pbf_is_cut=true (CLI: --pbf-is-cut)".into());
    }
    if let Some(p) = clip.str("predicate")? {
        if p != "intersects" {
            return Err(format!(
                "config: clip.predicate: {p} is not supported (only intersects)"
            ));
        }
    }
    if clip.f64("min_component_edges", 1.0)? > 1.0 {
        return Err("config: clip.min_component_edges > 1 is not supported".into());
    }
    if top.str("osm_overrides")?.is_some() {
        skip("osm_overrides (the OSM fixes) are not applied".into())?;
    }

    // the modes
    let modes: Vec<String> = match top.get("modes") {
        None => vec!["driving".into()],
        Some(Yaml::Array(a)) => a
            .iter()
            .map(|m| {
                m.as_str()
                    .map(str::to_string)
                    .ok_or("config: modes must be a list of names")
            })
            .collect::<Result<_, _>>()?,
        Some(_) => return Err("config: modes must be a list".into()),
    };
    let modes = Mode::parse_all(&modes)?;

    // the steps of duckOSM that are not here (on by default in duckOSM)
    let build_graph = options.bool("build_graph", true)?;
    for (key, default, what) in [
        ("build_graph", true, "the graph of legal turns (edge_graph)"),
        (
            "h3_indexing",
            true,
            "the H3 cells (from_cell, to_cell, lca_res, h3_cell)",
        ),
        ("extract_restrictions", true, "the turn restrictions"),
        ("build_features", true, "the base-map layers (features.*)"),
        (
            "levels",
            true,
            "the drawing order (visualization.edge_levels)",
        ),
        ("bus_routes", true, "the bus routes (bus.*)"),
        ("boundary_cells", false, "the boundary cells"),
    ] {
        if options.bool(key, default)? {
            skip(format!(
                "options.{key} is on{}, but this program does not make {what}",
                if options.get(key).is_none() {
                    " by default"
                } else {
                    ""
                }
            ))?;
        }
    }
    let sea = match options.get("sea") {
        None => Some("overture".to_string()),
        Some(Yaml::Boolean(false)) => None,
        Some(Yaml::String(s)) if s == "false" => None,
        Some(Yaml::String(s)) => Some(s.clone()),
        Some(v) => return Err(format!("options.sea: {v:?} is not one of overture, false")),
    };
    if sea.is_some() && options.bool("build_features", true)? {
        skip("options.sea is on, but this program does not make the sea (features.ocean)".into())?;
    }
    for (sec, what) in [
        (&validation, "the build checks"),
        (&report, "the build report"),
        (&viz, "the maps"),
        (&multimodal, "the multimodal graph"),
    ] {
        if sec.bool("enabled", false)? {
            skip(format!(
                "{}.enabled is on, but this program does not make {what}",
                sec.name
            ))?;
        }
    }
    for k in [
        "memory_limit",
        "threads",
        "simplify_batches",
        "clip_strategy",
        "h3_resolution",
        "boundary_cell_resolutions",
    ] {
        if options.get(k).is_some() {
            ignored.push(format!("options.{k} (no effect in this program)"));
        }
    }

    let opts = Options {
        // duckOSM runs the component filter only with a boundary and with the edge graph
        keep_largest_component: has_boundary
            && build_graph
            && clip.bool("keep_largest_component", true)?,
        cycling_dismount: options.bool("cycling_dismount", true)?,
        merge_segments: options.bool("merge_segments", true)?,
        global_junctions: options.bool("global_junctions", true)?,
        connect_paths: clip.bool("connectivity_rescue", true)?,
        snap_m: clip.f64("connect_snap_m", 10.0)?,
        process_speeds: options.bool("process_speeds", true)?,
        calculate_costs: options.bool("calculate_costs", true)?,
        functional_types: options.bool("functional_types", true)?,
    };
    if opts.calculate_costs && !opts.process_speeds {
        return Err("config: options.calculate_costs needs options.process_speeds".into());
    }

    // the output: like duckOSM, a path that ends in .duckdb is the file, else it is the folder
    let name = top.str("name")?.unwrap_or_else(|| "default".into());
    let out_path = PathBuf::from(
        top.str("output_path")?
            .unwrap_or_else(|| "output.duckdb".into()),
    );
    let (out, name) = if out_path.extension().is_some_and(|e| e == "duckdb") {
        let stem = out_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or(name);
        (
            out_path.parent().map(Path::to_path_buf).unwrap_or_default(),
            stem,
        )
    } else {
        (out_path, name)
    };
    let out = if out.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        out
    };
    let params = Params {
        modes,
        name,
        options: opts,
        infer_sidewalks: options.bool("infer_separate_sidewalks", true)?,
        ..Params::default()
    };
    Ok(FromConfig {
        pbf,
        out,
        params,
        skipped,
        ignored,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(text: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("duckosm-config-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(format!("c{}.yaml", text.len()));
        std::fs::write(&p, text).unwrap();
        p
    }

    fn pbf() -> String {
        format!(
            "{}/../../tests/data/monaco_sample.osm.pbf",
            env!("CARGO_MANIFEST_DIR")
        )
    }

    #[test]
    fn defaults_need_strict_off() {
        let c = write(&format!("name: m\noutput_path: out\npbf_path: {}\n", pbf()));
        let e = read(&c, false, true).unwrap_err();
        assert!(e.contains("build_graph"), "{e}");
        let r = read(&c, false, false).unwrap();
        assert!(r.skipped.iter().any(|s| s.contains("h3_indexing")));
        assert_eq!(r.params.name, "m");
        assert!(r.params.options.merge_segments && !r.params.options.keep_largest_component);
    }

    #[test]
    fn unknown_key_and_boundary() {
        let c = write(&format!(
            "pbf_path: {}\noptions:\n  merge_segment: false\n",
            pbf()
        ));
        assert!(read(&c, false, false)
            .unwrap_err()
            .contains("merge_segment"));
        let c = write(&format!(
            "pbf_path: {}\nboundary:\n  path: x.geojson\n",
            pbf()
        ));
        assert!(read(&c, false, false).unwrap_err().contains("pbf_is_cut"));
    }

    #[test]
    fn all_off_is_strict_ok_and_output_file() {
        let c = write(&format!(
            "name: m\noutput_path: out/area.duckdb\nsource:\n  type: pbf\n  pbf_path: {}\nmodes: [driving, walking]\n\
             options:\n  build_graph: false\n  h3_indexing: false\n  extract_restrictions: false\n  build_features: false\n  \
             levels: false\n  bus_routes: false\n  merge_segments: false\n  threads: 4\n",
            pbf()
        ));
        let r = read(&c, false, true).unwrap();
        assert_eq!(r.params.name, "area");
        assert_eq!(r.out, PathBuf::from("out"));
        assert_eq!(r.params.modes, vec![Mode::Driving, Mode::Walking]);
        assert!(!r.params.options.merge_segments);
        assert_eq!(r.ignored.len(), 1);
    }
}
