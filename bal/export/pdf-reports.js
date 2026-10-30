// bal/export/pdf-reports.js - the Student, Teacher and Management PDF reports, all built on pdf-kit.js
// so every report shares one look: header, identity card, four tiles, subject strengths + trend, tables, two notes, footer.
// Tone: kind, hopeful, strengths-first. No grades on student reports, no forecasts, no rankings in individual mode, never red.
import { APP } from '../../core/app-state.js';
import { pdfT as T } from './export-pdf.js';
import { makeKit, C, toneOf, heat, LAYOUT } from './pdf-kit.js';
import { testMatrix, likeForLike, subjectSummary, trendInfo, r1 } from '../common/report-data.js';

const CARE_TYPES = ['burnout', 'absent', 'at-risk', 'first-below-pass'];
const NOTE_SKIP = ['info', 'warn', 'data-gap', 'data-error'];
const instLine = () => { const s = APP.setup || {}; return [s.instName, (s.className || '') + (s.section ? ' ' + s.section : ''), s.year].filter(Boolean).join(' · '); };
const classTitle = () => { const s = APP.setup || {}; return ((s.className || '') + (s.section ? ' ' + s.section : '')).trim() || s.instName || 'Class'; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const pct = n => n === null || n === undefined ? '-' : Math.round(n) + '%';

// shorten test names by dropping the prefix shared by all of them ("Class B - Monthly Test 1/2" -> "1"/"2"), else T1, T2...
function shortTests(names) {
  const list = names.map(n => String(n || '')); let pre = list[0] || '';
  list.forEach(n => { while (pre && !n.startsWith(pre)) pre = pre.slice(0, -1); });
  pre = pre.replace(/[A-Za-z0-9\u0080-\uFFFF]+$/, '');
  const abbr = w => w.length > 7 ? w.slice(0, 4) + '.' : w;
  return list.map((n, i) => { let r = n.slice(pre.length).trim(); if (r.length > 14) r = r.split(/\s+/).map(abbr).join(' '); const lab = list.length > 1 && r && r.length <= 14 ? r : 'T' + (i + 1); return /^\d+$/.test(lab) ? T('r_test_n', 'Test {{n}}', { n: lab }) : lab; });
}
const trendCell = key => key === 'growing' ? { t: T('r_growing', 'Growing'), arrow: 'up', fg: C.green } : key === 'dip' ? { t: T('r_small_dip', 'Small dip'), arrow: 'down', fg: C.amberT } : { t: T('r_steady', 'Steady'), arrow: 'flat', fg: C.blueT };
const trendFromAnalysis = t => t === 'improving' ? 'growing' : t === 'declining' ? 'dip' : 'steady';
const noteLabels = st => (st.flags || []).filter(f => !NOTE_SKIP.includes(f.type)).map(f => f.label).filter(Boolean);
function wellbeing(a) {
  const e = a.earlyWarningScore || 0;
  return e <= 0 ? { t: T('r_wb_calm', 'Calm'), fg: C.green } : e <= 20 ? { t: T('r_wb_light', 'Light check-in'), fg: C.blueT } : e < 50 ? { t: T('r_wb_check', 'Check-in'), fg: C.amberT } : { t: T('r_wb_extra', 'Extra care'), fg: C.amberT, bold: true };
}
const notesShort = st => { const l = noteLabels(st); return l.length ? l.slice(0, 3).join(', ') + (l.length > 3 ? ' +' + (l.length - 3) : '') : '-'; };
const careNeeded = st => (st.flags || []).some(f => CARE_TYPES.includes(f.type));
const supportText = st => { const ty = (st.flags || []).map(f => f.type); return ty.includes('absent') ? T('r_sup_absent', 'Catch up on missed lessons') : ty.includes('burnout') ? T('r_sup_rest', 'Rest, encouragement, short daily practice') : T('r_sup_guid', 'Extra guidance, small wins'); };

/* ───────────────────────── STUDENT (Individual + Institution) ───────────────────────── */
export function buildStudentPDF(doc, st) {
  const s = APP.setup || {}, a = st.analysis || {}, indiv = s.mode === 'individual';
  const first = String(st.name || '').split(' ')[0] || st.name;
  const sub = indiv ? [s.className, s.year].filter(Boolean).join(' · ') : instLine();
  const k = makeKit(doc, sub);
  const rows = testMatrix(st, s), subs = s.subjects || [];
  const taken = rows.filter(r => r.pct !== null), ss = subjectSummary(rows, subs).filter(x => x.avg !== null);
  const ranked = [...ss].sort((x, y) => y.avg - x.avg), best = ranked[0];
  const growth = ranked.length > 1 ? ranked.slice(-2).reverse() : [];
  const tr = trendInfo(rows), names = shortTests(rows.map(r => r.name));
  const overall = a.overallAvg != null ? a.overallAvg : (mean(taken.map(r => r.pct)) || 0);
  const absTotal = rows.reduce((x, r) => x + (r.absentDays || 0), 0);
  const bestTest = taken.length ? taken.reduce((m, r) => r.pct > m.pct ? r : m) : null;

  k.header(indiv ? T('r_chip_mine', 'My Progress Report') : T('r_chip_student', 'Student Progress Report'));
  const showPos = !indiv && a.rank && a.percentile != null;
  k.idCard({
    name: st.name, sub: indiv ? sub : T('pdf_student_id_label', 'Student ID: {{id}}', { id: st.id }),
    chip: showPos ? T('r_class_pos', 'Class position #{{rank}} of {{n}} · {{pct}}th percentile', { rank: a.rank, n: APP.students.length, pct: a.percentile }) : '',
    big: Math.round(overall) + '%', cap: T('r_overall_across', 'Overall across {{n}} tests', { n: taken.length }),
  });
  const latest = taken[taken.length - 1];
  const tcell = trendCell(tr.key);
  k.tiles([
    { label: T('r_best_subject', 'Best subject'), value: best ? best.s + ' ' + Math.round(best.avg) + '%' : '-', tone: best ? toneOf(best.avg) : 'n', cap: best && best.avg >= 60 ? T('r_real_strength', 'A real strength') : T('r_good_start', 'A good place to start') },
    { label: T('r_latest_test', 'Latest test'), value: tr.key === 'first' ? T('r_first_test', 'First test') : tr.key === 'nocmp' ? T('r_not_comp', 'Different subjects') : tcell.t, tone: tr.key === 'growing' ? 'g' : tr.key === 'dip' ? 'a' : 'b', cap: tr.key === 'nocmp' ? T('r_not_comp_d', 'No common subjects to compare') : tr.d === null ? T('r_great_start', 'A great starting point') : T('r_common_pts', '{{d}} pts, {{n}} common subjects', { d: (tr.d >= 0 ? '+' : '') + r1(tr.d), n: tr.n }) },
    { label: T('r_tests_taken', 'Tests taken'), value: String(taken.length), tone: 'b', cap: latest ? T('r_subjects_in_latest', '{{n}} subjects in the latest', { n: latest.cells.filter(c => c.v !== null).length }) : '' },
    { label: T('tw_kpi_absent_days', 'Absent days'), value: String(absTotal), tone: absTotal === 0 ? 'g' : 'b', cap: absTotal === 0 ? T('r_no_absences', 'No absences') : T('r_across_tests', 'Across all tests') },
  ]);

  // strengths (left) + trend (right)
  k.need(62);
  const y0 = k.y, lw = 90, rx = LAYOUT.M + lw + 4, rw = LAYOUT.CW - lw - 4;
  const yl = k.sectionAt(T('r_subject_strengths', 'Subject strengths'), LAYOUT.M, lw, y0);
  const yr = k.sectionAt(T('pdf_progress_trend', 'Progress Trend'), rx, rw, y0);
  const shown = ss.slice(0, 12);
  const endL = k.bars(shown.map(x => ({ name: x.s, pct: x.avg })), LAYOUT.M, yl, lw, { labelW: 32, rowH: 4.4 });
  const endR = taken.length > 1 ? k.line(taken.map(r => r.pct), taken.map(r => names[rows.indexOf(r)]), rx + 6, yr, rw - 6, 34) : (k.text(T('r_trend_soon', 'The trend appears after the second test.'), rx, yr + 6, { size: 8, color: C.muted, max: rw }), yr + 10);
  k.y = Math.max(endL, endR) + 4;

  // test-wise table
  k.section(T('tw_pdf_test_wise', 'Test-wise performance'));
  const tbody = rows.map((r, i) => {
    if (r.pct === null) return [{ t: names[i] + '  ', bold: true }, '', { t: 'AB', fg: C.muted }, '', '', ''];
    const L = likeForLike(rows, i), ok = r.cells.filter(c => c.v !== null).sort((x, y) => y.p - x.p), lo = ok[ok.length - 1], hi = ok[0];
    const ch = L ? { t: (L.d >= 0 ? '+' : '') + r1(L.d), arrow: L.d >= 0 ? 'up' : 'down', fg: L.d >= 0 ? C.green : C.amberT, bold: true } : { t: '-' };
    return [{ t: r.name, bold: true }, r1(r.sc) + '/' + r.mx, { t: r1(r.pct) + '%', bold: true, fg: toneColor(r.pct) }, ch, hi ? hi.s + ' ' + Math.round(hi.p) + '%' : '', ok.length > 1 ? lo.s + ' ' + Math.round(lo.p) + '%' : ''];
  });
  k.table({ cols: [{ h: T('tw_th_test', 'Test'), w: 44 }, { h: T('tw_th_total', 'Total'), w: 24 }, { h: T('tw_th_score_pct', 'Score %'), w: 18 }, { h: T('tw_th_change', 'Change'), w: 22 }, { h: T('tw_th_best', 'Best subject'), w: 37 }, { h: T('tw_th_weakest', 'Next growth area'), w: 37 }], rows: tbody, rowH: 5.2 });
  const extra = rows.map((_, i) => likeForLike(rows, i)).filter(L => L && L.extra > 0);
  k.text(T('r_change_note', 'Change compares common subjects only. AB = absent / not taken.') + (extra.length ? ' ' + T('tw_common_note', 'Compared on {{n}} common subject(s) only; {{m}} subject(s) not in the previous test are left out.', { n: extra[0].n, m: extra[0].extra }) : ''), LAYOUT.M, k.y + 1.5, { size: 6.5, color: C.muted, max: LAYOUT.CW });
  k.gap(6);

  // subject x test heat grid
  k.section(T('tw_subject_x_test', 'Subject × Test (%)'));
  const shownT = rows.length > 6 ? rows.slice(-6) : rows, off = rows.length - shownT.length;
  const tw = Math.min(26, (LAYOUT.CW - 38 - 24) / Math.max(1, shownT.length));
  const gcols = [{ h: T('tw_th_subject', 'Subject'), w: 38 }].concat(shownT.map((r, i) => ({ h: names[off + i], w: tw, align: 'center' })), [{ h: T('r_journey', 'Since first test'), w: LAYOUT.CW - 38 - tw * shownT.length, align: 'left' }]);
  const grows = ss.map(x => {
    const si = subs.indexOf(x.s), cells = shownT.map(r => { const c = r.cells[si]; return c.v !== null ? { t: Math.round(c.p) + '%', bg: heat(c.p).bg, fg: heat(c.p).fg, bold: true } : (c.ab ? { t: 'AB', bg: C.s0.bg, fg: C.s0.fg } : { t: '' }); });
    const first = x.ps.findIndex(v => v !== null), isNew = x.count === 1 && first > 0;
    const jr = isNew ? { t: T('r_new', 'new this test'), fg: C.muted } : x.delta === null ? { t: '-' } : { t: (x.delta >= 0 ? '+' : '') + Math.round(x.delta), arrow: x.delta >= 0 ? 'up' : 'down', fg: x.delta >= 0 ? C.green : C.amberT, bold: true };
    return [{ t: x.s, bold: true }].concat(cells, [jr]);
  });
  k.table({ cols: gcols, rows: grows, rowH: 4.7, size: 7.2 });
  if (off > 0) k.text(T('pdf_earlier_tests_note', '+ {{n}} earlier test(s) - full history on Dashboard', { n: off }), LAYOUT.M, k.y + 1, { size: 6.5, color: C.muted });

  // two notes
  const topTwo = ranked.slice(0, 2);
  const bestBody = best && best.avg >= 60
    ? (topTwo.length > 1 ? T('r_best_body2', '{{s1}} ({{p1}}%) and {{s2}} ({{p2}}%) are real strengths', { s1: topTwo[0].s, p1: Math.round(topTwo[0].avg), s2: topTwo[1].s, p2: Math.round(topTwo[1].avg) }) : T('r_best_body1', '{{s1}} ({{p1}}%) is a real strength', { s1: topTwo[0].s, p1: Math.round(topTwo[0].avg) })) + (bestTest ? T('r_best_body_t', ', and {{pct}}% in {{test}} shows what {{name}} can achieve.', { pct: Math.round(bestTest.pct), test: bestTest.name, name: first }) : '.')
    : T('r_best_low', 'Every learner grows at their own pace. {{s}} is a good place to start, and each small step counts.', { s: best ? best.s : first });
  const gNames = growth.map(g => g.s).join(T('r_and', ' and '));
  const nextBody = growth.length ? T('r_shine_body', '{{s}} is a lovely place to polish. Ten relaxed minutes a day, starting with what feels easy, can help {{name}} shine even brighter.', { s: gNames, name: first }) : T('r_shine_none', 'Keep the lovely routine going, and add one small stretch challenge each week.');
  k.notes({ tone: 'n1', title: T('r_does_best', 'What {{name}} does best', { name: first }), body: bestBody }, { tone: 'n3', title: T('r_next_shine', 'Next step to shine'), body: nextBody });

  /* page 2: highlights + plan */
  k.pageWithHeader(T('r_chip_plan', 'My Plan & Highlights'), [st.name, sub].filter(Boolean).join(' · '));
  k.section(T('r_celebrate', 'Celebrate: my highlights'));
  const steady = ss.find(x => x.count >= 2 && x.ps.filter(v => v !== null).every(v => v >= 75));
  const mostUp = [...ss].filter(x => x.delta !== null && x.delta > 0).sort((x, y) => y.delta - x.delta)[0];
  const cards = [
    best && { t: best.s + ' ' + Math.round(best.avg) + '%', d: T('r_hl_strong', 'My strongest subject') },
    bestTest && { t: names[rows.indexOf(bestTest)] + ': ' + Math.round(bestTest.pct) + '%', d: T('r_hl_best_test', 'My best test so far') },
    steady ? { t: T('r_hl_75', '{{s}} 75%+', { s: steady.s }), d: T('r_hl_75d', 'In every test') } : mostUp ? { t: mostUp.s + ' +' + Math.round(mostUp.delta), d: T('r_hl_up', 'My biggest improvement') } : topTwo[1] && { t: topTwo[1].s + ' ' + Math.round(topTwo[1].avg) + '%', d: T('r_hl_second', 'Another real strength') },
    { t: absTotal === 0 ? T('r_hl_noabs', 'No absences') : T('r_hl_abs', '{{n}} day(s) absent', { n: absTotal }), d: absTotal === 0 ? T('r_great_attendance', 'Great attendance') : T('r_every_day', 'Every day counts') },
  ].filter(Boolean);
  { const g = 3, w = (LAYOUT.CW - g * (cards.length - 1)) / cards.length;
    cards.forEach((c, i) => { const x = LAYOUT.M + i * (w + g); k.box(x, k.y, w, 17, C.n1.bg, C.n1.bd, 3); k.text(c.t, x + 3.5, k.y + 7.5, { size: 9, bold: true, color: C.tealD, max: w - 6 }); k.text(c.d, x + 3.5, k.y + 12.5, { size: 7, color: C.muted, max: w - 6 }); });
    k.y += 21; }
  k.text(T('r_share_hint', 'Show this page at home, pin it on the wall, or share it with family. These are earned!'), LAYOUT.M, k.y, { size: 7.5, color: C.muted, max: LAYOUT.CW }); k.gap(5);

  const g1 = growth[0] ? growth[0].s : (best ? best.s : ''), g2 = growth[1] ? growth[1].s : g1;
  k.section(T('r_plan_title', 'My 4-week growth plan: {{s}}', { s: [...new Set([g1, g2])].filter(Boolean).join(T('r_and', ' and ')) }));
  { const g = 3, w = (LAYOUT.CW - 9) / 4, bodies = [T('r_w1', '10 minutes a day: re-read one {{s}} chapter and write 3 key points.', { s: g1 }), T('r_w2', '10 minutes a day: try 5 {{s}} questions, then check them against the answers.', { s: g2 }), T('r_w3', 'Explain one solved example aloud to someone at home.'), T('r_w4', 'A short mock quiz on {{s}}. Celebrate every point gained!', { s: [...new Set([g1, g2])].join(T('r_and', ' and ')) })];
    const lines = bodies.map(b => k.wrap(b, w - 7, 7.5)), h = 11 + Math.max(...lines.map(l => l.length)) * 3.7;
    bodies.forEach((_, i) => { const x = LAYOUT.M + i * (w + g); k.box(x, k.y, w, h, C.n3.bg, C.n3.bd, 3); k.text(T('r_week', 'Week {{n}}', { n: i + 1 }), x + 3.5, k.y + 5.5, { size: 8.5, bold: true, color: C.blueT }); k.font(7.5); lines[i].forEach((l, j) => doc.text(l, x + 3.5, k.y + 10 + j * 3.7)); });
    k.y += h + 5; }

  k.section(T('r_tracker', 'My weekly tracker (tick each day)'));
  const days = T('r_days', 'M,T,W,T,F,S,S').split(',');
  for (let w = 1; w <= 4; w++) {
    k.text(T('r_week', 'Week {{n}}', { n: w }), LAYOUT.M, k.y + 4, { size: 8, bold: true });
    for (let d = 0; d < 7; d++) { const x = LAYOUT.M + 30 + d * 20; doc.setDrawColor(...C.teal); doc.setLineWidth(0.35); doc.roundedRect(x, k.y + 1, 3.6, 3.6, 0.8, 0.8); k.text(days[d] || '', x + 5.2, k.y + 4.2, { size: 7, color: C.muted }); }
    k.y += 7.5;
  }
  k.gap(2);
  k.section(T('r_goals', 'My goals'));
  const dotted = (x1, x2, y) => { doc.setDrawColor(...C.muted); doc.setLineWidth(0.3); doc.setLineDashPattern([0.6, 0.9], 0); doc.line(x1, y, x2, y); doc.setLineDashPattern([], 0); };
  const gl = (label, x, y, len) => { const w = k.text(label, x, y, { size: 8 }); dotted(x + w + 1.5, x + w + 1.5 + len, y + 0.8); return x + w + len + 4; };
  let gy = k.y + 3; gl(T('r_goal1', 'My goal for the next test:'), LAYOUT.M, gy, 24); gl(T('r_goal2', 'Subject I will grow:'), LAYOUT.M + 80, gy, 62);
  gy += 8; { let x = gl(T('r_goal3', 'I will practise'), LAYOUT.M, gy, 14); x = gl(T('r_goal3b', 'minutes a day at'), x, gy, 26); gl(T('r_goal4', 'Someone who will cheer me on:'), LAYOUT.M + 86, gy, 40); }
  k.y = gy + 7;
  k.section(T('r_parents_help', 'For parents: how to help'));
  k.notes({ tone: 'n1', title: T('r_p1t', 'Celebrate effort, not only marks'), body: T('r_p1b', 'Ask: "What was the best thing you learned this week?" Praise the practice, and notice every small win.') }, { tone: 'n3', title: T('r_p2t', 'Keep it short and calm'), body: T('r_p2b', 'Ten relaxed minutes a day beat a long weekend rush. Sit nearby, listen to one explanation, and say: "I can see you growing."') });
  { const h = 24; k.need(h + 2); k.box(LAYOUT.M, k.y, LAYOUT.CW, h, C.n2.bg, C.n2.bd, 3); k.text(T('r_note_home', 'A note from home'), LAYOUT.M + 4, k.y + 5.6, { size: 8.5, bold: true }); dotted(LAYOUT.M + 4, LAYOUT.CW + LAYOUT.M - 4, k.y + 13); dotted(LAYOUT.M + 4, LAYOUT.CW + LAYOUT.M - 4, k.y + 19.5); k.y += h + 4; }
  k.finish(indiv ? T('pdf_confidential_personal', 'Personal record - not for redistribution') : T('pdf_confidential_parent', 'CONFIDENTIAL - For parent/guardian only'));
}
function toneColor(p) { return p >= 75 ? C.green : p >= 50 ? C.blueT : C.amberT; }

/* ───────────────────────── shared class-level helpers ───────────────────────── */
function classFacts() {
  const s = APP.setup || {}, sts = (APP.students || []).filter(x => x.analysis), n = sts.length, thr = s.passThreshold || 35;
  const avg = mean(sts.map(x => x.analysis.overallAvg)) || 0;
  const passed = sts.filter(x => x.analysis.overallAvg >= thr).length;
  const growing = sts.filter(x => x.analysis.trend === 'improving').length;
  const care = sts.filter(careNeeded);
  const tests = s.tests || [];
  const testAvgs = tests.map((_, i) => mean(sts.map(x => x.analysis.testAvgs && x.analysis.testAvgs[i]).filter(v => v !== null && v !== undefined)));
  const valid = testAvgs.map((v, i) => v === null ? -1 : i).filter(i => i >= 0);
  const names = shortTests(tests.map(t => t.name));
  const ds = sts.map(x => { const r = testMatrix(x, s); return trendInfo(r).d; }).filter(d => d !== null);
  const md = mean(ds);
  const latestKey = md === null ? 'first' : md >= 2 ? 'growing' : md <= -2 ? 'dip' : 'steady';
  const subjAvg = (s.subjects || []).map(sb => ({ name: sb, pct: mean(sts.map(x => x.analysis.subjectAvgs && x.analysis.subjectAvgs[sb]).filter(v => v !== null && v !== undefined && v > 0)) })).filter(x => x.pct !== null);
  const sorted = [...sts].sort((x, y) => (y.analysis.overallAvg - x.analysis.overallAvg));
  return { s, sts, n, thr, avg, passed, growing, care, tests, testAvgs, valid, names, latestKey, subjAvg, sorted };
}
function classHead(k, f, chip, audience) {
  k.header(chip);
  k.idCard({ name: classTitle(), sub: T('r_students_tests', '{{n}} students · {{t}} tests', { n: f.n, t: f.tests.length }), big: Math.round(f.avg) + '%', cap: T('r_class_avg', 'Class average') });
  const lt = f.valid.length > 1 ? { a: f.testAvgs[f.valid[f.valid.length - 2]], b: f.testAvgs[f.valid[f.valid.length - 1]] } : null;
  const tc = f.latestKey === 'growing' ? T('r_growing', 'Growing') : f.latestKey === 'dip' ? T('r_small_dip', 'Small dip') : f.latestKey === 'steady' ? T('r_steady', 'Steady') : T('r_first_test', 'First test');
  k.tiles([
    { label: T('pdf_kpi_pass_rate', 'Pass Rate'), value: Math.round(f.passed / Math.max(1, f.n) * 100) + '%', tone: 'g', cap: T('r_of_n', '{{a}} of {{n}} students', { a: f.passed, n: f.n }) },
    { label: T('r_growing', 'Growing'), value: String(f.growing), tone: 'g', cap: T('r_pct_class', '{{p}}% of the class', { p: Math.round(f.growing / Math.max(1, f.n) * 100) }) },
    { label: T('r_need_boost', 'Need a boost'), value: String(f.care.length), tone: f.care.length ? 'a' : 'g', cap: f.care.length ? T('r_see_care', 'See the care list') : T('r_all_clear', 'All clear') },
    { label: T('r_latest_test', 'Latest test'), value: tc, tone: f.latestKey === 'growing' ? 'g' : f.latestKey === 'dip' ? 'a' : 'b', cap: lt ? Math.round(lt.a) + '%  to  ' + Math.round(lt.b) + '%' : '' },
  ]);
  k.need(62);
  const y0 = k.y, lw = 90, rx = LAYOUT.M + lw + 4, rw = LAYOUT.CW - lw - 4;
  const yl = k.sectionAt(T('r_subject_strengths', 'Subject strengths'), LAYOUT.M, lw, y0), yr = k.sectionAt(T('r_class_trend', 'Class trend'), rx, rw, y0);
  const endL = k.bars(f.subjAvg.slice(0, 12), LAYOUT.M, yl, lw, { labelW: 32, rowH: 4.4 });
  const vals = f.valid.map(i => f.testAvgs[i]);
  const endR = vals.length > 1 ? k.line(vals, f.valid.map(i => f.names[i]), rx + 6, yr, rw - 6, 38) : yr + 4;
  k.y = Math.max(endL, endR) + 4;
}
function cohortText(f) {
  const ga = APP.genderAnalysis; if (!ga || !ga.available) return '';
  const lab = g => g === 'Female' ? T('pdf_gender_girls', 'Girls') : g === 'Male' ? T('pdf_gender_boys', 'Boys') : g;
  const parts = Object.keys(ga.groups).map(g => lab(g) + ' ' + ga.groups[g].avg + '%');
  const pr = Object.keys(ga.groups).every(g => ga.groups[g].passRate === 100) ? T('r_both_pass', 'all groups 100% pass') : '';
  return parts.join(' · ') + (pr ? ' · ' + pr : '') + (ga.maxGapSubject ? '. ' + T('r_widest_gap', 'Widest gap: {{s}} ({{v}} pts).', { s: ga.maxGapSubject, v: ga.maxGapValue }) : '');
}
function lowestSubjects(f, n) { return [...f.subjAvg].sort((x, y) => x.pct - y.pct).slice(0, n).map(x => x.name); }

/* ───────────────────────── TEACHER ───────────────────────── */
export function buildTeacherPDF(doc) {
  const f = classFacts(), k = makeKit(doc, instLine());
  classHead(k, f, T('r_chip_teacher', 'Teacher Report'), '');
  k.section(T('r_all_students', 'All students'));
  const rows = f.sorted.map(st => { const a = st.analysis, tc = trendCell(trendFromAnalysis(a.trend)); return [{ t: String(a.rank || '') , fg: C.muted }, { t: st.name, bold: true }, { t: Math.round(a.overallAvg) + '%', bold: true, fg: toneColor(a.overallAvg) }, a.grade || '', tc, wellbeing(a), notesShort(st)]; });
  k.table({ cols: [{ h: '#', w: 9 }, { h: T('r_th_name', 'Name'), w: 40 }, { h: T('r_th_avg', 'Avg'), w: 12 }, { h: T('r_th_grade', 'Grade'), w: 11 }, { h: T('r_th_latest', 'Latest'), w: 24 }, { h: T('r_th_wellbeing', 'Wellbeing'), w: 23 }, { h: T('r_th_notes', 'Notes'), w: 63 }], rows, rowH: 5.1, size: 6.8, zebra: true });

  const care = [...f.care].sort((x, y) => (y.analysis.earlyWarningScore || 0) - (x.analysis.earlyWarningScore || 0));
  if (care.length) {
    k.section(T('r_care', 'Care & support list'));
    k.table({ cols: [{ h: T('r_th_student', 'Student'), w: 36 }, { h: T('r_th_avg', 'Avg'), w: 11 }, { h: T('r_th_wellbeing', 'Wellbeing'), w: 22 }, { h: T('r_th_notes', 'Notes'), w: 55 }, { h: T('r_th_support', 'Suggested support'), w: 58 }], rows: care.map(st => [{ t: st.name, bold: true }, Math.round(st.analysis.overallAvg) + '%', wellbeing(st.analysis), notesShort(st), supportText(st)]), rowH: 5.6, size: 7 });
  }
  const rising = f.sorted.filter(st => st.analysis.trend === 'improving').slice(0, 10);
  if (rising.length) {
    k.section(T('r_rising', 'Rising stars to celebrate'));
    k.table({ cols: [{ h: T('r_th_student', 'Student'), w: 50 }, { h: T('r_th_avg', 'Avg'), w: 16 }, { h: T('r_th_latest', 'Latest'), w: 30 }, { h: T('r_th_notes', 'Notes'), w: 86 }], rows: rising.map(st => [{ t: st.name, bold: true }, Math.round(st.analysis.overallAvg) + '%', trendCell('growing'), notesShort(st)]), rowH: 5.6, size: 7 });
  }
  k.need(60);
  const y0 = k.y, lw = 90, rx = LAYOUT.M + lw + 4, rw = LAYOUT.CW - lw - 4;
  let yl = k.sectionAt(T('r_subject_focus', 'Subject focus'), LAYOUT.M, lw, y0);
  const low2 = lowestSubjects(f, 2);
  f.subjAvg.forEach(x => { const msg = x.pct >= 75 ? T('r_sup_strong', 'Strong, keep going') : low2.includes(x.name) ? T('r_sup_revision', 'Revision session') : T('r_sup_steady', 'Steady'); k.text(x.name, LAYOUT.M, yl + 3, { size: 7.5, bold: true, max: 34 }); k.text(Math.round(x.pct) + '%', LAYOUT.M + 46, yl + 3, { size: 7.5, bold: true, color: toneColor(x.pct), align: 'right' }); k.text(msg, LAYOUT.M + 50, yl + 3, { size: 7.5, color: C.muted, max: lw - 50 }); yl += 5.6; });
  let yr = k.sectionAt(T('r_avg_by_test', 'Class average by test'), rx, rw, y0);
  yr = k.bars(f.valid.map(i => ({ name: f.names[i], pct: f.testAvgs[i] })), rx, yr, rw, { labelW: 28, rowH: 6 });
  const ct = cohortText(f);
  if (ct) { yr = k.sectionAt(T('r_cohort', 'Cohort view'), rx, rw, yr + 1); k.font(7.5, false, C.muted); k.wrap(ct, rw, 7.5).forEach((l, i) => doc.text(l, rx, yr + 2 + i * 3.8)); yr += 3.8 * k.wrap(ct, rw, 7.5).length + 2; }
  k.y = Math.max(yl, yr) + 3;
  k.section(T('r_top', 'Top performers'));
  k.y = k.bars(f.sorted.slice(0, 5).map(st => ({ name: '#' + st.analysis.rank + ' ' + st.name, pct: st.analysis.overallAvg })), LAYOUT.M, k.y, LAYOUT.CW, { labelW: 62, rowH: 6 }) + 3;
  k.notes({ tone: 'n1', title: T('r_good_news', 'Good news'), body: T('r_good_body', '{{a}} of {{n}} students passed and {{g}} are growing. A word of praise to the rising stars goes a long way.', { a: f.passed, n: f.n, g: f.growing }) }, { tone: 'n3', title: T('r_class_focus', 'Class-wide focus'), body: low2.length ? T('r_focus_body', 'A short revision session in {{s}} is the best next step for the whole class.', { s: low2.join(T('r_and', ' and ')) }) : T('r_focus_none', 'The class is in a steady place. Keep the routines going.') });
  k.finish(T('pdf_confidential_teacher', 'TEACHER CONFIDENTIAL'));
}

/* ───────────────────────── MANAGEMENT ───────────────────────── */
export function buildMgmtPDF(doc) {
  const f = classFacts(), k = makeKit(doc, instLine());
  classHead(k, f, T('r_chip_mgmt', 'Management Report'), '');
  k.section(T('r_score_bands', 'Score bands'));
  const bands = [[85, 101, T('r_band_top', 'Top performers'), '85% +'], [70, 85, T('r_band_strong', 'Strong and steady'), '70-84%'], [55, 70, T('r_band_grow', 'Ready to grow'), '55-69%'], [-1, 55, T('r_band_care', 'Extra care'), '< 55%']];
  k.table({ cols: [{ h: T('r_th_band', 'Band'), w: 40 }, { h: T('r_th_students', 'Students'), w: 28 }, { h: T('r_th_share', 'Share'), w: 28 }, { h: T('r_th_meaning', 'Meaning'), w: 86 }], rows: bands.map(([lo, hi, m, lab]) => { const c = f.sts.filter(x => x.analysis.overallAvg >= lo && x.analysis.overallAvg < hi).length; return [{ t: lab, bold: true }, String(c), Math.round(c / Math.max(1, f.n) * 100) + '%', m]; }), rowH: 6, size: 7.5 });
  k.section(T('r_recognition', 'Recognition'));
  k.table({ cols: [{ h: T('r_th_student', 'Student'), w: 60 }, { h: T('r_th_avg', 'Avg'), w: 22 }, { h: T('r_th_latest', 'Latest'), w: 40 }, { h: T('r_th_notes', 'Notes'), w: 60 }], rows: f.sorted.slice(0, 5).map(st => [{ t: '#' + st.analysis.rank + '  ' + st.name, bold: true }, { t: Math.round(st.analysis.overallAvg) + '%', bold: true, fg: C.green }, trendCell(trendFromAnalysis(st.analysis.trend)), notesShort(st)]), rowH: 6, size: 7.5 });
  const ct = cohortText(f);
  if (ct) { k.section(T('r_cohort', 'Cohort view')); k.note({ tone: 'n3', title: T('r_cohort_t', 'Groups at a glance'), body: ct }); }
  if (APP.compareMode && APP.sectionComparison && APP.sectionComparison.length) {
    k.section(T('pdf_compare_sections', 'Compare Sections'));
    k.table({ cols: [{ h: T('pdf_col_section', 'Section'), w: 58 }, { h: 'N', w: 18 }, { h: T('pdf_col_avg', 'Avg'), w: 22 }, { h: T('pdf_col_pass_pct', 'Pass%'), w: 22 }, { h: T('r_need_boost', 'Need a boost'), w: 24 }, { h: T('pdf_col_topper', 'Topper'), w: 38 }], rows: APP.sectionComparison.map(r => [{ t: r.label, bold: true }, String(r.n), { t: r.avg + '%', bold: true, fg: toneColor(r.avg) }, r.passRate + '%', String(r.atRisk), r.topperName || '']), rowH: 6, size: 7.5 });
  }
  const low2 = lowestSubjects(f, 2);
  k.notes({ tone: 'n1', title: T('r_healthy', 'Healthy base'), body: T('r_healthy_body', '{{a}} of {{n}} students passed and {{g}} are on a rising path.', { a: f.passed, n: f.n, g: f.growing }) },
    { tone: 'n3', title: T('r_actions', 'Suggested actions this term'), body: ['1. ' + (low2.length ? T('r_act1', 'Revision sessions for {{s}}.', { s: low2.join(T('r_and', ' and ')) }) : T('r_act1b', 'Keep the current revision routines.')), '2. ' + T('r_act2', 'Buddy support for the {{n}} students on support plans.', { n: f.care.length }), '3. ' + T('r_act3', 'Share the good news with growing students and their families.')].join('\n') });
  k.finish(T('pdf_confidential_mgmt', 'MANAGEMENT CONFIDENTIAL'));
}
