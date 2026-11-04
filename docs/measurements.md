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

## Upstream test suite on CoreCLR (M0c)

`dotnet test tests` over the unchanged `upstream/Tests/*.cs` (+ `upstream/Benchmark/*` minus `BenchmarkRunner`) against `shim/`:
**Passed 249, Failed 0, Skipped 2, Total 251** in 6 min 12 s on 4 cores. The 2 skips are upstream's own `[Ignore]`d tests
(e.g. `QuadFraction_OnVaryingCurvature_IsRecordedNotYetAtTarget`). The Unity-side count at this SHA is unknown (the Headless README's "120" is stale).
`LogAssert` is a recording stub; unlike Unity it does not fail tests on unexpected error logs.

## M0b: WebAssembly spike (E1, E2, E6) — .NET 10, `Microsoft.NET.Sdk.WebAssembly`, single thread, `InlineScheduler`

Host: `wasm/` (`[JSExport] RunCase`) over the shared `wasm/CaseRunner.cs`; the CoreCLR twin is `cli/`. Same machine (4-core container).
Output hash = FNV-1a over every output vertex coordinate bit pattern and every face index.

| Case | CoreCLR threaded | CoreCLR inline | WASM interpreter (Node) | **WASM AOT (Node)** | WASM AOT (Chromium Worker) | AOT / inline | hash equal to CoreCLR? |
|---|---|---|---|---|---|---|---|
| cube_subdivided @500 | – | ~0.8 s | 60.4 s | – | – | – | **yes** (`ff2f244a23ca94ee`) |
| cube_subdivided @2000 | 2.6 s | 3.0 s | – | 22.4 s | – | 7.5x | **yes** |
| icosphere_80k @2000 | 3.6 s | 5.3 s | – | 38.9 s (36.6 s with -O3+SIMD) | **35.2 s** | 7.4x | **yes** |
| icosphere_320k @8000 | 12.7 s | 25.0 s | – | **175.6 s** | – | 7.0x (13.8x vs threaded) | **yes** |

- **E1 passes:** `Parallel.For` runs under `InlineScheduler` in WASM (Node and a real Chromium module Worker). No blocking waits hit.
- **Bit-exact parity:** every WASM output (interpreter and AOT) equals CoreCLR's bit for bit on all cases run. So the CoreCLR build is an exact
  reference for the browser (emscripten libm did not change a single bit on these cases; keep testing on more cases).
- **Speed:** the interpreter is ~75x slower than CoreCLR and unusable. **AOT is ~7x slower than single-threaded CoreCLR**, ~14x slower than threaded.
  `-O3` plus SIMD recovers only ~6%: the gap is Mono AOT codegen cost, not flags.
- **Size (AOT):** ~3.3 MB brotli in total (23 MB uncompressed `_framework`), boot 0.12 s (Node) / 0.21 s (Chromium).
- **Memory:** RSS 172 MB (cube@2000), 196 MB (80k@2000), 536 MB (320k@8000) in Node. The 4K/8K texture-bake memory question (E5) is not yet measured.
- **E6 threads: FAILS to build.** `-p:WasmEnableThreads=true` with AOT: `wasm-ld: --shared-memory is disallowed by NativeRemesher.Runtime.dll.o because it
  was not compiled with 'atomics' or 'bulk-memory' features` (.NET 10.0.14, Emscripten 3.1.56). Threaded interpreter would be pointless (~75x slower).
  Possible follow-up: AOT atomics flags, or a later .NET.

## G0 (go/no-go) per the plan's thresholds

| Threshold | Measured | Verdict |
|---|---|---|
| WASM AOT <= 5x slower than CoreCLR-inline | **7.0-7.5x** | **Miss** |
| `icosphere_320k@8000` <= 3 min | **2 min 56 s** | Barely met |
| Threads available | Not buildable (E6) | Closed for now |

**Decision: hybrid.** The browser runs small and medium inputs (comfortably: a few thousand quads on up to ~100k triangles takes well under a minute).
Heavy jobs (very large scans, big quad targets, texture bakes) need the server host, which is the same `Core` library on CoreCLR with real threads
(12.7 s instead of 176 s for the heaviest corpus case). The server is therefore no longer a contingency but a planned component; this is the
substance of user decision D3 (and of the IP question D4). Re-measure after any .NET upgrade, since both AOT speed and threaded AOT are moving targets.
