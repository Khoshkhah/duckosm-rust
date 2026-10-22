# Development

## Toolchain status (2026-10-21)

Checked on the WSL machine of Kaveh.

| Tool | Status |
|---|---|
| `cargo`, `rustc`, `rustup` | Not installed. They are not on `PATH`. `~/.cargo` and `~/.rustup` do not exist. |
| `maturin` | Not installed. |
| `gcc`, `cc` | Installed (`/usr/bin`). |
| Python | 3.10.12. duckOSM has its own `.venv` with DuckDB 1.5.3. |

Nothing was installed. Install Rust only with the approval of Kaveh.

## Install Rust

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
source "$HOME/.cargo/env"
rustup component add clippy rustfmt
rustup target add wasm32-unknown-unknown
```

Install `maturin` in a virtual environment, for the Python wheel (from M3):

```bash
python3 -m venv .venv
.venv/bin/pip install maturin
```

## Check the edge_id reference

This needs no Rust. It compares the Python reference with the DuckDB that is installed.

```bash
pip install duckdb
python tools/edge_id_reference.py                       # random checks
python tools/edge_id_reference.py path/to/area.duckdb   # every edge of a duckOSM database
```

The first line must say `different results in 0 random checks`. Each mode line must say `0 different`.
