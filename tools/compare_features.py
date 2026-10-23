"""Compare the base-map layers of duckosm-rust with a duckOSM database (docs/features.md): load the raw.* files of
`duckosm-rust --raw` (or of the page), run crates/duckosm-build/sql/features.sql, and compare raw.* and each
features.* table with the duckOSM database, row by row.

    python tools/compare_features.py monaco.duckdb OUT_DIR

Rows are compared on osm_id, osm_type, kind, name, tags and the WKB of geom; traffic.bearing to 1e-9 degrees.
features.ocean (from Overture, not from OSM) is not compared. Needs the duckdb Python package with spatial.
"""
import os
import pathlib
import sys

import duckdb

REF, OUT = sys.argv[1], pathlib.Path(sys.argv[2]).resolve()
SQL = pathlib.Path(__file__).resolve().parent.parent / "crates/duckosm-build/sql/features.sql"
con = duckdb.connect()
os.chdir(OUT)                      # features.sql reads raw_*.parquet from the current folder
con.execute(SQL.read_text())
con.execute(f"ATTACH '{REF}' AS py (READ_ONLY)")
bad = 0
for t in ("nodes", "ways", "relations"):
    a = con.sql(f"SELECT count(*) FROM (FROM raw.{t} EXCEPT ALL FROM py.raw.{t})").fetchone()[0]
    b = con.sql(f"SELECT count(*) FROM (FROM py.raw.{t} EXCEPT ALL FROM raw.{t})").fetchone()[0]
    n = con.sql(f"SELECT count(*) FROM raw.{t}").fetchone()[0]
    print(f"raw.{t}: {n} rows, {a} not in duckOSM, {b} of duckOSM missing")
    bad += a + b
layers = [r[0] for r in con.sql("SELECT table_name FROM information_schema.tables WHERE table_schema = 'features' "
                                "AND table_catalog = 'memory' ORDER BY 1").fetchall()]
for t in layers:
    extra = ", round(bearing, 9)" if t == "traffic" else ""
    row = f"osm_id, osm_type, kind, name, tags, ST_AsWKB(geom){extra}"
    a = con.sql(f"SELECT count(*) FROM (SELECT {row} FROM features.{t} EXCEPT ALL SELECT {row} FROM py.features.{t})").fetchone()[0]
    b = con.sql(f"SELECT count(*) FROM (SELECT {row} FROM py.features.{t} EXCEPT ALL SELECT {row} FROM features.{t})").fetchone()[0]
    n = con.sql(f"SELECT count(*) FROM features.{t}").fetchone()[0]
    print(f"features.{t}: {n} rows, {a} not in duckOSM, {b} of duckOSM missing")
    bad += a + b
missing = {r[0] for r in con.sql("SELECT table_name FROM information_schema.tables WHERE table_catalog = 'py' AND table_schema = 'features'").fetchall()} - set(layers) - {"ocean"}
if missing:
    print("duckOSM tables that are not built:", sorted(missing))
sys.exit(1 if bad or missing else 0)
