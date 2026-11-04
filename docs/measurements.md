# Measurements (procedural corpus, 36 rows = 12 meshes x targets 500/2000/8000, 4-core container, .NET 10 CoreCLR)

Core = upstream `Runtime/` at 8766ead compiled unchanged against `shim/`. `BENCH_NO_REVOLUTION=1` (see findings.md #1).
Compare with `tools/compare_runs.py A.csv B.csv`.

| Exp | Comparison | Result |
|---|---|---|
| E3a | threaded run vs a second threaded process | **36/36 rows bit-identical** (ignoring timings). Deterministic across processes. |
| E3b | threaded vs `DOTNET_PROCESSOR_COUNT=1` | **36/36 rows bit-identical.** Thread count does not change results, so a single-threaded browser run is expected to equal this build. |
| E3c | this build vs Unity `baseline.csv` | **0/36 identical, 32/36 differ in outFaces.** Either a stale baseline or Unity-vs-.NET float differences. |
| E4  | `Mathf` double-then-cast vs pure `MathF` (same code) | **24/36 identical; 12/36 move, 10 in outFaces, up to ~6%** (torus@500: 473 vs 445). The pipeline is chaotic at the last bit. |

Consequence: "within 2% of the Unity baseline" is **not achievable as a cross-runtime gate**, whatever the cause of E3c. Policy (ii) of the plan
applies: regress against the web-native baseline (`baselines/coreclr-net10-8766ead-procedural.csv`, exactly reproducible), and judge Unity
goldens per column over bands averaged across targets. E3c vs. staleness is settled only by one Unity run of the gate (decision D7).

Timing, CoreCLR net10: whole 36-row corpus 59 s on 4 threads, 77 s with `DOTNET_PROCESSOR_COUNT=1` (1.3x). Note this corpus is dominated by
pre-decimation and small meshes; the WASM speed factor is measured in M0b.
