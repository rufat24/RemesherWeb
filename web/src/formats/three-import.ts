import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { SourceMesh } from './mesh';
import type { TexImage } from './textures';

function imageToTex(tex: THREE.Texture | null | undefined, name: string): TexImage | null {
  const img = tex?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !(img.width > 0) || !(img.height > 0)) return null;
  const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, img.width, img.height);
  return { width: d.width, height: d.height, rgba: d.data, name };
}

/** Bakes world transforms and merges every mesh of a scene into one SourceMesh (file space, right-handed). */
export function sceneToSource(root: THREE.Object3D): SourceMesh {
  root.updateMatrixWorld(true);
  const pos: number[] = [], uv: number[] = [], tri: number[] = [], mat: number[] = [];
  const names: string[] = []; let anyUv = false; let base = 0;
  const color: (TexImage | null)[] = [], normal: (TexImage | null)[] = []; const seen = new Map<THREE.Texture, TexImage | null>();
  const read = (t: THREE.Texture | null | undefined, name: string) => { if (!t) return null; if (!seen.has(t)) seen.set(t, imageToTex(t, name)); return seen.get(t)!; };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh || !mesh.geometry) return;
    const g = mesh.geometry as THREE.BufferGeometry; const p = g.getAttribute('position'); if (!p) return;
    const uvA = g.getAttribute('uv'); const v = new THREE.Vector3();
    const firstMat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    // glTF textures are not flipped (v = 0 is the TOP row); the core and OBJ/FBX have v = 0 at the bottom
    const flipV = firstMat?.map?.flipY === false || firstMat?.normalMap?.flipY === false;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld); pos.push(v.x, v.y, v.z); if (uvA) { uv.push(uvA.getX(i), flipV ? 1 - uvA.getY(i) : uvA.getY(i)); anyUv = true; } else uv.push(0, 0); }
    const idx = g.getIndex(); const n = idx ? idx.count : p.count;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const slotOf = (m: THREE.Material) => {
      const nm = m.name || 'material' + names.length; let i = names.indexOf(nm);
      if (i < 0) { names.push(nm); i = names.length - 1; const sm = m as THREE.MeshStandardMaterial; color[i] = read(sm.map, nm + '_color'); normal[i] = read(sm.normalMap, nm + '_normal'); }
      return i;
    };
    const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    for (const grp of groups) {
      const slot = slotOf(mats[Math.min(grp.materialIndex ?? 0, mats.length - 1)]);
      for (let k = grp.start; k + 2 < Math.min(grp.start + grp.count, n); k += 3) {
        const a = idx ? idx.getX(k) : k, b = idx ? idx.getX(k + 1) : k + 1, c = idx ? idx.getX(k + 2) : k + 2;
        tri.push(base + a, base + b, base + c); mat.push(slot);
      }
    }
    base += p.count;
  });
  const out: SourceMesh = { positions: Float32Array.from(pos), triangles: Int32Array.from(tri) };
  if (anyUv) out.uvs = Float32Array.from(uv);
  if (names.length) { out.triangleMaterials = Int32Array.from(mat); out.materialNames = names; }
  if (color.some(Boolean) || normal.some(Boolean)) out.embedded = { color, normal };
  return out;
}

export async function parseWithThree(ext: string, data: ArrayBuffer): Promise<SourceMesh> {
  switch (ext) {
    case 'glb': case 'gltf': {
      const gltf = await new GLTFLoader().parseAsync(ext === 'gltf' ? new TextDecoder().decode(data) : data, '');
      return sceneToSource(gltf.scene);
    }
    case 'stl': return sceneToSource(new THREE.Mesh(new STLLoader().parse(data)));
    case 'ply': return sceneToSource(new THREE.Mesh(new PLYLoader().parse(data)));
    case 'fbx': return sceneToSource(parseFbx(data));
    default: throw new Error('No three.js loader for .' + ext);
  }
}

/**
 * Two three.js FBXLoader limits that our own FbxWriter output (upstream Runtime code, kept byte-for-byte as Unity writes it) runs into. The file is
 * valid ASCII FBX; the exported bytes are NOT changed, only what is handed to three:
 *  1. three joins a continued array line only if it starts in column 0. FbxWriter indents continuation lines, so three silently dropped every vertex and
 *     polygon after the first 256 (a 5,162-quad mesh came back as 64 quads). Continuation lines (indented, starting with a digit, '-' or ',') are de-indented.
 *  2. three decides "is this ASCII?" by probing bytes at triangular offsets for the letters of the binary header; our header hits one ('i' at probe 13) and
 *     is rejected as "Unknown format". ASCII FBX allows leading comment lines, which move the probes, so on that one error the text is retried behind comments.
 */
export function parseFbx(data: ArrayBuffer): THREE.Group {
  const loader = new FBXLoader();
  const head = new TextDecoder().decode(new Uint8Array(data, 0, Math.min(18, data.byteLength)));
  if (head.startsWith('Kaydara FBX')) return loader.parse(data, '');             // binary FBX: three's own path
  const text = new TextDecoder().decode(data).replace(/(\r?\n)[ \t]+(?=[-,\d])/g, '$1');
  const encode = (t: string) => new TextEncoder().encode(t).buffer as ArrayBuffer;
  let first: unknown;
  for (const pad of ['', '; \n', ';\n;\n', '; x\n;\n;\n', ';\n;\n;\n;\n;\n']) {
    try { return loader.parse(encode(pad + text), ''); } catch (e) { first ??= e; if (!/Unknown format/.test(String((e as Error).message))) throw e; }
  }
  throw first;
}
