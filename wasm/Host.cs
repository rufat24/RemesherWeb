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
        static BakeInput s_Bake = new BakeInput();

        /// <summary>
        /// The source's textures for the bakes, set before Remesh. kind: "color" (main textures) or "detail" (the source's own normal maps).
        /// dims = w0,h0,w1,h1,...; pixels = every image's RGBA, top row first (canvas order), concatenated; triangleImage = per source triangle its
        /// image or -1 (null: the first for all). Pixels are stored bottom row first, the order Texture2D.GetPixels32 gives and the core reads.
        /// </summary>
        [JSExport]
        public static void SetBakeImages(string kind, int[] dims, byte[] pixels, int[] triangleImage)
        {
            var images = new TextureBake.Image[dims.Length / 2]; long off = 0;
            for (var k = 0; k < images.Length; k++)
            {
                int w = dims[2 * k], h = dims[2 * k + 1]; var c = new Color32[w * h];
                for (var y = 0; y < h; y++)
                    for (var x = 0; x < w; x++)
                    {
                        var src = off + 4L * (y * (long)w + x); var dst = (h - 1 - y) * w + x;
                        c[dst] = new Color32(pixels[src], pixels[src + 1], pixels[src + 2], pixels[src + 3]);
                    }
                images[k] = new TextureBake.Image(c, w, h); off += 4L * w * h;
            }
            if (kind == "color") { s_Bake.colorImages = images; s_Bake.colorTriangleTexture = triangleImage; }
            else if (kind == "detail") { s_Bake.detailMaps = images; s_Bake.detailTriangleMap = triangleImage; }
            else throw new ArgumentException("kind must be color or detail");
        }

        public static void Main() { }

        [JSImport("globalThis.__remeshProgress")]
        static partial void ReportProgress(string stage, double fraction);

        /// <summary>Runs one single-mesh job (window's PrepareRun + Solve). Returns a JSON summary; fetch the arrays with the getters.</summary>
        [JSExport]
        public static string Remesh(double[] positions, int[] triangles, double[] uvs, int[] triangleMaterials, string optionsJson, double[] dabs)
        {
            var p = new Vector3[positions.Length / 3];
            for (var i = 0; i < p.Length; i++) p[i] = new Vector3((float)positions[3 * i], (float)positions[3 * i + 1], (float)positions[3 * i + 2]);
            Vector2[] uv = null;
            if (uvs != null && uvs.Length == 2 * p.Length) { uv = new Vector2[p.Length]; for (var i = 0; i < uv.Length; i++) uv[i] = new Vector2((float)uvs[2 * i], (float)uvs[2 * i + 1]); }
            if (triangleMaterials != null && triangleMaterials.Length != triangles.Length / 3) triangleMaterials = null;
            s_Last = null;
            s_Last = WebRemesher.Run(p, triangles, uv, triangleMaterials, RemeshOptions.FromJson(optionsJson), (s, f) => ReportProgress(s, f), dabs, s_Bake);
            s_Bake = new BakeInput();   // inputs are per job
            var r = s_Last;
            return "{\"quads\":" + r.quadCount + ",\"tris\":" + r.triangleCount + ",\"ngons\":" + r.ngonCount + ",\"verts\":" + r.positions.Length / 3 +
                   ",\"hash\":\"" + r.hash + "\",\"totalMs\":" + r.totalMs + ",\"hasUvs\":" + (r.uvs != null ? "true" : "false") + ",\"hasCornerUvs\":" + (r.cornerUvs != null ? "true" : "false") +
                   ",\"textureSize\":" + (r.bakedTexture != null ? r.bakedTextureSize : 0) + ",\"normalMapSize\":" + (r.bakedNormalMap != null ? r.bakedNormalMapSize : 0) +
                   ",\"bakeNote\":\"" + (r.bakeNote ?? "").Replace("\"", "'") + "\"}";
        }

        [JSExport] public static double[] ResultPositions() { var a = s_Last.positions; var d = new double[a.Length]; for (var i = 0; i < a.Length; i++) d[i] = a[i]; return d; }
        [JSExport] public static byte[] ResultFbx(string name) => WebRemesher.ToFbx(s_Last, name);
        [JSExport] public static byte[] ResultTexture() => s_Last.bakedTexture;
        [JSExport] public static byte[] ResultNormalMap() => s_Last.bakedNormalMap;
        [JSExport] public static double[] ResultCornerUvs() { var a = s_Last.cornerUvs; if (a == null) return null; var d = new double[a.Length]; for (var i = 0; i < a.Length; i++) d[i] = a[i]; return d; }
        [JSExport] public static int[] ResultFaceSizes() => s_Last.faceSizes;
        [JSExport] public static int[] ResultFaceIndices() => s_Last.faceIndices;
        [JSExport] public static int[] ResultFaceMaterials() => s_Last.faceMaterials;
        [JSExport] public static double[] ResultUvs() { var a = s_Last.uvs; if (a == null) return null; var d = new double[a.Length]; for (var i = 0; i < a.Length; i++) d[i] = a[i]; return d; }

        [JSExport]
        public static string RunCase(string name, int target, bool inline) => NativeRemesher.Host.CaseRunner.RunCase(name, target, inline);
    }
}
