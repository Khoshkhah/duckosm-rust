# Concepts

| Word | What it means |
|---|---|
| Area | The part of the world that you build, as a shape (GeoJSON). The build cuts the OSM data to the shape and keeps whole ways. |
| Region file | An `.osm.pbf` file for a country or a region, from [Geofabrik](https://download.geofabrik.de). The area must be inside it. |
| Network | The roads for one way of travel: `driving`, `walking` or `cycling`. A road can be in more than one network ([The roads](manual/roads.md)). |
| Edge | One directed piece of road between two junctions. A two-way street gives two edges ([How a way becomes edges](manual/roads.md#how-a-way-becomes-edges)). |
| `edge_id` | A BIGINT hash of the OSM way, the source node and the target node. The same road has the same `edge_id` in every build. |

Other projects (sensor-matching, SonoFlow, fetching-sweden-data) join on `edge_id`. Keep it a BIGINT in every join. A floating-point number loses digits. [The design](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/design.md#5-the-edge_id-problem) gives the reason and the tests.

The page and duckOSM use the same Rust engine, so every row of every table equals the output of duckOSM.
