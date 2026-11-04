/**
 * The core works in Unity's frame: left-handed, +Y up. Files and three.js are right-handed, +Y up.
 * Unity's own model importers mirror X on the way in (and reverse winding to keep faces outward); doing the same here keeps
 * results comparable to what the Unity window sees for the same file. Flips happen ONLY in the format layer.
 * Both directions are the same operation, so a round trip is exact (negating a float and swapping two indices lose nothing).
 */
import type { QuadMesh, SourceMesh } from './mesh';

export function flipPositionsX(p: Float32Array): void { for (let i = 0; i < p.length; i += 3) p[i] = -p[i]; }

export function sourceToUnity(m: SourceMesh): SourceMesh {
  const positions = Float32Array.from(m.positions); flipPositionsX(positions);
  const triangles = Int32Array.from(m.triangles);
  for (let i = 0; i < triangles.length; i += 3) { const t = triangles[i + 1]; triangles[i + 1] = triangles[i + 2]; triangles[i + 2] = t; }
  return { ...m, positions, triangles };
}

export function quadMeshFromUnity(m: QuadMesh): QuadMesh {
  const positions = Float32Array.from(m.positions); flipPositionsX(positions);
  const faceIndices = Int32Array.from(m.faceIndices);
  let o = 0;
  for (const s of m.faceSizes) { for (let a = o + 1, b = o + s - 1; a < b; a++, b--) { const t = faceIndices[a]; faceIndices[a] = faceIndices[b]; faceIndices[b] = t; } o += s; }
  return { ...m, positions, faceIndices };
}
