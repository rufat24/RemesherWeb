#!/usr/bin/env python3
"""Cross-host gate (browser vs CoreCLR): faces identical, every vertex within TOL x model extent (default 1e-3).
Same-host regression uses the exact hash instead. usage: compare_obj.py a.obj b.obj [tol=1e-3]"""
import struct, sys
def f32(x): return struct.unpack('f', struct.pack('f', x))[0]
def ordered(x): i = struct.unpack('i', struct.pack('f', x))[0]; return i if i >= 0 else -(i & 0x7fffffff)
def rd(p):
    v, f = [], []
    for l in open(p):
        t = l.split()
        if not t: continue
        if t[0] == 'v': v.append(tuple(f32(float(x)) for x in t[1:4]))
        elif t[0] == 'f': f.append(tuple(int(x.split('/')[0]) for x in t[1:]))
    return v, f
a, b = rd(sys.argv[1]), rd(sys.argv[2]); tol = float(sys.argv[3]) if len(sys.argv) > 3 else 1e-3
if len(a[0]) != len(b[0]) or a[1] != b[1]: print('FAIL topology differs (verts %d/%d, faces equal=%s)' % (len(a[0]), len(b[0]), a[1] == b[1])); sys.exit(1)
ulps = [max(abs(ordered(x) - ordered(y)) for x, y in zip(p, q)) for p, q in zip(a[0], b[0])]
ext = max(max(p[i] for p in a[0]) - min(p[i] for p in a[0]) for i in range(3))
dist = [sum((x - y) ** 2 for x, y in zip(p, q)) ** .5 for p, q in zip(a[0], b[0])]
n = sum(1 for u in ulps if u); mx = max(dist, default=0) / ext if ext else 0
ok = mx <= tol
print('%s: topology identical, %d/%d verts differ, max %d ulp, max displacement %.2e of extent' % ('OK' if ok else 'FAIL', n, len(ulps), max(ulps, default=0), mx)); sys.exit(0 if ok else 1)
