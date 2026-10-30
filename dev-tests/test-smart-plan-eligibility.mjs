// Smart Planner task 01 tests. Fixture = Sample_01 parsed (dev-tests/fixtures/sample01.json, same data as the xlsx).
import assert from 'node:assert/strict';
import { computeEligibility } from '../bal/smart-plan/eligibility.js';
import fx from './fixtures/sample01.json' with { type: 'json' };

const T = fx.setup.tests.map(t => t.name);          // Unit Test 1, Mid-Term, Unit Test 2, Final Exam
const clone = o => JSON.parse(JSON.stringify(o));
const blank = (st, test) => { st.testData[test].marks = {}; };

// hand-computed against Sample_01: all 30 students have full marks in all 4 tests
let r = computeEligibility(fx.students, [T[0]]);
assert.equal(fx.students.length, 30);
assert.equal(r.eligible.length, 30); assert.equal(r.excluded.length, 0);
assert.deepEqual(r.eligible[0].tests, [T[0]]);

// union / superset
const r1 = computeEligibility(fx.students, [T[0]]);
const r2 = computeEligibility(fx.students, [T[0], T[3]]);
const ids1 = new Set(r1.eligible.map(e => e.id));
assert.ok(r2.eligible.length >= r1.eligible.length && [...ids1].every(id => r2.eligible.some(e => e.id === id)), 'superset');

// absent in one checked test, present in another -> eligible with ONLY the present test
const m = clone(fx.students);
blank(m[0], T[0]);
r = computeEligibility(m, [T[0], T[3]]);
assert.deepEqual(r.eligible.find(e => e.id === m[0].id).tests, [T[3]]);
assert.equal(r.excluded.length, 0);
// ...and the same student alone on the blanked test is excluded, siblings untouched
r = computeEligibility(m, [T[0]]);
assert.deepEqual(r.excluded.map(e => e.id), [m[0].id]);
assert.equal(r.eligible.length, 29);
assert.ok(r.excluded[0].reason.length > 0);

// zero valid marks across every checked test -> excluded, never eligible
const z = clone(fx.students); blank(z[1], T[0]); blank(z[1], T[3]);
r = computeEligibility(z, [T[0], T[3]]);
assert.ok(r.excluded.some(e => e.id === z[1].id) && !r.eligible.some(e => e.id === z[1].id));
assert.equal(r.eligible.length + r.excluded.length, 30, 'nobody silently dropped');
// genuine zero treated like absent (documented decision)
const zz = clone(fx.students); Object.keys(zz[2].testData[T[0]].marks).forEach(k => { zz[2].testData[T[0]].marks[k] = 0; });
assert.ok(computeEligibility(zz, [T[0]]).excluded.some(e => e.id === zz[2].id));

// edge cases: no tests checked, unknown test name, student with no test records at all
r = computeEligibility(fx.students, []); assert.deepEqual(r, { eligible: [], excluded: [] });
r = computeEligibility(fx.students, ['No such test']); assert.equal(r.eligible.length, 0); assert.equal(r.excluded.length, 30);
const e = clone(fx.students); e[3].testData = {};
r = computeEligibility(e, [T[0]]); assert.ok(r.excluded.some(x => x.id === e[3].id));
assert.doesNotThrow(() => computeEligibility(null, null));

console.log('smart-plan eligibility: all assertions passed');
