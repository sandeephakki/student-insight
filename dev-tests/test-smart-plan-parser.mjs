// Smart Planner task 03 tests.
import assert from 'node:assert/strict';
import { parseResponse } from '../bal/smart-plan/response-parser.js';
import { computeEligibility } from '../bal/smart-plan/eligibility.js';
import { buildPrompt } from '../bal/smart-plan/prompt-builder.js';
import fx from './fixtures/sample01.json' with { type: 'json' };

const T = fx.setup.tests.map(t => t.name);
const pick = computeEligibility(fx.students, T).eligible.filter(e => ['C7A001', 'C7A007', 'C7A026'].includes(e.id));
const P = buildPrompt(pick, fx.students, fx.setup);
const ctx = { token: P.validationToken, expectedIds: P.studentIds, evidence: P.evidence, subjects: P.subjects, testNames: P.testNames };
const block = (id, sn) => `[[STUDENT:${id}]]\nSummary: s\nSubjectNotes: ${sn}\nFocusAreas: f\nNextSteps: 1. a 2. b\nParentNote: p\n[[/STUDENT]]`;
const good = [
  block('C7A001', 'Mathematics: 92% -> 100%. Fractions & Decimals (Unit Test 1) is the only logged chapter. English: dip lines up with Grammar - Tenses.'),
  block('C7A007', 'Mathematics: steady. Lines & Angles was the start. Science: Nutrition in Plants on record.'),
  block('C7A026', 'Mathematics: low. Kannada: Vyakarana Basics on record.'),
].join('\n\n');

// clean + matching token
let r = parseResponse(P.validationToken + '\n' + good, ctx);
assert.equal(r.ok, true); assert.deepEqual(r.matched, ['C7A001', 'C7A007', 'C7A026']); assert.equal(r.complete, true);
assert.deepEqual(r.students.C7A001.nextSteps, ['a', 'b']);
// chatty preamble + code fences + smart quotes tolerated
r = parseResponse('Sure, here is your plan:\n```text\n' + P.validationToken + '\n' + good + '\n```', ctx);
assert.equal(r.ok, true); assert.equal(r.matched.length, 3);
// real-world artefact: literal \uXXXX escapes decoded
r = parseResponse(P.validationToken + '\n' + good.replace('92% -> 100%', '92% \\u2192 100%'), ctx);
assert.ok(r.students.C7A001.subjectNotes.Mathematics.includes('\u2192'));

// wrong token: hard reject, nothing parsed at all
r = parseResponse('SP-FFFFFFFFFFFFFFFF\n' + good, ctx);
assert.equal(r.ok, false); assert.equal(r.code, 'token_mismatch');
assert.ok(!('students' in r) && !('matched' in r), 'no parsing side effects after a rejected token');
// missing token
r = parseResponse(good, ctx); assert.equal(r.ok, false); assert.equal(r.code, 'token_missing');
r = parseResponse('', ctx); assert.equal(r.ok, false);

// one student's block missing entirely
const two = [block('C7A001', 'Mathematics: ok.'), block('C7A026', 'Mathematics: low.')].join('\n');
r = parseResponse(P.validationToken + '\n' + two, ctx);
assert.deepEqual(r.missing, ['C7A007']); assert.deepEqual(r.matched, ['C7A001', 'C7A026']); assert.equal(r.complete, false);
assert.deepEqual(r.needRegenerate, ['C7A007']);

// malformed block (no closing tag, then a field missing) must not stop siblings or throw
const trunc = block('C7A001', 'Mathematics: ok.') + '\n[[STUDENT:C7A007]]\nSummary: cut off mid-field\nSubjectNot\n\n' + block('C7A026', 'Mathematics: low.');
assert.doesNotThrow(() => { r = parseResponse(P.validationToken + '\n' + trunc, ctx); });
assert.deepEqual(r.matched, ['C7A001', 'C7A026']); assert.deepEqual(r.parseFailed.map(f => f.id), ['C7A007']);
r = parseResponse(P.validationToken + '\n' + good.replace('ParentNote: p\n[[/STUDENT]]', '[[/STUDENT]]'), ctx);
assert.ok(r.parseFailed.length >= 1 && r.matched.length >= 1, 'a missing field fails only that block');

// unexpected ids are flagged, never silently accepted
r = parseResponse(P.validationToken + '\n' + good + '\n' + block('C7A099', 'Mathematics: x.'), ctx);
assert.deepEqual(r.unexpected, ['C7A099']); assert.equal(r.complete, false); assert.ok(!r.students.C7A099);

// evidence containment: the real historic bug - Grammar - Tenses cited under Mathematics
const bad = block('C7A001', 'Mathematics: dipped during the Grammar - Tenses lesson. English: steady.');
r = parseResponse(P.validationToken + '\n' + bad, { ...ctx, expectedIds: ['C7A001'] });
const f = r.students.C7A001.flags;
assert.ok(f.some(x => x.kind === 'wrong_subject' && x.subject === 'Mathematics' && x.chapter === 'Grammar - Tenses' && x.owner === 'English'), JSON.stringify(f));
// false-positive check: legitimate citations are NOT flagged
const okB = block('C7A001', 'Mathematics: Fractions & Decimals (Unit Test 1). English: Grammar - Tenses dip. Kannada: Padya Pathya 1 only.');
r = parseResponse(P.validationToken + '\n' + okB, { ...ctx, expectedIds: ['C7A001'], evidence: { C7A001: { chapters: ['Fractions & Decimals', 'Grammar - Tenses', 'Padya Pathya 1'] } } });
assert.deepEqual(r.students.C7A001.flags, []);
// a chapter that was never sent is flagged as fabricated
const fab = block('C7A001', 'Mathematics: struggled with "Quadratic Equations" this term.');
r = parseResponse(P.validationToken + '\n' + fab, { ...ctx, expectedIds: ['C7A001'] });
assert.ok(r.students.C7A001.flags.some(x => x.kind === 'fabricated' && /Quadratic/.test(x.chapter)));

// real chapter that exists in the class but was NOT sent for this student/test selection -> flagged
const vocab = [...new Set(fx.students.flatMap(st => Object.values(st.testData).flatMap(t => Object.values(t.chapters || {}))).filter(Boolean))];
const unsent = block('C7A007', 'Mathematics: dipped during the Letter Writing lesson, while steady.');
r = parseResponse(P.validationToken + '\n' + unsent, { ...ctx, expectedIds: ['C7A007'], evidence: { C7A007: { chapters: ['Lines & Angles'] } }, chapterVocabulary: vocab });
assert.ok(r.students.C7A007.flags.some(x => x.kind === 'fabricated' && x.chapter === 'Letter Writing'), JSON.stringify(r.students.C7A007.flags));
// same sentence is NOT flagged when that chapter really was sent
r = parseResponse(P.validationToken + '\n' + block('C7A007', 'English: Letter Writing was the only chapter.'), { ...ctx, expectedIds: ['C7A007'], evidence: { C7A007: { chapters: ['Letter Writing'] } }, chapterVocabulary: vocab });
assert.deepEqual(r.students.C7A007.flags, []);

// EXACT ownership from subject-wise evidence (works even for chapter names the keyword lexicon cannot classify)
const rb = parseResponse(P.validationToken + '\n' + block('C7A001', 'Mathematics: struggled with Rulers and Buildings. Social Studies: fine.'), { ...ctx, expectedIds: ['C7A001'], evidence: { C7A001: { chapters: ['Rulers and Buildings'], chapterSubjects: { 'Rulers and Buildings': ['Social Studies'] } } } });
assert.ok(rb.students.C7A001.flags.some(x => x.kind === 'wrong_subject' && x.subject === 'Mathematics' && x.owner === 'Social Studies'), JSON.stringify(rb.students.C7A001.flags));
// real evidence from the builder: the historic bug is now caught by exact data, not by guessing
const real = parseResponse(P.validationToken + '\n' + bad, { ...ctx, expectedIds: ['C7A001'] });
assert.ok(real.students.C7A001.flags.some(x => x.kind === 'wrong_subject' && x.chapter === 'Grammar - Tenses' && x.owner === 'English'));
// ...and the same chapter cited under its own subject is clean
const okReal = parseResponse(P.validationToken + '\n' + block('C7A001', 'Mathematics: Fractions & Decimals was Unit Test 1. English: the dip lines up with Grammar - Tenses.'), { ...ctx, expectedIds: ['C7A001'] });
assert.deepEqual(okReal.students.C7A001.flags, []);

console.log('smart-plan parser: all assertions passed');
