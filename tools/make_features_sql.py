"""Write crates/duckosm-build/sql/features.sql: duckOSM's SQL of the base-map layers (features.*), recorded from
duckOSM's own FeaturesBuilder, so the browser and duckOSM run the same SQL (docs/features.md). Run it again when
duckOSM's layers change.

    /home/kaveh/projects/duckOSM/.venv/bin/python tools/make_features_sql.py [path/to/duckOSM]

The file first loads raw_nodes.parquet, raw_ways.parquet and raw_relations.parquet (duckosm-rust --raw, or the page)
into raw.*, with the column types of duckOSM. The sea (features.ocean) is not in it.
"""
import pathlib
import subprocess
import sys

import duckdb

DUCKOSM = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/home/kaveh/projects/duckOSM")
sys.path.insert(0, str(DUCKOSM / "src"))
from duckosm import __version__  # noqa: E402
from duckosm.features import FeaturesBuilder  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parent.parent / "crates/duckosm-build/sql/features.sql"
LOAD = """CREATE SCHEMA IF NOT EXISTS raw;
CREATE OR REPLACE TABLE raw.nodes AS SELECT osm_id, lat, lon, tags FROM read_parquet('raw_nodes.parquet');
CREATE OR REPLACE TABLE raw.ways AS SELECT osm_id, tags, refs FROM read_parquet('raw_ways.parquet');
CREATE OR REPLACE TABLE raw.relations AS
    SELECT osm_id, tags, refs, ref_roles, ref_types::ENUM('node', 'way', 'relation')[] AS ref_types
    FROM read_parquet('raw_relations.parquet');"""


class Recorder:
    """A connection that keeps each statement (not the counts of the log)."""

    def __init__(self, con):
        self.con, self.sql = con, []

    def execute(self, sql, *args):
        if not sql.lstrip().startswith("SELECT count"):
            self.sql.append(sql.strip().rstrip(";") + ";")
        return self.con.execute(sql, *args)


con = duckdb.connect()
con.execute("""LOAD spatial; CREATE SCHEMA raw;
    CREATE TABLE raw.nodes (osm_id BIGINT, lat DOUBLE, lon DOUBLE, tags MAP(VARCHAR, VARCHAR));
    CREATE TABLE raw.ways (osm_id BIGINT, tags MAP(VARCHAR, VARCHAR), refs BIGINT[]);
    CREATE TABLE raw.relations (osm_id BIGINT, tags MAP(VARCHAR, VARCHAR), refs BIGINT[], ref_roles VARCHAR[],
                                ref_types ENUM('node', 'way', 'relation')[])""")
rec = Recorder(con)
stats = FeaturesBuilder(rec).run()
if any(v < 0 for v in stats.values()):
    sys.exit(f"a layer failed: {stats}")
commit = subprocess.run(["git", "-C", str(DUCKOSM), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
head = (f"-- duckOSM {__version__} ({commit}): the base-map layers (features.*) from raw.*, recorded from FeaturesBuilder by\n"
        "-- tools/make_features_sql.py. Do not change it by hand. It needs DuckDB's spatial extension.")
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("\n\n".join([head, LOAD, *rec.sql]) + "\n")
print(f"{OUT}: {len(rec.sql)} statements, layers {', '.join(stats)}")
