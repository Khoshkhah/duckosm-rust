//! Read an `.osm.pbf` file: the highway ways first, then the coordinates of the nodes they use.

use crate::filter;
use crate::model::{Tags, Way};
use crate::network::Coords;
use crate::util::FxHashSet;
use osmpbf::{Element, ElementReader};
use std::path::Path;

/// Pass 1: all highway ways and ferry lines, sorted by id.
pub fn read_ways(path: &Path) -> Result<Vec<Way>, String> {
    let reader = ElementReader::from_path(path).map_err(|e| e.to_string())?;
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
    Ok(ways)
}

/// Pass 2: the coordinates of the nodes in `ways`.
pub fn read_coords(path: &Path, ways: &[Way]) -> Result<Coords, String> {
    let needed: FxHashSet<i64> = ways.iter().flat_map(|w| w.refs.iter().copied()).collect();
    let reader = ElementReader::from_path(path).map_err(|e| e.to_string())?;
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
