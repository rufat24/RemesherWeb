import { parseObj, writeMtl, writeObj } from './obj';
import { parseWithThree } from './three-import';
import { sourceToUnity } from './unity-space';
import type { QuadMesh, SourceMesh } from './mesh';
import { quadMeshFromUnity } from './unity-space';
import { triangulate } from './mesh';
import { decodeImage, parseMtl, type TexImage } from './textures';

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

/**
 * Splits vertices so every vertex has ONE uv (PLY/OFF-style formats): a vertex used with two different corner uvs becomes two.
 * No-op without per-corner uvs.
 */
export function unweld(m: QuadMesh): QuadMesh {
  if (!m.cornerUvs || m.cornerUvs.length !== 2 * m.faceIndices.length) return m;
  const key = new Map<string, number>(); const pos: number[] = [], uv: number[] = []; const idx = new Int32Array(m.faceIndices.length);
  for (let c = 0; c < idx.length; c++) {
    const v = m.faceIndices[c]; const k = v + '/' + m.cornerUvs[2 * c] + '/' + m.cornerUvs[2 * c + 1]; let id = key.get(k);
    if (id === undefined) { id = pos.length / 3; key.set(k, id); pos.push(m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]); uv.push(m.cornerUvs[2 * c], m.cornerUvs[2 * c + 1]); }
    idx[c] = id;
  }
  return { ...m, positions: Float32Array.from(pos), faceIndices: idx, uvs: Float32Array.from(uv), cornerUvs: undefined };
}

/** Baked RGBA (row 0 at the bottom, Unity order) -> PNG bytes (top row first). */
export async function toPng(size: number, rgba: Uint8Array): Promise<Uint8Array> {
  const top = new Uint8ClampedArray(rgba.length); const row = 4 * size;
  for (let y = 0; y < size; y++) top.set(rgba.subarray((size - 1 - y) * row, (size - y) * row), y * row);
  const c = new OffscreenCanvas(size, size); c.getContext('2d')!.putImageData(new ImageData(top, size, size), 0, 0);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

export interface Exported { blob: Blob; filename: string }

/**
 * The core's result (Unity space) -> a download. With baked textures the download is a ZIP: the model, its .mtl (OBJ) and the PNGs
 * (colour, and the tangent-space normal map); without, the bare model file. FBX bytes are written by the core's own FbxWriter (upstream code).
 */
export async function exportMesh(unityMesh: QuadMesh, format: ExportFormat, name = 'remeshed'): Promise<Exported> {
  const colorPng = unityMesh.texture ? await toPng(unityMesh.texture.size, unityMesh.texture.rgba) : undefined;
  const normalPng = unityMesh.normalMap ? await toPng(unityMesh.normalMap.size, unityMesh.normalMap.rgba) : undefined;
  const files: Record<string, Uint8Array> = {}; const enc = (t: string) => new TextEncoder().encode(t);
  const colorFile = colorPng ? name + '_color.png' : undefined, normalFile = normalPng ? name + '_normal.png' : undefined;
  if (colorPng) files[colorFile!] = colorPng; if (normalPng) files[normalFile!] = normalPng;
  let main: Uint8Array; const mat = name + '_material';
  if (format === 'fbx') { if (!unityMesh.fbx) throw new Error('This result carries no FBX'); main = unityMesh.fbx; }
  else {
    const m = quadMeshFromUnity(unityMesh);
    if (format === 'obj') {
      const hasMaps = !!(colorFile || normalFile);
      main = enc(writeObj(m, name, hasMaps ? { file: name + '.mtl', material: mat } : undefined));
      if (hasMaps) files[name + '.mtl'] = enc(writeMtl(mat, colorFile, normalFile));
    } else if (format === 'off') main = enc(writeOff(unweldIfNeeded(m)));
    else if (format === 'ply') main = enc(writePly(unweld(m)));
    else main = new Uint8Array(writeStl(m));
  }
  files[name + '.' + format] = main;
  if (Object.keys(files).length === 1) return { blob: new Blob([main as BlobPart]), filename: name + '.' + format };
  const { zipSync } = await import('fflate');
  return { blob: new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' }), filename: name + '.zip' };
}
const unweldIfNeeded = (m: QuadMesh) => m;   // OFF has no uvs: positions as they are

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

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];
const ext = (n: string) => n.split('.').pop()!.toLowerCase();

/**
 * A model file plus whatever came with it (drop several files at once): for OBJ a .mtl and the images it names (map_Kd -> colour, map_Bump/bump/norm -> normal map),
 * for glTF/FBX the textures inside the file. Images that no material names are ignored here; the UI can assign them to a slot by hand.
 */
export async function importFiles(files: File[]): Promise<{ mesh: SourceMesh; name: string; images: Map<string, TexImage> }> {
  const model = files.find((f) => IMPORT_EXTENSIONS.includes(ext(f.name)));
  if (!model) throw new Error('No model file among the dropped files (' + IMPORT_EXTENSIONS.join(', ') + ')');
  const mesh = await importFile(model.name, await model.arrayBuffer());
  const images = new Map<string, TexImage>();
  for (const f of files) if (IMAGE_EXT.includes(ext(f.name))) { try { images.set(f.name.toLowerCase(), await decodeImage(f, f.name)); } catch { /* not decodable: skipped */ } }
  const mtl = files.find((f) => ext(f.name) === 'mtl');
  if (ext(model.name) === 'obj' && mesh.materialNames && mtl) {
    const m = parseMtl(await mtl.text()); const color: (TexImage | null)[] = [], normal: (TexImage | null)[] = [];
    mesh.materialNames.forEach((n, i) => { const e = m.get(n); color[i] = e?.color ? images.get(e.color.toLowerCase()) ?? null : null; normal[i] = e?.normal ? images.get(e.normal.toLowerCase()) ?? null : null; });
    if (color.some(Boolean) || normal.some(Boolean)) mesh.embedded = { color, normal };
  }
  return { mesh, name: model.name.replace(/\.[^.]+$/, ''), images };
}
