"""Write the summary golden file of the three-mode test from duckOSM databases.

    python tools/make_golden_summary.py tests/data/monaco_modes_summary.tsv NAME=DB [NAME=DB ...]

NAME is the variant: merge_gj, nomerge_gj, merge_nogj or nomerge_nogj (merge_segments and
global_junctions on or off). Build each database with tests/data/golden_monaco_modes.yaml (see the
comments there) and `bench/python_steps.py <yaml> --no-lane-profile`. For each mode the file has the
number of edges, private edges, nodes and edge_id_map rows, and one checksum for the edges and one for
the private edges. The checksum is the XOR over the rows of the edge_id hash of
(edge_id, source * 1000003 ^ target, (lanes + 1) << 32 | length_m bits | dismount << 48).
"""
import struct
import sys

import duckdb

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from edge_id_reference import duck_hash

M = (1 << 64) - 1


def checksum(rows):
    x = 0
    for edge_id, source, target, lanes, length_m, dismount in rows:
        b = ((source * 1000003) ^ target) & M
        c = ((((lanes if lanes is not None else -1) + 1) & 0xFFFF) << 32) | struct.unpack(">I", struct.pack(">f", length_m))[0]
        c |= (1 << 48) if dismount else 0
        x ^= duck_hash(edge_id & M, b, c)
    return x


out = open(sys.argv[1], "w")
out.write("variant\tmode\tedges\tprivate_edges\tnodes\tedge_id_map\tedges_checksum\tprivate_checksum\n")
for arg in sys.argv[2:]:
    name, db = arg.split("=", 1)
    con = duckdb.connect(db, read_only=True)
    for mode in ("driving", "walking", "cycling"):
        cols = {r[0] for r in con.execute(f"DESCRIBE {mode}.edges").fetchall()}
        dis = "dismount" if "dismount" in cols else "FALSE"
        q = lambda t: con.execute(f"SELECT edge_id, source, target, lanes, length_m, {dis} FROM {mode}.{t}").fetchall()
        n_map = con.execute(f"SELECT count(*) FROM {mode}.edge_id_map").fetchone()[0] if name.startswith("merge") else 0
        e, p = q("edges"), q("private_edges")
        n = con.execute(f"SELECT count(*) FROM {mode}.nodes").fetchone()[0]
        out.write(f"{name}\t{mode}\t{len(e)}\t{len(p)}\t{n}\t{n_map}\t{checksum(e):x}\t{checksum(p):x}\n")
