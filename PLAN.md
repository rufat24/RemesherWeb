# RemesherWeb: the plan (v4)

Goal: the **NativeRemesher** quad remesher from the user's Unity project "Quadremesh" (Unity 6000.0.58f2), running in
a web browser, with every feature of its Unity window, importing and exporting real files, and built so that later
Unity changes are cheap to carry over and are **detected automatically** when they are not.

Conventions in this document:
- `[src X:N]` cites the read-only clone `/home/user/rufat24/remesherdektop` (repo `rufat24/RemesherDektop`, commit
  `8766ead`). `NR/` stands for `Assets/NativeRemesher/` in that clone.
- **UNVERIFIED** marks anything not checked by reading the source or by running something. Every UNVERIFIED item
  is listed in section 12 with the experiment that settles it.
- That clone is never modified. Files meant for the Unity side are written in this repo under `unity-side/`, and
  the user copies them in.

---

## Status (updated after M0, M0b, G0)

| Milestone | State | Evidence |
|---|---|---|
| M0.1 toolchain | **Done** | `docs/toolchain.md` (.NET 10.0.114 + wasm-tools, both install here) |
| M0.2 snapshot | **Done** | `tools/sync-upstream.sh`, `verify-upstream.sh`, `upstream.lock` (8766ead). `upstream/` is **untracked** until decision D4 (public repo, license) |
| M0.3 shim | **Done** | `shim/`: core, bench and 251 upstream tests compile **unchanged** |
| M0.4 bench | **Done** | upstream `BenchmarkRunner` runs unchanged via `bench/`; found that it throws on turned shapes (`docs/findings.md`) |
| M0c experiments | **Done** | deterministic across processes and thread counts; chaotic at the last bit vs Unity (`docs/measurements.md`); **249/251 upstream tests pass** |
| M0b WASM spike | **Done** | core runs in .NET WASM in Node **and a Chromium Web Worker**, bit-identical to CoreCLR |
| **G0** | **Decided: browser-only is viable** | AOT is 1.1-1.8x single-thread CoreCLR after a profiled fix (one assembly + inlining; first measurement was 7x); 320k-tri case 46 s; threaded AOT does not build but is not needed |

**Parity policy decided (M0c):** regress against the web-native baseline `baselines/coreclr-net10-8766ead-procedural.csv` (exactly reproducible; WASM equals it bit for bit
on the cases tried). The Unity `baseline.csv` cannot be a 2% gate (E3c/E4); Unity goldens are judged per column over bands (needs decision D7).

**Next:** M1 (browser host API and Worker protocol). The server host is optional (D3), not planned.

---

## 0. Summary

1. **Architecture.** The C# core is compiled **unchanged, from source**, against a small `UnityEngine` shim we
   write. It runs as .NET WebAssembly (AOT) inside a Web Worker. The same projects also build for CoreCLR
   (CLI and tests), which gives a reference to compare against.
   - Nothing is translated to TypeScript.
   - A server host exists only as a contingency, triggered by measurements (G0) or by the user's IP decision.
2. **The window is a second engine.**
   - By my estimate, about 1,000 of the 4,150 lines in the Editor partials are algorithm, not UI. Examples: the parts budget
     and fallbacks [src NR/Editor/NativeRemesherWindow.Parts.cs:35-548] and the LOD chains
     [src NR/Editor/NativeRemesherWindow.Lods.cs:215-383, 704-950].
   - The remaining ~3,150 lines are IMGUI, scene and asset plumbing.
   - Feature parity therefore needs either (a) an upstream refactor that moves that logic into `Runtime/`
     (recommended; decision D2), or (b) a port in this repo whose every source method is pinned by a hash,
     so CI fails when Unity changes it.
3. **Go/no-go comes first and is measured.** G0 settles four questions before any UI work:
   - Does the core compile untouched?
   - Does `Parallel.For` work on single-threaded WASM?
   - How fast and how big is the WASM build?
   - Does the pipeline reproduce the Unity baseline at all (it may be chaotic across runtimes)?
4. **Parity is measured in layers.**
   - Algorithm: arrays recorded in Unity, fed to the web core.
   - Importer: web-imported arrays compared with Unity-imported arrays.
   - End to end.
   - This keeps importer drift and algorithm drift apart.
5. **Drift detection is mechanical**, through five CI checks:
   - compile (shim coverage)
   - the upstream unit tests
   - the corpus gate
   - a reflection census of the roughly 636 mutable statics
   - Roslyn fingerprints of every Editor method, plus UI strings and defaults

---

## 1. What the source is: facts that shape the plan

| # | Fact | Evidence |
|---|---|---|
| F1 | `Runtime/` is pure C#: about 100 files and about 56.8k lines. The asmdef references nothing. No unsafe code, Burst, Jobs or DllImport. | [src NR/Runtime/NativeRemesher.Runtime.asmdef], grep |
| F2 | The Unity value types used are `Vector2/3/4`, `Vector2Int/3Int`, `Quaternion` (1 file), `Matrix4x4` (2), `Bounds` (5), `Ray` (3), `Color32` (2), `Mathf`, `Debug` (3 files), `MeshTopology`, and `UnityEngine.Rendering.IndexFormat`. The attributes used are `Tooltip`, `Header`, `AddComponentMenu` and `DisallowMultipleComponent`. **No `UnityEngine.Random`.** All randomness is `new System.Random(seed)`, seeded. The tests also use only seeded `System.Random` [src NR/Tests/LatticeTests.cs:129]. | grep; [src NR/Runtime/Revolution.cs:387], [OrientationField.cs:188], [Extraction/IntegerGrid/IntegerGridMap.cs:1254], [SpatialGrid.cs:552] |
| F3 | Engine objects in Runtime are only these: <br>• `Mesh` in convenience overloads: `RemeshTopology.Build/ReadMesh` [src NR/Runtime/RemeshTopology.cs:202-280], `PreDecimate.Decimate(Mesh)` [PreDecimate.cs:569], `QuadExtractor.ToMesh` [QuadExtractor.cs:1469], `RemeshPipeline.Run(Mesh)`, `BuildOutputMesh` [RemeshPipeline.cs:1007,2469], `FbxWriter.Write(Mesh)` [FbxWriter.cs:133], and the field `RemeshResult.mesh` [RemeshPipeline.cs:140]. <br>• Two MonoBehaviours, `RemeshPaint` and `RemeshSource`. <br>**The solve path itself takes arrays only.** | grep and read |
| F4 | Entry point: `RemeshPipeline.Solve(positions, triangles, settings, profile, onProgress, sourceUvs, autoSelectProfile, triangleMaterials)`. Bakes are separate calls: `BakeTexture` and `BakeNormalMap`. | [src NR/Runtime/RemeshPipeline.cs:1057,1066,2371,2399] |
| F5 | **Mutable global state is large.** About 636 `public/internal static <type> lowerCase` fields sit in 40 Runtime files: 147 in `RemeshPipeline`, 77 in `IntegerGridMap`, 13 in `PartBake`, and so on. The Editor partials add more: `bakeLayers` [Window.cs:1281], seven parts tunables [Parts.cs:591-609], and the `lod*` ones. There are also `[ThreadStatic]` fields [RemeshPipeline.cs:490,731]. The count comes from a grep heuristic; the census in M2 gives the exact number. | grep |
| F6 | `PrepareRun` [src Window.cs:850-897] does all of the following: <br>• seeds `RemeshProfile.For(GameAsset)` with `extractor = IntegerGrid` and `autoProfile = true` <br>• sets 4 `IntegerGridMap` method statics and `RemeshPipeline.detailQuads = false` <br>• sets 18 `RemeshPipeline` type statics and 3 `IntegerGridMap` quad statics <br>`ApplyModelType` then swaps the profile per type [RemeshPipeline.cs:3447-3466]. | read |
| F7 | **The LOD chain runs the whole window pipeline again for each level.** It mutates the window's own fields (`m_TargetQuadCount`, `m_TextureSize`, `m_CurvesAddQuads`) and `PartBake.quadsPerPiece`, starts the job asynchronously, and restores them in a `finally` block right after the job starts [src Lods.cs:782-804]. A value read by the worker after that restore sees the old value. In `RunParts`, `PartBake.Floor` reads `quadsPerPiece` on the main thread before the job starts [Parts.cs:101]. Whether any later read happens on the worker is UNVERIFIED. This is exactly the hazard globals create. | read |
| F8 | **Parts is algorithm.** `RunParts` [src Parts.cs:35-548] does all of the following: <br>• reads every part's arrays and texture slots <br>• decides "sewn" parts with `AllSewn` [:671] and joins them, or joins all of them under Combine Parts <br>• weights by visibility with `PartBake.Visibility` <br>• applies thin floors and a floor share, then `SplitTarget` <br>• detects turned parts with `Revolution.Find` and `FindPieces` <br>• runs `QuadReduction.ReduceParts` <br>• reuses twin parts via `SameShape` and `Moved` <br>• picks collapse, thin, strip or remesh branches, with retries at 4x and 3x and a `CellsOff` check <br>• bakes texel scales and the shared `PartBake.Bake` <br>Glass is detected by render queue, URP `_Surface`, or a name containing "glass" or "window" [Parts.cs:926-939]. | read |
| F9 | **There are two LOD modes.** <br>• (a) Remeshed levels: the window pipeline runs again per level with the count exact. Afterwards, error and switch heights are computed against the base, including visibility and the option to fall back to "reduced when closer" [Lods.cs:704-950]. <br>• (b) Reduced levels: `LodChain.Build` per part, `SwitchHeights`, and an optional rebake per level through `PartBake.Bake` [Lods.cs:215-383]. <br>The output is a `LODGroup`, and parts below a pixel size are dropped per level. | read |
| F10 | **Texture inputs come from Unity material slots.** The main texture, normal maps from `_BumpMap` or `_NormalMap`, and "layers" (every other 2D texture slot except main, normal and detail) carry an sRGB flag taken from `TextureImporter` and a fallback colour. <br>Pixels are read from the PNG or JPG file at full size, or through a render target for other formats, unpacking packed normal maps. <br>Auto bake size is `NextPowerOfTwo(largest source)`, clamped to 1024..8192, or 4096 when there is no texture. | [src Window.cs:1199-1579, 1494-1503] |
| F11 | **QuadSource.** Unity's importer splits quads apart. `QuadSource.Reorder` re-imports a temporary copy with Keep Quads, so that every source quad's two triangles become consecutive. "Clean quads keep their own loops" (`QuadReduction`) depends on this. `RemeshTopology.ReadMesh` also expands `MeshTopology.Quads` submeshes as (q0,q1,q2)(q0,q2,q3). | [src NR/Editor/QuadSource.cs:1-13,34]; [RemeshTopology.cs:256-270] |
| F12 | **What `FbxWriter` writes.** It writes **ASCII** FBX 7.4 containing one mesh: positions, polygon faces (quads and n-gons kept), normals, and per-corner UVs. It writes no materials and no `faceMaterials`. It negates X and reverses corner order "from the first corner". UnitScale is 100. It writes to a path with `File.WriteAllText`. Its own header says **Blender cannot read it**. | [src NR/Runtime/FbxWriter.cs:20-48,90-129] |
| F13 | **What a Unity run delivers.** <br>• Single mesh: `<name>_Quads.asset` + `.fbx`, plus PNGs (`_Albedo`, `_Normal`, `_Occlusion`, `_<layer>`) and a `.mat`. <br>• Parts: a folder per run, holding a `.asset` + `.fbx` per part and shared textures. <br>• The scene gets the hierarchy, a `RemeshSource` link and an optional `LODGroup`. | [src Window.cs:725-784,1051-1191,1375-1740], [Parts.cs:749-920] |
| F14 | **Parallelism.** All 94 `Parallel.For` calls and the 1 `Parallel.ForEach` in Runtime pass `BackgroundScheduler.Options` (`TaskScheduler.Current`). The OS-thread `BackgroundScheduler` is constructed only by Editor code and tests. Shared state is integer `Interlocked` counters plus 7 `lock`s. The Editor's `BuildLods` uses `Parallel.ForEach` **without** that option [Lods.cs:316]. | grep [src NR/Runtime/BackgroundScheduler.cs] |
| F15 | **Quality gate.** <br>• `Benchmarks/baseline.csv` has 36 rows: 12 procedural meshes x {500, 2000, 8000}, profile GameAsset only, `gitSha = no-repo`. Its provenance is unknown. <br>• `CompareToBaseline` checks 2% relative on Higher/Lower columns with a 1e-6 floor, so a baseline 0 fails on any increase. `indexSum` is Exact. <br>• The gate exercises **none** of the window path: no model types, statics, parts, bake or LOD. | [src Benchmarks/baseline.csv], [NR/Benchmark/BenchmarkReport.cs:24-32,181,300-390] |
| F16 | `EditorParity` claims to run "byte for byte what NativeRemesherWindow does". It does not: it passes no `triangleSubmesh`, does no `QuadSource.Reorder`, and does not set PrepareRun's statics. It has drifted, so it cannot serve as the reference for the window path. | [src NR/Benchmark/EditorParity.cs:206-213] vs [Window.cs:843-896] |
| F17 | **Benchmark/ is Unity-bound.** `MeshCorpus` returns `Mesh` [MeshCorpus.cs:187,252] and uses `Application.dataPath` [:59]. `BenchmarkRunner` uses `UnityEditor` (`EditorApplication.Exit`, `AssetDatabase`) [BenchmarkRunner.cs:19,144,341]. `BenchmarkReport` uses `Application.unityVersion` [BenchmarkReport.cs:51]. | read |
| F18 | **Tests.** 38 test files with 250 `[Test]`/`[TestCase]` attributes. Headless/README reports 120 tests: 118 pass, 2 skipped. Six files use `new Mesh()` or `LogAssert`. `BackgroundSchedulerTests` needs real threads. | grep |
| F19 | **Licences.** Instant Meshes and QuadriFlow are **BSD-3** (per Benchmarks/README), and BSD-3 requires reproducing the notice when distributing binaries. The repo itself has no LICENSE file. | [src Benchmarks/README.md:390-400] |
| F20 | **Out of the NativeRemesher module.** The **Exoside QuadRemesher bridge** (a commercial engine and "the quality oracle") is outside it, as is `TestMeshSpawner`, which spawns procedural meshes. | [src README.md], [NR/Editor/TestMeshSpawner.cs] |
| F21 | **Clone and plan state.** The clone is **shallow, with 1 commit**. The desktop effort's `PLAN.md` in the clone (529 lines) is about algorithm work items W0-W5. It contains no move to `native/` or `reference/unity/`. On `main` at `8766ead` there is no move. A **different branch** of that repo, `claude/gracious-rubin-a2j7mz`, carries a Phase 0 intake `PLAN.md` that suggests `native/` and `reference/unity/` paths; it was written assuming a C++ DLL, before the code was known to be C#, and is not a restructure of `Assets/NativeRemesher`. The desktop effort could still reorganize later, which is why D1 recommends a dedicated upstream repo. | `git rev-parse --is-shallow-repository`, grep |
| F22 | Debug dumps write files through `System.IO.File`, gated by debug-path statics. They are harmless in WASM, where the virtual filesystem is in memory. | [src Parametrization/*.cs, IntegerGridMap.cs:216] |

---

## 2. Architecture decision

### 2.1 Options considered

| Option | For | Against | Verdict |
|---|---|---|---|
| **A. .NET WASM in a Web Worker, core compiled from upstream source** | Requirement 1 is literally met. No server cost, and user meshes never leave the machine. One source of truth for the algorithm, so a Unity change compiles in, which is requirement 4. | Single-threaded (unless .NET WASM threads work); speed and 32-bit memory are unknown; download size; code is exposed to visitors. | **Primary** |
| B. Server (.NET on Linux) with a thin web UI | Real threads and memory; the code stays private. | Hosting cost and operations, upload of possibly large or private assets, not offline. | **Contingency** only, if G0 measurements or decision D3 require it. The same `Core` library runs there unchanged. |
| C. Translate C# to TypeScript or Rust | Native web feel. | 57k lines plus every future change re-translated by hand, which defeats requirement 4. | **Rejected** |
| D. Compile the Editor partials too, against a fake `UnityEditor` | The orchestration would be reused verbatim. | Hundreds of IMGUI, Selection, Undo, AssetDatabase, TextureImporter and LODGroup APIs to fake. Behaviour is bound to scene selection. Fragile. | **Rejected**. Replaced by D2 (refactor) or by the fingerprinted port. |

### 2.2 Exactly how the core is shared

- `upstream/` is a **vendored, read-only snapshot** of `NR/{Runtime,Editor,Tests,Benchmark}/*.cs`, plus
  `Benchmarks/baseline.csv`, `Benchmarks/README.md` and `ProjectSettings/ProjectVersion.txt`.
  - `upstream.lock` records the repo URL, path prefix, SHA, and a SHA-256 over the copied tree.
  - CI recomputes that hash, so any hand edit fails.
  - It is committed, unlike the earlier draft's gitignored copy, because then:
    - a bot PR shows the actual upstream C# diff, which is what a reviewer or agent needs in order to replicate it;
    - builds are hermetic;
    - the web app keeps building if upstream moves or disappears.
- `core/NativeRemesher.Core.csproj` uses
  `<Compile Include="../upstream/Runtime/**/*.cs" Exclude="../upstream/Runtime/RemeshPaint.cs;../upstream/Runtime/RemeshSource.cs" />`
  and references `shim/`.
  - The exclude list is explicit and small, so a new MonoBehaviour upstream fails the build loudly instead of
    being silently shimmed.
  - Target: `net10.0` (pinned if the WASM workload works on 10; otherwise `net8.0` for the spike, UNVERIFIED).
- `shim/UnityShim.csproj` defines the `UnityEngine` namespace, the `UnityEngine.Rendering` namespace, and
  `[Tooltip]`, `[Header]`, `[AddComponentMenu]` and `[DisallowMultipleComponent]`.
  - It covers value types with Unity semantics (section 2.4), a functional array-backed `Mesh` (needed by the
    tests, the corpus and the `Mesh` overloads), `Debug` with a pluggable sink, `Application`
    (`unityVersion`, `dataPath`, `isBatchMode`), and `LogAssert`/`LogType` for the tests.
  - It is written from Unity's public documentation. **UnityCsReference source is never copied**; its licence
    forbids that.
- **Patches**: zero by policy. If one is ever unavoidable, it goes in `patches/NNNN-*.patch`, applied by the sync
  script; CI fails when a patch stops applying.
- **Orchestration**: `orchestration/` holds the port of the window's non-UI logic, the "WebRemesher" facade.
  - If D2 happens upstream, this shrinks to a thin adapter over the new `Runtime/` API.
- **Hosts**: `wasm/` (browser-wasm, AOT, `[JSExport]`), `cli/` (CoreCLR: remesh, bench, census, golden compare),
  and `tests/` (NUnit over `upstream/Tests`).

### 2.3 Running the core in a browser without threads

1. **Scheduler.** Each job runs inside `task.RunSynchronously(new InlineScheduler())`:
   - `MaximumConcurrencyLevel = 1`
   - `QueueTask` executes the task inline, and `TryExecuteTaskInline` must return `TryExecuteTask(task)`. If it
     returned false, `RunSynchronously` would fall back to queue-and-wait, which blocks a single-threaded worker.
   - inside the job, `TaskScheduler.Current` (and so `BackgroundScheduler.Options`, F14) is that scheduler
   - every `Parallel.For` then has an effective degree of parallelism of 1, runs on the calling thread, and never
     blocks on a monitor
   - UNVERIFIED; this is the first experiment, E1
   - The fallback is .NET WASM multithreading (needs COOP/COEP headers), then a server.
2. **One Web Worker per job.**
   - Cancel means `worker.terminate()`, because a synchronous solve cannot read a cancel message.
   - A fresh worker also guarantees no static state leaks between jobs; one pre-warmed spare hides boot time.
   - Progress: the `onProgress` callback calls a `[JSImport]` that `postMessage`s, throttled to about 10 Hz.
3. **Statics.** Inside a job (parts and LOD chains intentionally mutate statics), `StaticsSnapshot` captures every
   non-readonly static field of the core and orchestration assemblies by reflection at worker start, and restores
   it before each job.
   - The restore is shallow, so it does not reset reference-type statics that get appended to, such as the locked
     debug lists [src NR/Runtime/PreDecimate.cs:1226], [RibbonParts.cs:338,1484]. The census (M2.1) flags every
     mutable reference-type static.
   - The CLI and tests therefore isolate jobs with a collectible `AssemblyLoadContext` per job, which gives fresh
     statics by construction. The browser keeps one worker per job.
   - IL trimming must not remove those fields: mark `Core` as a `TrimmerRootAssembly`, or disable trimming for it.
4. **Memory.** wasm32 caps the heap at 2-4 GB (UNVERIFIED for .NET's configured maximum). One 8192² `Color32[]` is
   256 MiB, and an 8K bake holds several: albedo, normal, occlusion, layers, plus the decoded sources.
   - The browser default bake cap is 4096 until E5 measures 8192.
   - Input size is capped by the existing `PreDecimate` (the pipeline already pre-decimates scans).
5. **Files.** The core writes to the in-memory Emscripten filesystem; for example, `FbxWriter.Write("/out/x.fbx", …)`,
   then `File.ReadAllBytes`. So no upstream change is needed for FBX output.

### 2.4 Shim semantics that affect results (each gets a unit test)

**`Mathf`**
- Each function computes in double and casts to float: `(float)Math.Sqrt((double)f)`, and the same for
  `Sin`, `Cos`, `Atan2`, `Acos` and `Pow`. Check this against Unity's documented behaviour; UNVERIFIED.
- `RoundToInt` rounds half to even, like `Math.Round`.
- `FloorToInt` and `CeilToInt` are casts of Floor and Ceil.
- `Approximately` follows Unity's documented formula.
- `Lerp` clamps; `LerpUnclamped` does not.
- `Clamp01`, `SmoothStep`, `InverseLerp`, `DeltaAngle`.
- `PI = 3.14159274f`, plus `Deg2Rad` and `Rad2Deg`.
- `Mathf.Epsilon` is not used by Runtime; check with grep.

**`Vector3`**
- `normalized` and `Normalize()` return zero when the magnitude is at most `kEpsilon` (1e-5)
  [src NR/Runtime/MeshMath.cs:3 comment].
- `operator==` is approximate (squared distance below about 1e-10).
- `Equals` and `GetHashCode` are exact and component-based. Hashes matter for `Dictionary<Vector3,…>` keys.
- `Angle`, `Distance`, `Lerp` (clamped), `Min`, `Max`, `Cross`, `Dot`, `Project`…: implement exactly what the
  compiler asks for.

**`Mesh` shim**
- Property getters (`vertices`, `triangles`, `uv`, `normals`…) return **copies**, as Unity's do, so code
  that writes into a returned array does not mutate the mesh.

**Other types**
- `Vector2Int` and `Vector3Int` need hash and equality, because they are used as keys.
- `Matrix4x4` needs `MultiplyPoint3x4`, `determinant`, `inverse`, `GetColumn` and `TRS`, whichever the compiler
  demands.
- `Bounds` needs `Encapsulate`, `size` and `center`.

**Known source of non-bit-exactness:** the transcendental functions in .NET on Linux, in Mono on Windows and in
Emscripten's libm can differ in the last bit. E3 and E4 quantify what that does to a chaotic pipeline.

---

## 3. Milestones

Each step is sized for one PR by a cloud agent. "Exit" lines are the acceptance tests.

### M0: bootstrap and compile (startable now)

- **0.1 Toolchain.**
  - `apt install dotnet-sdk-10.0`, then `dotnet workload install wasm-tools`.
  - If the .NET 10 workload fails, use `dotnet-sdk-8.0`, which is known to work here. That is for the spike only:
    .NET 8 support ends around now, so moving to 10 is mandatory before ship. Record which one is in use.
  - Write the versions to `docs/toolchain.md`.
  - *Exit:* `dotnet --info` and `dotnet workload list` show wasm-tools.
- **0.2 Snapshot.**
  - `tools/sync-upstream.sh --from-path /home/user/rufat24/remesherdektop` (it also accepts `--repo URL --ref REF`).
  - It fills `upstream/` (only `*.cs`, no `.meta`), writes `upstream.lock`, and provides `tools/verify-upstream.sh`.
  - *Exit:* `verify-upstream.sh` passes, and editing any file under `upstream/` makes it fail.
- **0.3 Shim from compiler errors.**
  - Build `core/` against an empty shim, collect the CS0246/CS0103/CS0117 errors, and implement exactly those
    members with section 2.4 semantics.
  - Then do the same for `bench/` and `tests/`.
  - *Exit:* `dotnet build` builds `core`, `bench` and `tests` with 0 errors and no file under `upstream/` changed.
    `shim/README.md` lists every member with the doc page it was implemented from.
- **0.4 Bench runner (`bench/`).**
  - Compile `upstream/Benchmark/{MeshCorpus,MeshMetrics,PolyMesh,BenchmarkReport,FieldDiagnostics,IntegerGridAudit,ObjReader,ObjWriter}.cs`;
    the compiler decides the exact set.
  - First try compiling `BenchmarkRunner.cs` **unchanged**, against a bench-only `UnityEditor` stub built from
    compiler errors (`EditorApplication.Exit`, `AssetDatabase.*` returning null, `MenuItem`), and calling its
    `RunFromCommandLine` (F17). Then upstream runner changes flow in automatically.
  - Only if that stub turns out large, write `cli bench` mirroring `BenchmarkRunner.RunOne` (cite the lines), and
    add `upstream/Benchmark/BenchmarkRunner.cs` members to the fingerprint census so a runner change fails CI.
  - Either way, add `--threads N|inline`.
  - *Exit:* `cli bench --corpus procedural --targets 500,2000,8000 --baseline upstream/Benchmarks/baseline.csv`
    produces a 36-row CSV with the same header.

### M0b: WASM smoke test (after 0.3; runs in parallel with M0c)

- A `browser-wasm` AOT project with one `[JSExport] RunCase(name, target)`, run in a module Worker, driven by
  Playwright in Chromium.
- Cases: `cube_subdivided@2000`, `icosphere_80k@2000`, `icosphere_320k@8000`.
- Record:
  - wall time for AOT, the interpreter, and CoreCLR `--threads inline` on the same container
  - worker boot time
  - `dotnet.wasm` and total download size (brotli)
  - peak `WebAssembly.Memory` size
  - whether the output equals CoreCLR inline: same face count and same `MeshMetrics` row
- *Exit:* `docs/measurements.md` with these numbers. This settles experiments E1 and E2.

### M0c: determinism and baseline experiment (after 0.4)

| Run | Compares | Answers |
|---|---|---|
| E3a | CoreCLR threaded, two **separate processes** | Is the pipeline deterministic under threads? CoreCLR randomises string and `HashCode` hashing per process (Mono probably does not; UNVERIFIED), so a single process would hide that source. If rows move, grep Runtime for hash-ordered iteration. |
| E3b | `--threads inline` vs threaded | Does the scheduler change results? |
| E3c | Inline vs `baseline.csv` | Does the 2% gate pass cross-runtime? |
| E4 | A shim variant whose `Mathf` uses `MathF` (float) | How chaotic is the pipeline under last-bit changes (rows moved, by how much)? |

- Also run `tests/` (all upstream tests). The "120: 118 pass, 2 skipped" figure is stale ("at the time of
  writing", while 250 `[Test]`/`[TestCase]` attributes exist). The Unity count at the pinned SHA comes from the
  user's one-time run.
- Classify every failure as a shim bug, a threads-only test (`BackgroundSchedulerTests`), or a genuine runtime
  difference. **Zero unclassified failures** is the exit condition.
- *Exit:* `docs/measurements.md` gains:
  - a table per experiment
  - test results, every failure classified
  - a proposed **parity policy**, one of:
    - (i) "Unity baseline, 2%", if E3c passes;
    - (ii) "web-native baseline for regressions, plus Unity goldens judged on per-column bands averaged over
      several targets", if E3c fails with movement comparable to E4;
    - (iii) "find the nondeterminism", if E3a or E3b move.

### G0: go/no-go (a decision point, not code)

The inputs are M0b and M0c. Proposed thresholds are for the user to confirm in D5:

| Outcome | Decision |
|---|---|
| WASM AOT is at most 5x slower than CoreCLR-inline, and `icosphere_320k@8000` finishes in at most 3 min | Browser-only. |
| Slower than that | Measure .NET WASM threads (E6). If still too slow, use the hybrid: browser for small and medium inputs, server for heavy jobs and bakes. |
| `Parallel.For` cannot run (E1) | Use threads or the server. Do not patch upstream. |

Write the decision into this plan.

### M1: web host core path

- **1.1 `wasm/` API.**
  - Flat typed arrays in: `Float32Array` positions, `Int32Array` triangles, optional UV `Float32Array`,
    optional `Int32Array` `triangleSubmesh`.
  - JSON options in.
  - Polygon result out: positions, `faceSizes`, `faceIndices`, `faceUvs`, `faceMaterials`, `normals`, and baked
    RGBA buffers.
  - Plus the Worker protocol (`start`, `progress`, `result`, `error`), cancel via terminate, and
    `StaticsSnapshot`.
- **1.2** `cli remesh in.obj out.obj` and `cli remesh-arrays` (the same JSON+bin format as the worker), so every
  browser result has a CoreCLR twin.
- *Exit:*
  - Playwright: the browser output for 5 corpus cases equals the CLI output under the G0 parity policy.
  - The sequence A, B (a different model type), A gives the same result for A both times, which guards the
    static leak. It must run **in one worker or process**: a fresh worker per job makes it trivially true.

### M2: drift machinery (before features, so features cannot outrun it)

- **2.1 Statics census.**
  - `cli census statics` lists, by reflection, every mutable static in `Core`, `bench` and `orchestration`: name,
    type and default value, written to `census/statics.json`.
  - `census/statics-classes.json` classifies each one as `ui` (a window control sets it), `window-set` (the window
    sets a fixed value), `internal` or `debug`.
- **2.2 Editor fingerprints.**
  - `tools/census` (Roslyn, `Microsoft.CodeAnalysis.CSharp`) hashes every member of
    `upstream/Editor/NativeRemesherWindow*.cs` and `QuadSource.cs` after normalising: comments and whitespace
    stripped, tokens joined.
  - Results go to `census/editor-members.json`, each member with `status: ported:<web symbol> | ui-only | n/a:<reason>`.
- **2.3 UI census.**
  - The same tool extracts every `[SerializeField] m_*` field (type, initializer), every
    `GUIContent(label, tooltip)` literal and the field it is assigned to, `Toolbar`, `IntPopup` and `Slider`
    options and ranges, and `DisabledScope` conditions (as text).
  - Results go to `census/ui.json`, which the web UI imports for its labels, tooltips, ranges and defaults.
- **2.4 Lints.**
  - Every `Parallel.*` in `upstream/Runtime` passes `BackgroundScheduler.Options`, because a new one without it
    would use the thread pool in WASM.
  - No new MonoBehaviour or `UnityEditor` usage in Runtime.
- **2.5 CI (`.github/workflows/ci.yml`).** Fails on any of:
  - `verify-upstream` fails
  - the build fails
  - the tests fail
  - the bench gate fails under the parity policy
  - census changes not yet classified or ported
  - Playwright smoke fails
- **2.6 Upgrade bot (`.github/workflows/upstream.yml`).**
  - Runs nightly and on manual dispatch.
  - Runs `sync-upstream.sh --repo $UPSTREAM_REPO --ref $UPSTREAM_REF`, then everything from 2.5.
  - Opens or updates a PR titled `upstream <old>..<new>`. The body holds:
    - the commit list
    - a diffstat of `upstream/`
    - the census diffs: new or removed statics and changed defaults; changed Editor members with their diff; UI
      label, tooltip and default changes
    - a checklist of the web symbols to re-port
  - Needs the secret `UPSTREAM_TOKEN` if upstream is private. That is a user action.
- *Exit:* a mutation test script (`tools/test-drift.sh`) applies 5 synthetic upstream edits to a scratch copy, and
  CI fails on each, naming the cause:
  1. a static default changed
  2. a new `RemeshPipeline` static
  3. a tooltip changed
  4. a line changed inside `RunParts`
  5. a new `Parallel.For` without options

### M3: single-mesh window path, end to end

- **3.1 Options.** `orchestration/WindowOptions.cs` is a record holding every window `m_*` field with the same
  defaults, generated from or checked against `census/ui.json`, plus `Apply()`, a port of `PrepareRun` [Window.cs:850-897].
- **3.2 Single run.** `RunSingle` is a port of `RunSingle`'s worker body [Window.cs:903-981]:
  - solve, `BakeTexture` with layers, `BakeNormalMap` with detail maps
  - `TextureSizeFor` [:1494]
  - the status text from `FinishJob` [:1161-1189]
  - the warning when feature detection looks suspect [:555-561]
  - "Last Run Details" (`extraction.ToString()`)
- **3.3 Importer v1.** All three produce the **importer contract** (section 5.1):
  - OBJ+MTL with our own parser
  - glTF/GLB via `@gltf-transform/core`
  - FBX via **ufbx** compiled to WASM
- **3.4 Exporter v1.**
  - The upstream `FbxWriter` (ASCII, quads kept): the same writer as Unity. Compare semantically by parsing,
    not byte for byte, because float formatting can differ between Mono and CoreCLR.
  - OBJ+MTL with polygons
  - GLB, triangulated with materials
  - PNG maps, and a zip that mirrors Unity's output files (F13)
- **3.5 UI v1.**
  - Vite + TypeScript + three.js, with no framework requirement.
  - Sections 1-6 as in Unity [Window.cs:136-160]: Model, How Many Quads, Edge Loops, Fix Areas, Result, LODs.
  - Labels and tooltips come from `census/ui.json`.
  - Before and after view with a quad wireframe drawn from `faceSizes` (not triangles).
  - Progress, cancel, and sample meshes from `MeshCorpus` (the stand-in for `TestMeshSpawner`).
- *Exit:* Playwright loads `samples/cube_quads.fbx`, remeshes it at 500 with Hard Surface, downloads the zip, and
  re-imports the FBX with ufbx. The face-size histogram equals the extraction's, and the signed volume has the same
  sign as the input's.

### M4: goldens (needs the user once; code can be written before that)

- **4.1 Unity-side exporter.** `unity-side/Editor/NativeRemesherWebGoldens.cs` adds a menu item, "Tools/Native
  Remesher/Export Web Goldens". It reads `WebGoldens/scenarios.json`; each scenario is an asset path, a selection
  path and window field overrides. For each scenario it:
  - opens the real window
  - sets its private fields by reflection; a field missing by reflection is itself a drift signal and is reported
  - sets `Selection`, calls `RunPipeline` and waits on `EditorApplication.update`
  - copies the output folder: `.fbx` per part, PNGs
  - **also dumps the inputs exactly as Unity read them**: per part, `ReadMesh` + `QuadSource.Reorder` arrays,
    `toModel`, material slots with texture property names, sRGB and pixel SHA-256, plus the window fields, the
    full statics snapshot, the upstream SHA and the Unity version
  - Written without Unity available, so it is UNVERIFIED until the user runs it.
- **4.2** `cli golden compare` covers three layers:
  - **(a) Algorithm:** feed Unity's input dump to the web core with Unity's options and statics, then compare
    with Unity's FBX faces: counts, valence histogram and `MeshMetrics` under the parity policy, plus exact
    branch decisions per part where logged.
  - **(b) Importer:** the web importer on the original file vs Unity's input dump: same vertex and triangle
    counts, positions within 1e-5 x the bounding diagonal, the same quad pairing, submesh ids, UV0 and transforms.
  - **(c) End to end.**
- *Exit:* compare passes on self-goldens produced by the CLI. When the user delivers Unity goldens, the results
  are recorded per feature.

### M5: feature groups

Each group: read its source, port it, add census entries, add a golden scenario, add a Playwright test.

| Group | Scope (see section 4 for the inventory) | Size |
|---|---|---|
| 5a | Model types and per-type toggles, quad settings, symmetry, material borders | S: mostly `WindowOptions` |
| 5b | Bakes: texture, normal map from source detail maps, occlusion, layers; Auto size; material mapping per format | M |
| 5c | Density paint: three.js brush, dabs, mirror, undo, saved with the project | M |
| 5d | **Parts**: scene hierarchy, selection rules, Combine, sewn, hidden-fewer, glass, the full `RunParts` port | **L** (~500 source lines of logic) |
| 5e | **LODs**: both modes, switch heights, per-level bake, export as LOD groups | **L** |
| 5f | Export completeness: hierarchy, per-part files, LOD naming, materials; binary FBX if D6 says yes | M |

### M6: format breadth

The section 5 table, one format per PR. Each gets a round-trip test and an importer-contract test.

### M7: limits, licences, deploy

- Input and bake caps from measurements.
- A third-party notices page: BSD-3 for Instant Meshes and QuadriFlow, plus every JS/WASM library.
- Hosting per D9. If threads are used, COOP/COEP headers are mandatory, which rules out plain GitHub Pages.
- Optional server host per G0 and D3.

---

## 4. Feature-parity inventory (the Unity window, item by item)

"Port" means logic in `orchestration/`, or a call into the upstream API if D2 is done. Every row gets a golden
scenario.

| Unity feature | Unity source | Web equivalent | Notes and risk |
|---|---|---|---|
| Model type: Auto, Character, Hard Surface, Scan, with notes | Window.cs:124-134, 219-252; `ApplyModelType` RemeshPipeline.cs:3447 | Segmented control, notes from the census | — |
| Per-type toggles (18) | Window.cs:31-49, 256-384, 874-891 | Generated from `ui.json`; `DisabledScope` rules ported (343, 349) | — |
| Quads count (min 4), Exact vs Curves add, curve detail 0-100 | Window.cs:387-414, 893-895 | Same | — |
| Long crease loops, material borders, symmetry Off/X/Y/Z | Window.cs:417-445 | Same | Symmetry plane is the "object's local origin when the mesh straddles it". Needs the importer's node-local space (section 5.2). |
| Combine parts; fewer quads on hidden parts | Window.cs:231-248; Parts.cs | Shown when the selection has more than one part | 5d |
| Fix Areas (density paint): More, Less, Erase; size 0.25-25%; strength 0.05-1; Shift, Ctrl, Esc; Clear; undo | Paint.cs:62-121, 281-390; DensityPaint.cs | three.js raycast brush (BVH), overlay colours, dabs in **source local space** (painting on the result is valid, because the result keeps the source's transform); undo stack | Mirrors through `DensityPaint` itself. The paint is stored in the web project file, since Unity keeps it on a component. |
| Bake texture; bake normal map; size Auto/1024-8192 | Window.cs:455-492, 903-976, 1199-1740 | Same options; the browser default cap is 4096 until E5 | Source normal maps fed as detail maps; layers with sRGB and fallback; occlusion map. |
| Save asset, "Quads in the Unity mesh" | Window.cs:493-507, 750-784 | Unity-only (`.asset`). The web gives the downloaded zip, plus an optional "export quads as polygons" in formats that allow it. | `.asset` is not applicable; stated in the UI. |
| Output material assignment (keywords, slots) | Window.cs:1102-1154, 1424-1442, 1636-1699 | Mapped to glTF PBR, MTL or FBX materials | Unity shader keywords have no web meaning. |
| Status line: type read, profile, decimation, bake stats, layout coverage; details foldout; suspect-crease warning | Window.cs:555-572, 1161-1189, 1455-1461 | Same text, from `RemeshResult` | — |
| "Remesh Again" on a selected result, hiding the old one | Window.cs:535-546, 929-930, 1087-1092 | Result history: re-run from the source with the current paint | — |
| Parts selection rules: active objects, enabled renderers, LOD0 only, skip results, readable | Window.cs:653-683 | Same rules over the imported node tree. glTF has no LOD groups (MSFT_lod aside); FBX LodGroup comes through ufbx (UNVERIFIED). | — |
| Parts pipeline (F8) | Parts.cs:35-548, 591-939 | Full port | 5d. Tunables are census-tracked. |
| Parts output: mirrored hierarchy, per-part results, shared bake | Parts.cs:749-920 | Hierarchy in GLB and FBX, plus per-part FBX in the zip | — |
| LOD section: remesh vs reduce, levels 1-6, Auto/by hand, keep 10-90%, pixel error 0.25-8, own textures, "after each remesh" | Lods.cs:19-26, 90-178 | Same | — |
| LOD remeshed chain (F7, F9a) | Lods.cs:631-950 | Port, with explicit per-level options instead of mutating the window fields | 5e. Unity's `quadsPerPiece` timing (F7) must be replicated as it actually behaves; verify with a golden. |
| LOD reduced (F9b) | Lods.cs:215-383, 410-510 | Port; `LodChain` is upstream Runtime | 5e |
| LODGroup output with switch heights | Lods.cs:410-510, 910-950 | FBX/GLB nodes `<name>_LOD0..n`. Unity builds a LODGroup on import from that suffix (UNVERIFIED for our writer), plus `lods.json` with switch heights. | — |
| Skinned meshes: the bind-pose mesh is remeshed; LODs say "not reduced yet" | Window.cs:643-644; Lods.cs:280-283 | Same: the bind pose is read and the output is static | No weight transfer upstream either. |
| QuadSource reorder | QuadSource.cs | **Importer contract** (section 5.1) | — |
| Read/Write-disabled meshes, LODGroup conflicts | Window.cs:627-632; Lods.cs:199-212 | Not applicable or the equivalent message | — |
| Sample meshes (TestMeshSpawner) | Editor/TestMeshSpawner.cs | "Samples" menu from `MeshCorpus` | — |
| Exoside QuadRemesher bridge | README.md | **Out of scope** (commercial engine); confirm in D8 | — |
| Benchmark and probe menus | Benchmark/* | `cli` only, not in the UI | — |

---

## 5. Formats: import and export

### 5.1 The importer contract (what every importer must hand the core)

The core sees exactly what Unity's `ReadMesh` + `QuadSource.Reorder` produce
[RemeshTopology.cs:243-280; QuadSource.cs]. Per mesh node, that is:

- `positions` in **Unity space**: left-handed, Y-up, metres, in the node's local space, with no welding beyond what
  Unity's importer does
- `triangles`, where **each source polygon is triangulated consecutively, quads as (0,1,2)(0,2,3)**
- `uv0`, index-parallel and unwelded
- `triangleSubmesh` (the material slot)
- per node, `toModel` as a 4x4 matrix relative to the selected root, the enabled flag and the LOD level
- per slot, a material:
  - `main`
  - `normal`
  - layers: `{property, image, sRGB, fallback}`
  - `transparent`
  - `name`

Images are decoded in the worker with `createImageBitmap(blob, {colorSpaceConversion:'none', premultiplyAlpha:'none'})`,
which corresponds to Unity's "read the file" branch [Window.cs:1522-1543]. Normal maps are read from file RGB, so no
unpacking is needed.

**Coordinates.** For each format the conversion into Unity space replicates Unity's own importer for that format:
X negated, the winding rule measured, scale and units applied.

- Export reverses it the way `FbxWriter` does: negate X, reverse corners from the first corner [FbxWriter.cs:31-48].
- This is settled by measurement through importer goldens (M4b), not by reasoning. Signed-volume checks guard the
  winding in every round-trip test.

### 5.2 Per format

| Format | Import (library, licence) | Polygons kept on import | Export | Polygons on export | Feasibility, notes |
|---|---|---|---|---|---|
| FBX binary and ASCII (6.x/7.x) | **ufbx** (C, MIT/PD) to WASM via emscripten | yes (polygons, materials, textures, hierarchy, LodGroup, units) | **Upstream `FbxWriter` (ASCII)** = Unity parity (semantic compare by parse); **binary writer** (our C#, D6) | yes | Binary FBX's footer is undocumented. Validate by reading back with ufbx and (if installable) Blender headless (UNVERIFIED). The ASCII output does not open in Blender (F12). |
| OBJ + MTL | own TS parser | yes | own writer | yes | `usemtl` gives slots; texture paths resolved from the uploaded files or a zip. |
| glTF 2.0 / GLB | `@gltf-transform/core` (MIT) + Draco/meshopt decoders | no (triangles only) | gltf-transform | no: triangulated, quad pairs consecutive | PBR materials map to slots: baseColor → main; normal; metallicRoughness, occlusion, emissive → layers (sRGB per spec). |
| PLY (ASCII and binary) | own parser | yes | own writer | yes | — |
| STL (ASCII and binary) | own or three.js `STLLoader` (MIT) | no | own writer | no | Weld on import as Unity would for STL (Unity cannot import STL natively, so no golden; document the rule). |
| OFF | own | yes | own | yes | — |
| DAE (Collada) | assimpjs (Assimp, BSD-3) | yes with `aiProcess_Triangulate` off (UNVERIFIED) | Assimp export | yes | — |
| 3DS, X, LWO, LWS, MD2/MD3/MD5, AC3D, B3D, IRR, DXF, IFC, SIB, SMD, MS3D, OGEX, CSM, Q3BSP… | assimpjs catch-all | varies | — | — | Import only, best effort. The format list is whatever the assimpjs build includes (UNVERIFIED). |
| 3MF | own (zip + XML) or Assimp | no | own | no | — |
| USD: USDA / USDZ | **TinyUSDZ** (Apache-2, WASM build exists, UNVERIFIED) | yes (`faceVertexCounts`) | own USDA writer; USDZ = uncompressed zip with 64-byte alignment | yes | USDC (binary crate) import depends on TinyUSDZ maturity. |
| STEP, IGES, BREP (CAD) | **occt-import-js** (OpenCascade, **LGPL-2.1**, lazy-loaded separate .wasm) | n/a (tessellated) | — | — | Import only. LGPL acceptability is D10. No UVs. |
| Alembic (.abc) | no maintained browser reader | — | — | — | **Not feasible in browser.** Server with Blender if wanted. |
| .blend | Assimp reads only old versions (UNVERIFIED) | — | — | — | **Not feasible** for modern Blender; ask the user to export FBX/glTF. |
| .max, .ma/.mb, .c4d, .ztl, .spp | closed formats, no readers | — | — | — | **Not feasible.** Stated in the UI with an "export as FBX/OBJ" hint. |
| Unity `.asset` / `.prefab` | — | — | possible (YAML mesh) but low value | — | **Not planned.** FBX goes into Unity directly. |
| Images: PNG, JPEG, WebP, AVIF, GIF, BMP | browser decode | — | PNG (fflate/UPNG.js or canvas) | — | Color-space handling per 5.1. |
| Images: TGA, DDS (BC1-7), KTX2, EXR/HDR, TIFF, PSD | three.js TGA/DDS/KTX2/EXR loaders (MIT), utif (MIT), ag-psd (MIT, flattened) | — | — | — | DDS/KTX2 need block decode to RGBA; EXR is tone-mapped to 8-bit for baking (a decision on HDR bakes is out of scope). |

**"Any format", honestly stated:**
- Everything in the table marked import or export works in the browser.
- CAD import works through LGPL OpenCascade, subject to D10.
- Closed DCC formats, modern `.blend` and Alembic do not.
- Each listed format ships only with a round-trip test (import, export, re-import: counts, bounds, signed volume,
  polygon sizes where the format allows) and an importer-contract test.

---

## 6. Keeping in step with Unity (requirement 4)

### 6.1 What the user must decide and change on the Unity side

- **D1: the canonical upstream.**
  - Today the only reachable source is `RemesherDektop@main`, which belongs to the desktop effort. Local Unity
    edits reach the web only once pushed there.
  - **Recommended:** move `Assets/NativeRemesher` into its own repo as a Unity package (UPM layout:
    `package.json`, `Runtime/`, `Editor/`, `Tests/`, asmdefs). The Unity project consumes it as an **embedded
    package via git submodule** (`Packages/com.<user>.nativeremesher`), so it stays editable in place, and both
    the desktop and the web efforts track that repo.
  - The web sync is configured by `UPSTREAM_REPO`, `UPSTREAM_REF` and `UPSTREAM_PATH` in `upstream.lock`, so
    either choice is a one-line change, as is a later restructure.
- **D2: the orchestration refactor (recommended).** Move the non-UI logic out of the window into `Runtime/`, keeping
  behaviour. The window then calls it. It would be measured by the existing tests and benchmark plus Unity goldens.
  1. `RemeshWindowOptions` (all `m_*` fields) and `Apply()`, the body of `PrepareRun`.
  2. `SingleRun.Run(input, options, progress)`, the body of `RunSingle`'s lambda plus `TextureSizeFor`.
  3. `PartsRun.Run(parts, options, progress)`, the body of `RunParts`'s lambda plus `AllSewn` and the 7 tunables.
  4. `LodRun.Build…` and `LodRun.Switch…`, from `BuildLods` and `EndLevelChain`'s maths, with per-level options
     passed explicitly instead of mutating fields (this fixes F7).
  5. Material inputs as plain data: `{slot → main/normal/layers, sRGB, transparent, name}`. `ReadTextures` and
     `ReadLayers`' index logic is pure and moves along with them.

  With D2:
  - the web `orchestration/` becomes a few hundred lines of adapters;
  - a Unity feature change becomes a recompile;
  - the Editor fingerprints only guard UI.
  - The desktop app needs the same thing.

  Without D2, the fingerprinted port works but costs hand-porting on every orchestration change.
- **D7: goldens.** Add `unity-side/Editor/NativeRemesherWebGoldens.cs` to the Unity project and run it after
  meaningful changes, or at least per release. Commit or upload the `WebGoldens/` output (section 7).
- **One-time:** run the Unity gate at the pinned commit (the Headless/README command), to confirm `baseline.csv`
  matches the code (its `gitSha` is `no-repo`, F15).

### 6.2 What happens automatically in this repo

Sections M2.1-2.6 describe the machinery. In short:

| Upstream change | Caught by | Action it forces |
|---|---|---|
| New Unity API used | compile (shim coverage) | Add a shim member with a semantics test. |
| Algorithm change in Runtime | Recompiled automatically; tests and gate run | None, unless the gate moves. Then update the web baseline per policy and note it in the PR. |
| New, removed or re-defaulted static | statics census | Classify it. If `ui` or `window-set`, update `WindowOptions` and the UI. |
| Window orchestration change (`RunParts`, `PrepareRun`, LOD code…) | Editor member fingerprint: **fails**, not a label | Re-port that member, then bump its hash in `editor-members.json`. |
| New or changed toggle, label, tooltip, range or default | UI census | New controls need a `ui-rules.ts` entry; text changes flow in automatically. |
| New `Parallel` call without options; new MonoBehaviour | lints | Report upstream, or shim. |
| Upstream restructure (paths moved) | sync fails | Edit `UPSTREAM_PATH` and the csproj globs. |

Agent playbook (to be written as `docs/upgrading.md` in M2): read the bot PR, then the failing census entries, then
the upstream diff of those members, port them, re-run, and bump the hashes.

---

## 7. Testing and goldens

| Layer | What | Where it runs | Oracle |
|---|---|---|---|
| Shim unit tests | Unity semantics of each shim member | CI | Unity docs; Unity-recorded values in the golden statics dump where useful |
| Upstream unit tests | all `upstream/Tests` compiled unchanged (NUnit) | CI, CoreCLR | Unity's result at the pinned SHA; every deviation classified |
| Corpus gate | 36 procedural rows | CI (CoreCLR) + nightly (browser) | parity policy from G0 |
| Browser equivalence | WASM vs CLI on the same inputs | CI (Playwright) | equal under the policy |
| Algorithm goldens | Unity input dump fed to the web core, compared with Unity output | CI once goldens exist | metrics bands, exact per-part branch, counts |
| Importer goldens | web import vs Unity's dumped arrays | CI | tolerances in M4.2(b) |
| Format round trips | per format | CI | counts, bounds, signed volume, polygon sizes |
| UI e2e | load, remesh, paint, parts, LOD, export | CI (Playwright) | golden zip structure |

**Golden storage.** Small procedural goldens go in the repo. Real assets (car, character, scan) can be hundreds of
MB and may be private. Store them as GitHub Release assets or LFS, per D7, and keep only hashes and metrics in the
repo.

---

## 8. Repo layout

```
upstream/              vendored read-only snapshot (Runtime, Editor, Tests, Benchmark *.cs; baseline.csv; README)
upstream.lock          repo, ref, path, sha, tree-sha256
patches/               empty by policy
shim/                  UnityEngine shim + its tests
core/                  csproj only: compiles upstream/Runtime + shim
orchestration/         WindowOptions, SingleRun, PartsRun, LodRun ports (or thin adapters after D2), StaticsSnapshot, InlineScheduler
bench/                 compiles the needed upstream/Benchmark files; cli bench runner
tests/                 NUnit project over upstream/Tests + shim tests + orchestration tests
cli/                   remesh, bench, census, golden compare
tools/                 sync-upstream.sh, verify-upstream.sh, census (Roslyn), test-drift.sh
census/                statics.json, statics-classes.json, editor-members.json, ui.json
wasm/                  browser-wasm AOT project, JSExport API
web/                   Vite + TS + three.js app, worker, formats/ (importers, exporters), paint, LOD view
unity-side/            files for the user to copy into Unity (goldens exporter; D2 proposal notes)
goldens/               small goldens + manifest of external ones
server/                only if G0 or D3 require it
docs/                  toolchain.md, measurements.md, upgrading.md, third-party notices
```

---

## 9. Risk register and the first experiment for each

| # | Risk | Likelihood / impact | First experiment (kills or confirms) |
|---|---|---|---|
| R1 | `Parallel.For` deadlocks or throws on single-threaded browser .NET | medium / high | **E1** (M0b): run one corpus case under `InlineScheduler` in a Worker. Fallback order: WASM threads (E6), then server. |
| R2 | WASM too slow (interpreter about 10x; AOT unknown) | medium / high | **E2** (M0b): 3 cases, AOT vs interpreter vs CoreCLR-inline, same container. |
| R3 | Results not reproducible across runtimes; the 2% gate cannot tell a bad port from noise (chaotic face-count probe [EditorParity.cs:112]; zero-valued baseline columns; Exact `indexSum`) | **high** / high | **E3a-c, E4** (M0c). The outcome selects the parity policy. |
| R4 | Memory: 8K bakes and 1.5M-triangle scans exceed the wasm32 heap | high / medium | **E5**: bake 4096 and 8192 on `sphere_bumpy` with synthetic 8K textures in the browser; record peak memory. Then set caps. |
| R5 | .NET 10 wasm-tools workload not installable here | low / medium | M0.1 itself. Fallback: .NET 8 (known to work); upgrade later. |
| R6 | The orchestration port diverges from the window silently | high without D2 / high | M2 fingerprints plus golden scenarios per branch (turned, strips, collapsed, retried, sewn, twin). D2 removes the risk at the root. |
| R7 | Web importers produce different arrays from Unity (welding, vertex order, units, winding) and so different results | high / medium | **E7**: one FBX and one OBJ through ufbx and our parser vs Unity's dump (needs D7). Before goldens: the FbxWriter round trip, compared with what upstream's own `FbxRoundTrip` asserts. |
| R8 | IL trimming removes statics or reflection targets; AOT size or boot time too large | medium / medium | Part of E2: record size and boot time; run the A/B/A test in the browser. |
| R9 | The upstream source becomes unreachable or restructured (desktop effort) | medium / high | D1. The sync config is one line; the vendored snapshot keeps the web building meanwhile. |
| R10 | Binary FBX writer incorrect (undocumented footer) | medium / low | Read back with ufbx; if Blender can be installed headless here, import there (UNVERIFIED). ASCII stays the parity format. |
| R11 | IP and licence: the code is public to every visitor; BSD-3 notices are required | certain / user's call | D3, D4. Notices page in M7. |
| R12 | Unity-side goldens script has bugs (cannot be run here) | high / low | Keep it small; it reports missing fields and logs; the user runs it once early (scenario: the procedural cube). |
| R13 | Unity behaviour that is a race (F7) gets "fixed" in the port and diverges | medium / low | A golden for the LOD chain on a parts model; replicate as measured; propose the upstream fix (D2.4). |
| R14 | Image decode differences (colour space, premultiply, EXIF orientation) change bakes | medium / low | Decode the same PNG and JPEG in the browser and compare with the pixel SHA from the Unity dump. |

---

## 10. Decisions only the user can make

| # | Decision | Recommendation |
|---|---|---|
| D1 | Canonical upstream: a dedicated package repo or `RemesherDektop@main` path | Dedicated package repo, used as a submodule by Unity |
| D2 | Move the window's orchestration into `Runtime/` (shared with the desktop effort) | **Yes**. It is the single biggest lever for requirement 4. |
| D3 | Browser-only, or a server is allowed (for IP, large scans, 8K bakes) | Browser-only unless G0 or IP say otherwise |
| D4 | Licence and visibility of this repo and of the shipped site (code is decompilable in the browser) | Decide before the public deploy |
| D5 | Accept the G0 thresholds and the parity policy | After M0c data |
| D6 | Go beyond Unity: binary FBX, materials and submeshes in FBX, hierarchy in one file | Yes for binary FBX (Blender cannot read ASCII) |
| D7 | Produce Unity goldens (run the exporter), which real assets may be used, and where they are stored | Procedural plus 3 real assets (car, character, scan), stored in Release assets |
| D8 | Exoside QuadRemesher bridge out of scope | Confirm out |
| D9 | Hosting (GitHub Pages cannot set COOP/COEP, so no WASM threads there) | Cloudflare Pages or Netlify if threads are needed |
| D10 | LGPL module (OpenCascade) for STEP/IGES import | Acceptable as a separate lazy-loaded .wasm; confirm |
| D11 | Default browser limits (input triangles, bake size) | Set from E2 and E5 |

---

## 11. What changed from the previous draft (v3) and why

1. **Orchestration is an engine, not ~20 knobs.** The draft treated Parts, LODs and bakes as UI groups. They hold
   about 1,000 lines of algorithm with their own statics (F5-F9). The plan now sizes them L, ports them under
   fingerprints, and makes the D2 refactor the central recommendation.
2. **Parity definition is an experiment, not an assumption.** The draft's "within 2% of baseline.csv" ignored
   five things: the run's chaos, multi-threaded vs single-threaded scheduling, cross-runtime libm, an
   untraceable baseline (`no-repo`), and a gate that never touches the window path (F15, F16). M0c settles this
   before anything is built on it.
3. **Drift checks fail instead of labelling.** These replace the "Editor changed" label:
   - per-member Roslyn fingerprints
   - a reflection census of all ~636 statics, not 20
   - a UI-strings census that feeds the UI
   - lints for `Parallel` options and MonoBehaviours
   - a mutation test that proves each check fires
4. **The browser runtime design is concrete.**
   - `InlineScheduler` keeps every `Parallel.For` on one thread without patching upstream.
   - Worker-per-job gives cancellation and clean statics.
   - The Emscripten filesystem lets `FbxWriter` work unchanged.
   - A functional `Mesh` shim is mandatory, because the corpus, the tests and the overloads need it.
   - `BenchmarkRunner` is replaced, since it needs `UnityEditor`.
5. **Formats are tied to Unity's input semantics.** That means the QuadSource quad-pairing contract, material slot
   and layer mapping, colour-space-correct decoding, and per-format coordinate rules verified by importer goldens.
   The plan also states honestly what Unity's FBX does not carry (materials, submeshes; ASCII only) and which
   formats are infeasible.

Smaller corrections:
- No `UnityEngine.Random` is used.
- The vendored snapshot is committed, with a hash check.
- The server is demoted to a measured contingency.
- The claim that desktop restructures into `native/` is not supported on `main`; it appears only as an intake layout on branch `claude/gracious-rubin-a2j7mz` (C++ premise). A future reorganization is possible, hence D1.
- The test count is stated precisely.
- Exoside and the sample meshes are scoped.

---

## 12. Unverified items (each with the step that settles it)

| Item | Settled by |
|---|---|
| `InlineScheduler` makes `Parallel.For` safe on single-threaded browser .NET | E1 |
| WASM AOT speed, size, boot time, memory | E2, E5 |
| .NET 10 wasm-tools workload installs here | M0.1 |
| .NET 8 end of support around Nov 2026 | Check Microsoft's lifecycle page in M0.1 |
| Pipeline determinism (threads vs inline, run to run, per-process hash randomisation) and cross-runtime gate pass | E3a-c, E4 |
| Whether Mono randomises string hashing per process | E3a |
| How large the bench-only `UnityEditor` stub must be | M0.4 |
| `baseline.csv` matches commit `8766ead` | User runs the Unity gate once |
| Exact Unity `Mathf` and `Vector3` numeric formulas (double vs float) | Shim tests vs documented behaviour; Unity-recorded values from goldens |
| Whether the LOD chain's worker reads `PartBake.quadsPerPiece` after the restore | Read `PartBake` call sites during the 5e port; Unity golden |
| ufbx axis/handedness options, LodGroup support; assimpjs format list and polygon preservation; TinyUSDZ WASM maturity; Blender availability for FBX validation | Spikes at the start of M3.3 and M6 per format |
| Unity creates a LODGroup from `_LODn`-named nodes in our FBX output | Unity golden (user) |
| The desktop effort's plans for restructuring the Unity code | Ask the user (D1) |
| `unity-side` goldens exporter works | User runs it (D7) |
| Number of mutable statics (636 is a grep heuristic) | M2.1 census |
