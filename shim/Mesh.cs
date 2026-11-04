using System;
using System.Collections.Generic;
using UnityEngine.Rendering;
namespace UnityEngine
{
    public enum MeshTopology { Triangles = 0, Quads = 2, Lines = 3, LineStrip = 4, Points = 5 }

    // Array-backed Mesh. Property getters return COPIES, as Unity's do, so code that writes into a
    // returned array cannot mutate the mesh.
    public class Mesh
    {
        public string name = "";
        Vector3[] m_Vertices = new Vector3[0];
        Vector3[] m_Normals = new Vector3[0];
        Vector2[] m_Uv = new Vector2[0];
        Color32[] m_Colors = new Color32[0];
        readonly List<int[]> m_Indices = new List<int[]>();
        readonly List<MeshTopology> m_Topology = new List<MeshTopology>();
        Bounds m_Bounds;
        public IndexFormat indexFormat = IndexFormat.UInt16;

        public int vertexCount => m_Vertices.Length;
        public int subMeshCount
        {
            get => m_Indices.Count;
            set
            {
                while (m_Indices.Count < value) { m_Indices.Add(new int[0]); m_Topology.Add(MeshTopology.Triangles); }
                while (m_Indices.Count > value) { m_Indices.RemoveAt(m_Indices.Count - 1); m_Topology.RemoveAt(m_Topology.Count - 1); }
            }
        }
        public Vector3[] vertices { get => (Vector3[])m_Vertices.Clone(); set { m_Vertices = value == null ? new Vector3[0] : (Vector3[])value.Clone(); } }
        public Vector3[] normals { get => (Vector3[])m_Normals.Clone(); set { m_Normals = value == null ? new Vector3[0] : (Vector3[])value.Clone(); } }
        public Vector2[] uv { get => (Vector2[])m_Uv.Clone(); set { m_Uv = value == null ? new Vector2[0] : (Vector2[])value.Clone(); } }
        public Color32[] colors32 { get => (Color32[])m_Colors.Clone(); set { m_Colors = value == null ? new Color32[0] : (Color32[])value.Clone(); } }
        public int[] triangles
        {
            get
            {
                var all = new List<int>();
                for (int i = 0; i < m_Indices.Count; i++) if (m_Topology[i] == MeshTopology.Triangles) all.AddRange(m_Indices[i]);
                return all.ToArray();
            }
            set { subMeshCount = Math.Max(1, subMeshCount); m_Indices[0] = value == null ? new int[0] : (int[])value.Clone(); m_Topology[0] = MeshTopology.Triangles; for (int i = 1; i < m_Indices.Count; i++) m_Indices[i] = new int[0]; }
        }
        public Bounds bounds { get => m_Bounds; set => m_Bounds = value; }

        public void Clear() { m_Vertices = new Vector3[0]; m_Normals = new Vector3[0]; m_Uv = new Vector2[0]; m_Colors = new Color32[0]; m_Indices.Clear(); m_Topology.Clear(); }
        public void SetVertices(Vector3[] v) { vertices = v; }
        public void SetVertices(List<Vector3> v) { m_Vertices = v.ToArray(); }
        public void GetVertices(List<Vector3> into) { into.Clear(); into.AddRange(m_Vertices); }
        public void SetNormals(Vector3[] n) { normals = n; }
        public void SetNormals(List<Vector3> n) { m_Normals = n.ToArray(); }
        public void SetUVs(int channel, Vector2[] uvs) { if (channel == 0) uv = uvs; }
        public void SetUVs(int channel, List<Vector2> uvs) { if (channel == 0) m_Uv = uvs.ToArray(); }
        public void GetUVs(int channel, List<Vector2> into) { into.Clear(); if (channel == 0) into.AddRange(m_Uv); }
        public void SetTriangles(int[] tris, int submesh) { subMeshCount = Math.Max(subMeshCount, submesh + 1); m_Indices[submesh] = (int[])tris.Clone(); m_Topology[submesh] = MeshTopology.Triangles; }
        public void SetTriangles(List<int> tris, int submesh) => SetTriangles(tris.ToArray(), submesh);
        public void SetTriangles(int[] tris, int submesh, bool calculateBounds) { SetTriangles(tris, submesh); if (calculateBounds) RecalculateBounds(); }
        public void SetTriangles(List<int> tris, int submesh, bool calculateBounds) => SetTriangles(tris.ToArray(), submesh, calculateBounds);
        Vector4[] m_Tangents = new Vector4[0];
        public Vector4[] tangents { get => (Vector4[])m_Tangents.Clone(); set { m_Tangents = value == null ? new Vector4[0] : (Vector4[])value.Clone(); } }
        public void SetTangents(Vector4[] t) { tangents = t; }
        public void SetTangents(List<Vector4> t) { m_Tangents = t.ToArray(); }
        public void SetIndices(int[] indices, MeshTopology topology, int submesh, bool calculateBounds) { SetIndices(indices, topology, submesh); if (calculateBounds) RecalculateBounds(); }
        public void SetIndices(List<int> indices, MeshTopology topology, int submesh, bool calculateBounds) => SetIndices(indices.ToArray(), topology, submesh, calculateBounds);
        public int[] GetTriangles(int submesh) => (int[])m_Indices[submesh].Clone();
        public void SetIndices(int[] indices, MeshTopology topology, int submesh)
        { subMeshCount = Math.Max(subMeshCount, submesh + 1); m_Indices[submesh] = (int[])indices.Clone(); m_Topology[submesh] = topology; }
        public void SetIndices(List<int> indices, MeshTopology topology, int submesh) => SetIndices(indices.ToArray(), topology, submesh);
        public int[] GetIndices(int submesh) => (int[])m_Indices[submesh].Clone();
        public MeshTopology GetTopology(int submesh) => m_Topology[submesh];
        public void RecalculateBounds()
        {
            if (m_Vertices.Length == 0) { m_Bounds = new Bounds(); return; }
            Vector3 mn = m_Vertices[0], mx = m_Vertices[0];
            for (int i = 1; i < m_Vertices.Length; i++) { mn = Vector3.Min(mn, m_Vertices[i]); mx = Vector3.Max(mx, m_Vertices[i]); }
            var b = new Bounds(); b.SetMinMax(mn, mx); m_Bounds = b;
        }
        // Angle-weighted-free simple area-weighted normals (Unity uses its own weighting; not used in results that are gated).
        public void RecalculateNormals()
        {
            var n = new Vector3[m_Vertices.Length];
            for (int s = 0; s < m_Indices.Count; s++)
            {
                if (m_Topology[s] != MeshTopology.Triangles) continue;
                var idx = m_Indices[s];
                for (int i = 0; i + 2 < idx.Length; i += 3)
                {
                    var a = m_Vertices[idx[i]]; var b = m_Vertices[idx[i + 1]]; var c = m_Vertices[idx[i + 2]];
                    var f = Vector3.Cross(b - a, c - a);
                    n[idx[i]] += f; n[idx[i + 1]] += f; n[idx[i + 2]] += f;
                }
            }
            for (int i = 0; i < n.Length; i++) n[i] = n[i].normalized;
            m_Normals = n;
        }
    }
}
