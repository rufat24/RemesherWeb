// usage: node make-fixtures.cjs in.obj outdir   -> in.stl (binary, unwelded), in.glb (indexed), in_split.glb (3 vertices per triangle, like a seam-split export), in.ply (binary_little_endian)
const fs = require('fs'), path = require('path');
const [inp, outdir] = process.argv.slice(2); const base = path.basename(inp, '.obj');
const pos = [], tri = [];
for (const l of fs.readFileSync(inp, 'utf8').split('\n')) {
  if (l.startsWith('v ')) { const t = l.trim().split(/\s+/); pos.push(Math.fround(+t[1]), Math.fround(+t[2]), Math.fround(+t[3])); }
  else if (l.startsWith('f ')) { const t = l.trim().split(/\s+/).slice(1).map(s => parseInt(s) - 1); for (let k = 1; k + 1 < t.length; k++) tri.push(t[0], t[k], t[k + 1]); }
}
const nt = tri.length / 3;
{ // STL
  const b = Buffer.alloc(84 + 50 * nt); b.writeUInt32LE(nt, 80);
  for (let t = 0; t < nt; t++) { const o = 84 + 50 * t; for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) b.writeFloatLE(pos[3 * tri[3 * t + c] + k], o + 12 + 12 * c + 4 * k); }
  fs.writeFileSync(path.join(outdir, base + '.stl'), b);
}
function glb(positions, indices) {
  const pb = Buffer.from(new Float32Array(positions).buffer); const ib = Buffer.from(new Uint32Array(indices).buffer);
  const mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30]; for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], positions[i + k]); mx[k] = Math.max(mx[k], positions[i + k]); }
  const bin = Buffer.concat([pb, ib]);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pb.length, target: 34962 }, { buffer: 0, byteOffset: pb.length, byteLength: ib.length, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: mn, max: mx }, { bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR' }] };
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
  const binp = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]); const total = 12 + 8 + js.length + 8 + binp.length;
  const h = Buffer.alloc(12); h.write('glTF', 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(js.length, 0); c1.write('JSON', 4); const c2 = Buffer.alloc(8); c2.writeUInt32LE(binp.length, 0); c2.write('BIN\0', 4);
  return Buffer.concat([h, c1, js, c2, binp]);
}
fs.writeFileSync(path.join(outdir, base + '.glb'), glb(pos, tri));
{ const sp = [], si = []; for (let i = 0; i < tri.length; i++) { sp.push(pos[3 * tri[i]], pos[3 * tri[i] + 1], pos[3 * tri[i] + 2]); si.push(i); } fs.writeFileSync(path.join(outdir, base + '_split.glb'), glb(sp, si)); }
{ const head = `ply\nformat binary_little_endian 1.0\nelement vertex ${pos.length / 3}\nproperty float x\nproperty float y\nproperty float z\nelement face ${nt}\nproperty list uchar int vertex_indices\nend_header\n`;
  const vb = Buffer.from(new Float32Array(pos).buffer); const fb = Buffer.alloc(nt * 13); for (let t = 0; t < nt; t++) { fb.writeUInt8(3, 13 * t); for (let c = 0; c < 3; c++) fb.writeInt32LE(tri[3 * t + c], 13 * t + 1 + 4 * c); }
  fs.writeFileSync(path.join(outdir, base + '.ply'), Buffer.concat([Buffer.from(head), vb, fb])); }
console.log('wrote fixtures for', base, nt, 'triangles');
