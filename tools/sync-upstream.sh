#!/usr/bin/env bash
# Copy the NativeRemesher sources from the Unity project clone into ./upstream, read-only snapshot.
#   tools/sync-upstream.sh --from-path /path/to/clone
#   tools/sync-upstream.sh --repo https://github.com/OWNER/REPO --ref main
#   tools/sync-upstream.sh --repo URL --sha <commit>      (exact commit; what CI uses)
#   tools/sync-upstream.sh --from-lock                    (repo and sha from upstream.lock: rebuilds the pinned snapshot)
# Writes upstream.lock (repo, ref, sha, tree hash). The clone itself is never modified.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC=""; REPO=""; REF="main"; WANT_SHA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from-path) SRC="$2"; shift 2;;
    --repo) REPO="$2"; shift 2;;
    --ref) REF="$2"; shift 2;;
    --sha) WANT_SHA="$2"; shift 2;;
    --from-lock)
      L="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/upstream.lock"
      REPO="$(grep '^repo=' "$L" | cut -d= -f2-)"; WANT_SHA="$(grep '^sha=' "$L" | cut -d= -f2)"; shift;;
    *) echo "unknown arg $1" >&2; exit 2;;
  esac
done
TMP=""
if [ -z "$SRC" ]; then
  [ -n "$REPO" ] || { echo "need --from-path or --repo" >&2; exit 2; }
  TMP="$(mktemp -d)"; trap '[ -n "$TMP" ] && rm -rf "$TMP"' EXIT
  if [ -n "$WANT_SHA" ]; then
    mkdir "$TMP/src" && git -C "$TMP/src" init -q && git -C "$TMP/src" remote add origin "$REPO"
    GIT_LFS_SKIP_SMUDGE=1 git -C "$TMP/src" fetch -q --depth 1 origin "$WANT_SHA"
    git -C "$TMP/src" checkout -q FETCH_HEAD
  else
    GIT_LFS_SKIP_SMUDGE=1 git clone -q --depth 1 --branch "$REF" "$REPO" "$TMP/src"
  fi
  SRC="$TMP/src"
else
  [ -z "$REPO" ] || { echo "--from-path and --repo are exclusive" >&2; exit 2; }
fi
NR="$SRC/Assets/NativeRemesher"
[ -d "$NR/Runtime" ] || { echo "no Assets/NativeRemesher/Runtime in $SRC" >&2; exit 1; }
SHA="$(git -C "$SRC" rev-parse HEAD)"
URL="${REPO:-$(git -C "$SRC" remote get-url origin 2>/dev/null || echo "$SRC")}"

DST="$ROOT/upstream"
rm -rf "$DST"; mkdir -p "$DST"
for d in Runtime Editor Tests Benchmark; do
  [ -d "$NR/$d" ] || continue
  (cd "$NR" && find "$d" -type f -name '*.cs' -print0 | while IFS= read -r -d '' f; do
     mkdir -p "$DST/$(dirname "$f")"; cp "$f" "$DST/$f"; done)
done
mkdir -p "$DST/Benchmarks" "$DST/ProjectSettings"
for f in Benchmarks/baseline.csv Benchmarks/README.md ProjectSettings/ProjectVersion.txt; do
  [ -f "$SRC/$f" ] && cp "$SRC/$f" "$DST/$f"
done
HASH="$("$ROOT/tools/tree-hash.sh" "$DST")"
cat > "$ROOT/upstream.lock" <<LOCK
repo=$URL
ref=$REF
path=Assets/NativeRemesher
sha=$SHA
tree_sha256=$HASH
LOCK
echo "synced $SHA -> upstream/ ($(find "$DST" -type f | wc -l) files), tree $HASH"
