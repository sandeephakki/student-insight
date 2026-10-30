import { calculateScholarshipEligibility } from '../bal/scholarship/scholarship-eligibility-engine.js';
import studentsRaw from './students.json' with { type: 'json' };
const students = studentsRaw;

const meritCumNeed = {
  eligibilityType: "Merit-cum-Need",
  minAcademicAvg: 60,
  maxFamilyIncome: 300000,
  noFailRule: "Yes",
  attendanceFloor: 10,
  categoryQuota: 30,
  weightAcademic: 50,
  weightConsistency: 15,
  weightGrowth: 35,
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

const blankIncomeStudents = JSON.parse(JSON.stringify(students));
blankIncomeStudents[4].annualFamilyIncome = "";
const r2 = calculateScholarshipEligibility(blankIncomeStudents, meritCumNeed);
const target = r2.find(r => r.studentId === blankIncomeStudents[4].id);
console.log("\nBlank-income test:", blankIncomeStudents[4].id, "income check =", target.checks.income, "eligible =", target.eligible, "dataComplete =", target.dataComplete, "missingFields =", target.missingFields);
console.assert(target.checks.income === "Data Missing", "FAIL: expected Data Missing");
console.assert(target.eligible === false, "FAIL: expected ineligible");

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

const rA = calculateScholarshipEligibility(students, meritCumNeed);
const rB = calculateScholarshipEligibility(students, meritOnly);
const rA2 = calculateScholarshipEligibility(students, meritCumNeed);
console.log("\nNo-leak test: rA vs rA2 identical =", JSON.stringify(rA) === JSON.stringify(rA2));
console.log("No-leak test: rA vs rB differ =", JSON.stringify(rA) !== JSON.stringify(rB));
console.assert(JSON.stringify(rA) === JSON.stringify(rA2), "FAIL: same config produced different results (state leak)");
console.assert(JSON.stringify(rA) !== JSON.stringify(rB), "FAIL: different configs produced identical results");

console.log("\nAll assertions passed (no output above this line means pass; console.assert only prints on failure).");