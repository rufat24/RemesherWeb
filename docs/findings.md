# Findings about the upstream source (commit 8766ead)

1. **The benchmark gate throws on turned shapes.** `Revolution.enabled` defaults to `true` (`Runtime/Revolution.cs:23`).
   `RemeshPipeline.SolveCovered` then routes icosphere, torus, cylinder, disc, holed sphere and self-intersecting sphere
   through `Revolved(...)`, whose result has `topology == null`. `BenchmarkRunner.RunOne` calls
   `PolyMesh.FromTopology(result.topology)` (`Benchmark/BenchmarkRunner.cs:260`) and fails with
   `ArgumentNullException: topology`. The unit tests switch `Revolution.enabled` off in `SetUp`; the benchmark does not.
   The committed `Benchmarks/baseline.csv` rows for those meshes show the ordinary pipeline ("pre-decimated ...", "face-count
   passes"), so the baseline predates the turned-surface shortcut. Not shim-related: it is the same code path in Unity (UNVERIFIED
   in Unity itself; the user can confirm by running the gate once). The web bench host mirrors the tests via `BENCH_NO_REVOLUTION=1`.
2. **The Unity baseline cannot serve as a cross-runtime parity gate** (see `measurements.md`, E3c/E4).
3. `HANDOVER.md`'s "120 tests" is stale: 250 `[Test]`/`[TestCase]` attributes exist.

## 5. Browser vs CoreCLR on the product path (M1 exit check, commit 8766ead)

`WebRemesher.Run` (Revolution ON, as in the window) run in headless Chromium (AOT Worker) and in CoreCLR, same OBJ, same options,
corpus meshes at targetQuadCount 1500: **topology identical in 6/6**; positions bit-identical in 4/6 (icosphere_5k, torus,
cylinder_capped, sphere_holed); `cube_subdivided` and `sphere_bumpy` differ in 1745/4375 and 1213/1753 vertices, max displacement
**4e-4 and 3e-6 of the model extent**. `Scan`, `General` and `Auto` model types on cube_subdivided also differ at the last bit
(147/1451 vertices, 1 ulp) with identical faces.

Cause: upstream calls `Math.Sin/Cos/Atan2/Pow/Exp/Log` directly in ~100 places (not only through `Mathf`); wasm uses the Emscripten libm,
CoreCLR the platform libm, and the position/fairing stages are iterative, so a last-bit difference grows. It cannot be removed without
editing upstream (we cannot shadow `System.Math`), so it is **policy, not a bug**:

* same host + same build: exact hash regression (`cli aba`, browser A/B/A: A twice in one worker and across fresh workers gave equal hashes);
* cross host: `tools/compare_obj.py` -- same polygons (a cyclic restart of a face's corners is the same polygon), max vertex shift <= 0.10 and p99 <= 0.01 of a mean quad edge.
  Measured: cube_subdivided@5000 through the full web UI vs the CLI: 2 of 5162 faces start at another corner, p99 2.3e-3 edge, max 8.4e-2 edge.

Statics isolation: `cli leak` flips `Revolution.enabled` between two identical jobs. With the restore the hashes are equal; with the restore
disabled (`ABA_NO_RESTORE=1`) job 2 changes from 1976 to 1919 quads, so the test can fail.

## 6. Unity space changes the answer (so the format layer must do what Unity's importer does)

The window sees a model after Unity's importer, which mirrors X and reverses winding. The core is not mirror-symmetric to the last bit and the
pipeline is chaotic, so `cube_subdivided` at the default options gives **5131 quads** read as-is and **5162** read in Unity space (same options).
The web format layer therefore converts on import and back on export (`web/src/formats/unity-space.ts`, exact involution, tested), and
`CLI_UNITY_SPACE=1 cli remesh` applies the same transform so CLI and browser can be compared on the same input.
(Unconfirmed until a Unity run: that Unity's OBJ/FBX importers apply exactly this transform for every format. See PLAN.md D7.)

## 7. First end-to-end web run (commit after 4ba2045)

`web/e2e/e2e.cjs` drives the built UI in headless Chromium: file input -> Remesh -> result summary -> Download OBJ. cube_subdivided, default options:
5162 quads, 0 page errors, the exported OBJ has 5162 faces, all quads, and passes `compare_obj.py` against the CLI result.
