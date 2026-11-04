/** What the remesher core takes: indexed triangles in UNITY space (see unity-space.ts). A quad is two consecutive triangles. */
export interface SourceMesh {
  positions: Float32Array;            // xyz per vertex
  triangles: Int32Array;              // 3 per triangle
  uvs?: Float32Array;                 // 2 per vertex, index-parallel to positions (unwelded at seams)
  triangleMaterials?: Int32Array;     // per triangle
  materialNames?: string[];
}

/** What the core returns: polygons (3, 4 or more corners). */
export interface QuadMesh {
  positions: Float32Array;
  faceSizes: Int32Array;
  faceIndices: Int32Array;            // concatenated by faceSizes
  uvs?: Float32Array;
  faceMaterials?: Int32Array;
  materialNames?: string[];
}

export function faceCount(m: QuadMesh): number { return m.faceSizes.length; }

/** Fan-triangulates polygons; a quad (a,b,c,d) becomes (a,b,c),(a,c,d), the same pairing the core expects for quads. */
export function triangulate(m: QuadMesh): { triangles: Int32Array; triangleFace: Int32Array } {
  let n = 0; for (const s of m.faceSizes) n += s - 2;
  const tri = new Int32Array(3 * n), owner = new Int32Array(n);
  let k = 0, o = 0, t = 0;
  for (let f = 0; f < m.faceSizes.length; f++) {
    const s = m.faceSizes[f];
    for (let i = 1; i + 1 < s; i++) { tri[t++] = m.faceIndices[o]; tri[t++] = m.faceIndices[o + i]; tri[t++] = m.faceIndices[o + i + 1]; owner[k++] = f; }
    o += s;
  }
  return { triangles: tri, triangleFace: owner };
}
