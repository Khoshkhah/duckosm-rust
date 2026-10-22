//! Golden test for the three modes. Input: the sample file of Monaco (no cut, no component filter).
//! The expected counts and checksums come from duckOSM 0.6.0 (DuckDB 1.5.3): tools/make_golden_summary.py.
//! The variants switch `merge_segments` and `global_junctions`. With `global_junctions` on, Monaco has no
//! chains to merge, so the variants with it off test the merge.

use duckosm_core::filter::Mode;
use duckosm_core::hash::hash3;
use duckosm_core::model::Edge;
use duckosm_core::network::{build_network, Options};
use duckosm_core::pbf;
use std::path::PathBuf;

fn data(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/data")
        .join(name)
}

fn checksum(edges: &[Edge]) -> u64 {
    let mut x = 0u64;
    for e in edges {
        let b = (e.source as u64).wrapping_mul(1000003) ^ (e.target as u64);
        let mut c =
            ((e.lanes.unwrap_or(-1) + 1) as u64 & 0xFFFF) << 32 | e.length_m.to_bits() as u64;
        if e.dismount == Some(true) {
            c |= 1 << 48;
        }
        x ^= hash3(e.edge_id, b as i64, c as i64);
    }
    x
}

#[test]
fn three_modes_equal_duckosm() {
    let path = data("monaco_sample.osm.pbf");
    let ways = pbf::read_ways(&path).unwrap();
    let coords = pbf::read_coords(&path, &ways).unwrap();
    let golden = std::fs::read_to_string(data("monaco_modes_summary.tsv")).unwrap();
    let mut bad = Vec::new();
    for line in golden.lines().skip(1) {
        let f: Vec<&str> = line.split('\t').collect();
        let (variant, mode) = (f[0], Mode::parse(f[1]).unwrap());
        let opts = Options {
            keep_largest_component: false,
            cycling_dismount: true,
            merge_segments: variant.starts_with("merge"),
            global_junctions: variant.ends_with("_gj") && !variant.ends_with("_nogj"),
        };
        let net = build_network(&ways, &coords, mode, &opts).unwrap();
        let got = [
            net.edges.len().to_string(),
            net.private_edges.len().to_string(),
            net.nodes.len().to_string(),
            net.edge_id_map.len().to_string(),
            format!("{:x}", checksum(&net.edges)),
            format!("{:x}", checksum(&net.private_edges)),
        ];
        if got.iter().map(String::as_str).ne(f[2..].iter().copied()) {
            bad.push(format!(
                "{variant} {}: got {:?}, want {:?}",
                mode.name(),
                got,
                &f[2..]
            ));
        }
    }
    assert!(bad.is_empty(), "{} variants differ: {:#?}", bad.len(), bad);
}
