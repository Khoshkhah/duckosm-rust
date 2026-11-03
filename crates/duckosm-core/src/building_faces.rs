//! The walls of the buildings (`main.building_faces`, docs/osm-editing.md, M4): each segment of the outer ring of a building footprint is a face, and
//! each face has a type. This is not in duckOSM: it is made on request (`Params.building_faces`), from the raw cut and the street edges of the build.
//!
//! - `front`: the wall that faces a street, and any other wall that faces a street at a short distance (a corner building has two). A street counts only when
//!   it can be seen from the wall: the line from the wall to the street crosses no wall of a building (the building itself or another one).
//! - `back`: a wall that points away from the front wall and faces no street.
//! - `party`: a wall that two buildings share (the same two nodes in both rings).
//! - `side`: every other wall. A building with no street near it has no front and no back: all its walls are `side` (or `party`).
//!
//! A face has the key `(building id, node, node)`: it does not change when the ring has more nodes elsewhere. The rows do not change from run to run: the order
//! of the output is the order of the ways and of the ring, and a tie in the street match goes to the lower `edge_id`.

use crate::geom::Pt;
use crate::raw::{RawNode, RawWay};
use crate::util::FxHashMap;
use rstar::{RTree, RTreeObject, AABB};

/// A street farther than this from the middle of a wall is not the street of the wall (meters).
pub const MAX_STREET_M: f64 = 60.0;
/// A wall can be the front wall when the cosine of the angle between its outward normal and the way to the street is at least this (60 degrees).
pub const FRONT_ALIGN: f64 = 0.5;
/// Another wall is a front wall too (a corner) when it faces a street this much (about 50 degrees) and the street is not farther than `CORNER_DIST_M`.
pub const CORNER_ALIGN: f64 = 0.65;
pub const CORNER_DIST_M: f64 = 30.0;
/// A wall is a back wall when its normal and the front wall's normal have at most this cosine (about 114 degrees apart) and it faces no street (cosine at most `BACK_ALIGN`).
pub const BACK_DOT: f64 = -0.4;
pub const BACK_ALIGN: f64 = 0.1;
/// A wall that is shorter than this is not a face (meters). Its place in the ring is kept in `face_index`.
pub const MIN_FACE_M: f64 = 0.1;
/// Meters in one degree of latitude, and of longitude at the equator (a sphere of radius 6,378,137 m).
const M_PER_DEG: f64 = 111_319.490_793;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FaceType {
    Front,
    Back,
    Side,
    Party,
}

impl FaceType {
    pub fn name(self) -> &'static str {
        match self {
            FaceType::Front => "front",
            FaceType::Back => "back",
            FaceType::Side => "side",
            FaceType::Party => "party",
        }
    }

    pub fn parse(s: &str) -> Option<FaceType> {
        [
            FaceType::Front,
            FaceType::Back,
            FaceType::Side,
            FaceType::Party,
        ]
        .into_iter()
        .find(|t| t.name() == s)
    }
}

/// A segment of a street edge, in (lon, lat).
#[derive(Clone, Debug)]
pub struct Street {
    pub a: Pt,
    pub b: Pt,
    pub edge_id: i64,
    pub osm_id: i64,
    pub name: Option<String>,
}

/// A rule of `extra.building_faces`: the type of one wall, in place of the computed type. The two nodes can be in either order.
#[derive(Clone, Debug)]
pub struct FaceEdit {
    pub building: i64,
    pub from_node: i64,
    pub to_node: i64,
    pub face_type: FaceType,
}

/// One face (wall) of a building, in the order of the ring (counter-clockwise).
#[derive(Clone, Debug)]
pub struct BuildingFace {
    pub building_id: i64,
    /// The place of the wall in the ring (from 0). A wall that is too short has a number but no row.
    pub face_index: i32,
    pub from_node: i64,
    pub to_node: i64,
    /// The type after the rules of `extra.building_faces`, and the type that the method computed.
    pub face_type: FaceType,
    pub computed_type: FaceType,
    pub edited: bool,
    pub length_m: f32,
    /// The compass direction of the outward normal (0 north, 90 east).
    pub azimuth_deg: f32,
    /// The street that the wall faces (None when no street is near it and aligned).
    pub street_osm_id: Option<i64>,
    pub street_edge_id: Option<i64>,
    pub street_name: Option<String>,
    pub distance_m: Option<f32>,
    /// The two ends, in (lon, lat).
    pub geometry: Vec<Pt>,
}

type P = (f64, f64);

struct Proj {
    lon0: f64,
    lat0: f64,
    kx: f64,
}

impl Proj {
    fn new(origin: Pt) -> Proj {
        Proj {
            lon0: origin.0,
            lat0: origin.1,
            kx: M_PER_DEG * origin.1.to_radians().cos(),
        }
    }
    fn pt(&self, p: Pt) -> P {
        ((p.0 - self.lon0) * self.kx, (p.1 - self.lat0) * M_PER_DEG)
    }
}

struct Seg {
    a: P,
    b: P,
    edge_id: i64,
    osm_id: i64,
    name: Option<String>,
}

impl RTreeObject for Seg {
    type Envelope = AABB<P>;
    fn envelope(&self) -> Self::Envelope {
        AABB::from_corners(
            (self.a.0.min(self.b.0), self.a.1.min(self.b.1)),
            (self.a.0.max(self.b.0), self.a.1.max(self.b.1)),
        )
    }
}

/// A wall of any building, for the test of the line of sight.
struct WallSeg {
    a: P,
    b: P,
}

impl RTreeObject for WallSeg {
    type Envelope = AABB<P>;
    fn envelope(&self) -> Self::Envelope {
        AABB::from_corners(
            (self.a.0.min(self.b.0), self.a.1.min(self.b.1)),
            (self.a.0.max(self.b.0), self.a.1.max(self.b.1)),
        )
    }
}

/// Do the segments pq and ab cross? (Touching at an end is not a crossing.)
fn crosses(p: P, q: P, a: P, b: P) -> bool {
    let turn = |u: P, v: P, w: P| (v.0 - u.0) * (w.1 - u.1) - (v.1 - u.1) * (w.0 - u.0);
    turn(a, b, p) * turn(a, b, q) < 0.0 && turn(p, q, a) * turn(p, q, b) < 0.0
}

/// The street that a wall faces: the best score of the segments within `MAX_STREET_M` that the wall points at and that it can see.
struct Match {
    q: P,
    edge_id: i64,
    osm_id: i64,
    name: Option<String>,
    dist: f64,
    align: f64,
    score: f64,
}

fn closest_on(a: P, b: P, p: P) -> (P, f64) {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let l2 = dx * dx + dy * dy;
    let t = if l2 <= 1e-12 {
        0.0
    } else {
        (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / l2).clamp(0.0, 1.0)
    };
    let q = (a.0 + dx * t, a.1 + dy * t);
    (q, ((p.0 - q.0).powi(2) + (p.1 - q.1).powi(2)).sqrt())
}

struct Wall {
    index: usize,
    from: i64,
    to: i64,
    p1: Pt,
    p2: Pt,
    normal: P,
    azimuth: f64,
    length: f64,
    street: Option<Match>,
    party: bool,
}

/// The faces of every building way in `ways`, with the street segments `streets` and the rules `edits`. `ways` and `nodes` are sorted by id, as
/// `Raw` has them. A way is a building when it has `building` with a value other than `no`, and a closed ring of three nodes or more whose nodes
/// are all in `nodes`.
pub fn building_faces(
    ways: &[RawWay],
    nodes: &[RawNode],
    streets: &[Street],
    edits: &[FaceEdit],
) -> Vec<BuildingFace> {
    // 1. the rings, with their coordinates
    let mut rings: Vec<(i64, Vec<i64>, Vec<Pt>)> = Vec::new();
    for w in ways {
        if !w.tags.iter().any(|t| t.0 == "building" && t.1 != "no")
            || w.refs.len() < 4
            || w.refs.first() != w.refs.last()
        {
            continue;
        }
        let pts: Option<Vec<Pt>> = w
            .refs
            .iter()
            .map(|id| {
                nodes
                    .binary_search_by_key(id, |n| n.id)
                    .ok()
                    .map(|i| (nodes[i].lon, nodes[i].lat))
            })
            .collect();
        if let Some(pts) = pts {
            rings.push((w.id, w.refs.clone(), pts));
        }
    }
    if rings.is_empty() {
        return Vec::new();
    }
    // 2. one local scale for the whole area: the middle of the buildings
    let (mut lo, mut hi) = ((f64::MAX, f64::MAX), (f64::MIN, f64::MIN));
    for p in rings.iter().flat_map(|r| r.2.iter()) {
        lo = (lo.0.min(p.0), lo.1.min(p.1));
        hi = (hi.0.max(p.0), hi.1.max(p.1));
    }
    let proj = Proj::new(((lo.0 + hi.0) / 2.0, (lo.1 + hi.1) / 2.0));
    // 3. the streets, each segment once (an edge has one copy for each direction)
    let mut seen: FxHashMap<(i64, [u64; 4]), ()> = FxHashMap::default();
    let mut segs = Vec::new();
    for s in streets {
        let (a, b) = if s.a <= s.b { (s.a, s.b) } else { (s.b, s.a) };
        if seen
            .insert(
                (
                    s.osm_id,
                    [a.0.to_bits(), a.1.to_bits(), b.0.to_bits(), b.1.to_bits()],
                ),
                (),
            )
            .is_some()
        {
            continue;
        }
        segs.push(Seg {
            a: proj.pt(s.a),
            b: proj.pt(s.b),
            edge_id: s.edge_id,
            osm_id: s.osm_id,
            name: s.name.clone(),
        });
    }
    let tree = RTree::bulk_load(segs);
    // 4. a wall that two buildings have (the same two nodes) is a party wall
    let mut shared: FxHashMap<(i64, i64), u32> = FxHashMap::default();
    for (_, ids, _) in &rings {
        for pair in ids.windows(2) {
            *shared
                .entry((pair[0].min(pair[1]), pair[0].max(pair[1])))
                .or_default() += 1;
        }
    }
    let rules: FxHashMap<(i64, i64, i64), FaceType> = edits
        .iter()
        .map(|e| {
            (
                (
                    e.building,
                    e.from_node.min(e.to_node),
                    e.from_node.max(e.to_node),
                ),
                e.face_type,
            )
        })
        .collect();

    // 5. each ring counter-clockwise, so that the outward normal of a wall is (dy, -dx); and the tree of all walls, for the line of sight
    let mut oriented = Vec::new();
    let mut wall_segs = Vec::new();
    for (id, mut ids, mut pts) in rings {
        let mut local: Vec<P> = pts.iter().map(|&p| proj.pt(p)).collect();
        let n = local.len() - 1;
        let area: f64 = (0..n)
            .map(|i| local[i].0 * local[i + 1].1 - local[i + 1].0 * local[i].1)
            .sum();
        if area == 0.0 {
            continue; // no area: a line
        }
        if area < 0.0 {
            local.reverse();
            ids.reverse();
            pts.reverse();
        }
        wall_segs.extend(
            local
                .windows(2)
                .filter(|w| w[0] != w[1])
                .map(|w| WallSeg { a: w[0], b: w[1] }),
        );
        oriented.push((id, ids, pts, local));
    }
    let wall_tree = RTree::bulk_load(wall_segs);
    // from a point on the wall to a point on the street: is there a wall in the way?
    let visible = |from: P, to: P| {
        let env = AABB::from_corners(
            (from.0.min(to.0), from.1.min(to.1)),
            (from.0.max(to.0), from.1.max(to.1)),
        );
        !wall_tree
            .locate_in_envelope_intersecting(&env)
            .any(|w| crosses(from, to, w.a, w.b))
    };

    let mut out = Vec::new();
    for (id, ids, pts, local) in oriented {
        let n = local.len() - 1;
        let mut walls: Vec<Wall> = Vec::new();
        for i in 0..n {
            let (v1, v2) = (local[i], local[i + 1]);
            let (dx, dy) = (v2.0 - v1.0, v2.1 - v1.1);
            let length = (dx * dx + dy * dy).sqrt();
            if length < MIN_FACE_M {
                continue;
            }
            let normal = (dy / length, -dx / length);
            let mid = ((v1.0 + v2.0) / 2.0, (v1.1 + v2.1) / 2.0);
            let env = AABB::from_corners(
                (mid.0 - MAX_STREET_M, mid.1 - MAX_STREET_M),
                (mid.0 + MAX_STREET_M, mid.1 + MAX_STREET_M),
            );
            let mut candidates: Vec<Match> = Vec::new();
            for s in tree.locate_in_envelope(&env) {
                let (q, dist) = closest_on(s.a, s.b, mid);
                if dist > MAX_STREET_M || dist < 1e-4 {
                    continue;
                }
                let align = normal.0 * (q.0 - mid.0) / dist + normal.1 * (q.1 - mid.1) / dist;
                if align <= 0.0 {
                    continue;
                }
                let score = align / (dist + 1.0).sqrt() * (1.0 + (length + 1.0).ln());
                candidates.push(Match {
                    q,
                    edge_id: s.edge_id,
                    osm_id: s.osm_id,
                    name: s.name.clone(),
                    dist,
                    align,
                    score,
                });
            }
            // the best score that the wall can see; a tie goes to the lower edge id, so that the result does not depend on the order of the tree
            candidates.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.edge_id.cmp(&b.edge_id)));
            let out_of_wall = (mid.0 + normal.0 * 0.05, mid.1 + normal.1 * 0.05);
            let best = candidates.into_iter().find(|m| visible(out_of_wall, m.q));
            let (a, b) = (ids[i], ids[i + 1]);
            walls.push(Wall {
                index: i,
                from: a,
                to: b,
                p1: pts[i],
                p2: pts[i + 1],
                normal,
                azimuth: (90.0 - normal.1.atan2(normal.0).to_degrees()).rem_euclid(360.0),
                length,
                street: best,
                party: shared.get(&(a.min(b), a.max(b))).is_some_and(|&c| c >= 2),
            });
        }
        // the front wall: the best score among the walls that face a street and are not party walls (the first one in the ring on a tie)
        let mut front: Option<usize> = None;
        for (k, w) in walls.iter().enumerate() {
            let Some(s) = w
                .street
                .as_ref()
                .filter(|s| !w.party && s.align >= FRONT_ALIGN)
            else {
                continue;
            };
            if front.map_or(true, |f| {
                s.score > walls[f].street.as_ref().map_or(0.0, |x| x.score)
            }) {
                front = Some(k);
            }
        }
        let front_normal = front.map(|f| walls[f].normal);
        for (k, w) in walls.iter().enumerate() {
            let align = w.street.as_ref().map_or(0.0, |s| s.align);
            let dist = w.street.as_ref().map_or(f64::INFINITY, |s| s.dist);
            let computed = if w.party {
                FaceType::Party
            } else if front == Some(k)
                || (front.is_some() && align >= CORNER_ALIGN && dist <= CORNER_DIST_M)
            {
                FaceType::Front
            } else if front_normal.is_some_and(|f| w.normal.0 * f.0 + w.normal.1 * f.1 <= BACK_DOT)
                && align <= BACK_ALIGN
            {
                FaceType::Back
            } else {
                FaceType::Side
            };
            let ruled = rules
                .get(&(id, w.from.min(w.to), w.from.max(w.to)))
                .copied();
            // a street is named for a wall that faces it; the other walls have none
            let street = w
                .street
                .as_ref()
                .filter(|_| computed != FaceType::Back && computed != FaceType::Party);
            out.push(BuildingFace {
                building_id: id,
                face_index: w.index as i32,
                from_node: w.from,
                to_node: w.to,
                face_type: ruled.unwrap_or(computed),
                computed_type: computed,
                edited: ruled.is_some_and(|r| r != computed),
                length_m: w.length as f32,
                azimuth_deg: w.azimuth as f32,
                street_osm_id: street.map(|s| s.osm_id),
                street_edge_id: street.map(|s| s.edge_id),
                street_name: street.and_then(|s| s.name.clone()),
                distance_m: street.map(|s| s.dist as f32),
                geometry: vec![w.p1, w.p2],
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const M: f64 = 1.0 / M_PER_DEG; // one meter in degrees (at the equator, where the tests are)

    fn node(id: i64, x: f64, y: f64) -> RawNode {
        RawNode {
            id,
            lon: x * M,
            lat: y * M,
            tags: vec![],
        }
    }
    fn building(id: i64, refs: &[i64]) -> RawWay {
        RawWay {
            id,
            tags: vec![("building".into(), "yes".into())],
            refs: refs.to_vec(),
        }
    }
    fn street(osm_id: i64, a: (f64, f64), b: (f64, f64)) -> Street {
        Street {
            a: (a.0 * M, a.1 * M),
            b: (b.0 * M, b.1 * M),
            edge_id: osm_id * 10,
            osm_id,
            name: Some(format!("street {osm_id}")),
        }
    }
    /// A building of 20 x 10 m: nodes 1 (0,0), 2 (20,0), 3 (20,10), 4 (0,10): the walls south, east, north, west (counter-clockwise).
    fn block() -> Vec<RawNode> {
        vec![
            node(1, 0.0, 0.0),
            node(2, 20.0, 0.0),
            node(3, 20.0, 10.0),
            node(4, 0.0, 10.0),
        ]
    }
    fn types(f: &[BuildingFace]) -> Vec<&'static str> {
        f.iter().map(|x| x.face_type.name()).collect()
    }

    #[test]
    fn a_street_in_the_south() {
        let ways = [building(100, &[1, 2, 3, 4, 1])];
        let f = building_faces(
            &ways,
            &block(),
            &[street(7, (-30.0, -8.0), (50.0, -8.0))],
            &[],
        );
        assert_eq!(
            types(&f),
            ["front", "side", "back", "side"],
            "south front, east side, north back, west side"
        );
        assert_eq!((f[0].from_node, f[0].to_node), (1, 2));
        assert!(
            (f[0].length_m - 20.0).abs() < 1e-3 && (f[0].azimuth_deg - 180.0).abs() < 1e-3,
            "{:?}",
            f[0]
        );
        assert!((f[0].distance_m.unwrap() - 8.0).abs() < 1e-3);
        assert_eq!(
            (f[0].street_osm_id, f[0].street_name.as_deref()),
            (Some(7), Some("street 7"))
        );
        assert_eq!(f[2].street_osm_id, None, "the back wall has no street");
        assert!(f
            .iter()
            .all(|x| !x.edited && x.face_type == x.computed_type));
    }

    #[test]
    fn the_same_for_a_clockwise_ring_and_a_street_in_the_north() {
        let ways = [building(100, &[1, 4, 3, 2, 1])]; // clockwise
        let f = building_faces(
            &ways,
            &block(),
            &[street(7, (-30.0, 18.0), (50.0, 18.0))],
            &[],
        );
        let north: Vec<_> = f
            .iter()
            .filter(|x| x.face_type == FaceType::Front)
            .collect();
        assert_eq!(north.len(), 1);
        assert_eq!(
            (
                north[0].from_node.min(north[0].to_node),
                north[0].from_node.max(north[0].to_node)
            ),
            (3, 4),
            "the north wall"
        );
        assert!(
            f.iter().any(|x| x.face_type == FaceType::Back),
            "a back wall in the south"
        );
    }

    #[test]
    fn no_street_no_front() {
        let ways = [building(100, &[1, 2, 3, 4, 1])];
        let f = building_faces(
            &ways,
            &block(),
            &[street(7, (-30.0, 500.0), (50.0, 500.0))],
            &[],
        );
        assert_eq!(types(&f), ["side", "side", "side", "side"]);
        assert!(f
            .iter()
            .all(|x| x.street_osm_id.is_none() && x.distance_m.is_none()));
        assert!(building_faces(&ways, &block(), &[], &[])
            .iter()
            .all(|x| x.face_type == FaceType::Side));
    }

    #[test]
    fn a_corner_building_has_two_fronts() {
        let ways = [building(100, &[1, 2, 3, 4, 1])];
        let streets = [
            street(7, (-30.0, -6.0), (50.0, -6.0)),
            street(8, (26.0, -30.0), (26.0, 40.0)),
        ];
        let f = building_faces(&ways, &block(), &streets, &[]);
        assert_eq!(
            types(&f),
            ["front", "front", "back", "side"],
            "south and east fronts, north back, west side"
        );
        assert_eq!((f[0].street_osm_id, f[1].street_osm_id), (Some(7), Some(8)));
    }

    #[test]
    fn a_shared_wall_is_a_party_wall() {
        let mut nodes = block();
        nodes.extend([node(5, 40.0, 0.0), node(6, 40.0, 10.0)]);
        let ways = [
            building(100, &[1, 2, 3, 4, 1]),
            building(101, &[2, 5, 6, 3, 2]),
        ];
        let f = building_faces(
            &ways,
            &nodes,
            &[street(7, (-30.0, -8.0), (60.0, -8.0))],
            &[],
        );
        let east: Vec<_> = f
            .iter()
            .filter(|x| {
                x.building_id == 100
                    && x.from_node.max(x.to_node) == 3
                    && x.from_node.min(x.to_node) == 2
            })
            .collect();
        let west: Vec<_> = f
            .iter()
            .filter(|x| {
                x.building_id == 101
                    && x.from_node.max(x.to_node) == 3
                    && x.from_node.min(x.to_node) == 2
            })
            .collect();
        assert_eq!(
            (east[0].face_type, west[0].face_type),
            (FaceType::Party, FaceType::Party)
        );
        assert_eq!(
            f.iter().filter(|x| x.face_type == FaceType::Party).count(),
            2
        );
        assert_eq!(
            f.iter().filter(|x| x.face_type == FaceType::Front).count(),
            2,
            "each building has its south front"
        );
    }

    #[test]
    fn a_rule_changes_the_type_and_keeps_the_computed_one() {
        let ways = [building(100, &[1, 2, 3, 4, 1])];
        let streets = [street(7, (-30.0, -8.0), (50.0, -8.0))];
        let edit = |a, b, t| FaceEdit {
            building: 100,
            from_node: a,
            to_node: b,
            face_type: t,
        };
        // the nodes of a rule can be in either order; a rule that gives the computed type is not an edit; a rule for another building does nothing
        let rules = [
            edit(3, 2, FaceType::Front),
            edit(1, 2, FaceType::Front),
            FaceEdit {
                building: 5,
                from_node: 3,
                to_node: 4,
                face_type: FaceType::Back,
            },
        ];
        let f = building_faces(&ways, &block(), &streets, &rules);
        assert_eq!(types(&f), ["front", "front", "back", "side"]);
        assert_eq!((f[1].computed_type, f[1].edited), (FaceType::Side, true));
        assert_eq!((f[0].computed_type, f[0].edited), (FaceType::Front, false));
        assert_eq!(f.iter().filter(|x| x.edited).count(), 1);
    }

    #[test]
    fn rings_that_are_not_buildings_and_the_same_rows_each_time() {
        let mut ways = vec![
            building(100, &[1, 2, 3, 4, 1]),
            RawWay {
                id: 101,
                tags: vec![("building".into(), "no".into())],
                refs: vec![1, 2, 3, 4, 1],
            },
            RawWay {
                id: 102,
                tags: vec![("landuse".into(), "grass".into())],
                refs: vec![1, 2, 3, 4, 1],
            },
            building(103, &[1, 2, 3, 4]),    // not closed
            building(104, &[1, 2, 9, 4, 1]), // node 9 is not in the file
            building(105, &[1, 2, 1]),       // too short
        ];
        ways.sort_by_key(|w| w.id);
        let streets = [
            street(7, (-30.0, -8.0), (50.0, -8.0)),
            street(7, (50.0, -8.0), (-30.0, -8.0)),
        ]; // two directions of one segment
        let a = building_faces(&ways, &block(), &streets, &[]);
        assert!(a.iter().all(|x| x.building_id == 100) && a.len() == 4);
        let b = building_faces(&ways, &block(), &streets, &[]);
        let key = |f: &[BuildingFace]| {
            f.iter()
                .map(|x| {
                    (
                        x.building_id,
                        x.face_index,
                        x.face_type.name(),
                        x.street_edge_id,
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(key(&a), key(&b));
    }

    #[test]
    fn a_building_behind_another_does_not_see_the_street() {
        // B (nodes 5 to 8) is 2 m north of A (nodes 1 to 4) and has the same width: the street in the south is blocked for B by A
        let mut nodes = block();
        nodes.extend([
            node(5, 0.0, 12.0),
            node(6, 20.0, 12.0),
            node(7, 20.0, 22.0),
            node(8, 0.0, 22.0),
        ]);
        let ways = [
            building(100, &[1, 2, 3, 4, 1]),
            building(101, &[5, 6, 7, 8, 5]),
        ];
        let f = building_faces(
            &ways,
            &nodes,
            &[street(7, (-30.0, -8.0), (50.0, -8.0))],
            &[],
        );
        let of = |id: i64| {
            f.iter()
                .filter(|x| x.building_id == id)
                .map(|x| x.face_type.name())
                .collect::<Vec<_>>()
        };
        assert_eq!(of(100), ["front", "side", "back", "side"]);
        assert_eq!(
            of(101),
            ["side", "side", "side", "side"],
            "B has no front: the street is behind A"
        );
    }

    #[test]
    fn a_tie_goes_to_the_lower_edge_id() {
        // two streets at the same distance and alignment: the wall names the one with the lower edge id, in any order of the input
        let ways = [building(100, &[1, 2, 3, 4, 1])];
        let (s1, mut s2) = (
            street(7, (-30.0, -8.0), (50.0, -8.0)),
            street(3, (-30.0, -8.0), (50.0, -8.0)),
        );
        s2.a.1 += 1e-12; // a different segment, the same distance for the test
        s2.b.1 += 1e-12;
        let one = building_faces(&ways, &block(), &[s1.clone(), s2.clone()], &[]);
        let two = building_faces(&ways, &block(), &[s2, s1], &[]);
        assert_eq!(one[0].street_edge_id, two[0].street_edge_id);
    }
}
