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

const MODULE_ORDER = [
  "env-config","state-nav","project-setup","template-upload","compute-stats",
  "compute-compare","compute-continuity","render-i18n","render-buckets",
  "render-findings","render-core","continuity-dashboard","export-pdf",
  "app-utils-init","smart-engine","smart-engine-ui","smart-query-v2",
  "smart-query-v2-ui","story-deck","setup-wizard","vs-shell","inline-actions",
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

  // 2. Wire vendor globals exactly like the real CDN <script> tags would,
  // using the same npm stand-ins as dom-smoke-esm.js's harness.
  // NOTE: require('jquery') must happen BEFORE global.window is assigned —
  // jQuery's UMD wrapper checks for an existing global.window at
  // require-time, and short-circuits to a broken (non-callable) shape if
  // one is already present. This ordering quirk is specific to this test
  // harness's Node environment; it has no equivalent in a real browser.
  const jqFactory = require("jquery");
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

  const $ = jqFactory(window);
  global.$ = global.jQuery = window.$ = window.jQuery = $;
  global.Chart = window.Chart = ChartLib.Chart || ChartLib;
  global.jsPDF = window.jsPDF = jsPDF;
  window.jspdf = { jsPDF };
  global.JSZip = window.JSZip = JSZipLib;
  global.XLSX = window.XLSX = XLSXLib;

  // 3. Load the app's own modules via Node's native ESM loader, in the
  // real script-tag order, from the real files on disk.
  for (const name of MODULE_ORDER) {
    const full = path.resolve("js", `${name}.js`);
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

    await window.runSampleFile(["Sample_02_For_School_Class_Teacher.xlsx"]);
    await wait(300); // let handleHomeImportFiles()'s own DOM updates (enabling the Run Analysis button) settle

    const runBtn = document.getElementById("btn-home-run-analysis");
    let enableWaited = 0;
    while (runBtn && runBtn.disabled && enableWaited < 8000) { await wait(200); enableWaited += 200; }
    console.log("Run Analysis button enabled after import:", !!(runBtn && !runBtn.disabled), `(waited ${enableWaited}ms)`);

    if (!runBtn || runBtn.disabled) {
      errors.push("Run Analysis button never became enabled after sample data import — can't test the real click path");
    }

    // Real click, same as a user pressing the button — runAnalysis()'s
    // fake 10-step progress loop then runs for several seconds, during
    // which we sample the formula cards below.
    if (runBtn && !runBtn.disabled) runBtn.click();

    await wait(400);
    const loaderVisibleMidRun = document.getElementById("ai-loader").style.display !== "none";
    const mid1 = f1(), midL1 = l1(), mid2 = f2(), midL2 = l2();
    console.log("loader visible mid-run:", loaderVisibleMidRun);
    console.log("formula cards MID run (t=400ms):", mid1, midL1, "|", mid2, midL2);
    if (!loaderVisibleMidRun) errors.push("loader was not visible mid-run — runAnalysis() may not have started");

    await wait(900); // past one 900ms cycle tick
    const later1 = f1(), laterL1 = l1(), later2 = f2(), laterL2 = l2();
    console.log("formula cards LATER (t=1300ms):", later1, laterL1, "|", later2, laterL2);
    const cycling = (mid1 !== later1) || (mid2 !== later2) || (midL1 !== laterL1) || (midL2 !== laterL2);
    console.log("cards changed between snapshots (cycling confirmed):", cycling);
    if (!cycling) errors.push("formula cards did NOT change between mid-run snapshots — cycle may not be running");

    let hideWaited = 0;
    while (document.getElementById("ai-loader").style.display !== "none" && hideWaited < 10000) { await wait(200); hideWaited += 200; }
    console.log("waited for loader to hide:", hideWaited, "ms");

    const loaderHiddenAfterRun = document.getElementById("ai-loader").style.display === "none";
    console.log("loader hidden after run completes:", loaderHiddenAfterRun);
    if (!loaderHiddenAfterRun) errors.push("loader still visible after runAnalysis resolved");

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
