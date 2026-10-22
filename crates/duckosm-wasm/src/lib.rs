//! The network step in WebAssembly: the bytes of a `.osm.pbf` file in, GeoParquet bytes out.

use duckosm_core::filter::Mode;
use duckosm_core::network::{build_network, Options};
use duckosm_core::{pbf, sidewalks};
use wasm_bindgen::prelude::*;

/// The Parquet files of one mode, as bytes. The names are the names of the files of the CLI.
#[wasm_bindgen(getter_with_clone)]
pub struct Network {
    pub edges: Vec<u8>,
    pub nodes: Vec<u8>,
    pub private_edges: Vec<u8>,
    /// Empty when `merge_segments` is off.
    pub edge_id_map: Vec<u8>,
    pub summary: String,
}

/// Build the network of `mode` (driving, walking or cycling) with the default options of the CLI
/// (`duckosm_build::Params::default`).
#[wasm_bindgen]
pub fn build(pbf_bytes: &[u8], mode: &str) -> Result<Network, JsError> {
    run(pbf_bytes, mode).map_err(|e| JsError::new(&e))
}

pub fn run(pbf_bytes: &[u8], mode: &str) -> Result<Network, String> {
    let mode = Mode::parse(mode)
        .ok_or_else(|| format!("unknown mode '{mode}' (use driving, walking or cycling)"))?;
    let opts = Options::default();
    let mut ways = pbf::read_ways_bytes(pbf_bytes)?;
    let coords = pbf::read_coords_bytes(pbf_bytes, &ways)?;
    // the same steps as duckosm_build::build, which uses files and a clock (none in WebAssembly)
    if mode == Mode::Walking {
        sidewalks::infer_separate_sidewalks(&mut ways, &coords);
    }
    let net = build_network(&ways, &coords, mode, &opts)?;
    let oc = duckosm_parquet::EdgeCols::of(mode, &opts);
    let mut out = Network {
        edges: Vec::new(),
        nodes: Vec::new(),
        private_edges: Vec::new(),
        edge_id_map: Vec::new(),
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
