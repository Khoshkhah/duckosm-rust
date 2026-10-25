//! The browser build (`run`, PBF bytes in) writes the same files as the native build (`duckosm_build::build`),
//! byte for byte: all three modes, the edge graph, the turn restrictions and an OSM fixes file. The files of
//! `run` go to target/tmp/<checkout>/duckosm-wasm-native: compare them with `cmp` to the output of the WebAssembly
//! module (`www/run_node.mjs`).

use duckosm_build::{build, Params};
use duckosm_core::filter::Mode;
use std::path::PathBuf;

/// The Monaco entry of the page's time zone table: the browser build must find the zone that the native build
/// finds with the world map of tzf-rs.
fn monaco_timezone() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("www/timezones.json");
    let table: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    table["regions"]["monaco"].to_string()
}

/// target/tmp/<checkout>: one folder for each checkout, because the worktrees can share target/ (docs/development.md,
/// "One shared build folder").
fn tmp() -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap();
    let tmp = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(root.file_name().unwrap());
    println!("files in {}", tmp.display());
    tmp
}

const FIXES: &str = "overrides:\n  - osm_id: 93137596\n    lanes: 1\n";
/// The fixes of duckOSM's Monaco file that change raw.ways: a tag and the arrows of the lanes.
const FIXES_AREA: &str = "overrides:\n  - osm_id: 93137596\n    lanes: 1\n  - osm_id: 4227277\n    turn_lanes_forward: none|none\n";

#[test]
fn browser_build_equals_native_build() {
    let pbf = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/data/monaco.osm.pbf");
    let tmp = tmp();
    let (native, wasm) = (tmp.join("duckosm-native"), tmp.join("duckosm-wasm-native"));
    std::fs::create_dir_all(&wasm).unwrap();
    let fixes = tmp.join("fixes.yaml");
    std::fs::write(&fixes, FIXES).unwrap();

    let p = Params {
        modes: vec![Mode::Driving, Mode::Walking, Mode::Cycling],
        geoparquet: true,
        duckdb: false,
        osm_fixes: Some(fixes),
        built_at: Some(0),
        ..Params::default()
    };
    build(&pbf, &native, &p).unwrap();
    let mut names = Vec::new();
    duckosm_wasm::run(
        duckosm_wasm::Input::Pbf(&std::fs::read(&pbf).unwrap()),
        "driving,walking,cycling",
        Some(FIXES),
        None,
        duckosm_core::levels::Method::Tags,
        0,
        Some(&monaco_timezone()),
        false,
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
    assert!(names.contains(&"lane_profile_driving.parquet".to_string()));
    for n in &names {
        let (a, b) = (
            std::fs::read(native.join(n)).unwrap(),
            std::fs::read(wasm.join(n)).unwrap(),
        );
        assert!(a == b, "{n} differs");
    }
}

/// The browser build of an area (a region PBF and a boundary, cut while it is read) equals the native build with
/// the same boundary, byte for byte, with the `raw.*` files of the base-map layers and an OSM fixes file.
#[test]
fn browser_area_build_equals_native_build() {
    use duckosm_core::boundary::Boundary;
    use duckosm_core::pbf::BlobReader;

    let data = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/data");
    let (pbf, geojson) = (
        data.join("monaco_sample.osm.pbf"),
        data.join("monaco.geojson"),
    );
    let tmp = tmp();
    let (native, wasm) = (
        tmp.join("duckosm-native-area"),
        tmp.join("duckosm-wasm-area"),
    );
    std::fs::create_dir_all(&wasm).unwrap();
    let fixes = tmp.join("fixes-area.yaml");
    std::fs::write(&fixes, FIXES_AREA).unwrap();
    let mut p = Params {
        modes: vec![Mode::Driving, Mode::Walking, Mode::Cycling],
        geoparquet: true,
        duckdb: false,
        boundary: Some(geojson.clone()),
        raw: true,
        osm_fixes: Some(fixes.clone()),
        built_at: Some(0),
        ..Params::default()
    };
    p.options.levels = duckosm_core::levels::Method::Solve;
    build(&pbf, &native, &p).unwrap();

    let boundary = Boundary::parse(&std::fs::read_to_string(&geojson).unwrap()).unwrap();
    let bytes = std::fs::read(&pbf).unwrap();
    let open = || -> Result<BlobReader<Box<dyn duckosm_wasm::Source + '_>>, String> {
        let r: Box<dyn duckosm_wasm::Source> = Box::new(std::io::Cursor::new(&bytes[..]));
        BlobReader::new_seekable(r).map_err(|e| e.to_string())
    };
    let mut names = Vec::new();
    duckosm_wasm::run(
        duckosm_wasm::Input::Area(&open, &boundary),
        "driving,walking,cycling",
        Some(FIXES_AREA),
        Some(&std::fs::read_to_string(&geojson).unwrap()),
        duckosm_core::levels::Method::Solve,
        0,
        Some(&monaco_timezone()),
        true,
        |name| {
            names.push(name.to_string());
            std::fs::File::create(wasm.join(name)).map_err(|e| e.to_string())
        },
    )
    .unwrap();
    // 3 modes x 10 files (edges, private_edges, nodes, virtual_nodes, ways, way_nodes, edge_id_map, edge_graph,
    // turn_permission, and in driving the two turn restriction tables and the lane profile) + 4 area files + 3 raw
    // files + the 2 levels files (solve) + the 2 bus files
    assert_eq!(names.len(), 3 * 9 + 3 + 4 + 3 + 2 + 2, "{names:?}");
    assert!(names.contains(&"raw_ways.parquet".to_string()));
    for n in &names {
        let (a, b) = (
            std::fs::read(native.join(n)).unwrap(),
            std::fs::read(wasm.join(n)).unwrap(),
        );
        assert!(a == b, "{n} differs");
    }
}
