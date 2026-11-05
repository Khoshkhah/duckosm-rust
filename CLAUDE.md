# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

duckOSM Studio (GitHub `Khoshkhah/duckosm-studio`; the local folder keeps its old name, `duckosm-rust`) is a browser page. It builds the routable road network of an area from OpenStreetMap data in the browser, lets a person fix the OSM data, edit the drawing levels and the map design, and export the result. The page is live at https://khoshkhah.github.io/duckosm-studio/, and its manual is at `/manual/`.

This repository has no engine of its own. Three repositories work together:

| Part | Owner | How the page takes it |
|---|---|---|
| The Rust engine (`duckosm-core`, `duckosm-build`) | duckOSM, `rust/` | a Git dependency at one `rev` in `crates/duckosm-wasm/Cargo.toml` |
| Card 7, Edit OSM data (the fixes editor) | duckOSM, `web/fixes_editor/` | `build.sh` copies it at the same `rev` to `www/duckosm/fixes_editor/` |
| The map, the dashboard and card 9, Edit design | roadstyle | `build.sh` builds `roadstyle-wasm` and copies the dashboard at `ROADSTYLE_COMMIT` |

To change the engine or an editor, change it in its owner's repository, merge it there, and then move the pin here (`docs/development.md`, "Where the engine lives" and "Where the editors come from"). The command line and the Python package are duckOSM's (`duckosm build`).

**The contract:** every row of every table equals the duckOSM output. `edge_id` is a BIGINT content hash, and other projects (sensor-matching, SonoFlow, fetching-sweden-data) join on it.

## Layout

```text
crates/duckosm-wasm/          the only crate: wasm-bindgen module of the engine, and build.sh
crates/duckosm-wasm/www/      the page: index.html, app/*.js (duck.js = DuckDB in the browser, export.js, profile.js, ...),
                              map/ (the map worker), and the e2e tests (*_e2e.py, Playwright)
docs/                         the manual (mkdocs) and the developer documents
tests/data/                   Monaco inputs: monaco.osm.pbf, monaco.geojson, monaco_sample.osm.pbf, osm_fixes.yaml
```

`www/pkg*/`, `www/map/pkg/`, `www/map/roadstyle/` and `www/duckosm/` are build output, and git ignores them.

## Commands

The machine is short of memory: set `CARGO_BUILD_JOBS=4` and run one heavy build at a time.

```bash
CARGO_BUILD_JOBS=4 ./crates/duckosm-wasm/build.sh     # www/pkg (stable), www/pkg-threads (nightly), roadstyle and the fixes editor at their pins
cargo test --release -p duckosm-wasm                  # the browser build equals duckosm_build::build; run it alone
python3 crates/duckosm-wasm/www/serve.py 8000         # sends the COOP and COEP headers that threads need
python crates/duckosm-wasm/www/e2e.py tests/data/monaco.osm.pbf out-page --boundary tests/data/monaco.geojson
```

Run `cargo test -p duckosm-wasm` alone, not in one command with other crates: Cargo joins the features, and then the files have zstd instead of snap. Each e2e test says its arguments in its first lines. The page tests that matter most for a page change: `panel_e2e.py`, `design_e2e.py`, `fixes_e2e.py`, `export_e2e.py`, `restyle_e2e.py`, and the phone tests `phone_design_e2e.py` and `phone_fixes_e2e.py`. `e2e.py` also checks that the served roadstyle and fixes-editor files equal their pins.

The manual: `mkdocs build --strict` (mkdocs 1.6 and mkdocs-material 9). The developer documents and `docs/proposals/` are in `exclude_docs` and are not on the site. A public page links to them on GitHub.

CI (`.github/workflows/ci.yml`) runs on pushes to `main` and on pull requests. `pages.yml` deploys the page and the manual from `main`. `www/version_refs.py` adds `?v=<sha>` to every relative reference, because Pages caches files for 10 minutes. Test it on a copy, never on `www/` itself.

## Rules from Kaveh

- Test on Monaco, and on Tartu when needed. Do not run Estonia, Kentucky or any larger area unless Kaveh asks.
- A failing golden test after a change means that the change altered a result. Never edit a golden file to make a test pass.
- Ask before `git push`. A change of only the README or `docs/` goes to main at once: push, PR and merge when its CI is green.
- `target` is a link to `.shared-target` (shared by the worktrees in `.claude/worktrees/`). Do not set `CARGO_TARGET_DIR` to a worktree folder. When you build a second source tree, touch `crates/*/src/*.rs`, because Cargo can report "fresh" for the other tree.
- Page work needs a phone-viewport check before a merge. The page uses roadstyle's dashboard template and toolbox unchanged: a missing dashboard part is a roadstyle change, not a page patch.
- Write all text (docs, comments, commit messages, PR text) in ASD-STE100 Simplified Technical English.
