//! Write the edges and nodes of duckosm-core as GeoParquet (version 1.0, WKB geometry, EPSG:4326).

use arrow_array::builder::{
    BinaryBuilder, BooleanBuilder, Float32Builder, Int32Builder, Int64Builder, ListBuilder,
    StringBuilder,
};
use arrow_array::{ArrayRef, RecordBatch};
use arrow_schema::{DataType, Field, Schema};
use duckosm_core::geom::Pt;
use duckosm_core::model::{Edge, MapRow, Node};
use parquet::arrow::ArrowWriter;
use parquet::basic::Compression;
use parquet::file::metadata::KeyValue;
use parquet::file::properties::WriterProperties;
use std::fs::File;
use std::path::Path;
use std::sync::Arc;

const ROW_GROUP: usize = 65_536;

fn geo_metadata(geometry_type: &str) -> KeyValue {
    let json = format!(
        "{{\"version\":\"1.0.0\",\"primary_column\":\"geometry\",\"columns\":{{\"geometry\":{{\"encoding\":\"WKB\",\"geometry_types\":[\"{geometry_type}\"]}}}}}}"
    );
    KeyValue::new("geo".to_string(), json)
}

#[cfg(feature = "zstd")]
fn compression() -> Compression {
    Compression::ZSTD(parquet::basic::ZstdLevel::default())
}

#[cfg(all(not(feature = "zstd"), feature = "snap"))]
fn compression() -> Compression {
    Compression::SNAPPY
}

#[cfg(not(any(feature = "zstd", feature = "snap")))]
fn compression() -> Compression {
    Compression::UNCOMPRESSED
}

fn props(geometry_type: &str) -> WriterProperties {
    WriterProperties::builder()
        .set_compression(compression())
        .set_max_row_group_row_count(Some(ROW_GROUP))
        .set_key_value_metadata(Some(vec![geo_metadata(geometry_type)]))
        .build()
}

fn line_wkb(pts: &[Pt]) -> Vec<u8> {
    let mut b = Vec::with_capacity(9 + pts.len() * 16);
    b.push(1u8); // little endian
    b.extend_from_slice(&2u32.to_le_bytes()); // LineString
    b.extend_from_slice(&(pts.len() as u32).to_le_bytes());
    for p in pts {
        b.extend_from_slice(&p.0.to_le_bytes());
        b.extend_from_slice(&p.1.to_le_bytes());
    }
    b
}

fn point_wkb(p: Pt) -> Vec<u8> {
    let mut b = Vec::with_capacity(21);
    b.push(1u8);
    b.extend_from_slice(&1u32.to_le_bytes());
    b.extend_from_slice(&p.0.to_le_bytes());
    b.extend_from_slice(&p.1.to_le_bytes());
    b
}

fn list_field(name: &str) -> Field {
    Field::new(
        name,
        DataType::List(Arc::new(Field::new("item", DataType::Int64, true))),
        true,
    )
}

pub fn edges_schema(with_dismount: bool) -> Schema {
    let mut fields = vec![
        Field::new("edge_id", DataType::Int64, false),
        Field::new("edge_ref", DataType::Utf8, true),
        Field::new("source", DataType::Int64, false),
        Field::new("target", DataType::Int64, false),
        Field::new("osm_id", DataType::Int64, false),
        Field::new("highway", DataType::Utf8, true),
        Field::new("name", DataType::Utf8, true),
        Field::new("maxspeed", DataType::Utf8, true),
        Field::new("oneway", DataType::Boolean, false),
        Field::new("lanes", DataType::Int32, true),
        Field::new("surface", DataType::Utf8, true),
        Field::new("access", DataType::Utf8, true),
        Field::new("junction", DataType::Utf8, true),
        Field::new("layer", DataType::Utf8, true),
        Field::new("bridge", DataType::Utf8, true),
        Field::new("tunnel", DataType::Utf8, true),
        Field::new("service", DataType::Utf8, true),
        list_field("refs"),
        Field::new("is_reverse", DataType::Boolean, false),
        Field::new("length_m", DataType::Float32, false),
        Field::new("geometry", DataType::Binary, false),
    ];
    if with_dismount {
        fields.push(Field::new("dismount", DataType::Boolean, true));
    }
    Schema::new(fields)
}

pub fn nodes_schema() -> Schema {
    Schema::new(vec![
        Field::new("node_id", DataType::Int64, false),
        Field::new("geometry", DataType::Binary, false),
    ])
}

fn edges_batch(schema: &Arc<Schema>, rows: &[Edge], with_dismount: bool) -> RecordBatch {
    let n = rows.len();
    let mut edge_id = Int64Builder::with_capacity(n);
    let mut edge_ref = StringBuilder::new();
    let mut source = Int64Builder::with_capacity(n);
    let mut target = Int64Builder::with_capacity(n);
    let mut osm_id = Int64Builder::with_capacity(n);
    let mut highway = StringBuilder::new();
    let mut name = StringBuilder::new();
    let mut maxspeed = StringBuilder::new();
    let mut oneway = BooleanBuilder::with_capacity(n);
    let mut lanes = Int32Builder::with_capacity(n);
    let mut surface = StringBuilder::new();
    let mut access = StringBuilder::new();
    let mut junction = StringBuilder::new();
    let mut layer = StringBuilder::new();
    let mut bridge = StringBuilder::new();
    let mut tunnel = StringBuilder::new();
    let mut service = StringBuilder::new();
    let mut refs = ListBuilder::new(Int64Builder::new());
    let mut is_reverse = BooleanBuilder::with_capacity(n);
    let mut length_m = Float32Builder::with_capacity(n);
    let mut geometry = BinaryBuilder::new();
    let mut dismount = BooleanBuilder::with_capacity(n);
    for e in rows {
        edge_id.append_value(e.edge_id);
        edge_ref.append_option(e.edge_ref.as_deref());
        source.append_value(e.source);
        target.append_value(e.target);
        osm_id.append_value(e.osm_id);
        highway.append_value(&e.highway);
        name.append_option(e.name.as_deref());
        maxspeed.append_option(e.maxspeed.as_deref());
        oneway.append_value(e.oneway);
        lanes.append_option(e.lanes);
        surface.append_option(e.surface.as_deref());
        access.append_option(e.access.as_deref());
        junction.append_option(e.junction.as_deref());
        layer.append_option(e.layer.as_deref());
        bridge.append_option(e.bridge.as_deref());
        tunnel.append_option(e.tunnel.as_deref());
        service.append_option(e.service.as_deref());
        refs.values().append_slice(&e.refs);
        refs.append(true);
        is_reverse.append_value(e.is_reverse);
        length_m.append_value(e.length_m);
        geometry.append_value(line_wkb(&e.geometry));
        dismount.append_option(e.dismount);
    }
    let cols: Vec<ArrayRef> = vec![
        Arc::new(edge_id.finish()),
        Arc::new(edge_ref.finish()),
        Arc::new(source.finish()),
        Arc::new(target.finish()),
        Arc::new(osm_id.finish()),
        Arc::new(highway.finish()),
        Arc::new(name.finish()),
        Arc::new(maxspeed.finish()),
        Arc::new(oneway.finish()),
        Arc::new(lanes.finish()),
        Arc::new(surface.finish()),
        Arc::new(access.finish()),
        Arc::new(junction.finish()),
        Arc::new(layer.finish()),
        Arc::new(bridge.finish()),
        Arc::new(tunnel.finish()),
        Arc::new(service.finish()),
        Arc::new(refs.finish()),
        Arc::new(is_reverse.finish()),
        Arc::new(length_m.finish()),
        Arc::new(geometry.finish()),
    ];
    let mut cols = cols;
    if with_dismount {
        cols.push(Arc::new(dismount.finish()));
    }
    RecordBatch::try_new(schema.clone(), cols).expect("edge columns match the schema")
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Write the edges as a GeoParquet file with LineString geometry.
pub fn write_edges(path: &Path, rows: &[Edge], with_dismount: bool) -> Result<(), String> {
    let schema = Arc::new(edges_schema(with_dismount));
    let mut w = ArrowWriter::try_new(
        File::create(path).map_err(err)?,
        schema.clone(),
        Some(props("LineString")),
    )
    .map_err(err)?;
    for chunk in rows.chunks(ROW_GROUP) {
        w.write(&edges_batch(&schema, chunk, with_dismount))
            .map_err(err)?;
    }
    w.close().map_err(err)?;
    Ok(())
}

/// Write the nodes as a GeoParquet file with Point geometry.
pub fn write_nodes(path: &Path, rows: &[Node]) -> Result<(), String> {
    let schema = Arc::new(nodes_schema());
    let mut w = ArrowWriter::try_new(
        File::create(path).map_err(err)?,
        schema.clone(),
        Some(props("Point")),
    )
    .map_err(err)?;
    for chunk in rows.chunks(ROW_GROUP) {
        let mut id = Int64Builder::with_capacity(chunk.len());
        let mut g = BinaryBuilder::new();
        for n in chunk {
            id.append_value(n.node_id);
            g.append_value(point_wkb((n.lon, n.lat)));
        }
        let cols: Vec<ArrayRef> = vec![Arc::new(id.finish()), Arc::new(g.finish())];
        w.write(&RecordBatch::try_new(schema.clone(), cols).map_err(err)?)
            .map_err(err)?;
    }
    w.close().map_err(err)?;
    Ok(())
}

/// Write `edge_id_map` as a plain Parquet file (no geometry).
pub fn write_edge_id_map(path: &Path, rows: &[MapRow]) -> Result<(), String> {
    let schema = Arc::new(Schema::new(vec![
        Field::new("old_edge_id", DataType::Int64, false),
        Field::new("new_edge_id", DataType::Int64, false),
        Field::new("seq", DataType::Int32, false),
        Field::new("is_reverse", DataType::Boolean, false),
        Field::new("osm_id", DataType::Int64, false),
    ]));
    let plain = WriterProperties::builder()
        .set_compression(compression())
        .build();
    let mut w = ArrowWriter::try_new(
        File::create(path).map_err(err)?,
        schema.clone(),
        Some(plain),
    )
    .map_err(err)?;
    for chunk in rows.chunks(ROW_GROUP) {
        let mut old = Int64Builder::with_capacity(chunk.len());
        let mut new = Int64Builder::with_capacity(chunk.len());
        let mut seq = Int32Builder::with_capacity(chunk.len());
        let mut rev = BooleanBuilder::with_capacity(chunk.len());
        let mut osm = Int64Builder::with_capacity(chunk.len());
        for m in chunk {
            old.append_value(m.old_edge_id);
            new.append_value(m.new_edge_id);
            seq.append_value(m.seq);
            rev.append_value(m.is_reverse);
            osm.append_value(m.osm_id);
        }
        let cols: Vec<ArrayRef> = vec![
            Arc::new(old.finish()),
            Arc::new(new.finish()),
            Arc::new(seq.finish()),
            Arc::new(rev.finish()),
            Arc::new(osm.finish()),
        ];
        w.write(&RecordBatch::try_new(schema.clone(), cols).map_err(err)?)
            .map_err(err)?;
    }
    w.close().map_err(err)?;
    Ok(())
}
