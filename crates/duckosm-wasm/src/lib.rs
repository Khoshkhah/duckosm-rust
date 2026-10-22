//! duckOSM in the browser (docs/browser.md): the bytes of a `.osm.pbf` file in, duckOSM's tables of the
//! chosen modes out, as GeoParquet bytes. The same steps and the same writer as the native build.

use duckosm_build::{config::parse_osm_fixes, parse_modes, write_tables};
use duckosm_core::filter::Mode;
use duckosm_core::fixes::OsmFixes;
use duckosm_core::network::{build_network_with, Options};
use duckosm_core::{pbf, sidewalks};
use js_sys::{Array, Object, Reflect, Uint8Array};
use std::io::{self, BufWriter, Write};
use wasm_bindgen::prelude::*;

/// The result of [`build`]. `files` maps each file name (for example `edges_driving.parquet`) to an array
/// of `Uint8Array` parts: `new Blob(files[name])` gives the file.
#[wasm_bindgen(getter_with_clone)]
pub struct Output {
    pub files: Object,
    /// One line for each mode: the numbers of rows.
    pub summary: String,
}

/// Sends the bytes to a JavaScript array part by part, so the files are not kept in the WebAssembly
/// memory (at most 4 GB). The edges file of Kentucky is 400 MB.
struct JsParts(Array);

// SAFETY: ArrowWriter needs Send. This module has one thread (no atomics), so the value never moves
// to another thread.
unsafe impl Send for JsParts {}

impl Write for JsParts {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.push(&Uint8Array::from(buf));
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Build duckOSM's tables of `modes` (comma separated: driving, walking, cycling) with the default options of
/// the CLI. `fixes_yaml`: the text of an OSM fixes file (duckOSM `osm_overrides`), or nothing.
#[wasm_bindgen]
pub fn build(pbf_bytes: &[u8], modes: &str, fixes_yaml: Option<String>) -> Result<Output, JsError> {
    let files = Object::new();
    let summary = run(pbf_bytes, modes, fixes_yaml.as_deref(), |name| {
        let parts = Array::new();
        Reflect::set(&files, &name.into(), &parts).map_err(|_| format!("cannot keep {name}"))?;
        // the array is a JavaScript object: the writer and `files` share it
        Ok(BufWriter::with_capacity(1 << 20, JsParts(parts)))
    })
    .map_err(|e| JsError::new(&e))?;
    Ok(Output { files, summary })
}

/// The steps of `duckosm_build::build` without files and without a clock (WebAssembly has neither): the OSM
/// fixes, the relations for the turn restrictions, the sidewalk rule, then each mode, written with
/// `write_tables` to a writer from `file`. Returns one summary line for each mode.
pub fn run<W: Write + Send>(
    pbf_bytes: &[u8],
    modes: &str,
    fixes_yaml: Option<&str>,
    mut file: impl FnMut(&str) -> Result<W, String>,
) -> Result<String, String> {
    let modes = parse_modes(modes)?;
    let opts = Options::default();
    let fixes = match fixes_yaml {
        Some(text) => parse_osm_fixes(text, "the OSM fixes file")?,
        None => OsmFixes::default(),
    };
    let mut ways = pbf::read_ways_bytes(pbf_bytes)?;
    fixes.apply_to_ways(&mut ways)?;
    let mut coords = pbf::read_coords_bytes(pbf_bytes, &ways)?;
    fixes.add_new_nodes(&mut ways, &mut coords);
    let relations = if opts.extract_restrictions && modes.contains(&Mode::Driving) {
        pbf::read_restrictions_bytes(pbf_bytes)?
    } else {
        Vec::new()
    };
    if modes.contains(&Mode::Walking) {
        sidewalks::infer_separate_sidewalks(&mut ways, &coords);
    }
    let mut summary = Vec::new();
    for mode in &modes {
        let net = build_network_with(&ways, &coords, *mode, &opts, &fixes, &relations)?;
        write_tables(&net, *mode, &opts, &mut file)?;
        summary.push(format!(
            "{}: {} edges, {} nodes, {} private edges, {} edge_graph rows, {} turn restrictions",
            mode.name(),
            net.edges.len(),
            net.nodes.len(),
            net.private_edges.len(),
            net.graph.edge_graph.as_ref().map_or(0, Vec::len),
            net.graph.turn_restrictions.as_ref().map_or(0, Vec::len),
        ));
    }
    Ok(summary.join("\n"))
}
