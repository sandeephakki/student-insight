// Task 05: Data-Completeness Check + Static Error Grid.
// Thin layer over Task 04's calculateScholarshipEligibility() output — does
// NOT recompute completeness, just filters/groups + builds the grid + logs.
// Phase 1: view-only. No edit capability here (Phase 2 scope, not built).

// Field -> i18n key mapping (§ i18n compliance). Task 08 renders the label
// via srtScholarship(key) — this module never emits raw English strings.
const MISSING_FIELD_I18N_KEYS = {
  testAvgs: "scholarship.error_grid.missing_test_data",
  annualFamilyIncome: "scholarship.error_grid.missing_annual_family_income",
  category: "scholarship.error_grid.missing_category"
};

// splitByDataCompleteness(engineResults, students)
//   engineResults: output array from Task 04's calculateScholarshipEligibility().
//   students: the same student list passed into Task 04 (for id -> name lookup).
// Returns: { complete: [...engineResults with dataComplete:true],
//            errorGrid: [{ studentId, name, missingFieldKeys: [...] }] }
function splitByDataCompleteness(engineResults, students) {
  const nameById = {};
  students.forEach(st => {
    nameById[st.id] = st.name || st.id;
  });

  const complete = [];
  const errorGrid = [];

  engineResults.forEach(r => {
    if (r.dataComplete) {
      complete.push(r);
      return;
    }
    errorGrid.push({
      studentId: r.studentId,
      name: nameById[r.studentId] || r.studentId,
      missingFieldKeys: r.missingFields.map(f => MISSING_FIELD_I18N_KEYS[f] || f)
    });
    // DATA_ERROR log entry per §35 schema, one per missing field.
    r.missingFields.forEach(field => {
      logDataError(r.studentId, field);
    });
  });

  return { complete, errorGrid };
}

// Task 12's real logger isn't built yet — stub matching §35's DATA_ERROR
// shape exactly, so wiring in the real one later is a one-line swap.
// TODO: wire to Task 12's logDebugEntry() once built.
function logDataError(studentId, field) {
  const entry = {
    timestamp: new Date().toISOString(),
    type: "DATA_ERROR",
    module: "scholarship_engine",
    action: "calculate_eligibility",
    student_id: studentId,
    field,
    value_found: "",
    message: `Required field missing for active scheme (${field})`
  };
  if (typeof window !== "undefined" && window.logDebugEntry) {
    window.logDebugEntry(entry);
  }
  // else: no-op stub until Task 12 exists.
  return entry;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { splitByDataCompleteness, MISSING_FIELD_I18N_KEYS };
}

// ES module export — Task 08 wiring, same rationale as the engine file.
export { splitByDataCompleteness, MISSING_FIELD_I18N_KEYS };
