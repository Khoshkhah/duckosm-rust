# Command line and Python

For a script, a server or Python code, use [duckOSM](https://github.com/Khoshkhah/duckOSM). It uses the same Rust engine as the page and gives the same tables.

duckOSM 0.7.0 and newer have this engine in the `duckosm` wheel, for Linux, macOS and Windows.

## Build from the command line

1. Install duckOSM:

    ```bash
    pip install duckosm
    ```

2. Get an `.osm.pbf` file from [Geofabrik](https://download.geofabrik.de).
3. Build the networks. Repeat `--modes` for each network:

    ```bash
    duckosm build --pbf monaco.osm.pbf --output monaco.duckdb --modes driving --modes walking --modes cycling
    ```

The result is one DuckDB file ([The tables](manual/tables.md)).

## Read the tables in Python

```python
import duckdb

con = duckdb.connect("monaco.duckdb", read_only=True)
con.execute("SELECT highway, count(*) FROM driving.edges GROUP BY highway").fetchall()
```

## More

- [duckOSM: build an area](https://khoshkhah.github.io/duckOSM/guides/build/)
- [duckOSM: the command line](https://khoshkhah.github.io/duckOSM/reference/cli/)
- [Columns of the tables](output-tables.md)
