#!/usr/bin/env python3
"""Cross-host gate (browser vs CoreCLR). Same polygons (a cyclic rotation of a face's corners is the same polygon),
every vertex within MAX of a mean quad edge (default 0.10) and 99% within P99 (default 0.01).
Last-bit libm differences cannot be removed (docs/findings.md #5), so this replaces bit equality ACROSS hosts; same-host runs use the exact hash.
usage: compare_obj.py a.obj b.obj [max_edge=0.10] [p99_edge=0.01]"""
import math, struct, sys
def f32(x): return struct.unpack('f', struct.pack('f', x))[0]   # OBJ text is decimal: compare the float32 each side meant
def rd(p):
    v, f = [], []
    for l in open(p):
        t = l.split()
        if not t: continue
        if t[0] == 'v': v.append(tuple(f32(float(x)) for x in t[1:4]))
        elif t[0] == 'f': f.append(tuple(int(x.split('/')[0]) - 1 for x in t[1:]))
    return v, f
def canon(f):
    i = f.index(min(f)); return f[i:] + f[:i]
a, b = rd(sys.argv[1]), rd(sys.argv[2]); mx_lim = float(sys.argv[3]) if len(sys.argv) > 3 else 0.10; p99_lim = float(sys.argv[4]) if len(sys.argv) > 4 else 0.01
if len(a[0]) != len(b[0]) or len(a[1]) != len(b[1]): print('FAIL size differs (verts %d/%d, faces %d/%d)' % (len(a[0]), len(b[0]), len(a[1]), len(b[1]))); sys.exit(1)
rot = sum(1 for x, y in zip(a[1], b[1]) if x != y)
bad = sum(1 for x, y in zip(a[1], b[1]) if canon(x) != canon(y) and canon(x)[::-1] != canon(y))
if bad: print('FAIL %d faces are different polygons' % bad); sys.exit(1)
E = [math.dist(a[0][f[i]], a[0][f[(i + 1) % len(f)]]) for f in a[1] for i in range(len(f))]; mean = sum(E) / len(E) or 1
d = sorted(math.dist(p, q) / mean for p, q in zip(a[0], b[0]))
mx, p99 = d[-1], d[int(0.99 * (len(d) - 1))]
same = sum(1 for x in d if x == 0)
ok = mx <= mx_lim and p99 <= p99_lim
print('%s: same polygons (%d re-started), %d/%d verts bit-identical, p99 %.1e edge, max %.1e edge' % ('OK' if ok else 'FAIL', rot, same, len(d), p99, mx)); sys.exit(0 if ok else 1)
