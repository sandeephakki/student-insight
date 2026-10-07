import { APP } from '../../core/state-nav.js';

// dal/common/data-access.js
//
// TODAY: reads/writes APP.students / APP.sections / APP.setup
// (in-memory, populated by Excel parse via js/template-upload.js).
//
// FUTURE (Pro): internals swap to fetch('/api/...') calls against a
// database. Callers (BAL/UI) never change — only this file's insides do.
//
// Every function is async and takes an (unused today, present for
// future tenant-scoping) institutionId as its first param where
// relevant, per planner.md's "async-first, tenant-shaped" rule.
//
// SCOPE NOTE (step 3): this file is the accessor for the app's
// source-of-truth data — the roster, the setup/config, the compare
// section list, the scholarship scheme. It is NOT an accessor for
// every property ever hung off APP.* — derived/computed caches that
// BAL functions build and re-derive every analysis run (APP.classStats,
// APP.genderAnalysis, APP.dataIssues, APP.cohortClusters, APP.continuity,
// APP.compareMode) are not "where data physically lives" in the sense
// planner.md's Data source model describes; they're recomputed output,
// not part of the Excel-backed model a future Postgres swap would need
// to serve differently. Those stay as direct APP.* reads/writes in BAL
// for now — routing them through DAL would be a speculative abstraction
// nothing in this step's contract calls for. Flagged here rather than
// silently decided — revisit if Pro's design needs otherwise.

export async function getStudents(institutionId, filters) {
  let students = APP.students || [];
  if (filters) {
    // no filter predicates defined by any current caller yet — pass-through,
    // present so the signature matches the Pro contract from day one.
  }
  return students;
}

export async function getStudent(institutionId, studentId) {
  return (APP.students || []).find(s => s.id === studentId) || null;
}

export async function getSections(institutionId) {
  // "Sections" today only exists as Compare mode's per-file section list —
  // see getCompareSections() below, which is the same underlying data.
  return APP.sections || [];
}

export async function getSetup(institutionId) {
  return APP.setup;
}

export async function getInstitutionProfile(institutionId) {
  // Free reads name/class/teacher only from SETUP tab cells — no
  // logo/address, not available today (per planner.md Data source model).
  const s = APP.setup || {};
  return { name: s.instName || "", className: s.className || "", teacher: s.teacher || "" };
}

export async function getScholarshipScheme(institutionId) {
  return (APP.setup && APP.setup.scholarship) || {};
}

export async function saveScholarshipResult(institutionId, result) {
  // Free: NO_PERSISTENCE — this still just writes to the in-memory APP.*
  // object, nothing survives a refresh, exactly as every other Free
  // computed result today. Included now so the future Pro implementation
  // (a real persisted write) doesn't need a new function name later.
  APP.scholarshipResult = result;
  return result;
}

export async function getCompareSections(institutionId) {
  return APP.sections || [];
}

export async function getTests(institutionId, sectionId) {
  // No standalone "tests" store exists today — tests live embedded in
  // APP.setup.tests. sectionId is accepted (tenant/section-shaped
  // contract) but unused by Free, which has one setup per session.
  return (APP.setup && APP.setup.tests) || [];
}
