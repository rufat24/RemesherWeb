// usage: node fbx-roundtrip.cjs <dist> <model.obj>
// Remesh in the UI, download the FBX our core's FbxWriter produced, load that FBX back through the UI (three's FBXLoader): it must load,
// have ~2 triangles per quad (>= 99.5%), and the page must stay error-free. Proves the FBX export is a file other software can open, not just bytes.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require('playwright');
const [dist, model] = process.argv.slice(2);
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(dist, p);
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url); await page.setInputFiles('input[type=file]', model);
  await page.waitForFunction(() => /vertices/.test(document.body.innerText)); await page.click('button.primary');
  await page.waitForFunction(() => /Result hash/.test(document.body.innerText), null, { timeout: 300000 });
  const quads = +(await page.evaluate(() => document.body.innerText)).match(/Quads\s+([\d,]+)\s+Triangles/)[1].replace(/,/g, '');
  await page.selectOption('select', 'fbx');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download")')]);
  const out = path.join(os.tmpdir(), 'rt.fbx'); await dl.saveAs(out);
  const head = fs.readFileSync(out, 'utf8').slice(0, 40);
  await page.goto(url); await page.setInputFiles('input[type=file]', out);
  await page.waitForFunction(() => /vertices|Could not read/.test(document.body.innerText), null, { timeout: 60000 });
  const status = (await page.evaluate(() => document.body.innerText)).match(/(\d[\d,]*) vertices, (\d[\d,]*) triangles|Could not read[^\n]*/)[0];
  const tris = +((status.match(/, ([\d,]+) triangles/) || [])[1] || '0').replace(/,/g, '');
  // three triangulates every polygon with earcut, which drops a triangle on near-degenerate quads: allow 0.5%
  const ok = tris >= 0.995 * 2 * quads && tris <= 2 * quads && errors.length === 0;
  console.log(JSON.stringify({ fbxHeader: head.split('\n')[0], quads, reimported: status, expectedTriangles: 2 * quads, ok, errors }));
  await browser.close(); server.close(); process.exit(ok ? 0 : 1);
});
