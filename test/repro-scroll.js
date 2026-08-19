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
    url: "http://127.0.0.1:8899/index.html", pretendToBeVisual: true,
  });
  const window = dom.window, document = window.document;
  window.onerror = (msg) => errors.push(`window.onerror: ${msg}`);
  window.addEventListener("unhandledrejection", ev => errors.push(`unhandledrejection: ${ev.reason}`));
  window.alert = () => {}; window.confirm = () => true; window.print = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });

  const jqFactory = require("jquery");
  const ChartLib = require("chart.js/auto");
  const { jsPDF } = require("jspdf");
  const JSZipLib = require("jszip");
  const XLSXLib = require("xlsx");
  global.window = window; global.document = document; global.navigator = window.navigator;
  global.localStorage = window.localStorage; global.location = window.location;
  global.HTMLElement = window.HTMLElement; global.CustomEvent = window.CustomEvent;
  global.MouseEvent = window.MouseEvent; global.FileReader = window.FileReader;
  global.Blob = window.Blob; global.File = window.File; global.URL = window.URL;
  global.getComputedStyle = window.getComputedStyle.bind(window);
  global.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){} });
  const $ = jqFactory(window);
  global.$ = global.jQuery = window.$ = window.jQuery = $;
  global.Chart = window.Chart = ChartLib.Chart || ChartLib;
  global.jsPDF = window.jsPDF = jsPDF; window.jspdf = { jsPDF };
  global.JSZip = window.JSZip = JSZipLib; global.XLSX = window.XLSX = XLSXLib;

  for (const name of MODULE_ORDER) {
    const full = path.resolve("js", `${name}.js`);
    try { await import(`file://${full}?t=${Date.now()}`); }
    catch (e) { errors.push(`MODULE LOAD FAILED [${name}.js]: ${e.stack || e.message}`); }
  }
  if (errors.length) { console.log(errors); process.exit(1); }
  await wait(300);

  const names = ["Sample_03_For_School_Management_Section_A_Class7.xlsx"];
  const files = names.map(fn => {
    const buf = fs.readFileSync(path.resolve("samples", fn));
    return new window.File([buf], fn, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  });
  window.handleHomeImportFiles(files);
  await wait(500);
  await window.runAnalysis();
  await wait(1500);

  // Open "class" bucket, switch to students tab, pick two different students
  document.getElementById('main').scrollTop = 400; // simulate manual scroll
  console.log("before openBucket, scrollTop:", document.getElementById('main').scrollTop);
  document.querySelector('[data-action="openBucket"][data-arg="class"]')?.click();
  await wait(300);
  console.log("after openBucket click, scrollTop:", document.getElementById('main').scrollTop);

  const main = document.getElementById('main');
  main.scrollTop = 500;
  console.log("\nmanually scrolled to:", main.scrollTop);

  const studentEls = document.querySelectorAll('[data-action="onBucketStudentPick"]');
  console.log("onBucketStudentPick elements found:", studentEls.length);
  if (studentEls.length < 2) {
    document.querySelector('[data-action="openBucket"][data-arg="student"]')?.click();
    await wait(300);
  }
  const studentEls2 = document.querySelectorAll('[data-action="onBucketStudentPick"]');
  console.log("onBucketStudentPick elements found (after opening student bucket):", studentEls2.length);
  if (studentEls2.length >= 2) {
    main.scrollTop = 600;
    console.log("\nmanually scrolled to:", main.scrollTop);
    studentEls2[0].click();
    await wait(200);
    console.log("after picking student 1, scrollTop:", main.scrollTop);
    main.scrollTop = 700;
    console.log("manually re-scrolled to:", main.scrollTop);
    studentEls2[1].click();
    await wait(200);
    console.log("after picking student 2, scrollTop:", main.scrollTop, "(expect 0)");
  }

  console.log("\nerrors:", errors.length);
  errors.forEach(e=>console.log(" -",e));
  process.exit(0);
}
main().catch(e => { console.error("HARNESS FATAL:", e); process.exit(2); });
