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
    Ok(())
}
