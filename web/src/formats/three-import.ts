import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { SourceMesh } from './mesh';

/** Bakes world transforms and merges every mesh of a scene into one SourceMesh (file space, right-handed). */
export function sceneToSource(root: THREE.Object3D): SourceMesh {
  root.updateMatrixWorld(true);
  const pos: number[] = [], uv: number[] = [], tri: number[] = [], mat: number[] = [];
  const names: string[] = []; let anyUv = false; let base = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh || !mesh.geometry) return;
    const g = mesh.geometry as THREE.BufferGeometry; const p = g.getAttribute('position'); if (!p) return;
    const uvA = g.getAttribute('uv'); const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld); pos.push(v.x, v.y, v.z); if (uvA) { uv.push(uvA.getX(i), uvA.getY(i)); anyUv = true; } else uv.push(0, 0); }
    const idx = g.getIndex(); const n = idx ? idx.count : p.count;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const slotOf = (m: THREE.Material) => { const nm = m.name || 'material' + names.length; let i = names.indexOf(nm); if (i < 0) { names.push(nm); i = names.length - 1; } return i; };
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
    case 'fbx': return sceneToSource(new FBXLoader().parse(data, ''));
    default: throw new Error('No three.js loader for .' + ext);
  }
}
