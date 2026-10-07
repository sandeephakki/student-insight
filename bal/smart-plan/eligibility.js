// bal/smart-plan/eligibility.js  (Smart Planner task 01)
// Pure logic, no DOM. Independent of the report-generator picker on purpose.
//
// Rules (smart-planner-00-overview.md):
//  - Union across checked tests: eligible = valid marks in AT LEAST ONE checked test.
//  - Per-student trimming: a student's evidence = only the checked tests where THEY have valid marks.
//  - Excluded = zero valid marks across every checked test (kept, with a reason - never dropped).
//  - ELIGIBILITY uses "valid mark" = finite number > 0: blank, missing, absent AND a genuine 0 do not by themselves
//    make a student eligible (owner's rule). Once a student IS eligible for a test, WHAT IS SENT/SHOWN uses
//    isEnteredMark(): a real entered 0 in one subject is meaningful data (often the most important) and is kept.
//    (Dashboard analytics in compute-stats.js also count a real 0 as data - the two features agree on that.)
import { getStudents } from '../../dal/common/data-access.js';

const NO_DATA_REASON = 'No marks recorded for any selected test';

// A score the teacher actually entered: finite number >= 0 (blank/absent are not numbers, so they are not entered).
function isEnteredMark(v) { return typeof v === 'number' && isFinite(v) && v >= 0; }

function hasValidMark(testRecord) {
  const marks = testRecord && testRecord.marks;
  if (!marks) return false;
  for (const k of Object.keys(marks)) {
    const v = marks[k];
    if (typeof v === 'number' && isFinite(v) && v > 0) return true;
  }
  return false;
}

// students: roster ([{id, testData:{[test]:{marks:{[subject]:number}}}}]); checkedTestNames: string[]
// returns { eligible:[{id, tests:[testName,...]}], excluded:[{id, reason}] }
function computeEligibility(students, checkedTestNames) {
  const eligible = [];
  const excluded = [];
  const checked = Array.isArray(checkedTestNames) ? [...new Set(checkedTestNames)] : [];
  if (!checked.length) return { eligible, excluded };
  for (const st of students || []) {
    const td = (st && st.testData) || {};
    const tests = checked.filter(name => Object.prototype.hasOwnProperty.call(td, name) && hasValidMark(td[name]));
    if (tests.length) eligible.push({ id: st.id, tests });
    else excluded.push({ id: st.id, reason: NO_DATA_REASON });
  }
  return { eligible, excluded };
}

// DAL-backed convenience for UI callers.
async function loadEligibility(checkedTestNames) {
  return computeEligibility(await getStudents(), checkedTestNames);
}

export { computeEligibility, loadEligibility, hasValidMark, isEnteredMark, NO_DATA_REASON };
