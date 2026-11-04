# RemesherWeb — Plan

Goal: run the **NativeRemesher** quad remesher in the browser.

**Source of truth:** `rufat24/RemesherDektop`, branch `main` (commit `8766ead`), folder
`Assets/NativeRemesher/`. That repo belongs to the desktop effort. **This repo only reads from it and
never writes to it.** Read `Benchmarks/README.md` there as the authority on the algorithm's state.

## What the source actually is (verified)

| Fact | Evidence |
|---|---|
| **Pure C#**, not a C++ DLL. Nothing to compile with Emscripten. | `README.md`: "no external engine, no native plugin" |
| About **56,800 lines** in ~100 files under `Runtime/` (namespace `NativeRemesher`) | `wc -l` |
| Algorithm: Instant Meshes (Jakob et al. 2015) plus pieces of QuadriFlow | root `README.md` |
| **No Burst, Jobs, Unity.Mathematics, `unsafe` or `DllImport`.** Runtime asmdef references nothing. | grep |
| The Unity dependency is the **value types**: `Vector3` (~2200 uses), `Mathf` (~1200), `Vector2`, `Vector2Int`, `Vector3Int`, `Vector4`, `Color32`, `Matrix4x4`, `Bounds`, `Ray`, `Debug`, `Random`. 74 of ~100 files use `UnityEngine`. | grep |
| Real engine objects are touched in only **13 files**: `Mesh` (41 uses), a little `Material`, `Texture2D`, `GameObject`. Those are the adapter layer. | grep |
| Parallelism is plain **`Parallel.For`** through `BackgroundScheduler.Options` (13 files). | grep |
| Entry point: static `RemeshPipeline`, `RemeshSettings` struct in, `RemeshResult` out. Many **static mutable "debug" knobs** (not thread-safe). | `RemeshPipeline.cs` |
| Existing test and quality gate: 120 NUnit tests (118 pass, 2 skipped) and `BenchmarkRunner` with a committed `Benchmarks/baseline.csv` and a tolerance (default 2%) on a **procedural** corpus, so no private assets are needed. | `Headless/README.md` |
| An FBX writer, a quality-metrics set (`MeshMetrics`) and an OBJ reader/writer already exist. | file list |

## Approach (recommended): compile the C# unchanged to WebAssembly

Rewriting 57k lines of tuned numeric code in TypeScript or Rust would be the slowest and riskiest path.
Instead:

1. **UnityShim**: a tiny plain-.NET library that defines `UnityEngine.Vector3`, `Mathf`, `Vector2`,
   `Matrix4x4`, … with the same names and semantics, so the ~100 Runtime files compile **without edits**.
2. **Adapter** for the 13 files that touch `Mesh` / `Material` / `Texture2D`: either a minimal `Mesh`
   shim holding arrays, or thin edits behind `#if`. Decide in M0 after reading those files.
3. A **sync script** (like their `tools/sync-headless.sh`) copies `Runtime/` from a pinned commit into
   `core/src/`. The copy is generated and never hand-edited.
4. Shim **semantics**, not just names: Unity's approximate `Vector3 ==`, `normalized` returning zero for
   tiny vectors, `Mathf.Round` behavior, `UnityEngine.Random` (5 uses: check whether seeded, since a
   different sequence moves the baseline) and the one `UnityEngine.Rendering` use. Implement from Unity's
   documented behavior; do not paste Unity reference source into this public repo.
5. Build with the **.NET WebAssembly (`browser-wasm`)** target and call it from JS through
   `[JSExport]` with flat typed arrays: positions `Float32Array`, indices `Uint32Array`, settings as JSON.
6. Run it inside a **Web Worker**, with progress and cancel.

### Alternatives considered

| Option | Verdict |
|---|---|
| **Unity WebGL build** | Heavy download, no real threads, awkward UI. Quick demo only. |
| **Server-side .NET** (web UI uploads the mesh to a backend) | Full native speed and real multithreading, no WASM risk. Costs hosting and uploads. **Best fallback** if M1/M4 shows WASM is too slow or too memory-bound. |
| **Rewrite in TS/Rust** | Rejected: 57k lines of tuned code, would lose parity. |

## Milestones (each has an exit check)

**M0 — Compile and run outside Unity, on Linux.**
Checks, in order:
1. **Trace what `Editor/NativeRemesherWindow*.cs` (incl. `.Parts.cs`, `QuadSource.cs`) does around
   `RemeshPipeline`.** The latest commit is about parts being sewn into one surface, and
   `Benchmark/EditorParity.cs` exists, so the window may do orchestration the pipeline alone does not.
   Whatever it does outside `Runtime/` must be synced or ported, or web output will not match what the
   user sees in Unity.
2. Install the .NET SDK (see risk 1).
3. Widen the sync beyond `Runtime/`: the gate needs `MeshCorpus`, `MeshMetrics`, `BenchmarkRunner`
   from `Benchmark/` (they use Unity types too). Confirm `Benchmarks/baseline.csv` actually matches the
   pinned commit; a stale baseline would fail M0 even if the port is right.
4. Build `UnityShim` + `core` + a small CLI (OBJ in, remesh, OBJ out).

*Exit:* compiles, and the procedural corpus run lands within the baseline tolerance.

**M0.5 — WASM spike (the real go/no-go, before any web-app work).**
Run one small procedural case under `browser-wasm` **inside a dedicated Web Worker**, on the pinned .NET
version. Single-threaded browser-wasm throws on blocking waits (`Task.Wait`, `.Result`, `WaitAll`,
`SemaphoreSlim.Wait`), and `BackgroundScheduler.cs` has not been read yet. Node alone does not prove the
Worker path. If this fails, the server-side fallback becomes the plan.

**M1 — WebAssembly build.**
`browser-wasm` build, `[JSExport]` API, a Node smoke test running the same corpus under WASM.
*Exit:* WASM output equals the M0 output (same counts, metrics within tolerance); record download size,
time and peak memory versus native.

**M2 — Web app.**
Vite + TypeScript + three.js: OBJ/PLY/GLB import, before/after view with a quad-edge wireframe, a
parameters panel generated from `RemeshSettings`, a progress bar with cancel, OBJ export. The Web
Worker is built here.
*Exit:* load, remesh, view, export in a real browser (Playwright check).

**M3 — Parity and CI.**
Port the 120 tests to plain NUnit/xUnit, run them in CI, run the baseline gate in CI, and add
Playwright end-to-end tests.
*Exit:* CI green on every push.

**M4 — Performance and limits.**
Measure before optimizing. Settle threads vs. single-threaded, memory ceiling (WASM practically tops
out around 2 GB), max input size (reuse `PreDecimate`), and whether to ship a server fallback.
*Exit:* documented limits and a decision on the fallback.

**M5 — Deploy.** Static hosting with the right headers, plus a README.

## Scope

**In (core path):** import → `RemeshPipeline` with its settings → result mesh → export.
**Out for now (Editor/Unity features, decide later):** density painting (`DensityPaint`, `RemeshPaint`),
LOD chains, texture bake, attribute transfer, material labels and parts UI, FBX export. Each needs a
separate decision on whether the web version wants it.

## Risks and open items (unverified — do not assume)

1. **.NET SDK is not installed** in this cloud container and network access to fetch it is untested.
   M0 starts by checking this. If it cannot be installed here, M0 needs a different machine or CI.
2. **Speed.** I have not read any performance numbers (`PerfProbe`, `Benchmarks/*.md`). WASM is typically
   slower than native .NET, and `Parallel.For` in single-threaded WASM runs sequentially. Real meshes
   (the reference scan is ~56 MB as OBJ) may be too slow without threads.
3. **Threads.** .NET WASM multithreading is experimental and needs cross-origin isolation headers
   (COOP/COEP), which GitHub Pages cannot set. This decides hosting. Open decision.
4. **Static mutable knobs** in `RemeshPipeline` make it safe for **one remesh per worker at a time**.
   Fine, but must be documented and tested.
5. **Float parity.** Unity's `Mathf` and .NET's `Math`/`MathF` can differ in the last bits. Parity is
   defined by the metric tolerance in `baseline.csv`, never by bit-exact output.
6. **License.** Not checked. The algorithm is derived from published work (Instant Meshes, QuadriFlow).
   Check the licenses of those parts before publishing a public site.
7. **Public repo exposure.** `RemesherDektop` currently contains the whole Unity project and is public.
   That is your call. The user-supplied scan referenced by the harness is not in it.
8. **Which features do you want on the web?** See Scope.

## Repo layout (proposal)

```
sync/            script that copies Runtime/ from a pinned RemesherDektop commit (read-only)
shim/            UnityShim: Vector3, Mathf, Matrix4x4, ...
core/            generated src copy + adapter for the 13 Mesh/Material files
cli/             OBJ in, OBJ out; used for the parity gate
wasm/            browser-wasm project + JSExport API
web/             Vite app, Web Worker, three.js
tests/           ported unit tests, baseline gate, Playwright specs
```
