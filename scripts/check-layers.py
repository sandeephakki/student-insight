#!/usr/bin/env python3
"""Enforces planner.md's layer rule for bal/ (business logic): no imports from ui/,
and no page-DOM / jQuery / toast / navigation use. Run: npm run check:layers
Documented exception: bal/export/export-pdf.js builds an OFFSCREEN <canvas> (not page DOM)
to rasterise non-Latin text for jsPDF."""
import glob, os, re, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); os.chdir(root)
bad = []
for f in sorted(glob.glob('bal/**/*.js', recursive=True)):
    f = f.replace(os.sep, '/')
    raw = open(f, encoding='utf-8', errors='replace').read()
    for m in re.finditer(r"""(?:import\(\s*|from\s+|import\s+)['"]([^'"]+)['"]""", raw):
        if re.search(r'(^|/)ui/', os.path.normpath(os.path.join(os.path.dirname(f), m.group(1))).replace(os.sep, '/')):
            bad.append((f, 'imports ui layer: ' + m.group(1)))
    code = re.sub(r'/\*.*?\*/', '', raw, flags=re.S)
    for i, line in enumerate(code.split('\n'), 1):
        t = line.strip()
        if t.startswith('//'): continue
        if f == 'bal/export/export-pdf.js' and 'document.createElement("canvas")' in t: continue   # documented exception
        t = re.sub(r"//.*$", '', t)
        t = re.sub(r"""(['"`])(?:\\.|(?!\1).)*\1""", "''", t)   # ignore string literals
        for pat, what in [(r'\bdocument\.', 'document.*'), (r'(?<![\w.])\$\(', 'jQuery $()'),
                          (r'(?<![\w.])toast\(', 'toast()'), (r'window\.(open|alert|confirm|location)\b', 'window.' + 'open/alert/confirm/location'),
                          (r'(?<![\w.])goStep\(', 'goStep()')]:
            if re.search(pat, t): bad.append((f, 'L%d %s: %s' % (i, what, line.strip()[:80])))
if bad:
    for f, why in bad: print('LAYER VIOLATION:', f, '-', why)
    sys.exit(1)
print('bal/ layer rule OK (no ui imports, no page-DOM/jQuery/toast/navigation)')
