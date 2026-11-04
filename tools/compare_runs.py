#!/usr/bin/env python3
"""Compare two benchmark CSVs row by row. Ignores timing/memory/sha columns.
usage: compare_runs.py A.csv B.csv [--rel 0.02]
Prints rows with differing outFaces and a per-column count of relative differences above the tolerance."""
import csv, sys
IGNORE = {'topologyMs','orientationMs','positionMs','extractionMs','totalMs','gitSha','unityVer','notes','managedBytesDelta'}
def load(p):
    rows = list(csv.DictReader(open(p)))
    return {(r['mesh'], r['target'], r['profile'], r['variant']): r for r in rows}
def num(x):
    try: return float(x)
    except: return None
def main():
    a, b = load(sys.argv[1]), load(sys.argv[2])
    rel = float(sys.argv[sys.argv.index('--rel')+1]) if '--rel' in sys.argv else 0.02
    keys = sorted(set(a) & set(b))
    print(f"rows: A={len(a)} B={len(b)} common={len(keys)}")
    ident = 0; face_diff = []; coldiff = {}
    for k in keys:
        ra, rb = a[k], b[k]; same = True
        for c in ra:
            if c in IGNORE or c not in rb: continue
            x, y = num(ra[c]), num(rb[c])
            if x is None or y is None:
                if ra[c] != rb[c]: same = False
                continue
            if x == y: continue
            same = False
            d = abs(x - y) / max(abs(x), abs(y), 1e-12)
            if d > rel: coldiff[c] = coldiff.get(c, 0) + 1
        if same: ident += 1
        if ra['outFaces'] != rb['outFaces']: face_diff.append((k[0], k[1], ra['outFaces'], rb['outFaces']))
    print(f"bit-identical rows (ignoring timings): {ident}/{len(keys)}")
    print(f"rows with different outFaces: {len(face_diff)}")
    for f in face_diff[:12]: print("  ", f)
    print(f"columns with >{rel:.0%} relative difference (count of rows):")
    for c, n in sorted(coldiff.items(), key=lambda t: -t[1])[:15]: print(f"   {c}: {n}")
main()
