/** What the remesher core takes: indexed triangles in UNITY space (see unity-space.ts). A quad is two consecutive triangles. */
export interface SourceMesh {
  positions: Float32Array;            // xyz per vertex
  triangles: Int32Array;              // 3 per triangle
  uvs?: Float32Array;                 // 2 per vertex, index-parallel to positions (unwelded at seams)
  triangleMaterials?: Int32Array;     // per triangle
  materialNames?: string[];
  /** Per material slot, whether it is see-through (transparent, or named glass/window: NativeRemesherWindow.SeeThrough). */
  materialGlass?: boolean[];
  /** The file's meshes, as ranges of `triangles` (every part's triangles are contiguous): the model in parts. Absent for a single mesh. */
  parts?: SourcePart[];
  /** Textures the file itself carried (glTF/FBX), one entry per material slot; the UI lets the user add or replace them. */
  embedded?: { color: ({ width: number; height: number; rgba: Uint8ClampedArray; name: string } | null)[]; normal: ({ width: number; height: number; rgba: Uint8ClampedArray; name: string } | null)[] };
}

export interface SourcePart { name: string; first: number; count: number }

/** NativeRemesherWindow.SeeThrough, per part: it has materials and every one of them is transparent or named glass / window. */
export function partSeeThrough(m: SourceMesh): boolean[] {
  return (m.parts ?? []).map((p) => {
    if (!m.triangleMaterials || !m.materialGlass) return false;
    const used = new Set<number>(); for (let t = p.first; t < p.first + p.count; t++) used.add(m.triangleMaterials[t]);
    return used.size > 0 && [...used].every((s) => m.materialGlass![s]);
  });
}
export const isGlassName = (n: string): boolean => /glass|window/i.test(n);

/** What the core returns: polygons (3, 4 or more corners). */
export interface QuadMesh {
  positions: Float32Array;
  faceSizes: Int32Array;
  faceIndices: Int32Array;            // concatenated by faceSizes
  uvs?: Float32Array;
  faceMaterials?: Int32Array;
  materialNames?: string[];
  cornerUvs?: Float32Array;           // 2 per face corner (after a bake the result has a NEW atlas; uvs above are then absent)
  texture?: { size: number; rgba: Uint8Array };     // baked colour, row 0 at the BOTTOM (Unity order)
  normalMap?: { size: number; rgba: Uint8Array };
  /** The model's parts in the result, as ranges of faces; `kept` = the part could not be remeshed and is the source triangles as they were. */
  groups?: { name: string; first: number; count: number; kept: boolean }[];
  fbx?: Uint8Array;                   // FBX bytes written by the core's own FbxWriter (upstream code), when the job produced them
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
