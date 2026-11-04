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

## Root cause of the 7x and the fix (profiled, not guessed)

Per-stage AOT vs CoreCLR-inline on `icosphere_80k@2000` before the fix: decimate 0.9x, orientation 3.3x, **position 12.3x** (29.7 s of 33.6 s), extraction 1.7x.
Hypotheses tested and **refuted**: (1) Mono interpreter fallback for `Array.Sort<int>` (`MONO_LOG_MASK=aot` listed 20 fallbacks; replacing the hot
`SparseLdlt` sort changed position 29.7 s -> 29.0 s); (2) garbage collection (`MONO_GC_PARAMS=nursery-size=64m/256m`: same time).
A V8 CPU profile of a build that keeps the wasm name section (`-p:WasmNativeStrip=false`) showed: **44% self time in `PositionField.Compat(Vector3 x8...)` plus
~20% in `UnityShim.Vector3.op_Multiply/op_Addition/Dot/sqrMagnitude` calls that were not inlined.** Mono AOT does not inline across assembly boundaries and the
shim lived in `UnityShim.dll`.

**Fix (only our own code, `upstream/` untouched):** compile the upstream Runtime, the shim and the host into **one assembly** for the WebAssembly build
(`wasm/NativeRemesher.Wasm.csproj`), and mark the shim's Vector2/Vector3/Mathf members `AggressiveInlining`.

| Case | AOT before | **AOT after** | CoreCLR inline | CoreCLR threaded | after / inline | hash = CoreCLR |
|---|---|---|---|---|---|---|
| cube_subdivided @2000 | 22.4 s | **3.4 s** | 3.0 s | 2.6 s | 1.14x | yes |
| icosphere_80k @2000 | 38.9 s | **6.8 s** (Chromium Worker 6.9 s) | 5.3 s | 3.6 s | 1.3x | yes |
| icosphere_320k @8000 | 175.6 s | **45.9 s** | 25.0 s | 12.7 s | 1.84x | yes |

Position stage on 80k: 29.0 s -> 4.0 s. Memory RSS (Node): 198 / 226 / 570 MB. Brotli total of `_framework` 5.9 MB in this symbol-keeping build (stripped production build to be measured).

## G0 (go/no-go) per the plan's thresholds — re-evaluated after the fix

| Threshold | Measured | Verdict |
|---|---|---|
| WASM AOT <= 5x slower than CoreCLR-inline | **1.14x - 1.84x** | **Met** |
| `icosphere_320k@8000` <= 3 min | **46 s** | **Met** |
| Threads available | not buildable (E6) | not needed for these cases |

**Decision: browser-only is viable and is the plan.** The first G0 verdict ("hybrid", from the 7x figure) was an artefact of cross-assembly inlining and was
withdrawn after profiling. A server host stays an *option* (very large scans, texture bakes at 8K, IP concerns: decisions D3/D4), no longer a requirement.
Still unmeasured: the heavy features (bakes, Parts, LOD chains) and 1M-triangle inputs; E5 (4K/8K bake memory) and E7 (scan-size ceiling) come next.
