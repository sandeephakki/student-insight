// jsdom (v30, current as of this writing) does not execute
// <script type="module"> at all — confirmed with a trivial inline-module
// test independent of this app. So dom-smoke.js (which relies on jsdom
// running the page's own <script> tags) can't be used to verify the
// module-system conversion (HANDOVER #4) the way it verified #3.
//
// Workaround: Node's own ESM loader (`import()`) works fine and resolves
// the exact same relative './file.js' specifiers the browser would use.
// So instead of asking jsdom to execute the module script tags, this
// harness creates the same jsdom DOM/window, exposes it as the global
// environment (global.window/document/$/Chart/jsPDF/JSZip/XLSX), then
// uses Node's native dynamic import() to load each of the 22 app modules
// itself, in the same order as index.html's <script type="module"> tags.
// Node's ESM resolver enforces the real import/export graph (unresolved
// imports, missing exports, and circular-import TDZ issues all surface
// as real thrown errors here) — the exact class of bug this refactor
// could introduce. After loading, it drives the same real-sample-data +
// full click-sweep flow as dom-smoke.js, against the same live DOM.
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
  window.fetch = (...a) => fetch(...a);

  // 2. Wire vendor globals exactly like the real CDN <script> tags would,
  // using the same npm stand-ins as dom-smoke.js's harness html.
  // NOTE: require('jquery') must happen BEFORE global.window is assigned —
  // jQuery's UMD wrapper checks for an existing global.window at
  // require-time, and short-circuits to a broken (non-callable) shape if
  // one is already present. This ordering quirk is specific to this test
  // harness's Node environment; it has no equivalent in a real browser.
  const jqFactory = require("jquery");
  const ChartLib = require("chart.js/auto");
  const { jsPDF } = require("jspdf");
  const JSZipLib = require("jszip");
  const XLSXLib = require("xlsx");

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
      await import(`file://${full}?t=${Date.now()}`);
    } catch (e) {
      errors.push(`MODULE LOAD FAILED [${name}.js]: ${e.stack || e.message}`);
    }
  }

  console.log(`\n=== ${errors.length} module-load errors ===`);
  for (const e of errors) console.log(" - " + e);
  if (errors.length) { process.exit(1); }

  console.log("typeof window.goStep:", typeof window.goStep);
  console.log("typeof window.APP:", typeof window.APP);
  console.log("typeof window.runSampleFile:", typeof window.runSampleFile);

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

  if (typeof window.runSampleFile === "function") {
    try {
      await window.runSampleFile(["Sample_02_For_School_Class_Teacher.xlsx"]);
    } catch (e) {
      errors.push(`runSampleFile threw: ${e.stack || e.message}`);
    }
  } else {
    errors.push("runSampleFile is not a function on window — module shim failed");
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
