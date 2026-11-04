import { parseObj, writeObj } from './obj';
import { parseWithThree } from './three-import';
import { sourceToUnity } from './unity-space';
import type { QuadMesh, SourceMesh } from './mesh';
import { quadMeshFromUnity } from './unity-space';
import { triangulate } from './mesh';

export const IMPORT_EXTENSIONS = ['obj', 'glb', 'gltf', 'stl', 'ply', 'fbx'];
export type ExportFormat = 'obj' | 'ply' | 'stl' | 'off' | 'fbx';
export const EXPORT_FORMATS: { id: ExportFormat; label: string; keepsQuads: boolean }[] = [
  { id: 'fbx', label: 'FBX (quads kept, UVs, normals)', keepsQuads: true },
  { id: 'obj', label: 'OBJ (quads kept)', keepsQuads: true },
  { id: 'ply', label: 'PLY (quads kept)', keepsQuads: true },
  { id: 'off', label: 'OFF (quads kept)', keepsQuads: true },
  { id: 'stl', label: 'STL (triangles)', keepsQuads: false },
];

/** A file's bytes -> a SourceMesh in Unity space, ready for the core. */
export async function importFile(name: string, data: ArrayBuffer): Promise<SourceMesh> {
  const ext = name.split('.').pop()!.toLowerCase();
  const file = ext === 'obj' ? parseObj(new TextDecoder().decode(data)) : await parseWithThree(ext, data);
  return sourceToUnity(file);
}

/** The core's result (Unity space) -> file bytes. */
export function exportMesh(unityMesh: QuadMesh, format: ExportFormat, name = 'remeshed'): Blob {
  if (format === 'fbx') { if (!unityMesh.fbx) throw new Error('This result carries no FBX'); return new Blob([unityMesh.fbx as BlobPart], { type: 'application/octet-stream' }); }
  const m = quadMeshFromUnity(unityMesh);
  switch (format) {
    case 'obj': return new Blob([writeObj(m, name)], { type: 'text/plain' });
    case 'off': return new Blob([writeOff(m)], { type: 'text/plain' });
    case 'ply': return new Blob([writePly(m)], { type: 'text/plain' });
    case 'stl': return new Blob([writeStl(m)], { type: 'model/stl' });
  }
}

function writeOff(m: QuadMesh): string {
  const n = m.positions.length / 3; const L = ['OFF', `${n} ${m.faceSizes.length} 0`];
  for (let i = 0; i < n; i++) L.push(`${m.positions[3 * i]} ${m.positions[3 * i + 1]} ${m.positions[3 * i + 2]}`);
  let o = 0; for (const s of m.faceSizes) { L.push(s + ' ' + Array.from(m.faceIndices.subarray(o, o + s)).join(' ')); o += s; }
  return L.join('\n') + '\n';
}

function writePly(m: QuadMesh): string {
  const n = m.positions.length / 3; const uv = m.uvs && m.uvs.length === 2 * n;
  const L = ['ply', 'format ascii 1.0', `element vertex ${n}`, 'property float x', 'property float y', 'property float z'];
  if (uv) L.push('property float s', 'property float t');
  L.push(`element face ${m.faceSizes.length}`, 'property list uchar int vertex_indices', 'end_header');
  for (let i = 0; i < n; i++) L.push(`${m.positions[3 * i]} ${m.positions[3 * i + 1]} ${m.positions[3 * i + 2]}` + (uv ? ` ${m.uvs![2 * i]} ${m.uvs![2 * i + 1]}` : ''));
  let o = 0; for (const s of m.faceSizes) { L.push(s + ' ' + Array.from(m.faceIndices.subarray(o, o + s)).join(' ')); o += s; }
  return L.join('\n') + '\n';
}

function writeStl(m: QuadMesh): ArrayBuffer {
  const { triangles } = triangulate(m); const nt = triangles.length / 3;
  const buf = new ArrayBuffer(84 + 50 * nt); const dv = new DataView(buf); dv.setUint32(80, nt, true);
  for (let t = 0; t < nt; t++) {
    const a = triangles[3 * t] * 3, b = triangles[3 * t + 1] * 3, c = triangles[3 * t + 2] * 3; const P = m.positions;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const o = 84 + 50 * t; [nx, ny, nz, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]].forEach((x, i) => dv.setFloat32(o + 4 * i, x, true));
  }
  return buf;
}
