//! The driving road filter (`RoadFilter` in duckOSM): which ways are roads for cars, and their
//! one-way direction, access and lanes.

use crate::model::{Tags, Way};

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
const FORBIDDEN: [&str; 4] = ["no", "agricultural", "forestry", "emergency"];
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

fn is(o: &Option<Box<str>>, v: &str) -> bool {
    o.as_deref() == Some(v)
}
fn is_in(o: &Option<Box<str>>, vs: &[&str]) -> bool {
    o.as_deref().map_or(false, |x| vs.contains(&x))
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
    mv.map_or(false, |x| ["yes", "designated", "permissive"].contains(&x))
        || is_in(&t.access, &["delivery", "destination", "agricultural"])
}

/// Does the way count for the global junctions? Every highway way that exists on the ground.
pub fn is_built_highway(t: &Tags) -> bool {
    t.highway.is_some() && !is_in(&t.highway, &NOT_BUILT)
}

/// A road for the cut rule of the global junctions: not a path, or a pedestrian street cars may use.
pub fn is_road_raw(t: &Tags) -> bool {
    let hw = t.highway.as_deref().unwrap_or("");
    !NON_ROAD.contains(&hw) || ped_ok(t)
}

/// A way of the driving network, after the filter.
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

/// The access value of the way for cars (`_access_expression`, driving).
fn access_of(t: &Tags) -> Option<String> {
    let car = first(&[&t.motorcar, &t.motor_vehicle, &t.vehicle, &t.access]);
    if is(&t.highway, "pedestrian") && !ped_ok(t) {
        return Some(match car {
            Some(c) if c == "delivery" || c == "private" => c.to_string(),
            _ => "pedestrian".to_string(),
        });
    }
    let bus_ok = is_in(&t.bus, &["yes", "designated"]) || is_in(&t.psv, &["yes", "designated"]);
    if is(&t.highway, "busway")
        || car == Some("psv")
        || (matches!(car, Some("no") | Some("private")) && bus_ok)
    {
        return Some("bus".to_string());
    }
    car.map(str::to_string)
}

/// Travel direction: 1 one-way as drawn, -1 one-way against the drawing, 0 two-way.
fn direction(t: &Tags) -> i32 {
    if is_in(&t.junction, &["roundabout", "circular"]) {
        return 1;
    }
    if is_in(&t.oneway, &["yes", "1", "true"]) {
        return 1;
    }
    if is(&t.oneway, "-1") {
        return -1;
    }
    if is_in(&t.oneway, &["no", "false", "0"]) {
        return 0;
    }
    if is_in(&t.highway, &["motorway", "motorway_link"]) {
        return 1;
    }
    0
}

/// Apply the driving filter to one way. None if the way is not in the driving network.
pub fn driving_way(w: &Way) -> Option<ModeWay> {
    let t = &w.tags;
    let raw_hw = t.highway.as_deref()?;
    if !(ROAD_CLASSES.contains(&raw_hw) || raw_hw == "pedestrian") {
        return None;
    }
    let access = access_of(t);
    if FORBIDDEN.contains(&access.as_deref().unwrap_or("")) {
        return None;
    }
    let highway = if ped_ok(t) {
        "living_street".to_string()
    } else {
        raw_hw.to_string()
    };
    let dir = direction(t);
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
        let base = if dir == -1 {
            // GREATEST ignores a NULL, so an untagged one-way road has 1 lane here, not the class default
            n_bwd.unwrap_or_else(|| {
                n_total.map_or(1, |n| {
                    (n - if contra { n_fwd.unwrap_or(1) } else { 0 }).max(1)
                })
            })
        } else if let Some(n) = n_fwd {
            n
        } else if dir != 0 {
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
    let car_bwd = if non_motor || (dir != 0 && !contra) {
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
        bus_back: dir != 0 && contra,
        surface: s(&t.surface),
        service: s(&t.service),
        access,
        junction: s(&t.junction),
        layer: s(&t.layer),
        bridge: s(&t.bridge),
        tunnel: s(&t.tunnel),
        lanes_fwd: car_fwd,
        lanes_bwd: car_bwd,
    })
}
