// usage: node paint.cjs <dist> <model.obj>
// Drives the paint tool with real mouse strokes: remesh once unpainted, paint a stroke across the model, remesh again. The painted run must report dabs,
// produce clearly more quads (the core sized the painted area finer), and Clear Paint must remove the dabs.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const [dist, model] = process.argv.slice(2);
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(dist, p);
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.setInputFiles('input[type=file]', model);
  await page.waitForFunction(() => /vertices/.test(document.body.innerText));
  const hashOf = () => page.evaluate(() => (document.body.innerText.match(/Result hash\s+([0-9a-f]{16})/) || [])[1] || '');
  const quads = async (prev = '') => { await page.waitForFunction((h) => { const m = document.body.innerText.match(/Result hash\s+([0-9a-f]{16})/); return m && m[1] !== h; }, prev, { timeout: 300000 }); return +(await page.evaluate(() => document.body.innerText)).match(/Quads\s+([\d,]+)\s+Triangles/)[1].replace(/,/g, ''); };
  await page.click('button.primary'); const q0 = await quads(); const h0 = await hashOf();
  await page.click('button:has-text("Paint Fix Areas")');
  const box = await page.locator('#view canvas').boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx - 150, cy); await page.mouse.down();
  for (let i = 0; i <= 30; i++) await page.mouse.move(cx - 150 + i * 10, cy + Math.sin(i / 5) * 40);
  await page.mouse.up();
  const dabsText = await page.evaluate(() => (document.body.innerText.match(/([\d,]+) dabs painted/) || [])[0] || '');
  await page.screenshot({ path: require('os').tmpdir() + '/paint.png' });
  await page.click('button:has-text("Stop Painting")');
  await page.evaluate(() => { document.querySelector('#panel').scrollTop = 0; });
  await page.click('button.primary'); const q1 = await quads(h0);
  await page.click('button:has-text("Clear Paint")'); const cleared = await page.evaluate(() => !/dabs painted/.test(document.body.innerText));
  const ok = /dabs painted/.test(dabsText) && q1 > q0 * 1.03 && cleared && errors.length === 0;
  console.log(JSON.stringify({ unpainted: q0, painted: q1, dabsText, cleared, ok, errors }));
  await browser.close(); server.close(); process.exit(ok ? 0 : 1);
});
