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
