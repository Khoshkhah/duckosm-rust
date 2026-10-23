//! Write the edges and nodes of duckosm-core as GeoParquet (version 1.0, WKB geometry, EPSG:4326).

use arrow_array::builder::{
    BinaryBuilder, BooleanBuilder, Float32Builder, Float64Builder, Int32Builder, Int64Builder,
    ListBuilder, MapBuilder, StringBuilder,
};
use arrow_array::{ArrayRef, RecordBatch};
use arrow_schema::{DataType, Field, Schema};
use duckosm_core::filter::Mode;
use duckosm_core::geom::Pt;
use duckosm_core::graph::{
    GraphRow, MemberType, Relation, TurnPath, TurnPermission, TurnRestriction,
};
use duckosm_core::model::{Edge, MapRow, Node};
use duckosm_core::network::Options;
use duckosm_core::raw::{RawNode, RawTags, RawWay};
use parquet::arrow::ArrowWriter;
use parquet::basic::Compression;
use parquet::file::metadata::KeyValue;
use parquet::file::properties::WriterProperties;
use std::fs::File;
use std::io::Write;
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

/// Which optional columns the edge files have.
#[derive(Clone, Copy, Debug, Default)]
pub struct EdgeCols {
    /// Cycling: the `dismount` flag.
    pub dismount: bool,
    /// The speed step ran: `maxspeed_kmh` replaces the raw `maxspeed`.
    pub speeds: bool,
    /// The cost step ran: `cost_s`.
    pub costs: bool,
    /// The name of the column of `Edge::ftype`: `walk_type` or `cycle_type`.
    pub ftype: Option<&'static str>,
}

impl EdgeCols {
    /// The columns of the edge files of `mode` when the network is built with `opts`.
    pub fn of(mode: Mode, opts: &Options) -> EdgeCols {
        EdgeCols {
            dismount: mode == Mode::Cycling && opts.cycling_dismount,
            speeds: opts.process_speeds,
            costs: opts.calculate_costs,
            ftype: match mode {
                Mode::Walking if opts.functional_types => Some("walk_type"),
                Mode::Cycling if opts.functional_types => Some("cycle_type"),
                _ => None,
            },
        }
    }
}

pub fn edges_schema(cols: EdgeCols) -> Schema {
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
        // the column order of the duckOSM tables: the geometry before is_reverse
        Field::new("geometry", DataType::Binary, false),
        Field::new("is_reverse", DataType::Boolean, false),
        Field::new("length_m", DataType::Float32, false),
    ];
    if cols.speeds {
        fields.retain(|f| f.name() != "maxspeed");
    }
    if cols.dismount {
        fields.push(Field::new("dismount", DataType::Boolean, true));
    }
    if cols.speeds {
        fields.push(Field::new("maxspeed_kmh", DataType::Float32, true));
    }
    if cols.costs {
        fields.push(Field::new("cost_s", DataType::Float32, true));
    }
    if let Some(name) = cols.ftype {
        fields.push(Field::new(name, DataType::Utf8, true));
    }
    Schema::new(fields)
}

pub fn nodes_schema() -> Schema {
    Schema::new(vec![
        Field::new("node_id", DataType::Int64, false),
        Field::new("geometry", DataType::Binary, false),
    ])
}

fn edges_batch(schema: &Arc<Schema>, rows: &[Edge], oc: EdgeCols) -> RecordBatch {
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
    let mut kmh = Float32Builder::with_capacity(n);
    let mut cost = Float32Builder::with_capacity(n);
    let mut ftype = StringBuilder::new();
    for e in rows {
        edge_id.append_value(e.edge_id);
        edge_ref.append_option(e.edge_ref());
        source.append_value(e.source);
        target.append_value(e.target);
        osm_id.append_value(e.osm_id);
        let a = &e.attrs;
        highway.append_value(&a.highway);
        name.append_option(a.name.as_deref());
        maxspeed.append_option(a.maxspeed.as_deref());
        oneway.append_value(e.oneway);
        lanes.append_option(e.lanes);
        surface.append_option(a.surface.as_deref());
        access.append_option(e.access.as_deref());
        junction.append_option(a.junction.as_deref());
        layer.append_option(a.layer.as_deref());
        bridge.append_option(a.bridge.as_deref());
        tunnel.append_option(a.tunnel.as_deref());
        service.append_option(a.service.as_deref());
        refs.values().append_slice(&e.refs);
        refs.append(true);
        is_reverse.append_value(e.is_reverse);
        length_m.append_value(e.length_m);
        geometry.append_value(line_wkb(&e.geometry));
        dismount.append_option(e.dismount);
        kmh.append_option(e.maxspeed_kmh);
        cost.append_option(e.cost_s);
        ftype.append_option(e.ftype);
    }
    let mut cols: Vec<ArrayRef> = vec![
        Arc::new(edge_id.finish()),
        Arc::new(edge_ref.finish()),
        Arc::new(source.finish()),
        Arc::new(target.finish()),
        Arc::new(osm_id.finish()),
        Arc::new(highway.finish()),
        Arc::new(name.finish()),
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
        Arc::new(geometry.finish()),
        Arc::new(is_reverse.finish()),
        Arc::new(length_m.finish()),
    ];
    if !oc.speeds {
        cols.insert(7, Arc::new(maxspeed.finish())); // after name
    }
    if oc.dismount {
        cols.push(Arc::new(dismount.finish()));
    }
    if oc.speeds {
        cols.push(Arc::new(kmh.finish()));
    }
    if oc.costs {
        cols.push(Arc::new(cost.finish()));
    }
    if oc.ftype.is_some() {
        cols.push(Arc::new(ftype.finish()));
    }
    RecordBatch::try_new(schema.clone(), cols).expect("edge columns match the schema")
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Write the edges as a GeoParquet file with LineString geometry.
pub fn write_edges(path: &Path, rows: &[Edge], oc: EdgeCols) -> Result<(), String> {
    write_edges_to(File::create(path).map_err(err)?, rows, oc)
}

/// The same as [`write_edges`], to any writer (for example a `Vec<u8>` in WebAssembly).
pub fn write_edges_to<W: Write + Send>(out: W, rows: &[Edge], oc: EdgeCols) -> Result<(), String> {
    let schema = Arc::new(edges_schema(oc));
    let mut w =
        ArrowWriter::try_new(out, schema.clone(), Some(props("LineString"))).map_err(err)?;
    for chunk in rows.chunks(ROW_GROUP) {
        w.write(&edges_batch(&schema, chunk, oc)).map_err(err)?;
    }
    w.close().map_err(err)?;
    Ok(())
}

/// Write the nodes as a GeoParquet file with Point geometry.
pub fn write_nodes(path: &Path, rows: &[Node]) -> Result<(), String> {
    write_nodes_to(File::create(path).map_err(err)?, rows)
}

/// The same as [`write_nodes`], to any writer (for example a `Vec<u8>` in WebAssembly).
pub fn write_nodes_to<W: Write + Send>(out: W, rows: &[Node]) -> Result<(), String> {
    let schema = Arc::new(nodes_schema());
    let mut w = ArrowWriter::try_new(out, schema.clone(), Some(props("Point"))).map_err(err)?;
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
    write_edge_id_map_to(File::create(path).map_err(err)?, rows)
}

/// The same as [`write_edge_id_map`], to any writer (for example a `Vec<u8>` in WebAssembly).
pub fn write_edge_id_map_to<W: Write + Send>(out: W, rows: &[MapRow]) -> Result<(), String> {
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
    let mut w = ArrowWriter::try_new(out, schema.clone(), Some(plain)).map_err(err)?;
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

/// Write the rows of a plain table (no geometry), in row groups of `ROW_GROUP`.
fn write_rows<W: Write + Send, T>(
    out: W,
    fields: Vec<Field>,
    rows: &[T],
    columns: impl Fn(&[T]) -> Vec<ArrayRef>,
) -> Result<(), String> {
    let schema = Arc::new(Schema::new(fields));
    let plain = WriterProperties::builder()
        .set_compression(compression())
        .build();
    let mut w = ArrowWriter::try_new(out, schema.clone(), Some(plain)).map_err(err)?;
    for chunk in rows.chunks(ROW_GROUP) {
        w.write(&RecordBatch::try_new(schema.clone(), columns(chunk)).map_err(err)?)
            .map_err(err)?;
    }
    w.close().map_err(err)?;
    Ok(())
}

fn i64s(rows: impl Iterator<Item = i64>) -> ArrayRef {
    let mut b = Int64Builder::new();
    rows.for_each(|v| b.append_value(v));
    Arc::new(b.finish())
}

fn texts<'a>(rows: impl Iterator<Item = Option<&'a str>>) -> ArrayRef {
    let mut b = StringBuilder::new();
    rows.for_each(|v| b.append_option(v));
    Arc::new(b.finish())
}

fn field(name: &str, t: DataType) -> Field {
    Field::new(name, t, true)
}

/// Write `edge_graph` (`via_edge` is `to_edge`).
pub fn write_edge_graph_to<W: Write + Send>(out: W, rows: &[GraphRow]) -> Result<(), String> {
    let fields = vec![
        field("from_edge", DataType::Int64),
        field("to_edge", DataType::Int64),
        field("via_edge", DataType::Int64),
        field("cost", DataType::Float32),
        field("uses", DataType::Utf8),
    ];
    write_rows(out, fields, rows, |c| {
        let mut cost = Float32Builder::with_capacity(c.len());
        c.iter().for_each(|r| cost.append_option(r.cost));
        vec![
            i64s(c.iter().map(|r| r.from_edge)),
            i64s(c.iter().map(|r| r.to_edge)),
            i64s(c.iter().map(|r| r.to_edge)),
            Arc::new(cost.finish()),
            texts(c.iter().map(|r| Some(r.uses))),
        ]
    })
}

/// Write `turn_restrictions`.
pub fn write_turn_restrictions_to<W: Write + Send>(
    out: W,
    rows: &[TurnRestriction],
) -> Result<(), String> {
    let fields = vec![
        field("restriction_id", DataType::Int64),
        field("restriction_type", DataType::Utf8),
        field("except_vehicles", DataType::Utf8),
        field("applies_to", DataType::Utf8),
        field("condition", DataType::Utf8),
        field("via_node", DataType::Int64),
        field("from_edge_id", DataType::Int64),
        field("to_edge_id", DataType::Int64),
    ];
    write_rows(out, fields, rows, |c| {
        vec![
            i64s(c.iter().map(|r| r.restriction_id)),
            texts(c.iter().map(|r| Some(r.restriction_type.as_str()))),
            texts(c.iter().map(|r| r.except_vehicles.as_deref())),
            texts(c.iter().map(|r| r.applies_to.as_deref())),
            texts(c.iter().map(|r| r.condition.as_deref())),
            i64s(c.iter().map(|r| r.via_node)),
            i64s(c.iter().map(|r| r.from_edge_id)),
            i64s(c.iter().map(|r| r.to_edge_id)),
        ]
    })
}

/// Write `turn_permission`.
pub fn write_turn_permission_to<W: Write + Send>(
    out: W,
    rows: &[TurnPermission],
) -> Result<(), String> {
    let fields = vec![
        field("from_edge", DataType::Int64),
        field("to_edge", DataType::Int64),
        field("allowed", DataType::Boolean),
        field("vehicles", DataType::Utf8),
        field("except_vehicles", DataType::Utf8),
        field("condition", DataType::Utf8),
        field("restriction_id", DataType::Int64),
    ];
    write_rows(out, fields, rows, |c| {
        let mut allowed = BooleanBuilder::with_capacity(c.len());
        c.iter().for_each(|r| allowed.append_value(r.allowed));
        vec![
            i64s(c.iter().map(|r| r.from_edge)),
            i64s(c.iter().map(|r| r.to_edge)),
            Arc::new(allowed.finish()),
            texts(c.iter().map(|r| r.vehicles.as_deref())),
            texts(c.iter().map(|r| r.except_vehicles.as_deref())),
            texts(c.iter().map(|r| r.condition.as_deref())),
            i64s(c.iter().map(|r| r.restriction_id)),
        ]
    })
}

/// Write `turn_path_restrictions` (`via_edges` is a list).
pub fn write_turn_path_restrictions_to<W: Write + Send>(
    out: W,
    rows: &[TurnPath],
) -> Result<(), String> {
    let fields = vec![
        field("restriction_id", DataType::Int64),
        field("restriction_type", DataType::Utf8),
        field("except_vehicles", DataType::Utf8),
        field("applies_to", DataType::Utf8),
        field("condition", DataType::Utf8),
        field("from_edge", DataType::Int64),
        list_field("via_edges"),
        field("to_edge", DataType::Int64),
    ];
    write_rows(out, fields, rows, |c| {
        let mut via = ListBuilder::new(Int64Builder::new());
        for r in c {
            via.values().append_slice(&r.via_edges);
            via.append(true);
        }
        vec![
            i64s(c.iter().map(|r| r.restriction_id)),
            texts(c.iter().map(|r| Some(r.restriction_type.as_str()))),
            texts(c.iter().map(|r| r.except_vehicles.as_deref())),
            texts(c.iter().map(|r| r.applies_to.as_deref())),
            texts(c.iter().map(|r| r.condition.as_deref())),
            i64s(c.iter().map(|r| r.from_edge)),
            Arc::new(via.finish()),
            i64s(c.iter().map(|r| r.to_edge)),
        ]
    })
}

/// Write rows as a plain Parquet file, one row group for each `ROW_GROUP` rows: `batch` makes the columns of a part.
fn write_parts<W: Write + Send, T>(
    out: W,
    rows: &[T],
    batch: impl Fn(&[T]) -> Vec<(&'static str, ArrayRef)>,
) -> Result<(), String> {
    let part = |c: &[T]| RecordBatch::try_from_iter(batch(c)).map_err(err);
    let first = part(&rows[..rows.len().min(ROW_GROUP)])?;
    let plain = WriterProperties::builder()
        .set_compression(compression())
        .set_max_row_group_row_count(Some(ROW_GROUP))
        .build();
    let mut w = ArrowWriter::try_new(out, first.schema(), Some(plain)).map_err(err)?;
    w.write(&first).map_err(err)?;
    for chunk in rows.chunks(ROW_GROUP).skip(1) {
        w.write(&part(chunk)?).map_err(err)?;
    }
    w.close().map_err(err)?;
    Ok(())
}

/// The tags as a DuckDB `MAP(VARCHAR, VARCHAR)`; no tags: NULL (as `ST_READOSM`).
fn tags_column<'a>(rows: impl Iterator<Item = &'a RawTags>) -> ArrayRef {
    let mut b = MapBuilder::new(None, StringBuilder::new(), StringBuilder::new());
    for tags in rows {
        for (k, v) in tags {
            b.keys().append_value(k);
            b.values().append_value(v);
        }
        b.append(!tags.is_empty())
            .expect("the keys and the values have the same length");
    }
    Arc::new(b.finish())
}

/// `raw.nodes` of duckOSM: osm_id, lat, lon, tags.
pub fn write_raw_nodes_to<W: Write + Send>(out: W, rows: &[RawNode]) -> Result<(), String> {
    write_parts(out, rows, |c| {
        let mut id = Int64Builder::with_capacity(c.len());
        let (mut lat, mut lon) = (
            Float64Builder::with_capacity(c.len()),
            Float64Builder::with_capacity(c.len()),
        );
        for n in c {
            id.append_value(n.id);
            lat.append_value(n.lat);
            lon.append_value(n.lon);
        }
        vec![
            ("osm_id", Arc::new(id.finish()) as ArrayRef),
            ("lat", Arc::new(lat.finish())),
            ("lon", Arc::new(lon.finish())),
            ("tags", tags_column(c.iter().map(|n| &n.tags))),
        ]
    })
}

/// `raw.ways` of duckOSM: osm_id, tags, refs. The ways with fewer than 2 nodes are not in it. One more column, `line`: the
/// way as WKB from the points of its nodes in `nodes` (sorted by id), as duckOSM's `geom.way_line` makes it with
/// `ST_MakeLine` (a node that is not in `nodes` is left out; fewer than 2 points: NULL). features.sql reads it, so
/// DuckDB does not join the nodes (docs/features.md).
pub fn write_raw_ways_to<W: Write + Send>(
    out: W,
    rows: &[RawWay],
    nodes: &[RawNode],
) -> Result<(), String> {
    let rows: Vec<&RawWay> = rows.iter().filter(|w| w.refs.len() >= 2).collect();
    write_parts(out, &rows, |c| {
        let mut id = Int64Builder::with_capacity(c.len());
        let mut refs = ListBuilder::new(Int64Builder::new());
        let mut line = BinaryBuilder::new();
        for w in c {
            id.append_value(w.id);
            refs.values().append_slice(&w.refs);
            refs.append(true);
            let pts: Vec<Pt> = w
                .refs
                .iter()
                .filter_map(|r| {
                    let i = nodes.binary_search_by_key(r, |n| n.id).ok()?;
                    Some((nodes[i].lon, nodes[i].lat))
                })
                .collect();
            line.append_option((pts.len() >= 2).then(|| line_wkb(&pts)));
        }
        vec![
            ("osm_id", Arc::new(id.finish()) as ArrayRef),
            ("tags", tags_column(c.iter().map(|w| &w.tags))),
            ("refs", Arc::new(refs.finish())),
            ("line", Arc::new(line.finish())),
        ]
    })
}

/// `raw.relations` of duckOSM: osm_id, tags, refs, ref_roles, ref_types (`node`, `way` or `relation`; DuckDB
/// casts the text to duckOSM's ENUM).
pub fn write_raw_relations_to<W: Write + Send>(out: W, rows: &[Relation]) -> Result<(), String> {
    write_parts(out, rows, |c| {
        let mut id = Int64Builder::with_capacity(c.len());
        let mut refs = ListBuilder::new(Int64Builder::new());
        let mut roles = ListBuilder::new(StringBuilder::new());
        let mut types = ListBuilder::new(StringBuilder::new());
        for r in c {
            id.append_value(r.id);
            for (m, t, role) in &r.members {
                refs.values().append_value(*m);
                // no role: NULL, as ST_READOSM
                roles
                    .values()
                    .append_option((!role.is_empty()).then_some(role));
                types.values().append_value(match t {
                    MemberType::Node => "node",
                    MemberType::Way => "way",
                    MemberType::Relation => "relation",
                });
            }
            refs.append(true);
            roles.append(true);
            types.append(true);
        }
        vec![
            ("osm_id", Arc::new(id.finish()) as ArrayRef),
            ("tags", tags_column(c.iter().map(|r| &r.tags))),
            ("refs", Arc::new(refs.finish())),
            ("ref_roles", Arc::new(roles.finish())),
            ("ref_types", Arc::new(types.finish())),
        ]
    })
}
