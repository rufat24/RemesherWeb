// usage: node parts.cjs <dist> <sphere.obj> <cube.obj>
// A model of three objects (two identical spheres side by side and a cube) goes through the real UI. The window remeshes such a model PART BY PART with one
// shared bake: the result must say "3 parts", keep the objects as `o` groups in the OBJ export, and give the copy the same face count as its original.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require('playwright');
const [dist, sphere, cube] = process.argv.slice(2); const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parts-'));
function read(p) { const v = [], f = []; for (const l of fs.readFileSync(p, 'utf8').split('\n')) { const t = l.trim().split(/\s+/); if (t[0] === 'v') v.push(t.slice(1, 4).map(Number)); else if (t[0] === 'f') f.push(t.slice(1).map(x => parseInt(x) - 1)); } return { v, f }; }
const S = read(sphere), C = read(cube); const out = []; let off = 0;
const add = (name, m, dx) => { out.push('o ' + name); for (const [x, y, z] of m.v) out.push(`v ${x + dx} ${y} ${z}`); for (const f of m.f) out.push('f ' + f.map(i => i + 1 + off).join(' ')); off += m.v.length; };
add('ball_a', S, 0); add('ball_b', S, 3); add('box', C, 6); const model = path.join(dir, 'three.obj'); fs.writeFileSync(model, out.join('\n') + '\n');
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = path.join(dist, p);
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(0, async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true }); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.setInputFiles('input[type=file]', model);
  await page.waitForFunction(() => /vertices/.test(document.body.innerText)); const loaded = await page.evaluate(() => document.body.innerText.match(/\d+ parts[^\n]*/)?.[0] || '');
  const size = process.env.BAKE_SIZE || '1024'; const b = page.locator(`button:text-is("${size}")`); if (await b.count()) await b.first().click();
  await page.evaluate(() => { document.querySelector('#panel').scrollTop = 0; }); await page.click('button.primary');
  await page.waitForFunction(() => /Result hash\s+[0-9a-f]{16}/.test(document.body.innerText), null, { timeout: 600000 });
  const text = await page.evaluate(() => document.body.innerText); const note = (text.match(/\d+ parts: [^\n]*/) || [''])[0];
  await page.selectOption('select', 'obj');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download")')]);
  const p = path.join(dir, dl.suggestedFilename()); await dl.saveAs(p);
  let obj = ''; if (p.endsWith('.zip')) { obj = require('child_process').execFileSync('unzip', ['-p', p, '*.obj']).toString(); } else obj = fs.readFileSync(p, 'utf8');
  const objects = (obj.match(/^o .*/gm) || []).map(s => s.slice(2)); const faceLines = obj.split('\n'); const perObject = {}; let cur = '';
  for (const l of faceLines) { if (l.startsWith('o ')) cur = l.slice(2); else if (l.startsWith('f ')) perObject[cur] = (perObject[cur] || 0) + 1; }
  const ok = /^3 parts/.test(note) && /3 parts/.test(loaded) && objects.join() === 'ball_a,ball_b,box' && perObject.ball_a > 100 && perObject.ball_a === perObject.ball_b && errors.length === 0;
  console.log(JSON.stringify({ loaded, note: note.slice(0, 120), objects, perObject, ok, errors }));
  await browser.close(); server.close(); process.exit(ok ? 0 : 1);
});
