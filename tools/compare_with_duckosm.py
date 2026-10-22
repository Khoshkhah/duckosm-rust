"""Compare the edges and nodes of duckosm-rust with a duckOSM database, row by row.

    python tools/compare_with_duckosm.py monaco.duckdb OUT_DIR_OR_DUCKDB [mode]

The second argument is the output of duckosm-rust: a folder with edges_<mode>.parquet and
nodes_<mode>.parquet, or a .duckdb file. Rows are matched on edge_id (nodes on node_id).
Needs the duckdb Python package with the spatial extension.
"""
import sys
import duckdb

REF, OUT = sys.argv[1], sys.argv[2]
MODE = sys.argv[3] if len(sys.argv) > 3 else "driving"
con = duckdb.connect()
con.execute("LOAD spatial")
con.execute(f"ATTACH '{REF}' AS py (READ_ONLY)")
if OUT.endswith(".duckdb"):
    con.execute(f"ATTACH '{OUT}' AS rs (READ_ONLY)")
    con.execute(f"CREATE VIEW r_edges AS SELECT *, ST_AsWKB(geometry) AS wkb FROM rs.{MODE}.edges")
    con.execute(f"CREATE VIEW r_priv AS SELECT *, ST_AsWKB(geometry) AS wkb FROM rs.{MODE}.private_edges")
    con.execute(f"CREATE VIEW r_nodes AS SELECT node_id, ST_AsWKB(geom) AS wkb FROM rs.{MODE}.nodes")
else:
    con.execute(f"CREATE VIEW r_edges AS SELECT *, ST_AsWKB(geometry) AS wkb FROM read_parquet('{OUT}/edges_{MODE}.parquet')")
    con.execute(f"CREATE VIEW r_priv AS SELECT *, ST_AsWKB(geometry) AS wkb FROM read_parquet('{OUT}/private_edges_{MODE}.parquet')")
    con.execute(f"CREATE VIEW r_nodes AS SELECT node_id, ST_AsWKB(geometry) AS wkb FROM read_parquet('{OUT}/nodes_{MODE}.parquet')")

COLS = ["edge_ref", "source", "target", "osm_id", "highway", "name", "oneway", "lanes", "surface", "access",
        "junction", "layer", "bridge", "tunnel", "service", "is_reverse"] + (["dismount"] if MODE == "cycling" else [])
con.execute(f"CREATE VIEW p_edges AS SELECT *, ST_AsWKB(geometry) AS wkb FROM py.{MODE}.edges")
con.execute(f"CREATE VIEW p_priv AS SELECT *, ST_AsWKB(geometry) AS wkb FROM py.{MODE}.private_edges")
con.execute(f"CREATE VIEW p_nodes AS SELECT node_id, ST_AsWKB(geom) AS wkb FROM py.{MODE}.nodes")

q = lambda s: con.execute(s).fetchall()


def compare(label, p, r, key, cols, extra=()):
    n_p, n_r = q(f"SELECT count(*) FROM {p}")[0][0], q(f"SELECT count(*) FROM {r}")[0][0]
    only_p = q(f"SELECT count(*) FROM {p} WHERE {key} NOT IN (SELECT {key} FROM {r})")[0][0]
    only_r = q(f"SELECT count(*) FROM {r} WHERE {key} NOT IN (SELECT {key} FROM {p})")[0][0]
    print(f"\n== {label}: python {n_p}, rust {n_r}, only in python {only_p}, only in rust {only_r}")
    both = q(f"SELECT count(*) FROM {p} a JOIN {r} b USING ({key})")[0][0]
    print(f"   matched on {key}: {both}")
    allc = list(cols) + ["wkb"]
    cond = " OR ".join(f"a.{c} IS DISTINCT FROM b.{c}" for c in allc)
    equal = q(f"SELECT count(*) FROM {p} a JOIN {r} b USING ({key}) WHERE NOT ({cond})")[0][0]
    print(f"   rows equal in every compared column (geometry as exact WKB): {equal}")
    for c in allc:
        n = q(f"SELECT count(*) FROM {p} a JOIN {r} b USING ({key}) WHERE a.{c} IS DISTINCT FROM b.{c}")[0][0]
        if n:
            print(f"   column {c}: {n} rows differ")
    return only_p, only_r


compare("edges", "p_edges", "r_edges", "edge_id", COLS)
# refs and length_m are compared on their own: lists, and a float with a tolerance
n = q("SELECT count(*) FROM p_edges a JOIN r_edges b USING (edge_id) WHERE a.refs IS DISTINCT FROM b.refs")[0][0]
print(f"   column refs: {n} rows differ")
d = q("""SELECT count(*) FILTER (WHERE a.length_m IS DISTINCT FROM b.length_m),
                count(*) FILTER (WHERE abs(a.length_m - b.length_m) > 1e-4 * a.length_m),
                max(abs(a.length_m - b.length_m)) FROM p_edges a JOIN r_edges b USING (edge_id)""")[0]
print(f"   length_m: {d[0]} rows differ at all, {d[1]} by more than 1e-4 relative, largest difference {d[2]}")
compare("private_edges", "p_priv", "r_priv", "edge_id", COLS)
compare("nodes", "p_nodes", "r_nodes", "node_id", [])
