#!/bin/sh

set -e

mkdir -p ./bin

# Bundle main worker.
bun build \
  ./node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg_wasm_main/factory/node/main.worker.js \
  --outdir ./ \
  --outfile main.worker.js \
  --target=bun

# Bundle thread worker.
bun build \
  ./node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg_wasm_thread/factory/node/thread.worker.js \
  --outdir ./ \
  --outfile thread.worker.js \
  --target=bun

# Compile binary for macOS (arm64).
bun build --compile \
  --target bun-darwin-arm64 \
  --minify \
  --sourcemap \
  ./main.js \
  ./main.worker.js \
  ./thread.worker.js \
  --outfile ./bin/bermuda-darwin-arm64

# Compile binary for macOS (x64).
bun build --compile \
  --target bun-darwin-x64 \
  --minify \
  --sourcemap \
  ./main.js \
  ./main.worker.js \
  ./thread.worker.js \
  --outfile ./bin/bermuda-darwin-x64

# Compile binary for Linux (arm64).
bun build --compile \
  --target bun-linux-arm64 \
  --minify \
  --sourcemap \
  ./main.js \
  ./main.worker.js \
  ./thread.worker.js \
  --outfile ./bin/bermuda-linux-arm64

# Compile binary for Linux (x64).
bun build --compile \
  --target bun-linux-x64 \
  --minify \
  --sourcemap \
  ./main.js \
  ./main.worker.js \
  ./thread.worker.js \
  --outfile ./bin/bermuda-linux-x64
