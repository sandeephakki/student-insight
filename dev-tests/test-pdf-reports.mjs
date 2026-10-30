// Report data rules + PDF builders: blank = absent, like-for-like comparison, all three reports build without error.
import assert from 'node:assert/strict';
globalThis.window = globalThis; globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {} }), documentElement: { style: {} }, body: {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }; globalThis.addEventListener = () => {}; globalThis.MutationObserver = class { observe() {} };
const { testMatrix, likeForLike, trendInfo } = await import('../bal/common/report-data.js');
const { APP } = await import('../core/app-state.js');
const R = await import('../bal/export/pdf-reports.js');
const setup = { mode: 'individual', className: '6 B', year: '2026-27', passThreshold: 35, subjects: ['Maths', 'English', 'Art'],
  tests: [{ name: 'T1', maxMarks: { Maths: 50, English: 50 }, _effSubjects: ['Maths', 'English'] }, { name: 'T2', maxMarks: { Maths: 100, English: 100, Art: 25 }, _effSubjects: ['Maths', 'English', 'Art'] }] };
const st = { id: 1, name: 'Asha Rao', testData: { T1: { marks: { Maths: 30, English: 40 } }, T2: { marks: { Maths: 60, English: '', Art: 20 } } }, flags: [],
  analysis: { overallAvg: 70, trend: 'declining', testAvgs: [70, 70], subjectAvgs: { Maths: 60, English: 80, Art: 80 }, rank: 1, percentile: 90, earlyWarningScore: 0 } };
const rows = testMatrix(st, setup);
assert.equal(rows[1].cells[1].ab, true, 'blank mark = absent');
assert.equal(rows[1].mx, 125, 'absent subject excluded from the maximum (100 + 25)');
assert.equal(Math.round(rows[1].pct), 64, '(60+20)/125');
const L = likeForLike(rows, 1);
assert.equal(L.n, 1, 'only Maths is common (English absent in T2)'); assert.equal(L.extra, 1, 'Art is new in T2');
assert.equal(Math.round(L.d), 0, 'Maths 60% -> 60%');
assert.equal(trendInfo(rows).key, 'steady');
assert.equal(trendInfo(testMatrix({ ...st, testData: { T1: { marks: { Maths: 30 } }, T2: { marks: { English: 50, Art: 20 } } } }, setup)).key, 'nocmp', 'no common subjects');
// every builder runs against a recording stub (no throw, no NaN text)
const texts = []; const doc = new Proxy({}, { get: (t, k) => k === 'getTextWidth' ? s => String(s).length * 1.6 : k === 'splitTextToSize' ? s => String(s).split('\n') : k === 'getNumberOfPages' ? () => 1 : k === 'internal' ? { getNumberOfPages: () => 1 } : k === 'text' ? s => texts.push(String(s)) : () => doc });
APP.setup = setup; APP.students = [st]; APP.genderAnalysis = null; APP.classStats = {};
R.buildStudentPDF(doc, st); setup.mode = 'institution'; R.buildStudentPDF(doc, st); R.buildTeacherPDF(doc); R.buildMgmtPDF(doc);
assert.ok(texts.length > 80, 'reports drew text');
assert.ok(!texts.some(t => /NaN|undefined|\[object/.test(t)), 'no NaN/undefined in report text');
assert.ok(!texts.some(t => /\b(fail\w*|weak\w*|at.risk|worst)\b/i.test(t)), 'kind tone: no harsh words');
console.log('pdf-reports: all assertions passed');
