// Task 06: Report Views — Shortlist / By-Category / Subject-Toppers.
// Pure JS-computed views over Task 04's engine output + Task 05's split
// (§27 — no live Excel formulas, no independent recomputation of academic
// %/rank/eligibility; this is a reshaping layer only).
//
// Existing per-section download pattern to reuse in Task 10 (not wired
// here): compute-compare.js's exportSectionPDFs(sectionId) + export-pdf.js's
// downloadBlob(blob, fname) helper.

// buildShortlist(completeResults) -> rows for SCHOLARSHIP_SHORTLIST.
// completeResults = Task 05's split.complete (already dataComplete:true,
// already ranked by Task 04). Only reshapes — does not re-rank.
function buildShortlist(completeResults, students) {
  const byId = {};
  students.forEach(st => (byId[st.id] = st));

  return completeResults.map(r => {
    const st = byId[r.studentId] || {};
    return {
      studentId: r.studentId,
      name: st.name || r.studentId,
      category: st.category || "",
      academicAvgPct: r.academicAvgPct,
      weightedScore: r.weightedScore,
      rank: r.rank,
      eligible: r.eligible,
      reasonCodes: r.reasonCodes, // Task 09/UI layer resolves these via srtScholarship()
      actuals: r.actuals, // needed alongside reasonCodes to render full-sentence reasons (concrete numbers, not just a code name)
      checks: r.checks // exposed for Task 09's audit view to source from
    };
  });
}

// buildByCategory(completeResults) -> rows for SCHOLARSHIP_BY_CATEGORY.
// "Rank Within Category" is computed among ALL data-complete students in
// that category (eligible or not) — standing-among-peers, not
// standing-among-winners (per §27 discussion, confirmed interpretation).
function buildByCategory(completeResults, students) {
  const byId = {};
  students.forEach(st => (byId[st.id] = st));

  // Group by category first so within-category rank is an independent
  // computation, not a lookup into the overall rank.
  const byCategory = {};
  completeResults.forEach(r => {
    const cat = (byId[r.studentId] || {}).category || "";
    (byCategory[cat] = byCategory[cat] || []).push(r);
  });

  const withinCategoryRank = {};
  Object.keys(byCategory).forEach(cat => {
    const sorted = byCategory[cat].slice().sort((a, b) => b.weightedScore - a.weightedScore);
    sorted.forEach((r, i) => {
      withinCategoryRank[r.studentId] =
        i > 0 && r.weightedScore === sorted[i - 1].weightedScore
          ? withinCategoryRank[sorted[i - 1].studentId]
          : i + 1;
    });
  });

  return completeResults.map(r => {
    const st = byId[r.studentId] || {};
    return {
      category: st.category || "",
      studentId: r.studentId,
      name: st.name || r.studentId,
      academicAvgPct: r.academicAvgPct,
      weightedScore: r.weightedScore,
      rankOverall: r.rank,
      rankWithinCategory: withinCategoryRank[r.studentId],
      eligible: r.eligible,
      reasonCodes: r.reasonCodes
    };
  });
}

// buildSubjectToppers(students, subjects) -> rows for
// SCHOLARSHIP_SUBJECT_TOPPERS. Independent of scholarship eligibility
// entirely — includes every student regardless of eligible/incomplete
// status (§ spec point 3). subjects comes from base SETUP, not
// schemeConfig. Reuses st.analysis.subjectAvgs/overallAvg — already
// computed by compute-stats.js, not recalculated here.
function buildSubjectToppers(students, subjects) {
  const rows = students.map(st => {
    const subjectAvgs = (st.analysis && st.analysis.subjectAvgs) || {};
    const overallAcademicAvgPct = (st.analysis && st.analysis.overallAvg) || 0;
    const row = {
      studentId: st.id,
      name: st.name || st.id,
      overallAcademicAvgPct,
      overallRank: null // filled below
    };
    subjects.forEach(s => {
      row[s] = subjectAvgs[s] != null ? subjectAvgs[s] : null;
    });
    return row;
  });

  const sorted = rows.slice().sort((a, b) => b.overallAcademicAvgPct - a.overallAcademicAvgPct);
  sorted.forEach((r, i) => {
    r.overallRank =
      i > 0 && r.overallAcademicAvgPct === sorted[i - 1].overallAcademicAvgPct
        ? sorted[i - 1].overallRank
        : i + 1;
  });

  return rows;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildShortlist, buildByCategory, buildSubjectToppers };
}

// ES module export — Task 08 wiring, same rationale as the engine file.
export { buildShortlist, buildByCategory, buildSubjectToppers };
