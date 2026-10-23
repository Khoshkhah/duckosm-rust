#!/bin/sh
# Build the two WebAssembly modules of the page (docs/development.md, "WebAssembly"). Run it in the root of the
# repository.
#   www/pkg/          one thread, stable Rust. The page uses it when it is not cross-origin isolated.
#   www/pkg-threads/  rayon on Web Workers (wasm-bindgen-rayon). It needs nightly Rust with rust-src, because the
#                     standard library is built again with atomics, and a server that sends the COOP and COEP
#                     headers (www/serve.py). The maximum memory is 4 GB, as in the build without threads.
#   www/map/pkg/      roadstyle's Rust module for the roads map (the style and its vector tiles): the crate roadstyle-wasm
#                     of roadstyle's engine (roadstyle repository, rust/) at the commit ROADSTYLE_COMMIT, cloned into
#                     target/roadstyle (or ROADSTYLE_REPO, a local copy). duckosm-core uses the same commit for the levels.
set -e
NIGHTLY=nightly-2026-10-15
ROADSTYLE_COMMIT=900b43e
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
R=target/roadstyle
[ -d $R ] || git clone -q "$ROADSTYLE_REPO" $R
git -C $R fetch -q origin 2>/dev/null || true
git -C $R checkout -q $ROADSTYLE_COMMIT
cargo build --release --target wasm32-unknown-unknown --manifest-path $R/rust/Cargo.toml -p roadstyle-wasm
rm -rf crates/duckosm-wasm/www/map/pkg
wasm-bindgen --target web --out-dir crates/duckosm-wasm/www/map/pkg \
  $R/rust/target/wasm32-unknown-unknown/release/roadstyle_wasm.wasm
