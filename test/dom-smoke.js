// Headless DOM smoke test — real jsdom load of index.html, real sample-data
// run through the app's own runSampleFile(), then a synthetic click fired on
// every element carrying onclick/data-action across home, setup, dashboard
// buckets, individual buckets, and findings/picker screens. Reports thrown
// errors and any data-action name the dispatcher didn't recognize.
//
// Setup (one-time): npm install --save-dev jsdom jquery chart.js jspdf jszip xlsx
// Run:
//   1. Build a harness copy of index.html with CDN <script src> swapped to
//      local node_modules paths (see HANDOVER/session notes for the exact
//      rewrite — cdnjs/jsdelivr jquery/xlsx-js-style/jspdf/jszip/Chart.js
//      each map to their npm package's dist file), saved as index.harness.html
//   2. Serve the project root: `python3 -m http.server 8899 --bind 127.0.0.1`
//   3. node test/dom-smoke.js
//
// This does NOT catch layout/visual bugs (jsdom has no rendering/canvas) —
// it catches reference errors and dead buttons, which was the actual risk
// this test exists to cover.
const { JSDOM } = require("jsdom");

const BASE = "http://127.0.0.1:8899/index.harness.html";
const errors = [];
const clickedLog = [];

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const dom = await JSDOM.fromURL(BASE, {
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) {
      // jsdom has no fetch of its own — wire in Node's native fetch so the
      // app's real fetch() calls (i18n JSON, sample .xlsx files) work
      // against the local static server, same as a real browser would.
      window.fetch = (...args) => fetch(...args);
    },
  });
  const { window } = dom;

  window.onerror = (msg, src, line, col, err) => {
    errors.push(`window.onerror: ${msg} (${src}:${line}:${col})`);
  };
  window.addEventListener("unhandledrejection", (ev) => {
    errors.push(`unhandledrejection: ${ev.reason}`);
  });
  window.alert = () => {};
  window.confirm = () => true;
  window.print = () => {};
  // jsdom has no layout engine -> scrollIntoView/canvas 2d context are unimplemented
  window.HTMLElement.prototype.scrollIntoView = () => {};

  await wait(1500); // let DOMContentLoaded-driven init finish

  function clickAllOnceIn(root, label) {
    const els = Array.from(root.querySelectorAll("[onclick], [data-action]"));
    for (const el of els) {
      // skip elements that require real file input / native dialogs
      if (el.tagName === "INPUT") continue;
      try {
        el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
        clickedLog.push(`OK  [${label}] ${el.tagName}#${el.id || "-"} ${(el.getAttribute("data-action")||el.getAttribute("onclick")||"").slice(0,60)}`);
      } catch (e) {
        errors.push(`CLICK-THROW [${label}] ${el.tagName}#${el.id || "-"} ${(el.getAttribute("data-action")||el.getAttribute("onclick")||"").slice(0,60)} -> ${e.message}`);
      }
    }
  }

  const doc = window.document;

  // Pass 1: home screen (nav + CTA buttons), before any data loaded
  clickAllOnceIn(doc, "home-initial");
  await wait(300);

  // Try to load real sample data via the app's own function — the same
  // path an actual user hits clicking "Try Sample Data".
  if (typeof window.runSampleFile === "function") {
    try {
      await window.runSampleFile(["Sample_02_For_School_Class_Teacher.xlsx"]);
    } catch (e) {
      errors.push(`runSampleFile threw: ${e.message}`);
    }
  }
  await wait(1200);

  // Pass 2: whatever screen we ended on after sample data load
  clickAllOnceIn(doc, "post-sample-load");
  await wait(300);

  // Explicitly open the dashboard buckets / individual screens / findings
  // so the render-buckets.js / render-findings.js template-literal
  // elements actually exist in the DOM to be clicked.
  const deepDiveFns = ["openBucket", "openIndividualBucket"];
  for (const fnName of deepDiveFns) {
    if (typeof window[fnName] === "function") {
      for (const arg of ["class", "compare", "export", "report", "wellbeing"]) {
        try { window[fnName](arg); } catch (e) { /* not every arg is valid for every fn - ignore */ }
        await wait(150);
        clickAllOnceIn(doc, `${fnName}(${arg})`);
      }
    }
  }

  // Force-navigate through top-level steps directly via goStep(), then
  // click everything live on each screen — this doesn't depend on sample
  // data actually having loaded, so it still exercises nav/setup/about/faq
  // regardless of whether the fetch-based sample data succeeded above.
  for (const step of ["home", "setup", "about", "faq"]) {
    if (typeof window.goStep === "function") {
      try { window.goStep(step); } catch (e) { errors.push(`goStep(${step}) threw: ${e.message}`); }
    }
    await wait(200);
    clickAllOnceIn(doc, `step-${step}`);
  }

  console.log(`\n=== clicked ${clickedLog.length} elements ===`);
  console.log(`=== ${errors.length} errors ===`);
  for (const e of errors) console.log(" - " + e);
  const unknown = Array.from(new Set(window.__unknownActions || []));
  console.log(`=== ${unknown.length} distinct unrecognized data-action names ===`);
  for (const u of unknown) console.log(" - " + u);

  process.exit(errors.length || unknown.length ? 1 : 0);
}

main().catch(e => {
  console.error("HARNESS FATAL:", e);
  process.exit(2);
});
