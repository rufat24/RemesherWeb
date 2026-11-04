#!/usr/bin/env bash
# Import-format check through the real UI: the same mesh as OBJ, STL (unwelded), GLB (indexed), GLB (3 vertices per triangle) and PLY (binary)
# must each remesh without error to the same number of quads as the OBJ. usage: run-formats.sh <dist> <model.obj>
set -euo pipefail
cd "$(dirname "$0")/.."
DIST="$1"; OBJ="$2"; W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
node e2e/make-fixtures.cjs "$OBJ" "$W"; B=$(basename "$OBJ" .obj); ref=""
for f in "$B.obj" "$B.stl" "$B.glb" "${B}_split.glb" "$B.ply"; do
  src="$W/$f"; [ -f "$src" ] || src="$(dirname "$OBJ")/$f"
  out=$(node e2e/e2e.cjs "$DIST" "$src" | tail -1); faces=$(echo "$out" | sed -E 's/.*"exportedFaces":([0-9]+).*/\1/'); errs=$(echo "$out" | grep -o '"errors":\[[^]]*\]')
  echo "$f: $faces faces $errs"; [ "$errs" = '"errors":[]' ] || { echo "page errors"; exit 1; }
  [ -z "$ref" ] && ref="$faces"; [ "$faces" = "$ref" ] || { echo "FAIL: $f gave $faces faces, the OBJ gave $ref"; exit 1; }
done
echo "FORMATS OK ($ref faces each)"
