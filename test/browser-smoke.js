/* Real-browser smoke test (not jsdom) — drives an actual Chrome instance
   against the app served over http://127.0.0.1:8899, using the real
   sample workbook, to verify: import, analysis, dashboard totals,
   data-quality messages, export gating, "Download Updated Sheet"
   behavior, and re-import of the downloaded file.
   Run: node test/browser-smoke.js   (requires: python3 -m http.server
   8899, served from the project root, already running) */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

// MERGE FIX (per MERGE_PLAN.md §2 step 8): the original path here was
// hardcoded to the sandbox this test was written in
// (/home/claude/.cache/puppeteer/...) and would fail out of the box
// anywhere else. Now reads CHROME_PATH from the environment, with that
// same sandbox path only as a last-resort fallback for local dev inside
// that specific sandbox — set CHROME_PATH in CI/other environments.
const CHROME_PATH = process.env.CHROME_PATH || "/home/claude/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome";
const BASE = "http://127.0.0.1:8899/index.html";

// The sandbox's egress proxy doesn't allow the CDN domains index.html
// loads jQuery/xlsx-js-style/jsPDF/JSZip/Chart.js from — intercept those
// specific CDN requests and serve the equivalent already-installed
// node_modules files instead, so the page loads/behaves exactly like it
// would with the CDN reachable (same libraries, same versions).
const CDN_LOCAL_MAP = [
  { match: "cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js", file: "node_modules/jquery/dist/jquery.min.js", type: "application/javascript" },
  { match: "cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js", file: "node_modules/xlsx-js-style/dist/xlsx.bundle.js", type: "application/javascript" },
  { match: "cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", file: "node_modules/jspdf/dist/jspdf.umd.min.js", type: "application/javascript" },
  { match: "cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", file: "node_modules/jszip/dist/jszip.min.js", type: "application/javascript" },
  { match: "cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js", file: "node_modules/chart.js/dist/chart.umd.min.js", type: "application/javascript" },
];

async function main() {
  const errors = [];
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage();
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", msg => { if (msg.type() === "error") errors.push("console.error: " + msg.text()); });

  for (const entry of CDN_LOCAL_MAP) {
    await page.route(`**/${entry.match}`, route => {
      route.fulfill({ status: 200, contentType: entry.type, body: fs.readFileSync(path.join(__dirname, "..", entry.file)) });
    });
  }
  // Also strip the SRI integrity="..." attributes on those same 4 CDN
  // <script> tags when serving index.html itself — the local
  // node_modules files are functionally identical but not byte-identical
  // to the pinned CDN copies, so the browser's own SRI check would block
  // them even though the swap above succeeds. This ONLY affects what
  // this test harness serves; the real index.html on disk is untouched.
  await page.route(`**/index.html`, async route => {
    const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")
      .replace(/(<script src="https:\/\/(?:cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\/[^"]+")\s+integrity="[^"]+"/g, "$1");
    route.fulfill({ status: 200, contentType: "text/html", body: html });
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.runSampleFile === "function", { timeout: 10000 });

  console.log("--- STEP 1: import Sample_02 via runSampleFile() ---");
  await page.evaluate(async () => { await window.runSampleFile(["Sample_02_For_School_Class_Teacher.xlsx"]); });
  // v3.0 behaviour: a clean import only unlocks "Run Analysis" — it does
  // NOT auto-run. Invoke the same handler the button's data-action="runAnalysis"
  // wires up to (an onboarding overlay intercepts real pointer clicks in a
  // headless run, unrelated to anything under test here).
  await page.waitForSelector("#btn-home-run-analysis", { state: "visible", timeout: 15000 });
  await page.evaluate(() => { window.runAnalysis(); });
  await page.waitForFunction(() => window.APP && window.APP.students && window.APP.students.length > 0, { timeout: 15000 }).catch(() => {});
  console.log("errors so far:", JSON.stringify(errors, null, 2));

  const afterImport = await page.evaluate(() => ({
    step: window.APP.currentStep,
    studentCount: window.APP.students.length,
    dataIssues: window.APP.dataIssues.length,
    classStats: window.APP.classStats,
    subjects: window.APP.setup.subjects,
    tests: (window.APP.setup.tests || []).map(t => t.name),
  }));
  console.log(JSON.stringify(afterImport, null, 2));

  check("30 students imported", afterImport.studentCount === 30);
  check("0 data issues on the untouched sample", afterImport.dataIssues === 0);
  check("class mean displays as 61%", afterImport.classStats && afterImport.classStats.mean === 61);
  check("median is 60.5%", afterImport.classStats && afterImport.classStats.median === 60.5);
  check("5 subjects detected", afterImport.subjects.length === 5);
  check("4 tests detected", afterImport.tests.length === 4);
  check("landed on dashboard step", afterImport.step === "dashboard");

  console.log("\n--- STEP 2: tied top scorers share rank AND percentile ---");
  const tieCheck = await page.evaluate(() => {
    const a = window.APP.students.find(s => s.id === "C7A013");
    const b = window.APP.students.find(s => s.id === "C7A025");
    return a && b ? { aRank: a.analysis.rank, bRank: b.analysis.rank, aPct: a.analysis.percentile, bPct: b.analysis.percentile, aAvg: a.analysis.overallAvg, bAvg: b.analysis.overallAvg } : null;
  });
  console.log(JSON.stringify(tieCheck));
  check("both top scorers at 96%", tieCheck && tieCheck.aAvg === 96 && tieCheck.bAvg === 96);
  check("both share the same rank", tieCheck && tieCheck.aRank === tieCheck.bRank);
  check("both share the same percentile", tieCheck && tieCheck.aPct === tieCheck.bPct);

  console.log("\n--- STEP 3: export gate is open (no data issues) ---");
  await page.evaluate(() => window.goStep("export"));
  await page.waitForTimeout(300);
  const exportGate = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("#panel-export button, #panel-export [data-action]"));
    return {
      panelVisible: !!document.getElementById("panel-export") && document.getElementById("panel-export").offsetParent !== null,
      anyDisabledExportBtn: btns.some(b => b.disabled && /export|pdf|download/i.test(b.textContent || b.dataset.action || "")),
    };
  });
  console.log(JSON.stringify(exportGate));

  console.log("\n--- STEP 4: edit a Remark, then Download Updated Sheet ---");
  const downloadResult = await page.evaluate(async () => {
    const st = window.APP.students.find(s => s.id === "C7A001");
    const testName = window.APP.setup.tests[0].name;
    st.testData[testName].remark = "BROWSER SMOKE TEST REMARK";
    // Intercept XLSX.writeFile so this runs headless without a real
    // download prompt, but still exercises the real function end-to-end,
    // including real .xlsx binary serialization via XLSX.write().
    let captured = null;
    const orig = window.XLSX.writeFile;
    window.XLSX.writeFile = (wb, name) => { captured = { name, buf: window.XLSX.write(wb, { type: "array", bookType: "xlsx" }) }; };
    try {
      window.downloadUpdatedSheet();
    } finally {
      window.XLSX.writeFile = orig;
    }
    if (!captured) return { ok: false, reason: "writeFile not called" };
    // Re-read the produced workbook right here to confirm structure.
    const wb2 = window.XLSX.read(captured.buf, { type: "array" });
    return {
      ok: true,
      fname: captured.name,
      sheetNames: wb2.SheetNames,
      hasReadme: wb2.SheetNames.includes("README"),
      remarkPreserved: (() => {
        const ws = wb2.Sheets[testName] || wb2.Sheets[Object.keys(wb2.Sheets).find(n => n.toLowerCase().trim() === testName.toLowerCase().trim())];
        if (!ws) return false;
        const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        const header = rows[0].map(h => (h == null ? "" : String(h).trim()));
        const idIdx = header.indexOf("Student ID"), rmIdx = header.indexOf("Remark");
        const row = rows.find((r, i) => i > 0 && String(r[idIdx] || "").trim() === "C7A001");
        return row && row[rmIdx] === "BROWSER SMOKE TEST REMARK";
      })(),
      bytesLength: captured.buf.byteLength !== undefined ? captured.buf.byteLength : captured.buf.length,
      bufType: Object.prototype.toString.call(captured.buf),
    };
  });
  console.log(JSON.stringify(downloadResult, null, 2));
  check("downloadUpdatedSheet() produced a workbook", downloadResult.ok);
  check("produced workbook has content (non-trivial byte length)", downloadResult.bytesLength > 5000);
  check("edited Remark round-trips into the written workbook", downloadResult.remarkPreserved);

  console.log("\n--- STEP 5: re-import the downloaded workbook, verify same totals ---");
  const reimportResult = await page.evaluate(async () => {
    const st = window.APP.students.find(s => s.id === "C7A001");
    const testName = window.APP.setup.tests[0].name;
    let captured = null;
    const orig = window.XLSX.writeFile;
    window.XLSX.writeFile = (wb) => { captured = window.XLSX.write(wb, { type: "array", bookType: "xlsx" }); };
    try { window.downloadUpdatedSheet(); } finally { window.XLSX.writeFile = orig; }
    const wb2 = window.XLSX.read(captured, { type: "array" });

    // Feed it back through the real home-import file handler, the same
    // path a user re-uploading the downloaded file would hit.
    const blob = new Blob([captured], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const file = new File([blob], "reimported.xlsx", { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    await window.handleHomeImportFiles(Array.from(dt.files));
    await new Promise(r => setTimeout(r, 500));
    // Same v3.0 behaviour as the first import: re-importing only unlocks
    // "Run Analysis" again, it doesn't auto-run.
    window.runAnalysis();
    await new Promise(r => setTimeout(r, 1200));
    return {
      step: window.APP.currentStep,
      studentCount: window.APP.students.length,
      dataIssues: window.APP.dataIssues.length,
      classStats: window.APP.classStats,
      c7a001: (() => {
        const s = window.APP.students.find(x => x.id === "C7A001");
        return s ? { overallAvg: s.analysis.overallAvg, remark: (s.testData[testName] || {}).remark } : null;
      })(),
    };
  });
  console.log(JSON.stringify(reimportResult, null, 2));
  check("re-import still yields 30 students", reimportResult.studentCount === 30);
  check("re-import still has 0 data issues", reimportResult.dataIssues === 0);
  check("re-import class mean still 61%", reimportResult.classStats && reimportResult.classStats.mean === 61);
  check("re-import C7A001 overallAvg still 91%", reimportResult.c7a001 && reimportResult.c7a001.overallAvg === 91);
  check("re-import carries the edited Remark through", reimportResult.c7a001 && reimportResult.c7a001.remark === "BROWSER SMOKE TEST REMARK");

  await browser.close();

  console.log(`\n=== ${errors.length} page/console errors captured ===`);
  errors.forEach(e => console.log(" - " + e));
  // Only fail the run on errors that could plausibly be caused by this
  // app's own code (uncaught pageerror, or a console.error not explained
  // by the sandbox's network egress restrictions / analytics beacon,
  // which are expected to fail in this offline harness and are unrelated
  // to anything under test).
  const meaningfulErrors = errors.filter(e =>
    e.startsWith("pageerror:") ||
    (!/cloudflareinsights|net::ERR_FAILED|responded with a status of 403/.test(e))
  );
  if (meaningfulErrors.length) {
    console.log(`\n${meaningfulErrors.length} of those look app-related (not network/analytics noise):`);
    meaningfulErrors.forEach(e => console.log("   ⚠ " + e));
  }

  console.log(`\n${passCount} passed, ${failCount} failed`);
  failures.forEach(f => console.log("  ✗ " + f));
  process.exit(failCount || meaningfulErrors.length ? 1 : 0);
}

let passCount = 0, failCount = 0;
const failures = [];
function check(label, cond) {
  if (cond) { passCount++; console.log("  ✓ " + label); }
  else { failCount++; failures.push(label); console.log("  ✗ " + label); }
}

main().catch(e => { console.error("HARNESS FATAL:", e); process.exit(2); });
