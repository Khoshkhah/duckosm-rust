# Command line and Python

The browser page is the main way to use this project. For a script, a server or Python code, use [duckOSM](https://github.com/Khoshkhah/duckOSM). The duckOSM Studio page and duckOSM use the same Rust engine, and they give the same tables.

The Rust engine comes with the next duckOSM release. The version on PyPI today (0.6.1) is from before the engine moved into duckOSM.

## Build from the command line

1. Install duckOSM:

    ```bash
    pip install duckosm
    ```

2. Get an `.osm.pbf` file. [Geofabrik](https://download.geofabrik.de) has them for each country and region.
3. Build the networks. Repeat `--modes` for more than one network:

    ```bash
    duckosm build --pbf monaco.osm.pbf --output monaco.duckdb --modes driving --modes walking --modes cycling
    ```

The result is one DuckDB file. [The tables](manual/tables.md) explains each table.

## Use it in Python

Open the DuckDB file with the `duckdb` package:

```python
import duckdb

con = duckdb.connect("monaco.duckdb", read_only=True)
con.execute("SELECT highway, count(*) FROM driving.edges GROUP BY highway").fetchall()
```

## More

- [duckOSM: build an area](https://khoshkhah.github.io/duckOSM/guides/build/)
- [duckOSM: the command line](https://khoshkhah.github.io/duckOSM/reference/cli/)
- [Columns of the tables](output-tables.md)
