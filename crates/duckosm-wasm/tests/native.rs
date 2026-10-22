//! The browser build (`run`, PBF bytes in) writes the same files as the native build (`duckosm_build::build`),
//! byte for byte: all three modes, the edge graph, the turn restrictions and an OSM fixes file. The files of
//! `run` go to target/tmp/duckosm-wasm-native: compare them with `cmp` to the output of the WebAssembly
//! module (`www/run_node.mjs`).

use duckosm_build::{build, Params};
use duckosm_core::filter::Mode;
use std::path::PathBuf;

const FIXES: &str = "overrides:\n  - osm_id: 93137596\n    lanes: 1\n";

#[test]
fn browser_build_equals_native_build() {
    let pbf = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/data/monaco.osm.pbf");
    let tmp = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    let (native, wasm) = (tmp.join("duckosm-native"), tmp.join("duckosm-wasm-native"));
    std::fs::create_dir_all(&wasm).unwrap();
    let fixes = tmp.join("fixes.yaml");
    std::fs::write(&fixes, FIXES).unwrap();

    let p = Params {
        modes: vec![Mode::Driving, Mode::Walking, Mode::Cycling],
        geoparquet: true,
        duckdb: false,
        osm_fixes: Some(fixes),
        ..Params::default()
    };
    build(&pbf, &native, &p).unwrap();
    let mut names = Vec::new();
    duckosm_wasm::run(
        duckosm_wasm::Input::Pbf(&std::fs::read(&pbf).unwrap()),
        "driving,walking,cycling",
        Some(FIXES),
        |name| {
            names.push(name.to_string());
            std::fs::File::create(wasm.join(name)).map_err(|e| e.to_string())
        },
    )
    .unwrap();

    let mut want: Vec<String> = std::fs::read_dir(&native)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".parquet"))
        .collect();
    want.sort();
    names.sort();
    assert_eq!(names, want, "the same files");
    assert!(names.contains(&"edge_graph_walking.parquet".to_string()));
    for n in &names {
        let (a, b) = (
            std::fs::read(native.join(n)).unwrap(),
            std::fs::read(wasm.join(n)).unwrap(),
        );
        assert!(a == b, "{n} differs");
    }
}
