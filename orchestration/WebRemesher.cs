// The product path for ONE mesh, ported from upstream/Editor/NativeRemesherWindow.cs (commit 8766ead):
//   PrepareRun   lines 836-891  (settings, profile, the statics Solve reads)
//   RunSingle    lines 933-985  (Solve, then optional bakes)  -- bakes land in M3e
// Bakes, density paint, parts, LOD chains are NOT in this file yet (M3b-M3e).
// Differences from the window, on purpose: no Unity objects (arrays in, arrays out); QuadSource.Reorder is the importer's job
// (the format layer must hand quads in as two consecutive triangles).
using System;
using System.Collections.Generic;
using UnityEngine;

namespace NativeRemesher.Web
{
    public sealed class WebResult
    {
        public float[] positions;     // xyz per output vertex
        public int[] faceSizes;       // 3, 4 or more
        public int[] faceIndices;     // concatenated, by faceSizes
        public float[] uvs;           // 2 per output vertex, or null
        public int[] faceMaterials;   // per face, or null
        public int quadCount, triangleCount, ngonCount;
        public long totalMs, decimateMs, topologyMs, orientationMs, positionMs, extractionMs;
        internal QuadExtractionResult extraction;   // kept for the writers that want more than the flat arrays (FbxWriter: face UVs, normals)
        public string hash;           // FNV-1a over output bit patterns, for equality checks across hosts
    }

    public static class WebRemesher
    {
        static StaticsSnapshot s_Snapshot;
        /// <summary>Test hook only: the A/B/A negative control turns the restore off to prove the test can fail.</summary>
        public static bool DisableStaticsRestore;

        /// <summary>Call once at host startup, before any job: captures the pristine statics.</summary>
        public static void Init() { s_Snapshot ??= StaticsSnapshot.Capture(typeof(RemeshPipeline).Assembly); }

        public static WebResult Run(Vector3[] positions, int[] triangles, Vector2[] sourceUvs, int[] triangleMaterials,
                                    RemeshOptions o, Action<string, float> progress = null)
        {
            Init();
            if (!DisableStaticsRestore) s_Snapshot.Restore();                 // jobs must not inherit each other's statics
            var settings = Prepare(o, out var profile, out var autoProfile);
            // Solve's Parallel.For resolves its scheduler from TaskScheduler.Current, so the solve runs as a task on the inline
            // scheduler: parallelism 1 on one thread, and no thread-pool dependency in the single-threaded browser build.
            var task = new System.Threading.Tasks.Task<RemeshResult>(() =>
                RemeshPipeline.Solve(positions, triangles, settings, profile, progress, sourceUvs, autoProfile, triangleMaterials));
            task.RunSynchronously(new NativeRemesher.Host.InlineScheduler());
            return ToResult(task.GetAwaiter().GetResult());
        }

        /// <summary>NativeRemesherWindow.PrepareRun, lines 836-891.</summary>
        public static RemeshSettings Prepare(RemeshOptions o, out RemeshProfile profile, out bool autoProfile)
        {
            var settings = RemeshSettings.Default;
            settings.targetQuadCount = o.targetQuadCount;
            settings.symmetry = o.symmetry;
            settings.materialBorders = o.materialBorders;
            settings.modelType = o.modelType;

            profile = RemeshProfile.For(RemeshProfileKind.GameAsset);
            profile.extractor = RemeshExtractor.IntegerGrid;
            autoProfile = true;

            Extraction.IntegerGridMap.curvatureAlignment = 0f;
            Extraction.IntegerGridMap.curveNetwork = false;
            Extraction.IntegerGridMap.parametrization = true;
            Extraction.IntegerGridMap.parametrizationLayout = true;
            RemeshPipeline.detailQuads = false;
            RemeshPipeline.ribbonParts = o.characterStraps;
            RemeshPipeline.thicknessSizing = o.characterThinRows;
            RemeshPipeline.quadReductionCharacter = o.characterSourceLoops;
            RemeshPipeline.quadReductionHardSurface = o.hardSourceLoops;
            RemeshPipeline.hardSurfaceSparseCreases = o.hardDenseToNormalMap;
            RemeshPipeline.stripSizing = o.hardThinStrips;
            RemeshPipeline.hardSurfaceRods = o.hardRods;
            RemeshPipeline.hardSurfaceSimplify = o.hardMergeFlat;
            RemeshPipeline.hardSurfaceCleanLayout = o.hardEvenRows;
            RemeshPipeline.hardSurfaceRoundedCreases = o.hardAcrossRounding;
            RemeshPipeline.hardSurfaceFair = o.hardFlatPanels;
            RemeshPipeline.hardSurfaceSourceCreases = o.hardEdgesAtCount;
            RemeshPipeline.hardSurfaceSimplifyToCount = o.hardToCount;
            RemeshPipeline.hardSurfacePlateBlocks = o.hardPlateRows;
            RemeshPipeline.hardSurfaceRowsAtMergedCount = o.hardRowsAtMerged && !o.hardToCount;
            RemeshPipeline.kinematicGuides = o.roundParts;
            RemeshPipeline.kinematicRegionsHardSurface = o.hardShapeRegions;
            RemeshPipeline.kinematicRegionsScan = o.scanShapeRegions;
            Extraction.IntegerGridMap.curvesAddQuads = o.curvesAddQuads;
            Extraction.IntegerGridMap.curveDetail = o.curveDetail / 100f;
            Extraction.IntegerGridMap.longCreaseLoops = o.longCreaseLoops;
            return settings;
        }

        /// <summary>
        /// NativeRemesherWindow.SaveFbx (lines 725-746): written from the FACE LIST (quads stay quads), with the shading normals and per-corner UVs.
        /// FbxWriter is upstream Runtime code compiled unchanged; it takes a path, so the bytes go through a temp file (the browser's in-memory FS).
        /// </summary>
        public static byte[] ToFbx(WebResult r, string name)
        {
            var ex = r.extraction;
            var path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "nr_" + Guid.NewGuid().ToString("N") + ".fbx");
            try
            {
                FbxWriter.Write(path, ex.positions, ex.faces, ex.shadingNormals ?? ex.normals, string.IsNullOrEmpty(name) ? "mesh" : name,
                    FbxWriter.defaultUnitScale, ex.faceUvs);
                return System.IO.File.ReadAllBytes(path);
            }
            finally { try { System.IO.File.Delete(path); } catch { } }
        }

        static WebResult ToResult(RemeshResult solved)
        {
            // A turned (revolved) result has topology == null: read ONLY from extraction.
            var ex = solved.extraction;
            var r = new WebResult
            {
                extraction = ex,
                quadCount = ex.quadCount, triangleCount = ex.triangleCount, ngonCount = ex.ngonCount,
                totalMs = solved.totalMs, decimateMs = solved.decimateMs, topologyMs = solved.topologyMs,
                orientationMs = solved.orientationMs, positionMs = solved.positionMs, extractionMs = solved.extractionMs,
            };
            var n = ex.positions.Length;
            r.positions = new float[3 * n];
            for (var i = 0; i < n; i++) { r.positions[3 * i] = ex.positions[i].x; r.positions[3 * i + 1] = ex.positions[i].y; r.positions[3 * i + 2] = ex.positions[i].z; }
            var f = ex.faces; r.faceSizes = new int[f.Count];
            var total = 0; for (var i = 0; i < f.Count; i++) { r.faceSizes[i] = f[i].Length; total += f[i].Length; }
            r.faceIndices = new int[total]; var k = 0;
            for (var i = 0; i < f.Count; i++) for (var j = 0; j < f[i].Length; j++) r.faceIndices[k++] = f[i][j];
            if (ex.uvs != null && ex.uvs.Length == n) { r.uvs = new float[2 * n]; for (var i = 0; i < n; i++) { r.uvs[2 * i] = ex.uvs[i].x; r.uvs[2 * i + 1] = ex.uvs[i].y; } }
            r.faceMaterials = ex.faceMaterials;
            ulong h = 1469598103934665603UL;
            for (var i = 0; i < r.positions.Length; i++) { h ^= (uint)BitConverter.SingleToInt32Bits(r.positions[i]); h *= 1099511628211UL; }
            for (var i = 0; i < r.faceSizes.Length; i++) { h ^= (uint)r.faceSizes[i]; h *= 1099511628211UL; }
            for (var i = 0; i < r.faceIndices.Length; i++) { h ^= (uint)r.faceIndices[i]; h *= 1099511628211UL; }
            r.hash = h.ToString("x16");
            return r;
        }
    }
}
