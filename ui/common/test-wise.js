// ui/common/test-wise.js — test-wise + subject-wise drill-down views (shared by
// Individual and Institution "One Student"/"One Subject"). Pure render from APP data.
import { APP } from '../../core/app-state.js';
import { esc } from '../../core/dom-helpers.js';
import { srT } from '../../core/render-i18n.js';
import { testMatrix } from '../../bal/common/report-data.js';

// i18n helper: translated string, else English default (keeps UI working before locale shards load)
const tt = (k, d, p) => { let s = srT(k, p); if (s === k) { s = d; if (p) Object.keys(p).forEach(x => { s = s.split('{{' + x + '}}').join(p[x]); }); } return s; };

const r1 = n => Math.round(n * 10) / 10;
// Calm palette: growth in green, steady in blue, "room to grow" in warm amber. Never alarm red.
const col = p => p >= 75 ? 'var(--c-success)' : p >= 50 ? '#3b82c4' : '#d98a1f';
const arrow = d => d == null ? '' : d > 0 ? `<span style="color:var(--c-success)">▲ ${r1(d)}</span>` : d < 0 ? `<span style="color:#d98a1f">▾ ${r1(Math.abs(d))}</span>` : '<span style="color:var(--c-text3)">● 0</span>';

// Per-test, per-subject numbers for one student (null where subject ${tt('tw_not_taken','not taken')}).
function testCells(st, ti) {
  const rows = testMatrix(st, APP.setup), r = rows[ti];
  return { t: r.t, cells: r.cells.map(c => c.v === null ? { s: c.s, v: null } : { s: c.s, v: c.v, m: c.m, p: c.p }), sc: r.sc, mx: r.mx, pct: r.pct, abs: r.absentDays, remark: r.remark };
}

// Like-for-like change vs the previous test: only subjects taken in BOTH tests.
function lfl(rows, i) {
  if (i < 1) return null;
  let a = 0, am = 0, b = 0, bm = 0, n = 0, cur = 0;
  rows[i].cells.forEach((c, si) => {
    if (c.v === null) return; cur++;
    const q = rows[i - 1].cells[si];
    if (q.v === null) return;
    n++; a += c.v; am += c.m; b += q.v; bm += q.m;
  });
  if (!n || !am || !bm) return null;
  return { d: a / am * 100 - b / bm * 100, n, extra: cur - n };
}
function bar(p, label) {
  return `<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:10px;background:var(--c-border);border-radius:5px;overflow:hidden"><div style="width:${Math.max(0, Math.min(100, p))}%;height:100%;background:${col(p)}"></div></div><span style="min-width:46px;text-align:right;font-weight:600;font-size:12.5px">${label}</span></div>`;
}

export function buildTestWiseHtml(st, sel) {
  const { tests } = APP.setup;
  if (!tests || !tests.length) return '';
  const rows = tests.map((_, i) => testCells(st, i));
  sel = (sel === undefined || sel === null || sel === 'all') ? 'all' : parseInt(sel, 10);
  const chip = (v, label) => `<button type="button" class="btn btn-sm ${v === sel ? 'btn-primary' : 'btn-secondary'}" data-action="pickTestView" data-arg="${esc(st.id)}|${v}">${esc(label)}</button>`;
  const chips = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px">${chip('all', tt('tw_overall_all','Overall (all tests)'))}${tests.map((t, i) => chip(i, t.name)).join('')}</div>`;
  let body = '';
  if (sel === 'all') {
    const trs = rows.map((r, i) => {
      const L = lfl(rows, i), d = L ? L.d : null;
      const ok = r.cells.filter(c => c.v !== null).sort((a, b) => b.p - a.p);
      return `<tr><td style="font-weight:600">${esc(r.t.name)}</td><td>${r.mx ? r1(r.sc) + '/' + r.mx : '-'}</td><td style="min-width:150px">${r.pct != null ? bar(r.pct, r1(r.pct) + '%') : '-'}</td><td>${arrow(d)}</td><td style="font-size:12px">${ok.length ? esc(ok[0].s) + ' ' + r1(ok[0].p) + '%' : '-'}</td><td style="font-size:12px">${ok.length > 1 ? esc(ok[ok.length - 1].s) + ' ' + r1(ok[ok.length - 1].p) + '%' : '-'}</td><td>${r.abs}</td></tr>`;
    }).join('');
    const subs = APP.setup.subjects;
    const heat = `<div class="tbl-wrap" style="margin-top:12px"><table class="data-table"><thead><tr><th>${tt('tw_th_subject','Subject')}</th>${tests.map(t => `<th>${esc(t.name)}</th>`).join('')}<th>${tt('tw_th_avg','Avg')}</th><th>${tt('tw_th_change','Change')}</th></tr></thead><tbody>${subs.map((s, si) => {
      const ps = rows.map(r => r.cells[si].v === null ? null : r.cells[si].p), v = ps.filter(x => x !== null);
      const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, d = v.length > 1 ? v[v.length - 1] - v[0] : null;
      return `<tr><td style="font-weight:600">${esc(s)}</td>${ps.map(p => `<td style="${p === null ? 'color:var(--c-text3)' : 'font-weight:600;color:' + col(p)}">${p === null ? '-' : r1(p) + '%'}</td>`).join('')}<td style="font-weight:700">${avg === null ? '-' : r1(avg) + '%'}</td><td>${arrow(d)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
    const notes = rows.map((_, i) => lfl(rows, i)).filter(L => L && L.extra > 0);
    const note = notes.length ? `<div style="font-size:11.5px;color:var(--c-text3);margin:6px 0">${esc(tt('tw_common_note', 'Compared on {{n}} common subject(s) only; {{m}} subject(s) not in the previous test are left out.', { n: notes[0].n, m: notes[0].extra }))}</div>` : '';
    body = `<div class="tbl-wrap"><table class="data-table"><thead><tr><th>${tt('tw_th_test','Test')}</th><th>${tt('tw_th_total','Total')}</th><th>${tt('tw_th_score_pct','Score %')}</th><th>${tt('tw_th_vs_prev','vs prev')}</th><th>${tt('tw_th_best','Best subject')}</th><th>${tt('tw_th_weakest','Next growth area')}</th><th>${tt('tw_th_absent','Absent')}</th></tr></thead><tbody>${trs}</tbody></table></div>${note}
      <div class="card-title" style="margin-top:14px">${tt('tw_subject_x_test','Subject × Test (%)')}</div>${heat}`;
  } else {
    const r = rows[sel], prev = sel > 0 ? rows[sel - 1] : null;
    const L = lfl(rows, sel), d = L ? L.d : null;
    const avgAll = (st.analysis && st.analysis.overallAvg != null) ? st.analysis.overallAvg : null;
    const sRows = r.cells.map((c, si) => {
      if (c.v === null) return `<tr><td>${esc(c.s)}</td><td colspan="4" style="color:var(--c-text3)">${tt('tw_not_taken','not taken')}</td></tr>`;
      const pc = prev && prev.cells[si].v !== null ? c.p - prev.cells[si].p : null;
      return `<tr><td style="font-weight:600">${esc(c.s)}</td><td>${r1(c.v)}/${c.m}</td><td style="min-width:150px">${bar(c.p, r1(c.p) + '%')}</td><td>${arrow(pc)}</td></tr>`;
    }).join('');
    const ok = r.cells.filter(c => c.v !== null).sort((a, b) => b.p - a.p);
    const kpi = (l, v) => `<div class="card" style="padding:10px 14px;flex:1;min-width:120px"><div style="font-size:11px;color:var(--c-text3);text-transform:uppercase">${l}</div><div style="font-size:20px;font-weight:700">${v}</div></div>`;
    body = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">${kpi(tt('tw_kpi_score','Score'), r.mx ? r1(r.sc) + '/' + r.mx : '-')}${kpi(tt('tw_kpi_pct','Percentage'), r.pct != null ? r1(r.pct) + '%' : '-')}${kpi(tt('tw_kpi_vs_prev_test','vs previous test'), prev ? (arrow(d) || '-') : tt('tw_first_test','first test'))}${kpi(tt('tw_kpi_vs_overall','vs overall avg'), (r.pct != null && avgAll != null) ? arrow(r.pct - avgAll) : '-')}${kpi(tt('tw_kpi_absent_days','Absent days'), r.abs)}</div>
      <div class="tbl-wrap"><table class="data-table"><thead><tr><th>${tt('tw_th_subject','Subject')}</th><th>${tt('tw_th_marks','Marks')}</th><th>${tt('tw_th_score_pct','Score %')}</th><th>${tt('tw_th_vs_previous','vs previous')}</th></tr></thead><tbody>${sRows}</tbody></table></div>
      ${ok.length ? `<p style="font-size:12.5px;margin-top:10px"><strong>${tt('tw_strongest','Strongest')}:</strong> ${esc(ok[0].s)} (${r1(ok[0].p)}%) · <strong>${tt('tw_needs_attention','Next focus')}:</strong> ${esc(ok[ok.length - 1].s)} (${r1(ok[ok.length - 1].p)}%)</p>` : ''}
      ${L && L.extra > 0 ? `<p style="font-size:11.5px;color:var(--c-text3)">${esc(tt('tw_common_note', 'Compared on {{n}} common subject(s) only; {{m}} subject(s) not in the previous test are left out.', { n: L.n, m: L.extra }))}</p>` : ''}
      ${r.remark ? `<p style="font-size:12.5px"><strong>${tt('tw_remark','Remark')}:</strong> ${esc(r.remark)}</p>` : ''}`;
  }
  return `<div class="tw-host card" data-sid="${esc(st.id)}" style="padding:14px 16px;margin-top:14px"><div class="card-title">${tt('tw_title','Test-wise Performance')}</div>${chips}${body}</div>`;
}

export function pickTestView(arg, el) {
  const [sid, v] = String(arg).split('|');
  const st = (APP.students || []).find(s => String(s.id) === sid);
  const host = el && el.closest ? el.closest('.tw-host') : null;
  if (!st || !host) return;
  host.outerHTML = buildTestWiseHtml(st, v);
}

// Subjects & Marks: expandable per-subject drill-down across tests.
export function buildSubjectTestBreakdownHtml(st) {
  const { subjects, tests } = APP.setup;
  const rows = tests.map((_, i) => testCells(st, i));
  const items = subjects.map((s, si) => {
    const pts = rows.map((r, i) => ({ t: tests[i].name, c: r.cells[si] }));
    const v = pts.filter(p => p.c.v !== null);
    if (!v.length) return '';
    const avg = v.reduce((a, p) => a + p.c.p, 0) / v.length, d = v.length > 1 ? v[v.length - 1].c.p - v[0].c.p : null;
    const best = v.reduce((a, p) => p.c.p > a.c.p ? p : a), worst = v.reduce((a, p) => p.c.p < a.c.p ? p : a);
    return { s, avg, html: `<details class="card" style="padding:8px 14px;margin-bottom:8px"><summary style="cursor:pointer;display:flex;justify-content:space-between;gap:10px;font-weight:600"><span>${esc(s)}</span><span style="color:${col(avg)}">${r1(avg)}% ${arrow(d)}</span></summary>
      <div class="tbl-wrap" style="margin-top:8px"><table class="data-table"><thead><tr><th>${tt('tw_th_test','Test')}</th><th>${tt('tw_th_marks','Marks')}</th><th>${tt('tw_th_score_pct','Score %')}</th><th>${tt('tw_th_vs_previous','vs previous')}</th></tr></thead><tbody>${pts.map((p, i) => {
        if (p.c.v === null) return `<tr><td>${esc(p.t)}</td><td colspan="3" style="color:var(--c-text3)">${tt('tw_not_taken','not taken')}</td></tr>`;
        const pr = pts.slice(0, i).reverse().find(x => x.c.v !== null);
        return `<tr><td>${esc(p.t)}</td><td>${r1(p.c.v)}/${p.c.m}</td><td style="min-width:150px">${bar(p.c.p, r1(p.c.p) + '%')}</td><td>${pr ? arrow(p.c.p - pr.c.p) : ''}</td></tr>`;
      }).join('')}</tbody></table></div>
      <div style="font-size:12px;color:var(--c-text3);margin-top:6px">${tt('tw_best','Best')}: ${esc(best.t)} (${r1(best.c.p)}%) · ${tt('tw_lowest_test','Room to grow')}: ${esc(worst.t)} (${r1(worst.c.p)}%)</div></details>` };
  }).filter(Boolean).sort((a, b) => a.avg - b.avg);
  return items.length ? `<div class="card-title" style="margin-top:14px">${tt('tw_by_subject_title','Test-wise breakdown by subject')} <span style="font-weight:400;font-size:11px;color:var(--c-text3)">(${tt('tw_by_subject_hint','tap a subject to see its journey')})</span></div>${items.map(i => i.html).join('')}` : '';
}

// Institution "One Subject": class average per test for that subject.
export function buildSubjectClassByTestHtml(subject) {
  const { tests } = APP.setup, sts = APP.students || [];
  const rows = tests.map(t => {
    const vals = sts.map(st => { const d = st.testData && st.testData[t.name]; const v = d && d.marks ? d.marks[subject] : undefined; if (v === undefined || v === null || v === '') return null; return Math.min(100, (parseFloat(v) || 0) / ((t.maxMarks && t.maxMarks[subject]) || 100) * 100); }).filter(x => x !== null);
    return { t: t.name, n: vals.length, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, hi: vals.length ? Math.max(...vals) : null, lo: vals.length ? Math.min(...vals) : null };
  });
  if (!rows.some(r => r.avg !== null)) return '';
  return `<div class="card" style="padding:14px 16px;margin-top:14px"><div class="card-title">${esc(tt('tw_class_by_test','{{subject}} — test-wise class performance',{subject:subject}))}</div><div class="tbl-wrap"><table class="data-table"><thead><tr><th>${tt('tw_th_test','Test')}</th><th>${tt('tw_th_students','Students')}</th><th>${tt('tw_th_class_avg','Class avg')}</th><th>${tt('tw_th_vs_prev','vs prev')}</th><th>${tt('tw_th_highest','Highest')}</th><th>${tt('tw_th_lowest','Lowest')}</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td style="font-weight:600">${esc(r.t)}</td><td>${r.n}</td><td style="min-width:150px">${r.avg === null ? '-' : bar(r.avg, r1(r.avg) + '%')}</td><td>${i > 0 && r.avg !== null && rows[i - 1].avg !== null ? arrow(r.avg - rows[i - 1].avg) : ''}</td><td>${r.hi === null ? '-' : r1(r.hi) + '%'}</td><td>${r.lo === null ? '-' : r1(r.lo) + '%'}</td></tr>`).join('')}</tbody></table></div></div>`;
}
