// Task 10: Download Report — wires Task 08's Download button to a real
// export. Reuses the app's existing XLSX.utils.book_new() / aoa_to_sheet()
// / XLSX.writeFile() pattern (js/template-upload.js buildSetupSheet() etc.,
// js/render-core.js downloadUpdatedSheet()) rather than a new download
// mechanism — no zip bundling (§12's "zip every download" idea was
// reversed before being finalized; this stays a plain .xlsx, see this
// task's Context note).
import { esc, toast } from '../../core/app-utils-init.js';
import { srT } from '../../core/render-i18n.js';
import { safeRun } from '../../core/debug-log.js';
import { reasonCodeParams } from './scholarship-eligibility-engine.js';
import { APP } from '../../core/state-nav.js';

// --- Session-only backup (§33) ---------------------------------------
// A plain module-scoped variable. Nothing here ever touches localStorage
// or any other persistent store — this is exactly what makes it "session-
// only": a page refresh clears the whole JS module graph automatically,
// there is no separate cleanup step to remember or get wrong. Holds the
// most recent export's data + filename, for in-tab recovery/undo-safety
// only (e.g. "what did I just download") — never read back into the UI
// automatically, never written to disk itself.
let _sessionBackup = null;

function getScholarshipSessionBackup() {
  return _sessionBackup;
}

// --- Filename generation (§34) ----------------------------------------
// {Institution}_{Class/Batch}_{AcademicYear}_{YYYY-MM-DD}.xlsx, falling
// back to a _HH-MM suffix only on same-day repeat. Collision detection is
// necessarily against filenames THIS session has already generated, kept
// in-memory here — the browser has no way to see the user's actual
// Downloads folder, so this can't be collision-proof against, say, a
// download from yesterday's session or a manually-renamed file; it only
// prevents this tab silently generating two identically-named files in
// one sitting. Stated here explicitly rather than implying a stronger
// guarantee than that (§ Task 10 §1 THINK).
const _usedFilenamesThisSession = new Set();

function sanitizeNamePart(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-]/g, "");
}

function todayDateStamp() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function nowTimeStamp() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + "-" + String(d.getMinutes()).padStart(2, "0");
}

function buildScholarshipFilename() {
  const inst = sanitizeNamePart(APP.setup.instName) || "Studin";
  // Class/Batch component: className+section concatenated directly (no
  // separator) — matches §34's own example ("Class7A", not "Class7_A")
  // and the app's existing classPrefixForTabs() convention in
  // js/template-upload.js for the same Class+Section pairing.
  const classBatch = sanitizeNamePart(String(APP.setup.className || "") + String(APP.setup.section || "")) || "Class";
  const year = sanitizeNamePart(APP.setup.year) || "AY";
  const base = [inst, classBatch, year].join("_");
  const dateStamp = todayDateStamp();

  let fname = base + "_" + dateStamp + ".xlsx";
  if (_usedFilenamesThisSession.has(fname)) {
    // Same-day repeat within this session — fall back to appending time,
    // per §34. Date-only stays the clean default; time is only added
    // when a same-day collision is actually about to happen.
    fname = base + "_" + dateStamp + "_" + nowTimeStamp() + ".xlsx";
  }
  _usedFilenamesThisSession.add(fname);
  return fname;
}

// --- Workbook assembly --------------------------------------------------
// Combines Task 06's three already-built views into one workbook, one
// sheet each — reshapes rows into aoa_to_sheet()'s array-of-arrays shape
// only; every value comes straight from the computed data passed in
// (Task 08's computeScholarshipData() output), no independent
// recalculation.
function shortlistSheetRows(data) {
  const header = [
    srT("scholarship_dashboard_th_rank"),
    srT("scholarship_dashboard_th_id"),
    srT("scholarship_dashboard_th_name"),
    srT("scholarship_dashboard_th_category"),
    srT("scholarship_dashboard_th_score"),
    srT("scholarship_dashboard_th_status"),
    srT("scholarship_dashboard_th_reason")
  ];
  const rows = data.shortlist
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map(r => [
      r.rank,
      r.studentId,
      r.name,
      r.category,
      r.weightedScore,
      r.eligible ? srT("scholarship_dashboard_status_eligible") : srT("scholarship_dashboard_status_not_eligible"),
      r.reasonCodes && r.reasonCodes.length
        ? r.reasonCodes.map(c => srT("scholarship_reason_" + c, reasonCodeParams(c, r.actuals, data.schemeConfig))).join(" ")
        : srT("scholarship_reason_meets_all_criteria") // same eligible-row fallback as the on-screen Shortlist table (scholarship-dashboard.js) — an empty reasonCodes array means "nothing failed," not "no reason to show"
    ]);
  return [header, ...rows];
}

function byCategorySheetRows(data) {
  const header = [
    srT("scholarship_dashboard_th_category"),
    srT("scholarship_dashboard_th_rank_in_category"),
    srT("scholarship_dashboard_th_id"),
    srT("scholarship_dashboard_th_name"),
    srT("scholarship_dashboard_th_score"),
    srT("scholarship_dashboard_th_status")
  ];
  const rows = data.byCategory
    .slice()
    .sort((a, b) => (a.category > b.category ? 1 : a.category < b.category ? -1 : a.rankWithinCategory - b.rankWithinCategory))
    .map(r => [
      r.category,
      r.rankWithinCategory,
      r.studentId,
      r.name,
      r.weightedScore,
      r.eligible ? srT("scholarship_dashboard_status_eligible") : srT("scholarship_dashboard_status_not_eligible")
    ]);
  return [header, ...rows];
}

function subjectToppersSheetRows(data) {
  const subjects = APP.setup.subjects || [];
  const header = [srT("scholarship_dashboard_th_rank"), srT("scholarship_dashboard_th_id"), srT("scholarship_dashboard_th_name"), ...subjects, srT("scholarship_dashboard_th_overall_avg")];
  const rows = data.subjectToppers
    .slice()
    .sort((a, b) => a.overallRank - b.overallRank)
    .map(r => [r.overallRank, r.studentId, r.name, ...subjects.map(s => (r[s] != null ? r[s] : "")), r.overallAcademicAvgPct]);
  return [header, ...rows];
}

function buildScholarshipWorkbook(data) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(shortlistSheetRows(data)), srT("scholarship_export_sheet_shortlist"));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(byCategorySheetRows(data)), srT("scholarship_export_sheet_by_category"));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(subjectToppersSheetRows(data)), srT("scholarship_export_sheet_subject_toppers"));
  return wb;
}

// Entry point — this is the function name Task 08's Download button
// already looks up (window.generateScholarshipReport) and calls with its
// computed data, so no change to scholarship-dashboard.js is needed.
// categoryFilter is the dashboard's current category-filter selection
// ("all" or a specific category) — passed through only for the Task 12
// input_context below, has no effect on which rows get exported (the
// report always contains all three full Task 06 views, per Task 08/10's
// own spec, regardless of what the on-screen table happens to be
// filtered to).

// Builds the workbook bytes without triggering a browser download — used
// by downloadScholarshipCertificates() (js/scholarship-audit-detail.js),
// which needs the raw bytes so it can add this workbook as one more file
// inside the certificates ZIP instead of triggering its own separate
// download alongside it.
function buildScholarshipReportBytes(data) {
  const wb = buildScholarshipWorkbook(data);
  const fname = buildScholarshipFilename();
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return { fname, bytes };
}

function generateScholarshipReport(data, categoryFilter) {
  if (!data || !data.students || !data.students.length) {
    toast(srT("val_no_data_loaded") || "No data loaded.", "warn");
    return;
  }
  // Task 12: real risk point (workbook assembly + browser download can
  // both throw) — wrapped so a genuine bug produces a classified
  // CODE_ERROR log entry (counts/filter only, never student rows) instead
  // of a silently-failed download.
  safeRun("shortlist_export", "download_report", () => {
    const wb = buildScholarshipWorkbook(data);
    const fname = buildScholarshipFilename();
    XLSX.writeFile(wb, fname);

    // Session-only backup — see comment above _sessionBackup. Overwrites
    // any prior snapshot; only the latest download is kept, since this
    // exists for "what did I just download" recovery, not a full history
    // (full history is the separate dated files themselves, per §34).
    _sessionBackup = { filename: fname, downloadedAt: new Date().toISOString(), data };

    toast(srT("scholarship_export_toast_success", { fname: esc(fname) }), "success");
  }, () => ({
    eligible_count: data.shortlist.filter(r => r.eligible).length,
    category_filter: categoryFilter || "all"
  }));
}

export { buildScholarshipFilename, buildScholarshipReportBytes, buildScholarshipWorkbook, generateScholarshipReport, getScholarshipSessionBackup };

if (typeof window !== "undefined") {
  window.generateScholarshipReport = generateScholarshipReport;
  window.buildScholarshipReportBytes = buildScholarshipReportBytes;
  window.getScholarshipSessionBackup = getScholarshipSessionBackup;
}
