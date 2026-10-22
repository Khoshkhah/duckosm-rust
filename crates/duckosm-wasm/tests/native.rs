//! The byte functions (PBF bytes in, Parquet bytes out) give the same files as the path functions.
//! The test also writes the files to target/tmp/duckosm-wasm-native: compare them with `cmp` to
//! the output of the WebAssembly build (run_node.mjs). Use `cargo test -p duckosm-wasm` for that,
//! because a build of the full workspace turns on zstd.

use duckosm_core::filter::Mode;
use duckosm_core::network::{build_network, Options};
use duckosm_core::pbf;
use duckosm_parquet::EdgeCols;
use std::path::PathBuf;

#[test]
fn bytes_equal_files() {
    let pbf_path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/data/monaco.osm.pbf");
    let got = duckosm_wasm::run(&std::fs::read(&pbf_path).unwrap(), "driving").unwrap();

    let ways = pbf::read_ways(&pbf_path).unwrap();
    let coords = pbf::read_coords(&pbf_path, &ways).unwrap();
    let net = build_network(&ways, &coords, Mode::Driving, &Options::default()).unwrap();
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("duckosm-wasm-native");
    std::fs::create_dir_all(&dir).unwrap();
    let p = |n: &str| dir.join(format!("{n}_driving.parquet"));
    let oc = EdgeCols::of(Mode::Driving, &Options::default());
    duckosm_parquet::write_edges(&p("edges"), &net.edges, oc).unwrap();
    duckosm_parquet::write_edges(&p("private_edges"), &net.private_edges, oc).unwrap();
    duckosm_parquet::write_nodes(&p("nodes"), &net.nodes).unwrap();
    duckosm_parquet::write_edge_id_map(&p("edge_id_map"), &net.edge_id_map).unwrap();

    assert!(!net.edges.is_empty());
    assert_eq!(got.edges, std::fs::read(p("edges")).unwrap());
    assert_eq!(
        got.private_edges,
        std::fs::read(p("private_edges")).unwrap()
    );
    assert_eq!(got.nodes, std::fs::read(p("nodes")).unwrap());
    assert_eq!(got.edge_id_map, std::fs::read(p("edge_id_map")).unwrap());
}
