/**
 * Source textures for the bakes. The core wants, per distinct texture, its pixels (RGBA, canvas order = top row first; Host.SetBakeImages flips to Unity's order)
 * and per source triangle which image it reads: the web twin of the window's ReadSourceTextures / ReadTextures. A material slot is a submesh
 * (OBJ `usemtl`, glTF primitive material, FBX material); a triangle reads its slot's image; slots past the last use the last (the window's rule).
 */
import type { SourceMesh } from './mesh';

export interface TexImage { width: number; height: number; rgba: Uint8ClampedArray; name: string }
export interface SlotTextures { color: (TexImage | null)[]; normal: (TexImage | null)[] }

export async function decodeImage(blob: Blob, name: string): Promise<TexImage> {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0); const d = g.getImageData(0, 0, bmp.width, bmp.height); bmp.close();
  return { width: d.width, height: d.height, rgba: d.data, name };
}

export function slotCount(m: SourceMesh): number { return Math.max(1, m.materialNames?.length ?? 1); }

/** Distinct images of one kind, and per triangle its image (null = "the first for all", only when the mesh has a single slot). */
export function bakeSet(m: SourceMesh, slots: (TexImage | null)[]): { images: TexImage[]; triangleImage: Int32Array | null } | null {
  const images: TexImage[] = []; const slotImage: number[] = [];
  for (let i = 0; i < slotCount(m); i++) {
    const t = slots[i] ?? null;
    if (!t) { slotImage.push(-1); continue; }
    let k = images.indexOf(t); if (k < 0) { images.push(t); k = images.length - 1; }
    slotImage.push(k);
  }
  if (!images.length) return null;
  if (!m.triangleMaterials) return slotImage[0] >= 0 ? { images: [images[slotImage[0]]], triangleImage: null } : null;
  const tri = new Int32Array(m.triangleMaterials.length);
  for (let t = 0; t < tri.length; t++) { let s = m.triangleMaterials[t]; if (s >= slotImage.length) s = slotImage.length - 1; tri[t] = s >= 0 ? slotImage[s] : -1; }
  return { images, triangleImage: tri };
}

/** What the worker takes for `bake`. Pixels are copied into one buffer (transferred, not cloned). */
export function toWorkerBake(set: { images: TexImage[]; triangleImage: Int32Array | null }) {
  let n = 0; for (const i of set.images) n += i.rgba.length;
  const pixels = new Uint8Array(n); let o = 0; const dims: number[] = [];
  for (const i of set.images) { pixels.set(i.rgba, o); o += i.rgba.length; dims.push(i.width, i.height); }
  return { dims: Int32Array.from(dims), pixels, triangleImage: set.triangleImage ?? undefined };
}

/** `newmtl` blocks of an MTL: per material its colour map (map_Kd) and normal/bump map (map_Bump, bump, norm). Option flags (-bm 1, -s ...) are skipped. */
export function parseMtl(text: string): Map<string, { color?: string; normal?: string }> {
  const out = new Map<string, { color?: string; normal?: string }>(); let cur: { color?: string; normal?: string } | null = null;
  const file = (rest: string) => { const t = rest.trim().split(/\s+/); let i = 0; while (i < t.length && t[i].startsWith('-')) i += ({ '-bm': 2, '-s': 4, '-o': 4, '-t': 4, '-mm': 3, '-clamp': 2, '-blendu': 2, '-blendv': 2, '-imfchan': 2, '-texres': 2, '-cc': 2 } as Record<string, number>)[t[i]] ?? 1; return t.slice(i).join(' ').split(/[\\/]/).pop()!; };
  for (const raw of text.split('\n')) {
    const l = raw.trim(); if (!l || l[0] === '#') continue; const sp = l.indexOf(' '); if (sp < 0) continue; const key = l.slice(0, sp).toLowerCase(), rest = l.slice(sp + 1);
    if (key === 'newmtl') { cur = {}; out.set(rest.trim(), cur); } else if (cur && key === 'map_kd') cur.color = file(rest);
    else if (cur && (key === 'map_bump' || key === 'bump' || key === 'norm')) cur.normal = file(rest);
  }
  return out;
}
