// bal/smart-plan/regenerate.js  (Smart Planner task 15, amendment A5) - pure logic, no DOM.
// "Re-ask only the flagged students": builds a second-pass prompt for just those students (same validation token, so
// the answer belongs to the same session) and merges the second answer into the first result.
import { buildPrompt, promptFileName, PROMPT_FILE_SUFFIX } from './prompt-builder.js';
import { applyQuality, redoPlan } from './quality-checks.js';

// eligible: [{id, tests}] for the session's checked tests (computeEligibility); plan: redoPlan(result);
// session: {token}; returns buildPrompt()'s { xmlString, validationToken, evidence, studentIds, testNames, subjects }
function buildRedoPrompt(eligible, students, setup, session, plan, opts) {
  const want = new Set((plan && plan.ids) || []);
  const subset = (eligible || []).filter(e => want.has(e.id));
  return buildPrompt(subset, students, setup, { outputLanguage: opts && opts.outputLanguage, token: session.token, redo: plan.texts });
}

// Same naming convention as the main prompt: <basename>_smart-planner-redo.xml
function redoFileName(uploadedBasename) { return promptFileName(uploadedBasename).slice(0, -PROMPT_FILE_SUFFIX.length) + '_smart-planner-redo.xml'; }

// A second answer only ever REPLACES a student when it parsed; a student who failed again keeps their earlier version.
// ctx: the same ctx given to parseResponse for the first answer (expectedIds = the whole class list).
function mergeResults(prev, next, ctx) {
  if (!prev || !prev.ok || !next || !next.ok) return prev;
  const students = { ...prev.students };
  const replaced = [];
  for (const id of next.matched) if (next.students[id]) { students[id] = next.students[id]; replaced.push(id); }
  const checked = applyQuality(students, { expectedIds: ctx.expectedIds, evidence: ctx.evidence, subjects: ctx.subjects, language: ctx.language });
  const matched = [...new Set([...prev.matched, ...replaced])];
  const needRegenerate = prev.needRegenerate.filter(id => !matched.includes(id));
  return {
    ...prev,
    matched,
    missing: prev.missing.filter(id => !matched.includes(id)),
    parseFailed: prev.parseFailed.filter(f => !matched.includes(f.id)),
    needRegenerate,
    students: checked,
    redone: [...new Set([...(prev.redone || []), ...replaced])],
    complete: needRegenerate.length === 0 && prev.unexpected.length === 0,
  };
}

export { buildRedoPrompt, mergeResults, redoPlan, redoFileName };
