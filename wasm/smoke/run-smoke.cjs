// usage: node run-smoke.cjs <wwwroot dir> <case> <target>
// Serves the published wwwroot plus worker.mjs, runs the case in a module Worker in headless Chromium.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const [root, name, target] = process.argv.slice(2);
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let f = p === '/' ? path.join(__dirname, 'index.html') : p === '/worker.mjs' ? path.join(__dirname, 'worker.mjs') : path.join(root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.error('PAGE', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  const out = await page.evaluate(([n, t]) => new Promise((resolve, reject) => {
    const w = new Worker('/worker.mjs', { type: 'module' });
    w.onmessage = e => resolve(e.data); w.onerror = e => reject(new Error('worker error: ' + e.message));
    w.postMessage({ name: n, target: t });
  }), [name, Number(target)]);
  const mem = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  console.log(JSON.stringify({ ...out, jsHeapMB: mem }));
  await browser.close(); server.close();
});
