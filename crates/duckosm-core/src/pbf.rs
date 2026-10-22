//! Read an `.osm.pbf` file: the highway ways first, then the coordinates of the nodes they use.

use crate::boundary::Boundary;
use crate::filter;
use crate::geom::Pt;
use crate::graph::{MemberType, Relation};
use crate::model::{Tags, Way};
use crate::network::Coords;
use crate::util::FxHashSet;
use osmpbf::Element;
pub use osmpbf::ElementReader;
use std::io::{Cursor, Read};
use std::path::Path;

fn open(path: &Path) -> Result<ElementReader<std::io::BufReader<std::fs::File>>, String> {
    ElementReader::from_path(path).map_err(|e| e.to_string())
}

fn from_bytes(pbf: &[u8]) -> ElementReader<Cursor<&[u8]>> {
    ElementReader::new(Cursor::new(pbf))
}

/// Pass 1: all highway ways and ferry lines, sorted by id.
pub fn read_ways(path: &Path) -> Result<Vec<Way>, String> {
    ways_of(open(path)?)
}

/// Pass 1 on the bytes of a `.osm.pbf` file (WebAssembly has no file system).
pub fn read_ways_bytes(pbf: &[u8]) -> Result<Vec<Way>, String> {
    ways_of(from_bytes(pbf))
}

/// Pass 2: the coordinates of the nodes in `ways`.
pub fn read_coords(path: &Path, ways: &[Way]) -> Result<Coords, String> {
    coords_of(open(path)?, ways)
}

/// Pass 2 on the bytes of a `.osm.pbf` file.
pub fn read_coords_bytes(pbf: &[u8], ways: &[Way]) -> Result<Coords, String> {
    coords_of(from_bytes(pbf), ways)
}

/// Pass 3: the `type=restriction` relations (the turn restrictions), sorted by id.
pub fn read_restrictions(path: &Path) -> Result<Vec<Relation>, String> {
    restrictions_of(open(path)?)
}

/// Pass 3 on the bytes of a `.osm.pbf` file.
pub fn read_restrictions_bytes(pbf: &[u8]) -> Result<Vec<Relation>, String> {
    restrictions_of(from_bytes(pbf))
}

/// Pass 3 on any reader (the browser reads a file piece by piece).
pub fn restrictions_of<R: Read + Send>(reader: ElementReader<R>) -> Result<Vec<Relation>, String> {
    let mut rels = reader
        .par_map_reduce(
            |el| match el {
                Element::Relation(r) => restriction(&r).into_iter().collect(),
                _ => Vec::new(),
            },
            Vec::new,
            |mut a, mut b| {
                a.append(&mut b);
                a
            },
        )
        .map_err(|e| e.to_string())?;
    rels.sort_by_key(|r| r.id);
    Ok(rels)
}

/// A `type=restriction` relation (duckOSM: `map_extract(tags, 'type')[1] = 'restriction'`).
fn restriction(r: &osmpbf::Relation) -> Option<Relation> {
    if r.tags().find(|t| t.0 == "type").map(|t| t.1) != Some("restriction") {
        return None;
    }
    Some(Relation {
        id: r.id(),
        tags: r
            .tags()
            .map(|(k, x)| (k.to_string(), x.to_string()))
            .collect(),
        members: r
            .members()
            .map(|m| {
                let t = match m.member_type {
                    osmpbf::RelMemberType::Node => MemberType::Node,
                    osmpbf::RelMemberType::Way => MemberType::Way,
                    osmpbf::RelMemberType::Relation => MemberType::Relation,
                };
                (m.member_id, t, m.role().unwrap_or("").to_string())
            })
            .collect(),
    })
}

/// The data of an area, as osmium's `complete_ways` cut gives it to the network step: the highway ways and ferry
/// lines with at least one node inside the boundary, kept whole, the coordinates of their nodes and of the nodes
/// inside, and all `type=restriction` relations of the file (as [`read_restrictions`]: the graph step keeps the
/// ones that it can use). Three passes over the file: `open` gives a new reader for each pass.
pub fn read_area<R: Read + Send>(
    open: impl Fn() -> Result<ElementReader<R>, String>,
    boundary: &Boundary,
) -> Result<(Vec<Way>, Coords, Vec<Relation>), String> {
    // pass 1: the nodes inside
    let inside: Vec<(i64, Pt)> = open()?
        .par_map_reduce(
            |el| {
                let p = match el {
                    Element::Node(n) => Some((n.id(), (n.lon(), n.lat()))),
                    Element::DenseNode(n) => Some((n.id(), (n.lon(), n.lat()))),
                    _ => None,
                };
                p.filter(|(_, (x, y))| boundary.contains(*x, *y))
                    .into_iter()
                    .collect()
            },
            Vec::new,
            |mut a: Vec<(i64, Pt)>, mut b| {
                a.append(&mut b);
                a
            },
        )
        .map_err(|e| e.to_string())?;
    let ids: FxHashSet<i64> = inside.iter().map(|n| n.0).collect();
    // pass 2: the ways with a node inside, and the restrictions
    let (mut ways, mut rels) = open()?
        .par_map_reduce(
            |el| match el {
                Element::Way(w) => (way(&w).into_iter().collect(), Vec::new()),
                Element::Relation(r) => (Vec::new(), restriction(&r).into_iter().collect()),
                _ => (Vec::new(), Vec::new()),
            },
            || (Vec::new(), Vec::new()),
            |mut a: (Vec<Way>, Vec<Relation>), mut b| {
                a.0.append(&mut b.0);
                a.1.append(&mut b.1);
                a
            },
        )
        .map_err(|e| e.to_string())?;
    ways.retain(|w| w.refs.iter().any(|n| ids.contains(n)));
    ways.sort_by_key(|w| w.id);
    ways.shrink_to_fit();
    rels.sort_by_key(|r| r.id);
    // pass 3: the coordinates of their nodes; the nodes inside are known already (a new way of the OSM fixes
    // can use one, as with the osmium cut)
    let mut coords = coords_of(open()?, &ways)?;
    coords.extend(inside);
    Ok((ways, coords, rels))
}

/// [`read_area`] on a file.
pub fn read_area_path(
    path: &Path,
    boundary: &Boundary,
) -> Result<(Vec<Way>, Coords, Vec<Relation>), String> {
    read_area(|| open(path), boundary)
}

/// A highway way or ferry line that the reader keeps.
fn way(w: &osmpbf::Way) -> Option<Way> {
    let tags = Tags::from_pairs(w.tags());
    filter::is_kept_by_reader(&tags).then(|| Way {
        id: w.id(),
        refs: w.refs().collect(),
        tags,
    })
}

fn ways_of<R: Read + Send>(reader: ElementReader<R>) -> Result<Vec<Way>, String> {
    let mut ways = reader
        .par_map_reduce(
            |el| match el {
                Element::Way(w) => way(&w).into_iter().collect(),
                _ => Vec::new(),
            },
            Vec::new,
            |mut a, mut b| {
                a.append(&mut b);
                a
            },
        )
        .map_err(|e| e.to_string())?;
    ways.sort_by_key(|w| w.id);
    ways.shrink_to_fit(); // the merge of the blocks leaves up to half of the capacity unused
    Ok(ways)
}

fn coords_of<R: Read + Send>(reader: ElementReader<R>, ways: &[Way]) -> Result<Coords, String> {
    // the exact size at once: a set that grows by doubling keeps the old and the new table
    let mut needed: FxHashSet<i64> = FxHashSet::default();
    needed.reserve(ways.iter().map(|w| w.refs.len()).sum());
    needed.extend(ways.iter().flat_map(|w| w.refs.iter().copied()));
    let nodes = reader
        .par_map_reduce(
            |el| match el {
                Element::Node(n) if needed.contains(&n.id()) => vec![(n.id(), (n.lon(), n.lat()))],
                Element::DenseNode(n) if needed.contains(&n.id()) => {
                    vec![(n.id(), (n.lon(), n.lat()))]
                }
                _ => Vec::new(),
            },
            Vec::new,
            |mut a, mut b| {
                a.append(&mut b);
                a
            },
        )
        .map_err(|e| e.to_string())?;
    drop(needed);
    Ok(Coords::new(nodes))
}
