using System;
using System.Collections.Generic;
using System.IO;
using NativeRemesher.Web;
using UnityEngine;
namespace NativeRemesher.Cli
{
    // cli case <name> <target> [inline]          measurement (CaseRunner)
    // cli remesh <in.obj> <out.obj> [optionsJson] the product path (WebRemesher), prints a JSON summary
    // cli aba <in.obj> <jsonA> <jsonB>            A, B, A in one process: both A hashes must be equal (statics isolation)
    public static class Program
    {
        static WebResult Run(string path, string json)
        {
            var mesh = NativeRemesher.Benchmark.ObjReader.Read(path);
            RemeshTopology.ReadMesh(mesh, out var positions, out var triangles, out var uvs, out var sub);
            if (Environment.GetEnvironmentVariable("CLI_UNITY_SPACE") == "1")   // what the web format layer does to a file (web/src/formats/unity-space.ts)
            {
                for (var i = 0; i < positions.Length; i++) positions[i] = new Vector3(-positions[i].x, positions[i].y, positions[i].z);
                for (var i = 0; i + 2 < triangles.Length; i += 3) (triangles[i + 1], triangles[i + 2]) = (triangles[i + 2], triangles[i + 1]);
            }
            double[] dabs = null;   // CLI_DABS="x,y,z,r,s;x,y,z,r,s" in the source's own (Unity) space, for paint parity tests
            var env = Environment.GetEnvironmentVariable("CLI_DABS");
            if (!string.IsNullOrEmpty(env)) { var l = new List<double>(); foreach (var d in env.Split(';')) foreach (var n in d.Split(',')) l.Add(double.Parse(n, System.Globalization.CultureInfo.InvariantCulture)); dabs = l.ToArray(); }
            return WebRemesher.Run(positions, triangles, uvs, sub, RemeshOptions.FromJson(json), null, dabs);
        }
        static string Summary(WebResult r) =>
            $"{{\"quads\":{r.quadCount},\"tris\":{r.triangleCount},\"ngons\":{r.ngonCount},\"verts\":{r.positions.Length / 3},\"hash\":\"{r.hash}\",\"totalMs\":{r.totalMs}}}";
        // An OBJ cut into parts at its `o` / `g` lines (what the web importer does): global vertices, triangles in file order, one range per group.
        static (Vector3[], int[], Vector2[], int[], string[]) ReadObjParts(string path)
        {
            var pos = new List<Vector3>(); var uv = new List<Vector2>(); var tri = new List<int>(); var ranges = new List<int>(); var names = new List<string>();
            var inv = System.Globalization.CultureInfo.InvariantCulture; var start = 0;
            void Close() { if (tri.Count / 3 > start) { ranges.Add(start); ranges.Add(tri.Count / 3 - start); } start = tri.Count / 3; }
            foreach (var line in File.ReadLines(path))
            {
                var t = line.Trim().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
                if (t.Length == 0) continue;
                if (t[0] == "v") pos.Add(new Vector3(float.Parse(t[1], inv), float.Parse(t[2], inv), float.Parse(t[3], inv)));
                else if (t[0] == "o" || t[0] == "g") { Close(); names.Add(t.Length > 1 ? t[1] : "part" + names.Count); }
                else if (t[0] == "f")
                {
                    var f = new int[t.Length - 1]; for (var i = 0; i < f.Length; i++) f[i] = int.Parse(t[i + 1].Split('/')[0]) - 1;
                    for (var k = 1; k + 1 < f.Length; k++) { tri.Add(f[0]); tri.Add(f[k]); tri.Add(f[k + 1]); }
                }
            }
            Close(); return (pos.ToArray(), tri.ToArray(), null, ranges.ToArray(), names.ToArray());
        }
        public static int Main(string[] a)
        {
            if (a.Length >= 3 && a[0] == "case")
            {
                Console.WriteLine(NativeRemesher.Host.CaseRunner.RunCase(a[1], int.Parse(a[2]), a.Length > 3 && a[3] == "inline"));
                return 0;
            }
            if (a.Length >= 3 && a[0] == "export-case")   // writes a corpus mesh as OBJ, for CLI/browser comparisons
            {
                var e = NativeRemesher.Benchmark.MeshCorpus.Procedural().Find(x => x.name == a[1]);
                if (e == null) { Console.Error.WriteLine("unknown case"); return 2; }
                var m = e.create(); var t = m.triangles; var faces = new List<int[]>();
                for (var i = 0; i + 2 < t.Length; i += 3) faces.Add(new[] { t[i], t[i + 1], t[i + 2] });
                NativeRemesher.Benchmark.ObjWriter.Write(a[2], m.vertices, faces, a[1]);
                return 0;
            }
            if (a.Length >= 3 && a[0] == "remesh")
            {
                var r = Run(a[1], a.Length > 3 ? a[3] : null);
                var pos = new Vector3[r.positions.Length / 3];
                for (var i = 0; i < pos.Length; i++) pos[i] = new Vector3(r.positions[3 * i], r.positions[3 * i + 1], r.positions[3 * i + 2]);
                var faces = new List<int[]>(); var k = 0;
                foreach (var n in r.faceSizes) { var f = new int[n]; Array.Copy(r.faceIndices, k, f, 0, n); k += n; faces.Add(f); }
                NativeRemesher.Benchmark.ObjWriter.Write(a[2], pos, faces, "remeshed");
                Console.WriteLine(Summary(r));
                return 0;
            }
            if (a.Length >= 3 && a[0] == "parts")    // cli parts in.obj out.obj [optionsJson]: the `o`/`g` groups of the OBJ are the model's parts
            {
                var (pos0, tri0, uv0, ranges, names) = ReadObjParts(a[1]);
                var o = RemeshOptions.FromJson(a.Length > 3 ? a[3] : null);
                var pr = WebParts.Run(WebParts.Split(pos0, tri0, uv0, null, ranges, names, null, null), o, null, null, null);
                if (pr == null) { Console.WriteLine("{\"parts\":false}"); return 3; }
                var m = pr.merged; var pos = new Vector3[m.positions.Length / 3];
                for (var i = 0; i < pos.Length; i++) pos[i] = new Vector3(m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]);
                var faces = new List<int[]>(); var k = 0;
                foreach (var n in m.faceSizes) { var f = new int[n]; Array.Copy(m.faceIndices, k, f, 0, n); k += n; faces.Add(f); }
                NativeRemesher.Benchmark.ObjWriter.Write(a[2], pos, faces, "remeshed");
                var perPart = new List<string>(); for (var p = 0; p < pr.names.Length; p++) perPart.Add($"{{\"name\":\"{pr.names[p]}\",\"faces\":{pr.groupFaceCount[p]}}}");
                Console.WriteLine($"{{\"parts\":true,\"quads\":{m.quadCount},\"tris\":{m.triangleCount},\"verts\":{pos.Length},\"hash\":\"{m.hash}\",\"perPart\":[{string.Join(",", perPart)}],\"note\":{System.Text.Json.JsonSerializer.Serialize(pr.note)}}}");
                return 0;
            }
            if (a.Length >= 3 && a[0] == "fbx")      // cli fbx in.obj out.fbx [optionsJson]
            {
                var r = Run(a[1], a.Length > 3 ? a[3] : null);
                System.IO.File.WriteAllBytes(a[2], WebRemesher.ToFbx(r, "remeshed")); Console.WriteLine(Summary(r)); return 0;
            }
            if (a.Length >= 4 && a[0] == "bake-test")   // cli bake-test <case> <size> <outprefix>: spherical UVs + checkerboard source, writes baked maps as PPM
            {
                var e = NativeRemesher.Benchmark.MeshCorpus.Procedural().Find(x => x.name == a[1]);
                var m = e.create(); var pos = m.vertices; var tri = m.triangles; var uv = new Vector2[pos.Length];
                for (var i = 0; i < pos.Length; i++) { var n = pos[i].normalized; uv[i] = new Vector2(0.5f + Mathf.Atan2(n.z, n.x) / (2f * Mathf.PI), 0.5f + Mathf.Asin(Mathf.Clamp(n.y, -1f, 1f)) / Mathf.PI); }
                var w = 512; var px = new Color32[w * w];
                for (var y = 0; y < w; y++) for (var x = 0; x < w; x++) { var on = ((x / 64) + (y / 64)) % 2 == 0; px[y * w + x] = on ? new Color32(230, 40, 40, 255) : new Color32(240, 240, 240, 255); }
                var bake = new BakeInput { colorImages = new[] { new TextureBake.Image(px, w, w) } };
                var o = RemeshOptions.FromJson("{\"targetQuadCount\":1500,\"textureSize\":" + a[2] + "}");
                var sw = System.Diagnostics.Stopwatch.StartNew();
                var r = WebRemesher.Run(pos, tri, uv, null, o, null, null, bake);
                Console.WriteLine(Summary(r) + " bakeMs=" + sw.ElapsedMilliseconds);
                Console.WriteLine("cornerUvs " + (r.cornerUvs?.Length / 2) + " corners, faceIndices " + r.faceIndices.Length + ", tex " + r.bakedTextureSize + ", normal " + r.bakedNormalMapSize);
                Console.WriteLine(r.bakeNote);
                void Ppm(string path, byte[] rgba, int n) { using var f = System.IO.File.Create(path); var h = System.Text.Encoding.ASCII.GetBytes($"P6\n{n} {n}\n255\n"); f.Write(h, 0, h.Length); var rgb = new byte[3 * n * n]; for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) { var s0 = 4 * ((n - 1 - y) * n + x); var d = 3 * (y * n + x); rgb[d] = rgba[s0]; rgb[d + 1] = rgba[s0 + 1]; rgb[d + 2] = rgba[s0 + 2]; } f.Write(rgb, 0, rgb.Length); }
                if (r.bakedTexture != null) Ppm(a[3] + "_color.ppm", r.bakedTexture, r.bakedTextureSize);
                if (r.bakedNormalMap != null) Ppm(a[3] + "_normal.ppm", r.bakedNormalMap, r.bakedNormalMapSize);
                return 0;
            }
            if (a.Length >= 4 && a[0] == "aba")
            {
                WebRemesher.DisableStaticsRestore = Environment.GetEnvironmentVariable("ABA_NO_RESTORE") == "1";
                var a1 = Run(a[1], a[2]); var b = Run(a[1], a[3]); var a2 = Run(a[1], a[2]);
                Console.WriteLine("A1 " + Summary(a1)); Console.WriteLine("B  " + Summary(b)); Console.WriteLine("A2 " + Summary(a2));
                var ok = a1.hash == a2.hash;
                Console.WriteLine(ok ? "ABA OK (A1 == A2)" : "ABA FAIL: statics leaked between jobs");
                return ok ? 0 : 1;
            }
            if (a.Length >= 3 && a[0] == "leak")   // a static Prepare does NOT set (Revolution.enabled) is flipped between jobs: restore must undo it
            {
                WebRemesher.DisableStaticsRestore = Environment.GetEnvironmentVariable("ABA_NO_RESTORE") == "1";
                var a1 = Run(a[1], a[2]);
                Revolution.enabled = false;   // pollution a previous job could have left behind
                var a2 = Run(a[1], a[2]);
                Console.WriteLine("A1 " + Summary(a1)); Console.WriteLine("A2 " + Summary(a2));
                var ok = a1.hash == a2.hash; Console.WriteLine(ok ? "LEAK TEST OK (restore undid the pollution)" : "LEAK TEST FAIL (pollution survived)");
                return ok ? 0 : 1;
            }
            Console.Error.WriteLine("usage: cli case|remesh|aba ..."); return 2;
        }
    }
}
