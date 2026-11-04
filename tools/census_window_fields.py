#!/usr/bin/env python3
"""UI census (drift check #1). Every [SerializeField] field of the Unity window must be either
  * covered by RemeshOptions (same default), or
  * listed in census/window-fields-pending.json with the milestone that will port it, or
  * listed as UI-only (foldouts).
A NEW upstream field, a CHANGED default, or a pending field that has since been ported all FAIL.
usage: census_window_fields.py [window.cs] [RemeshOptions.cs]"""
import json, re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
if len(sys.argv) > 1: win = pathlib.Path(sys.argv[1]).read_text()
else: win = '\n'.join(f.read_text() for f in sorted((root / 'upstream/Editor').glob('NativeRemesherWindow*.cs')))
opt = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else root / 'orchestration/RemeshOptions.cs').read_text()
pending = json.loads((root / 'census/window-fields-pending.json').read_text())

def norm(v):
    v = v.strip().rstrip('f')
    return {'true': 'true', 'false': 'false'}.get(v, v)
def dflt(t, v):
    if v is None: return {'bool': 'false', 'int': '0', 'float': '0'}.get(t, None)
    return norm(v)

win_fields = {}
for m in re.finditer(r'\[SerializeField\]\s+([\w.<>]+(?:\[\])?)\s+([^;]+);', win):
    t = m.group(1)
    for decl in re.split(r',(?![^(]*\))', m.group(2)):          # "bool a = true, b, c;" declares three fields
        d = re.match(r'\s*m_(\w+)\s*(?:=\s*(.+?))?\s*$', decl, re.S)
        if not d: continue
        n, v = d.group(1), d.group(2)
        if v is not None and t not in ('bool', 'int', 'float'): v = re.sub(r'^\w+\.', '', v.strip())
        win_fields[n] = (t, dflt(t, v))
opt_fields = {}
for m in re.finditer(r'public\s+([\w.]+)\s+(\w+)\s*=\s*([^;]+);\s*(?://\s*m_(\w+))?', opt):
    t, n, v, src = m.groups()
    opt_fields[src or n[0].upper() + n[1:]] = (t, norm(re.sub(r'^\w+\.', '', v)) if t not in ('bool', 'int', 'float') else norm(v), n)

errors = []
webui = pending.get('webUi', {})
for n, f in sorted(webui.items()):
    if n not in win_fields: errors.append(f'webUi list names m_{n} which no longer exists upstream'); continue
    txt = (root / f).read_text() if (root / f).exists() else ''
    mk = re.search(r'window:\s*m_' + n + r'\s*=\s*([^\n]+)', txt)
    if not mk: errors.append(f'm_{n}: {f} has no "// window: m_{n} = ..." marker'); continue
    if (n in pending['pending']): errors.append(f'm_{n} is both webUi and pending')
    want = win_fields[n][1]; got = norm(re.sub(r'^[A-Za-z_]\w*\.', '', mk.group(1).strip()))
    if want != got: errors.append(f'm_{n}: DEFAULT CHANGED upstream: window {want}, {f} says {got}')
for n, (t, v) in sorted(win_fields.items()):
    if n in opt_fields:
        ot, ov, on = opt_fields[n]
        if n in pending['pending']: errors.append(f'm_{n}: ported as {on} but still listed pending -> remove it from the pending list')
        if (t == 'bool') != (ot == 'bool') or (ov != v and not (t in ('ModelType', 'SymmetryAxis') and ov == v)):
            errors.append(f'm_{n}: DEFAULT/TYPE CHANGED upstream: window {t} = {v}, RemeshOptions.{on} {ot} = {ov}')
    elif n in pending['pending'] or n in pending['uiOnly'] or n in webui: pass
    else: errors.append(f'm_{n} ({t} = {v}): NEW window field, neither in RemeshOptions nor in census/window-fields-pending.json')
for n in sorted(set(pending['pending']) | set(pending['uiOnly'])):
    if n not in win_fields: errors.append(f'pending list names m_{n} which no longer exists upstream')
for n, (_, _, on) in sorted(opt_fields.items()):
    if n not in win_fields: errors.append(f'RemeshOptions.{on} maps to m_{n}, which no longer exists upstream')
print(f'window fields {len(win_fields)}: covered {sum(1 for n in win_fields if n in opt_fields)}, web-ui {len(webui)}, pending {sum(1 for n in win_fields if n in pending["pending"])}, ui-only {sum(1 for n in win_fields if n in pending["uiOnly"])}')
for e in errors: print('DRIFT', e)
sys.exit(1 if errors else 0)
