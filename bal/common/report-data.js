// bal/common/report-data.js — pure data helpers shared by the PDF reports and the on-screen test-wise views (no DOM).
// Rules: a BLANK (or non-numeric, e.g. "AB") mark = absent for that paper: excluded from score AND maximum.
// Conclusions (change vs previous test, trend) compare ONLY subjects present in both tests ("like for like").
export const r1 = n => Math.round(n * 10) / 10;

export function testMatrix(st, setup) {
  const subs = setup.subjects || [], tests = setup.tests || [];
  return tests.map(t => {
    const td = (st.testData && st.testData[t.name]) || { marks: {} };
    let sc = 0, mx = 0, any = false;
    const cells = subs.map(s => {
      const raw = td.marks ? td.marks[s] : undefined;
      const m = (t.maxMarks && t.maxMarks[s]) || 100;
      const inTest = !t._effSubjects || t._effSubjects.includes(s);
      const f = (raw === undefined || raw === null || raw === '') ? NaN : parseFloat(raw);
      if (isNaN(f)) return { s, v: null, m, p: null, ab: inTest, inTest };
      const n = Math.min(Math.max(f, 0), m);
      sc += n; mx += m; any = true;
      return { s, v: n, m, p: n / m * 100, ab: false, inTest: true };
    });
    return { t, name: t.name, cells, sc, mx, pct: (any && mx) ? sc / mx * 100 : null, absentDays: td.absents || 0, remark: td.remark || '' };
  });
}

// Change between test i and the previous test that has a score, on common subjects only.
export function likeForLike(rows, i) {
  let j = i - 1;
  while (j >= 0 && rows[j].pct === null) j--;
  if (j < 0 || rows[i].pct === null) return null;
  let a = 0, am = 0, b = 0, bm = 0, n = 0, cur = 0;
  rows[i].cells.forEach((c, si) => {
    if (c.v === null) return; cur++;
    const q = rows[j].cells[si];
    if (q.v === null) return;
    n++; a += c.v; am += c.m; b += q.v; bm += q.m;
  });
  if (!n || !am || !bm) return null;
  return { d: a / am * 100 - b / bm * 100, n, extra: cur - n };
}

export function subjectSummary(rows, subs) {
  return subs.map((s, si) => {
    const ps = rows.map(r => r.cells[si].p);
    const v = ps.filter(x => x !== null);
    const avg = v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
    return { s, ps, avg, delta: v.length > 1 ? v[v.length - 1] - v[0] : null, count: v.length };
  });
}

// growing / steady / dip / first / nocmp (no common subjects)  (±3 points on common subjects)
export function trendInfo(rows) {
  const idx = rows.map((r, i) => r.pct !== null ? i : -1).filter(i => i >= 0);
  if (idx.length < 2) return { key: 'first', d: null, n: 0, extra: 0 };
  const L = likeForLike(rows, idx[idx.length - 1]);
  if (!L) return { key: 'nocmp', d: null, n: 0, extra: 0 };
  return { key: L.d >= 3 ? 'growing' : L.d <= -3 ? 'dip' : 'steady', d: L.d, n: L.n, extra: L.extra };
}
