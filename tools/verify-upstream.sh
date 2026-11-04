#!/usr/bin/env bash
# Fails if anything under upstream/ differs from what upstream.lock recorded (a hand edit).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
want="$(grep '^tree_sha256=' "$ROOT/upstream.lock" | cut -d= -f2)"
got="$("$ROOT/tools/tree-hash.sh" "$ROOT/upstream")"
if [ "$want" != "$got" ]; then
  echo "upstream/ was modified: expected $want, got $got" >&2; exit 1
fi
echo "upstream/ matches upstream.lock ($(grep '^sha=' "$ROOT/upstream.lock" | cut -d= -f2))"
