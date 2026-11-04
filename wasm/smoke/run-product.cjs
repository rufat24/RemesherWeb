// usage: node run-product.cjs <wwwroot> <in.obj> '<optionsJson>' [more option sets...]
// Each option set is one job in its own fresh Worker; prints one JSON line per job. Compare "hash" with `cli remesh`.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const [root, objPath, ...optSets] = process.argv.slice(2);
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.json': 'application/json' };
function parseObj(file) {
  const pos = [], tri = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('v ')) { const t = line.trim().split(/\s+/); pos.push(Math.fround(+t[1]), Math.fround(+t[2]), Math.fround(+t[3])); }
    else if (line.startsWith('f ')) { const t = line.trim().split(/\s+/).slice(1).map(s => parseInt(s.split('/')[0]) - 1); for (let k = 1; k + 1 < t.length; k++) tri.push(t[0], t[k], t[k + 1]); }
  }
  return { positions: pos, triangles: tri };
}
const mesh = parseObj(objPath);
const DUMP = process.env.DUMP_PREFIX; let jobNo = 0;
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = p === '/' ? path.join(__dirname, 'index.html') : p === '/product-worker.mjs' ? path.join(__dirname, p.slice(1)) : path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.error('PAGE', m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  for (const o of optSets) {
    const out = await page.evaluate(([m, opts]) => new Promise((resolve, reject) => {
      const w = new Worker('/product-worker.mjs', { type: 'module' }); let progress = 0;
      w.onmessage = e => { if (e.data.type === 'progress') progress++; else { w.terminate(); const d = e.data; resolve({ ...d, progressEvents: progress, positions: d.positions && Array.from(d.positions), faceSizes: d.faceSizes && Array.from(d.faceSizes), faceIndices: d.faceIndices && Array.from(d.faceIndices) }); } };
      w.onerror = e => reject(new Error('worker error: ' + e.message));
      w.postMessage({ type: 'start', positions: new Float64Array(m.positions), triangles: new Int32Array(m.triangles), options: JSON.parse(opts) });
    }), [mesh, o]);
    if (DUMP && out.positions) {
      const L = []; for (let i = 0; i < out.positions.length; i += 3) L.push('v ' + out.positions[i] + ' ' + out.positions[i + 1] + ' ' + out.positions[i + 2]);
      let k = 0; for (const n of out.faceSizes) { L.push('f ' + out.faceIndices.slice(k, k + n).map(x => x + 1).join(' ')); k += n; }
      fs.writeFileSync(DUMP + (jobNo) + '.obj', L.join('\n') + '\n');
    }
    jobNo++;
    console.log(JSON.stringify({ options: o, type: out.type, message: out.message, summary: out.summary, bootMs: out.bootMs, progressEvents: out.progressEvents,
      outVerts: out.positions && out.positions.length / 3, outFaces: out.faceSizes && out.faceSizes.length }));
  }
  await browser.close(); server.close();
});
