# RemesherWeb — Plan (v3, built on measured facts)

Goal: run the **NativeRemesher** quad remesher in the browser.

**Source of truth:** `rufat24/RemesherDektop`, branch `main`, commit `8766ead`, folder `Assets/NativeRemesher/`.
That repo belongs to the desktop effort. **This repo only reads from it and never writes to it.**
`Benchmarks/README.md` there (2,100 lines) is the authority on the algorithm's state.

## 1. What the source is (all verified by reading it)

| Fact | Evidence |
|---|---|
| Pure C#, no native plugin. About 56,800 lines, ~100 files in `Runtime/`, namespace `NativeRemesher`. | `README.md`, `wc -l` |
| Algorithm: Instant Meshes (Jakob 2015) with pieces of QuadriFlow. | `README.md` |
| No Burst, Jobs, `unsafe`, `DllImport`. Runtime asmdef references nothing. | grep |
| Unity coupling is value types: `Vector3` (~2200 uses), `Mathf` (~1200), `Vector2/2Int/3Int/4`, `Color32`, `Matrix4x4`, `Bounds`, `Ray`, `Debug`, `Random`. 74 files. Real engine objects (`Mesh`, `Material`, `Texture2D`, `GameObject`) appear in **13 files**. | grep |
| Entry point: `RemeshPipeline.Solve(positions, triangles, settings, profile, progress, …)` taking **plain arrays**. | `RemeshPipeline.cs:1057` |
| `RemeshSettings` has: `targetQuadCount`, `orientationIterations`, `positionIterations`, `faceCountIterations`, `faceCountTolerance`, `symmetry` (X/Y/Z), `materialBorders`, `densityPaint`, `modelType` (General / Auto / Hard Surface / Scan / Character…), plus a legacy `mergeThreshold`. | `RemeshPipeline.cs:10` |
| **The Editor window sets ~20 static `RemeshPipeline.*` knobs** before calling `Solve` (e.g. `ribbonParts`, `hardSurfaceSimplify`, `kinematicGuides`, `quadReductionCharacter` …), lines ~840–895 of `NativeRemesherWindow.cs`. These are the real parameter panel. Window code is ~4,500 lines (main 1,747; Lods 1,070; Parts 941; Paint 390). | `Editor/` |
| Parallelism: `Parallel.For` everywhere, always through `BackgroundScheduler.Options`. **No** `Task.Wait`, `.Result`, `WaitAll`, `SemaphoreSlim`. Only `Interlocked` and `lock`, which are fine in WASM. | grep |
| Tests: 120 NUnit (118 pass, 2 skipped). Quality gate: `BenchmarkRunner` against committed `Benchmarks/baseline.csv`, tolerance 2%, on a **procedural corpus generated in code** (no private assets needed). | `Headless/README.md`, `Benchmarks/README.md` |

## 2. Measured facts about this container

| Check | Result |
|---|---|
| .NET 8 SDK | **Installs via `apt install dotnet-sdk-8.0`** (8.0.133). Microsoft's own download hosts are blocked, Ubuntu's archive is not. |
| WASM AOT toolchain | **`dotnet workload install wasm-tools` succeeds** (Emscripten 3.1.34, NuGet reachable). |
| Browser testing | Chromium + Playwright preinstalled. |

So M0–M2 can be built and tested **in this container**.

## 3. The two real risks, now sized

### Risk A — Threads: the scheduler cannot run in a browser as written
`BackgroundScheduler` creates real OS `Thread`s and a `BlockingCollection`. Single-threaded browser-wasm
cannot start threads, so the class must be replaced for the web build. That is small and contained: one
~80-line file. The browser variant runs work inline and returns plain `ParallelOptions`; `Parallel.For`
then runs sequentially. The desktop/server variant stays unchanged.

### Risk B — Speed: single-threaded and not JIT-compiled
Desktop numbers from the repo's own benchmarks (multi-threaded .NET 8, cores−1 threads):

| Case | Native time |
|---|---|
| procedural cube, 2,000 quads | 1.7 s |
| `icosphere_320k` → 8,000 quads | 8.4 s |
| 1.5M-triangle photogrammetry scan → 5.5k faces | 12–17 s |

Browser expectations (**estimates, not measurements**): default .NET WASM *interprets* IL, which is
typically an order of magnitude slower than JIT. AOT (installable here) typically lands around 2–4x
slower than native, and we also lose the extra cores. Outlook:
- small and medium meshes (up to a few tens of thousands of triangles, a few thousand quads): fine
- large scans (hundreds of thousands to millions of triangles): minutes, plus WASM's 32-bit memory ceiling
  (about 2–4 GB), so inputs must be capped or sent to a server

**Therefore the architecture is "compile once, run on two hosts":**

```
            NativeRemesher core (C#, unchanged, synced from RemesherDektop@pinned)
                   |                                   |
       Browser host (WASM AOT, Worker)        Server host (.NET 8, real threads)
       default, works offline, no upload      optional, large meshes, original scheduler
                   \                                   /
                  same flat-array JSON/binary API  →  same Web UI
```

Build the browser host first (it is what you asked for), but keep the API host-neutral so the server host
is a small addition, not a rewrite. M4 decides, from measurements, whether it ships.

## 4. Milestones (each has an exit check)

**M0 — Core compiles outside Unity (Linux, .NET 8).**
1. Trace what `NativeRemesherWindow*.cs` does around `Solve`: the static-knob block (~840–895), `Parts.cs`
   (the latest commit is about parts sewn into one surface), `QuadSource.cs`, and `Benchmark/EditorParity.cs`.
   Everything done outside `Runtime/` must be ported into a `WebRemesher` facade, or web output will not match Unity.
2. `sync/` script copies `Runtime/` (plus the `Benchmark/` files the gate needs: `MeshCorpus`, `MeshMetrics`,
   `BenchmarkRunner`) from the pinned commit into `core/src/`. Generated, never hand-edited.
3. `shim/`: `UnityEngine.Vector3`, `Mathf`, `Matrix4x4`, … **with Unity's semantics, not just names**:
   approximate `Vector3 ==`, `normalized` → zero for tiny vectors, `Mathf.Round` behavior, `UnityEngine.Random`
   (5 uses: check whether seeded, since a different sequence moves the baseline), the one
   `UnityEngine.Rendering` use. Implement from Unity's documented behavior; do not paste Unity reference
   source into this public repo.
4. Adapter for the 13 files that use `Mesh` / `Material` / `Texture2D` (minimal array-backed shim or `#if`).
5. CLI: OBJ in → remesh → OBJ out.
*Exit:* builds, and the procedural corpus lands within tolerance of `Benchmarks/baseline.csv`
(first confirm the baseline matches the pinned commit; a stale baseline fails M0 even if the port is right).
**This is the go/no-go for the whole project.**

**M0.5 — WASM spike, inside a Web Worker, before any UI work.**
`browser-wasm` + **AOT**, browser scheduler variant, one small procedural case.
Record: output equals M0 (counts + metrics), wall time **AOT vs. interpreter**, download size, peak memory.
Node alone does not prove the Worker path. *Exit:* a measured speed factor versus native. That number
replaces the estimates in Risk B and fixes the input-size cap.

**M1 — Browser host.** `[JSExport]` API with flat typed arrays (`Float32Array` positions, `Uint32Array`
indices, settings object), progress and cancel, Worker wrapper.
*Exit:* the corpus under WASM matches M0 within tolerance.

**M2 — Web app.** Vite + TypeScript + three.js: OBJ/PLY/GLB import, before/after view with quad-edge wireframe,
parameter panel built from the window's real controls (model type, the static knobs, `RemeshSettings`),
progress/cancel, OBJ export.
*Exit:* load → remesh → view → export in real Chromium (Playwright).

**M3 — Parity and CI.** Port the 120 tests to plain NUnit/xUnit; CI runs unit tests, the baseline gate and
Playwright on every push.

**M4 — Limits and the server decision.** Using M0.5/M1 measurements: set the input-size cap (reuse
`PreDecimate`, which took the 990k scan from 9 minutes to 6.5 s), decide whether to ship the server host,
and whether threaded WASM is worth it (needs COOP/COEP headers, so not GitHub Pages).

**M5 — Deploy.** Static hosting plus README; server host only if M4 says so.

## 5. Scope

**In (core path):** import → `Solve` with the window's real parameters (model type, symmetry, material
borders, hard-surface/character/scan options) → result mesh → export OBJ.
**Out for now, your call (each is real Editor code):** density painting (`DensityPaint`, `RemeshPaint`,
window Paint 390 lines), LOD chains (Lods 1,070 lines), texture/normal-map bake (`TextureBake`), attribute/UV
transfer, parts UI (Parts 941 lines), FBX export (`FbxWriter`).

## 6. Open items (unverified — do not assume)

1. **License.** Not checked: the repo has no LICENSE file, and the algorithm derives from Instant Meshes and
   QuadriFlow. Resolve before the site goes public.
2. **Public exposure.** `RemesherDektop` currently holds the whole Unity project and is public. Your call.
3. **Float parity.** Unity's `Mathf` vs .NET `Math`/`MathF` can differ in the last bits. Parity means the
   metric tolerance in `baseline.csv`, never bit-exact output.
4. **Static mutable knobs** make one remesh per worker at a time. Fine, but document and test it.
5. **Tier-2 corpus** (real scans) is not in the repo, so real-world parity is limited to what you can supply.
6. **Which Editor features** you want on the web (Section 5).

## 7. Repo layout

```
sync/    copies Runtime/ (+ needed Benchmark files) from the pinned RemesherDektop commit; read-only
shim/    UnityShim: Vector3, Mathf, Matrix4x4, ...
core/    generated src copy + adapters (+ browser BackgroundScheduler variant)
cli/     OBJ in, OBJ out; drives the parity gate
wasm/    browser-wasm AOT project + JSExport API
web/     Vite app, Web Worker, three.js
server/  optional .NET host (M4 decision)
tests/   ported unit tests, baseline gate, Playwright specs
```
