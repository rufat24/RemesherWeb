import type { QuadMesh, SourceMesh } from './mesh';

/**
 * OBJ -> SourceMesh (file space; call sourceToUnity after). Corners are keyed by (v, vt) so UVs stay index-parallel and a UV seam
 * duplicates the vertex, as the core wants. A quad becomes two CONSECUTIVE triangles (a,b,c),(a,c,d); an n-gon is fanned.
 * `usemtl` switches the material slot (triangleMaterials). Negative indices are relative, as the OBJ spec says.
 */
export function parseObj(text: string): SourceMesh {
  const v: number[] = [], vt: number[] = [];
  const pos: number[] = [], uv: number[] = [], tri: number[] = [], mats: number[] = [];
  const corner = new Map<string, number>();
  const names: string[] = []; let cur = 0; let anyUv = false;
  const getCorner = (vi: number, ti: number): number => {
    const key = vi + '/' + ti; let id = corner.get(key);
    if (id === undefined) {
      id = pos.length / 3; corner.set(key, id);
      pos.push(v[3 * vi], v[3 * vi + 1], v[3 * vi + 2]);
      if (ti >= 0) { uv.push(vt[2 * ti], vt[2 * ti + 1]); anyUv = true; } else uv.push(0, 0);
    }
    return id;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim(); if (line.length < 2) continue;
    const c = line.charCodeAt(0);
    if (c === 118 /* v */) {
      const t = line.split(/\s+/);
      if (t[0] === 'v') v.push(+t[1], +t[2], +t[3]);
      else if (t[0] === 'vt') vt.push(+t[1], +(t[2] ?? 0));
    } else if (c === 102 /* f */ && line[1] <= ' ') {
      const t = line.split(/\s+/).slice(1); const ids: number[] = [];
      for (const tok of t) {
        const p = tok.split('/'); const vi = +p[0]; const ti = p[1] ? +p[1] : 0;
        const a = vi > 0 ? vi - 1 : v.length / 3 + vi; const b = ti > 0 ? ti - 1 : ti < 0 ? vt.length / 2 + ti : -1;
        if (!(a >= 0 && a < v.length / 3)) { ids.length = 0; break; }
        ids.push(getCorner(a, b));
      }
      if (ids.length < 3) continue;
      for (let k = 1; k + 1 < ids.length; k++) { tri.push(ids[0], ids[k], ids[k + 1]); mats.push(cur); }
    } else if (line.startsWith('usemtl')) {
      const n = line.slice(6).trim(); let i = names.indexOf(n); if (i < 0) { names.push(n); i = names.length - 1; } cur = i;
    }
  }
  const out: SourceMesh = { positions: Float32Array.from(pos), triangles: Int32Array.from(tri) };
  if (anyUv) out.uvs = Float32Array.from(uv);
  if (names.length > 0) { out.triangleMaterials = Int32Array.from(mats); out.materialNames = names; }
  return out;
}

/** QuadMesh -> OBJ, keeping quads and n-gons. Shortest round-trip float text ("R" formatting equivalent). */
export function writeObj(m: QuadMesh, name = 'remeshed'): string {
  const L: string[] = ['# NativeRemesher web export', 'o ' + name];
  const n = m.positions.length / 3; const hasUv = !!m.uvs && m.uvs.length === 2 * n;
  for (let i = 0; i < n; i++) L.push('v ' + m.positions[3 * i] + ' ' + m.positions[3 * i + 1] + ' ' + m.positions[3 * i + 2]);
  if (hasUv) for (let i = 0; i < n; i++) L.push('vt ' + m.uvs![2 * i] + ' ' + m.uvs![2 * i + 1]);
  let o = 0, lastMat = -2;
  for (let f = 0; f < m.faceSizes.length; f++) {
    const s = m.faceSizes[f];
    if (m.faceMaterials && m.faceMaterials[f] !== lastMat) { lastMat = m.faceMaterials[f]; L.push('usemtl ' + (m.materialNames?.[lastMat] ?? 'material' + lastMat)); }
    let line = 'f';
    for (let k = 0; k < s; k++) { const i = m.faceIndices[o + k] + 1; line += hasUv ? ' ' + i + '/' + i : ' ' + i; }
    L.push(line); o += s;
  }
  return L.join('\n') + '\n';
}
