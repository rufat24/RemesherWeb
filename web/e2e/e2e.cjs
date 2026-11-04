// usage: node e2e.cjs <dist dir> <model.obj> [expectedHash]
// Drives the real UI in headless Chromium: load a file, Remesh, read the result, export OBJ and re-read it, screenshot.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const [dist, model, expected] = process.argv.slice(2);
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(dist, p);
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.setInputFiles('input[type=file]', model);
  await page.waitForFunction(() => /vertices/.test(document.querySelector('#panel .note')?.textContent || '') || /vertices/.test(document.body.innerText), null, { timeout: 30000 });
  await page.click('button.primary');
  await page.waitForFunction(() => /Result hash/.test(document.body.innerText) || /failed/.test(document.body.innerText), null, { timeout: 300000 });
  const text = await page.evaluate(() => document.body.innerText);
  const hash = (text.match(/Result hash\s+([0-9a-f]{16})/) || [])[1];
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download")')]);
  const out = path.join(require('os').tmpdir(), 'e2e-export.obj'); await dl.saveAs(out);
  const obj = fs.readFileSync(out, 'utf8'); const f = obj.split('\n').filter(l => l.startsWith('f ')); const quads = f.filter(l => l.trim().split(/\s+/).length === 5).length;
  await page.screenshot({ path: path.join(require('os').tmpdir(), 'e2e.png') });
  console.log(JSON.stringify({ hash, expected, hashMatch: expected ? hash === expected : null, exportedFaces: f.length, exportedQuads: quads, errors, ui: text.split('\n').filter(l => /Quads|Solve|Total/.test(l)).slice(0, 4) }));
  await browser.close(); server.close(); process.exit(errors.length || (expected && hash !== expected) ? 1 : 0);
});
