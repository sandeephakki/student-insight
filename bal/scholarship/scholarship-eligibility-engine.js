// Task 04: Scholarship Eligibility Engine — pure calculation module.
// No DOM, no UI, no sheet I/O, no global scheme state (§19). Called once
// per scheme by Tasks 05/06/08/09, always with an explicit schemeConfig.
//
// Per-test % is NOT recomputed here — it's read from st.analysis.testAvgs,
// the same array render-core.js/compute-stats.js already build and display
// elsewhere on the dashboard, so scholarship numbers never disagree with
// the main dashboard for the same student.
//
// schemeConfig shape (matches APP.setup.scholarship — project-setup.js —
// plus passThreshold merged in by the caller, since No-Fail (#8) checks
// against the base SETUP scoring config, not a scholarship-only field):
//   { eligibilityType, minAcademicAvg, maxFamilyIncome, noFailRule,
//     attendanceFloor, categoryQuota, weightAcademic, weightConsistency,
//     weightGrowth, passThreshold }
// noFailRule / eligibilityType are compared case-sensitively against the
// exact strings project-setup.js writes ("Yes", "Merit-cum-Need", etc.).

function calculateScholarshipEligibility(students, schemeConfig) {
  // BUG FIX (found via Sample_16_Phase1_AllScenarios.xlsx): academicPass
  // and the income check used to gate `eligible` unconditionally for
  // every Eligibility Type — so a "Need-only" scheme silently required an
  // academic minimum nobody asked for, and "Category-based"/"Custom"
  // schemes did too. The type names themselves say which checks apply:
  // Merit-only/Merit-cum-Need → academic; Need-only/Merit-cum-Need →
  // income. "Custom" has no per-check toggle anywhere in the locked SETUP
  // schema (§26) — the only signal available for what a Custom scheme
  // actually wants is which threshold fields were filled in, so a Custom
  // scheme applies academic/income only when minAcademicAvg/
  // maxFamilyIncome are actually set.
  const type = schemeConfig.eligibilityType;
  const MERIT_TYPES = ["Merit-only", "Merit-cum-Need"];
  const NEED_TYPES = ["Need-only", "Merit-cum-Need"];
  const needsAcademic = MERIT_TYPES.includes(type) || (type === "Custom" && schemeConfig.minAcademicAvg != null);
  const needsIncome = NEED_TYPES.includes(type) || (type === "Custom" && schemeConfig.maxFamilyIncome != null);
  // BUG FIX: "Category-based" previously had NO actual eligibility logic
  // of its own — it fell straight through to the same academic-gated
  // check every other type used, so a Category-based scheme (which by
  // definition should be gated on category membership, nothing else)
  // silently behaved like Merit-only instead. Category membership check
  // below uses the standard Indian-schooling reservation convention
  // (SC/ST/OBC/EWS reserved, "General" the non-reserved default) — the
  // same convention §25's own "govt/aided reservation-law fit" language
  // assumes. "Custom" is left OUT of the category gate deliberately:
  // unlike academic/income there's no threshold field whose presence
  // signals "this Custom scheme cares about category" (no "Allowed
  // Categories" field exists anywhere in the locked SETUP schema) — so a
  // Custom scheme that also wants a category gate isn't representable
  // with the current schema. Flagging this explicitly rather than
  // guessing at a rule the source doc never specified.
  const needsCategory = type === "Category-based";

  // Pass 1: per-student checks + the three new scores. Ranking needs every
  // student's weightedScore first, so rank is assigned in a second pass.
  const scored = students.map(st => {
    const testAvgs = (st.analysis && st.analysis.testAvgs) || [];
    const valid = testAvgs.filter(v => v !== null && v !== undefined);

    const missingFields = [];
    if (!valid.length) missingFields.push("testAvgs");
    if (needsIncome && !String(st.annualFamilyIncome || "").trim()) {
      missingFields.push("annualFamilyIncome");
    }
    if (needsCategory && !String(st.category || "").trim()) {
      missingFields.push("category");
    }
    const dataComplete = missingFields.length === 0;

    // Academic Avg % — average of per-test %, same source as the dashboard.
    const academicAvgPct = valid.length
      ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length)
      : 0;

    // Consistency Score — 100 − stdev(per-test %), floored at 0.
    let consistencyScore = 100;
    if (valid.length >= 2) {
      const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
      const variance = valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length;
      consistencyScore = Math.max(0, Math.round(100 - Math.sqrt(variance)));
    }

    // Growth Score — 50 + (finalTest% − firstTest%), clamped to [0, 100].
    let growthScore = 50;
    if (valid.length >= 2) {
      growthScore = Math.max(0, Math.min(100, 50 + (valid[valid.length - 1] - valid[0])));
    }

    // Weighted Score — 3-component, no Attendance (§25/§26).
    const weightedScore = dataComplete
      ? Math.round(
          (academicAvgPct * schemeConfig.weightAcademic +
            consistencyScore * schemeConfig.weightConsistency +
            growthScore * schemeConfig.weightGrowth) /
            100
        )
      : null;

    // Attendance — hard floor, pass/fail only, never scored/weighted.
    const totalAbsentDays = (st.analysis && st.analysis.totalAbsent) || 0;
    const attendancePass = totalAbsentDays <= schemeConfig.attendanceFloor;

    // No-Fail — overall test % (not per-subject) vs base passThreshold,
    // only when the scheme's rule is on; otherwise it always passes.
    let noFailPass = true;
    if (schemeConfig.noFailRule === "Yes") {
      noFailPass = valid.length > 0 && valid.every(v => v >= schemeConfig.passThreshold);
    }

    // Academic — only checked when this scheme's type actually calls for it.
    const academicPass = !needsAcademic || academicAvgPct >= schemeConfig.minAcademicAvg;

    // Income — only relevant for need-based types; three states.
    let incomeCheck = true; // not applicable → treated as passing, unused in eligible
    if (needsIncome) {
      const raw = String(st.annualFamilyIncome || "").trim();
      if (!raw) {
        incomeCheck = "Data Missing";
      } else {
        incomeCheck = parseFloat(raw) <= schemeConfig.maxFamilyIncome;
      }
    }

    // Category — only relevant for Category-based schemes; gated on
    // reserved-category membership (see comment above needsCategory).
    let categoryCheck = true; // not applicable → treated as passing, unused in eligible
    if (needsCategory) {
      const cat = String(st.category || "").trim();
      categoryCheck = !!cat && cat.toLowerCase() !== "general";
    }

    const reasonCodes = [];
    if (needsAcademic && !academicPass) reasonCodes.push("academic_below_min");
    if (!attendancePass) reasonCodes.push("attendance_exceeds_floor");
    if (!noFailPass) reasonCodes.push("no_fail_violated");
    if (needsIncome) {
      if (incomeCheck === "Data Missing") reasonCodes.push("income_data_missing");
      else if (incomeCheck === false) reasonCodes.push("income_exceeds_max");
    }
    if (needsCategory && dataComplete && !categoryCheck) reasonCodes.push("category_not_eligible");

    const eligible =
      dataComplete &&
      academicPass &&
      attendancePass &&
      noFailPass &&
      (!needsIncome || incomeCheck === true) &&
      (!needsCategory || categoryCheck);

    return {
      studentId: st.id,
      academicAvgPct,
      consistencyScore,
      growthScore,
      weightedScore,
      rank: null, // filled in pass 2
      // Task 09 addition: the audit-trail detail view needs the raw
      // Actual value behind every Threshold/Pass-Fail check, not just the
      // boolean — per Task 09 §1 THINK step, exposing these here (instead
      // of having the UI layer re-derive them from st.analysis/schemeConfig
      // independently) keeps a single source of truth and avoids any risk
      // of the audit view's numbers drifting from what eligibility was
      // actually decided on.
      actuals: {
        academicAvgPct,
        attendanceAbsentDays: totalAbsentDays,
        incomeValue: needsIncome ? (String(st.annualFamilyIncome || "").trim() || null) : null,
        minTestPct: valid.length ? Math.min.apply(null, valid) : null,
        categoryValue: needsCategory ? (String(st.category || "").trim() || null) : null
      },
      checks: {
        academic: needsAcademic ? academicPass : null,
        income: needsIncome ? incomeCheck : null,
        attendance: attendancePass,
        noFail: noFailPass,
        category: needsCategory ? categoryCheck : null
      },
      eligible,
      reasonCodes,
      dataComplete,
      missingFields
    };
  });

  // Pass 2: standard competition rank on weightedScore, descending, over
  // dataComplete students only (§ Task 05 — incomplete rows never rank).
  const ranked = scored
    .filter(r => r.dataComplete)
    .sort((a, b) => b.weightedScore - a.weightedScore);
  ranked.forEach((r, i) => {
    r.rank = i > 0 && r.weightedScore === ranked[i - 1].weightedScore ? ranked[i - 1].rank : i + 1;
  });

  // Category Quota % is intentionally never read here (§27) — informational
  // only, consumed by Task 06's BY_CATEGORY view, not eligibility/rank.

  return scored;
}

// Maps a reasonCode + this student's already-computed actuals/schemeConfig
// into the {{placeholder}} params the matching scholarship_reason_<code>
// i18n string needs to render as a concrete, numbers-included sentence
// instead of a bare code name (§ "no key-word reasons — users shouldn't
// have to assume what a code means"). Stays in this pure module (not the
// UI layer) since it's a straight readout of values this engine already
// computed — no independent calculation, no srT()/i18n call of its own,
// so the "no DOM, no UI" contract in the header comment above still
// holds. Callers (UI layer + bal/scholarship-export.js) do the actual
// srT("scholarship_reason_"+code, reasonCodeParams(...)) call themselves.
function reasonCodeParams(code, actuals, schemeConfig) {
  switch (code) {
    case "academic_below_min":
      return { actual: actuals.academicAvgPct, threshold: schemeConfig.minAcademicAvg };
    case "attendance_exceeds_floor":
      return { actual: actuals.attendanceAbsentDays, threshold: schemeConfig.attendanceFloor };
    case "no_fail_violated":
      return { actual: actuals.minTestPct, threshold: schemeConfig.passThreshold };
    case "income_exceeds_max":
      return { actual: actuals.incomeValue, threshold: schemeConfig.maxFamilyIncome };
    case "category_not_eligible":
      return { actual: actuals.categoryValue || "General" };
    default: // income_data_missing / meets_all_criteria — no placeholders
      return {};
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { calculateScholarshipEligibility, reasonCodeParams };
}

// ES module export (Task 08 wiring — imported by scholarship-dashboard.js;
// browser <script type="module"> load, same convention as every other
// js/*.js file). CJS block above stays untouched for the existing
// test-*.js node scripts.
export { calculateScholarshipEligibility, reasonCodeParams };
