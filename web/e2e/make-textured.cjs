// usage: node make-textured.cjs in.obj outdir -> outdir/tex.obj (+vt, mtllib), tex.mtl (map_Kd), tex.png (checker 256x256)
// UVs are spherical (u from longitude, v from latitude). They are only a test input, so the seam is left as is.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const [inp, outdir] = process.argv.slice(2); const pos = [], faces = [];
for (const l of fs.readFileSync(inp, 'utf8').split('\n')) {
  if (l.startsWith('v ')) { const t = l.trim().split(/\s+/); pos.push([+t[1], +t[2], +t[3]]); }
  else if (l.startsWith('f ')) faces.push(l.trim().split(/\s+/).slice(1).map(s => parseInt(s) - 1));
}
const uv = pos.map(([x, y, z]) => { const r = Math.hypot(x, y, z) || 1; return [0.5 + Math.atan2(z, x) / (2 * Math.PI), 0.5 + Math.asin(y / r) / Math.PI]; });
// one vt per vertex; triangles across the longitude seam are stretched, which is fine for a test input
let out = 'mtllib tex.mtl\no tex\n'; for (const p of pos) out += `v ${p.join(' ')}\n`;
const vt = uv, fl = faces.map(f => f.map(i => [i + 1, i + 1]));
for (const t of vt) out += `vt ${t[0]} ${t[1]}\n`;
out += 'usemtl mat\n'; for (const f of fl) out += 'f ' + f.map(([a, b]) => `${a}/${b}`).join(' ') + '\n';
fs.writeFileSync(path.join(outdir, 'tex.obj'), out);
fs.writeFileSync(path.join(outdir, 'tex.mtl'), 'newmtl mat\nKd 1 1 1\nmap_Kd tex.png\n');
// PNG
const N = 256, raw = Buffer.alloc((N * 3 + 1) * N);
for (let y = 0; y < N; y++) { raw[y * (N * 3 + 1)] = 0; for (let x = 0; x < N; x++) { const c = ((x >> 4) + (y >> 4)) & 1; const o = y * (N * 3 + 1) + 1 + x * 3; raw[o] = c ? 230 : 40; raw[o + 1] = c ? 60 : 160; raw[o + 2] = c ? 40 : 230; } }
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(path.join(outdir, 'tex.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('wrote textured fixture', pos.length, 'verts', vt.length, 'uvs', faces.length, 'faces');
