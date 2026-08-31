const { calculateScholarshipEligibility } = require('../js/scholarship-eligibility-engine.js');
const { splitByDataCompleteness } = require('../js/scholarship-completeness-grid.js');
const studentsRaw = require('./students.json');
// add .name (students.json from Task 04 test only had id/income/category/analysis)
const students = studentsRaw.map(s => Object.assign({ name: s.id + " Name" }, s));

const meritCumNeed = {
  eligibilityType: "Merit-cum-Need", minAcademicAvg: 60, maxFamilyIncome: 300000,
  noFailRule: "Yes", attendanceFloor: 10, categoryQuota: 30,
  weightAcademic: 50, weightConsistency: 15, weightGrowth: 35, passThreshold: 35
};

const results1 = calculateScholarshipEligibility(students, meritCumNeed);
const split1 = splitByDataCompleteness(results1, students);
console.log("Merit-cum-Need: complete =", split1.complete.length, "incomplete(error grid) =", split1.errorGrid.length);
console.log("Error grid:", JSON.stringify(split1.errorGrid, null, 2));
console.assert(split1.errorGrid.some(e => e.studentId === "C7A005"), "FAIL: C7A005 (blank income) should be in error grid");
console.assert(!split1.complete.some(r => r.studentId === "C7A005"), "FAIL: C7A005 should be excluded from complete/ranked output");

// Merit-only: same blank-income student should NOT be flagged incomplete.
const meritOnly = {
  eligibilityType: "Merit-only", minAcademicAvg: 60, maxFamilyIncome: null,
  noFailRule: "Yes", attendanceFloor: 10, categoryQuota: 30,
  weightAcademic: 50, weightConsistency: 15, weightGrowth: 35, passThreshold: 35
};
const results2 = calculateScholarshipEligibility(students, meritOnly);
const split2 = splitByDataCompleteness(results2, students);
console.log("\nMerit-only: complete =", split2.complete.length, "incomplete =", split2.errorGrid.length);
console.assert(!split2.errorGrid.some(e => e.studentId === "C7A005"), "FAIL: C7A005 should NOT be flagged under Merit-only");

// Unrelated optional field (Guardian Occupation) never required by any type.
const withBlankGuardian = JSON.parse(JSON.stringify(students));
withBlankGuardian[0].guardianOccupation = "";
const results3 = calculateScholarshipEligibility(withBlankGuardian, meritCumNeed);
const split3 = splitByDataCompleteness(results3, withBlankGuardian);
console.assert(!split3.errorGrid.some(e => e.studentId === withBlankGuardian[0].id), "FAIL: blank Guardian Occupation should never trigger error grid");

console.log("\nAll assertions passed (no FAIL lines above means pass).");
