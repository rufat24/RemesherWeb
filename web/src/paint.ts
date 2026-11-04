/**
 * Density paint: the web twin of the window's paint tool (NativeRemesherWindow.Paint.cs) and its data (Runtime/DensityPaint.cs, compiled unchanged in the core).
 * A dab is {centre, radius, strength} in the SOURCE mesh's space (Unity space here); the value at a point is the sum of the dabs reaching it, each falling off
 * (1 - (d/r)^2)^2, clamped to [-1, 1]. The core multiplies the lattice spacing by range^-value, so this file only produces dabs; it never decides sizes.
 * The overlay below mirrors DensityPaint.ValueAt so the user sees what the core will read.
 */
import * as THREE from 'three';

// window: m_PaintMode = PaintMode.MoreDetail
// window: m_BrushSizePercent = 3f
// window: m_BrushStrength = 0.5f
export type PaintMode = 'MoreDetail' | 'LessDetail' | 'Erase';
export interface Dab { x: number; y: number; z: number; r: number; s: number }

export const falloff = (d: number, r: number) => (r <= 0 || d >= r ? 0 : (1 - (d / r) ** 2) ** 2);

export class PaintState {
  mode: PaintMode = 'MoreDetail';
  sizePercent = 3;        // slider 0.25 .. 25 in the window
  strength = 0.5;         // slider 0.05 .. 1
  dabs: Dab[] = [];
  private sums: Float32Array = new Float32Array(0);
  private verts: Float32Array = new Float32Array(0);   // file-space vertex positions of the source (what the viewer shows)
  private lastDab: THREE.Vector3 | null = null;
  private diag = 1;
  onChange: () => void = () => {};

  /** fileSpace positions of the source; the dabs themselves are stored in Unity space (x negated). */
  setSource(filePositions: Float32Array) {
    this.verts = filePositions; this.sums = new Float32Array(filePositions.length / 3); this.dabs = [];
    const mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30];
    for (let i = 0; i < filePositions.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], filePositions[i + k]); mx[k] = Math.max(mx[k], filePositions[i + k]); }
    this.diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;   // m_PaintMesh.bounds.size.magnitude
    this.lastDab = null; this.onChange();
  }
  get radius() { return this.diag * this.sizePercent / 100; }
  clear() { this.dabs = []; this.sums.fill(0); this.onChange(); }
  endStroke() { this.lastDab = null; }

  /** One brush application at a file-space hit point. Returns true if anything changed. Spacing rule from the window: 0.3 x radius between dabs. */
  apply(hit: THREE.Vector3, mode: PaintMode = this.mode): boolean {
    const r = this.radius;
    if (this.lastDab && hit.distanceTo(this.lastDab) < r * 0.3) return false;
    this.lastDab = hit.clone();
    const cx = -hit.x, cy = hit.y, cz = hit.z;                       // file -> Unity space
    if (mode === 'Erase') {
      const keep: Dab[] = []; let removed = 0;
      for (const d of this.dabs) {
        if (Math.hypot(d.x - cx, d.y - cy, d.z - cz) <= r) { this.add(d, -1); removed++; } else keep.push(d);
      }
      if (!removed) return false; this.dabs = keep;
    } else {
      const d: Dab = { x: cx, y: cy, z: cz, r, s: mode === 'LessDetail' ? -this.strength : this.strength };
      this.dabs.push(d); this.add(d, 1);
    }
    this.onChange(); return true;
  }
  private add(d: Dab, sign: number) {
    const v = this.verts;
    for (let i = 0, n = this.sums.length; i < n; i++) {
      const dist = Math.hypot(-v[3 * i] - d.x, v[3 * i + 1] - d.y, v[3 * i + 2] - d.z);
      if (dist < d.r) this.sums[i] += sign * d.s * falloff(dist, d.r);
    }
  }
  /** Vertex colours for the overlay: grey, orange where more detail was asked, blue where less. */
  colors(): Float32Array {
    const c = new Float32Array(this.sums.length * 3);
    for (let i = 0; i < this.sums.length; i++) {
      const v = Math.max(-1, Math.min(1, this.sums[i])), a = Math.abs(v);
      const base = 0.62; const t = v >= 0 ? [1, 0.5, 0.1] : [0.3, 0.6, 1];
      for (let k = 0; k < 3; k++) c[3 * i + k] = base * (1 - a) + t[k] * a;
    }
    return c;
  }
  /** For the worker: x,y,z,radius,strength per dab, Unity space. */
  toArray(): Float64Array { const a = new Float64Array(this.dabs.length * 5); this.dabs.forEach((d, i) => a.set([d.x, d.y, d.z, d.r, d.s], 5 * i)); return a; }
}
