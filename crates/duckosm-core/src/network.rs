//! The network step for the driving mode: ways in, edges and nodes out. It follows
//! `GlobalJunctions`, `RoadFilter`, `GraphSimplifier`, `_split_private` and `ComponentFilter` of duckOSM.
//! Not in this version: `merge_segments`, OSM overrides, speeds, costs, turn restrictions, H3.

use crate::filter::{self, ModeWay, NON_ROAD};
use crate::geom::{self, Pt};
use crate::hash;
use crate::model::{Edge, Network, Node, Stats, Way};
use crate::util::{FxHashMap, FxHashSet};

#[derive(Clone, Debug)]
pub struct Options {
    /// Keep only the largest connected part of the graph (duckOSM does this when a boundary is set).
    pub keep_largest_component: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            keep_largest_component: true,
        }
    }
}

/// Node id -> (longitude, latitude).
pub type Coords = FxHashMap<i64, Pt>;

/// A forward edge while the graph is built. `way` is the index of its way in the filtered list.
struct Fwd {
    e: Edge,
    way: usize,
}

#[derive(Default)]
struct Agg {
    ways: u32,
    road: u32,
    road_end: u32,
}

/// `main.global_junctions`: node id -> is a road junction (false: only paths are cut there).
fn global_junctions(ways: &[Way]) -> FxHashMap<i64, bool> {
    let mut agg: FxHashMap<i64, Agg> = FxHashMap::default();
    for w in ways.iter().filter(|w| filter::is_built_highway(&w.tags)) {
        let road = filter::is_road_raw(&w.tags);
        let n = w.refs.len();
        for (pos, &node) in w.refs.iter().enumerate() {
            let a = agg.entry(node).or_default();
            a.ways += 1;
            if road {
                a.road += 1;
                if pos == 0 || pos + 1 == n {
                    a.road_end += 1;
                }
            }
        }
    }
    agg.into_iter()
        .filter(|(_, a)| {
            (a.road > 0 && (a.ways > 1 || a.road_end > 0)) || (a.road == 0 && a.ways > 1)
        })
        .map(|(n, a)| (n, a.road > 0))
        .collect()
}

/// `junctions`: the nodes where the ways of this mode meet, or end.
fn local_junctions(mw: &[ModeWay]) -> FxHashSet<i64> {
    let mut cnt: FxHashMap<i64, (u32, u32)> = FxHashMap::default();
    for w in mw {
        let n = w.refs.len();
        for (pos, &node) in w.refs.iter().enumerate() {
            let c = cnt.entry(node).or_default();
            c.0 += 1;
            if pos == 0 || pos + 1 == n {
                c.1 += 1;
            }
        }
    }
    cnt.into_iter()
        .filter(|(_, c)| c.0 > 1 || c.1 > 0)
        .map(|(n, _)| n)
        .collect()
}

/// Cut the nodes of a way into groups of node positions, one group for each edge (`_segment_ways`).
fn segments(split: &[bool]) -> Vec<Vec<usize>> {
    let n = split.len();
    let mut next: Vec<Option<usize>> = vec![None; n]; // nearest split strictly after
    let mut nx = None;
    for i in (0..n).rev() {
        next[i] = nx;
        if split[i] {
            nx = Some(i);
        }
    }
    let mut groups: Vec<(Option<usize>, Vec<usize>)> = Vec::new();
    let mut push =
        |key: Option<usize>, i: usize, groups: &mut Vec<(Option<usize>, Vec<usize>)>| match groups
            .iter_mut()
            .rev()
            .take(2)
            .find(|g| g.0 == key)
        {
            Some(g) => g.1.push(i),
            None => groups.push((key, vec![i])),
        };
    let mut last: Option<usize> = None; // latest split at or before i
    let mut prev: Option<usize>; // latest split strictly before i
    for i in 0..n {
        prev = last;
        if split[i] {
            last = Some(i);
        }
        if !split[i] {
            push(last, i, &mut groups);
        } else {
            if next[i].is_some() {
                push(Some(i), i, &mut groups);
            }
            if prev.is_some() {
                push(prev, i, &mut groups);
            }
        }
    }
    groups.into_iter().map(|g| g.1).collect()
}

/// The two parts of a node list for a split edge. DuckDB: `refs[1 : len/2 + 1]` and `refs[len/2 + 1 :]`,
/// where `/` is a float division and the index is rounded half to even.
fn split_refs(refs: &[i64]) -> (Vec<i64>, Vec<i64>) {
    let k = ((refs.len() as f64) / 2.0 + 1.0).round_ties_even() as usize;
    let k = k.clamp(1, refs.len().max(1));
    (refs[..k].to_vec(), refs[k - 1..].to_vec())
}

fn half(src: &Edge, source: i64, target: i64, refs: Vec<i64>, geometry: Vec<Pt>) -> Edge {
    Edge {
        source,
        target,
        refs,
        geometry,
        length_m: src.length_m / 2.0,
        ..src.clone()
    }
}

fn refs_key(e: &Edge) -> String {
    hash::refs_text(&e.refs)
}

pub fn build_driving(all_ways: &[Way], coords: &Coords, opts: &Options) -> Result<Network, String> {
    let mut stats = Stats {
        ways_read: all_ways.len(),
        ..Default::default()
    };
    let gj = global_junctions(all_ways);
    let mw: Vec<ModeWay> = all_ways.iter().filter_map(filter::driving_way).collect();
    stats.ways_kept = mw.len();
    let lj = local_junctions(&mw);

    // 1. Cut every way into forward edges.
    let mut fwd: Vec<Fwd> = Vec::new();
    for (wi, w) in mw.iter().enumerate() {
        let is_road = !NON_ROAD.contains(&w.highway.as_str());
        let split: Vec<bool> = w
            .refs
            .iter()
            .map(|n| {
                if is_road {
                    gj.get(n) == Some(&true)
                } else {
                    lj.contains(n) || gj.contains_key(n)
                }
            })
            .collect();
        for g in segments(&split) {
            // a node without coordinates leaves the list (an inner join in the SQL)
            let mut refs = Vec::with_capacity(g.len());
            let mut geometry = Vec::with_capacity(g.len());
            for &i in &g {
                if let Some(&p) = coords.get(&w.refs[i]) {
                    refs.push(w.refs[i]);
                    geometry.push(p);
                }
            }
            if refs.len() < 2 {
                continue;
            }
            let length_m = geom::line_length_m(&geometry);
            fwd.push(Fwd {
                e: Edge {
                    edge_id: 0,
                    edge_ref: None,
                    source: refs[0],
                    target: refs[refs.len() - 1],
                    osm_id: w.id,
                    highway: w.highway.clone(),
                    name: w.name.clone(),
                    maxspeed: w.maxspeed.clone(),
                    oneway: w.oneway,
                    lanes: w.lanes_fwd,
                    surface: w.surface.clone(),
                    access: w.access.clone(),
                    junction: w.junction.clone(),
                    layer: w.layer.clone(),
                    bridge: w.bridge.clone(),
                    tunnel: w.tunnel.clone(),
                    service: w.service.clone(),
                    refs,
                    geometry,
                    is_reverse: false,
                    length_m,
                },
                way: wi,
            });
        }
    }
    stats.forward_edges = fwd.len();
    let mut virtual_nodes: Vec<Node> = Vec::new();

    // 2. Split the self-loops with a virtual node in the middle.
    let mut out: Vec<Fwd> = Vec::with_capacity(fwd.len());
    for f in fwd {
        if f.e.source != f.e.target {
            out.push(f);
            continue;
        }
        let rr = geom::remove_repeated(&f.e.geometry);
        if rr.len() < 3 {
            continue; // a loop of fewer than 3 distinct points disappears
        }
        let v = hash::virtual_node_loop(f.e.osm_id, f.e.source, &f.e.refs);
        let mid = geom::interpolate(&rr, 0.5);
        let (r1, r2) = split_refs(&f.e.refs);
        virtual_nodes.push(Node {
            node_id: v,
            lon: mid.0,
            lat: mid.1,
        });
        out.push(Fwd {
            e: half(&f.e, f.e.source, v, r1, geom::substring(&rr, 0.0, 0.5)),
            way: f.way,
        });
        out.push(Fwd {
            e: half(&f.e, v, f.e.source, r2, geom::substring(&rr, 0.5, 1.0)),
            way: f.way,
        });
        stats.self_loops_split += 1;
    }
    let mut fwd = out;

    // 3. Split same-direction parallel arcs (all but the shortest of each group).
    let mut groups: FxHashMap<(i64, i64, i64), Vec<usize>> = FxHashMap::default();
    for (i, f) in fwd.iter().enumerate() {
        if f.e.source != f.e.target {
            groups
                .entry((f.e.osm_id, f.e.source, f.e.target))
                .or_default()
                .push(i);
        }
    }
    let mut sel = FxHashSet::default();
    for idx in groups.values().filter(|v| v.len() > 1) {
        let key = |i: usize| (fwd[i].e.length_m, refs_key(&fwd[i].e));
        let min = idx
            .iter()
            .map(|&i| key(i))
            .min_by(|a, b| a.partial_cmp(b).unwrap())
            .unwrap();
        for &i in idx {
            if key(i).partial_cmp(&min) == Some(std::cmp::Ordering::Greater) {
                sel.insert(i);
            }
        }
    }
    stats.parallel_split = sel.len();
    fwd = split_arcs(fwd, &sel, &mut virtual_nodes);

    // 4. Split two-way antiparallel pairs (the longer arc of each pair).
    let mut by_key: FxHashMap<(i64, i64, i64), Vec<usize>> = FxHashMap::default();
    for (i, f) in fwd.iter().enumerate() {
        by_key
            .entry((f.e.osm_id, f.e.source, f.e.target))
            .or_default()
            .push(i);
    }
    let mut sel = FxHashSet::default();
    for (i, f) in fwd.iter().enumerate() {
        if f.e.oneway || f.e.source == f.e.target {
            continue;
        }
        if let Some(others) = by_key.get(&(f.e.osm_id, f.e.target, f.e.source)) {
            let mine = (f.e.length_m, refs_key(&f.e));
            for &j in others {
                if fwd[j].e.oneway {
                    continue;
                }
                let theirs = (fwd[j].e.length_m, refs_key(&fwd[j].e));
                if mine.partial_cmp(&theirs) == Some(std::cmp::Ordering::Greater) {
                    sel.insert(i);
                }
            }
        }
    }
    stats.antiparallel_split = sel.len();
    fwd = split_arcs(fwd, &sel, &mut virtual_nodes);

    // 5. Add the reverse edge of each two-way way (and of a one-way way with a bus lane).
    let mut edges: Vec<Edge> = Vec::with_capacity(fwd.len() * 2);
    let mut rev: Vec<Edge> = Vec::new();
    for f in &fwd {
        let w = &mw[f.way];
        if !f.e.oneway || w.bus_back {
            let mut r = f.e.clone();
            r.source = f.e.target;
            r.target = f.e.source;
            r.lanes = w.lanes_bwd;
            if f.e.oneway {
                r.access = Some("bus".to_string());
            }
            r.refs.reverse();
            r.geometry.reverse();
            r.is_reverse = true;
            rev.push(r);
        }
    }
    edges.extend(fwd.into_iter().map(|f| f.e));
    edges.extend(rev);

    // 6. The stable edge_id, edge_ref, and the check that (osm_id, source, target) is unique.
    let mut seen: FxHashSet<(i64, i64, i64)> = FxHashSet::default();
    for e in &edges {
        if !seen.insert((e.osm_id, e.source, e.target)) {
            return Err(format!(
                "duplicate (osm_id, source, target) after the splits: {} {}->{}",
                e.osm_id, e.source, e.target
            ));
        }
    }
    let raw_refs: FxHashMap<i64, &Vec<i64>> = all_ways.iter().map(|w| (w.id, &w.refs)).collect();
    set_refs_and_ids(&mut edges, &raw_refs);

    // 7. Correct the length of the edges whose halves were wrong by more than 0.1 %.
    for e in &mut edges {
        let m = geom::line_length_m(&e.geometry);
        if m > 0.0 && (((e.length_m / m) - 1.0f32).abs() as f64) > 0.001 {
            e.length_m = m;
        }
    }

    // 8. The nodes.
    let used: FxHashSet<i64> = edges.iter().flat_map(|e| [e.source, e.target]).collect();
    let mut nodes: Vec<Node> = Vec::new();
    for &n in &used {
        if n > 0 {
            if let Some(&(lon, lat)) = coords.get(&n) {
                nodes.push(Node {
                    node_id: n,
                    lon,
                    lat,
                });
            }
        }
    }
    nodes.extend(virtual_nodes);

    // 9. Move private roads, bus-only roads and pedestrian streets to private_edges.
    let moved = |e: &Edge| {
        matches!(e.access.as_deref(), Some("private") | Some("bus")) || e.highway == "pedestrian"
    };
    let (private_edges, mut edges): (Vec<Edge>, Vec<Edge>) = edges.into_iter().partition(moved);
    stats.private_edges = private_edges.len();
    if !private_edges.is_empty() {
        prune_nodes(&mut nodes, &edges);
    }

    // 10. Keep the largest connected part.
    if opts.keep_largest_component && !edges.is_empty() {
        let before = edges.len();
        keep_largest(&mut edges);
        stats.dropped_by_component_filter = before - edges.len();
        if before != edges.len() {
            prune_nodes(&mut nodes, &edges);
        }
    }

    edges.sort_by_key(|e| e.edge_id);
    let mut private_edges = private_edges;
    private_edges.sort_by_key(|e| e.edge_id);
    nodes.sort_by_key(|n| n.node_id);
    nodes.dedup_by_key(|n| n.node_id);
    Ok(Network {
        edges,
        private_edges,
        nodes,
        stats,
    })
}

/// Split the forward edges in `sel` at their midpoint with a virtual node (`_split_arcs_at_midpoint`).
fn split_arcs(fwd: Vec<Fwd>, sel: &FxHashSet<usize>, vnodes: &mut Vec<Node>) -> Vec<Fwd> {
    if sel.is_empty() {
        return fwd;
    }
    let mut out = Vec::with_capacity(fwd.len() + sel.len());
    for (i, f) in fwd.into_iter().enumerate() {
        if !sel.contains(&i) {
            out.push(f);
            continue;
        }
        let rr = geom::remove_repeated(&f.e.geometry);
        if rr.len() < 2 {
            continue;
        }
        let v = hash::virtual_node_arc(f.e.osm_id, f.e.source, f.e.target, &f.e.refs);
        let mid = geom::interpolate(&rr, 0.5);
        let (r1, r2) = split_refs(&f.e.refs);
        vnodes.push(Node {
            node_id: v,
            lon: mid.0,
            lat: mid.1,
        });
        out.push(Fwd {
            e: half(&f.e, f.e.source, v, r1, geom::substring(&rr, 0.0, 0.5)),
            way: f.way,
        });
        out.push(Fwd {
            e: half(&f.e, v, f.e.target, r2, geom::substring(&rr, 0.5, 1.0)),
            way: f.way,
        });
    }
    out
}

/// `edge_id` and `edge_ref` (`{osm_id}#{seq}{f|r}`). seq numbers the forward edges of a way by the
/// position of their source node in the original node list; a reverse edge takes the seq of its twin.
fn set_refs_and_ids(edges: &mut [Edge], raw_refs: &FxHashMap<i64, &Vec<i64>>) {
    let mut keys: FxHashMap<i64, Vec<(usize, i64, i64)>> = FxHashMap::default();
    for e in edges.iter().filter(|e| !e.is_reverse) {
        let pos = raw_refs
            .get(&e.osm_id)
            .and_then(|r| r.iter().position(|&n| n == e.source))
            .map_or(2_000_000_000usize, |p| p + 1);
        keys.entry(e.osm_id)
            .or_default()
            .push((pos, e.source, e.target));
    }
    for v in keys.values_mut() {
        v.sort();
        v.dedup();
    }
    for e in edges.iter_mut() {
        e.edge_id = hash::edge_id(e.osm_id, e.source, e.target);
        let (s, t) = if e.is_reverse {
            (e.target, e.source)
        } else {
            (e.source, e.target)
        };
        let seq = keys.get(&e.osm_id).and_then(|v| {
            let pos = raw_refs
                .get(&e.osm_id)
                .and_then(|r| r.iter().position(|&n| n == s))
                .map_or(2_000_000_000usize, |p| p + 1);
            v.binary_search(&(pos, s, t)).ok().map(|i| i + 1)
        });
        e.edge_ref =
            seq.map(|q| format!("{}#{}{}", e.osm_id, q, if e.is_reverse { 'r' } else { 'f' }));
    }
}

fn prune_nodes(nodes: &mut Vec<Node>, edges: &[Edge]) {
    let used: FxHashSet<i64> = edges.iter().flat_map(|e| [e.source, e.target]).collect();
    nodes.retain(|n| used.contains(&n.node_id));
}

/// Keep the largest weakly connected component (union-find over the edge ends).
fn keep_largest(edges: &mut Vec<Edge>) {
    let mut id: FxHashMap<i64, usize> = FxHashMap::default();
    let mut parent: Vec<usize> = Vec::new();
    fn find(p: &mut Vec<usize>, mut x: usize) -> usize {
        while p[x] != x {
            p[x] = p[p[x]];
            x = p[x];
        }
        x
    }
    let mut ends = Vec::with_capacity(edges.len());
    for e in edges.iter() {
        let mut get = |n: i64, parent: &mut Vec<usize>| {
            *id.entry(n).or_insert_with(|| {
                parent.push(parent.len());
                parent.len() - 1
            })
        };
        let a = get(e.source, &mut parent);
        let b = get(e.target, &mut parent);
        ends.push(a);
        let (ra, rb) = (find(&mut parent, a), find(&mut parent, b));
        if ra != rb {
            parent[ra] = rb;
        }
    }
    let mut sizes: FxHashMap<usize, usize> = FxHashMap::default();
    let roots: Vec<usize> = ends.iter().map(|&a| find(&mut parent, a)).collect();
    for &r in &roots {
        *sizes.entry(r).or_default() += 1;
    }
    let largest = *sizes
        .iter()
        .max_by_key(|(r, n)| (**n, std::cmp::Reverse(**r)))
        .unwrap()
        .0;
    let mut i = 0;
    edges.retain(|_| {
        let keep = roots[i] == largest;
        i += 1;
        keep
    });
}
