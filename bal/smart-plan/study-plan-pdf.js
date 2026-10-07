// bal/smart-plan/study-plan-pdf.js  (Smart Planner task 04)
// One PDF per student: standard report card + AI-assisted study plan, no page cap.
// Identity (name, institution, rank, marks) comes ONLY from local data - never from the LLM response.
// Reuses PDF_THEME / pdfRule / fitText / stampFooterAllPages / sanitizePdfDoc from export-pdf.js (no new palette).
// BAL: no page DOM. The caller (UI) triggers the actual download.
import { PDF_THEME, pdfRule, fitText, stampFooterAllPages, sanitizePdfDoc } from '../export/export-pdf.js';
import { hasValidMark, isEnteredMark } from './eligibility.js';

const W = 210, H = 297, M = 10, CW = W - 2 * M;
const safeName = n => String(n || '').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
const r1 = n => { const v = Math.round(n * 10) / 10; return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + '%'; };
const URGENT_RE = /parent/i;
// Typographic punctuation outside Latin-1 would push a whole line through sanitizePdfDoc's canvas fallback
// (different font + wrap metrics). Map it to plain equivalents; genuinely non-Latin scripts are left alone.
const latin = t => String(t == null ? '' : t).replace(/[\u2013\u2014]/g, ' - ').replace(/\u2192/g, '->').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, '...').replace(/\u00a0/g, ' ').replace(/ {2,}/g, ' ');
function latinDeep(v) {
  if (typeof v === 'string') return latin(v);
  if (Array.isArray(v)) return v.map(latinDeep);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = latinDeep(v[k]); return o; }
  return v;
}

// ---------- pure model (no drawing; unit-testable) ----------
function validMarks(td) {
  const out = {};
  for (const [s, v] of Object.entries((td && td.marks) || {})) if (isEnteredMark(v)) out[s] = v;     // a real entered 0 is shown and averaged
  return out;
}
function pooled(student, setup, testNames, subject) {
  const maxBy = new Map((setup.tests || []).map(t => [t.name, t.maxMarks || {}]));
  let sc = 0, mx = 0;
  for (const tn of testNames) {
    const td = (student.testData || {})[tn]; const vm = validMarks(td); const max = maxBy.get(tn) || {};
    for (const s of Object.keys(vm)) { if (subject && s !== subject) continue; sc += vm[s]; mx += (max[s] || 100); }
  }
  return mx ? sc / mx * 100 : null;
}
// Rank / class average over the SELECTED tests, for every roster student who has valid marks in them.
function computeStandings(students, setup, testNames) {
  const rows = [];
  for (const st of students || []) {
    const tn = testNames.filter(t => hasValidMark((st.testData || {})[t]));
    const p = tn.length ? pooled(st, setup, tn) : null;
    if (p != null) rows.push({ id: st.id, pct: p });
  }
  rows.sort((a, b) => b.pct - a.pct);
  const byId = {};
  const classAvg = rows.length ? rows.reduce((a, r) => a + r.pct, 0) / rows.length : null;
  rows.forEach((r, i) => { byId[r.id] = { rank: i > 0 && rows[i - 1].pct === r.pct ? byId[rows[i - 1].id].rank : i + 1, total: rows.length, classAvg }; });
  return { byId, classAvg, total: rows.length };
}
// SUBJECT-wise chapters -> one compact cell: "Math: Fractions & Decimals; Sci: Heat" (legacy single chapter as-is)
const abbrev = s => /^math/i.test(s) ? 'Math' : String(s).split(/\s+/)[0].slice(0, 4);
function chapterCell(td, subjects) {
  const chs = (td && td.chapters) || {};
  const parts = subjects.filter(sj => chs[sj]).map(sj => abbrev(sj) + ': ' + chs[sj]);
  return parts.length ? parts.join('\n') : ((td && td.chapter) || '');
}
function buildReportModel(student, plan, setup, standing, testNamesSelected) {
  if (!plan || !plan.summary) throw new Error('Smart Planner: cannot build a report for ' + (student && student.id) + ' - no parsed study-plan content');
  const pass = setup.passThreshold != null ? Number(setup.passThreshold) : 35;
  const maxBy = new Map((setup.tests || []).map(t => [t.name, t.maxMarks || {}]));
  const tnames = testNamesSelected.filter(t => hasValidMark((student.testData || {})[t]));
  const short = n => { const p = (String(setup.className || '') + String(setup.section || '')).replace(/[^a-zA-Z0-9]/g, '').slice(0, 18).toLowerCase(); return p && String(n).toLowerCase().startsWith(p + '-') ? String(n).slice(p.length + 1) : String(n); };
  const subjects = (setup.subjects || []).filter(s => tnames.some(t => validMarks(student.testData[t])[s] !== undefined));
  const tests = tnames.map(tn => {
    const td = student.testData[tn]; const vm = validMarks(td); const max = maxBy.get(tn) || {};
    const marks = {}; subjects.forEach(s => { marks[s] = vm[s] !== undefined ? { score: vm[s], max: max[s] || 100 } : null; });
    return { name: short(tn), chapter: chapterCell(td, subjects), remark: td.remark || '', absents: td.absents || 0, marks, pct: pooled(student, setup, [tn]) };
  });
  const overall = pooled(student, setup, tnames);
  const subjectRows = subjects.map(s => {
    const trend = tnames.map(t => { const v = validMarks(student.testData[t])[s]; return v === undefined ? null : Math.round(v / ((maxBy.get(t) || {})[s] || 100) * 100); }).filter(v => v !== null);
    return { name: s, avg: pooled(student, setup, tnames, s), trend };
  });
  const below = tests.filter(t => t.pct != null && t.pct < pass).length;
  const flagged = tests.filter(t => URGENT_RE.test(t.remark)).length;
  let severity = 'none', banner = '';
  const times = n => n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times';
  if (overall != null && overall < pass) {
    severity = 'critical';
    banner = 'URGENT - ' + (below === tests.length ? 'Below pass threshold all term' : 'Below pass threshold in ' + below + ' of ' + tests.length + ' tests') + (flagged ? '; teacher has flagged this ' + times(flagged) + ' for parent involvement' : '') + '.';
  } else if (below > 0) {
    severity = 'attention';
    banner = 'NOTE \u2014 Below pass threshold in ' + below + ' of ' + tests.length + ' tests.';
  }
  // plan section; claims flagged by the evidence-containment check are NOT printed as if verified
  const flags = plan.flags || [];
  const notes = subjects.map(s => {
    const raw = (plan.subjectNotes || {})[s] || '';
    const bad = flags.filter(f => f.subject && f.subject.toLowerCase() === s.toLowerCase());
    let text = raw.replace(/^\s*\d+%(\s*(\u2192|->)\s*\d+%)*[.,;:]?\s*/, '');         // trend is drawn from real data instead
    bad.forEach(f => { const sent = String(f.sentence || '').replace(/^\s*\d+%(\s*(\u2192|->)\s*\d+%)*[.,;:]?\s*/, ''); if (sent) text = text.split(sent).join(''); });
    return { subject: s, note: text.replace(/\s{2,}/g, ' ').trim(), unverified: bad.length > 0 };
  });
  return {
    header: { name: student.name || student.id, id: student.id, basedOn: tests.length, firstTest: (tests[0] || {}).name || '', lastTest: (tests[tests.length - 1] || {}).name || '' },
    tests, subjects: subjectRows, overall, rank: standing && standing.rank, total: standing && standing.total, classAvg: standing && standing.classAvg, pass, severity, banner,
    plan: { summary: plan.summary, notes, focus: (plan.focusAreas || []).join('\n'), nextSteps: plan.nextSteps || [], parentNote: plan.parentNote },
  };
}

// ---------- drawing ----------
const T = PDF_THEME;
function drawStudyPlanPDF(doc, rawModel, setup) {
  const model = latinDeep(rawModel);
  setup = latinDeep(setup);
  let y = 0;
  const ensure = h => { if (y + h > H - 16) { doc.addPage(); y = 16; } };
  const text = (t, x, yy, o) => doc.text(String(t), x, yy, o);
  const para = (str, x, w, size, lh, color, style) => {
    doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size); doc.setTextColor(...(color || T.INK));
    const lines = doc.splitTextToSize(String(str), w);
    lines.forEach(l => { ensure(lh); text(l, x, y); y += lh; });
  };
  const label = s => { ensure(14); y += 4; doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...T.INK); text(s, M, y); y += 1.6; pdfRule(doc, M, y, W - M, 0.6, T.LINE); y += 5; };

  // header
  doc.setTextColor(...T.ACCENT); doc.setFontSize(10); doc.setFont('helvetica', 'bold'); text('Student Insight', M + 2, 12);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...T.INK_SOFT);
  text(setup.instName || '', W - M - 2, 12, { align: 'right' });
  text('Class ' + String(setup.className || '').replace(/^Class\s*/i, '') + (setup.section ? ', Section ' + setup.section : '') + (setup.year ? '  \u00b7  ' + setup.year : ''), W - M - 2, 19, { align: 'right' });
  text('Generated: ' + new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), W - M - 2, 26, { align: 'right' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...T.INK); text('Progress Report & Study Plan', M + 2, 24);
  doc.setFontSize(11.5); text(model.header.name, M + 2, 32);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...T.INK_SOFT);
  text('Student ID: ' + model.header.id + '  \u00b7  Based on ' + model.header.basedOn + ' test' + (model.header.basedOn === 1 ? '' : 's') + ' this term' + (model.header.basedOn > 1 ? ' (' + model.header.firstTest + ' to ' + model.header.lastTest + ')' : ''), M + 2, 37);
  y = 43;
  if (model.banner) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...(model.severity === 'critical' ? T.DANGER : T.WARN));
    text(fitText(doc, model.banner, CW), M + 2, y); y += 3;
  }
  pdfRule(doc, M, y, W - M, 1.2, T.INK); y += 1;

  // KPI row (ruled boxes, no fills)
  const kh = 16, cw3 = CW / 3;
  doc.setDrawColor(...T.LINE); doc.setLineWidth(0.3); doc.rect(M, y, CW, kh); doc.line(M + cw3, y, M + cw3, y + kh); doc.line(M + 2 * cw3, y, M + 2 * cw3, y + kh);
  const avgColor = model.overall >= 80 ? T.GOOD : model.overall >= model.pass ? T.ACCENT : T.DANGER;
  [[model.overall != null ? r1(model.overall) : '-', 'OVERALL PERFORMANCE', avgColor], [model.rank ? model.rank + ' / ' + model.total : '-', 'CLASS RANK', T.ACCENT], [model.classAvg != null ? r1(model.classAvg) : '-', 'CLASS AVERAGE', T.ACCENT]].forEach((k, i) => {
    const cx = M + cw3 * i + cw3 / 2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...k[2]); text(k[0], cx, y + 7.5, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...T.INK_SOFT); text(k[1], cx, y + 12.5, { align: 'center' });
  });
  y += kh + 7;

  // subject performance bars (same colour thresholds as buildStudentPDF)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...T.INK);
  text('SUBJECT PERFORMANCE (Average Across All ' + model.header.basedOn + ' Test' + (model.header.basedOn === 1 ? '' : 's') + ')', M, y); y += 2; pdfRule(doc, M, y, W - M, 0.6, T.LINE); y += 6;
  const labelX = M + 28, barX = M + 66, barW = 62;
  model.subjects.forEach(s => {
    ensure(9);
    const c = s.avg >= 80 ? T.GOOD : s.avg >= model.pass ? T.ACCENT : T.DANGER;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...T.INK); text(fitText(doc, s.name, 36), labelX, y + 2.4);
    doc.setFillColor(237, 237, 244); doc.roundedRect(barX, y, barW, 3.2, 0.8, 0.8, 'F');
    doc.setFillColor(...c); doc.roundedRect(barX, y, Math.max(0.8, barW * Math.min(1, (s.avg || 0) / 100)), 3.2, 0.8, 0.8, 'F');
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...T.INK_SOFT); text(s.avg != null ? r1(s.avg) : '-', barX + barW + 10, y + 2.6);
    y += 7;
  });
  y += 3;

  // all test scores table
  ensure(30); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...T.INK); text('ALL TEST SCORES', M, y); y += 4;
  const abbr = s => /^math/i.test(s) ? 'Math' : String(s).split(/\s+/)[0].slice(0, 3);
  const n = model.subjects.length, sw = n > 6 ? 13 : 15, testW = 24, chapW = 26;
  const remW = CW - testW - chapW - sw * n;
  const colX = [M]; [testW, chapW].concat(model.subjects.map(() => sw)).forEach((w, i, a) => colX.push(colX[i] + w));
  const widths = [testW, chapW].concat(model.subjects.map(() => sw), [remW]);
  doc.setFillColor(...T.ACCENT); doc.rect(M, y, CW, 6.5, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...T.WHITE);
  ['Test', 'Chapter'].concat(model.subjects.map(s => abbr(s.name)), ['Remark']).forEach((h, i) => text(h, colX[i] + 1.5, y + 4.3));
  y += 6.5;
  model.tests.forEach(t => {
    const cells = [t.name + (t.absents ? ' (' + t.absents + ' day' + (t.absents > 1 ? 's' : '') + ' absent)' : ''), t.chapter || '-'].concat(model.subjects.map(s => { const m = t.marks[s.name]; return m ? m.score + '/' + m.max : '-'; }), [t.remark || '']);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    const wrapped = cells.map((c, i) => doc.splitTextToSize(String(c), widths[i] - 3));
    const rh = Math.max(7, Math.max(...wrapped.map(w => w.length)) * 3.3 + 3);
    ensure(rh);
    doc.setDrawColor(...T.LINE); doc.setLineWidth(0.25); doc.rect(M, y, CW, rh);
    wrapped.forEach((lines, i) => {
      if (i > 0) doc.line(colX[i], y, colX[i], y + rh);
      const mk = i >= 2 && i < 2 + n ? t.marks[model.subjects[i - 2].name] : null;
      doc.setTextColor(...(mk && mk.score / mk.max * 100 < model.pass ? T.DANGER : T.INK));
      lines.forEach((l, j) => text(l, colX[i] + 1.5, y + 4.4 + j * 3.3));
    });
    y += rh;
  });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...T.INK_SOFT);
  y += 3.5; text('Pass threshold: ' + model.pass + '%  \u00b7  Class average: ' + (model.classAvg != null ? r1(model.classAvg) : '-'), M, y); y += 6;

  // AI-assisted study plan (new page only if it would not fit a heading + first lines)
  ensure(50); pdfRule(doc, M, y, W - M, 1.2, T.INK); y += 7;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...T.INK); text('AI-Assisted Study Plan', M, y); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...T.INK_SOFT); text('Built from the real marks and teacher remarks above', M, y); y += 2;
  const accent = model.severity === 'critical' ? T.DANGER : model.severity === 'attention' ? T.WARN : T.ACCENT;
  label('WHERE THINGS STAND'); para(model.plan.summary, M, CW, 9, 4.3);
  label('SUBJECT NOTES');
  model.plan.notes.forEach((nt, idx) => {
    const sub = model.subjects.find(s => s.name === nt.subject);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    const noteLines = nt.note ? doc.splitTextToSize(nt.note, 100) : [];
    const extra = nt.unverified ? doc.splitTextToSize('Unverified: a chapter claim for this subject did not match the logged data and was left out.', 100) : [];
    const rows = Math.max(1, noteLines.length + extra.length), rh = rows * 4.1 + 3;
    ensure(rh);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...T.INK); text(fitText(doc, nt.subject, 32), M, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...T.INK_SOFT); text(sub ? sub.trend.map(v => v + '%').join(' -> ') : '', M + 36, y);
    doc.setTextColor(...T.INK); noteLines.forEach((l, j) => text(l, M + 86, y + j * 4.1));
    doc.setFont('helvetica', 'italic'); doc.setTextColor(...T.WARN); extra.forEach((l, j) => text(l, M + 86, y + (noteLines.length + j) * 4.1));
    y += rh - 1; pdfRule(doc, M, y, W - M, 0.3, T.LINE); y += 4;
  });
  label('FOCUS AREAS'); para(model.plan.focus, M, CW, 9, 4.3);
  label('PATH TO NEXT TEST'); model.plan.nextSteps.forEach((s, i) => para((i + 1) + '. ' + s, M, CW, 9, 4.3));
  label('NOTE FOR PARENT');
  doc.setFont('helvetica', 'italic'); doc.setFontSize(9);
  const pl = doc.splitTextToSize(model.plan.parentNote, CW - 6); const ph = pl.length * 4.4 + 2;
  ensure(Math.min(ph, 40));
  const y0 = y - 3; pl.forEach(l => { ensure(4.4); doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...T.INK); text(l, M + 4, y); y += 4.4; });
  doc.setDrawColor(...accent); doc.setLineWidth(0.8); doc.line(M + 1, y0, M + 1, y - 2.2);
  stampFooterAllPages(doc, 'CONFIDENTIAL - For parent/guardian only', 8, H - 6);
  return doc;
}

function buildStudyPlanPDF(doc, student, plan, setup, standing, testNamesSelected) {
  const model = buildReportModel(student, plan, setup, standing, testNamesSelected);
  return drawStudyPlanPDF(sanitizePdfDoc(doc), model, setup);
}
function studyPlanFileName(student, setup, standing) {
  const rank = String((standing && standing.rank) || 0).padStart(2, '0');
  const parts = ['Rank-' + rank, safeName(student.name || student.id)];
  if (setup.className) parts.push(safeName(setup.className));
  if (setup.section) parts.push(safeName(setup.section));
  parts.push(safeName(String(student.id)));
  return parts.join('_') + '_Study_Plan.pdf';
}
// items: [{student, plan, standing}] - ONLY students that parsed (caller guarantees; otherwise this throws).
// deps: {jsPDF, JSZip}; returns {blob, fileName, count}. The UI layer performs the forced download.
async function buildStudyPlanZip(items, setup, testNamesSelected, deps, onProgress) {
  const zip = new deps.JSZip(); let i = 0;
  for (const it of items) {
    const doc = new deps.jsPDF('p', 'mm', 'a4');
    buildStudyPlanPDF(doc, it.student, it.plan, setup, it.standing, testNamesSelected);
    zip.file(studyPlanFileName(it.student, setup, it.standing), doc.output('blob'));
    i++; if (onProgress) onProgress(i, items.length);
    await new Promise(r => setTimeout(r, 0));
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const fileName = safeName((setup.instName || 'StudentInsight') + '_' + (setup.className || 'Class') + '_' + (setup.year || '2026')) + '_Study_Plans.zip';
  return { blob, fileName, count: items.length };
}

export { buildReportModel, computeStandings, buildStudyPlanPDF, buildStudyPlanZip, studyPlanFileName };
