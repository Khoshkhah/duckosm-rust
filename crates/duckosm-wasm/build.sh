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
#   www/duckosm/      duckOSM's fixes editor (web/fixes_editor/, card 7) at the rev of the engine: the rev of the duckOSM git
#                     dependency in crates/duckosm-wasm/Cargo.toml, cloned into target/duckosm-<rev> (or DUCKOSM_REPO, a local copy).
#                     One rev gives the engine and the editor.
set -e
NIGHTLY=nightly-2026-10-15
ROADSTYLE_COMMIT=863707720e48b01b01eb6453f661be49843ecd50   # the full SHA: a fetch by SHA needs it
ROADSTYLE_REPO=${ROADSTYLE_REPO:-https://github.com/Khoshkhah/roadstyle.git}
DUCKOSM_REV=$(sed -n 's/.*duckOSM\.git", rev = "\([0-9a-f]*\)".*/\1/p' crates/duckosm-wasm/Cargo.toml | sort -u)
DUCKOSM_REPO=${DUCKOSM_REPO:-https://github.com/Khoshkhah/duckOSM.git}
if [ "$(echo "$DUCKOSM_REV" | wc -w)" != 1 ] || [ ${#DUCKOSM_REV} != 40 ]; then
  echo "build.sh: crates/duckosm-wasm/Cargo.toml must give one full duckOSM rev, not: $DUCKOSM_REV" >&2
  exit 1
fi
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
# dashboard (rust/roadstyle-assets/files/static/dashboard/: the buttons, Street View, Google 3D, the popup, the glow; dashboard/editor/: the level
# editor), the popup's look and text and the level editor's panel (rust/roadstyle-assets/files/static/), and the SQL that makes the map module's input
# (rust/roadstyle-wasm/js/, its only copy)
mkdir -p crates/duckosm-wasm/www/map/roadstyle
cp $R/rust/roadstyle-assets/files/static/popup.css $R/rust/roadstyle-assets/files/static/popup.js $R/rust/roadstyle-assets/files/static/level_editor.html \
  crates/duckosm-wasm/www/map/roadstyle/
cp $R/rust/roadstyle-wasm/js/roads_sql.js $R/rust/roadstyle-wasm/js/features_sql.js crates/duckosm-wasm/www/map/roadstyle/
# the options of a dashboard host page (the typed dashboard, its first paint, the base maps and the layers on top): the page fetches them
cp $R/rust/roadstyle-assets/files/data/host_options.json crates/duckosm-wasm/www/map/roadstyle/
rm -rf crates/duckosm-wasm/www/map/roadstyle/dashboard crates/duckosm-wasm/www/map/roadstyle/windows.js
cp -r $R/rust/roadstyle-assets/files/static/dashboard crates/duckosm-wasm/www/map/roadstyle/
wasm-bindgen --target web --out-dir crates/duckosm-wasm/www/map/pkg \
  $R/rust/target/wasm32-unknown-unknown/release/roadstyle_wasm.wasm
# duckOSM's fixes editor, as it is at DUCKOSM_REV (no copy in git; e2e.py checks that the served files equal them). The same fetch as for roadstyle.
D=target/duckosm-$DUCKOSM_REV
if [ "$(git -C $D rev-parse -q --verify HEAD 2>/dev/null)" != $DUCKOSM_REV ] || ! git -C $D diff --quiet HEAD; then
  rm -rf $D
  git init -q $D
  git -C $D fetch -q --depth 1 "$DUCKOSM_REPO" $DUCKOSM_REV
  git -C $D checkout -q --force FETCH_HEAD
fi
rm -rf crates/duckosm-wasm/www/duckosm
mkdir -p crates/duckosm-wasm/www/duckosm
cp -r $D/web/fixes_editor crates/duckosm-wasm/www/duckosm/
