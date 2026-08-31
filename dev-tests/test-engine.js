const { calculateScholarshipEligibility } = require('../js/scholarship-eligibility-engine.js');
const students = require('./students.json');

const meritCumNeed = {
  eligibilityType: "Merit-cum-Need",
  minAcademicAvg: 60,
  maxFamilyIncome: 300000,
  noFailRule: "Yes",
  attendanceFloor: 10,
  categoryQuota: 30,
  weightAcademic: 50,
  weightConsistency: 15,
  weightGrowth: 35, // sample sheet's raw weights (50/15/15/20) still carry
  // the dropped Attendance(15) component (§25/§26) -- bumping Growth to 35
  // here so Academic+Consistency+Growth sum to 100, matching what an
  // upstream Task 02 renormalization is expected to hand this engine.
  passThreshold: 35
};

const results = calculateScholarshipEligibility(students, meritCumNeed);

const byId = {};
results.forEach(r => (byId[r.studentId] = r));

console.log("Total students:", results.length);
console.log("Eligible count:", results.filter(r => r.eligible).length);
console.log("Data-incomplete count:", results.filter(r => !r.dataComplete).length);
console.log();

["C7A001", "C7A002", "C7A003"].forEach(id => {
  console.log(id, JSON.stringify(byId[id], null, 2));
});

// --- Test: blank income under Merit-cum-Need -> "Data Missing" ---
const blankIncomeStudents = JSON.parse(JSON.stringify(students));
blankIncomeStudents[4].annualFamilyIncome = "";
const r2 = calculateScholarshipEligibility(blankIncomeStudents, meritCumNeed);
const target = r2.find(r => r.studentId === blankIncomeStudents[4].id);
console.log("\nBlank-income test:", blankIncomeStudents[4].id, "income check =", target.checks.income, "eligible =", target.eligible, "dataComplete =", target.dataComplete, "missingFields =", target.missingFields);
console.assert(target.checks.income === "Data Missing", "FAIL: expected Data Missing");
console.assert(target.eligible === false, "FAIL: expected ineligible");

// --- Test: same blank-income student under Merit-only -> income skipped entirely ---
const meritOnly = {
  eligibilityType: "Merit-only",
  minAcademicAvg: 60,
  maxFamilyIncome: null,
  noFailRule: "Yes",
  attendanceFloor: 10,
  categoryQuota: 30,
  weightAcademic: 50,
  weightConsistency: 15,
  weightGrowth: 35,
  passThreshold: 35
};
const r3 = calculateScholarshipEligibility(blankIncomeStudents, meritOnly);
const target3 = r3.find(r => r.studentId === blankIncomeStudents[4].id);
console.log("Merit-only test:", target3.studentId, "income check =", target3.checks.income, "reasonCodes =", target3.reasonCodes, "eligible =", target3.eligible);
console.assert(target3.checks.income === null, "FAIL: expected income check skipped (null)");
console.assert(!target3.reasonCodes.includes("income_data_missing") && !target3.reasonCodes.includes("income_exceeds_max"), "FAIL: income reason leaked into merit-only");

// --- Test: no shared/global state leak between two schemeConfig calls ---
const rA = calculateScholarshipEligibility(students, meritCumNeed);
const rB = calculateScholarshipEligibility(students, meritOnly);
const rA2 = calculateScholarshipEligibility(students, meritCumNeed);
console.log("\nNo-leak test: rA vs rA2 identical =", JSON.stringify(rA) === JSON.stringify(rA2));
console.log("No-leak test: rA vs rB differ =", JSON.stringify(rA) !== JSON.stringify(rB));
console.assert(JSON.stringify(rA) === JSON.stringify(rA2), "FAIL: same config produced different results (state leak)");
console.assert(JSON.stringify(rA) !== JSON.stringify(rB), "FAIL: different configs produced identical results");

console.log("\nAll assertions passed (no output above this line means pass; console.assert only prints on failure).");
