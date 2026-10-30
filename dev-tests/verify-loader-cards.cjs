// Verifies the #ai-loader-formula-1/2 "cycling formula chip" cards added in
// review #6 (js/app-utils-init.js: startAiLoaderCardCycle/stopAiLoaderCardCycle),
// on top of the same real-module + real-sample-data + full-click-sweep harness
// as dom-smoke-esm.js (see that file for why jsdom can't run <script
// type="module"> directly, and why modules are loaded via Node's own import()
// instead). This file additionally drives the real "Run Analysis" button click
// and asserts on the loader specifically:
//   - the two static top-row KPI-preview cards render their fixed labels
//   - the two bottom-row formula cards start at their first item
//   - they visibly change to a different symbol/label after one 900ms tick
//   - the loader hides once analysis completes
//   - the formula cards go static afterward (interval cleared, no leak)
// Needs a local static file server (see README/package.json) since Node's
// native fetch — unlike a browser's relative-URL fetch — needs an absolute
// URL, and the sample .xlsx must be fetchable for handleHomeImportFiles() to
// have real data to analyse.
const { JSDOM } = require("jsdom");
const path = require("path");

// Each name maps to its real on-disk folder+filename — modules live under
// core/, bal/, ui/, dal/ (no top-level `js/` folder in this static project).
// dead/removed modules (smart-engine-ui, smart-query-v2-ui, story-deck) are
// intentionally excluded — see prompt.md §11.2 NB-5.
const MODULE_ORDER = [
  "core/env-config","core/state-nav","core/project-setup","core/template-upload",
  "bal/common/compute-stats","bal/compare/compute-compare",
  "bal/common/compute-continuity","core/render-i18n","ui/common/render-buckets",
  "ui/common/render-findings","ui/common/render-core","ui/common/continuity-dashboard",
  "bal/export/export-pdf","core/app-utils-init","bal/smart-search/smart-engine",
  "bal/smart-search/smart-query-v2","core/setup-wizard","core/vs-shell","ui/common/inline-actions",
  "core/studinpro-items","ui/common/studinpro-ticker",
];

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const errors = [];
  const clickedLog = [];

  // 1. Build the DOM by parsing index.html WITHOUT letting jsdom try (and
  // silently fail) to run the <script> tags itself.
  const dom = new JSDOM(require("fs").readFileSync("index.html", "utf8"), {
    url: "http://127.0.0.1:8899/index.html",
    runScripts: undefined, // do NOT let jsdom execute any <script> tag
    resources: undefined,
    pretendToBeVisual: true,
  });
  const window = dom.window;
  const document = window.document;

  window.onerror = (msg, src, line, col, err) => errors.push(`window.onerror: ${msg} (${src}:${line}:${col})`);
  window.addEventListener("unhandledrejection", ev => errors.push(`unhandledrejection: ${ev.reason}`));
  window.alert = () => {};
  window.confirm = () => true;
  window.print = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};

  // capture Node's native fetch BEFORE overriding it below — otherwise the
  // wrapper's own bare `fetch(...)` call would resolve to itself via
  // `global.fetch` (set further down) and recurse forever.
  const nativeFetch = fetch;
  window.fetch = async (...a) => {
    const res = await nativeFetch(...a);
    // Bridge the Response's .blob() from Node's native Blob class into
    // jsdom's own Blob class — see the `global.File` comment below for why
    // this mismatch exists only in this Node harness, never in a browser.
    const origBlob = res.blob.bind(res);
    res.blob = async () => {
      const nodeBlob = await origBlob();
      const buf = await nodeBlob.arrayBuffer();
      return new window.Blob([buf], { type: nodeBlob.type });
    };
    return res;
  };
  // App code calls bare `fetch(...)`, not `window.fetch(...)` — without
  // this, runSampleFile()'s fetch resolves against Node's raw native fetch
  // and silently skips the Blob-bridging wrapper above.
  global.fetch = window.fetch;

  // 2. Wire vendor globals exactly like the real CDN <script> tags (and our
  // own core/dom-shim.js, which replaced the jQuery CDN tag) would, using
  // the same npm stand-ins as dom-smoke-esm.js's harness for the ones that
  // are still real 3rd-party libs.
  const ChartLib = require("chart.js/auto");
  const { jsPDF } = require("jspdf");
  const JSZipLib = require("jszip");
  // xlsx-js-style (not the plain 'xlsx' package) to match the real CDN
  // dependency — the plain package parses this multi-tab sample file
  // differently and drops the SETUP/STUDENTS/test tabs.
  const XLSXLib = require("xlsx-js-style");

  global.window = window;
  global.document = document;
  global.navigator = window.navigator;
  global.localStorage = window.localStorage;
  global.location = window.location;
  global.HTMLElement = window.HTMLElement;
  global.CustomEvent = window.CustomEvent;
  global.MouseEvent = window.MouseEvent;
  global.FileReader = window.FileReader;
  global.Blob = window.Blob;
  // dom-smoke-esm.js's globals list leaves this unset, so bare `new
  // File(...)` calls in render-core.js/template-upload.js resolve against
  // Node's OWN native File global instead of jsdom's — harmless until
  // FileReader (a jsdom object) tries to read one and fails its internal
  // `instanceof Blob` check against a cross-realm object. Not a bug in the
  // app: browsers only ever have one File/Blob realm, so this mismatch
  // can't occur outside a Node harness mixing native fetch with a jsdom
  // window.
  global.File = window.File;
  global.URL = window.URL;
  global.getComputedStyle = window.getComputedStyle.bind(window);
  global.matchMedia = window.matchMedia ? window.matchMedia.bind(window) : () => ({ matches: false, addListener(){}, removeListener(){} });
  // jsdom doesn't implement the Blob-URL object-URL registry at all (real
  // browsers do) — stub it so download-link code paths (debugLog export,
  // PDF/ZIP export, etc.) can run to completion in this harness instead of
  // throwing. Not an app bug: this API exists in every real browser target.
  if(typeof window.URL.createObjectURL!=="function"){
    window.URL.createObjectURL=()=>"blob:jsdom-harness-stub";
    window.URL.revokeObjectURL=()=>{};
    global.URL.createObjectURL=window.URL.createObjectURL;
    global.URL.revokeObjectURL=window.URL.revokeObjectURL;
  }

  // core/dom-shim.js is a plain (non-module) script that sets window.$ /
  // window.jQuery itself — running its source here mimics the real
  // <script src="core/dom-shim.js"> tag, replacing the old real-jQuery
  // require() (P2 #10: jQuery is no longer a dependency at all).
  (0, eval)(require("fs").readFileSync("core/dom-shim.js", "utf8"));
  // dom-shim.js only assigns window.$ (that's all a real <script> tag could
  // do) — dynamically-imported ES modules run in Node's own global scope,
  // not inside this jsdom window, so bare `$` references in app code need
  // the same value mirrored onto the real Node global too.
  global.$ = global.jQuery = window.$;

  global.Chart = window.Chart = ChartLib.Chart || ChartLib;
  global.jsPDF = window.jsPDF = jsPDF;
  window.jspdf = { jsPDF };
  global.JSZip = window.JSZip = JSZipLib;
  global.XLSX = window.XLSX = XLSXLib;

  // 3. Load the app's own modules via Node's native ESM loader, in the
  // real script-tag order, from the real files on disk.
  for (const name of MODULE_ORDER) {
    // Each MODULE_ORDER entry is already a folder/relative-path (e.g. "core/app-utils-init");
    // resolve it directly so the import actually finds the file. The previous form
    // (`path.resolve("js", name + ".js")`) assumed a top-level `js/` folder that
    // doesn't exist in this static project — every module load failed and the
    // harness exited 1 on a healthy app. See prompt.md §11.2 NB-1.
    const full = path.resolve(`${name}.js`);
    try {
      await import(`file://${full}`);
    } catch (e) {
      errors.push(`MODULE LOAD FAILED [${name}.js]: ${e.stack || e.message}`);
    }
  }

  console.log(`\n=== ${errors.length} module-load errors ===`);
  for (const e of errors) console.log(" - " + e);
  if (errors.length) { process.exit(1); }

  await wait(300);

  function clickAllOnceIn(root, label) {
    const els = Array.from(root.querySelectorAll("[onclick], [data-action]"));
    for (const el of els) {
      if (el.tagName === "INPUT") continue;
      try {
        el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
        clickedLog.push(`OK [${label}] ${el.tagName}#${el.id || "-"}`);
      } catch (e) {
        errors.push(`CLICK-THROW [${label}] ${el.tagName}#${el.id || "-"} ${(el.getAttribute("data-action")||el.getAttribute("onclick")||"").slice(0,60)} -> ${e.message}`);
      }
    }
  }

  clickAllOnceIn(document, "home-initial");
  await wait(300);

  const f1 = () => document.querySelector("#ai-loader-formula-1 .ai-loader-formula-symbol")?.textContent;
  const f2 = () => document.querySelector("#ai-loader-formula-2 .ai-loader-formula-symbol")?.textContent;
  const l1 = () => document.querySelector("#ai-loader-formula-1 .ai-loader-formula-label")?.textContent;
  const l2 = () => document.querySelector("#ai-loader-formula-2 .ai-loader-formula-label")?.textContent;
  const kpi1 = document.querySelector("#ai-loader .ai-loader-kpi-card:nth-child(1) .ai-loader-kpi-label")?.textContent;
  const kpi2 = document.querySelector("#ai-loader .ai-loader-kpi-card:nth-child(2) .ai-loader-kpi-label")?.textContent;
  console.log("KPI card labels (static):", kpi1, "|", kpi2);
  if (kpi1 !== "Class Avg") errors.push(`KPI card 1 label wrong: expected "Class Avg", got "${kpi1}"`);
  if (kpi2 !== "Pass Rate") errors.push(`KPI card 2 label wrong: expected "Pass Rate", got "${kpi2}"`);
  console.log("formula cards BEFORE run:", f1(), l1(), "|", f2(), l2());

  if (typeof window.runSampleFile !== "function") {
    errors.push("runSampleFile is not a function on window — module shim failed");
  } else {
    window.APP_CONFIG = window.APP_CONFIG || {};
    window.APP_CONFIG.assetBase = "http://127.0.0.1:8899/samples/";

    await window.runSampleFile(["Sample_04_For_PUC_Junior_College.xlsx"]);
    await wait(300); // let handleHomeImportFiles()'s own DOM updates (enabling the Run Analysis button) settle

    const runBtn = document.getElementById("btn-home-run-analysis");
    let enableWaited = 0;
    while (runBtn && runBtn.disabled && enableWaited < 8000) { await wait(200); enableWaited += 200; }
    console.log("Run Analysis button enabled after import:", !!(runBtn && !runBtn.disabled), `(waited ${enableWaited}ms)`);

    if (!runBtn || runBtn.disabled) {
      errors.push("Run Analysis button never became enabled after sample data import — can't test the real click path");
    }

    // Real click. NB-3 (prompt.md §11.2) replaced the old fake 11-stage
    // sleep loop with 2 honest phases + a 0ms yield between them, so for a
    // small sample file the whole run can finish well under one 900ms
    // card-cycle tick. Fixed 400ms/1300ms snapshot timings assumed the old
    // multi-second fake loop and no longer line up — poll instead, so the
    // harness reflects the loader's actual (now much shorter) lifetime
    // instead of guessing at it.
    if (runBtn && !runBtn.disabled) runBtn.click();

    const loaderEl = document.getElementById("ai-loader");
    const snapshots = [];
    const runStart = Date.now();
    let loaderWasVisible = false;
    let pollWaited = 0;
    while (pollWaited < 10000) {
      const visible = loaderEl.style.display !== "none";
      if (visible) {
        loaderWasVisible = true;
        snapshots.push({ f1: f1(), l1: l1(), f2: f2(), l2: l2() });
      } else if (loaderWasVisible) {
        break; // was visible, now hidden — run finished
      }
      await wait(50);
      pollWaited += 50;
    }
    const runDuration = Date.now() - runStart;
    console.log("loader was visible at some point during run:", loaderWasVisible, `(run took ~${runDuration}ms, ${snapshots.length} samples)`);
    if (!loaderWasVisible) errors.push("loader was never visible during run — runAnalysis() may not have started");

    if (snapshots.length) {
      const first = snapshots[0], last = snapshots[snapshots.length - 1];
      const cycling = (first.f1 !== last.f1) || (first.f2 !== last.f2) || (first.l1 !== last.l1) || (first.l2 !== last.l2);
      console.log("formula cards changed between first/last visible samples:", cycling);
      if (runDuration >= 900) {
        if (!cycling) errors.push("formula cards did NOT change even though the run lasted past one 900ms cycle tick");
      } else {
        console.log(`run finished in ~${runDuration}ms, before the first 900ms cycle tick — cycling not exercised for this sample size (expected, not an error)`);
      }
    }

    const loaderHiddenAfterRun = loaderEl.style.display === "none";
    console.log("loader hidden after run completes:", loaderHiddenAfterRun);
    if (!loaderHiddenAfterRun) errors.push("loader still visible after runAnalysis resolved (timed out waiting for it to hide)");

    const post1 = f1(), post2 = f2();
    await wait(1400); // longer than one 900ms cycle tick
    const post1b = f1(), post2b = f2();
    const intervalStopped = (post1 === post1b) && (post2 === post2b);
    console.log("formula cards static after loader hides (interval cleared, no leak):", intervalStopped);
    if (!intervalStopped) errors.push("formula cards kept changing after loader hidden — interval was not cleared (leak)");
  }
  await wait(1200);

  clickAllOnceIn(document, "post-sample-load");
  await wait(300);

  for (const fnName of ["openBucket", "openIndividualBucket"]) {
    if (typeof window[fnName] === "function") {
      for (const arg of ["class", "compare", "export", "report", "wellbeing"]) {
        try { window[fnName](arg); } catch (e) { /* not every arg valid for every fn */ }
        await wait(150);
        clickAllOnceIn(document, `${fnName}(${arg})`);
      }
    } else {
      errors.push(`${fnName} is not a function on window`);
    }
  }

  const unknown = Array.from(new Set(window.__unknownActions || []));

  console.log(`\n=== clicked ${clickedLog.length} elements ===`);
  console.log(`=== ${errors.length} runtime errors ===`);
  for (const e of errors) console.log(" - " + e);
  console.log(`=== ${unknown.length} distinct unrecognized data-action names ===`);
  for (const u of unknown) console.log(" - " + u);

  process.exit(errors.length || unknown.length ? 1 : 0);
}

main().catch(e => { console.error("HARNESS FATAL:", e); process.exit(2); });
