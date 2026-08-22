/* ============================================================
   Regression tests — EXCEL_DATA_MATH_AUDIT_PROMPT.md.

   Run: node test/regression-audit.test.js

   Two groups:
   1. Unit tests for the shared strict parsers (js/mark-parse.js) and
      the tie-aware percentile policy (js/compute-compare.js) — pure,
      no APP/DOM needed for the parser half; the percentile test uses
      the same minimal jsdom+jQuery+vendor-global harness as
      test/compute-engine.test.js since computePercentiles() reads
      APP.students.
   2. A full-pipeline run against the real audit fixture
      (samples/Sample_02_For_School_Class_Teacher.xlsx) verifying the
      baseline numbers in the audit prompt: 30 students, 5 subjects,
      4 tests, class mean 61% / median 60.5%, the two 96% top scorers
      sharing rank AND percentile, zero data issues on the untouched
      sample, and weighted (not averaged-rounded) overall scores.
   ============================================================ */
const fs = require("fs");
const path = require("path");
const { test, assertEqual, summary } = require("./tiny-test.js");

function approxEqual(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error((msg ? msg + " — " : "") + `expected ~${expected} (±${tolerance}), got ${actual}`);
  }
}

async function main() {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, "../index.html"), "utf8"), {
    url: "http://localhost/",
    runScripts: undefined,
  });
  const jqFactory = require("jquery");
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.localStorage = dom.window.localStorage;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  global.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){} });
  global.location = dom.window.location;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.alert = () => {};
  dom.window.confirm = () => true;
  const $ = jqFactory(dom.window);
  global.$ = global.jQuery = dom.window.$ = dom.window.jQuery = $;
  global.Chart = dom.window.Chart = require("chart.js/auto").Chart;
  const { jsPDF } = require("jspdf");
  global.jsPDF = dom.window.jsPDF = jsPDF;
  dom.window.jspdf = { jsPDF };
  global.JSZip = dom.window.JSZip = require("jszip");
  const XLSX = require("xlsx");
  global.XLSX = dom.window.XLSX = XLSX;

  global.APP = dom.window.APP = { setup: {} }; // placeholder; overwritten by state-nav.js's own APP object below

  const ns = {};
  for (const f of ["mark-parse.js", "env-config.js", "compute-stats.js", "compute-compare.js", "template-upload.js"]) {
    const modNs = await import(`file://${path.join(__dirname, "../js/" + f)}?t=${Date.now()}`);
    Object.assign(ns, modNs);
    Object.assign(globalThis, modNs);
  }
  // state-nav.js owns the real, shared APP object every other module
  // closes over (imported as a live binding, not read off window/global).
  // MUST be loaded WITHOUT a cache-busting query string here, so Node's
  // module cache resolves this import to the exact same module instance
  // the files above already pulled in transitively via their own plain
  // `./state-nav.js` relative imports — a `?t=` query would otherwise
  // create a second, disconnected state-nav.js instance with its own
  // separate APP object that no other function actually reads or writes.
  const stateNavNs = await import(`file://${path.join(__dirname, "../js/state-nav.js")}`);
  Object.assign(ns, stateNavNs);
  const APPref = stateNavNs.APP;

  runParserTests(ns);
  runPercentileTests(ns, APPref);
  await runSampleFixtureTests(ns, APPref);
  await runRoundTripTest(ns, APPref);
  await runRankPreservationTest(ns, APPref);
  await runContinuityMarkParsingTest(ns, APPref);
  await runAbsenceIntegrationTest(ns, APPref);
  await runInvalidMaxMarkBlocksAnalysisTest(ns, APPref);
  await runSheetNameResolutionTests(ns, APPref);
  await runDuplicateNameBlockingTests(ns, APPref);
  await runCappedMarkExportGateTest(ns, APPref);

  summary();
}

main().catch(e => { console.error("TEST SETUP FAILED:", e); process.exit(1); });

/* ---- item 2/3/4: strict parsers ---- */
function runParserTests(ns) {
  const { parseStrictMark, parseStrictAbsence, parseStrictMaxMark } = ns;

  test("parseStrictMark: '50.5.5' is rejected, not reinterpreted as 50.5", () => {
    assertEqual(parseStrictMark("50.5.5").status, "invalid");
  });
  test("parseStrictMark: '1-2' is rejected, not reinterpreted as 1", () => {
    assertEqual(parseStrictMark("1-2").status, "invalid");
  });
  test("parseStrictMark: '1e2' is rejected, not reinterpreted as 12 (or 100)", () => {
    assertEqual(parseStrictMark("1e2").status, "invalid");
  });
  test("parseStrictMark: '10/20' is rejected, not reinterpreted as 1020", () => {
    assertEqual(parseStrictMark("10/20").status, "invalid");
  });
  test("parseStrictMark: '50' is valid 50", () => {
    assertEqual(parseStrictMark("50"), { status: "valid", value: 50, reason: null });
  });
  test("parseStrictMark: ' 50.5 ' trims to valid 50.5", () => {
    assertEqual(parseStrictMark(" 50.5 "), { status: "valid", value: 50.5, reason: null });
  });
  test("parseStrictMark: native number 50 is valid 50", () => {
    assertEqual(parseStrictMark(50), { status: "valid", value: 50, reason: null });
  });
  test("parseStrictMark: blank/null/undefined/'' is 'blank'", () => {
    assertEqual(parseStrictMark(null).status, "blank");
    assertEqual(parseStrictMark(undefined).status, "blank");
    assertEqual(parseStrictMark("").status, "blank");
    assertEqual(parseStrictMark("   ").status, "blank");
  });
  test("parseStrictMark: negative mark parses as a valid number (business rule rejects it separately)", () => {
    assertEqual(parseStrictMark("-5"), { status: "valid", value: -5, reason: null });
  });
  test("parseStrictMark: Infinity/NaN are invalid, never a fallback number", () => {
    assertEqual(parseStrictMark(Infinity).status, "invalid");
    assertEqual(parseStrictMark(-Infinity).status, "invalid");
    assertEqual(parseStrictMark(NaN).status, "invalid");
    assertEqual(parseStrictMark("Infinity").status, "invalid");
    assertEqual(parseStrictMark("NaN").status, "invalid");
  });
  test("parseStrictMark: leading '=' is invalid (untrusted/formula input)", () => {
    assertEqual(parseStrictMark("=SUM(A1:A2)").status, "invalid");
  });

  test("parseStrictAbsence: -2 is invalid, never becomes 0 silently", () => {
    assertEqual(parseStrictAbsence(-2).status, "invalid");
    assertEqual(parseStrictAbsence("-2").status, "invalid");
  });
  test("parseStrictAbsence: 'two' is invalid", () => {
    assertEqual(parseStrictAbsence("two").status, "invalid");
  });
  test("parseStrictAbsence: '1.5' is invalid (must be whole)", () => {
    assertEqual(parseStrictAbsence("1.5").status, "invalid");
  });
  test("parseStrictAbsence: '3' is valid 3, blank is 'blank'", () => {
    assertEqual(parseStrictAbsence("3"), { status: "valid", value: 3, reason: null });
    assertEqual(parseStrictAbsence("").status, "blank");
  });

  test("parseStrictMaxMark: 0 is invalid, never silently becomes 100", () => {
    assertEqual(parseStrictMaxMark(0).status, "invalid");
    assertEqual(parseStrictMaxMark("0").status, "invalid");
  });
  test("parseStrictMaxMark: -1 is invalid (stays invalid, not truthy-negative)", () => {
    assertEqual(parseStrictMaxMark(-1).status, "invalid");
    assertEqual(parseStrictMaxMark("-1").status, "invalid");
  });
  test("parseStrictMaxMark: 'abc' is invalid", () => {
    assertEqual(parseStrictMaxMark("abc").status, "invalid");
  });
  test("parseStrictMaxMark: '50.5' is invalid (not a whole number)", () => {
    assertEqual(parseStrictMaxMark("50.5").status, "invalid");
  });
  test("parseStrictMaxMark: blank field is 'blank' (caller applies the 100 legacy fallback)", () => {
    assertEqual(parseStrictMaxMark("").status, "blank");
    assertEqual(parseStrictMaxMark(null).status, "blank");
  });
  test("parseStrictMaxMark: 1/50/100 are all valid", () => {
    assertEqual(parseStrictMaxMark(1), { status: "valid", value: 1, reason: null });
    assertEqual(parseStrictMaxMark("50"), { status: "valid", value: 50, reason: null });
    assertEqual(parseStrictMaxMark(100), { status: "valid", value: 100, reason: null });
  });
}

/* ---- item 1: tie-aware percentiles ---- */
function runPercentileTests(ns, APPref) {
  const { computePercentiles } = ns;

  function mkStudents(scores) {
    return scores.map((v, i) => ({ id: "S" + i, analysis: { overallAvg: v } }));
  }
  function resetApp(students) {
    Object.keys(APPref).forEach(k => delete APPref[k]);
    Object.assign(APPref, { setup: { subjects: [], tests: [] }, students, dataIssues: [] });
  }

  test("computePercentiles: two-way tie (the audit sample's 96% pair) gets equal percentiles", () => {
    resetApp(mkStudents([40, 55, 96, 96, 70]));
    computePercentiles();
    const byId = Object.fromEntries(APPref.students.map(s => [s.id, s.analysis.percentile]));
    assertEqual(byId.S2, byId.S3, "both 96% students must share a percentile");
  });

  test("computePercentiles: three-way tie all get equal percentiles, in 0-100 range", () => {
    resetApp(mkStudents([30, 50, 50, 50, 90]));
    computePercentiles();
    const tied = APPref.students.filter(s => s.analysis.overallAvg === 50).map(s => s.analysis.percentile);
    assertEqual(tied[0], tied[1]);
    assertEqual(tied[1], tied[2]);
    tied.forEach(p => { if (p < 0 || p > 100) throw new Error(`percentile ${p} out of 0-100 range`); });
  });

  test("computePercentiles: distinct scores still spread out (not all collapsed to one value)", () => {
    resetApp(mkStudents([10, 40, 70, 100]));
    computePercentiles();
    const pcts = APPref.students.map(s => s.analysis.percentile);
    assertEqual(new Set(pcts).size, 4, "four distinct scores should give four distinct percentiles");
    assertEqual(pcts[0], 0);
    assertEqual(pcts[3], 100);
  });

  test("computePercentiles: single-student class is 100", () => {
    resetApp(mkStudents([77]));
    computePercentiles();
    assertEqual(APPref.students[0].analysis.percentile, 100);
  });

  test("computePercentiles: empty class never throws", () => {
    resetApp([]);
    computePercentiles();
  });
}

/* ---- full-pipeline audit-baseline regression against the real sample ---- */
async function runSampleFixtureTests(ns, APPref) {
  const { parseWorkbookSheets, autoInferSetup, validateData, parseStudents, computeAnalysis } = ns;
  const XLSX = global.XLSX;
  const fixturePath = path.join(__dirname, "../samples/Sample_02_For_School_Class_Teacher.xlsx");

  if (!fs.existsSync(fixturePath)) {
    test("SKIPPED: Sample_02 fixture not found on disk", () => {});
    return;
  }

  const buf = fs.readFileSync(fixturePath);
  const wb = XLSX.read(buf, { type: "buffer" });

  resetAppForImport(APPref);
  parseWorkbookSheets(wb);
  autoInferSetup();
  const errs = validateData();

  test("Sample_02: no blocking validation errors on the untouched sample", () => {
    const blocking = errs.filter(e => e.e);
    if (blocking.length) throw new Error("unexpected blocking errors: " + JSON.stringify(blocking));
  });

  parseStudents();
  computeAnalysis();

  test("Sample_02: 30 students parsed", () => {
    assertEqual(APPref.students.length, 30);
  });
  test("Sample_02: 5 subjects, 4 tests configured", () => {
    assertEqual(APPref.setup.subjects.length, 5);
    assertEqual(APPref.setup.tests.length, 4);
  });
  test("Sample_02: no data issues on the untouched sample", () => {
    if ((APPref.dataIssues || []).length) {
      throw new Error("unexpected data issues: " + JSON.stringify(APPref.dataIssues));
    }
  });

  const byId = Object.fromEntries(APPref.students.map(s => [s.id, s]));

  test("Sample_02: C7A001 overall 91%, per-test 89/92/96/88", () => {
    const st = byId["C7A001"];
    if (!st) throw new Error("C7A001 not found");
    assertEqual(st.analysis.overallAvg, 91);
    assertEqual(st.analysis.testAvgs, [89, 92, 96, 88]);
  });
  test("Sample_02: C7A013 overall 96%, per-test 96/94/96/97", () => {
    const st = byId["C7A013"];
    if (!st) throw new Error("C7A013 not found");
    assertEqual(st.analysis.overallAvg, 96);
    assertEqual(st.analysis.testAvgs, [96, 94, 96, 97]);
  });
  test("Sample_02: C7A009 overall 15%, per-test 16/14/14/17", () => {
    const st = byId["C7A009"];
    if (!st) throw new Error("C7A009 not found");
    assertEqual(st.analysis.overallAvg, 15);
    assertEqual(st.analysis.testAvgs, [16, 14, 14, 17]);
  });

  test("Sample_02: class mean displays as 61% (raw 60.9667%)", () => {
    assertEqual(APPref.classStats.mean, 61);
  });
  test("Sample_02: median is 60.5%", () => {
    assertEqual(APPref.classStats.median, 60.5);
  });

  test("Sample_02: C7A013 and C7A025 are the top scorers at 96%, tied", () => {
    const a = byId["C7A013"], b = byId["C7A025"];
    if (!a || !b) throw new Error("expected top scorers not found");
    assertEqual(a.analysis.overallAvg, 96);
    assertEqual(b.analysis.overallAvg, 96);
    const top = Math.max(...APPref.students.map(s => s.analysis.overallAvg));
    assertEqual(top, 96);
  });
  test("Sample_02: the two 96% students share the same competition rank", () => {
    const a = byId["C7A013"], b = byId["C7A025"];
    assertEqual(a.analysis.rank, b.analysis.rank);
    assertEqual(a.analysis.rank, 1, "top scorers should be rank 1");
  });
  test("Sample_02: the two 96% students ALSO share the same percentile (item 1 fix)", () => {
    const a = byId["C7A013"], b = byId["C7A025"];
    assertEqual(a.analysis.percentile, b.analysis.percentile);
  });
}

function resetAppForImport(APPref) {
  Object.keys(APPref).forEach(k => delete APPref[k]);
  Object.assign(APPref, {
    currentStep: "home",
    setup: { mode: "institution", modeLocked: false, instName: "", instType: "", location: "", contact: "",
      className: "", section: "", year: "", teacher: "", scoring: { marks: true, pct: true, grade: false, pf: false },
      passThreshold: 35, absentAlert: 3, dropAlert: 20, subjects: [], tests: [] },
    rawData: null, students: [], classStats: null, genderAnalysis: null, dataIssues: [],
    compareMode: false, sections: [], sectionComparison: [], aiFeatures: new Set(["all"]),
    filter: "all", sort: "rank", individualSelectedId: null,
  });
}

/* ---- item 7 + baseline #7: export/import round trip must not touch
   marks/totals/grades, and must genuinely preserve an unrelated sheet
   and a formula-bearing cell, since downloadUpdatedSheet() now clones
   the original workbook and patches only Remark cells in place. This
   exercises the REAL production function — not a re-implementation —
   by intercepting XLSX.writeFile() to capture the workbook it would
   have downloaded, instead of hitting the filesystem. ---- */
async function runRoundTripTest(ns, APPref) {
  const { parseWorkbookSheets, autoInferSetup, parseStudents, computeAnalysis } = ns;
  const renderCoreNs = await import(`file://${path.join(__dirname, "../js/render-core.js")}`);
  const XLSX = global.XLSX;
  const fixturePath = path.join(__dirname, "../samples/Sample_02_For_School_Class_Teacher.xlsx");
  if (!fs.existsSync(fixturePath)) {
    test("SKIPPED: Sample_02 fixture not found on disk (round-trip test)", () => {});
    return;
  }

  // 1) Import the sample, then graft an unrelated sheet and a
  // formula-bearing cell onto the in-memory workbook BEFORE parsing, so
  // the round trip has something non-trivial to prove it preserved.
  const wb = XLSX.read(fs.readFileSync(fixturePath), { type: "buffer" });
  wb.SheetNames.push("Notes (unrelated)");
  wb.Sheets["Notes (unrelated)"] = XLSX.utils.aoa_to_sheet([["Unrelated", "Data"], ["foo", "bar"]]);
  const testWs = wb.Sheets["Class7A-Unit Test 1"];
  const formulaAddr = "Z100";
  testWs[formulaAddr] = { t: "n", f: "1+1", v: 2 };
  const r = XLSX.utils.decode_range(testWs["!ref"]);
  const c = XLSX.utils.decode_cell(formulaAddr);
  if (c.r > r.e.r) r.e.r = c.r;
  if (c.c > r.e.c) r.e.c = c.c;
  testWs["!ref"] = XLSX.utils.encode_range(r);

  resetAppForImport(APPref);
  parseWorkbookSheets(wb);
  autoInferSetup();
  parseStudents();
  computeAnalysis();

  const before = {};
  APPref.students.forEach(st => {
    before[st.id] = { overallAvg: st.analysis.overallAvg, rank: st.analysis.rank,
      percentile: st.analysis.percentile, testAvgs: [...st.analysis.testAvgs] };
  });

  // 2) Simulate a teacher editing one Remark (what saveRemarkEdit() does),
  // then call the REAL downloadUpdatedSheet(), intercepting XLSX.writeFile
  // so nothing hits disk but we still get the exact workbook it built.
  const editedId = "C7A001", editedTest = "Class7A-Unit Test 1", editedRemark = "ROUND TRIP TEST REMARK — needs more practice";
  const editedStudent = APPref.students.find(s => s.id === editedId);
  if (!editedStudent) { test("SKIPPED: round-trip edit target student not found", () => {}); return; }
  editedStudent.testData[editedTest].remark = editedRemark;

  let capturedWb = null;
  const origWriteFile = XLSX.writeFile;
  XLSX.writeFile = (wbArg) => { capturedWb = wbArg; };
  try {
    renderCoreNs.downloadUpdatedSheet();
  } finally {
    XLSX.writeFile = origWriteFile;
  }

  test("round trip: downloadUpdatedSheet() actually produced a workbook", () => {
    if (!capturedWb) throw new Error("XLSX.writeFile was never called");
  });
  if (!capturedWb) return;

  // 3) Genuinely serialize and re-parse (not just inspect the in-memory
  // object) — this is what proves the .xlsx container itself, not just
  // the JS object, preserves everything.
  const buf = XLSX.write(capturedWb, { type: "buffer", bookType: "xlsx" });
  const wb2 = XLSX.read(buf, { type: "buffer" });

  test("round trip: unrelated sheet survives, content unchanged", () => {
    if (!wb2.SheetNames.includes("Notes (unrelated)")) throw new Error("unrelated sheet missing after round trip");
    const rows = XLSX.utils.sheet_to_json(wb2.Sheets["Notes (unrelated)"], { header: 1 });
    assertEqual(rows[0], ["Unrelated", "Data"]);
    assertEqual(rows[1], ["foo", "bar"]);
  });
  test("round trip: formula-bearing cell survives with its formula intact", () => {
    const cell = wb2.Sheets["Class7A-Unit Test 1"][formulaAddr];
    if (!cell) throw new Error("formula cell missing after round trip");
    assertEqual(cell.f, "1+1");
  });
  test("round trip: edited Remark shows up in the written-out sheet", () => {
    const ws = wb2.Sheets["Class7A-Unit Test 1"];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const header = rows[0].map(h => (h == null ? "" : String(h).trim()));
    const idIdx = header.indexOf("Student ID"), rmIdx = header.indexOf("Remark");
    const dataRow = rows.find((row, i) => i > 0 && String(row[idIdx] || "").trim().toUpperCase() === editedId);
    if (!dataRow) throw new Error("edited student's row not found in round-tripped sheet");
    assertEqual(dataRow[rmIdx], editedRemark);
  });

  // 4) Re-run the FULL pipeline against the round-tripped file and prove
  // marks/totals/ranks/percentiles for every student are byte-identical
  // to before the round trip — only the one edited Remark should differ.
  resetAppForImport(APPref);
  parseWorkbookSheets(wb2);
  autoInferSetup();
  parseStudents();
  computeAnalysis();

  test("round trip: no data issues introduced by the round trip", () => {
    if ((APPref.dataIssues || []).length) {
      throw new Error("unexpected data issues after round trip: " + JSON.stringify(APPref.dataIssues));
    }
  });
  test("round trip: every student's marks/totals/rank/percentile are unchanged", () => {
    if (APPref.students.length !== Object.keys(before).length) {
      throw new Error(`student count changed: was ${Object.keys(before).length}, now ${APPref.students.length}`);
    }
    APPref.students.forEach(st => {
      const b = before[st.id];
      if (!b) throw new Error(`student ${st.id} missing from before-snapshot`);
      assertEqual(st.analysis.overallAvg, b.overallAvg, `${st.id} overallAvg`);
      assertEqual(st.analysis.rank, b.rank, `${st.id} rank`);
      assertEqual(st.analysis.percentile, b.percentile, `${st.id} percentile`);
      assertEqual(st.analysis.testAvgs, b.testAvgs, `${st.id} testAvgs`);
    });
  });
}

async function runRankPreservationTest(ns, APPref) {
  const XLSX = global.XLSX;
  const fixturePath = path.join(__dirname, "../samples/Sample_02_For_School_Class_Teacher.xlsx");
  if (!fs.existsSync(fixturePath)) { test("SKIPPED: rank preservation (fixture missing)", () => {}); return; }
  resetAppForImport(APPref);
  const wb = XLSX.read(fs.readFileSync(fixturePath), { type: "buffer" });
  ns.parseWorkbookSheets(wb);
  ns.autoInferSetup();
  ns.parseStudents();
  ns.computeAnalysis();

  test("Sample_02: competition ranking is 1,1,3 (not 1,1,2) after the two-way tie", () => {
    const sorted = [...APPref.students].sort((a, b) => b.analysis.overallAvg - a.analysis.overallAvg);
    assertEqual(sorted[0].analysis.overallAvg, 96);
    assertEqual(sorted[1].analysis.overallAvg, 96);
    assertEqual(sorted[0].analysis.rank, 1, "1st place");
    assertEqual(sorted[1].analysis.rank, 1, "tied for 1st");
    if (sorted[2].analysis.overallAvg === sorted[1].analysis.overallAvg) {
      throw new Error("test fixture assumption broken: expected only a two-way tie at the top");
    }
    assertEqual(sorted[2].analysis.rank, 3, "next distinct score must be rank 3, not 2 — standard competition ranking");
  });
}

/* ---- item 2 (continuity path): parseContinuityPeriods() must reject a
   malformed mark exactly like parseStudents() does, not silently
   reinterpret it via the old parseFloat(...replace...) pattern. Exercised
   directly against parseContinuityPeriods() with a fabricated 2-period
   SETUP kv + matching APP.rawData, since building a full multi-period
   .xlsx fixture from scratch would test little beyond this same code. ---- */
async function runContinuityMarkParsingTest(ns, APPref) {
  Object.keys(APPref).forEach(k => delete APPref[k]);
  Object.assign(APPref, {
    setup: { subjects: [], tests: [] },
    rawData: {
      _sheetIndex: { T1: "T1", T2: "T2" }, _sheetCollisions: [],
      STUDENTS: [
        { "Student ID": "S1", "Full Name": "Student One" },
        { "Student ID": "S2", "Full Name": "Student Two" },
      ],
      // S1's Period-1 mark is malformed ("1e2" — the old bug reinterpreted
      // this as 12, contributing a corrupted 24% to their average). S2's
      // is a normal valid mark, as a control that the fix didn't just
      // break continuity parsing outright.
      T1: [
        { "Student ID": "S1", "Math Marks": "1e2" },
        { "Student ID": "S2", "Math Marks": 40 },
      ],
      T2: [
        { "Student ID": "S1", "Math Marks": 30 },
        { "Student ID": "S2", "Math Marks": 35 },
      ],
    },
    dataIssues: [],
  });

  const kv = {
    "Period Count": "2",
    "Period 1 Label": "P1", "Period 1 Subject 1": "Math",
    "Period 1 Test 1 Name": "T1", "Period 1 Max Marks - Math (Test 1)": "50",
    "Period 2 Label": "P2", "Period 2 Subject 1": "Math",
    "Period 2 Test 1 Name": "T2", "Period 2 Max Marks - Math (Test 1)": "50",
  };
  ns.parseContinuityPeriods(kv);

  test("continuity: malformed mark ('1e2') never contributes a reinterpreted value", () => {
    const s1 = APPref.continuity.students.find(s => s.id === "S1");
    if (!s1) throw new Error("S1 not found in continuity output");
    // Old bug: "1e2" -> stripped to "12" -> (12/50)*100 = 24%, silently
    // stored as S1's Period-1 percentage. Correct behaviour: the
    // malformed mark contributes nothing, so with zero valid marks that
    // period, S1's Period-1 entry stays null (a real gap), not a
    // fabricated 24.
    assertEqual(s1.pctByPeriod[0], null, "malformed mark must leave the period as a real gap, not a corrupted number");
    if (s1.pctByPeriod[0] === 24) throw new Error("regression: malformed mark '1e2' was reinterpreted as 12/50=24%, exactly the old bug");
  });
  test("continuity: a normal valid mark in the same sheet still parses correctly (control)", () => {
    const s2 = APPref.continuity.students.find(s => s.id === "S2");
    if (!s2) throw new Error("S2 not found in continuity output");
    assertEqual(s2.pctByPeriod[0], 80, "40/50 = 80%");
  });
  test("continuity: Period 2 (all valid marks) is unaffected by Period 1's malformed value", () => {
    const s1 = APPref.continuity.students.find(s => s.id === "S1");
    assertEqual(s1.pctByPeriod[1], 60, "30/50 = 60%");
  });
}

/* ---- item 3: malformed/negative absence counts must not alter
   totalAbsent, engagementIndex, or absence flags for the affected
   student, and must not leak into any other student's numbers ---- */
async function runAbsenceIntegrationTest(ns, APPref) {
  Object.keys(APPref).forEach(k => delete APPref[k]);
  Object.assign(APPref, {
    setup: {
      subjects: ["Math"], tests: [{ name: "T1", maxMarks: { Math: 50 } }],
      scoring: { marks: true, pct: true, grade: false, pf: false },
      passThreshold: 35, absentAlert: 3, dropAlert: 20,
    },
    rawData: {
      _sheetIndex: { T1: "T1" }, _sheetCollisions: [],
      STUDENTS: [
        { "Student ID": "SA", "Full Name": "Student A" },
        { "Student ID": "SB", "Full Name": "Student B" },
        { "Student ID": "SC", "Full Name": "Student C" },
        { "Student ID": "SD", "Full Name": "Student D" },
      ],
      T1: [
        { "Student ID": "SA", "Math Marks": 40, "Absent Days": "-2" },
        { "Student ID": "SB", "Math Marks": 40, "Absent Days": "two" },
        { "Student ID": "SC", "Math Marks": 40, "Absent Days": "1.5" },
        { "Student ID": "SD", "Math Marks": 40, "Absent Days": 3 },
      ],
    },
    dataIssues: [], students: [],
  });

  ns.parseStudents();
  ns.computeAnalysis();
  const byId = Object.fromEntries(APPref.students.map(s => [s.id, s]));

  ["SA", "SB", "SC"].forEach(id => {
    test(`absence: malformed value for ${id} leaves totalAbsent at 0 (not corrupted/negative)`, () => {
      assertEqual(byId[id].analysis.totalAbsent, 0);
    });
    test(`absence: malformed value for ${id} leaves engagementIndex at full (100)`, () => {
      assertEqual(byId[id].analysis.engagementIndex, 100);
    });
    test(`absence: malformed value for ${id} never raises an absence flag`, () => {
      const hasAbsentFlag = byId[id].flags.some(f => f.type === "absent");
      if (hasAbsentFlag) throw new Error(`${id} unexpectedly has an absence flag from a malformed (non-)value`);
    });
    test(`absence: malformed value for ${id} is recorded as a data issue (not silently dropped)`, () => {
      const has = APPref.dataIssues.some(d => d.studentId === id && /Absent Days/.test(d.message));
      if (!has) throw new Error(`expected a data issue for ${id}'s malformed Absent Days value`);
    });
  });
  test("absence: a genuinely valid absence count (SD, 3 days) still works and raises the flag", () => {
    assertEqual(byId.SD.analysis.totalAbsent, 3);
    const hasAbsentFlag = byId.SD.flags.some(f => f.type === "absent");
    if (!hasAbsentFlag) throw new Error("SD should have an absence flag at 3 days (absentAlert=3)");
  });
}

/* ---- shared helper for items 4/5/6/8: builds a small real .xlsx
   workbook (SETUP + STUDENTS + one test sheet) in the exact shape
   autoInferSetup()/parseStudents() expect, so these tests exercise the
   REAL import pipeline end-to-end rather than fabricating APP.rawData
   by hand. ---- */
function buildSyntheticWorkbook(XLSX, opts) {
  const o = Object.assign({
    subjects: ["Math", "Science"],
    testName: "T1",
    testSheetName: null, // defaults to testName; override to test a case/whitespace-mismatched tab
    maxMarks: { Math: 50, Science: 50 },
    students: [{ id: "S1", name: "Student One" }, { id: "S2", name: "Student Two" }],
    marksByStudent: { S1: { Math: 40, Science: 35 }, S2: { Math: 45, Science: 30 } },
    extraSheets: {}, // name -> array-of-arrays, for collision tests
  }, opts);
  const setupRows = [
    ["MODE", null], ["Usage Mode", "institution"],
    ["INSTITUTION", null], ["Institution Name", "Test School"], ["Type", "School"], ["Location", "Test City"], ["Contact", "test@example.com"],
    ["CLASS / BATCH", null], ["Class / Batch", "Class 1"], ["Section", "A"], ["Academic Year", "2025-26"], ["Teacher Name", "Test Teacher"],
    ["SUBJECTS", null],
  ];
  o.subjects.forEach((s, i) => setupRows.push([`Subject ${i + 1}`, s]));
  setupRows.push(["TESTS", null], ["Test 1 Name", o.testName], ["Test 1 Date", "2025-06-15"]);
  o.subjects.forEach(s => setupRows.push([`Max Marks - ${s} (Test 1)`, o.maxMarks[s]]));
  setupRows.push(
    ["SCORING CONFIG", null], ["Pass Threshold %", 35], ["Absent Alert (days)", 3], ["Drop Alert %", 20],
    ["Display Marks", "Yes"], ["Display Percentage", "Yes"], ["Display Grade", "Yes"], ["Display Pass/Fail", "Yes"],
  );

  const studentRows = [["Student ID", "Full Name", "Gender"]];
  o.students.forEach(s => studentRows.push([s.id, s.name, ""]));

  const testHeader = ["Student ID", ...o.subjects.map(s => s + " Marks"), "Absent Days", "Chapter", "Remark"];
  const testRows = [testHeader];
  o.students.forEach(s => {
    const m = o.marksByStudent[s.id] || {};
    testRows.push([s.id, ...o.subjects.map(sub => (m[sub] !== undefined ? m[sub] : "")), 0, "", ""]);
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(setupRows), "SETUP");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(studentRows), "STUDENTS");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(testRows), o.testSheetName || o.testName);
  Object.entries(o.extraSheets).forEach(([name, rows]) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  });
  return wb;
}

/* ---- item 4: a SUPPLIED-but-invalid max mark (0) must block analysis,
   never silently fall back to 100 ---- */
async function runInvalidMaxMarkBlocksAnalysisTest(ns, APPref) {
  const XLSX = global.XLSX;
  resetAppForImport(APPref);
  const wb = buildSyntheticWorkbook(XLSX, { maxMarks: { Math: 0, Science: 50 } });
  ns.parseWorkbookSheets(wb);
  ns.autoInferSetup();
  const errs = ns.validateData();

  test("invalid max mark (0): autoInferSetup() records it, never silently substitutes 100", () => {
    const found = (APPref.setup._maxMarkErrors || []).some(e => /Math/.test(e.label) && String(e.raw) === "0");
    if (!found) throw new Error("expected a recorded max-mark error for Math=0, got: " + JSON.stringify(APPref.setup._maxMarkErrors));
  });
  test("invalid max mark (0): validateData() returns a BLOCKING error naming the subject/test", () => {
    const blocking = errs.filter(e => e.e);
    const found = blocking.some(e => /Math/.test(e.m) && /Test 1/.test(e.m));
    if (!found) throw new Error("expected a blocking validateData() error naming Math/Test 1, got: " + JSON.stringify(errs));
  });

  // Control: the same workbook with a genuinely valid max mark must NOT block.
  resetAppForImport(APPref);
  const wbValid = buildSyntheticWorkbook(XLSX, { maxMarks: { Math: 50, Science: 50 } });
  ns.parseWorkbookSheets(wbValid);
  ns.autoInferSetup();
  const errsValid = ns.validateData();
  test("valid max marks (control): no blocking errors", () => {
    const blocking = errsValid.filter(e => e.e);
    if (blocking.length) throw new Error("unexpected blocking errors on a valid workbook: " + JSON.stringify(blocking));
  });
}

/* ---- item 5: canonical sheet-name resolution — exact match, case-only
   mismatch, surrounding whitespace, and collision, both as direct unit
   tests of buildSheetIndex()/resolveSheetName() and as a real end-to-end
   import of a workbook whose tab name differs only in case from its
   SETUP label. ---- */
async function runSheetNameResolutionTests(ns, APPref) {
  const { buildSheetIndex, resolveSheetName, canonicalSheetKey } = ns;

  test("sheet-name: exact match resolves", () => {
    const { index } = buildSheetIndex(["Mid-Term"]);
    assertEqual(resolveSheetName({ _sheetIndex: index }, "Mid-Term"), "Mid-Term");
  });
  test("sheet-name: case-only mismatch still resolves (SETUP 'Mid-Term' vs tab 'mid-term')", () => {
    const { index } = buildSheetIndex(["mid-term"]);
    assertEqual(resolveSheetName({ _sheetIndex: index }, "Mid-Term"), "mid-term");
  });
  test("sheet-name: surrounding whitespace in the SETUP label still resolves", () => {
    const { index } = buildSheetIndex(["Mid-Term"]);
    assertEqual(resolveSheetName({ _sheetIndex: index }, "  Mid-Term  "), "Mid-Term");
  });
  test("sheet-name: two tabs colliding after normalization are reported, not silently resolved", () => {
    const { collisions } = buildSheetIndex(["Mid-Term", "mid-term"]);
    if (!collisions.length) throw new Error("expected a collision between 'Mid-Term' and 'mid-term'");
    assertEqual(canonicalSheetKey("Mid-Term"), canonicalSheetKey("mid-term"));
  });
  test("sheet-name: a genuinely missing tab resolves to null, not a false match", () => {
    const { index } = buildSheetIndex(["Mid-Term"]);
    assertEqual(resolveSheetName({ _sheetIndex: index }, "Final Exam"), null);
  });

  // Real end-to-end import: SETUP says "T1", the actual tab is "t1 " (case
  // + trailing space). Old behaviour: validateData() passed (case-insensitive
  // check) but parseStudents() found nothing (exact-case lookup) — marks
  // came back empty with no visible error explaining why.
  const XLSX = global.XLSX;
  resetAppForImport(APPref);
  const wb = buildSyntheticWorkbook(XLSX, { testName: "T1", testSheetName: "t1 " });
  ns.parseWorkbookSheets(wb);
  ns.autoInferSetup();
  const errs = ns.validateData();
  test("sheet-name (end-to-end): case+whitespace-mismatched tab is NOT reported missing", () => {
    const blocking = errs.filter(e => e.e && /No tab named|tab.*found/i.test(e.m));
    if (blocking.length) throw new Error("tab was incorrectly reported missing: " + JSON.stringify(blocking));
  });
  ns.parseStudents();
  test("sheet-name (end-to-end): marks actually populate from the mismatched-case tab", () => {
    if (!APPref.students.length) throw new Error("no students parsed");
    const s1 = APPref.students.find(s => s.id === "S1");
    if (!s1) throw new Error("S1 not found");
    assertEqual(s1.testData["T1"].marks.Math, 40, "marks must be read from the case/whitespace-mismatched tab, not left empty");
  });
}

/* ---- item 6: duplicate subject/test names must BLOCK, not warn — exact
   duplicates and case-only duplicates, exercised via the real
   autoInferSetup()/validateSetupData()/validateData() pipeline against a
   synthetic workbook whose SETUP sheet has a duplicate Subject entry. ---- */
async function runDuplicateNameBlockingTests(ns, APPref) {
  const XLSX = global.XLSX;

  function testDuplicateSubjects(label, subjectA, subjectB) {
    resetAppForImport(APPref);
    const wb = buildSyntheticWorkbook(XLSX, {
      subjects: [subjectA, subjectB],
      maxMarks: { [subjectA]: 50, [subjectB]: 50 },
      marksByStudent: { S1: { [subjectA]: 40, [subjectB]: 35 }, S2: { [subjectA]: 45, [subjectB]: 30 } },
    });
    ns.parseWorkbookSheets(wb);
    ns.autoInferSetup();
    const errs = ns.validateData();
    test(`duplicate subjects (${label}): validateData() blocks`, () => {
      const blocking = errs.filter(e => e.e && /[Dd]uplicate subject/.test(e.m));
      if (!blocking.length) throw new Error(`expected a blocking duplicate-subject error, got: ${JSON.stringify(errs)}`);
    });
    const setupErrs = ns.validateSetupData();
    test(`duplicate subjects (${label}): validateSetupData() (Home import path) also blocks`, () => {
      const blocking = setupErrs.filter(e => e.required && /[Dd]uplicate subject/.test(e.msg));
      if (!blocking.length) throw new Error(`expected a blocking duplicate-subject error from validateSetupData(), got: ${JSON.stringify(setupErrs)}`);
    });
  }
  testDuplicateSubjects("exact", "Mathematics", "Mathematics");
  testDuplicateSubjects("case-only", "Mathematics", "mathematics");

  // Control: distinct subject names must NOT be flagged as duplicates.
  resetAppForImport(APPref);
  const wbOk = buildSyntheticWorkbook(XLSX, { subjects: ["Mathematics", "Science"] });
  ns.parseWorkbookSheets(wbOk);
  ns.autoInferSetup();
  const errsOk = ns.validateData();
  test("duplicate subjects (control): distinct subject names are never flagged", () => {
    const blocking = errsOk.filter(e => e.e && /[Dd]uplicate subject/.test(e.m));
    if (blocking.length) throw new Error("distinct subjects incorrectly flagged as duplicates: " + JSON.stringify(blocking));
  });
}

/* ---- item 8: a mark entered above its maximum is capped for display,
   but the export gate must stay CLOSED (a data issue recorded) until the
   source workbook is corrected — the bug was in the wording, but the
   gate itself must also be verified still active. ---- */
async function runCappedMarkExportGateTest(ns, APPref) {
  const XLSX = global.XLSX;
  resetAppForImport(APPref);
  const wb = buildSyntheticWorkbook(XLSX, {
    subjects: ["Math"], maxMarks: { Math: 50 },
    marksByStudent: { S1: { Math: 110 }, S2: { Math: 40 } }, // S1 entered 110, max is 50
  });
  ns.parseWorkbookSheets(wb);
  ns.autoInferSetup();
  ns.validateData();
  ns.parseStudents();
  ns.computeAnalysis();

  const s1 = APPref.students.find(s => s.id === "S1");
  test("capped mark: displayed percentage is capped at 100%, not >100%", () => {
    if (!s1) throw new Error("S1 not found");
    assertEqual(s1.analysis.testAvgs[0], 100, "110/50 capped to 50/50 = 100%");
  });
  test("capped mark: a data issue is recorded with the corrected, accurate wording", () => {
    const issue = APPref.dataIssues.find(d => d.studentId === "S1" && d.subject === "Math");
    if (!issue) throw new Error("expected a data issue for S1's over-max mark");
    if (/will inflate/.test(issue.message)) throw new Error("stale wording still present: '" + issue.message + "'");
    if (!/capped/.test(issue.message) || !/export/.test(issue.message)) {
      throw new Error("wording doesn't mention capping/export gating: '" + issue.message + "'");
    }
  });
  test("capped mark: export gate stays CLOSED (dataIssues non-empty)", () => {
    if (!(APPref.dataIssues || []).length) throw new Error("export gate should still be blocked while a mark is capped");
  });
}
