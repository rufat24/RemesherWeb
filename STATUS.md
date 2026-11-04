# RemesherWeb: where it stands

Branch `claude/upbeat-pascal-8qb9qp`. The web version of the **NativeRemesher** (Unity repo `rufat24/remesherdektop`, commit `8766ead`).
Plan: `PLAN.md`. Measurements and surprises: `docs/findings.md`, `docs/measurements.md`.

## What works today (each line has a test or a measurement behind it)

| | |
|---|---|
| The Unity C# core runs **unchanged** in the browser | .NET WebAssembly (AOT) in a Web Worker; no server. 80k-triangle model in about 7 s, 320k in about 46 s |
| It gives the same answers as the original code on a desktop runtime | same polygons on every case tried; vertices bit-identical on 4 of 6, the others within 0.1 of a quad edge (the maths library differs) |
| The window's single-mesh settings | model type, symmetry, material borders, quad count, curve detail, every Character / Hard Surface / Scan option. The labels, tooltips, defaults and enable rules are **generated from the Unity window source** |
| Density paint | brush on the model, more/less detail/erase, Shift/Ctrl/Alt as in Unity; measured about 3x the vertices under the brush |
| Import | OBJ, GLB/GLTF, STL, PLY, FBX. All five tried on one mesh give the same quad count through the real UI |
| Export | **FBX written by Unity's own `FbxWriter`** (quads, UVs, normals), OBJ, PLY, OFF (quads kept), STL (triangles) |
| Changes to the Unity asset are detected | a new/changed window field, a changed default, label or enable rule, a changed `PrepareRun`, any changed or new window method, a changed Runtime API reference. 16 checks in `tools/test-drift.sh` prove each detector fires on a deliberately drifted copy and stays quiet on the real source (`tools/test-drift.sh`) |

## Not done yet (the honest list)

* **Parts** (a model in several pieces, "combine parts", hidden-parts-fewer), **LOD chains**, **texture / UV / normal-map bake**: the algorithms are in Unity's `Runtime/`
  (`PartBake`, `LodChain`, `TextureBake` compile unchanged); what is left is the glue the window does (reading textures, per-part loop, LOD loop) and the UI.
  `census/editor-members.json` lists the 43 window methods that still have to be ported, grouped by feature.
* Import/export formats still missing: GLB/USD/STEP export, an exact FBX reader (three.js drops a triangle on near-degenerate quads), textures and materials through the formats.
* CI is written (`.github/workflows`) but has not run to completion on GitHub yet.
* Speed: no threads (threaded AOT does not link in .NET 10.0.14), so big models are 1.5-2x slower than a desktop's inline run.

## Decisions I need from you (all in `PLAN.md` section 10)

1. **D3** Is a server acceptable for jobs the browser can not do (1M+ triangles, 8K bakes)? Without one those are simply refused.
2. **Run Unity's own benchmark once** on your machine (`BenchmarkRunner`) and send me `baseline.csv`. It tells me whether Unity's committed baseline is stale and whether the revolved-shape crash I found
   (`docs/findings.md` #1) happens in Unity too. Without it, "same as Unity" is proven only against the same C# on .NET, not against Unity itself.
3. **D2** May the window's orchestration (the ~1,000 lines in `NativeRemesherWindow.Parts.cs` / `Lods.cs`) move into `Runtime/` in the Unity repo? It makes every future Unity change to Parts/LODs automatic for the web. I did not touch that repo.
4. **D4** License and visibility of this repo (it contains a snapshot of the Unity code under `upstream/`, currently untracked).
5. A **`UPSTREAM_TOKEN`** secret on this GitHub repo (read access to `remesherdektop`), or CI cannot fetch the Unity sources.
