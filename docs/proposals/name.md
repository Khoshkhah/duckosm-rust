# Proposal: the name of the project

Status: proposal for Kaveh, 2026-11-04. Nothing is renamed.

## What changed

Kaveh decided on 2026-11-04 that the Rust engine moves into the duckOSM repository, as the Rust engine moved into roadstyle. After the move, this repository is not "the Rust port of duckOSM" any more. It is the app: a web page that uses duckOSM (the road network) and roadstyle (the map) to build, draw, fix and export maps.

So this proposal names the **app**. The engine crates and the wheel get their names from duckOSM, and the app needs no crate and no PyPI package: it is a page. For the app, only three names matter: the repository, the page address, and the title that users see.

## What the project is called today

| Place | Name today |
|---|---|
| GitHub repository | `Khoshkhah/duckosm-rust` (public, since 2026-10-24) |
| Page address | `https://khoshkhah.github.io/duckosm-rust/` |
| Page title (`<title>`) | `duckOSM in the browser` |
| CLI program (crate `duckosm-cli`) | `duckosm-rust` |
| Python wheel and module (crate `duckosm-py`) | `duckosm-rust` and `duckosm_rust` (releases only, not on PyPI) |
| Library crates | `duckosm-core`, `duckosm-parquet`, `duckosm-duckdb`, `duckosm-build`, `duckosm-wasm` (none on crates.io) |
| Relay (Cloudflare Worker) | `duckosm-relay` |
| Text | `duckosm-rust` in 42 files (150 times), `duckosm-core` in 25 files, `duckosm_rust` in 9 files |

The name `duckosm-rust` was chosen on 2026-10-21 ([design.md](../design.md), section 13) because the repository is a workspace and `rs` means roadstyle in your projects. The page title says "duckOSM", which is the engine, not the app.

Two facts that bear on a new name:

- **The word "duck".** Your duckOSM PyPI release waits for the DuckDB trademark reply ([design.md](../design.md), open question 2). A name with "duck" in it has the same risk.
- **PyPI `duckosm` is yours.** It is duckOSM 0.6.1. The name `duckosm-rust` is free on PyPI and crates.io, but it will not be needed after the move.

## The choices

Checked on 2026-11-04 with the crates.io and PyPI APIs, GitHub, and a DNS lookup (a name with no DNS record can still be taken, so check it at a registrar before you buy).

| Name | Why | crates.io | PyPI | GitHub | Domain |
|---|---|---|---|---|---|
| **roadwright** | A wright is a maker (wheelwright, playwright). It fits the family of roadstyle, and it says "builds roads and road maps". | Free | Free | No user or organization. One small repository with this name (6 stars, not yours). | `.com` taken. `.app`, `.dev` and `.io` have no DNS record. |
| **roadloom** | A loom weaves a network from threads. Short, and clear when you say it. | Free | Free | Free. No repository. | `.com` taken. `.app`, `.dev` and `.io` have no DNS record. |
| **roadsmith** | A smith makes things by hand. It is close in meaning to roadwright. | Free | Free | Free. One repository with this name (0 stars). | `.com` taken. `.app`, `.dev` and `.io` have no DNS record. |
| **duckosm-studio** | Keeps the link to duckOSM: the studio is the interface of duckOSM. Clear in one look. | Free | Free | Free | None of `.com`, `.app`, `.dev`, `.io` has a DNS record. |
| **duckosm-rust** (keep) | No work. | Free | Free | Yours | Not needed |

I did not use `roadstudio` (the `.dev` domain is taken), `mapwright` (PyPI and GitHub have it), `roadkit` (15 repositories and a generic word), `kerbline` and `carriageway` (free, but hard to say or spell).

## The cost of a rename

| Place | Cost | Notes |
|---|---|---|
| GitHub repository | Low. | GitHub redirects the old repository address, including `git` remotes and `gh release download`. Rename it with `gh repo rename`. Issues and pull requests stay. |
| Page address | Medium. | A project page lives at `/<repository>/`. The old path gives 404 and has no redirect. A custom domain ends this problem for good. **Saved areas** (browser storage) stay at the old address. See [hosting.md](hosting.md). |
| Page title and text | Low. | `index.html`, the dashboard texts, the README and the manual. A search and replace. |
| The relay, the Google Maps key | Low. | Both name the page address (`ALLOWED_ORIGINS`, the key referrers). They change with the address, not with the name. |
| Crates, wheel, CLI | None for the app. | They move to duckOSM with the engine and take duckOSM's names. This is the larger rename, and it belongs to the move, not to this decision. |
| Downstream projects | Medium, and a part of the engine move. | `duckOSM` imports `duckosm_rust` (`src/duckosm/rust_engine.py`). `simready` uses `duckosm-core` and `duckosm-build` by relative path (`../duckosm-rust/crates/...`), so a renamed or moved folder breaks its build. `roadstyle` keeps a copy of old paths for duckosm-rust in `rust/roadstyle-assets`. |
| Local folder `~/projects/duckosm-rust` | Medium. | Many worktrees and the build folder (`.shared-target`) use this path. Rename the GitHub repository first, and keep the local folder name until the engine move is done. |

## Recommendation

1. **Name the app `roadwright`.** It makes the app a product of its own, next to duckOSM (the engine) and roadstyle (the map style). It has no "duck", so the DuckDB trademark question does not touch it. It is free on both registries, and a page needs no registry name anyway.
2. If you want the app to carry duckOSM's name, take `duckosm-studio`. It is the safe choice, but it keeps the "duck" risk and ties the app to one engine.
3. **Do not rename anything yet.** The engine move changes the crates, the wheel and the CLI. Rename the repository and the page after it, in one step, with the new page address from [hosting.md](hosting.md). Then the address changes one time.
4. Buy the domain (`roadwright.app` or `.dev`) before you announce the name. A DNS lookup is not proof that it is free.

## Open questions for Kaveh

1. Product name (`roadwright`) or engine name (`duckosm-studio`) for the app?
2. Do you want a custom domain for the page?
3. Does the page keep a "duckOSM" line in its title, for example "Roadwright, a map builder on duckOSM and roadstyle"?
