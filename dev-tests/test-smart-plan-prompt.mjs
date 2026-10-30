// Smart Planner task 02 tests.
import assert from 'node:assert/strict';
import { computeEligibility } from '../bal/smart-plan/eligibility.js';
import { buildPrompt, promptFileName, WRONG_RIGHT } from '../bal/smart-plan/prompt-builder.js';
import fx from './fixtures/sample01.json' with { type: 'json' };

const T = fx.setup.tests.map(t => t.name);
const { eligible } = computeEligibility(fx.students, T);
const pick = eligible.filter(e => ['C7A001', 'C7A007', 'C7A026'].includes(e.id));
const r = buildPrompt(pick, fx.students, fx.setup);

// privacy: zero real names, zero institution
const lc = r.xmlString.toLowerCase();
for (const n of fx.students.map(s => s.name).concat([fx.setup.instName])) assert.ok(!lc.includes(n.toLowerCase()), 'leaked: ' + n);
for (const w of ['hakki', 'public school']) assert.ok(!lc.includes(w), 'leaked: ' + w);
// scrubbed even when a name hides in free text
const dirty = JSON.parse(JSON.stringify(fx.students)); const s0 = dirty.find(s => s.id === 'C7A001');
s0.testData[T[3]].remark = `${s0.name} is a star at ${fx.setup.instName}`; s0.testData[T[3]].chapter = `Ch about ${s0.name.split(' ')[0]}`;
const d = buildPrompt(pick, dirty, fx.setup);
assert.ok(!d.xmlString.includes(s0.name) && !d.xmlString.includes(s0.name.split(' ')[0]) && !d.xmlString.includes(fx.setup.instName), 'free-text leak');

// worked WRONG/RIGHT example is verbatim in every prompt; format contract present
assert.ok(r.xmlString.includes(WRONG_RIGHT.replace(/&/g, '&amp;')) || r.xmlString.includes(WRONG_RIGHT));
assert.ok(r.xmlString.includes("WRONG: 'Mathematics dipped during the Grammar - Tenses lesson'"));
for (const l of ['[[STUDENT:<id>]]', '[[/STUDENT]]', 'Summary:', 'SubjectNotes:', 'FocusAreas:', 'NextSteps:', 'ParentNote:']) assert.ok(r.xmlString.includes(l), l);

// token: unique per call, embedded in <validation_token>, instructed as first line
const r2 = buildPrompt(pick, fx.students, fx.setup);
assert.notEqual(r.validationToken, r2.validationToken);
assert.ok(r.xmlString.includes(`<validation_token>${r.validationToken}</validation_token>`));

// SUBJECT-wise chapters: each marks tag carries its own subject's chapter; no bare <chapter> element in new-format data
const studentsOnly = x => x.match(/<students>[\s\S]*<\/students>/)[0];
const c1 = r.xmlString.match(/<student id="C7A001">[\s\S]*?<\/student>/)[0];
assert.ok(c1.includes('<marks subject="Mathematics" score="46" max="50" chapter="Fractions &amp; Decimals"/>'), 'math chapter on math marks');
assert.ok(c1.includes('<marks subject="Science" score="50" max="50" chapter="Nutrition in Plants"/>'), 'science chapter on science marks');
assert.ok(!/<chapter[ >]/.test(studentsOnly(r.xmlString)), 'no bare chapter element for subject-wise data');
// the same class-wide chapter is sent for every student (it is not student-wise)
const c26 = r.xmlString.match(/<student id="C7A026">[\s\S]*?<\/student>/)[0];
assert.ok(c26.includes('chapter="Fractions &amp; Decimals"'));
// chapter attr absent when none logged
const noCh = JSON.parse(JSON.stringify(fx.students)); noCh.forEach(s => T.forEach(t => { s.testData[t].chapters = {}; s.testData[t].chapter = ''; }));
assert.ok(!studentsOnly(buildPrompt(pick, noCh, fx.setup).xmlString).includes('chapter'));
// LEGACY single student-wise chapter (old workbook): bare <chapter>, owner unknown
const legacy = JSON.parse(JSON.stringify(fx.students)); legacy.forEach(s => T.forEach(t => { s.testData[t].chapters = {}; s.testData[t].chapter = ''; }));
legacy.find(s => s.id === 'C7A001').testData[T[0]].chapter = 'Fractions & Decimals';
const lg = buildPrompt(pick, legacy, fx.setup);
assert.ok(studentsOnly(lg.xmlString).includes('<chapter>Fractions &amp; Decimals</chapter>'));
assert.deepEqual(lg.evidence.C7A001.chapterSubjects['Fractions & Decimals'], []);
// evidence records exactly which subject logged each chapter
assert.deepEqual(r.evidence.C7A001.chapterSubjects['Fractions & Decimals'], ['Mathematics']);
assert.deepEqual(r.evidence.C7A001.chapterSubjects['Grammar - Tenses'], ['English']);
// a real entered 0 in one subject IS sent (and the student stays eligible through the other subjects)
const z0 = JSON.parse(JSON.stringify(fx.students)); z0.find(s => s.id === 'C7A001').testData[T[0]].marks.Mathematics = 0;
const zp = buildPrompt(computeEligibility(z0, [T[0]]).eligible.filter(e => e.id === 'C7A001'), z0, fx.setup);
assert.ok(zp.xmlString.includes('<marks subject="Mathematics" score="0" max="50"'), 'zero must reach the LLM');
// blank / absent subject mark is still NOT sent
const bl = JSON.parse(JSON.stringify(fx.students)); delete bl.find(s => s.id === 'C7A001').testData[T[0]].marks.Mathematics;
const bp = buildPrompt(computeEligibility(bl, [T[0]]).eligible.filter(e => e.id === 'C7A001'), bl, fx.setup);
assert.ok(!bp.xmlString.match(/<student id="C7A001">[\s\S]*?<\/student>/)[0].includes('subject="Mathematics"'));

// per-student trimming: only that student's valid tests are serialised
const trimmed = JSON.parse(JSON.stringify(fx.students)); trimmed.find(s => s.id === 'C7A007').testData[T[0]].marks = {};
const tr = buildPrompt(computeEligibility(trimmed, T).eligible.filter(e => e.id === 'C7A007'), trimmed, fx.setup);
assert.ok(!tr.xmlString.includes('name="Unit Test 1"') && tr.xmlString.includes('name="Mid-Term"'));
// test names are prefix-stripped, absence days only when > 0, evidence mirrors what was sent
assert.ok(!r.xmlString.includes('Class7A-'));
assert.ok(r.xmlString.includes('<absentDays>2</absentDays>'));
assert.equal(r.evidence.C7A026.chapters.length, 20);   // 5 subjects x 4 tests, one chapter each
assert.ok(r.evidence.C7A026.chapters.includes('Vyakarana Basics') && r.evidence.C7A026.chapters.includes('Perimeter & Area'));
assert.equal(promptFileName('Hakki Public School Class 7.xlsx'), 'Hakki_Public_School_Class_7_smart-planner-prompt.xml');

console.log('smart-plan prompt: all assertions passed');
