#!/bin/sh

set -e

scripts_dir_path="$(cd "$(dirname "$0")" && pwd)"
project_root_path="$scripts_dir_path/.."

rm -rf bin
rm -rf main.worker.js
rm -rf thread.worker.js
