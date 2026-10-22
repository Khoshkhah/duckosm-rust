//! Read an `.osm.pbf` file: the highway ways first, then the coordinates of the nodes they use.

use crate::filter;
use crate::model::{Tags, Way};
use crate::network::Coords;
use crate::util::FxHashSet;
use osmpbf::{Element, ElementReader};
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

fn ways_of<R: Read + Send>(reader: ElementReader<R>) -> Result<Vec<Way>, String> {
    let mut ways = reader
        .par_map_reduce(
            |el| {
                let mut v = Vec::new();
                if let Element::Way(w) = el {
                    let mut tags = Tags::default();
                    for (k, val) in w.tags() {
                        tags.set(k, val);
                    }
                    if filter::is_kept_by_reader(&tags) {
                        v.push(Way {
                            id: w.id(),
                            refs: w.refs().collect(),
                            tags,
                        });
                    }
                }
                v
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
    let needed: FxHashSet<i64> = ways.iter().flat_map(|w| w.refs.iter().copied()).collect();
    reader
        .par_map_reduce(
            |el| {
                let mut c = Coords::default();
                match el {
                    Element::Node(n) if needed.contains(&n.id()) => {
                        c.insert(n.id(), (n.lon(), n.lat()));
                    }
                    Element::DenseNode(n) if needed.contains(&n.id()) => {
                        c.insert(n.id(), (n.lon(), n.lat()));
                    }
                    _ => {}
                }
                c
            },
            Coords::default,
            |mut a, b| {
                a.extend(b);
                a
            },
        )
        .map_err(|e| e.to_string())
}
