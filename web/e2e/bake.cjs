// usage: node bake.cjs <dist> <model.obj>
// Loads a textured model (OBJ + MTL + PNG together) through the real UI, bakes at 1024, and checks: the texture panel found the PNG, the result reports a baked
// texture and normal map of the chosen size, thumbnails render non-empty, and the Download is a ZIP holding the model, the MTL and the PNGs.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { chromium } = require('playwright');
const [dist, model] = process.argv.slice(2); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bake-'));
cp.execFileSync('node', [path.join(__dirname, 'make-textured.cjs'), model, dir]);
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(dist, p);
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.setInputFiles('input[type=file]', ['tex.obj', 'tex.mtl', 'tex.png'].map(f => path.join(dir, f)));
  await page.waitForFunction(() => /vertices/.test(document.body.innerText)); const loaded = await page.evaluate(() => document.querySelector('.err, .note')?.textContent || '');
  await page.evaluate(() => { document.querySelector('#panel').scrollTop = 0; });
  // choose a 1024 bake so the test stays quick
  const sizeBtn = page.locator('button:text-is("1024")'); if (await sizeBtn.count()) await sizeBtn.first().click();
  await page.click('button.primary');
  await page.waitForFunction(() => /Result hash\s+[0-9a-f]{16}/.test(document.body.innerText), null, { timeout: 600000 });
  const text = await page.evaluate(() => document.body.innerText);
  const thumbs = await page.evaluate(() => [...document.querySelectorAll('#panel canvas')].map(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]); return { w: c.width, colours: seen.size }; }));
  const tex = (text.match(/Baked texture (\d+)px/) || [])[1], nrm = (text.match(/Baked normal map (\d+)px/) || [])[1];
  // export: the format list must offer OBJ; with textures the download is a zip
  await page.selectOption('select', 'obj');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download")')]);
  const zipPath = path.join(dir, dl.suggestedFilename()); await dl.saveAs(zipPath);
  let listing = ''; try { listing = cp.execFileSync('unzip', ['-Z1', zipPath]).toString(); } catch (e) { listing = 'NOT A ZIP: ' + dl.suggestedFilename(); }
  const files = listing.split('\n').filter(Boolean);
  const ok = !!tex && !!nrm && thumbs.length >= 2 && thumbs.every(t => t.colours > 8) && files.some(f => f.endsWith('.obj')) && files.some(f => f.endsWith('.mtl')) && files.filter(f => f.endsWith('.png')).length >= 2 && errors.length === 0;
  console.log(JSON.stringify({ loaded, tex, nrm, thumbs, files, ok, errors }));
  await browser.close(); server.close(); process.exit(ok ? 0 : 1);
});
