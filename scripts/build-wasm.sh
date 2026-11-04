#!/usr/bin/env bash
# Publishes the AOT browser build and copies it, with the worker, into web/public/wasm (gitignored; CI and dev builds make it).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=web/public/wasm
rm -rf "$OUT" && mkdir -p "$OUT"
dotnet publish wasm -c Release -o /tmp/remesher-wasm-pub
cp -r /tmp/remesher-wasm-pub/wwwroot/. "$OUT"/
cp wasm/worker/remesh-worker.mjs "$OUT"/
du -sh "$OUT"
