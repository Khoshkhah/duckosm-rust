//! Write the network as a DuckDB file. The Parquet files that `duckosm-parquet` wrote are loaded
//! with DuckDB itself, so the types are the types of duckOSM (BIGINT, FLOAT, BIGINT[], GEOMETRY).

use duckdb::Connection;
use std::path::Path;

const MACROS: &str = "
CREATE OR REPLACE MACRO main.edge_id_hash(osm_id, source, target) AS
    (hash(osm_id::BIGINT, source::BIGINT, target::BIGINT) >> 1)::BIGINT;
CREATE OR REPLACE MACRO main.edge_id_hash_v1(osm_id, source, target, is_reverse) AS
    (hash(osm_id::BIGINT, source::BIGINT, target::BIGINT, is_reverse::BOOLEAN) >> 1)::BIGINT;
";

pub fn write_database(db: &Path, parquet_dir: &Path, modes: &[&str]) -> Result<(), String> {
    let _ = std::fs::remove_file(db);
    let con = Connection::open(db).map_err(|e| e.to_string())?;
    for mode in modes {
        write_mode(&con, parquet_dir, mode)?;
    }
    con.execute_batch(MACROS).map_err(|e| e.to_string())
}

fn write_mode(con: &Connection, parquet_dir: &Path, mode: &str) -> Result<(), String> {
    let p = |f: &str| {
        parquet_dir
            .join(format!("{f}_{mode}.parquet"))
            .display()
            .to_string()
            .replace('\'', "''")
    };
    let sql = format!(
        "CREATE SCHEMA {mode};
         CREATE TABLE {mode}.edges AS SELECT * FROM read_parquet('{e}');
         CREATE TABLE {mode}.private_edges AS SELECT * FROM read_parquet('{pe}');
         CREATE TABLE {mode}.nodes AS SELECT node_id, geometry AS geom FROM read_parquet('{n}');
         {map}",
        e = p("edges"),
        pe = p("private_edges"),
        n = p("nodes"),
        map = if parquet_dir
            .join(format!("edge_id_map_{mode}.parquet"))
            .exists()
        {
            format!(
                "CREATE TABLE {mode}.edge_id_map AS SELECT * FROM read_parquet('{}');",
                p("edge_id_map")
            )
        } else {
            String::new()
        },
    );
    con.execute_batch(&sql).map_err(|e| e.to_string())?;
    // the edge graph and the turn restrictions, when the options made them
    for table in [
        "edge_graph",
        "turn_permission",
        "turn_restrictions",
        "turn_path_restrictions",
    ] {
        if parquet_dir.join(format!("{table}_{mode}.parquet")).exists() {
            con.execute_batch(&format!(
                "CREATE TABLE {mode}.{table} AS SELECT * FROM read_parquet('{}');",
                p(table)
            ))
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use duckdb::Connection;
    use duckosm_core::hash;

    /// The edge_id of duckosm-core must equal the hash() of the DuckDB inside this program.
    /// If a new DuckDB changes hash(), this test fails.
    #[test]
    fn hash_equals_the_bundled_duckdb() {
        let con = Connection::open_in_memory().unwrap();
        let version: String = con.query_row("SELECT version()", [], |r| r.get(0)).unwrap();
        for (a, b, c) in [
            (1i64, 2i64, 3i64),
            (123456789, 987654321, -555),
            (-1, 0, i64::MAX),
            (4230114, 1868723946, 1080509801),
        ] {
            let want: u64 = con
                .query_row(
                    "SELECT hash(?::BIGINT, ?::BIGINT, ?::BIGINT)",
                    [a, b, c],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(
                hash::hash3(a, b, c),
                want,
                "DuckDB {version}: hash({a}, {b}, {c})"
            );
        }
        for s in [
            "[1, 2, 3]",
            "",
            "[10, 2]",
            "a longer text with more than sixteen bytes",
        ] {
            let want: u64 = con
                .query_row("SELECT hash(?::VARCHAR)", [s], |r| r.get(0))
                .unwrap();
            assert_eq!(hash::hash_str(s), want, "DuckDB {version}: hash('{s}')");
        }
        eprintln!("DuckDB {version}: the hash agrees");
    }
}
