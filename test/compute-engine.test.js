/* ============================================================
   Unit tests — compute-engine.js pure functions.

   Run: node test/compute-engine.test.js
   No dependencies, no build step, no npm install required.

   SCOPE: only functions that are pure (no APP.* reads, no DOM,
   no jQuery) are tested here. compute-engine.js also holds many
   functions that render UI or mutate global APP state (computeAnalysis,
   renderManagementGrid, etc) — those need a browser/DOM harness to
   test meaningfully and are out of scope for this first pass. The
   functions below were picked because their own doc comments in
   the source already say "Pure" or take plain-value params with
   no side effects — see compute-engine.js for each function's
   contract before changing behavior here.

   Loading strategy: compute-engine.js is a plain script (no module
   exports — matches the rest of this project's no-build-step
   architecture, see review notes). vm.runInThisContext runs it so
   its top-level `function` declarations land on the global object,
   same as a <script> tag would in the browser. Only stub needed is
   a bare `APP = {}` since a few functions reference APP.setup.* as
   an optional read (not used by any function tested here, but the
   file won't parse-fail without it either way — kept for clarity).
   ============================================================ */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { test, assertEqual, summary } = require("./tiny-test.js");

/* compute-engine.js was split into 3 files (review #5) — load in the same
   order index.html does, into the same global context, so functions that
   reference each other still resolve exactly as they do in the browser.

   FIX (module-system conversion, HANDOVER #4): these 3 files are now real
   ES modules (import/export), so vm.runInThisContext (which only works on
   plain scripts) can no longer load them — "Cannot use import statement
   outside a module". Switched to Node's native dynamic import(). Because
   compute-compare.js now has explicit imports reaching into much of the
   app's module graph (render-buckets.js, render-core.js, vs-shell.js, etc
   — the real dependency graph this whole conversion was making explicit),
   loading it transitively loads files that touch document/$ at their own
   module top level. So this file now needs the same minimal jsdom+jQuery+
   vendor-global stubbing as test/dom-smoke-esm.js, even though the actual
   functions under test here remain pure (no APP reads, no DOM) — see each
   test below for that contract, unchanged from before this conversion. */
const { JSDOM } = require("jsdom");

async function main() {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, "../index.html"), "utf8"), {
    url: "http://localhost/",
    runScripts: undefined, // don't let jsdom try (and fail) to run <script type="module"> itself — see dom-smoke-esm.js
  });
  const jqFactory = require("jquery"); // must require() before global.window is set — see dom-smoke-esm.js
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
  global.XLSX = dom.window.XLSX = require("xlsx");

  global.APP = dom.window.APP = { setup: {} };

  for (const f of ["env-config.js", "compute-stats.js", "compute-compare.js", "compute-continuity.js"]) {
    const ns = await import(`file://${path.join(__dirname, "../js/" + f)}?t=${Date.now()}`);
    Object.assign(globalThis, ns); // exposes each module's exported functions as bare identifiers, same as vm.runInThisContext used to
  }

  runTests();
}

main().catch(e => { console.error("TEST SETUP FAILED:", e); process.exit(1); });

function runTests() {

/* ---- classifyRemarkTone ---- */
test("classifyRemarkTone: clearly positive remark", () => {
  assertEqual(classifyRemarkTone("Excellent and hardworking student"), "positive");
});
test("classifyRemarkTone: clearly concerning remark", () => {
  assertEqual(classifyRemarkTone("Weak and struggling, needs improvement"), "concern");
});
test("classifyRemarkTone: empty/blank text returns null, not neutral", () => {
  assertEqual(classifyRemarkTone(""), null);
  assertEqual(classifyRemarkTone("   "), null);
  assertEqual(classifyRemarkTone(null), null);
});
test("classifyRemarkTone: no matching words returns neutral", () => {
  assertEqual(classifyRemarkTone("Attends class regularly."), "neutral");
});

/* ---- normGender ---- */
test("normGender: recognizes common male variants", () => {
  assertEqual(normGender("M"), "Male");
  assertEqual(normGender("male"), "Male");
  assertEqual(normGender("Boy"), "Male");
});
test("normGender: recognizes common female variants", () => {
  assertEqual(normGender("f"), "Female");
  assertEqual(normGender("Female"), "Female");
  assertEqual(normGender("girl"), "Female");
});
test("normGender: unknown/blank/other returns null, never guesses", () => {
  assertEqual(normGender("xyz"), null);
  assertEqual(normGender(""), null);
  assertEqual(normGender(undefined), null);
  assertEqual(normGender("Other"), null);
});

/* ---- safeFileName ---- */
test("safeFileName: strips punctuation, collapses spaces to underscores", () => {
  assertEqual(safeFileName("Class 7 - C!! (Final).xlsx"), "Class_7_-_C_Finalxlsx");
});
test("safeFileName: empty/null input never throws", () => {
  assertEqual(safeFileName(""), "");
  assertEqual(safeFileName(null), "");
});

/* ---- parseClassSection ---- */
test("parseClassSection: 'Class 7 - C' style", () => {
  assertEqual(parseClassSection("Class 7 - C"), { cls: "Class 7", sec: "C" });
});
test("parseClassSection: 'Grade 6 Section B' style", () => {
  assertEqual(parseClassSection("Grade 6 Section B"), { cls: "Grade 6", sec: "B" });
});
test("parseClassSection: '6A' compact style", () => {
  assertEqual(parseClassSection("6A"), { cls: "6", sec: "A" });
});
test("parseClassSection: no section present — whole label kept, empty sec", () => {
  assertEqual(parseClassSection("UPSC Batch"), { cls: "UPSC Batch", sec: "" });
});

/* ---- deriveRosterStatus ---- */
test("deriveRosterStatus: present at period 0 is 'continuing' (baseline)", () => {
  const presence = [new Set(["S1", "S2"]), new Set(["S1"]), new Set(["S1", "S3"])];
  assertEqual(deriveRosterStatus("S1", 0, presence), "continuing");
});
test("deriveRosterStatus: was present earlier, absent now = 'left'", () => {
  const presence = [new Set(["S1", "S2"]), new Set(["S1"]), new Set(["S1", "S3"])];
  assertEqual(deriveRosterStatus("S2", 1, presence), "left");
});
test("deriveRosterStatus: present now, was present before = 'continuing'", () => {
  const presence = [new Set(["S1", "S2"]), new Set(["S1"]), new Set(["S1", "S3"])];
  assertEqual(deriveRosterStatus("S1", 2, presence), "continuing");
});
test("deriveRosterStatus: present now, never present before = 'joined'", () => {
  const presence = [new Set(["S1", "S2"]), new Set(["S1"]), new Set(["S1", "S3"])];
  assertEqual(deriveRosterStatus("S3", 2, presence), "joined");
});
test("deriveRosterStatus: never seen at all = 'not_present'", () => {
  const presence = [new Set(["S1", "S2"]), new Set(["S1"]), new Set(["S1", "S3"])];
  assertEqual(deriveRosterStatus("S9", 1, presence), "not_present");
});
test("deriveRosterStatus: invalid periodIdx never throws, returns 'not_present'", () => {
  const presence = [new Set(["S1"])];
  assertEqual(deriveRosterStatus("S1", -1, presence), "not_present");
  assertEqual(deriveRosterStatus("S1", 99, presence), "not_present");
  assertEqual(deriveRosterStatus("S1", 0, null), "not_present");
});

/* ---- matchSubjectsAcrossPeriods ---- */
test("matchSubjectsAcrossPeriods: carried/added/dropped split correctly", () => {
  assertEqual(
    matchSubjectsAcrossPeriods(["Math", "Sci"], ["Math", "Eng"]),
    { carried: ["Math"], added: ["Eng"], dropped: ["Sci"] }
  );
});
test("matchSubjectsAcrossPeriods: non-array input treated as empty, never throws", () => {
  assertEqual(matchSubjectsAcrossPeriods(null, ["Math"]), { carried: [], added: ["Math"], dropped: [] });
  assertEqual(matchSubjectsAcrossPeriods(undefined, undefined), { carried: [], added: [], dropped: [] });
});

/* ---- checkDuplicateStudentIds ---- */
test("checkDuplicateStudentIds: finds the one duplicate", () => {
  assertEqual(checkDuplicateStudentIds([{ id: "A" }, { id: "B" }, { id: "A" }]), ["A"]);
});
test("checkDuplicateStudentIds: no duplicates returns empty array", () => {
  assertEqual(checkDuplicateStudentIds([{ id: "A" }, { id: "B" }]), []);
});
test("checkDuplicateStudentIds: blank ids ignored, not treated as duplicates of each other", () => {
  assertEqual(checkDuplicateStudentIds([{ id: "" }, { id: null }, { id: "  " }]), []);
});
test("checkDuplicateStudentIds: non-array input never throws", () => {
  assertEqual(checkDuplicateStudentIds(null), []);
});

/* ---- splitPeriodsForAnalysis ---- */
test("splitPeriodsForAnalysis: 4 periods -> last is current, rest historical", () => {
  assertEqual(splitPeriodsForAnalysis(4), { currentIdx: 3, historicalIdxs: [0, 1, 2] });
});
test("splitPeriodsForAnalysis: 0/invalid periodCount -> no current, empty history", () => {
  assertEqual(splitPeriodsForAnalysis(0), { currentIdx: -1, historicalIdxs: [] });
  assertEqual(splitPeriodsForAnalysis(-5), { currentIdx: -1, historicalIdxs: [] });
});
test("splitPeriodsForAnalysis: 1 period -> that's current, no history", () => {
  assertEqual(splitPeriodsForAnalysis(1), { currentIdx: 0, historicalIdxs: [] });
});

/* ---- deriveContinuityTerminology ---- */
test("deriveContinuityTerminology: explicit institution type wins", () => {
  assertEqual(deriveContinuityTerminology([], "School").unitLabel, "Class");
  assertEqual(deriveContinuityTerminology([], "College / University").unitLabel, "Semester");
});
test("deriveContinuityTerminology: falls back to inferring from period labels", () => {
  assertEqual(deriveContinuityTerminology([{ label: "Class 6" }], "").unitLabel, "Class");
  assertEqual(deriveContinuityTerminology([{ label: "Sem 3" }], "").unitLabel, "Semester");
});
test("deriveContinuityTerminology: ambiguous data -> neutral fallback, never guesses", () => {
  assertEqual(deriveContinuityTerminology([{ label: "Batch A" }], "").unitLabel, "Period");
});

/* ---- computeLongitudinalTrend ---- */
test("computeLongitudinalTrend: consistent upward run", () => {
  assertEqual(computeLongitudinalTrend([50, 55, 60, 65]), { periodCount: 4, direction: "improving", streakLength: 4 });
});
test("computeLongitudinalTrend: consistent downward run", () => {
  assertEqual(computeLongitudinalTrend([65, 60, 55]), { periodCount: 3, direction: "declining", streakLength: 3 });
});
test("computeLongitudinalTrend: fewer than 2 points -> null, never fabricates a trend", () => {
  assertEqual(computeLongitudinalTrend([50]), null);
  assertEqual(computeLongitudinalTrend([]), null);
});
test("computeLongitudinalTrend: no change -> flat, streak resets to 1", () => {
  assertEqual(computeLongitudinalTrend([50, 50]), { periodCount: 2, direction: "flat", streakLength: 1 });
});
test("computeLongitudinalTrend: streak counts only trailing steps matching latest direction", () => {
  assertEqual(computeLongitudinalTrend([40, 45, 50, 48]), { periodCount: 4, direction: "declining", streakLength: 2 });
});

summary();
}
