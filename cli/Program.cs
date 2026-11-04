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
            return WebRemesher.Run(positions, triangles, uvs, sub, RemeshOptions.FromJson(json));
        }
        static string Summary(WebResult r) =>
            $"{{\"quads\":{r.quadCount},\"tris\":{r.triangleCount},\"ngons\":{r.ngonCount},\"verts\":{r.positions.Length / 3},\"hash\":\"{r.hash}\",\"totalMs\":{r.totalMs}}}";
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
            if (a.Length >= 3 && a[0] == "fbx")      // cli fbx in.obj out.fbx [optionsJson]
            {
                var r = Run(a[1], a.Length > 3 ? a[3] : null);
                System.IO.File.WriteAllBytes(a[2], WebRemesher.ToFbx(r, "remeshed")); Console.WriteLine(Summary(r)); return 0;
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
