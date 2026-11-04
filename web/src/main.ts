import manifest from './manifest.json';
import { EXPORT_FORMATS, IMPORT_EXTENSIONS, exportMesh, importFiles, type ExportFormat } from './formats';
import { bakeSet, decodeImage, slotCount, toWorkerBake, type TexImage } from './formats/textures';
import { quadMeshFromUnity, sourceToUnity } from './formats/unity-space';
import type { QuadMesh, SourceMesh } from './formats/mesh';
import { startRemesh, type RemeshJob, type RemeshSummary } from './remesh-client';
import { Viewer } from './viewer';
import { PaintState, type PaintMode } from './paint';

// The browser build caps bakes at 4096 (8192 runs the wasm heap out of memory); the core clamps too, so a hand-set value cannot hang a job
const MAX_BAKE_SIZE = 4096;
interface Field { name: string; window: string; kind: string; default: unknown; label?: string; tooltip?: string; group: string; enum?: string; options?: { value: string; label: string }[]; min?: number; max?: number; step?: number; disabledWhen?: string }
const fields = manifest.fields as unknown as Field[];
const opts: Record<string, string | number | boolean> = Object.fromEntries(fields.map((f) => [f.name, f.default as string | number | boolean]));

const panel = document.getElementById('panel')!;
const viewer = new Viewer(document.getElementById('view')!);
const paint = new PaintState(); let painting = false;
let slots: { color: (TexImage | null)[]; normal: (TexImage | null)[] } = { color: [], normal: [] };
let source: SourceMesh | null = null, sourceName = 'model', result: QuadMesh | null = null, job: RemeshJob | null = null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]) => {
  const e = document.createElement(tag); Object.assign(e, props); if (props.class) e.className = props.class; e.append(...kids); return e;
};
const disabled = (f: Field) => !!f.disabledWhen && !!new Function('o', `with(o){return (${f.disabledWhen})}`)(opts);
const visible = (f: Field) => f.group === 'common' || opts.modelType === 'Auto' || (f.group === 'character' && opts.modelType === 'Character') ||
  (f.group === 'hard' && opts.modelType === 'HardSurface') || (f.group === 'scan' && opts.modelType === 'Scan');

// ---- panel skeleton
const status = el('div', { class: 'note' }); const bar = el('progress', { max: 1, value: 0, hidden: true });
const fileInput = el('input', { type: 'file', multiple: true, hidden: true, accept: [...IMPORT_EXTENSIONS, 'mtl', 'png', 'jpg', 'jpeg', 'webp'].map((e) => '.' + e).join(',') });
const drop = el('div', { id: 'drop' }, 'Drop a model here or click to choose', el('div', { class: 'note' }, 'OBJ (+ MTL and textures), GLB/GLTF, STL, PLY, FBX'));
const runBtn = el('button', { class: 'primary', textContent: 'Remesh', disabled: true }); const cancelBtn = el('button', { textContent: 'Cancel', hidden: true });
const results = el('div'); const settings = el('div');
const exportSel = el('select'); EXPORT_FORMATS.forEach((f) => exportSel.append(el('option', { value: f.id, textContent: f.label })));
const exportBtn = el('button', { textContent: 'Download', disabled: true });
panel.append(el('h1', {}, 'Native Remesher'), drop, fileInput, status, settings, runBtn, cancelBtn, bar, results,
  el('h2', {}, 'Export'), el('div', { class: 'seg' }, exportSel, exportBtn),
  el('h2', {}, 'Not in this build yet'), el('div', { class: 'note' }, manifest.pending.join(', ')));

function renderSettings() {
  settings.replaceChildren();
  const sec = (n: number) => el('h2', {}, manifest.sections.find((s) => s.n === n)!.title);
  settings.append(sec(1));
  const seg = el('div', { class: 'seg' });
  manifest.modelTypes.forEach((t) => seg.append(el('button', { textContent: t.label, className: opts.modelType === t.value ? 'on' : '', onclick: () => { opts.modelType = t.value; renderSettings(); } })));
  settings.append(seg, el('div', { class: 'note' }, manifest.typeNotes[manifest.modelTypes.findIndex((t) => t.value === opts.modelType)]));
  const toggles = fields.filter((f) => f.kind === 'bool' && visible(f) && ['roundParts', 'character', 'hard', 'scan'].some((p) => f.name.startsWith(p)));
  let last = '';
  for (const f of toggles) {
    if (opts.modelType === 'Auto' && f.group !== last && f.group !== 'common') settings.append(el('div', { class: 'note', textContent: f.group === 'hard' ? 'Hard Surface' : f.group[0].toUpperCase() + f.group.slice(1) }));
    last = f.group; settings.append(control(f));
  }
  settings.append(sec(2)); for (const n of ['targetQuadCount', 'curvesAddQuads', 'curveDetail']) settings.append(control(fields.find((f) => f.name === n)!));
  settings.append(sec(3)); for (const n of ['longCreaseLoops', 'materialBorders', 'symmetry']) settings.append(control(fields.find((f) => f.name === n)!));
  settings.append(sec(4), paintPanel());
  settings.append(sec(5), el('div', { class: 'note', textContent: 'Bake from the source' }));
  for (const n of ['bakeTexture', 'bakeNormalMap', 'textureSize']) settings.append(control(fields.find((f) => f.name === n)!));
  settings.append(texturePanel());
}

function texturePanel(): HTMLElement {
  const box = el('div'); if (!source) return box;
  const names = source.materialNames ?? ['(the mesh)'];
  for (let i = 0; i < slotCount(source); i++) {
    const row = el('div', { class: 'row' }); row.style.flexWrap = 'wrap'; row.append(el('span', { class: 'note', textContent: names[i] ?? 'material ' + i }));
    for (const kind of ['color', 'normal'] as const) {
      const inp = el('input', { type: 'file', accept: 'image/*', hidden: true }); inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; slots[kind][i] = await decodeImage(f, f.name); renderSettings(); };
      const cur = slots[kind][i]; const b = el('button', { textContent: (kind === 'color' ? 'texture: ' : 'normal map: ') + (cur ? `${cur.name} ${cur.width}x${cur.height}` : 'none'), onclick: () => inp.click() }); b.style.fontSize = '11px';
      row.append(b, inp);
    }
    box.append(row);
  }
  if (!source.uvs) box.append(el('div', { class: 'note', textContent: 'This model has no UVs: no source texture can be baked; the normal map still can.' }));
  return box;
}

const P = manifest.paint;
function paintPanel(): HTMLElement {
  const box = el('div'); box.append(el('div', { class: 'note', textContent: P.intro! }));
  const t = el('button', { textContent: painting ? P.stopLabel! : P.startLabel!, className: painting ? 'on' : '', title: P.tooltip!, disabled: !source, onclick: () => setPainting(!painting) });
  t.style.width = '100%'; box.append(t);
  if (painting) {
    const seg = el('div', { class: 'seg' }); P.modes.forEach((m) => seg.append(el('button', { textContent: m.label, className: paint.mode === m.value ? 'on' : '', onclick: () => { paint.mode = m.value as PaintMode; renderSettings(); } })));
    const slider = (c: NonNullable<typeof P.size>, get: () => number, set: (v: number) => void) => {
      const val = el('span', { textContent: String(get()) }); const i = el('input', { type: 'range', min: String(c.min), max: String(c.max), step: String(c.min), value: String(get()) });
      i.oninput = () => { set(Number(i.value)); val.textContent = i.value; }; return el('label', { class: 'row', title: c.tooltip }, c.label, i, val);
    };
    box.append(seg, slider(P.size!, () => paint.sizePercent, (v) => (paint.sizePercent = v)), slider(P.strength!, () => paint.strength, (v) => (paint.strength = v)), el('div', { class: 'note', textContent: P.help! }));
  }
  if (paint.dabs.length) box.append(el('div', { class: 'seg' }, el('span', { class: 'note', textContent: `${paint.dabs.length.toLocaleString()} dabs painted` }), el('button', { textContent: 'Clear Paint', onclick: () => { paint.clear(); renderSettings(); } })));
  return box;
}
function setPainting(on: boolean) { painting = on; viewer.navigation = true; viewer.showSource(true); (document.getElementById('vsrc') as HTMLInputElement).checked = true; renderSettings(); }
paint.onChange = () => viewer.setSourceColors(paint.colors());
// Painting: left-drag paints, Alt-drag (or the other buttons) still orbit; Shift erases, Ctrl paints Less Detail; Esc stops. As in the window.
let stroke = false;
viewer.dom.addEventListener('pointerdown', (e) => {
  if (!painting || e.button !== 0 || e.altKey) return;
  viewer.navigation = false; stroke = true; viewer.dom.setPointerCapture(e.pointerId); dab(e);
});
viewer.dom.addEventListener('pointermove', (e) => { if (painting && stroke) dab(e); });
const endStroke = () => { if (!stroke) return; stroke = false; paint.endStroke(); viewer.navigation = true; renderSettings(); };
viewer.dom.addEventListener('pointerup', endStroke); viewer.dom.addEventListener('pointercancel', endStroke);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && painting) setPainting(false); });
function dab(e: PointerEvent) { const hit = viewer.pickSource(e); if (hit) paint.apply(hit, e.shiftKey ? 'Erase' : e.ctrlKey ? 'LessDetail' : paint.mode); }


function control(f: Field): HTMLElement {
  const off = disabled(f); const tip = f.tooltip ?? '';
  if (f.kind === 'bool') {
    const cb = el('input', { type: 'checkbox', checked: opts[f.name] as boolean, disabled: off, onchange: () => { opts[f.name] = cb.checked; renderSettings(); } });
    return el('label', { class: 'row' + (off ? ' off' : ''), title: tip }, cb, f.label ?? f.name);
  }
  if ((f.kind === 'enum' || f.kind === 'int') && f.options) {
    const seg = el('div', { class: 'seg' }); f.options.filter((o) => !(f.name === 'textureSize' && Number(o.value) > MAX_BAKE_SIZE)).forEach((o) => seg.append(el('button', { textContent: o.label, className: opts[f.name] === o.value ? 'on' : '', onclick: () => { opts[f.name] = o.value; renderSettings(); } })));
    const wrap = el('div', { title: tip, class: off ? 'off' : '' }, el('div', { class: 'note', textContent: f.label ?? f.name }), seg); wrap.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = off)); return wrap;
  }
  const input = el('input', { type: f.name === 'curveDetail' ? 'range' : 'number', value: String(opts[f.name]), min: String(f.min ?? 0), step: String(f.step ?? 1) });
  if (f.max !== undefined) input.max = String(f.max);
  const val = el('span', { textContent: String(opts[f.name]) });
  input.oninput = () => { let v = Number(input.value); if (f.name === 'targetQuadCount') v = Math.max(f.min ?? 4, Math.round(v) || 4); opts[f.name] = v; val.textContent = String(v); };
  return el('label', { class: 'row', title: tip }, f.label ?? f.name, input, val);
}
renderSettings();

// ---- import
async function load(files: File[]) {
  const label = files.map((f) => f.name).join(', '); status.className = 'note'; status.textContent = `Reading ${label}…`;
  try {
    const imp = await importFiles(files); const unity = imp.mesh;
    source = unity; sourceName = imp.name; result = null; exportBtn.disabled = true; results.replaceChildren();
    slots = { color: [...(unity.embedded?.color ?? [])], normal: [...(unity.embedded?.normal ?? [])] };
    const fileSpace = sourceToUnity(unity);           // sourceToUnity is its own inverse: back to file space for display
    viewer.setSource(fileSpace); paint.setSource(fileSpace.positions); painting = false; viewer.navigation = true; renderSettings();
    status.textContent = `${imp.name}: ${(unity.positions.length / 3).toLocaleString()} vertices, ${(unity.triangles.length / 3).toLocaleString()} triangles` + (unity.uvs ? ', UVs' : ', no UVs');
    runBtn.disabled = false;
  } catch (e) { status.className = 'err'; status.textContent = `Could not read ${label}: ${(e as Error).message}`; }
}
drop.onclick = () => fileInput.click(); fileInput.onchange = () => fileInput.files?.length && load([...fileInput.files]);
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer?.files; if (f?.length) load([...f]); };

// ---- run
function showSummary(s: RemeshSummary, bootMs: number, wallMs: number) {
  const rows: [string, string][] = [['Quads', s.quads.toLocaleString()], ['Triangles', s.tris.toLocaleString()], ['N-gons', s.ngons.toLocaleString()],
    ['Vertices', s.verts.toLocaleString()], ['Solve', (s.totalMs / 1000).toFixed(1) + ' s'], ['Total', (wallMs / 1000).toFixed(1) + ' s (boot ' + bootMs + ' ms)'], ['Result hash', s.hash]];
  const kv = el('div', { class: 'kv' }); rows.forEach(([k, v]) => kv.append(el('b', { textContent: k }), el('span', { textContent: v })));
  results.replaceChildren(el('h2', {}, manifest.sections.find((x) => x.n === 5)!.title), kv);
  if (s.bakeNote) results.append(el('div', { class: 'note', textContent: s.bakeNote }));
  for (const [label, m] of [['Baked texture', result?.texture], ['Baked normal map', result?.normalMap]] as const) if (m) results.append(thumb(label, m));
}
function bakeInputs() {
  if (!source || !source.uvs) return undefined;     // RunSingle reads textures only when the source has UVs
  const color = opts.bakeTexture ? bakeSet(source, slots.color) : null, detail = opts.bakeNormalMap ? bakeSet(source, slots.normal) : null;
  return color || detail ? { color: color ? toWorkerBake(color) : undefined, detail: detail ? toWorkerBake(detail) : undefined } : undefined;
}
function thumb(label: string, m: { size: number; rgba: Uint8Array }): HTMLElement {
  const t = 160, c = document.createElement('canvas'); c.width = c.height = t; const g = c.getContext('2d')!; const small = new ImageData(t, t); const step = m.size / t;
  for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) { const sx = Math.floor(x * step), sy = Math.floor((t - 1 - y) * step); const si = 4 * (sy * m.size + sx), di = 4 * (y * t + x); small.data.set(m.rgba.subarray(si, si + 4), di); }
  g.putImageData(small, 0, 0); c.style.cssText = 'width:100%;max-width:160px;border:1px solid var(--line);border-radius:6px;margin:4px 6px 0 0'; return el('div', { class: 'note', title: `${m.size} x ${m.size}` }, label + ` ${m.size}px`, el('br'), c);
}
runBtn.onclick = async () => {
  if (!source) return;
  runBtn.hidden = true; cancelBtn.hidden = false; bar.hidden = false; bar.value = 0; status.className = 'note'; status.textContent = 'Starting…';
  const t0 = performance.now(); const o = Object.fromEntries(fields.map((f) => [f.name, opts[f.name]]));
  job = startRemesh(source, o, (stage, fraction) => { bar.value = fraction; status.textContent = stage; }, sourceName + '_remeshed', paint.toArray(), bakeInputs());
  try {
    const out = await job.promise; result = out.mesh; viewer.setResult(quadMeshFromUnity(out.mesh)); exportBtn.disabled = false; (document.getElementById('vsrc') as HTMLInputElement).checked = false;
    status.textContent = 'Done.'; showSummary(out.summary, out.bootMs, performance.now() - t0);
  } catch (e) { const m = (e as Error).message; status.className = m === 'cancelled' ? 'note' : 'err'; status.textContent = m === 'cancelled' ? 'Cancelled.' : 'Remesh failed: ' + m; }
  finally { job = null; runBtn.hidden = false; cancelBtn.hidden = true; bar.hidden = true; }
};
cancelBtn.onclick = () => job?.cancel();

exportBtn.onclick = () => {
  if (!result) return; const fmt = exportSel.value as ExportFormat;
  exportMesh(result, fmt, sourceName + '_remeshed').then(({ blob, filename }) => { const a = el('a', { href: URL.createObjectURL(blob), download: filename }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); })
    .catch((e) => { status.className = 'err'; status.textContent = 'Export failed: ' + (e as Error).message; });
};
(document.getElementById('vsrc') as HTMLInputElement).onchange = (e) => viewer.showSource((e.target as HTMLInputElement).checked);
(document.getElementById('vres') as HTMLInputElement).onchange = (e) => viewer.showResult((e.target as HTMLInputElement).checked);
