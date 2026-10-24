//! duckOSM in the browser (docs/browser.md): the bytes of a `.osm.pbf` file in, duckOSM's tables of the
//! chosen modes out, as GeoParquet bytes. The steps are `duckosm_build::run`, as in the native build.

use duckosm_build::{
    config::parse_osm_fixes, parse_modes, run, Input, Params, Source, StepLog, FEATURES_SQL,
};
use duckosm_core::boundary::Boundary;
use duckosm_core::levels::Method;
use duckosm_core::pbf::BlobReader;
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
    /// The result as lines of text (`Summary::lines`): the numbers of rows of each mode, and more.
    pub summary: String,
    /// The time and the memory of each step, JSON: `[{"step": name, "ms": time, "mib": WebAssembly memory after it}]`.
    pub log: String,
}

/// Milliseconds: the browser's clock in WebAssembly (std has no clock there), the system's natively (the tests).
#[cfg(target_arch = "wasm32")]
fn now_ms() -> f64 {
    js_sys::Date::now()
}

#[cfg(not(target_arch = "wasm32"))]
fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

/// The WebAssembly memory in MiB. It only grows, so it is the largest size until now. 0 natively.
#[cfg(target_arch = "wasm32")]
fn memory_mib() -> f64 {
    (core::arch::wasm32::memory_size(0) * 65536) as f64 / 1048576.0
}

#[cfg(not(target_arch = "wasm32"))]
fn memory_mib() -> f64 {
    0.0
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
    let e = |e: String| JsError::new(&e);
    let mut p = Params {
        modes: parse_modes(modes).map_err(e)?,
        raw,
        built_at: Some((js_sys::Date::now() * 1000.0) as i64),
        timezone_entry: TIMEZONE_ENTRY.with(|e| e.borrow().clone()),
        ..Params::default()
    };
    if let Some(m) = levels.as_deref() {
        p.options.levels = Method::parse(m)
            .ok_or_else(|| JsError::new(&format!("levels: '{m}' is not tags, solve or none")))?;
    }
    let fixes = match fixes_yaml {
        Some(text) => parse_osm_fixes(&text, "the OSM fixes file").map_err(e)?,
        None => Default::default(),
    };
    let files = Object::new();
    let mut log = StepLog::new(now_ms, memory_mib);
    let sum = run(input, &fixes, boundary, &p, &mut log, |name| {
        let parts = Array::new();
        Reflect::set(&files, &name.into(), &parts).map_err(|_| format!("cannot keep {name}"))?;
        // the array is a JavaScript object: the writer and `files` share it
        Ok(BufWriter::with_capacity(1 << 20, JsParts(parts)))
    })
    .map_err(e)?;
    Ok(Output {
        files,
        summary: sum.lines().join("\n"),
        log: log.json(),
    })
}
