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

# Editor members: the hand-ported PrepareRun and everything pending are fingerprinted
eexpect() { python3 tools/census_editor_members.py "$3" >"$T/out" 2>&1; rc=$?; [ $rc -ne 0 ] && rc=1
  if [ "$rc" = "$2" ]; then echo "ok   $1"; else echo "FAIL $1 (exit $rc, wanted $2)"; cat "$T/out"; fail=1; fi; }
fresh() { rm -rf "$T/em"; mkdir -p "$T/em"; cp upstream/Editor/NativeRemesherWindow*.cs "$T/em/"; }
fresh; eexpect "editor members match the census" 0 "$T/em"
fresh; sed -i 's/RemeshPipeline.detailQuads = false;/RemeshPipeline.detailQuads = true;/' "$T/em/NativeRemesherWindow.cs"; eexpect "PrepareRun constant flip is caught" 1 "$T/em"
fresh; sed -i 's/RemeshPipeline.detailQuads = false;/RemeshPipeline.detailQuads = false; RemeshPipeline.somethingNew = true;/' "$T/em/NativeRemesherWindow.cs"; eexpect "PrepareRun new static assignment is caught" 1 "$T/em"
fresh; sed -i 's/static string MeshSummary(GameObject selected, Mesh mesh)/static string MeshSummary(GameObject selected, Mesh mesh) { RemeshPipeline.detailQuads = true; return ""; }\n static string MeshSummaryOld(GameObject selected, Mesh mesh)/' "$T/em/NativeRemesherWindow.cs"; eexpect "ui-only member gaining a Runtime reference is caught" 1 "$T/em"
fresh; printf 'partial class NativeRemesherWindow { void BrandNew() { Foo.Bar(); } }\n' > "$T/em/NativeRemesherWindow.Extra.cs"; sed -i 's/partial class NativeRemesherWindow {/partial class NativeRemesherWindow : X {/' "$T/em/NativeRemesherWindow.Extra.cs"; eexpect "a new method is caught" 1 "$T/em"
fresh; sed -i 's/void DrawCountSection()/void DrawCountSectionRenamed()/' "$T/em/NativeRemesherWindow.cs"; eexpect "a renamed/removed member is caught" 1 "$T/em"
fresh; sed -i 's/Section(2, "How Many Quads"/Section(2, "How Many Quads Now"/' "$T/em/NativeRemesherWindow.cs"; eexpect "a label-only edit in a ui-only member is NOT noise" 0 "$T/em"
exit $fail
