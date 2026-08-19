const { JSDOM } = require("jsdom");
const path = require("path");
const fs = require("fs");

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

  const dom = new JSDOM(fs.readFileSync("index.html", "utf8"), {
    url: "http://127.0.0.1:8899/index.html",
    runScripts: undefined,
    resources: undefined,
    pretendToBeVisual: true,
  });
  const window = dom.window;
  const document = window.document;

  window.onerror = (msg, src, line, col, err) => errors.push(`window.onerror: ${msg}`);
  window.addEventListener("unhandledrejection", ev => errors.push(`unhandledrejection: ${ev.reason}`));
  window.alert = () => {};
  window.confirm = () => true;
  window.print = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};

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

  for (const name of MODULE_ORDER) {
    const full = path.resolve("js", `${name}.js`);
    try {
      await import(`file://${full}?t=${Date.now()}`);
    } catch (e) {
      errors.push(`MODULE LOAD FAILED [${name}.js]: ${e.stack || e.message}`);
    }
  }
  if (errors.length) { console.log(errors); process.exit(1); }

  await wait(300);

  // Build File objects directly from disk for 2 matching Compare sample files
  const names = [
    "Sample_03_For_School_Management_Section_A_Class7.xlsx",
    "Sample_04_For_School_Management_Section_B_Class7.xlsx",
  ];
  const files = names.map(fn => {
    const buf = fs.readFileSync(path.resolve("samples", fn));
    return new window.File([buf], fn, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  });

  console.log("typeof handleHomeImportFiles:", typeof window.handleHomeImportFiles);
  window.handleHomeImportFiles(files);
  await wait(500);

  console.log("APP.compareMode:", window.APP.compareMode);
  console.log("APP.sections.length:", window.APP.sections.length);

  // Now run analysis
  await window.runAnalysis();
  await wait(2500);

  console.log("APP.compareGroups:", JSON.stringify((window.APP.compareGroups||[]).map(g=>({id:g.id, n:g.sections.length}))));

  // Inline copy of schemaSignature (pure, no module dependency) so this
  // reflects window.APP's actual sections regardless of module-instance forking.
  function schemaSignature(schema){
    const subjectsLc=(schema.subjects||[]).map(s=>s.trim().toLowerCase()).sort();
    const testsSig=(schema.tests||[]).map(t=>{
      const mm=(schema.subjects||[]).slice().sort((a,b)=>a.trim().toLowerCase().localeCompare(b.trim().toLowerCase()))
        .map(s=>s.trim().toLowerCase()+":"+((t.maxMarks&&t.maxMarks[s])||100)).join(",");
      return t.name.trim().toLowerCase()+"["+mm+"]";
    }).sort();
    return JSON.stringify({subjectsLc,testsSig});
  }

  const secs = window.APP.sections;
  console.log("\n=== SCHEMAS === secs.length=", secs.length);
  secs.forEach(s=>{
    console.log(s.label, "schema.subjects:", JSON.stringify(s.schema.subjects));
    console.log(s.label, "schema.tests[0].maxMarks:", JSON.stringify(s.schema.tests && s.schema.tests[0] && s.schema.tests[0].maxMarks));
    console.log(s.label, "SIG:", schemaSignature(s.schema));
  });
  console.log("APP.currentStep:", window.APP.currentStep);
  console.log("APP._activeCompareSectionId:", window.APP._activeCompareSectionId);
  console.log("APP._activeCompareGroupId:", window.APP._activeCompareGroupId);
  console.log("APP.sectionComparison.length:", (window.APP.sectionComparison||[]).length);

  const railHtml = document.getElementById("shell-rail-start") ? document.getElementById("shell-rail-start").innerHTML : "(no #shell-rail-start el)";
  console.log("\n=== LEFT RAIL HTML (first 3000 chars) ===\n", railHtml.slice(0, 3000));

  console.log("\n=== runtime errors ===", errors.length);
  for (const e of errors) console.log(" - " + e);

  process.exit(0);
}

main().catch(e => { console.error("HARNESS FATAL:", e); process.exit(2); });
