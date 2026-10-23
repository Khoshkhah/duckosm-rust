//! duckOSM in the browser (docs/browser.md): the bytes of a `.osm.pbf` file in, duckOSM's tables of the
//! chosen modes out, as GeoParquet bytes. The same steps and the same writer as the native build.

use duckosm_build::{
    config::parse_osm_fixes, parse_modes, write_area_tables, write_bus, write_levels, write_raw,
    write_tables, Area, FEATURES_SQL,
};
use duckosm_core::boundary::Boundary;
use duckosm_core::filter::Mode;
use duckosm_core::fixes::OsmFixes;
use duckosm_core::levels::{LevelEdges, Method};
use duckosm_core::network::{build_network_with, Options};
use duckosm_core::osmjson::OsmJson;
use duckosm_core::pbf::BlobReader;
use duckosm_core::{pbf, sidewalks};
use js_sys::{Array, Object, Reflect, Uint8Array};
use std::io::{self, BufWriter, Read, Seek, SeekFrom, Write};
use wasm_bindgen::prelude::*;

#[cfg(feature = "threads")]
mod alloc;
#[cfg(feature = "threads")]
#[global_allocator]
static ALLOC: alloc::Cached = alloc::Cached;

/// `initThreadPool(n)` in JavaScript: starts n Web Workers for rayon (the build with the feature "threads").
#[cfg(feature = "threads")]
pub use wasm_bindgen_rayon::init_thread_pool;
use web_sys::{Blob, FileReaderSync};

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

// SAFETY: ArrowWriter needs Send. The tables are written on the calling thread, also in the build with
// threads (only the PBF reader uses rayon), so the JavaScript array never moves to another thread.
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

/// A file that the cut can read and seek in.
pub trait Source: Read + Seek + Send {}
impl<T: Read + Seek + Send> Source for T {}

/// A new reader of a PBF file for each pass of the cut.
pub type Open<'a> = &'a dyn Fn() -> Result<BlobReader<Box<dyn Source + 'a>>, String>;

/// The input of a build: the bytes of a `.osm.pbf` file, OSM JSON (the output of the Overpass API), or a region
/// PBF and a boundary (the PBF is cut to the boundary, as osmium's `complete_ways` does).
#[derive(Clone, Copy)]
pub enum Input<'a> {
    Pbf(&'a [u8]),
    OsmJson(&'a [u8], Option<&'a Boundary>),
    Area(Open<'a>, &'a Boundary),
}

/// Reads a browser `Blob` (a `File` that the user chose) piece by piece, so the region file is never in the
/// WebAssembly memory as a whole. `FileReaderSync` exists only in a worker: the page builds in one. It reads 4 MB
/// at a time (one call to the browser costs more than the copy) and keeps them, so a seek into these 4 MB
/// reads nothing more.
struct BlobRead {
    blob: Blob,
    reader: FileReaderSync,
    pos: u64,
    buf: Vec<u8>,
    buf_at: u64,
}

impl BlobRead {
    fn new(blob: Blob) -> Result<BlobRead, String> {
        Ok(BlobRead {
            blob,
            reader: FileReaderSync::new().map_err(|e| format!("{e:?}"))?,
            pos: 0,
            buf: Vec::new(),
            buf_at: 0,
        })
    }
}

// SAFETY: osmpbf needs Send. `pbf::read_area` reads the blobs on the calling thread and gives only the read
// bytes to rayon, so the browser objects never move to another thread, also in the build with threads.
unsafe impl Send for BlobRead {}

impl Read for BlobRead {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        let size = self.blob.size() as u64;
        if self.pos >= size || out.is_empty() {
            return Ok(0);
        }
        if self.pos < self.buf_at || self.pos >= self.buf_at + self.buf.len() as u64 {
            let end = (self.pos + (4 << 20)).min(size);
            let js = |e: JsValue| io::Error::other(format!("{e:?}"));
            let part = self
                .blob
                .slice_with_f64_and_f64(self.pos as f64, end as f64)
                .map_err(js)?;
            self.buf =
                Uint8Array::new(&self.reader.read_as_array_buffer(&part).map_err(js)?.into())
                    .to_vec();
            self.buf_at = self.pos;
        }
        let from = (self.pos - self.buf_at) as usize;
        let n = out.len().min(self.buf.len() - from);
        out[..n].copy_from_slice(&self.buf[from..from + n]);
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for BlobRead {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        self.pos = match to {
            SeekFrom::Start(n) => n,
            SeekFrom::Current(d) => self.pos.saturating_add_signed(d),
            SeekFrom::End(d) => (self.blob.size() as u64).saturating_add_signed(d),
        };
        Ok(self.pos)
    }
}

/// duckOSM's SQL of the base-map layers (`features.*`): it loads the `raw_*.parquet` files of [`build_area`] with
/// `raw` into `raw.*` and makes the layers. It needs DuckDB's spatial extension (docs/features.md).
#[wasm_bindgen]
pub fn features_sql() -> String {
    FEATURES_SQL.to_string()
}

/// Build duckOSM's tables of an area: `region` is a `.osm.pbf` file (a `File` or `Blob`) that covers the
/// `boundary` (GeoJSON, as `duckosm boundary` writes it). The file is cut to the boundary while it is read. With
/// `raw`, the output also has `raw_nodes.parquet`, `raw_ways.parquet` and `raw_relations.parquet`: duckOSM's
/// `raw.*` of the area, cut as osmium's `smart` does, the input of [`features_sql`].
#[wasm_bindgen]
pub fn build_area(
    region: Blob,
    boundary: &str,
    modes: &str,
    fixes_yaml: Option<String>,
    raw: Option<bool>,
    levels: Option<String>,
) -> Result<Output, JsError> {
    let text = boundary;
    let boundary = Boundary::parse(boundary).map_err(|e| JsError::new(&e))?;
    let open = || -> Result<BlobReader<Box<dyn Source>>, String> {
        let r: Box<dyn Source> = Box::new(BlobRead::new(region.clone())?);
        BlobReader::new_seekable(r).map_err(|e| e.to_string())
    };
    js_build(
        Input::Area(&open, &boundary),
        modes,
        fixes_yaml,
        Some(text),
        raw.unwrap_or(false),
        levels,
    )
}

/// The same as [`build_area`], with the bytes of the region file (for Node, which has no `FileReaderSync`).
#[wasm_bindgen]
pub fn build_area_bytes(
    region: &[u8],
    boundary: &str,
    modes: &str,
    fixes_yaml: Option<String>,
    raw: Option<bool>,
    levels: Option<String>,
) -> Result<Output, JsError> {
    let text = boundary;
    let boundary = Boundary::parse(boundary).map_err(|e| JsError::new(&e))?;
    let open = || -> Result<BlobReader<Box<dyn Source + '_>>, String> {
        let r: Box<dyn Source> = Box::new(io::Cursor::new(region));
        BlobReader::new_seekable(r).map_err(|e| e.to_string())
    };
    js_build(
        Input::Area(&open, &boundary),
        modes,
        fixes_yaml,
        Some(text),
        raw.unwrap_or(false),
        levels,
    )
}

/// Build duckOSM's tables of `modes` (comma separated: driving, walking, cycling) from the bytes of a `.osm.pbf`
/// file, with the default options of the CLI. `fixes_yaml`: the text of an OSM fixes file (duckOSM
/// `osm_overrides`), or nothing. `boundary`: the boundary of the area (GeoJSON), only for `main.boundary` and
/// the metadata: the file is cut already.
#[wasm_bindgen]
pub fn build(
    pbf_bytes: &[u8],
    modes: &str,
    fixes_yaml: Option<String>,
    boundary: Option<String>,
    levels: Option<String>,
) -> Result<Output, JsError> {
    js_build(
        Input::Pbf(pbf_bytes),
        modes,
        fixes_yaml,
        boundary.as_deref(),
        false,
        levels,
    )
}

/// The same as [`build`], from OSM JSON: the answer of the Overpass API to the query of the page (the highway
/// ways and ferry lines with their nodes, and the `type=restriction` relations). With a `boundary` (GeoJSON),
/// only the ways with a node inside are kept, as in [`build_area`].
#[wasm_bindgen]
pub fn build_osm_json(
    json: &[u8],
    boundary: Option<String>,
    modes: &str,
    fixes_yaml: Option<String>,
    levels: Option<String>,
) -> Result<Output, JsError> {
    let parsed = boundary
        .as_deref()
        .map(Boundary::parse)
        .transpose()
        .map_err(|e| JsError::new(&e))?;
    js_build(
        Input::OsmJson(json, parsed.as_ref()),
        modes,
        fixes_yaml,
        boundary.as_deref(),
        false,
        levels,
    )
}

thread_local! {
    /// The time zone table entry of the next build (`set_timezone_entry`).
    static TIMEZONE_ENTRY: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

/// The entry of the area's Geofabrik region in the page's time zone table (`www/timezones.json`), as JSON text,
/// for the builds after this call: the time zone of `main.visualization_metadata`. The browser build has no world
/// map of the zones; without an entry, the time zone is NULL.
#[wasm_bindgen]
pub fn set_timezone_entry(entry: Option<String>) {
    TIMEZONE_ENTRY.with(|e| *e.borrow_mut() = entry);
}

fn js_build(
    input: Input,
    modes: &str,
    fixes_yaml: Option<String>,
    boundary: Option<&str>,
    raw: bool,
    levels: Option<String>,
) -> Result<Output, JsError> {
    let levels = match levels.as_deref() {
        None => Method::default(),
        Some(m) => Method::parse(m)
            .ok_or_else(|| JsError::new(&format!("levels: '{m}' is not tags, solve or none")))?,
    };
    let files = Object::new();
    let built_at = (js_sys::Date::now() * 1000.0) as i64;
    let tz = TIMEZONE_ENTRY.with(|e| e.borrow().clone());
    let summary = run(
        input,
        modes,
        fixes_yaml.as_deref(),
        boundary,
        levels,
        built_at,
        tz.as_deref(),
        raw,
        |name| {
            let parts = Array::new();
            Reflect::set(&files, &name.into(), &parts)
                .map_err(|_| format!("cannot keep {name}"))?;
            // the array is a JavaScript object: the writer and `files` share it
            Ok(BufWriter::with_capacity(1 << 20, JsParts(parts)))
        },
    )
    .map_err(|e| JsError::new(&e))?;
    Ok(Output { files, summary })
}

/// The steps of `duckosm_build::build` without files and without a clock (WebAssembly has neither): the OSM
/// fixes, the relations for the turn restrictions, the sidewalk rule, then each mode, written with
/// `write_tables` to a writer from `file`, then the tables of the area (`write_area_tables`; `boundary` is the
/// boundary file, `built_at` the time in microseconds). With `raw` (only for `Input::Area`), also `raw.*` with
/// `write_raw`. Returns one summary line for each mode.
#[allow(clippy::too_many_arguments)] // ponytail: one parameter for each build input; a struct if more come
pub fn run<W: Write + Send>(
    input: Input,
    modes: &str,
    fixes_yaml: Option<&str>,
    boundary: Option<&str>,
    levels: Method,
    built_at: i64,
    timezone_entry: Option<&str>,
    raw: bool,
    mut file: impl FnMut(&str) -> Result<W, String>,
) -> Result<String, String> {
    let modes = parse_modes(modes)?;
    let opts = Options {
        levels,
        ..Options::default()
    };
    let fixes = match fixes_yaml {
        Some(text) => parse_osm_fixes(text, "the OSM fixes file")?,
        None => OsmFixes::default(),
    };
    let need_relations = opts.extract_restrictions && modes.contains(&Mode::Driving);
    let mut raw_tables = None;
    // the bus routes need the raw cut (an area build only; docs/bus.md)
    let bus = opts.bus_routes && modes.contains(&Mode::Driving);
    let (mut ways, mut coords, relations) = match input {
        Input::Pbf(bytes) => {
            let mut ways = pbf::read_ways_bytes(bytes)?;
            fixes.apply_to_ways(&mut ways)?;
            let coords = pbf::read_coords_bytes(bytes, &ways)?;
            let relations = if need_relations {
                pbf::read_restrictions_bytes(bytes)?
            } else {
                Vec::new()
            };
            (ways, coords, relations)
        }
        Input::Area(open, boundary) => {
            let (mut ways, coords, relations) = if raw || bus {
                let (w, c, r, mut rt) = pbf::read_area_raw(open, boundary)?;
                rt.apply_fixes(&fixes);
                raw_tables = Some(rt);
                (w, c, r)
            } else {
                pbf::read_area(open, boundary)?
            };
            fixes.apply_to_ways(&mut ways)?;
            (
                ways,
                coords,
                if need_relations {
                    relations
                } else {
                    Vec::new()
                },
            )
        }
        Input::OsmJson(bytes, boundary) => {
            let mut data = OsmJson::read(bytes)?;
            if let Some(b) = boundary {
                data.cut(b);
            }
            let mut ways = std::mem::take(&mut data.ways);
            fixes.apply_to_ways(&mut ways)?;
            let coords = data.coords(&ways);
            (
                ways,
                coords,
                if need_relations {
                    data.relations
                } else {
                    Vec::new()
                },
            )
        }
    };
    fixes.add_new_nodes(&mut ways, &mut coords);
    if modes.contains(&Mode::Walking) {
        sidewalks::infer_separate_sidewalks(&mut ways, &coords);
    }
    let mut summary = Vec::new();
    let mut mode_nodes = Vec::new();
    let mut level_edges = LevelEdges::default();
    for mode in &modes {
        let net = build_network_with(&ways, &coords, *mode, &opts, &fixes, &relations)?;
        write_tables(&net, *mode, &opts, &ways, &mut file)?;
        fixes.set_arrows(&mut ways, &net.ways, *mode);
        if levels != Method::None {
            level_edges.add(*mode, false, &net.edges);
            level_edges.add(*mode, true, &net.private_edges);
        }
        summary.push(format!(
            "{}: {} edges, {} nodes, {} private edges, {} edge_graph rows, {} turn restrictions",
            mode.name(),
            net.edges.len(),
            net.nodes.len(),
            net.private_edges.len(),
            net.graph.edge_graph.as_ref().map_or(0, Vec::len),
            net.graph.turn_restrictions.as_ref().map_or(0, Vec::len),
        ));
        if *mode == Mode::Driving && bus {
            if let Some(r) = raw_tables.as_ref() {
                let n = write_bus(r, &net, &mut file)?;
                summary.push(format!("bus: {n} routes"));
            }
        }
        mode_nodes.push((*mode, net.nodes));
    }
    let area = Area {
        boundary,
        ways: &ways,
        coords: &coords,
        nodes: &mode_nodes,
        opts: &opts,
        built_at,
        timezone_entry,
    };
    write_area_tables(&area, &mut file)?;
    if let Some(mut r) = raw_tables.filter(|_| raw) {
        // the tags that the steps set on the network's ways (the sidewalk rule, the arrows of the fixes)
        r.sync_tags(&ways);
        write_raw(&r, &mut file)?;
        summary.push(format!(
            "raw: {} nodes, {} ways, {} relations",
            r.nodes.len(),
            r.ways.len(),
            r.relations.len()
        ));
    }
    if let Some(l) = write_levels(&level_edges, levels, built_at, &mut file)? {
        summary.push(l);
    }
    Ok(summary.join("\n"))
}
