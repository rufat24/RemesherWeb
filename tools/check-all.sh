#!/usr/bin/env bash
# The fast drift/regression checks, in one place so CI and a developer run the same thing. Needs upstream/ (run tools/sync-upstream.sh --from-lock first).
set -euo pipefail
cd "$(dirname "$0")/.."
step() { printf '\n== %s\n' "$*"; }
step "upstream snapshot matches upstream.lock (no hand edits)";  tools/verify-upstream.sh
step "window-field census";                                        python3 tools/census_window_fields.py
step "UI manifest is generated from the window and fresh";         python3 tools/gen_manifest.py --check
step "drift checks fire on mutated sources (mutation tests)";      tools/test-drift.sh
step "build the CLI (core + shim + orchestration)";                dotnet build cli -c Release -v q --nologo | tail -3
CLI="dotnet cli/bin/Release/net10.0/NativeRemesher.Cli.dll"; W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
$CLI export-case cube_subdivided "$W/cube.obj"; $CLI export-case icosphere_80k "$W/ico.obj"
step "statics isolation: A/B/A in one process";                    $CLI aba "$W/cube.obj" '{"targetQuadCount":500}' '{"modelType":"HardSurface","hardToCount":true,"hardEvenRows":true,"curveDetail":90}'
step "statics isolation: pollution is undone";                     $CLI leak "$W/ico.obj" '{}'
step "statics isolation: control (restore off) must FAIL";         if ABA_NO_RESTORE=1 $CLI leak "$W/ico.obj" '{}' >/dev/null; then echo "control did not fail: the leak test has no teeth"; exit 1; else echo "control failed as it should"; fi
step "web: typecheck + unit tests";                                (cd web && npm ci --silent && npx tsc --noEmit && npx vitest run)
echo; echo "ALL CHECKS PASSED"
