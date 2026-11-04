# RemesherWeb — Plan (provisional)

Goal: a browser version of the **native remesher** from the Unity plugin `Quadremesh`
(`C:\Users\user\UnityProjects\Quadremesh`). Only the native remesher is in scope; the
plugin's C# remeshing paths and Unity-specific editor code are not.

> **Status: provisional.** At the time of writing, no source was reachable from this
> session (`rufat24/RemesherWeb` and `rufat24/RemesherDektop` are both empty, and the
> Unity folder is only on the local Windows machine). Everything marked
> **Unknown / needs source** must be confirmed in Step 0 before milestones are
> committed to. Nothing below names an algorithm, dependency or parameter on a guess.

## Step 0 — Get the source and take inventory (blocker)

Need, pushed to a side branch of this repo (or pasted):
1. The native C++ source directory plus its build files (`CMakeLists.txt` / `*.vcxproj`).
2. The C# wrapper containing the `[DllImport]` declarations, and the inspector/settings
   class that holds the remesher parameters.
3. One or two small test meshes (OBJ/PLY) that you consider "typical" input.

Inventory checklist (each answer goes into the table below):

| Question | Answer |
|---|---|
| Is source available, or only a prebuilt `.dll`? (binary-only blocks a WASM port) | Unknown / needs source |
| Exported C API surface (function names, structs, mesh in/out arrays) | Unknown / needs source |
| User-facing parameters (names, types, ranges, defaults) | Unknown / needs source |
| Algorithm family and any upstream project it derives from | Unknown / needs source |
| License of the native code and any third-party code | Unknown / needs source |
| Dependencies (Eigen, TBB, OpenMP, Boost, GPU compute, Windows-only APIs) | Unknown / needs source |
| Multi-threaded? Does it need threads to be usable at realistic mesh sizes? | Unknown / needs source |
| Typical and worst-case input size (faces) | Unknown / needs source |
| Does it produce quads only, or quad-dominant with tris? Output topology guarantees | Unknown / needs source |

## Milestones

**M0 — Native baseline on Linux.** Build the native code with CMake and a small CLI
harness: mesh in → remeshed mesh out. This becomes the reference for all later
comparisons and surfaces build problems before Emscripten is involved.

**M1 — Single-threaded WASM build.** Emscripten build exposing the same C API
(or a thin wrapper over it). Flat typed-array in/out, no Unity types.

**M2 — Web app shell.**
- Run the WASM module inside a Web Worker so the UI stays responsive; progress
  and cancel messages if the native code supports them (Unknown).
- three.js viewer (orbit, wireframe overlay to show quad topology).
- Mesh import (OBJ/PLY/GLB, exact list TBD).
- Parameter panel mirroring the Unity inspector (controls derived from Step 0).

**M3 — Export and correctness.** Export remeshed mesh (format list TBD). Golden test:
WASM output vs. native CLI output on the same inputs and parameters (exact match or a
defined tolerance — decide once determinism of the native code is known).

**M4 — Performance and threads.** Measure before optimizing. If threading is needed,
WASM pthreads require cross-origin isolation (COOP/COEP headers), which GitHub Pages
cannot set — this constrains hosting (see open decisions).

**M5 — Deploy.** Static hosting plus CI that builds the WASM and runs the golden test.

## Open decisions

- **Hosting** (depends on M4): GitHub Pages (simple, no threads) vs. a host that can set
  COOP/COEP (Cloudflare Pages, Netlify, Vercel) for threaded WASM.
- **Frontend stack**: plain TypeScript + Vite + three.js is the default proposal; revisit
  if the parameter panel grows large.
- **Public release**: gated on the license answer from Step 0, since this repo is public.
- **Large meshes**: whether to cap input size or add a decimate-then-remesh path.
- **Fallback if source is binary-only**: re-implement or wrap an open-source remesher
  with equivalent behavior — a different, larger project; needs a separate decision.

## Repo layout (proposal, finalize after Step 0)

```
native/        C++ sources + CMakeLists (copied from Quadremesh, native remesher only)
native/cli/    Linux CLI harness (M0)
wasm/          Emscripten build config + exported-API wrapper (M1)
web/           Vite app: viewer, worker, UI (M2)
tests/         Golden meshes and comparison scripts (M3)
```
