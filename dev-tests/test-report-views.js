const { calculateScholarshipEligibility } = require('../js/scholarship-eligibility-engine.js');
const { splitByDataCompleteness } = require('../js/scholarship-completeness-grid.js');
const { buildShortlist, buildByCategory, buildSubjectToppers } = require('../js/scholarship-report-views.js');
const students = require('./students.json');

const meritCumNeed = {
  eligibilityType: "Merit-cum-Need", minAcademicAvg: 60, maxFamilyIncome: 300000,
  noFailRule: "Yes", attendanceFloor: 10, categoryQuota: 30,
  weightAcademic: 50, weightConsistency: 15, weightGrowth: 35, passThreshold: 35
};

const engineResults = calculateScholarshipEligibility(students, meritCumNeed);
const split = splitByDataCompleteness(engineResults, students);

const shortlist = buildShortlist(split.complete, students);
const byCategory = buildByCategory(split.complete, students);
const subjects = ['Mathematics', 'Science', 'English', 'Kannada', 'Social Studies'];
const subjectToppers = buildSubjectToppers(students, subjects);

console.log("=== SHORTLIST (first 5, sorted by rank) ===");
console.log(JSON.stringify(shortlist.slice().sort((a, b) => a.rank - b.rank).slice(0, 5), null, 2));

console.log("\n=== Cross-check: shortlist rank matches Task 04 raw output ===");
const rawById = {};
engineResults.forEach(r => (rawById[r.studentId] = r));
let rankMismatch = false;
shortlist.forEach(row => {
  if (row.rank !== rawById[row.studentId].rank) rankMismatch = true;
});
console.assert(!rankMismatch, "FAIL: shortlist rank diverges from Task 04 output");
console.log("rank match:", !rankMismatch);

console.log("\n=== C7A005 (incomplete) excluded from SHORTLIST/BY_CATEGORY, present in SUBJECT_TOPPERS ===");
console.log("in shortlist:", shortlist.some(r => r.studentId === "C7A005"));
console.log("in byCategory:", byCategory.some(r => r.studentId === "C7A005"));
console.log("in subjectToppers:", subjectToppers.some(r => r.studentId === "C7A005"));
console.assert(!shortlist.some(r => r.studentId === "C7A005"), "FAIL: incomplete student leaked into shortlist");
console.assert(!byCategory.some(r => r.studentId === "C7A005"), "FAIL: incomplete student leaked into byCategory");
console.assert(subjectToppers.some(r => r.studentId === "C7A005"), "FAIL: subjectToppers should include everyone");
console.assert(subjectToppers.length === 30, "FAIL: subjectToppers should include all 30 students, got " + subjectToppers.length);

console.log("\n=== BY_CATEGORY: hand-check one category with 3+ students ===");
const catCounts = {};
byCategory.forEach(r => (catCounts[r.category] = (catCounts[r.category] || 0) + 1));
console.log("category counts:", catCounts);
const pickCat = Object.keys(catCounts).find(c => catCounts[c] >= 3);
const rowsInCat = byCategory.filter(r => r.category === pickCat).sort((a, b) => b.weightedScore - a.weightedScore);
console.log(`Category "${pickCat}" sorted by weightedScore desc:`);
rowsInCat.forEach(r => console.log(`  ${r.studentId} score=${r.weightedScore} rankWithinCategory=${r.rankWithinCategory} rankOverall=${r.rankOverall}`));
let catRankOk = true;
rowsInCat.forEach((r, i) => {
  const expected = i > 0 && r.weightedScore === rowsInCat[i - 1].weightedScore ? rowsInCat[i - 1].rankWithinCategory : i + 1;
  if (r.rankWithinCategory !== expected) catRankOk = false;
});
console.assert(catRankOk, "FAIL: rankWithinCategory incorrect for " + pickCat);
console.log("category rank correct:", catRankOk);

console.log("\n=== SUBJECT_TOPPERS (first 3) ===");
console.log(JSON.stringify(subjectToppers.slice().sort((a, b) => a.overallRank - b.overallRank).slice(0, 3), null, 2));

console.log("\nAll assertions passed (no FAIL lines above means pass).");
