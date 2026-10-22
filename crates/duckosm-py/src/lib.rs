//! Python module `duckosm_rust`: the network step of duckOSM.
//!
//! ```python
//! import duckosm_rust as dr
//! res = dr.build("monaco.osm.pbf", "out/", modes=["driving", "walking"])
//! res["modes"]["driving"]["edges"]      # 3092
//! dr.edge_id_hash(osm_id, source, target)
//! ```

use duckosm_build::{build as run_build, NetworkMode, NetworkOptions, Params};
use pyo3::exceptions::{PyRuntimeError, PyValueError};
use pyo3::prelude::*;
use pyo3::types::PyDict;
use std::path::PathBuf;

/// Build the networks of `modes` from `pbf` and write them into the folder `out`.
///
/// The keyword names are the option names of duckOSM. Returns a dict with the numbers of each mode, the
/// files that were written and the time of each step.
#[pyfunction]
#[pyo3(signature = (
    pbf, out, *, modes = vec!["driving".to_string()], formats = None, name = "area".to_string(),
    merge_segments = true, global_junctions = true, keep_largest_component = true,
    cycling_dismount = true, infer_separate_sidewalks = true, connectivity_rescue = true,
    connect_snap_m = 10.0, process_speeds = true, calculate_costs = true
))]
#[allow(clippy::too_many_arguments)]
fn build<'py>(
    py: Python<'py>,
    pbf: PathBuf,
    out: PathBuf,
    modes: Vec<String>,
    formats: Option<Vec<String>>,
    name: String,
    merge_segments: bool,
    global_junctions: bool,
    keep_largest_component: bool,
    cycling_dismount: bool,
    infer_separate_sidewalks: bool,
    connectivity_rescue: bool,
    connect_snap_m: f64,
    process_speeds: bool,
    calculate_costs: bool,
) -> PyResult<Bound<'py, PyDict>> {
    let mut p = Params {
        name,
        ..Params::default()
    };
    p.modes = NetworkMode::parse_all(&modes).map_err(PyValueError::new_err)?;
    let default = if cfg!(feature = "duckdb") {
        vec!["duckdb".to_string(), "geoparquet".to_string()]
    } else {
        vec!["geoparquet".to_string()]
    };
    p.geoparquet = false;
    p.duckdb = false;
    for f in formats.unwrap_or(default) {
        match f.as_str() {
            "duckdb" => p.duckdb = true,
            "geoparquet" => p.geoparquet = true,
            _ => {
                return Err(PyValueError::new_err(format!(
                    "unknown format '{f}' (use 'duckdb' or 'geoparquet')"
                )))
            }
        }
    }
    p.infer_sidewalks = infer_separate_sidewalks;
    p.options = NetworkOptions {
        keep_largest_component,
        cycling_dismount,
        merge_segments,
        global_junctions,
        connect_paths: connectivity_rescue,
        snap_m: connect_snap_m,
        process_speeds,
        calculate_costs,
    };
    // the build runs without the GIL, so other Python threads go on
    let sum = py
        .detach(|| run_build(&pbf, &out, &p))
        .map_err(PyRuntimeError::new_err)?;
    let res = PyDict::new(py);
    let modes = PyDict::new(py);
    for m in &sum.modes {
        let d = PyDict::new(py);
        d.set_item("edges", m.edges)?;
        d.set_item("nodes", m.nodes)?;
        d.set_item("private_edges", m.private_edges)?;
        d.set_item("edge_id_map", m.edge_id_map)?;
        d.set_item("connectors", m.connectors)?;
        modes.set_item(m.mode.name(), d)?;
    }
    res.set_item("modes", modes)?;
    let files = PyDict::new(py);
    for (k, v) in &sum.files {
        files.set_item(k, v.to_string_lossy().to_string())?;
    }
    res.set_item("files", files)?;
    let steps = PyDict::new(py);
    for (k, v) in &sum.steps {
        steps.set_item(k, v)?;
    }
    res.set_item("seconds", steps)?;
    res.set_item("sidewalk_roads", sum.sidewalk_roads)?;
    Ok(res)
}

/// The stable edge id of duckOSM: `(hash(osm_id, source, target) >> 1)` with the DuckDB hash.
#[pyfunction]
fn edge_id_hash(osm_id: i64, source: i64, target: i64) -> i64 {
    duckosm_core::hash::edge_id(osm_id, source, target)
}

#[pymodule]
fn duckosm_rust(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(build, m)?)?;
    m.add_function(wrap_pyfunction!(edge_id_hash, m)?)?;
    m.add("__version__", env!("CARGO_PKG_VERSION"))?;
    Ok(())
}
