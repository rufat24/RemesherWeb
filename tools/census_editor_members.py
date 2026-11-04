#!/usr/bin/env python3
"""Editor-member census (drift check #3): every method/field/type of the Unity window classes is fingerprinted and triaged.

census/editor-members.json: { "<Class>.<member>(<params>)": { "status": ..., "sha": <hash of the comment-free, whitespace-free text>,
                                                               "refs": <hash of the Runtime API the member touches>, "portedAs": ... } }
status:  ported:<web symbol>   -> ANY change to the member fails (the port must be re-read)
         pending:<milestone>   -> any change fails (the future port must start from the new text)
         n/a:<reason>          -> any change fails
         ui-only               -> fails only if the Runtime API it touches (types/statics/methods of upstream/Runtime) changes
A member in the source but not in the file, or in the file but not in the source, fails too.
`--accept` rewrites sha/refs of every known member (after a human re-read) and adds new members as ui-only (no Runtime refs) or pending:untriaged.
usage: census_editor_members.py [--accept] [editor_dir] [runtime_dir]"""
import hashlib, json, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
pos = [a for a in sys.argv[1:] if not a.startswith('--')]
edir = pathlib.Path(pos[0]) if pos else root / 'upstream/Editor'
rdir = pathlib.Path(pos[1]) if len(pos) > 1 else root / 'upstream/Runtime'
cfg = root / 'census/editor-members.json'

def strip(src):
    """Blank comments (keep newlines) and string/char literal CONTENTS (labels are the manifest's job), keep the quotes."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]; d = src[i:i + 2]
        if d == '//':
            j = src.find('\n', i); j = n if j < 0 else j; i = j
        elif d == '/*':
            j = src.find('*/', i + 2); j = n if j < 0 else j + 2; out.append('\n' * src.count('\n', i, j)); i = j
        elif c == '@' and src[i + 1:i + 2] == '"':
            j = i + 2
            while j < n and not (src[j] == '"' and src[j + 1:j + 2] != '"'): j += 2 if src[j] == '"' else 1
            out.append('""'); i = j + 1
        elif c == '"' or (c == '$' and src[i + 1:i + 2] == '"'):
            i += 1 if c == '$' else 0; j = i + 1
            while j < n and src[j] != '"': j += 2 if src[j] == '\\' else 1
            out.append('""'); i = j + 1
        elif c == "'":
            j = i + 1
            while j < n and src[j] != "'": j += 2 if src[j] == '\\' else 1
            out.append("''"); i = j + 1
        else: out.append(c); i += 1
    return ''.join(out)

rtypes = set()
for f in sorted(rdir.rglob('*.cs')):
    rtypes |= set(re.findall(r'\b(?:class|struct|enum|interface)\s+(\w+)', f.read_text()))
rtypes -= {'Extensions'}

def members(path):
    raw = path.read_text(); text = strip(raw)
    cm = re.search(r'\b(?:partial\s+)?class\s+(\w+)[^{;]*\{', text)
    if not cm: return {}
    cls = cm.group(1); depth = 0; start = cm.end(); i = start; res = {}; header_start = start
    n = len(text)
    while i < n:
        c = text[i]
        if c == '{':
            header = text[header_start:i]
            if '=' in header and '=>' not in header.split('=')[0]:       # initializer: field `= { ... };` / `= new T { ... };`
                j = i; d = 0
                while j < n:
                    if text[j] == '{': d += 1
                    elif text[j] == '}': d -= 1
                    elif text[j] == ';' and d == 0: break
                    j += 1
                add(res, cls, header, text[header_start:j + 1]); i = j + 1; header_start = i; continue
            j = i; d = 0
            while j < n:
                if text[j] == '{': d += 1
                elif text[j] == '}':
                    d -= 1
                    if d == 0: break
                j += 1
            add(res, cls, header, text[header_start:j + 1]); i = j + 1; header_start = i; continue
        if c == '}': break                      # end of the class
        if c == ';':
            add(res, cls, text[header_start:i], text[header_start:i + 1]); header_start = i + 1
        elif text[i:i + 2] == '=>' and '(' in text[header_start:i] and '=' not in text[header_start:i]:   # expression-bodied method
            j = text.index(';', i); depth_ = 0
            for k in range(i, j):
                depth_ += (text[k] in '({[') - (text[k] in ')}]')
            while depth_ != 0 and j < n:
                j = text.index(';', j + 1)
                depth_ = sum((ch in '({[') - (ch in ')}]') for ch in text[i:j])
            add(res, cls, text[header_start:i], text[header_start:j + 1]); i = j + 1; header_start = i; continue
        i += 1
    return res

def add(res, cls, header, body):
    h = re.sub(r'\[[^\]]*\]', ' ', header)                    # drop attributes
    h = re.sub(r'\s+', ' ', h).strip()
    if not h: return
    m = re.search(r'(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?:where [^{]*)?$', h)
    if m and '=' not in h.split('(')[0]: name = f'{m.group(1)}({re.sub(chr(32), "", m.group(2))})'
    else:
        t = re.search(r'\b(?:class|struct|enum|interface)\s+(\w+)', h)
        if t: name = 'type ' + t.group(1)
        else:
            f = re.match(r'(?:.*?\s)?(\w+)\s*(?:=.*)?$', h.split('=')[0].strip() + ' ')
            name = 'field ' + (re.findall(r'(\w+)', h.split('=')[0])[-1] if re.findall(r'(\w+)', h.split('=')[0]) else '?')
    key = f'{cls}.{name}'
    norm = re.sub(r'\s+', '', body)
    refs = sorted(set(re.findall(r'\b(' + '|'.join(sorted(map(re.escape, rtypes), key=len, reverse=True)) + r')\b(?:\.(\w+))?', body)) if rtypes else [])
    refs = sorted({a + ('.' + b if b else '') for a, b in refs})
    k = key; c = 2
    while k in res: k = f'{key}#{c}'; c += 1               # overload of the same name and params: keep order
    res[k] = {'sha': hashlib.sha256(norm.encode()).hexdigest()[:16], 'refs': hashlib.sha256('\n'.join(refs).encode()).hexdigest()[:16], '_refs': refs}

cur = {}
for f in sorted(edir.glob('NativeRemesherWindow*.cs')): cur.update(members(f))
known = json.loads(cfg.read_text()) if cfg.exists() else {}

if '--accept' in sys.argv:
    out = {}
    for k, v in sorted(cur.items()):
        old = known.get(k, {})
        status = old.get('status') or ('ui-only' if not v['_refs'] else 'pending:untriaged')
        e = {'status': status, 'sha': v['sha'], 'refs': v['refs']}
        if 'portedAs' in old: e['portedAs'] = old['portedAs']
        out[k] = e
    cfg.parent.mkdir(exist_ok=True); cfg.write_text(json.dumps(out, indent=1) + '\n')
    print(f'accepted {len(out)} members ({sum(1 for v in out.values() if v["status"].startswith("ported"))} ported, '
          f'{sum(1 for v in out.values() if v["status"].startswith("pending"))} pending, {sum(1 for v in out.values() if v["status"] == "ui-only")} ui-only)'); sys.exit(0)

errors = []
for k, v in sorted(cur.items()):
    if k not in known: errors.append(f'NEW member {k} (touches: {", ".join(v["_refs"][:6]) or "no Runtime API"}): triage it, then --accept'); continue
    s = known[k]['status']
    if s == 'ui-only':
        if known[k]['refs'] != v['refs']: errors.append(f'{k} is ui-only but the Runtime API it touches CHANGED: {", ".join(v["_refs"][:8])}')
    elif known[k]['sha'] != v['sha']:
        errors.append(f'{k} CHANGED ({s}' + (f', ported as {known[k]["portedAs"]}' if 'portedAs' in known[k] else '') + '): re-read it and update the web port')
for k in sorted(set(known) - set(cur)): errors.append(f'{k} was REMOVED or renamed upstream ({known[k]["status"]})')
st = lambda p: sum(1 for k in cur if k in known and known[k]['status'].startswith(p))
print(f'editor members {len(cur)}: ported {st("ported")}, pending {st("pending")}, n/a {st("n/a")}, ui-only {st("ui-only")}')
for e in errors: print('DRIFT', e)
sys.exit(1 if errors else 0)
