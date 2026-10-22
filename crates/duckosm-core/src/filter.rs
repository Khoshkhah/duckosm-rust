//! The road filter of duckOSM (`RoadFilter`): which ways are in the network of a mode, and their
//! one-way direction, access and lanes. Modes: driving, walking, cycling.

use crate::model::{Tags, Way};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Driving,
    Walking,
    Cycling,
}

impl Mode {
    pub fn name(self) -> &'static str {
        match self {
            Mode::Driving => "driving",
            Mode::Walking => "walking",
            Mode::Cycling => "cycling",
        }
    }

    pub fn parse(s: &str) -> Option<Mode> {
        match s {
            "driving" => Some(Mode::Driving),
            "walking" => Some(Mode::Walking),
            "cycling" => Some(Mode::Cycling),
            _ => None,
        }
    }
}

pub const NON_ROAD: [&str; 7] = [
    "footway",
    "path",
    "cycleway",
    "steps",
    "pedestrian",
    "bridleway",
    "corridor",
];
const NOT_BUILT: [&str; 5] = ["proposed", "construction", "abandoned", "razed", "disused"];
const ROAD_CLASSES: [&str; 16] = [
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "unclassified",
    "residential",
    "service",
    "living_street",
    "road",
    "busway",
];
const WALK_CLASSES: [&str; 21] = [
    "footway",
    "path",
    "pedestrian",
    "steps",
    "living_street",
    "residential",
    "service",
    "platform",
    "corridor",
    "track",
    "bridleway",
    "road",
    "unclassified",
    "tertiary",
    "tertiary_link",
    "secondary",
    "secondary_link",
    "primary",
    "primary_link",
    "trunk",
    "trunk_link",
];
const CYCLE_CLASSES: [&str; 14] = [
    "cycleway",
    "path",
    "track",
    "bridleway",
    "living_street",
    "residential",
    "service",
    "unclassified",
    "tertiary",
    "tertiary_link",
    "secondary",
    "secondary_link",
    "primary",
    "primary_link",
];
const NON_MOTOR: [&str; 8] = [
    "footway",
    "path",
    "cycleway",
    "steps",
    "pedestrian",
    "bridleway",
    "corridor",
    "platform",
];
const YES: [&str; 3] = ["yes", "designated", "permissive"];

type Tri = Option<bool>; // SQL three-valued logic: None is NULL

fn is(o: &Option<Box<str>>, v: &str) -> bool {
    o.as_deref() == Some(v)
}
fn is_in(o: &Option<Box<str>>, vs: &[&str]) -> bool {
    o.as_deref().map_or(false, |x| vs.contains(&x))
}
/// `x IN (...)`: NULL when x is NULL.
fn tin(o: &Option<Box<str>>, vs: &[&str]) -> Tri {
    o.as_deref().map(|x| vs.contains(&x))
}
fn and(a: Tri, b: Tri) -> Tri {
    match (a, b) {
        (Some(false), _) | (_, Some(false)) => Some(false),
        (Some(true), Some(true)) => Some(true),
        _ => None,
    }
}
fn or(a: Tri, b: Tri) -> Tri {
    match (a, b) {
        (Some(true), _) | (_, Some(true)) => Some(true),
        (Some(false), Some(false)) => Some(false),
        _ => None,
    }
}
/// `COALESCE(x, '') <> v`
fn ne_or_null(o: &Option<Box<str>>, v: &str) -> Tri {
    Some(o.as_deref().unwrap_or("") != v)
}
fn first<'a>(os: &[&'a Option<Box<str>>]) -> Option<&'a str> {
    os.iter().find_map(|o| o.as_deref())
}

/// A pedestrian street that admits cars is a road (`_ped_ok`).
pub fn ped_ok(t: &Tags) -> bool {
    if !is(&t.highway, "pedestrian") {
        return false;
    }
    let mv = first(&[&t.motorcar, &t.motor_vehicle]);
    mv.map_or(false, |x| YES.contains(&x))
        || is_in(&t.access, &["delivery", "destination", "agricultural"])
}

/// Does the way count for the global junctions? Every highway way that exists on the ground.
pub fn is_built_highway(t: &Tags) -> bool {
    t.highway.is_some() && !is_in(&t.highway, &NOT_BUILT)
}

/// A way that the reader keeps: a highway, or a ferry line (it has no highway tag).
pub fn is_kept_by_reader(t: &Tags) -> bool {
    t.highway.is_some() || is(&t.route, "ferry")
}

/// A road for the cut rule of the global junctions: not a path, or a pedestrian street cars may use.
pub fn is_road_raw(t: &Tags) -> bool {
    let hw = t.highway.as_deref().unwrap_or("");
    !NON_ROAD.contains(&hw) || ped_ok(t)
}

/// A way of one network, after the filter.
#[derive(Clone, Debug)]
pub struct ModeWay {
    pub id: i64,
    /// Node ids; reversed for a one-way way against its drawing (`oneway=-1`).
    pub refs: Vec<i64>,
    pub highway: String,
    pub name: Option<String>,
    pub maxspeed: Option<String>,
    pub oneway: bool,
    pub bus_back: bool,
    pub surface: Option<String>,
    pub service: Option<String>,
    pub access: Option<String>,
    pub junction: Option<String>,
    pub layer: Option<String>,
    pub bridge: Option<String>,
    pub tunnel: Option<String>,
    pub lanes_fwd: Option<i32>,
    pub lanes_bwd: Option<i32>,
    pub dismount: Option<bool>,
}

fn s(o: &Option<Box<str>>) -> Option<String> {
    o.as_deref().map(str::to_string)
}

/// The first run of digits in a tag value as a positive INTEGER (`NULLIF(TRY_CAST(regexp_extract(v, '\d+') AS INTEGER), 0)`).
fn first_int(o: &Option<Box<str>>) -> Option<i32> {
    let v = o.as_deref()?;
    let b = v.as_bytes();
    let start = b.iter().position(|c| c.is_ascii_digit())?;
    let end = b[start..]
        .iter()
        .position(|c| !c.is_ascii_digit())
        .map_or(b.len(), |e| start + e);
    v[start..end].parse::<i32>().ok().filter(|&n| n != 0)
}

/// A footway or pedestrian way that does not admit bikes: cyclists push the bike (`dismount`).
fn pushes_bike(t: &Tags) -> bool {
    is_in(&t.highway, &["footway", "pedestrian"]) && !is_in(&t.bicycle, &YES)
}

/// The access value of the way for the mode (`_access_expression`).
fn access_of(t: &Tags, mode: Mode, dismount: bool) -> Option<String> {
    match mode {
        Mode::Driving => {
            let car = first(&[&t.motorcar, &t.motor_vehicle, &t.vehicle, &t.access]);
            if is(&t.highway, "pedestrian") && !ped_ok(t) {
                return Some(match car {
                    Some(c) if c == "delivery" || c == "private" => c.to_string(),
                    _ => "pedestrian".to_string(),
                });
            }
            let bus_ok =
                is_in(&t.bus, &["yes", "designated"]) || is_in(&t.psv, &["yes", "designated"]);
            if is(&t.highway, "busway")
                || car == Some("psv")
                || (matches!(car, Some("no") | Some("private")) && bus_ok)
            {
                return Some("bus".to_string());
            }
            car.map(str::to_string)
        }
        Mode::Walking => first(&[&t.foot, &t.access]).map(str::to_string),
        Mode::Cycling => {
            if dismount && pushes_bike(t) {
                first(&[&t.foot, &t.access]).map(str::to_string)
            } else {
                first(&[&t.bicycle, &t.vehicle, &t.access]).map(str::to_string)
            }
        }
    }
}

/// Travel direction: 1 one-way as drawn, -1 one-way against the drawing, 0 two-way (`_direction_expression`).
fn direction(t: &Tags, mode: Mode, dismount: bool) -> i32 {
    match mode {
        Mode::Walking => {
            if is_in(&t.oneway_foot, &["yes", "1", "true"]) {
                1
            } else if is(&t.oneway_foot, "-1") {
                -1
            } else {
                0
            }
        }
        Mode::Cycling => {
            if dismount && pushes_bike(t) {
                return 0;
            }
            if is(&t.oneway_bicycle, "no") {
                0
            } else if is_in(&t.oneway_bicycle, &["yes", "1", "true"]) {
                1
            } else if is(&t.oneway_bicycle, "-1") {
                -1
            } else if is_in(&t.junction, &["roundabout", "circular"])
                || is_in(&t.oneway, &["yes", "1", "true"])
            {
                1
            } else if is(&t.oneway, "-1") {
                -1
            } else {
                0
            }
        }
        Mode::Driving => {
            if is_in(&t.junction, &["roundabout", "circular"]) {
                1
            } else if is_in(&t.oneway, &["yes", "1", "true"]) {
                1
            } else if is(&t.oneway, "-1") {
                -1
            } else if is_in(&t.oneway, &["no", "false", "0"]) {
                0
            } else if is_in(&t.highway, &["motorway", "motorway_link"]) {
                1
            } else {
                0
            }
        }
    }
}

/// The WHERE clause of `RoadFilter` for the mode (NULL counts as false).
fn in_network(t: &Tags, mode: Mode, dismount: bool) -> bool {
    let hw = t.highway.as_deref();
    let class_ok: Tri = match mode {
        Mode::Driving => or(
            tin(&t.highway, &ROAD_CLASSES),
            Some(hw == Some("pedestrian")),
        ),
        Mode::Walking => {
            let not_motorway = Some(!matches!(hw.unwrap_or(""), "motorway" | "motorway_link"));
            let sidewalk_lr: Tri =
                Some(is(&t.sidewalk_left, "separate") && is(&t.sidewalk_right, "separate"));
            let by_class = and(
                and(
                    and(
                        tin(&t.highway, &WALK_CLASSES),
                        ne_or_null(&t.motorroad, "yes"),
                    ),
                    and(
                        ne_or_null(&t.foot, "use_sidepath"),
                        ne_or_null(&t.sidewalk, "separate"),
                    ),
                ),
                and(
                    ne_or_null(&t.sidewalk_both, "separate"),
                    sidewalk_lr.map(|b| !b),
                ),
            );
            and(
                not_motorway,
                or(
                    or(
                        tin(&t.foot, &YES),
                        tin(&t.sidewalk, &["yes", "both", "left", "right"]),
                    ),
                    by_class,
                ),
            )
        }
        Mode::Cycling => {
            let cycleway_infra: Tri = t
                .cycleway
                .as_deref()
                .map(|c| !["no", "none", "separate"].contains(&c));
            let base = or(
                or(tin(&t.highway, &CYCLE_CLASSES), tin(&t.bicycle, &YES)),
                cycleway_infra,
            );
            if dismount {
                or(base, tin(&t.highway, &["footway", "pedestrian"]))
            } else {
                base
            }
        }
    };
    class_ok == Some(true)
}

/// Apply the filter of a mode to one way. None if the way is not in that network.
pub fn mode_way(w: &Way, mode: Mode, cycling_dismount: bool) -> Option<ModeWay> {
    let t = &w.tags;
    let dismount = mode == Mode::Cycling && cycling_dismount;
    let forbidden: &[&str] = match mode {
        Mode::Driving => &["no", "agricultural", "forestry", "emergency"],
        _ => &["no"],
    };
    if !(t.highway.is_some() || is(&t.route, "ferry")) || !in_network(t, mode, dismount) {
        return None;
    }
    let access = access_of(t, mode, dismount);
    if forbidden.contains(&access.as_deref().unwrap_or("")) {
        return None;
    }
    // a ferry line has no highway tag: it gets its own class
    let raw_hw = t.highway.as_deref().unwrap_or("ferry");
    let highway = if mode == Mode::Driving && ped_ok(t) {
        "living_street".to_string()
    } else {
        raw_hw.to_string()
    };
    let dir = direction(t, mode, dismount);
    let car_dir = direction(t, Mode::Driving, false); // the lanes are the cars' in every mode
    let contra = is(&t.oneway_bus, "no") || is(&t.oneway_psv, "no");
    let n_total = first_int(&t.lanes);
    let n_fwd = first_int(&t.lanes_forward);
    let n_bwd = first_int(&t.lanes_backward);
    let n_rev = first_int(&t.lanes_reversible).unwrap_or(0);
    let default = if highway == "motorway" || highway == "trunk" {
        2
    } else {
        1
    };
    let non_motor = NON_MOTOR.contains(&highway.split(';').next().unwrap_or(""));

    let car_fwd = if non_motor {
        None
    } else {
        let base = if car_dir == -1 {
            // GREATEST ignores a NULL, so an untagged one-way road has 1 lane here, not the class default
            n_bwd.unwrap_or_else(|| {
                n_total.map_or(1, |n| {
                    (n - if contra { n_fwd.unwrap_or(1) } else { 0 }).max(1)
                })
            })
        } else if let Some(n) = n_fwd {
            n
        } else if car_dir != 0 {
            n_total.map_or(1, |n| {
                (n - if contra { n_bwd.unwrap_or(1) } else { 0 }).max(1)
            })
        } else if let (Some(n), Some(b)) = (n_total, n_bwd) {
            (n - b).max(1)
        } else if let Some(n) = n_total {
            ((n + 1) / 2).max(1)
        } else {
            default
        };
        Some(base + n_rev)
    };
    let car_bwd = if non_motor || (car_dir != 0 && !contra) {
        None
    } else {
        let base = if let Some(b) = n_bwd {
            b
        } else if let (Some(n), Some(f)) = (n_total, n_fwd) {
            (n - f).max(1)
        } else if let Some(n) = n_total {
            (n / 2).max(1)
        } else {
            default
        };
        Some(base + n_rev)
    };
    // this mode's forward edge runs along `dir`; the cars' forward lanes run along `car_dir`
    let swap = (dir == -1) != (car_dir == -1);
    let (lanes_fwd, lanes_bwd) = if swap {
        (car_bwd, car_fwd)
    } else {
        (car_fwd, car_bwd)
    };

    let refs = if dir == -1 {
        w.refs.iter().rev().copied().collect()
    } else {
        w.refs.clone()
    };
    Some(ModeWay {
        id: w.id,
        refs,
        highway,
        name: s(&t.name),
        maxspeed: s(&t.maxspeed),
        oneway: dir != 0,
        bus_back: mode == Mode::Driving && dir != 0 && contra,
        surface: s(&t.surface),
        service: s(&t.service),
        access,
        junction: s(&t.junction),
        layer: s(&t.layer),
        bridge: s(&t.bridge),
        tunnel: s(&t.tunnel),
        lanes_fwd,
        lanes_bwd,
        dismount: if dismount { Some(pushes_bike(t)) } else { None },
    })
}

/// The driving filter (kept for the first spike).
pub fn driving_way(w: &Way) -> Option<ModeWay> {
    mode_way(w, Mode::Driving, false)
}
