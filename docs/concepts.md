# Concepts

**Area.** The part of the world that you build. It is a shape (GeoJSON). The program cuts the OSM data to the shape. The cut keeps whole ways, as osmium `complete_ways` does.

**Region file.** An `.osm.pbf` file for a country or a region. [Geofabrik](https://download.geofabrik.de) publishes them. The area must be inside the region file.

**Network.** The roads that one way of travel can use. The program builds `driving`, `walking` and `cycling`. A road can be in more than one network.

**Edge.** One directed piece of road between two junctions. A two-way street gives two edges.

**`edge_id`.** A number (BIGINT) that the program computes from the OSM way, the source node and the target node. The same road gives the same `edge_id` in every build. The program never numbers edges in order. Other projects (sensor-matching, SonoFlow, fetching-sweden-data) join on it. Keep it a BIGINT in every join: a program that reads it as a floating-point number loses digits. The decision and the tests are in [the design](https://github.com/Khoshkhah/duckosm-studio/blob/main/docs/design.md#5-the-edge_id-problem).

**Equal to duckOSM.** Every row of every table equals the output of duckOSM 0.6.0. Only the direction labels of some connectors differ, which duckOSM does not fix.
