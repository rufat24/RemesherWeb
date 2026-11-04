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

## Since that table was written (all tested; see the e2e scripts in `web/e2e/`)

* **Texture and normal-map bake** end to end: OBJ+MTL+PNG or GLB with textures in, baked maps out (PNG, ZIP with the model). Capped at 4096 in the browser (8192 runs the wasm heap out of memory); 1024 takes 2.4 s, 4096 16.6 s.
* **Models in parts**: each mesh remeshed on its own with one shared bake. The parts logic is **generated from the Unity window's source** by `tools/gen_web_parts.py`, so upstream changes flow in and CI flags a stale file.
* Window fields with no web meaning (`SaveAsAsset`, `QuadTopology`) are recorded as `notApplicable` in `census/window-fields-pending.json`.

## Not done yet (the honest list)

* **LOD chains** (`MakeLods`, `Lod*` options, `LodChain`), **bake layers** (smoothness / occlusion: `ReadLayers`/`SaveLayers`). `census/editor-members.json` lists what is still `pending:*`.
* FBX export of a model in parts is one merged mesh (OBJ keeps the parts as `o` groups).
* Formats: GLB/USD/STEP export, an exact FBX reader (three.js drops a triangle on near-degenerate quads).
* CI is written (`.github/workflows`) but I never saw it go green on GitHub.
* Speed: no threads (threaded AOT does not link in .NET 10.0.14), so big models are 1.5-2x slower than a desktop's inline run.

## Resuming on your machine (non-cloud Claude Code)

`upstream/` (a copy of the Unity C# sources) is **not in git** (decision D4), so after cloning:

```bash
git clone https://github.com/rufat24/RemesherWeb && cd RemesherWeb && git checkout claude/upbeat-pascal-8qb9qp
tools/sync-upstream.sh --from-path <your clone of RemesherDektop at commit 8766ead>   # or --from-lock with UPSTREAM_TOKEN
dotnet --version        # needs the .NET 10 SDK and the wasm-tools workload (dotnet workload install wasm-tools)
tools/check-all.sh      # builds the CLI, runs every drift check and the unit tests
scripts/build-wasm.sh   # the AOT browser build (about 10 minutes) into web/public/wasm
cd web && npm ci && npx vite build
node e2e/bake.cjs  "$PWD/dist" ../.github/fixtures/sphere5k.obj    # also e2e/parts.cjs, paint.cjs, fbx-roundtrip.cjs, run-formats.sh
```

Where things are: `orchestration/` (the product facade: `WebRemesher.cs`, `WebParts.cs`, `WebParts.Generated.cs`), `wasm/Host.cs` + `wasm/worker/`, `cli/Program.cs` (a command-line twin of every browser path), `web/src/` (UI, importers/exporters in `formats/`), `tools/` (drift checks and generators), `census/` (what is ported and what is pending).
The next job is LOD chains: port `NativeRemesherWindow.Lods.cs` the way parts were (generate the loop from upstream with a script like `tools/gen_web_parts.py` where possible), then mark the members ported in `census/editor-members.json`.

## Decisions I need from you (all in `PLAN.md` section 10)

1. **D3** Is a server acceptable for jobs the browser can not do (1M+ triangles, 8K bakes)? Without one those are simply refused.
2. **Run Unity's own benchmark once** on your machine (`BenchmarkRunner`) and send me `baseline.csv`. It tells me whether Unity's committed baseline is stale and whether the revolved-shape crash I found
   (`docs/findings.md` #1) happens in Unity too. Without it, "same as Unity" is proven only against the same C# on .NET, not against Unity itself.
3. **D2** May the window's orchestration (the ~1,000 lines in `NativeRemesherWindow.Parts.cs` / `Lods.cs`) move into `Runtime/` in the Unity repo? It makes every future Unity change to Parts/LODs automatic for the web. I did not touch that repo.
4. **D4** License and visibility of this repo (it contains a snapshot of the Unity code under `upstream/`, currently untracked).
5. A **`UPSTREAM_TOKEN`** secret on this GitHub repo (read access to `remesherdektop`), or CI cannot fetch the Unity sources.
