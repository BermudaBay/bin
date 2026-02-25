#!/bin/sh

set -e

scripts_dir_path="$(cd "$(dirname "$0")" && pwd)"
project_root_path="$scripts_dir_path/.."

mkdir -p ./bin

# Bundle main worker.
bun build \
  "$project_root_path/node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg_wasm_main/factory/node/main.worker.js" \
  --outdir "$project_root_path" \
  --outfile main.worker.js \
  --target=bun

# Bundle thread worker.
bun build \
  "$project_root_path/node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg_wasm_thread/factory/node/thread.worker.js" \
  --outdir $project_root_path \
  --outfile thread.worker.js \
  --target=bun

# Compile binary for macOS (arm64).
bun build --compile \
  --target bun-darwin-arm64 \
  --minify \
  --sourcemap \
  "$project_root_path/main.js" \
  "$project_root_path/main.worker.js" \
  "$project_root_path/thread.worker.js" \
  --outfile "$project_root_path/bin/bermuda-darwin-arm64"

# Compile binary for macOS (x64).
bun build --compile \
  --target bun-darwin-x64 \
  --minify \
  --sourcemap \
  "$project_root_path/main.js" \
  "$project_root_path/main.worker.js" \
  "$project_root_path/thread.worker.js" \
  --outfile "$project_root_path/bin/bermuda-darwin-x64"

# Compile binary for Linux (arm64).
bun build --compile \
  --target bun-linux-arm64 \
  --minify \
  --sourcemap \
  "$project_root_path/main.js" \
  "$project_root_path/main.worker.js" \
  "$project_root_path/thread.worker.js" \
  --outfile "$project_root_path/bin/bermuda-linux-arm64"

# Compile binary for Linux (x64).
bun build --compile \
  --target bun-linux-x64 \
  --minify \
  --sourcemap \
  "$project_root_path/main.js" \
  "$project_root_path/main.worker.js" \
  "$project_root_path/thread.worker.js" \
  --outfile "$project_root_path/bin/bermuda-linux-x64"
