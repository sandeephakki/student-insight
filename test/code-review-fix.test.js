/* ============================================================
   Regression tests — CODE_REVIEW_FIX_PROMPT.md.

   Run: node test/code-review-fix.test.js

   Covers the five findings from that prompt:
   1. No executable inline event attributes remain in the source.
   2. inline-actions.js has a working 'resetHomeImport' dispatch case.
   3. Continuity state is cleared on every reset/import boundary.
   4. Comparison PDF export is blocked when any represented section has
      data-quality issues.
   5. A compare-mode section's own header metadata (institution/type/
      year/teacher/pass threshold) is restored when it's selected.
   ============================================================ */
const fs = require("fs");
const path = require("path");
const { test, assertEqual, summary } = require("./tiny-test.js");

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
  for (const f of ["mark-parse.js", "env-config.js", "compute-stats.js", "compute-compare.js", "template-upload.js", "project-setup.js"]) {
    const modNs = await import(`file://${path.join(__dirname, "../js/" + f)}?t=${Date.now()}`);
    Object.assign(ns, modNs);
    Object.assign(globalThis, modNs);
  }
  const stateNavNs = await import(`file://${path.join(__dirname, "../js/state-nav.js")}`);
  Object.assign(ns, stateNavNs);
  const APPref = stateNavNs.APP;

  runInlineAttributeTests();
  runResetHomeImportDispatcherTests();
  runContinuityResetTests(ns, APPref);
  runDataIssueGateTests(ns, APPref);
  runSectionMetadataRestoreTests(ns, APPref);

  summary();
}

main().catch(e => { console.error("TEST SETUP FAILED:", e); process.exit(1); });

/* ---- Issue 1: no executable inline event attributes anywhere ---- */
// Strips /* */, //, and <!-- --> comments before scanning, so doc-comments
// that merely MENTION the old inline-handler pattern (kept deliberately,
// as history/rationale) don't false-positive as live attributes.
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))
    .replace(/^([^"'\n]*)\/\/.*$/gm, "$1");
}
function runInlineAttributeTests() {
  const attrPattern = /\son(click|input|change|keydown|drag\w*|submit)="[^"]/gi;
  const jsDir = path.join(__dirname, "../js");
  const targets = [path.join(__dirname, "../index.html"),
    ...fs.readdirSync(jsDir).filter(f => f.endsWith(".js")).map(f => path.join(jsDir, f))];

  test("Issue 1: no executable inline event-handler attributes remain in index.html or js/*.js", () => {
    const offenders = [];
    for (const file of targets) {
      const raw = fs.readFileSync(file, "utf8");
      const cleaned = stripComments(raw);
      const rawLines = raw.split("\n");
      const cleanedLines = cleaned.split("\n");
      cleanedLines.forEach((line, i) => {
        if (attrPattern.test(line)) offenders.push(`${path.basename(file)}:${i + 1}: ${rawLines[i].trim().slice(0, 100)}`);
        attrPattern.lastIndex = 0;
      });
    }
    if (offenders.length) {
      throw new Error("Found live inline event attributes:\n" + offenders.join("\n"));
    }
  });
}

/* ---- Issue 2: resetHomeImport dispatcher ---- */
function runResetHomeImportDispatcherTests() {
  const src = fs.readFileSync(path.join(__dirname, "../js/inline-actions.js"), "utf8");
  test("Issue 2: inline-actions.js imports resetHomeImport from template-upload.js", () => {
    const importLine = src.split("\n").find(l => l.includes("from './template-upload.js'"));
    if (!importLine || !/\bresetHomeImport\b/.test(importLine)) {
      throw new Error("resetHomeImport is not imported from template-upload.js");
    }
  });
  test("Issue 2: inline-actions.js dispatches the 'resetHomeImport' data-action", () => {
    if (!/case 'resetHomeImport':\s*resetHomeImport\(\);\s*break;/.test(src)) {
      throw new Error("No dispatch case found for 'resetHomeImport'");
    }
  });
}

/* ---- Issue 3: continuity state cleared on reset boundaries ---- */
function runContinuityResetTests(ns, APP) {
  function dirtyContinuity() {
    APP.continuity = { periods: [{ label: "P1" }], students: [{ id: "s1" }] };
    APP._continuityActivePeriodIdx = 2;
    APP._continuitySelectedId = "s1";
  }

  test("Issue 3: startNewSession() clears continuity state", () => {
    dirtyContinuity();
    ns.startNewSession();
    assertEqual(APP.continuity, null);
    assertEqual(APP._continuityActivePeriodIdx, 0);
    assertEqual(APP._continuitySelectedId, null);
  });

  test("Issue 3: startCompareMode() clears continuity state", () => {
    dirtyContinuity();
    ns.startCompareMode();
    assertEqual(APP.continuity, null);
    assertEqual(APP._continuityActivePeriodIdx, 0);
    assertEqual(APP._continuitySelectedId, null);
  });

  test("Issue 3: renderHomePage() (and therefore resetHomeImport()) clears continuity state", () => {
    dirtyContinuity();
    ns.renderHomePage();
    assertEqual(APP.continuity, null);
    assertEqual(APP._continuityActivePeriodIdx, 0);
    assertEqual(APP._continuitySelectedId, null);
  });

  test("Issue 3: autoInferSetup() clears stale continuity before handling a single-period workbook", () => {
    dirtyContinuity();
    APP.rawData = { SETUP: [["Institution Name", "Test School"], ["Class / Batch", "7"], ["Section", "A"]] };
    APP.students = [];
    ns.autoInferSetup();
    assertEqual(APP.continuity, null);
    assertEqual(APP._continuityActivePeriodIdx, 0);
    assertEqual(APP._continuitySelectedId, null);
  });
}

/* ---- Issue 4: comparison export data-quality gate ---- */
function runDataIssueGateTests(ns, APP) {
  test("Issue 4: sectionsWithDataIssues() flags a represented section with dataIssues", () => {
    APP.sections = [
      { id: "secA", label: "Class 7 - A", dataIssues: [] },
      { id: "secB", label: "Class 7 - B", dataIssues: [{ type: "capped-mark" }] },
    ];
    const rows = [{ id: "secA" }, { id: "secB" }];
    const flagged = ns.sectionsWithDataIssues(rows);
    assertEqual(flagged.length, 1);
    assertEqual(flagged[0].id, "secB");
  });

  test("Issue 4: sectionsWithDataIssues() returns empty when all represented sections are clean", () => {
    APP.sections = [
      { id: "secA", label: "Class 7 - A", dataIssues: [] },
      { id: "secB", label: "Class 7 - B", dataIssues: null },
    ];
    const rows = [{ id: "secA" }, { id: "secB" }];
    assertEqual(ns.sectionsWithDataIssues(rows).length, 0);
  });

  test("Issue 4: exportComparisonReportPDF() does not touch jsPDF when a represented section has data issues", async () => {
    APP.sections = [
      { id: "secA", label: "Class 7 - A", dataIssues: [{ type: "capped-mark" }], students: [], schema: {} },
    ];
    APP.sectionComparison = [{ id: "secA", label: "Class 7 - A", n: 0, avg: 0 }];
    let jspdfCalled = false;
    const originalJspdf = dom_window_jspdf_ref();
    window.jspdf = new Proxy({}, { get(){ jspdfCalled = true; return function(){}; } });
    try {
      await ns.exportComparisonReportPDF();
    } finally {
      window.jspdf = originalJspdf;
    }
    if (jspdfCalled) throw new Error("jsPDF was invoked even though a represented section has data issues");
  });

  function dom_window_jspdf_ref(){ return window.jspdf; }
}

/* ---- Issue 5: restoring section metadata on selectCompareSection() ---- */
function runSectionMetadataRestoreTests(ns, APP) {
  test("Issue 5: selectCompareSection() restores the section's own header metadata", () => {
    APP.setup = { instName: "Stale Institution", instType: "", className: "", section: "",
      year: "2020", teacher: "Stale Teacher", passThreshold: 35, subjects: [], tests: [] };
    APP.sections = [{
      id: "secX",
      label: "Class 9 - C",
      students: [{ id: "st1", name: "Test Student", analysis: { overallAvg: 80, trend: "stable" }, flags: [] }],
      classStats: {}, genderAnalysis: {}, dataIssues: [], cohortClusters: null,
      schema: {
        subjects: ["Maths"], tests: [],
        instName: "Real Institution", instType: "School",
        className: "9", section: "C", year: "2025-26",
        teacher: "Real Teacher", passThreshold: 40,
      },
    }];
    APP.sectionComparison = [{ id: "secX" }];
    APP._currentBucketId = "export"; // lightweight bucket render — avoids needing a full analysis fixture
    ns.selectCompareSection("secX");
    assertEqual(APP.setup.instName, "Real Institution");
    assertEqual(APP.setup.instType, "School");
    assertEqual(APP.setup.className, "9");
    assertEqual(APP.setup.section, "C");
    assertEqual(APP.setup.year, "2025-26");
    assertEqual(APP.setup.teacher, "Real Teacher");
    assertEqual(APP.setup.passThreshold, 40);
  });
}
