//! The network step in WebAssembly: the bytes of a `.osm.pbf` file in, GeoParquet bytes out.

use duckosm_core::filter::Mode;
use duckosm_core::network::{build_network, Options};
use duckosm_core::{pbf, sidewalks};
use js_sys::{Array, Uint8Array};
use std::io::{self, BufWriter, Write};
use wasm_bindgen::prelude::*;

/// The Parquet files of one mode. Each file is an array of `Uint8Array` parts:
/// `new Blob(net.edges)` gives the file. The names are the names of the files of the CLI.
#[wasm_bindgen(getter_with_clone)]
pub struct Network {
    pub edges: Array,
    pub nodes: Array,
    pub private_edges: Array,
    /// Empty when `merge_segments` is off.
    pub edge_id_map: Array,
    pub summary: String,
}

/// Sends the bytes to JavaScript part by part, so the files are not kept in the WebAssembly
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

/// Build the network of `mode` (driving, walking or cycling) with the default options of the CLI
/// (`duckosm_build::Params::default`).
#[wasm_bindgen]
pub fn build(pbf_bytes: &[u8], mode: &str) -> Result<Network, JsError> {
    let files = run(pbf_bytes, mode, || {
        BufWriter::with_capacity(1 << 20, JsParts(Array::new()))
    })
    .map_err(|e| JsError::new(&e))?;
    let parts = |w: BufWriter<JsParts>| {
        w.into_inner()
            .map(|p| p.0)
            .map_err(|e| JsError::new(&e.to_string()))
    };
    Ok(Network {
        edges: parts(files.edges)?,
        nodes: parts(files.nodes)?,
        private_edges: parts(files.private_edges)?,
        edge_id_map: parts(files.edge_id_map)?,
        summary: files.summary,
    })
}

/// The four Parquet files of one mode, each in a writer from `new_file`.
pub struct Files<W> {
    pub edges: W,
    pub nodes: W,
    pub private_edges: W,
    pub edge_id_map: W,
    pub summary: String,
}

pub fn run<W: Write + Send>(
    pbf_bytes: &[u8],
    mode: &str,
    new_file: impl Fn() -> W,
) -> Result<Files<W>, String> {
    let mode = Mode::parse(mode)
        .ok_or_else(|| format!("unknown mode '{mode}' (use driving, walking or cycling)"))?;
    // the page writes only the four network files, so the edge graph would only use memory
    let opts = Options {
        build_graph: false,
        extract_restrictions: false,
        ..Options::default()
    };
    let mut ways = pbf::read_ways_bytes(pbf_bytes)?;
    let coords = pbf::read_coords_bytes(pbf_bytes, &ways)?;
    // the same steps as duckosm_build::build, which uses files and a clock (none in WebAssembly)
    if mode == Mode::Walking {
        sidewalks::infer_separate_sidewalks(&mut ways, &coords);
    }
    let net = build_network(&ways, &coords, mode, &opts)?;
    let oc = duckosm_parquet::EdgeCols::of(mode, &opts);
    // free them before the writers allocate their buffers
    drop((ways, coords));
    let mut out = Files {
        edges: new_file(),
        nodes: new_file(),
        private_edges: new_file(),
        edge_id_map: new_file(),
        summary: format!(
            "{}: {} edges, {} nodes, {} private edges",
            mode.name(),
            net.edges.len(),
            net.nodes.len(),
            net.private_edges.len()
        ),
    };
    duckosm_parquet::write_edges_to(&mut out.edges, &net.edges, oc)?;
    duckosm_parquet::write_edges_to(&mut out.private_edges, &net.private_edges, oc)?;
    duckosm_parquet::write_nodes_to(&mut out.nodes, &net.nodes)?;
    if opts.merge_segments {
        duckosm_parquet::write_edge_id_map_to(&mut out.edge_id_map, &net.edge_id_map)?;
    }
    Ok(out)
}
