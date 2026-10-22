//! The data types: OSM ways as read, edges and nodes as written.

use crate::geom::Pt;
use std::sync::Arc;

/// The OSM tags that the driving network step reads. Other tags are not kept.
#[derive(Default, Clone, Debug)]
pub struct Tags {
    pub highway: Option<Box<str>>,
    pub name: Option<Box<str>>,
    pub maxspeed: Option<Box<str>>,
    pub oneway: Option<Box<str>>,
    pub oneway_bus: Option<Box<str>>,
    pub oneway_psv: Option<Box<str>>,
    pub junction: Option<Box<str>>,
    pub motorcar: Option<Box<str>>,
    pub motor_vehicle: Option<Box<str>>,
    pub vehicle: Option<Box<str>>,
    pub access: Option<Box<str>>,
    pub bus: Option<Box<str>>,
    pub psv: Option<Box<str>>,
    pub surface: Option<Box<str>>,
    pub service: Option<Box<str>>,
    pub layer: Option<Box<str>>,
    pub bridge: Option<Box<str>>,
    pub tunnel: Option<Box<str>>,
    pub lanes: Option<Box<str>>,
    pub lanes_forward: Option<Box<str>>,
    pub lanes_backward: Option<Box<str>>,
    pub lanes_reversible: Option<Box<str>>,
    pub route: Option<Box<str>>,
    pub footway: Option<Box<str>>,
    pub conveying: Option<Box<str>>,
    pub area: Option<Box<str>>,
    pub indoor: Option<Box<str>>,
    pub cycleway_left: Option<Box<str>>,
    pub cycleway_right: Option<Box<str>>,
    pub cycleway_both: Option<Box<str>>,
    pub segregated: Option<Box<str>>,
    pub foot: Option<Box<str>>,
    pub bicycle: Option<Box<str>>,
    pub cycleway: Option<Box<str>>,
    pub sidewalk: Option<Box<str>>,
    pub sidewalk_both: Option<Box<str>>,
    pub sidewalk_left: Option<Box<str>>,
    pub sidewalk_right: Option<Box<str>>,
    pub motorroad: Option<Box<str>>,
    pub oneway_foot: Option<Box<str>>,
    pub oneway_bicycle: Option<Box<str>>,
}

impl Tags {
    /// Store the tag if the network step reads it. Returns false for a tag that is not used.
    /// Like `map_extract(tags, k)[1]` in duckOSM, the first value of a key wins.
    pub fn set(&mut self, k: &str, v: &str) {
        let slot = match k {
            "highway" => &mut self.highway,
            "name" => &mut self.name,
            "maxspeed" => &mut self.maxspeed,
            "oneway" => &mut self.oneway,
            "oneway:bus" => &mut self.oneway_bus,
            "oneway:psv" => &mut self.oneway_psv,
            "junction" => &mut self.junction,
            "motorcar" => &mut self.motorcar,
            "motor_vehicle" => &mut self.motor_vehicle,
            "vehicle" => &mut self.vehicle,
            "access" => &mut self.access,
            "bus" => &mut self.bus,
            "psv" => &mut self.psv,
            "surface" => &mut self.surface,
            "service" => &mut self.service,
            "layer" => &mut self.layer,
            "bridge" => &mut self.bridge,
            "tunnel" => &mut self.tunnel,
            "lanes" => &mut self.lanes,
            "lanes:forward" => &mut self.lanes_forward,
            "lanes:backward" => &mut self.lanes_backward,
            "lanes:reversible" => &mut self.lanes_reversible,
            "route" => &mut self.route,
            "footway" => &mut self.footway,
            "conveying" => &mut self.conveying,
            "area" => &mut self.area,
            "indoor" => &mut self.indoor,
            "cycleway:left" => &mut self.cycleway_left,
            "cycleway:right" => &mut self.cycleway_right,
            "cycleway:both" => &mut self.cycleway_both,
            "segregated" => &mut self.segregated,
            "foot" => &mut self.foot,
            "bicycle" => &mut self.bicycle,
            "cycleway" => &mut self.cycleway,
            "sidewalk" => &mut self.sidewalk,
            "sidewalk:both" => &mut self.sidewalk_both,
            "sidewalk:left" => &mut self.sidewalk_left,
            "sidewalk:right" => &mut self.sidewalk_right,
            "motorroad" => &mut self.motorroad,
            "oneway:foot" => &mut self.oneway_foot,
            "oneway:bicycle" => &mut self.oneway_bicycle,
            _ => return,
        };
        if slot.is_none() {
            *slot = Some(v.into());
        }
    }
}

/// An OSM way with a highway tag, in the node order of the file.
#[derive(Clone, Debug)]
pub struct Way {
    pub id: i64,
    pub refs: Vec<i64>,
    pub tags: Tags,
}

/// The columns of an edge that come from its way and are the same on all its edges.
/// The edges of a way share one copy, so an edge does not keep its own strings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Attrs {
    pub highway: String,
    pub name: Option<String>,
    pub maxspeed: Option<String>,
    pub surface: Option<String>,
    pub junction: Option<String>,
    pub layer: Option<String>,
    pub bridge: Option<String>,
    pub tunnel: Option<String>,
    pub service: Option<String>,
}

/// A row of the `edges` table.
#[derive(Clone, Debug)]
pub struct Edge {
    pub edge_id: i64,
    /// The number in `edge_ref` (see [`Edge::edge_ref`]).
    pub seq: Option<u32>,
    pub source: i64,
    pub target: i64,
    pub osm_id: i64,
    pub attrs: Arc<Attrs>,
    pub oneway: bool,
    pub lanes: Option<i32>,
    /// Not in `attrs`: the reverse edge of a bus lane gets "bus".
    pub access: Option<Arc<str>>,
    pub refs: Vec<i64>,
    pub geometry: Vec<Pt>,
    pub is_reverse: bool,
    pub length_m: f32,
    /// Cycling only: the edge is walked, not ridden. None in the other modes.
    pub dismount: Option<bool>,
    /// With the speed step: the speed in km/h (the writer then leaves out the raw `maxspeed`) and the
    /// travel time.
    pub maxspeed_kmh: Option<f32>,
    pub cost_s: Option<f32>,
    /// Walking: `walk_type`. Cycling: `cycle_type`. None in the driving mode, or without the step.
    pub ftype: Option<&'static str>,
}

impl Edge {
    /// `edge_ref`: `{osm_id}#{seq}{f|r}`.
    pub fn edge_ref(&self) -> Option<String> {
        let dir = if self.is_reverse { 'r' } else { 'f' };
        self.seq.map(|q| format!("{}#{q}{dir}", self.osm_id))
    }
}

/// A row of the `nodes` table. A virtual node has `node_id < 0`.
#[derive(Clone, Copy, Debug)]
pub struct Node {
    pub node_id: i64,
    pub lon: f64,
    pub lat: f64,
}

/// The result of the network step for one mode.
#[derive(Default, Debug)]
pub struct Network {
    pub edges: Vec<Edge>,
    pub private_edges: Vec<Edge>,
    pub nodes: Vec<Node>,
    /// One row for each piece of each merged edge (only with `merge_segments`).
    pub edge_id_map: Vec<MapRow>,
    pub stats: Stats,
}

/// A row of `edge_id_map`: the piece `old_edge_id` is part of the merged edge `new_edge_id`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MapRow {
    pub old_edge_id: i64,
    pub new_edge_id: i64,
    pub seq: i32,
    pub is_reverse: bool,
    pub osm_id: i64,
}

#[derive(Default, Debug, Clone)]
pub struct Stats {
    pub ways_read: usize,
    pub ways_kept: usize,
    pub forward_edges: usize,
    pub self_loops_split: usize,
    pub parallel_split: usize,
    pub antiparallel_split: usize,
    pub merged_chains: usize,
    pub connectors: usize,
    pub merged_pieces: usize,
    pub private_edges: usize,
    pub dropped_by_component_filter: usize,
}
