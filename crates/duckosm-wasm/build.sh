#!/bin/sh
# Build the two WebAssembly modules of the page (docs/development.md, "WebAssembly"). Run it in the root of the
# repository.
#   www/pkg/          one thread, stable Rust. The page uses it when it is not cross-origin isolated.
#   www/pkg-threads/  rayon on Web Workers (wasm-bindgen-rayon). It needs nightly Rust with rust-src, because the
#                     standard library is built again with atomics, and a server that sends the COOP and COEP
#                     headers (www/serve.py). The maximum memory is 4 GB, as in the build without threads.
#   www/map/pkg/      roadstyle's Rust module for the roads map (the style and its vector tiles): the crate roadstyle-wasm
#                     of roadstyle's engine (roadstyle repository, rust/) at the commit ROADSTYLE_COMMIT, cloned into
#                     target/roadstyle-<commit> (or ROADSTYLE_REPO, a local copy). duckosm-build takes the levels from an older commit
#                     (aba5884, crates/duckosm-build/Cargo.toml): at this commit they are the crate roadstyle-levels.
set -e
NIGHTLY=nightly-2026-10-15
ROADSTYLE_COMMIT=083224cbec825975db711c8d224d85de734b487c   # the full SHA: a fetch by SHA needs it
ROADSTYLE_REPO=${ROADSTYLE_REPO:-https://github.com/Khoshkhah/roadstyle.git}
cargo build --release --target wasm32-unknown-unknown -p duckosm-wasm
wasm-bindgen --target web --out-dir crates/duckosm-wasm/www/pkg target/wasm32-unknown-unknown/release/duckosm_wasm.wasm
# the linker flags of wasm-bindgen's threads example: this nightly does not add them for +atomics
RUSTFLAGS='-C target-feature=+atomics,+bulk-memory,+mutable-globals -C link-arg=--shared-memory
  -C link-arg=--max-memory=4294967296 -C link-arg=--import-memory -C link-arg=--export=__wasm_init_tls
  -C link-arg=--export=__tls_size -C link-arg=--export=__tls_align -C link-arg=--export=__tls_base' \
  cargo +$NIGHTLY build --release --target wasm32-unknown-unknown -p duckosm-wasm --features threads \
  --target-dir target/threads -Z build-std=panic_abort,std
wasm-bindgen --target web --out-dir crates/duckosm-wasm/www/pkg-threads \
  target/threads/wasm32-unknown-unknown/release/duckosm_wasm.wasm
# one folder for each commit, because the worktrees can share target/ (docs/development.md, "One shared build
# folder"). Keep a complete checkout of the commit; else fetch only this commit into a new folder: a folder from the
# CI cache (rust-cache keeps target/ but removes files in it) can have a .git with no files, and then the checkout
# gives no rust/Cargo.toml
R=target/roadstyle-$ROADSTYLE_COMMIT
if [ "$(git -C $R rev-parse -q --verify HEAD 2>/dev/null)" != $ROADSTYLE_COMMIT ] || ! git -C $R diff --quiet HEAD; then
  rm -rf $R
  git init -q $R
  git -C $R fetch -q --depth 1 "$ROADSTYLE_REPO" $ROADSTYLE_COMMIT
  git -C $R checkout -q --force FETCH_HEAD
fi
cargo build --release --target wasm32-unknown-unknown --manifest-path $R/rust/Cargo.toml -p roadstyle-wasm
rm -rf crates/duckosm-wasm/www/map/pkg
# roadstyle's files, as they are at ROADSTYLE_COMMIT (no copy in git; e2e.py checks that the served files equal them): the map's
# dashboard (src/roadstyle/static/dashboard/: the buttons, Street View, Google 3D, the popup, the glow; dashboard/editor/: the level
# editor), the popup's look and text and the level editor's panel (src/roadstyle/static/), and the SQL that makes the map module's input
# (rust/roadstyle-wasm/js/, its only copy)
mkdir -p crates/duckosm-wasm/www/map/roadstyle
cp $R/src/roadstyle/static/popup.css $R/src/roadstyle/static/popup.js $R/src/roadstyle/static/level_editor.html \
  crates/duckosm-wasm/www/map/roadstyle/
cp $R/rust/roadstyle-wasm/js/roads_sql.js $R/rust/roadstyle-wasm/js/features_sql.js crates/duckosm-wasm/www/map/roadstyle/
rm -rf crates/duckosm-wasm/www/map/roadstyle/dashboard crates/duckosm-wasm/www/map/roadstyle/windows.js
cp -r $R/src/roadstyle/static/dashboard crates/duckosm-wasm/www/map/roadstyle/
wasm-bindgen --target web --out-dir crates/duckosm-wasm/www/map/pkg \
  $R/rust/target/wasm32-unknown-unknown/release/roadstyle_wasm.wasm
