using System;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using NativeRemesher.Web;
using UnityEngine;

namespace NativeRemesher.Wasm
{
    // JS-facing surface. JSExport marshals double[] / int[] / string, not float[], so vertex data crosses as doubles: every float
    // is exactly representable as a double, so float -> double -> float is lossless.
    [SupportedOSPlatform("browser")]
    public static partial class Host
    {
        static WebResult s_Last;

        public static void Main() { }

        [JSImport("globalThis.__remeshProgress")]
        static partial void ReportProgress(string stage, double fraction);

        /// <summary>Runs one single-mesh job (window's PrepareRun + Solve). Returns a JSON summary; fetch the arrays with the getters.</summary>
        [JSExport]
        public static string Remesh(double[] positions, int[] triangles, double[] uvs, int[] triangleMaterials, string optionsJson)
        {
            var p = new Vector3[positions.Length / 3];
            for (var i = 0; i < p.Length; i++) p[i] = new Vector3((float)positions[3 * i], (float)positions[3 * i + 1], (float)positions[3 * i + 2]);
            Vector2[] uv = null;
            if (uvs != null && uvs.Length == 2 * p.Length) { uv = new Vector2[p.Length]; for (var i = 0; i < uv.Length; i++) uv[i] = new Vector2((float)uvs[2 * i], (float)uvs[2 * i + 1]); }
            if (triangleMaterials != null && triangleMaterials.Length != triangles.Length / 3) triangleMaterials = null;
            s_Last = null;
            s_Last = WebRemesher.Run(p, triangles, uv, triangleMaterials, RemeshOptions.FromJson(optionsJson), (s, f) => ReportProgress(s, f));
            var r = s_Last;
            return "{\"quads\":" + r.quadCount + ",\"tris\":" + r.triangleCount + ",\"ngons\":" + r.ngonCount + ",\"verts\":" + r.positions.Length / 3 +
                   ",\"hash\":\"" + r.hash + "\",\"totalMs\":" + r.totalMs + ",\"hasUvs\":" + (r.uvs != null ? "true" : "false") + "}";
        }

        [JSExport] public static double[] ResultPositions() { var a = s_Last.positions; var d = new double[a.Length]; for (var i = 0; i < a.Length; i++) d[i] = a[i]; return d; }
        [JSExport] public static int[] ResultFaceSizes() => s_Last.faceSizes;
        [JSExport] public static int[] ResultFaceIndices() => s_Last.faceIndices;
        [JSExport] public static int[] ResultFaceMaterials() => s_Last.faceMaterials;
        [JSExport] public static double[] ResultUvs() { var a = s_Last.uvs; if (a == null) return null; var d = new double[a.Length]; for (var i = 0; i < a.Length; i++) d[i] = a[i]; return d; }

        [JSExport]
        public static string RunCase(string name, int target, bool inline) => NativeRemesher.Host.CaseRunner.RunCase(name, target, inline);
    }
}
