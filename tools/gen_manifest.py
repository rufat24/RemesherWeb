#!/usr/bin/env python3
"""Generates web/src/manifest.json -- the web UI's controls -- FROM the Unity window's source, so labels, tooltips, defaults, the
model-type toolbar and the type notes cannot drift from upstream. `--check` fails if the committed manifest is stale or any control lacks a label.
usage: gen_manifest.py [--check] [window_dir]"""
import json, re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
args = [a for a in sys.argv[1:] if not a.startswith('--')]
wdir = pathlib.Path(args[0]) if args else root / 'upstream/Editor'
src = '\n'.join(f.read_text() for f in sorted(wdir.glob('NativeRemesherWindow*.cs')))
opt = (root / 'orchestration/RemeshOptions.cs').read_text()

def strs(expr): return ''.join(re.findall(r'"((?:[^"\\]|\\.)*)"', expr)).replace('\\"', '"')
def camel(n): return n[0].lower() + n[1:]

# --- labels and tooltips: "m_X = <anything not ';'> new GUIContent("label", "tip" + "tip")" in one statement
labels = {}
for m in re.finditer(r'm_(\w+)\s*=\s*[^;]*?new GUIContent\(\s*("(?:[^"\\]|\\.)*")\s*,\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)\)', src):
    labels.setdefault(m.group(1), (strs(m.group(2)), strs(m.group(3))))
# composite controls the pattern above cannot see
m = re.search(r'new GUIContent\("Curves add quads",\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)\)', src)
if m: labels['CurvesAddQuads'] = ('Curves add quads', strs(m.group(1)))
m = re.search(r'LabelField\(new GUIContent\("Mirrored",\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)\)', src)
if m: labels['Symmetry'] = ('Mirrored', strs(m.group(1)))

# --- window fields (type, default) and which are covered by RemeshOptions
sys.path.insert(0, str(root / 'tools'))
fields = []
for m in re.finditer(r'public\s+([\w.]+)\s+(\w+)\s*=\s*([^;]+);[ \t]*(?://[ \t]*m_(\w+))?', opt):
    t, n, v, w = m.groups(); w = w or n[0].upper() + n[1:]
    kind = {'bool': 'bool', 'int': 'int', 'float': 'float'}.get(t, 'enum')
    default = {'true': True, 'false': False}.get(v.strip(), None)
    if default is None:
        v = v.strip().rstrip('f'); default = v if kind == 'enum' else float(v) if kind == 'float' else int(v)
        if kind == 'enum': default = default.split('.')[-1]
    f = {'name': n, 'window': 'm_' + w, 'kind': kind, 'default': default}
    if w in labels: f['label'], f['tooltip'] = labels[w]
    if kind == 'enum': f['enum'] = t
    fields.append(f)

sym = re.search(r'Toolbar\(\(int\)m_Symmetry,\s*new\[\]\s*\{([^}]*)\}', src)
sym_labels = re.findall(r'"([^"]*)"', sym.group(1)) if sym else []
for f in fields:
    if f['name'] == 'symmetry': f['options'] = [{'value': v, 'label': l} for v, l in zip(['None', 'X', 'Y', 'Z'], sym_labels)]
for f in fields:                       # group: which model type's section shows it
    n = f['name']
    f['group'] = 'character' if n.startswith('character') else 'hard' if n.startswith('hard') else 'scan' if n.startswith('scan') else 'common'
rng = {'targetQuadCount': {'min': 4, 'step': 100}, 'curveDetail': {'min': 0, 'max': 100}}   # from IntField Mathf.Max(4, ..) and Slider(.., 0f, 100f)
for f in fields: f.update(rng.get(f['name'], {}))
# DisabledScope conditions in the window, verified present below, mapped onto fields
disabled = {'hardMergeFlat': 'hardEvenRows', 'hardPlateRows': '!hardMergeFlat || hardEvenRows', 'hardRowsAtMerged': '!hardMergeFlat || hardEvenRows', 'hardToCount': '!hardMergeFlat || hardEvenRows'}
needed = ['DisabledScope(m_HardEvenRows)', 'DisabledScope(!m_HardMergeFlat || m_HardEvenRows)']
for f in fields:
    if f['name'] in disabled: f['disabledWhen'] = disabled[f['name']]

names = re.search(r'k_TypeNames\s*=\s*\{([^}]*)\}', src).group(1)
types = re.search(r'k_Types\s*=\s*\{([^}]*)\}', src).group(1)
notes = re.search(r'k_TypeNotes\s*=\s*\{(.*?)\n\s*\};', src, re.S).group(1)
model_types = [{'value': t.strip().split('.')[-1], 'label': l} for t, l in zip(types.split(','), re.findall(r'"([^"]*)"', names))]
type_notes = [strs(n) for n in re.findall(r'((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+),', notes)]
sections = sorted([{'n': int(a), 'title': b} for a, b in set(re.findall(r'Section\((\d),\s*"([^"]+)"', src))], key=lambda x: x['n'])

errors = [f"control {f['name']} ({f['window']}) has no label in the window source" for f in fields if 'label' not in f and f['name'] != 'modelType']
errors += [f'window no longer contains {n}' for n in needed if n not in src]
if len(type_notes) != len(model_types): errors.append(f'type notes ({len(type_notes)}) != model types ({len(model_types)})')
# --- density paint panel (NativeRemesherWindow.Paint.cs DrawPaintGUI) and the core's range (DensityPaint.cs)
psrc = (wdir / 'NativeRemesherWindow.Paint.cs').read_text()
rsrc = (wdir.parent / 'Runtime/DensityPaint.cs').read_text() if (wdir.parent / 'Runtime/DensityPaint.cs').exists() else ''
def sl(field):
    m = re.search(r'm_' + field + r'\s*=\s*EditorGUILayout\.Slider\(\s*new GUIContent\("([^"]*)",\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)\),\s*m_' + field + r',\s*([\d.]+)f,\s*([\d.]+)f', psrc)
    return {'label': m.group(1), 'tooltip': strs(m.group(2)), 'min': float(m.group(3)), 'max': float(m.group(4))} if m else None
tg = re.search(r'new GUIContent\(m_Painting \? "([^"]*)" : "([^"]*)",\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*|DensityPaint\.range\.ToString\("0\.#"\)\s*\+?\s*)+)\)', psrc)
modes = re.search(r'Toolbar\(\(int\)m_PaintMode,\s*new\[\]\s*\{([^}]*)\}', psrc)
intro = re.search(r'LabelField\(((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+),\s*EditorStyles\.wordWrappedMiniLabel\)', psrc)
helpb = re.search(r'HelpBox\(((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+),', psrc)
rng = re.search(r'public static float range = ([\d.]+)f;', rsrc)
paint = {'intro': strs(intro.group(1)) if intro else None, 'startLabel': tg.group(2) if tg else None, 'stopLabel': tg.group(1) if tg else None,
         'tooltip': strs(tg.group(3).replace('DensityPaint.range.ToString("0.#")', '"' + (rng.group(1).rstrip('0').rstrip('.') if rng else '?') + '"')) if tg else None,
         'modes': [{'value': v, 'label': l} for v, l in zip(['MoreDetail', 'LessDetail', 'Erase'], re.findall(r'"([^"]*)"', modes.group(1)) if modes else [])],
         'size': sl('BrushSizePercent'), 'strength': sl('BrushStrength'), 'help': strs(helpb.group(1)) if helpb else None,
         'defaults': {'mode': 'MoreDetail', 'size': 3.0, 'strength': 0.5}, 'range': float(rng.group(1)) if rng else None}
for k in ('intro', 'startLabel', 'tooltip', 'modes', 'size', 'strength', 'help', 'range'):
    if not paint.get(k): errors.append(f'paint panel: could not read {k} from the window source')
pending = json.loads((root / 'census/window-fields-pending.json').read_text())['pending']
manifest = {'paint': paint, 'pending': pending, 'generatedFrom': 'upstream/Editor/NativeRemesherWindow*.cs (see upstream.lock)', 'modelTypes': model_types, 'typeNotes': type_notes,
            'sections': sections, 'fields': fields}
out = json.dumps(manifest, indent=1, ensure_ascii=False) + '\n'
dest = root / 'web/src/manifest.json'
if '--check' in sys.argv:
    if not dest.exists() or dest.read_text() != out: errors.append('web/src/manifest.json is stale: run tools/gen_manifest.py')
else:
    dest.parent.mkdir(parents=True, exist_ok=True); dest.write_text(out)
for e in errors: print('DRIFT', e)
print(f'{len(fields)} controls, {sum(1 for f in fields if "label" in f)} labelled, {len(model_types)} model types')
sys.exit(1 if errors else 0)
