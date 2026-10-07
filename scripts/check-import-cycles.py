#!/usr/bin/env python3
"""Fails (exit 1) if (a) any relative import/dynamic import() path does not resolve to a file,
or (b) the static ES-module import graph under core/ ui/ bal/ dal/
contains a cycle. Upward calls must go through core/ports.js instead.
Run: python3 scripts/check-import-cycles.py   (also: npm run check:cycles)"""
import os, re, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(root); sys.setrecursionlimit(10000)
files = [os.path.normpath(os.path.join(dp, f)) for d in ('core','ui','bal','dal') for dp,_,fs in os.walk(d) for f in fs if f.endswith('.js')]
g = {}
for f in files:
    s = open(f, encoding='utf-8', errors='replace').read()
    g[f] = [os.path.normpath(os.path.join(os.path.dirname(f), m.group(1)))
            for m in re.finditer(r"^\s*(?:import|export)\s(?:[^;]*?\sfrom\s)?['\"](\.[^'\"]+)['\"]", s, re.M)]

# (a) every relative static OR dynamic import must resolve to a real file
broken = []
for f in files:
    s = open(f, encoding='utf-8', errors='replace').read()
    for m in re.finditer(r"""(?:import\(\s*|from\s+|import\s+)['"](\.[^'"]+)['"]""", s):
        t = os.path.normpath(os.path.join(os.path.dirname(f), m.group(1)))
        if not os.path.exists(t): broken.append((f, m.group(1)))
if broken:
    for f, p in broken: print('UNRESOLVED IMPORT:', f, '->', p)
    sys.exit(1)
idx, low, st, on, res, c = {}, {}, [], set(), [], [0]
def sc(v):
    idx[v] = low[v] = c[0]; c[0] += 1; st.append(v); on.add(v)
    for w in g.get(v, []):
        if w not in g:
            continue
        if w not in idx: sc(w); low[v] = min(low[v], low[w])
        elif w in on: low[v] = min(low[v], idx[w])
    if low[v] == idx[v]:
        comp = []
        while True:
            w = st.pop(); on.discard(w); comp.append(w)
            if w == v: break
        if len(comp) > 1: res.append(sorted(comp))
for v in g:
    if v not in idx: sc(v)
if res:
    for comp in res: print('IMPORT CYCLE (%d files):' % len(comp), *comp, sep='\n  ')
    sys.exit(1)
print('import graph acyclic (%d modules)' % len(g))
