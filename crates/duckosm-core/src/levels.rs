//! The drawing order of the roads, `visualization.edge_levels` and `edge_levels_meta` (docs/levels.md): roadstyle's
//! `compute_levels`, with `method="tags"` (a rule on the tags, the default) or `method="solve"` (its optimization,
//! with the defaults of duckOSM's `duckosm levels` and no edits). The rules and the solver are in roadstyle's own Rust
//! engine (`roadstyle_rs::levels`, roadstyle repository `rust/`); this module gives it duckosm's edges.

use crate::filter::Mode;
use crate::model::Edge;
pub use roadstyle_rs::levels::{Levels, Method, Row, ROADSTYLE_VERSION};

/// The edges of all modes, `edges` and `private_edges` (duckOSM's `load_roads`). An edge in several tables has the
/// attributes of the first one in the sequence driving, walking, cycling, then their private edges.
#[derive(Default)]
pub struct LevelEdges(roadstyle_rs::levels::LevelEdges);

impl LevelEdges {
    pub fn add(&mut self, mode: Mode, private: bool, edges: &[Edge]) {
        let rank = match mode {
            Mode::Driving => 0,
            Mode::Walking => 1,
            Mode::Cycling => 2,
        } + if private { 3 } else { 0 };
        for e in edges {
            let a = &e.attrs;
            self.0.add(
                rank,
                roadstyle_rs::levels::LevelEdge {
                    edge_id: e.edge_id,
                    highway: a.highway.clone(),
                    tunnel: a.tunnel.clone(),
                    bridge: a.bridge.clone(),
                    layer: a.layer.clone(),
                    junction: a.junction.clone(),
                    geometry: e.geometry.clone(),
                },
            );
        }
    }
}

/// roadstyle's levels of the edges; None for `Method::None`.
pub fn compute(edges: &LevelEdges, method: Method) -> Result<Option<Levels>, String> {
    roadstyle_rs::levels::compute(&edges.0, method)
}
