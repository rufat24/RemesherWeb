#!/usr/bin/env bash
# Mutation tests: each drift check must FAIL on a deliberately drifted copy of upstream, and PASS on the real one.
set -u
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
W=upstream/Editor/NativeRemesherWindow.cs
cat upstream/Editor/NativeRemesherWindow*.cs > "$T/real.cs"
fail=0
expect() { # name, expected exit (0|1), file
  python3 tools/census_window_fields.py "$3" >"$T/out" 2>&1; rc=$?; [ $rc -ne 0 ] && rc=1
  if [ "$rc" = "$2" ]; then echo "ok   $1"; else echo "FAIL $1 (exit $rc, wanted $2)"; cat "$T/out"; fail=1; fi
}
expect "real source passes" 0 "$T/real.cs"
sed 's/bool m_HardRods = true;/bool m_HardRods = false;/' "$T/real.cs" > "$T/m1.cs";   expect "changed default is caught" 1 "$T/m1.cs"
sed 's/\[SerializeField\] bool m_MaterialBorders;/[SerializeField] bool m_MaterialBorders;\n[SerializeField] bool m_BrandNewOption = true;/' "$T/real.cs" > "$T/m2.cs"; expect "new field is caught" 1 "$T/m2.cs"
sed 's/m_ScanShapeRegions/m_ScanShapeRegionsRenamed/g' "$T/real.cs" > "$T/m3.cs";  expect "renamed field is caught" 1 "$T/m3.cs"
sed 's/\[SerializeField\] int m_TargetQuadCount = 2000;/[SerializeField] int m_TargetQuadCount = 3000;/' "$T/real.cs" > "$T/m4.cs"; expect "changed int default is caught" 1 "$T/m4.cs"

# manifest: stale or unlabeled controls
mexpect() { python3 tools/gen_manifest.py --check "$3" >"$T/out" 2>&1; rc=$?; [ $rc -ne 0 ] && rc=1
  if [ "$rc" = "$2" ]; then echo "ok   $1"; else echo "FAIL $1 (exit $rc, wanted $2)"; cat "$T/out"; fail=1; fi; }
mexpect "manifest is fresh" 0 upstream/Editor
mkdir -p "$T/ed"; cp upstream/Editor/NativeRemesherWindow*.cs "$T/ed/"
sed -i 's/Clean quads keep their own loops/Clean quads keep their loops/' "$T/ed/NativeRemesherWindow.cs"; mexpect "changed label is caught" 1 "$T/ed"
cp upstream/Editor/NativeRemesherWindow*.cs "$T/ed/"; sed -i 's/Mathf.Max(4, EditorGUILayout.IntField(/Mathf.Max(4, EditorGUILayout.IntField(  \/\/ x/' "$T/ed/NativeRemesherWindow.cs"
sed -i 's/DisabledScope(m_HardEvenRows)/DisabledScope(m_HardEvenRowsX)/' "$T/ed/NativeRemesherWindow.cs"; mexpect "changed enable/disable rule is caught" 1 "$T/ed"
exit $fail
