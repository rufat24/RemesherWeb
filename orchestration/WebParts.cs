// Models in parts, the hand-written half (the other half, WebParts.Generated.cs, is cut out of upstream/Editor/NativeRemesherWindow.Parts.cs by
// tools/gen_web_parts.py). What the window does with Unity objects is replaced here by arrays:
//   RunParts, the gathering before the job lambda (lines 40-125): one WebPart per mesh of the model, its arrays and texture indices; the part sits in the
//        root's space already (the importer applied the node transforms), so toModel is the identity and SameShape finds the copies by itself.
//   the Combine Parts / sewn-rim branch (lines 126-166): the whole model is ONE mesh in the root's space, which is exactly the single-mesh run.
//   FinishParts (lines 749-935): the result arrays merged into one mesh with the parts as groups (the OBJ writer emits them as `o` groups); the shared
//        texture and normal map come from the one bake of all parts. Parts that could not be remeshed come back as nulls: the caller keeps them as they were.
using System;
using System.Collections.Generic;
using UnityEngine;

namespace NativeRemesher.Web
{
    /// <summary>One mesh of the model: the part's own arrays (local vertex numbering), UVs, the slot per triangle and the textures per triangle.</summary>
    public sealed class WebPart
    {
        public string name;
        public Vector3[] positions;
        public int[] triangles;
        public Vector2[] uvs;                 // per vertex, or null
        public int[] triangleSlot;            // per triangle, the part's own material slot (0-based), or null
        public int[] slotKeys;                // per slot, the model-wide material id: equal ids are one material (copies must read the same ones)
        public bool seeThrough;               // NativeRemesherWindow.SeeThrough over this part's materials (every one glass-like), decided by the importer
        public int[] triangleTexture;         // per triangle, its image in BakeInput.colorImages (-1 none), or null
        public int[] triangleNormalMap;       // per triangle, its image in BakeInput.detailMaps (-1 none), or null
    }

    public sealed class PartsRun
    {
        public List<RemeshResult> results;
        public RemeshResult shared;           // the shared bake (its textures and stats), or null
        public float[] visibility;            // per part, how much of it can be seen; null when not measured
        public int[] targets;                 // per part, the quads it was asked for
    }

    /// <summary>The job state the lambda writes (upstream's m_JobStage / m_JobProgress): each write reaches the host's progress callback.</summary>
    public sealed class JobState
    {
        public Action<string, float> sink;
        string m_Stage = "Starting"; float m_Progress;
        public string stage { get => m_Stage; set { m_Stage = value; sink?.Invoke(m_Stage, m_Progress); } }
        public float progress { get => m_Progress; set { m_Progress = value; sink?.Invoke(m_Stage, m_Progress); } }
    }

    public sealed class PartsContext
    {
        public RemeshSettings settings; public RemeshProfile profile; public bool autoProfile;
        public List<PartBake.Part> inputs; public List<double> areas; public List<int> floors; public List<int> pieces; public List<bool> occludes;
        public List<int[]> materials; public List<int[]> submeshes; public List<Vector2[]> rawUvs; public List<DensityPaint> paints; public List<string> names;
        public bool hiddenFewer, bakeTexture, bakeNormals; public int bakeResolution;
        public TextureBake.Image[] imageArray, normalImageArray; public TextureBake.Layer[] layerArray;
        public JobState job; public System.Diagnostics.Stopwatch watch;
    }

    public sealed class WebPartsResult
    {
        public string[] names;
        public WebResult[] parts;             // per part; null where it could not be remeshed (kept as it was)
        public WebResult merged;              // all remeshed parts in one mesh (for the viewer, OBJ and FBX); null when none
        public int[] groupFaceStart;          // per part, its first face in merged (-1 for a kept part), and groupFaceCount its number of faces
        public int[] groupFaceCount;
        public string note;                   // the window's one-line summary of the run
        public string typeNote;               // what Auto read the parts as
    }

    public static partial class WebParts
    {
        /// <summary>
        /// RunParts. A model with one part, Combine Parts, or parts sewn along shared open rims runs as one mesh (the window's RunSingle path): the caller
        /// uses WebRemesher.Run for those; this returns null when it is not a parts run so the caller can do that.
        /// </summary>
        public static WebPartsResult Run(IList<WebPart> parts, RemeshOptions o, Action<string, float> progress = null, double[] dabs = null, BakeInput bake = null)
        {
            WebRemesher.Init();
            if (parts == null || parts.Count < 2 || o.combineParts) return null;
            WebRemesher.RestoreStatics();
            var settings = WebRemesher.Prepare(o, out var profile, out var autoProfile);
            var bakeTexture = o.bakeTexture; var bakeNormals = o.bakeNormalMap;
            var inputs = new List<PartBake.Part>(); var areas = new List<double>(); var materials = new List<int[]>(); var submeshes = new List<int[]>();
            var rawUvs = new List<Vector2[]>(); var paints = new List<DensityPaint>(); var floors = new List<int>(); var pieces = new List<int>();
            var occludes = new List<bool>(); var names = new List<string>();
            foreach (var part in parts)
            {
                var textures = bakeTexture && part.uvs != null ? part.triangleTexture : null;
                var detail = bakeNormals && part.uvs != null ? part.triangleNormalMap : null;
                // A part with a normal map and no texture still needs its UVs, its triangles reading no colour.
                if (textures == null && detail != null)
                {
                    textures = new int[part.triangles.Length / 3];
                    for (var t = 0; t < textures.Length; t++) textures[t] = -1;
                }
                var toModel = Matrix4x4.identity;
                inputs.Add(new PartBake.Part
                {
                    positions = part.positions, triangles = part.triangles, toModel = toModel,
                    uvs = textures != null ? part.uvs : null, triangleTexture = textures, triangleNormalMap = detail,
                });
                areas.Add(PartBake.Area(part.positions, part.triangles, toModel));
                pieces.Add(PartBake.Pieces(part.positions, part.triangles));
                floors.Add(PartBake.Floor(pieces[pieces.Count - 1], part.triangles.Length / 3));
                materials.Add(part.slotKeys ?? new int[0]);
                occludes.Add(!part.seeThrough);
                submeshes.Add(part.triangleSlot);
                rawUvs.Add(part.uvs);
                paints.Add(WebRemesher.PaintFrom(dabs));     // the dabs are in the model's space, the parts' own
                names.Add(part.name);
            }
            // Parts sewn rim to rim into one surface are remeshed as one: the caller's single-mesh path.
            if (sewnParts && inputs.Count > 1 && AllSewn(inputs)) return null;

            var colorImages = bakeTexture ? bake?.colorImages : null;
            var imageArray = colorImages ?? new TextureBake.Image[0];
            var normalImageArray = bakeNormals ? bake?.detailMaps ?? new TextureBake.Image[0] : new TextureBake.Image[0];
            var ctx = new PartsContext
            {
                settings = settings, profile = profile, autoProfile = autoProfile, inputs = inputs, areas = areas, floors = floors, pieces = pieces, occludes = occludes,
                materials = materials, submeshes = submeshes, rawUvs = rawUvs, paints = paints, names = names,
                hiddenFewer = o.hiddenPartsFewer, bakeTexture = bakeTexture, bakeNormals = bakeNormals,
                bakeResolution = WebRemesher.BakeResolution(o.textureSize, imageArray),
                imageArray = imageArray, normalImageArray = normalImageArray, layerArray = null,
                job = new JobState { sink = progress }, watch = System.Diagnostics.Stopwatch.StartNew(),
            };
            // The lambda runs as a task on the inline scheduler, so its Parallel.For resolves to it (TaskScheduler.Current) as in Run.
            var task = new System.Threading.Tasks.Task<PartsRun>(() => SolveParts(ctx));
            task.RunSynchronously(new NativeRemesher.Host.InlineScheduler());
            return Finish(task.GetAwaiter().GetResult(), parts, ctx);
        }

        /// <summary>
        /// The model as the importer hands it over (one mesh in the root's space; the parts are ranges of its triangles, which never share vertices with
        /// another part) cut into WebParts: each part's vertices renumbered from 0, its slots, UVs and texture indices sliced out.
        /// partRanges = firstTriangle, triangleCount per part. Null when the model is not in parts (fewer than two ranges).
        /// </summary>
        public static List<WebPart> Split(Vector3[] positions, int[] triangles, Vector2[] uvs, int[] triangleMaterials, int[] partRanges, string[] names, bool[] seeThrough, BakeInput bake)
        {
            if (partRanges == null || partRanges.Length < 4) return null;
            var list = new List<WebPart>();
            for (var p = 0; p < partRanges.Length / 2; p++)
            {
                int first = partRanges[2 * p], count = partRanges[2 * p + 1];
                var remap = new Dictionary<int, int>(); var pos = new List<Vector3>(); var uv = uvs != null ? new List<Vector2>() : null;
                var tri = new int[3 * count]; var slotOf = new Dictionary<int, int>(); var slotKeys = new List<int>(); var slot = triangleMaterials != null ? new int[count] : null;
                for (var t = 0; t < count; t++)
                {
                    for (var c = 0; c < 3; c++)
                    {
                        var v = triangles[3 * (first + t) + c];
                        if (!remap.TryGetValue(v, out var local)) { remap[v] = local = pos.Count; pos.Add(positions[v]); uv?.Add(uvs[v]); }
                        tri[3 * t + c] = local;
                    }
                    if (slot != null)
                    {
                        var g = triangleMaterials[first + t];
                        if (!slotOf.TryGetValue(g, out var l)) { slotOf[g] = l = slotKeys.Count; slotKeys.Add(g); }
                        slot[t] = l;
                    }
                }
                int[] Slice(int[] all) { if (all == null) return null; var r = new int[count]; Array.Copy(all, first, r, 0, count); return r; }
                list.Add(new WebPart
                {
                    name = names != null && p < names.Length ? names[p] : "part" + p, positions = pos.ToArray(), triangles = tri, uvs = uv?.ToArray(),
                    triangleSlot = slot, slotKeys = slot != null ? slotKeys.ToArray() : new[] { 0 }, seeThrough = seeThrough != null && p < seeThrough.Length && seeThrough[p],
                    triangleTexture = Slice(bake?.colorTriangleTexture),
                    triangleNormalMap = bake?.detailMaps != null && bake.detailMaps.Length > 0 ? Slice(bake.detailTriangleMap) ?? new int[count] : null,   // no per-triangle map: the first map for all
                });
            }
            return list;
        }

        /// <summary>FinishParts: the parts' meshes and the one shared bake, and the window's status lines.</summary>
        static WebPartsResult Finish(PartsRun run, IList<WebPart> parts, PartsContext ctx)
        {
            var n = parts.Count;
            var res = new WebPartsResult { names = new string[n], parts = new WebResult[n], groupFaceStart = new int[n], groupFaceCount = new int[n] };
            byte[] texture = WebRemesher.Rgba(run.shared?.bakedTexture), normalMap = WebRemesher.Rgba(run.shared?.bakedNormalMap);
            long faces = 0, quads = 0; var unchanged = new List<string>();
            for (var p = 0; p < n; p++)
            {
                res.names[p] = parts[p].name; res.groupFaceStart[p] = -1;
                var result = p < run.results.Count ? run.results[p] : null;
                if (result?.extraction == null) { unchanged.Add(parts[p].name); res.parts[p] = AsItWas(parts[p]); continue; }   // the window keeps the part's own mesh
                res.parts[p] = WebRemesher.ToResult(result);
                faces += result.extraction.faces.Count; quads += result.extraction.quadCount;
            }
            res.merged = Merge(res.parts, res.groupFaceStart, res.groupFaceCount);
            if (res.merged != null)
            {
                res.merged.bakedTexture = texture; res.merged.bakedTextureSize = run.shared?.bakedTextureSize ?? 0;
                res.merged.bakedNormalMap = normalMap; res.merged.bakedNormalMapSize = run.shared?.bakedNormalMapSize ?? 0;
            }
            var bakeNote = run.shared?.bakeStats != null
                ? $"\none shared {run.shared.bakeStats.resolution}px bake for all parts, {run.shared.bakeStats.charts} charts, {run.shared.bakeStats.fill:P0} used"
                : "";
            var keptNote = unchanged.Count > 0 ? $"\n{unchanged.Count} part(s) could not be remeshed and were kept as they were: {string.Join(", ", unchanged)}" : "";
            var types = new SortedDictionary<string, int>();
            foreach (var r in run.results)
            {
                if (r == null || r.modelType == ModelType.General) continue;
                var name = r.modelType.ToString();
                types[name] = types.TryGetValue(name, out var c) ? c + 1 : 1;
            }
            var typeList = new List<string>();
            foreach (var kv in types) typeList.Add($"{kv.Value} {kv.Key}");
            res.typeNote = typeList.Count > 0 ? "last run read the parts as " + string.Join(", ", typeList) : "";
            var hiddenNote = "";
            if (run.visibility != null)
            {
                var hidden = new List<string>();
                for (var p = 0; p < n && p < run.visibility.Length; p++)
                    if (run.visibility[p] < 0.2f) hidden.Add($"{parts[p].name} ({run.targets[p]})");
                if (hidden.Count > 0) hiddenNote = $"\nhidden parts, given fewer quads: {string.Join(", ", hidden)}";
            }
            res.note = $"{n} parts: {faces:N0} faces ({quads:N0} quads) in {ctx.watch.Elapsed.TotalSeconds:F1} s{bakeNote}{keptNote}{hiddenNote}";
            return res;
        }

        /// <summary>A part that could not be remeshed, kept as it was (the window puts its source mesh in the result): its triangles as faces.</summary>
        static WebResult AsItWas(WebPart part)
        {
            var n = part.positions.Length; var t = part.triangles.Length / 3;
            var ex = new QuadExtractionResult { positions = part.positions, uvs = part.uvs, quadCount = 0, triangleCount = t };
            var r = new WebResult { extraction = ex, triangleCount = t, positions = new float[3 * n], faceSizes = new int[t], faceIndices = (int[])part.triangles.Clone(), hash = "kept" };
            for (var i = 0; i < n; i++) { r.positions[3 * i] = part.positions[i].x; r.positions[3 * i + 1] = part.positions[i].y; r.positions[3 * i + 2] = part.positions[i].z; }
            for (var f = 0; f < t; f++) { r.faceSizes[f] = 3; ex.faces.Add(new[] { part.triangles[3 * f], part.triangles[3 * f + 1], part.triangles[3 * f + 2] }); }
            if (part.uvs != null) { r.uvs = new float[2 * n]; for (var i = 0; i < n; i++) { r.uvs[2 * i] = part.uvs[i].x; r.uvs[2 * i + 1] = part.uvs[i].y; } }
            if (part.triangleSlot != null) { r.faceMaterials = (int[])part.triangleSlot.Clone(); ex.faceMaterials = r.faceMaterials; }
            return r;
        }

        /// <summary>The remeshed parts in one mesh: vertices and faces appended, material slots offset so each part keeps its own, groups = the parts.</summary>
        static WebResult Merge(WebResult[] parts, int[] groupStart, int[] groupCount)
        {
            var vertexTotal = 0; var faceTotal = 0; var cornerTotal = 0; var any = false;
            foreach (var r in parts) if (r != null) { any = true; vertexTotal += r.positions.Length / 3; faceTotal += r.faceSizes.Length; cornerTotal += r.faceIndices.Length; }
            if (!any) return null;
            var m = new WebResult { positions = new float[3 * vertexTotal], faceSizes = new int[faceTotal], faceIndices = new int[cornerTotal] };
            var ex = new QuadExtractionResult { positions = new Vector3[vertexTotal], normals = new Vector3[vertexTotal] };
            var withUvs = false; var withCorner = false; var withMaterials = false;
            foreach (var r in parts) if (r != null) { withUvs |= r.uvs != null; withCorner |= r.cornerUvs != null; withMaterials |= r.faceMaterials != null; }
            if (withUvs) m.uvs = new float[2 * vertexTotal];
            if (withCorner) { m.cornerUvs = new float[2 * cornerTotal]; ex.faceUvs = new Vector2[faceTotal][]; }
            if (withMaterials) { m.faceMaterials = new int[faceTotal]; ex.faceMaterials = m.faceMaterials; }
            ex.uvs = withUvs ? new Vector2[vertexTotal] : null;
            var v0 = 0; var f0 = 0; var c0 = 0; var slot0 = 0;
            for (var p = 0; p < parts.Length; p++)
            {
                var r = parts[p]; if (r == null) continue;
                var vn = r.positions.Length / 3; var pex = r.extraction;
                Array.Copy(r.positions, 0, m.positions, 3 * v0, 3 * vn);
                var normals = pex.shadingNormals ?? pex.normals;
                for (var i = 0; i < vn; i++)
                {
                    ex.positions[v0 + i] = pex.positions[i];
                    ex.normals[v0 + i] = normals != null && i < normals.Length ? normals[i] : Vector3.zero;
                    if (withUvs && r.uvs != null) { m.uvs[2 * (v0 + i)] = r.uvs[2 * i]; m.uvs[2 * (v0 + i) + 1] = r.uvs[2 * i + 1]; ex.uvs[v0 + i] = new Vector2(r.uvs[2 * i], r.uvs[2 * i + 1]); }
                }
                for (var f = 0; f < r.faceSizes.Length; f++)
                {
                    m.faceSizes[f0 + f] = r.faceSizes[f];
                    var face = new int[pex.faces[f].Length];
                    for (var j = 0; j < face.Length; j++) face[j] = pex.faces[f][j] + v0;
                    ex.faces.Add(face);
                    if (withCorner) ex.faceUvs[f0 + f] = pex.faceUvs != null && f < pex.faceUvs.Length && pex.faceUvs[f] != null ? pex.faceUvs[f] : new Vector2[face.Length];
                    if (withMaterials) m.faceMaterials[f0 + f] = (r.faceMaterials != null ? r.faceMaterials[f] : 0) + slot0;
                }
                for (var k = 0; k < r.faceIndices.Length; k++) m.faceIndices[c0 + k] = r.faceIndices[k] + v0;
                if (withCorner && r.cornerUvs != null) Array.Copy(r.cornerUvs, 0, m.cornerUvs, 2 * c0, r.cornerUvs.Length);
                else if (withCorner) for (var f = 0; f < r.faceSizes.Length; f++) { /* a part without a bake keeps zero UVs */ }
                groupStart[p] = f0; groupCount[p] = r.faceSizes.Length;
                m.quadCount += r.quadCount; m.triangleCount += r.triangleCount; m.ngonCount += r.ngonCount; m.totalMs += r.totalMs;
                if (r.faceMaterials != null) { var max = 0; foreach (var s in r.faceMaterials) max = Math.Max(max, s); slot0 += max + 1; } else slot0 += 1;
                v0 += vn; f0 += r.faceSizes.Length; c0 += r.faceIndices.Length;
            }
            ex.quadCount = m.quadCount; ex.triangleCount = m.triangleCount; ex.ngonCount = m.ngonCount;
            m.extraction = ex;
            ulong h = 1469598103934665603UL;
            foreach (var r in parts) if (r != null) { var bytes = System.Text.Encoding.ASCII.GetBytes(r.hash); foreach (var b in bytes) { h ^= b; h *= 1099511628211UL; } }
            m.hash = h.ToString("x16");
            return m;
        }
    }
}
