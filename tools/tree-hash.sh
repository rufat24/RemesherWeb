#!/usr/bin/env bash
# Deterministic SHA-256 over every file (path + content) under a directory.
set -euo pipefail
cd "$1"
find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
