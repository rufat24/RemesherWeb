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
| .NET SDK | **Installs via apt**: `dotnet-sdk-8.0` (8.0.133) and `dotnet-sdk-10.0` (10.0.114) are both offered. Microsoft's own download hosts are blocked, Ubuntu's archive and `packages.microsoft.com` are not. **Pin .NET 10 (LTS)**: .NET 8 is reportedly at end of support around Nov 2026 (verify). |
| WASM AOT toolchain | **`dotnet workload install wasm-tools` succeeded on .NET 8** (Emscripten 3.1.34). NuGet is reachable, so the .NET 10 workload should work too; **confirm at the start of M0**. If only 8 works, it is fine for the spike, but upgrade before ship. |
| Browser testing | Chromium + Playwright preinstalled. |

So M0–M2 can be built and tested **in this container**.

## 3. The two real risks, now sized

### Risk A — Threads: not a blocker, and no fork needed
`BackgroundScheduler` uses real OS `Thread`s and a `BlockingCollection`, which single-threaded browser-wasm
cannot run. But it is only constructed by the **Editor windows and the tests** (`NativeRemesherWindow*.cs`,
`BackgroundSchedulerTests.cs`), never inside `Runtime/`. Inside the runtime only `BackgroundScheduler.Options`
is used, and that resolves to `TaskScheduler.Current`, the default scheduler. So the class compiles as is;
the web side simply never constructs one, and `Parallel.For` runs sequentially on the single thread.
Confirm in M0.5.

### Risk B — Speed: single-threaded and not JIT-compiled
Numbers from the repo's own benchmarks, run in **Unity batch mode (Unity's Mono runtime, the author's Windows PC, cores−1 threads)**. They are an order-of-magnitude guide only, not a .NET baseline:

| Case | Unity-Mono time |
|---|---|
| procedural cube, 2,000 quads | 1.7 s |
| `icosphere_320k` → 8,000 quads | 8.4 s |
| 1.5M-triangle photogrammetry scan → 5.5k faces | 12–17 s |

Browser expectations (**estimates, not measurements**; M0.5 replaces them): default .NET WASM *interprets* IL, which is
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

**M0 — Core compiles outside Unity (Linux, .NET 10).**
1. **Get the shim list from the compiler, not grep.** Compile `Runtime/` against an empty `UnityEngine`
   namespace and collect the CS0246 / CS0103 errors; that list is the exact shim needed. (grep already shows
   attributes `[Tooltip]`, `[Serializable]`, `[NonSerialized]`, and that `RemeshProfile` is a plain struct, but
   it cannot be trusted as a complete census.)
2. Trace what `NativeRemesherWindow*.cs` does around `Solve`: the static-knob block (~840–895), `Parts.cs`
   (the latest commit is about parts sewn into one surface), `QuadSource.cs`, and `Benchmark/EditorParity.cs`.
   Everything done outside `Runtime/` must be ported into a `WebRemesher` facade, or web output will not match Unity.
3. `sync/` script copies `Runtime/` (plus the `Benchmark/` files the gate needs: `MeshCorpus`, `MeshMetrics`,
   `BenchmarkRunner`) from the pinned commit into `core/src/`. Generated, never hand-edited.
4. `shim/`: `UnityEngine.Vector3`, `Mathf`, `Matrix4x4`, … **with Unity's semantics, not just names**:
   approximate `Vector3 ==`, `normalized` → zero for tiny vectors, `Mathf.Round` behavior, `UnityEngine.Random`
   (5 uses: check whether seeded, since a different sequence moves the baseline), the one
   `UnityEngine.Rendering` use. Implement from Unity's documented behavior; do not paste Unity reference
   source into this public repo. Check how `Mathf` computes (I believe it wraps `System.Math` in double
   precision and casts back to float, not `MathF`); this affects whether results stay inside the tolerance.
5. Adapter for the 13 files that use `Mesh` / `Material` / `Texture2D` (minimal array-backed shim or `#if`).
6. **Output contract = polygons, not triangle indices.** The result is quad-dominant with some triangles and
   n-gons. Use the same arrays the window hands to `FbxWriter.Write` (`extraction.positions`, `extraction.faces`):
   positions, face sizes, face indices. This keeps the quad wireframe and correct OBJ export, and avoids
   `BuildOutputMesh` and the `Mesh` shim on the output side. **Input contract:** positions, triangle indices,
   optional `triangleMaterials` (per-triangle material ID, needed by `materialBorders`) and optional `sourceUvs`;
   both already exist on `RemeshPipeline.Solve`.
7. CLI: OBJ in → remesh → OBJ out.
The `WebRemesher` facade must also **snapshot every static on `RemeshPipeline` at startup and restore it before
each `Solve`** (the window sets ~20 and `ApplyModelType` overwrites more, so a second remesh in the same
worker would otherwise inherit the first one's settings).
*Exit:* builds, and the procedural corpus lands within tolerance of `Benchmarks/baseline.csv`
(first confirm the baseline matches the pinned commit; a stale baseline fails M0 even if the port is right).
**This is the go/no-go for the whole project.**

**M0.5 — WASM spike, inside a Web Worker, before any UI work.**
`browser-wasm` + **AOT**, browser scheduler variant, one small procedural case.
Record: output equals M0 (counts + metrics), wall time **AOT vs. interpreter**, download size, peak memory.
**Speed factor = browser AOT vs. the M0 CoreCLR build, measured on the same machine in this container.**
Never compare against the Unity/Windows numbers: that mixes two machines and two runtimes.
Node alone does not prove the Worker path. *Exit:* a measured speed factor versus the M0 build. That number
replaces the estimates in Risk B and fixes the input-size cap.

**M1 — Browser host.** `[JSExport]` API with flat typed arrays (`Float32Array` positions, `Uint32Array`
indices, settings object), progress and cancel, Worker wrapper.
*Exit:* the corpus under WASM matches M0 within tolerance, **and** a Worker running case A, then B (different
model type), then A again reproduces a fresh A (guards the static-knob leak).

**M2 — Web app shell (core path).** Vite + TypeScript + three.js; the parameter panel is **generated from the
parameter manifest** (Section 6), never hand-written; before/after view with quad-edge wireframe;
progress/cancel; import and export through the format layer (Section 7) for at least OBJ and GLB first.
*Exit:* load → remesh → view → export in real Chromium (Playwright).

**M3 — Feature parity, one group at a time.** Each group starts by reading its window partial and writing a
short feature spec with a parity checklist, then is built, then gated by a parity test against the Unity result.
| Group | Source to read first | Notes |
|---|---|---|
| 3a Model types, symmetry, material borders, hard-surface / character / scan options | `NativeRemesherWindow.cs` | Mostly settings; falls out of the manifest |
| 3b Density paint ("Paint Fix Areas") | `NativeRemesherWindow.Paint.cs` (390), `DensityPaint`, `RemeshPaint` | three.js brush on raycast, painted weights passed to `densityPaint` |
| 3c Parts | `NativeRemesherWindow.Parts.cs` (941), `RibbonParts`, `PartBake`, `QuadSource.cs` | Needs a parts list UI and per-part runs |
| 3d LOD chain | `NativeRemesherWindow.Lods.cs` (1,070), `LodChain` | Multiple outputs; export as LOD set |
| 3e Texture, UV and normal-map bake | `TextureBake`, `AttributeTransfer`, window bake block | Heaviest in time and memory; image I/O in the browser; likely the first thing to push to the server host |
| 3f FBX, materials, textures round-trip | `FbxWriter`, importers | See Section 7 |
*Exit per group:* its parity test passes (same counts and metrics as Unity within tolerance).

**Goldens (needed before M3 gates can run).** Parity against Unity needs outputs produced *in Unity*: input arrays,
parameters and output per feature. This container cannot make them. Plan a small **Editor export script on the Unity
side** (writes input, parameters, result for each feature to a folder you push). Until goldens exist, parity means
CLI vs WASM plus the procedural baseline.

**M4 — Parity and CI.** Port the 120 tests to plain NUnit/xUnit; CI runs unit tests, the baseline gate,
the **drift checks** (Section 6) and Playwright on every push.

**M5 — Limits and the server decision.** Using M0.5/M1 measurements: set the input-size cap (reuse `PreDecimate`),
decide whether the server host ships (almost certainly needed for large scans and texture bake), and whether
threaded WASM is worth it (needs COOP/COEP headers, so not GitHub Pages).

**M6 — Deploy.** Hosting plus README; server host if M5 says so.

## 5. Scope: everything

**All Unity features are in scope:** model types, symmetry, material borders, density paint, parts, LOD chains,
texture / UV / normal-map bake, hard-surface / character / scan options, FBX export. M3 sequences them; none
is dropped. Import and export cover every format with a maintained library (Section 7).

## 6. Keeping the web version in step with the Unity asset

This is a design requirement, not a nicety.

**Two facts to settle first (your decisions):**
- **Where do Unity changes come from?** The sync can only follow a repo that Unity changes are pushed to.
  Today that is `RemesherDektop`, which belongs to the desktop session; its own plan proposes moving the code into
  `native/` and `reference/unity/`, which would make `Assets/NativeRemesher` disappear and turn the bot red
  permanently. And nothing reaches the web version until you push your local Unity changes somewhere.
  **Recommended:** one dedicated Unity repo that you push to, which both the desktop and web versions read from.
  If it is private, the bot needs a read token (a GitHub secret you add).
- **Move the window's orchestration into `Runtime/`** (Section 6, rule 5). Recommended default; see below.

Rules and machinery:

1. **Never edit synced code.** `core/src/` is generated from `RemesherDektop@UPSTREAM_SHA` by `sync/`, kept out of git
   (the same reasoning as their own `Headless/` mirror: two copies free to drift is worse than none). Only the
   one-line file `UPSTREAM_SHA` is committed. Everything web-specific lives in `shim/`, the facade and `patches/`.
2. **If the web build needs a source change,** it is a numbered `patches/*.patch` applied during sync. CI fails
   loudly the moment a patch no longer applies, so an upstream change can never be silently overwritten.
   The cleaner alternative is making the change upstream (e.g. an `#if` or a hook); that is your call.
3. **Nightly upgrade bot.** A scheduled GitHub Action fetches the upstream `main` (sparse, `Assets/NativeRemesher`
   only), and if it is newer than `UPSTREAM_SHA`: syncs, builds, runs the tests and baseline gate, and opens a PR
   titled with the commits it pulls in. Green means "merge and ship"; red names the new Unity API to shim or the
   knob to expose.
4. **Drift checks that fail the build** (so nothing upstream is ever missed silently):
   - **Shim coverage:** the compile against the shim must have zero CS0246/CS0103 errors.
   - **Static-knob census:** reflect over every public static on `RemeshPipeline` (and the other runtime
     statics the window sets) and compare with the parameter manifest. A new upstream knob not in the manifest
     fails CI.
   - **Settings census:** same for the fields of `RemeshSettings` and `RemeshProfile`.
   - **Baseline gate:** the web CLI output against upstream `Benchmarks/baseline.csv` at the new SHA.
   - **Window-change diff** (works today, no refactor needed): the bot diffs `Editor/**` between `UPSTREAM_SHA` and
     the new SHA. Any change labels the PR **"window orchestration changed, review facade"**. The static census
     cannot see Editor-side changes (new preprocessing, call order, a new feature path), so this label is how
     they are caught. M0 reads `Benchmark/EditorParity.cs`, which may already be a window-vs-pipeline harness to reuse.
5. **The parameter manifest** (`manifest.json`: name, type, range, default, tooltip, group, enabled-when) drives the
   UI and the facade. The window's controls (`m_*` fields, `[Tooltip]`s, `GUILayout` labels) are the source of
   truth. **Recommended default
   (needs your approval, a change in the Unity repo):** move the window's orchestration (the ~20-knob block,
   Parts at 941 lines, Lods at 1,070, the Paint and bake blocks) from `Editor/` into a `Runtime/` job/options API
   that the window calls. The **desktop app needs exactly the same thing**, so it is a shared change. Then there is
   one place to change, the web facade becomes a thin call, and the manifest is generated from it. **Without it,**
   most upstream feature changes need manual mirroring in the facade, guarded only by the censuses and the
   window-change diff above; for "all features" that is a lot of hand-work, so I do not recommend it.
6. **UI is re-implemented, not synced.** The Unity window is IMGUI (about 4,500 lines) and cannot be
   mechanically ported. The manifest keeps that re-implementation thin and checkable.

## 7. Import and export: every format

A **format layer** (`web/formats/`) converts any file to the core's input contract (positions, triangle indices,
optional `triangleMaterials` and `sourceUvs`, plus textures) and the polygon result back out.

| | Formats | How |
|---|---|---|
| **Import** | OBJ (+MTL), PLY, STL, GLB/glTF, FBX (ASCII and binary), DAE, 3MF, OFF, VRML/X3D, USD(Z), and more | three.js loaders for the common ones. **Assimp compiled to WASM** (BSD-licensed `assimpjs`-style) as the catch-all for the long tail (40+ formats). Pick per format in M2/M3f. |
| **Export** | OBJ, PLY, STL, GLB/glTF, FBX, DAE, USDZ | OBJ/PLY/FBX **keep quads** (FBX via the repo's own C# `FbxWriter`, which also keeps parity with Unity). STL and glTF are triangle-only formats, so those export triangulated and say so. Others via three.js exporters or Assimp. |

Honest limits: "any format" means every format a maintained library handles; proprietary CAD formats (STEP, Maya `.ma`,
Blender `.blend`, …) need a converter and are out unless you name them. Large FBX/scan files hit the same memory
ceiling as the remesher (M5). Each format gets a round-trip test (import → export → re-import, counts and bounds equal,
quads preserved where the format allows).

### Coordinates and import settings
Unity is left-handed, Y-up; three.js is right-handed. `FbxWriter` and `symmetry` (X/Y/Z) assume Unity coordinates.
**The core always works in Unity's convention.** Conversion happens only in the format layer, as an axis flip plus a
winding flip, on both import and export. Unity's own FBX import settings (scale, normals, vertex welding) shape what the
pipeline sees, so web-imported arrays will not exactly match Unity's for the same file; document the web importer's
welding and scale rules. Round-trip tests check winding and the mirror axis too.

## 8. Open items (unverified — do not assume)

1. **License.** Not checked: the repo has no LICENSE file, and the algorithm derives from Instant Meshes and
   QuadriFlow. Resolve before the site goes public.
2. **Public exposure.** `RemesherDektop` currently holds the whole Unity project and is public. Your call.
3. **Float parity.** Unity's `Mathf` vs .NET `Math`/`MathF` can differ in the last bits. Parity means the
   metric tolerance in `baseline.csv`, never bit-exact output.
4. **Static mutable knobs** leak between runs unless the facade snapshots and restores them (M0, tested in M1).
5. **Client vs. server and IP.** A browser-only build ships the remesher to every visitor in decompilable form. If this is commercial IP, that argues for the server host. Your call.
6. **Tier-2 corpus** (real scans) is not in the repo, so real-world parity is limited to what you can supply.

## 9. Repo layout

```
sync/    copies Runtime/ (+ needed Benchmark files) from RemesherDektop@UPSTREAM_SHA; read-only
patches/ numbered patches applied during sync (CI fails if one stops applying)
manifest/ parameter manifest + census tests
.github/ CI, nightly upstream-upgrade bot
shim/    UnityShim: Vector3, Mathf, Matrix4x4, ...
core/    generated src copy + adapters (+ browser BackgroundScheduler variant)
cli/     OBJ in, OBJ out; drives the parity gate
wasm/    browser-wasm AOT project + JSExport API
web/     Vite app, Web Worker, three.js, formats/ (import/export layer)
server/  optional .NET host (M4 decision)
tests/   ported unit tests, baseline gate, Playwright specs
```
