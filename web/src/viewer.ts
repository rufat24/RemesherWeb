import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { QuadMesh, SourceMesh } from './formats/mesh';
import { triangulate } from './formats/mesh';

/** Shows the source (grey, translucent) and the result (solid, with the QUAD edges drawn, not the triangulation). Takes file-space meshes. */
export class Viewer {
  readonly raycaster = new THREE.Raycaster();
  get dom() { return this.renderer.domElement; }
  set navigation(on: boolean) { this.controls.enabled = on; }
  private renderer: THREE.WebGLRenderer; private scene = new THREE.Scene(); private camera: THREE.PerspectiveCamera; private controls: OrbitControls;
  private wire: THREE.LineSegments | null = null;
  private source: THREE.Object3D | null = null; private result: THREE.Object3D | null = null;
  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true }); this.renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(this.renderer.domElement);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(); if (bg) this.renderer.setClearColor(new THREE.Color(bg));
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.001, 1e6); this.camera.position.set(1.5, 1.2, 2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6)); const d = new THREE.DirectionalLight(0xffffff, 1.8); d.position.set(2, 3, 4); this.scene.add(d);
    new ResizeObserver(() => this.resize()).observe(host); this.resize();
    this.renderer.setAnimationLoop(() => { this.controls.update(); this.renderer.render(this.scene, this.camera); });
  }
  private resize() { const w = this.host.clientWidth, h = Math.max(1, this.host.clientHeight); this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  private clear(o: THREE.Object3D | null) { if (!o) return; this.scene.remove(o); o.traverse((c) => { const m = c as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose?.(); }); }

  setSource(m: SourceMesh, showResultInstead = false) {
    this.clear(this.source);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(m.triangles), 1)); g.computeVertexNormals();
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(m.positions.length).fill(0.62), 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    this.source = mesh; mesh.visible = !showResultInstead; this.scene.add(mesh); this.frame(g);
  }
  setResult(q: QuadMesh) {
    this.clear(this.result);
    const g = new THREE.BufferGeometry(); const mat = new THREE.MeshStandardMaterial({ color: 0x4f8cff, roughness: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const { triangles } = triangulate(q);
    const baked = !!q.cornerUvs && q.cornerUvs.length === 2 * q.faceIndices.length && (!!q.texture || !!q.normalMap);
    if (baked) {
      // Per-corner uvs (the bake's new atlas): one vertex per triangle corner so every corner keeps its own uv. Fan pairing as triangulate().
      let n = 0; for (const s of q.faceSizes) n += (s - 2) * 3; const pos = new Float32Array(3 * n), uv = new Float32Array(2 * n); let w = 0, o = 0;
      const put = (c: number) => { const v = q.faceIndices[c] * 3; pos[3 * w] = q.positions[v]; pos[3 * w + 1] = q.positions[v + 1]; pos[3 * w + 2] = q.positions[v + 2]; uv[2 * w] = q.cornerUvs![2 * c]; uv[2 * w + 1] = q.cornerUvs![2 * c + 1]; w++; };
      for (const s of q.faceSizes) { for (let k = 1; k + 1 < s; k++) { put(o); put(o + k); put(o + k + 1); } o += s; }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const tex = (m: { size: number; rgba: Uint8Array }, srgb: boolean) => { const t = new THREE.DataTexture(new Uint8Array(m.rgba.buffer as ArrayBuffer, m.rgba.byteOffset, m.rgba.length), m.size, m.size, THREE.RGBAFormat); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
      if (q.texture) { mat.map = tex(q.texture, true); mat.color.set(0xffffff); }
      if (q.normalMap) mat.normalMap = tex(q.normalMap, false);
      g.computeVertexNormals();
    } else {
      g.setAttribute('position', new THREE.BufferAttribute(q.positions, 3)); g.setIndex(new THREE.BufferAttribute(Uint32Array.from(triangles), 1)); g.computeVertexNormals();
    }
    const grp = new THREE.Group(); const solid = new THREE.Mesh(g, mat);
    let ne = 0; for (const s of q.faceSizes) ne += s; const lp = new Float32Array(6 * ne); let o = 0, w = 0;
    for (const s of q.faceSizes) { for (let k = 0; k < s; k++) { const a = q.faceIndices[o + k] * 3, b = q.faceIndices[o + (k + 1) % s] * 3; for (let c = 0; c < 3; c++) lp[w++] = q.positions[a + c]; for (let c = 0; c < 3; c++) lp[w++] = q.positions[b + c]; } o += s; }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    this.wire = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 })); this.wire.visible = !baked;
    grp.add(solid, this.wire); this.result = grp; this.scene.add(grp); if (this.source) this.source.visible = false;
  }
  /** Quad edges over the result (off by default on a textured result, where they hide the texture). */
  showWire(v: boolean) { if (this.wire) this.wire.visible = v; }
  /** First hit of the pointer ray on the (visible) source: file-space point, or null. */
  pickSource(ev: PointerEvent): THREE.Vector3 | null {
    if (!this.source) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.raycaster.intersectObject(this.source, false)[0]; return hit ? hit.point.clone() : null;
  }
  setSourceColors(c: Float32Array) {
    const g = (this.source as THREE.Mesh | null)?.geometry; const a = g?.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (a) { (a.array as Float32Array).set(c); a.needsUpdate = true; }
  }
  showSource(v: boolean) { if (this.source) this.source.visible = v; }
  showResult(v: boolean) { if (this.result) this.result.visible = v; }
  private frame(g: THREE.BufferGeometry) {
    g.computeBoundingSphere(); const s = g.boundingSphere!; const r = Math.max(s.radius, 1e-6);
    this.controls.target.copy(s.center); this.camera.position.copy(s.center).add(new THREE.Vector3(1.4, 1, 1.8).multiplyScalar(r * 1.6));
    this.camera.near = r / 1000; this.camera.far = r * 1000; this.camera.updateProjectionMatrix();
  }
}
