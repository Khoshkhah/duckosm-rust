//! Read an `.osm.pbf` file: the highway ways first, then the coordinates of the nodes they use.

use crate::boundary::Boundary;
use crate::filter;
use crate::geom::Pt;
use crate::graph::{MemberType, Relation};
use crate::model::{OtherTags, Tags, Way};
use crate::network::Coords;
use crate::util::FxHashSet;
use osmpbf::{Blob, BlobDecode, ByteOffset, Element, PrimitiveBlock};
pub use osmpbf::{BlobReader, ElementReader};
use rayon::prelude::*;
use std::io::{Cursor, Read, Seek};
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

/// A block of nodes in a PBF file: where it starts, its smallest and largest node id, and whether it also has
/// ways or relations.
#[derive(Clone, Copy)]
struct NodeBlock {
    at: ByteOffset,
    first: i64,
    last: i64,
    mixed: bool,
}

/// The nodes of a block.
fn each_node(block: &PrimitiveBlock, mut f: impl FnMut(i64, Pt)) {
    for g in block.groups() {
        for n in g.dense_nodes() {
            f(n.id(), (n.lon(), n.lat()));
        }
        for n in g.nodes() {
            f(n.id(), (n.lon(), n.lat()));
        }
    }
}

fn data(blob: &Blob) -> Result<Option<PrimitiveBlock>, String> {
    match blob.decode().map_err(|e| e.to_string())? {
        BlobDecode::OsmData(b) => Ok(Some(b)),
        _ => Ok(None),
    }
}

/// The next blobs of the file: enough to keep all threads busy, and few, because pass 1 stops in a batch.
fn batch<R: Read + Send>(blobs: &mut BlobReader<R>) -> Result<Vec<Blob>, String> {
    blobs
        .take(2 * rayon::current_num_threads())
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())
}

/// The data of an area, as osmium's `complete_ways` cut gives it to the network step: the highway ways and ferry
/// lines with at least one node inside the boundary, kept whole, the coordinates of their nodes and of the nodes
/// inside, and all `type=restriction` relations of the file (as [`read_restrictions`]: the graph step keeps the
/// ones that it can use). `open` gives a new reader for each pass:
/// 1. The node blocks: the nodes inside, and where each block is and the range of its node ids. In a file sorted
///    by type (`Sort.Type_then_ID`, as the files of Geofabrik), the pass stops at the first block of ways.
/// 2. The blocks that are not only nodes: the ways with a node inside, and the restrictions.
/// 3. Only the node blocks that have a node of these ways outside the boundary: the coordinates of these nodes.
pub fn read_area<R: Read + Seek + Send>(
    open: impl Fn() -> Result<BlobReader<R>, String>,
    boundary: &Boundary,
) -> Result<(Vec<Way>, Coords, Vec<Relation>), String> {
    cut(open, boundary, true)
}

/// [`read_area`]; `use_sort: false` reads the file as if it had no sort flag (for the test).
fn cut<R: Read + Seek + Send>(
    open: impl Fn() -> Result<BlobReader<R>, String>,
    boundary: &Boundary,
    use_sort: bool,
) -> Result<(Vec<Way>, Coords, Vec<Relation>), String> {
    let err = |e: osmpbf::Error| e.to_string();
    // pass 1
    let mut blobs = open()?;
    let sorted = use_sort
        && match blobs.next().transpose().map_err(err)? {
            Some(h) => match h.decode().map_err(err)? {
                BlobDecode::OsmHeader(h) => h
                    .optional_features()
                    .iter()
                    .any(|f| f == "Sort.Type_then_ID"),
                _ => false,
            },
            None => return Err("the PBF file is empty".into()),
        };
    let (mut blocks, mut inside, mut ways_at) = (Vec::new(), Vec::new(), None);
    'pass1: loop {
        let b = batch(&mut blobs)?;
        if b.is_empty() {
            break;
        }
        let found = b
            .into_par_iter()
            .map(|blob| -> Result<_, String> {
                let Some(block) = data(&blob)? else {
                    return Ok(None);
                };
                let at = blob.offset().ok_or("the PBF reader gave no offset")?;
                let mut nb = NodeBlock {
                    at,
                    first: i64::MAX,
                    last: i64::MIN,
                    mixed: block
                        .groups()
                        .any(|g| g.ways().next().is_some() || g.relations().next().is_some()),
                };
                let mut pts = Vec::new();
                each_node(&block, |id, p| {
                    nb.first = nb.first.min(id);
                    nb.last = nb.last.max(id);
                    if boundary.contains(p.0, p.1) {
                        pts.push((id, p));
                    }
                });
                Ok(Some((nb, pts)))
            })
            .collect::<Result<Vec<_>, _>>()?;
        for (nb, mut pts) in found.into_iter().flatten() {
            if nb.first <= nb.last {
                blocks.push(nb);
                inside.append(&mut pts);
            }
            if nb.mixed && sorted {
                ways_at = Some(nb.at);
                break 'pass1;
            }
        }
    }
    let ids: FxHashSet<i64> = inside.iter().map(|n| n.0).collect();
    // pass 2: from the first block of ways, or all blocks that are not only nodes
    let only_nodes: FxHashSet<u64> = blocks.iter().filter(|b| !b.mixed).map(|b| b.at.0).collect();
    let mut blobs = open()?;
    if let Some(at) = ways_at {
        blobs.seek(at).map_err(err)?;
    }
    let (mut ways, mut rels) = (Vec::new(), Vec::new());
    loop {
        let b = batch(&mut blobs)?;
        if b.is_empty() {
            break;
        }
        let found = b
            .into_par_iter()
            .filter(|blob| blob.offset().is_none_or(|o| !only_nodes.contains(&o.0)))
            .map(|blob| -> Result<(Vec<Way>, Vec<Relation>), String> {
                let (mut w, mut r) = (Vec::new(), Vec::new());
                if let Some(block) = data(&blob)? {
                    for g in block.groups() {
                        w.extend(
                            g.ways()
                                .filter(|x| x.refs().any(|n| ids.contains(&n)))
                                .filter_map(|x| way(&x)),
                        );
                        r.extend(g.relations().filter_map(|x| restriction(&x)));
                    }
                }
                Ok((w, r))
            })
            .collect::<Result<Vec<_>, _>>()?;
        for (mut w, mut r) in found {
            ways.append(&mut w);
            rels.append(&mut r);
        }
    }
    ways.sort_by_key(|w| w.id);
    rels.sort_by_key(|r| r.id);
    // pass 3: the nodes inside are known already (a new way of the OSM fixes can use one, as with the osmium cut)
    let mut missing: Vec<i64> = ways
        .iter()
        .flat_map(|w| w.refs.iter().copied())
        .filter(|n| !ids.contains(n))
        .collect();
    missing.sort_unstable();
    missing.dedup();
    let wanted: Vec<ByteOffset> = blocks
        .iter()
        .filter(|b| {
            let i = missing.partition_point(|&n| n < b.first);
            i < missing.len() && missing[i] <= b.last
        })
        .map(|b| b.at)
        .collect();
    let mut blobs = open()?;
    let mut nodes = inside;
    for part in wanted.chunks(2 * rayon::current_num_threads()) {
        let b = part
            .iter()
            .map(|&at| blobs.blob_from_offset(at))
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        let found = b
            .into_par_iter()
            .map(|blob| -> Result<Vec<(i64, Pt)>, String> {
                let mut v = Vec::new();
                if let Some(block) = data(&blob)? {
                    each_node(&block, |id, p| {
                        if missing.binary_search(&id).is_ok() {
                            v.push((id, p));
                        }
                    });
                }
                Ok(v)
            })
            .collect::<Result<Vec<_>, _>>()?;
        nodes.extend(found.into_iter().flatten());
    }
    Ok((ways, Coords::new(nodes), rels))
}

/// [`read_area`] on a file.
pub fn read_area_path(
    path: &Path,
    boundary: &Boundary,
) -> Result<(Vec<Way>, Coords, Vec<Relation>), String> {
    read_area(
        || BlobReader::from_path(path).map_err(|e| e.to_string()),
        boundary,
    )
}

/// A highway way or ferry line that the reader keeps.
fn way(w: &osmpbf::Way) -> Option<Way> {
    let tags = Tags::from_pairs(w.tags());
    filter::is_kept_by_reader(&tags).then(|| Way {
        id: w.id(),
        refs: w.refs().collect(),
        tags,
        other: OtherTags::of(w.tags()),
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A file without the sort flag: pass 1 reads all blocks, pass 2 skips the blocks of only nodes. The result
    /// is the same.
    #[test]
    fn cut_without_the_sort_flag() {
        let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/data");
        let b = Boundary::parse(&std::fs::read_to_string(data.join("monaco.geojson")).unwrap())
            .unwrap();
        let path = data.join("monaco_sample.osm.pbf");
        let open = || BlobReader::from_path(&path).map_err(|e| e.to_string());
        let (w1, c1, r1) = cut(open, &b, true).unwrap();
        let (w2, c2, r2) = cut(open, &b, false).unwrap();
        let ways = |w: &[Way]| w.iter().map(|w| (w.id, w.refs.clone())).collect::<Vec<_>>();
        assert!(!w1.is_empty());
        assert_eq!(ways(&w1), ways(&w2));
        assert_eq!(c1.len(), c2.len());
        for n in w1.iter().flat_map(|w| &w.refs) {
            assert_eq!(c1.get(n), c2.get(n));
        }
        let rels = |r: &[Relation]| r.iter().map(|r| r.id).collect::<Vec<_>>();
        assert_eq!(rels(&r1), rels(&r2));
    }
}
