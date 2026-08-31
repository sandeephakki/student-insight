// Task 09: Audit-Trail Detail View — the per-student breakdown opened by
// clicking a row in Task 08's main table. Every number here is read
// straight off Task 04's engine output (extended with an `actuals` block
// for this task — see that file's comment) — this view runs no parallel
// calculation of its own (§ locked spec).
//
// Reuses the base dashboard's existing single-item modal
// (#modal-overlay/#modal-box/#modal-content + gsapModalEntrance(), the
// same pattern openStudentModal() in render-core.js already uses) for
// on-screen viewing. The certificate itself downloads as a real PDF via
// downloadScholarshipCertificates() below (js/export-pdf.js's existing
// jsPDF branded-report pipeline), not the app's @media print convention —
// see that function's comment for why the print button was retired.
import { esc, toast } from '../../core/app-utils-init.js';
import { logCodeError } from '../../core/debug-log.js';
import { gsapModalEntrance } from '../common/render-core.js';
import { bcp47TagFor, srT } from '../../core/render-i18n.js';
import { computeScholarshipData } from './scholarship-dashboard.js';
import { reasonCodeParams } from '../../bal/scholarship/scholarship-eligibility-engine.js';
import { buildScholarshipReportBytes } from '../../bal/scholarship/scholarship-export.js';
import { APP } from '../../core/state-nav.js';

function fmtPct(v) {
  return v == null ? "—" : v + "%";
}

// Same muted palette the redesigned PDFs use (js/export-pdf.js PDF_THEME
// GOOD/DANGER) — reused here as hex so the on-screen badges and the PDF
// badges read as the same gentle red/green, not the app's louder generic
// var(--c-success)/var(--c-danger) used for hard errors elsewhere.
const SCHOLARSHIP_GOOD = "#0f6b5c";
const SCHOLARSHIP_DANGER = "#a91e2c";

// Overall Eligible/Not Eligible status — same wording as the dashboard's
// statusBadgeHtml() (scholarship-dashboard.js), so a student's status
// reads the same everywhere: the main table, this detail view, and the
// certificate PDF.
function eligibilityBadge(eligible) {
  const color = eligible ? SCHOLARSHIP_GOOD : SCHOLARSHIP_DANGER;
  const label = eligible ? srT("scholarship_dashboard_status_eligible") : srT("scholarship_dashboard_status_not_eligible");
  return `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${esc(label)}</span>`;
}

// Per-criterion Met/Not Met — deliberately gentler than a blunt Pass/Fail
// for a single row in a table (§ user feedback: "pass fail sounds
// negative ... can we be gentle like eligible/not eligible").
function criterionResultBadge(pass) {
  const color = pass ? SCHOLARSHIP_GOOD : SCHOLARSHIP_DANGER;
  const label = pass ? srT("scholarship_audit_pass") : srT("scholarship_audit_fail");
  return `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${esc(label)}</span>`;
}

// Every row here is Threshold vs Actual vs Pass/Fail, straight off
// engine.checks / engine.actuals / schemeConfig — nothing summarized away
// (§ locked spec). Income and No-Fail rows are only included when the
// scheme actually runs them (needsIncome / noFailRule), so a criterion
// that never applied to this scheme isn't shown as if it were checked.
function criterionRows(result, schemeConfig) {
  const rows = [];
  if (result.checks.academic !== null) {
    rows.push({
      label: srT("scholarship_audit_criterion_academic"),
      threshold: fmtPct(schemeConfig.minAcademicAvg),
      actual: fmtPct(result.actuals.academicAvgPct),
      pass: result.checks.academic
    });
  }
  // BUG FIX: schemeConfig.attendanceFloor is literally Infinity when no
  // floor was set (buildSchemeConfig()'s intentional sentinel for "no
  // limit" so the engine's `<=` check always passes) — that raw value was
  // being interpolated straight into the string, showing "Max Infinity
  // absent days" on screen. Special-case it to a real label here instead.
  rows.push({
    label: srT("scholarship_audit_criterion_attendance"),
    threshold: schemeConfig.attendanceFloor === Infinity
      ? srT("scholarship_audit_no_attendance_limit")
      : srT("scholarship_audit_max_absent_days", { days: schemeConfig.attendanceFloor }),
    actual: srT("scholarship_audit_absent_days", { days: result.actuals.attendanceAbsentDays }),
    pass: result.checks.attendance
  });
  if (schemeConfig.noFailRule === "Yes") {
    rows.push({
      label: srT("scholarship_audit_criterion_no_fail"),
      threshold: srT("scholarship_audit_min_per_test", { pct: schemeConfig.passThreshold }),
      actual: result.actuals.minTestPct == null ? "—" : srT("scholarship_audit_lowest_test", { pct: result.actuals.minTestPct }),
      pass: result.checks.noFail
    });
  }
  if (result.checks.income !== null) {
    const dataMissing = result.checks.income === "Data Missing";
    rows.push({
      label: srT("scholarship_audit_criterion_income"),
      threshold: srT("scholarship_audit_max_income", { amount: schemeConfig.maxFamilyIncome }),
      actual: result.actuals.incomeValue == null ? srT("scholarship_audit_income_missing") : result.actuals.incomeValue,
      pass: dataMissing ? false : result.checks.income
    });
  }
  if (result.checks.category !== null) {
    rows.push({
      label: srT("scholarship_audit_criterion_category"),
      threshold: srT("scholarship_audit_category_threshold"),
      actual: result.actuals.categoryValue == null ? srT("scholarship_audit_income_missing") : result.actuals.categoryValue,
      pass: result.checks.category
    });
  }
  return rows;
}

function criterionTableHtml(rows) {
  const body = rows
    .map(
      r =>
        `<tr><td>${esc(r.label)}</td><td>${esc(r.threshold)}</td><td>${esc(r.actual)}</td><td>${criterionResultBadge(r.pass)}</td></tr>`
    )
    .join("");
  return `<div class="tbl-wrap"><table class="data-table"><thead><tr>
    <th>${esc(srT("scholarship_audit_th_criterion"))}</th>
    <th>${esc(srT("scholarship_audit_th_threshold"))}</th>
    <th>${esc(srT("scholarship_audit_th_actual"))}</th>
    <th>${esc(srT("scholarship_audit_th_result"))}</th>
  </tr></thead><tbody>${body}</tbody></table></div>`;
}

// Full weighted-score math, one line per component plus the total — not
// just the final weightedScore number (§ locked spec: "the reviewer sees
// exactly how it was built"). Skipped entirely for data-incomplete
// students, since the engine itself never computes a weightedScore for
// them (weightedScore is null — §04's dataComplete gate).
function weightedScoreMathHtml(result, schemeConfig) {
  if (result.weightedScore == null) {
    return `<div class="bucket-empty-sub">${esc(srT("scholarship_audit_no_score_incomplete"))}</div>`;
  }
  const parts = [
    [srT("scholarship_audit_component_academic"), result.actuals.academicAvgPct, schemeConfig.weightAcademic],
    [srT("scholarship_audit_component_consistency"), result.consistencyScore, schemeConfig.weightConsistency],
    [srT("scholarship_audit_component_growth"), result.growthScore, schemeConfig.weightGrowth]
  ];
  const lines = parts
    .map(([label, val, weight]) => {
      const contribution = Math.round(((val * weight) / 100) * 10) / 10;
      return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--c-border)">
        <span>${esc(label)}</span>
        <span style="font-variant-numeric:tabular-nums">${val}% &times; ${weight}% = <b>${contribution}</b></span>
      </div>`;
    })
    .join("");
  return `<div class="card" style="padding:12px">
    ${lines}
    <div style="display:flex;justify-content:space-between;padding:8px 0 0;margin-top:4px;font-weight:700">
      <span>${esc(srT("scholarship_audit_total"))}</span>
      <span style="font-variant-numeric:tabular-nums">${result.weightedScore}</span>
    </div>
  </div>`;
}

function schemeSnapshotHtml(schemeConfig) {
  const sch = (APP.setup && APP.setup.scholarship) || {};
  return `<div class="card" style="padding:12px;margin-bottom:14px;font-size:12.5px;color:var(--c-text2)">
    <div style="font-weight:700;color:var(--c-text);margin-bottom:4px">${esc(sch.schemeName || srT("scholarship_audit_untitled_scheme"))}</div>
    <div>${esc(srT("scholarship_audit_snapshot_type", { type: schemeConfig.eligibilityType || "—" }))}</div>
    <div>${esc(
      srT("scholarship_audit_snapshot_weights", {
        academic: schemeConfig.weightAcademic,
        consistency: schemeConfig.weightConsistency,
        growth: schemeConfig.weightGrowth
      })
    )}</div>
  </div>`;
}

function reasonText(reasonCodes, actuals, schemeConfig) {
  if (!reasonCodes || !reasonCodes.length) return "";
  return reasonCodes.map(c => srT("scholarship_reason_" + c, reasonCodeParams(c, actuals, schemeConfig))).join(" ");
}

function buildDetailHtml(result, student, schemeConfig) {
  const rows = criterionRows(result, schemeConfig);
  return `<div id="scholarship-audit-detail" data-student-id="${esc(result.studentId)}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">
      <div>
        <div class="card-title" style="margin:0">${esc(student.name || result.studentId)}</div>
        <div style="font-size:12px;color:var(--c-text2)">${esc(result.studentId)}${student.category ? " · " + esc(student.category) : ""}</div>
      </div>
      ${result.dataComplete ? eligibilityBadge(result.eligible) : `<span class="badge">${esc(srT("scholarship_dashboard_stat_data_missing"))}</span>`}
    </div>
    ${schemeSnapshotHtml(schemeConfig)}
    <div class="card-title" style="margin-bottom:6px">${esc(srT("scholarship_audit_criteria_title"))}</div>
    ${criterionTableHtml(rows)}
    <div class="card-title" style="margin:14px 0 6px">${esc(srT("scholarship_audit_math_title"))}</div>
    ${weightedScoreMathHtml(result, schemeConfig)}
    ${
      !result.eligible && result.reasonCodes && result.reasonCodes.length
        ? `<div style="margin-top:12px;font-size:12.5px;color:var(--c-text2)"><b>${esc(
            srT("scholarship_audit_reason_label")
          )}:</b> ${esc(reasonText(result.reasonCodes, result.actuals, schemeConfig))}</div>`
        : ""
    }
  </div>`;
}

// Row-click entry point — this is the function name Task 08's dashboard
// already looks up (window.openScholarshipDetail) as its routing target,
// so no change to scholarship-dashboard.js is needed to wire this in.
function openScholarshipDetail(studentId) {
  const data = computeScholarshipData();
  const result = data.engineResults.find(r => r.studentId === studentId);
  const student = data.students.find(s => s.id === studentId);
  if (!result || !student) {
    toast(srT("scholarship_audit_not_found_toast"), "error");
    return;
  }
  $("#modal-content").html(buildDetailHtml(result, student, data.schemeConfig));
  gsapModalEntrance();
  setTimeout(() => {
    const f = document.querySelector("#modal-overlay.open .modal-close");
    if (f) f.focus();
  }, 0);
}

// Print certificate removed (UI review: the app already has a real PDF
// pipeline in js/export-pdf.js — reusing it here beats a second,
// browser-print-only certificate mechanism). See buildScholarshipCertificatePDF/
// downloadScholarshipCertificates below instead — same jsPDF branded
// header/footer bar every other report PDF (student/teacher/management)
// already uses (sanitizePdfDoc/stampFooterAllPages/pdfT, all imported
// from export-pdf.js, zero duplicated drawing code).

// Renders ONE certificate onto an already-created jsPDF doc — same shape
// as buildStudentPDF()/buildTeacherPDF()/buildMgmtPDF() in export-pdf.js
// (brand header bar, then content, then stampFooterAllPages() by the
// caller/here), just drawn with jsPDF primitives instead of the on-screen
// HTML buildDetailHtml() above. Every number is read straight off the
// same `result`/`schemeConfig` the on-screen audit view uses — this
// draws criterionRows()/weightedScore math again as vector text, it does
// not recompute anything.
function buildScholarshipCertificatePDF(doc, result, student, schemeConfig, pdfHelpers) {
  const { PDF_THEME, pdfT, pdfRule, fitText, stampFooterAllPages } = pdfHelpers;
  const s = APP.setup || {};
  const sch = (APP.setup && APP.setup.scholarship) || {};
  const W = 210, H = 297;
  const T = PDF_THEME;

  // ── HEADER — ink-light: text + rule, no filled bar (matches
  //    export-pdf.js addPDFHeader()'s Aug 2026 redesign). Brand/meta font
  //    sizes (12pt/8.5pt) match every report builder in export-pdf.js. ──
  doc.setTextColor(...T.ACCENT); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text("Student Insight", 10, 11);
  doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.setTextColor(...T.INK_SOFT);
  doc.text([s.instName, s.className + (s.section ? " " + s.section : ""), s.year].filter(Boolean).join(" · "), 80, 11);
  pdfRule(doc, 8, 14, W - 8, 1.6, T.INK);
  doc.setTextColor(...T.INK); doc.setFontSize(14); doc.setFont("helvetica", "bold");
  doc.text(pdfT("scholarship_cert_pdf_title", "Scholarship Certificate"), 10, 26);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...T.INK_SOFT);
  doc.text(pdfT("pdf_generated_label", "Generated: {{date}}", { date: new Date().toLocaleDateString(bcp47TagFor(window.SR_LANG)) }), W - 10, 26, { align: "right" });
  let y = 34;

  // ── SCHEME NAME ──
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...T.INK);
  doc.text(fitText(doc, sch.schemeName || pdfT("scholarship_audit_untitled_scheme", "Scholarship Scheme"), W - 20), 10, y);
  y += 9;

  // ── STUDENT IDENTITY + PASS/FAIL BADGE — bordered outline instead of a
  //    filled box (same "fill only where colour IS the data" rule the
  //    redesign uses everywhere else); badge stays filled since eligible/
  //    not-eligible is itself the one piece of colour-coded data here. ──
  doc.setDrawColor(...T.LINE_STRONG); doc.setLineWidth(0.4); doc.roundedRect(8, y, W - 16, 26, 2, 2, "S");
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...T.INK);
  doc.text(fitText(doc, student.name || result.studentId, W - 37 - 4 - 13), 13, y + 10);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...T.INK_SOFT);
  doc.text(fitText(doc, result.studentId + (student.category ? " · " + student.category : ""), W - 37 - 4 - 13), 13, y + 18);
  const eligible = result.dataComplete ? result.eligible : null;
  const badgeColor = eligible === true ? T.GOOD : eligible === false ? T.DANGER : T.LINE;
  const badgeLabel = eligible === true ? pdfT("scholarship_dashboard_status_eligible", "Eligible") : eligible === false ? pdfT("scholarship_dashboard_status_not_eligible", "Not Eligible") : pdfT("scholarship_dashboard_stat_data_missing", "Data Missing");
  doc.setFillColor(...badgeColor); doc.roundedRect(W - 37, y + 3, 28, 20, 3, 3, "F");
  doc.setTextColor(...T.WHITE); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(fitText(doc, badgeLabel, 24), W - 23, y + 13, { align: "center" });
  y += 32;

  // ── CRITERIA TABLE — outline header row (rule, not fill) + hairline
  //    zebra rules instead of filled zebra backgrounds. ──
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...T.INK);
  doc.text(pdfT("scholarship_audit_criteria_title", "Eligibility Criteria"), 10, y);
  y += 6;
  const colX = [10, 82, 128, 172], colW = [70, 44, 42, 28];
  pdfRule(doc, 8, y, W - 8, 1.6, T.INK);
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...T.INK);
  doc.text(pdfT("scholarship_audit_th_criterion", "Criterion"), colX[0] + 2, y + 5);
  doc.text(pdfT("scholarship_audit_th_threshold", "Threshold"), colX[1] + 2, y + 5);
  doc.text(pdfT("scholarship_audit_th_actual", "Actual"), colX[2] + 2, y + 5);
  doc.text(pdfT("scholarship_audit_th_result", "Result"), colX[3] + 2, y + 5);
  y += 7;
  pdfRule(doc, 8, y, W - 8, 1, T.LINE);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  const rows = criterionRows(result, schemeConfig);
  rows.forEach((r, i) => {
    if (y > H - 44) { doc.addPage(); y = 20; }
    doc.setTextColor(...T.INK);
    doc.text(fitText(doc, r.label, colW[0] - 4), colX[0] + 2, y + 4.5);
    doc.text(fitText(doc, r.threshold, colW[1] - 4), colX[1] + 2, y + 4.5);
    doc.text(fitText(doc, r.actual, colW[2] - 4), colX[2] + 2, y + 4.5);
    const passColor = r.pass ? T.GOOD : T.DANGER;
    doc.setFont("helvetica", "bold"); doc.setTextColor(...passColor);
    doc.text(r.pass ? pdfT("scholarship_audit_pass", "Met") : pdfT("scholarship_audit_fail", "Not Met"), colX[3] + 2, y + 4.5);
    doc.setFont("helvetica", "normal");
    y += 6.5;
    pdfRule(doc, 8, y, W - 8, 0.6, T.LINE);
  });
  y += 8;

  // ── WEIGHTED SCORE MATH — skipped for data-incomplete students, same
  //    gate weightedScoreMathHtml() uses on screen. ──
  if (y > H - 60) { doc.addPage(); y = 20; }
  if (result.weightedScore != null) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...T.INK);
    doc.text(pdfT("scholarship_audit_math_title", "Weighted Score Calculation"), 10, y);
    y += 7;
    const parts = [
      [pdfT("scholarship_audit_component_academic", "Academic"), result.actuals.academicAvgPct, schemeConfig.weightAcademic],
      [pdfT("scholarship_audit_component_consistency", "Consistency"), result.consistencyScore, schemeConfig.weightConsistency],
      [pdfT("scholarship_audit_component_growth", "Growth"), result.growthScore, schemeConfig.weightGrowth]
    ];
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...T.INK);
    parts.forEach(([label, val, weight]) => {
      const contribution = Math.round(((val * weight) / 100) * 10) / 10;
      doc.text(label, 10, y);
      doc.text(val + "% \u00d7 " + weight + "% = " + contribution, W - 10, y, { align: "right" });
      y += 6;
    });
    pdfRule(doc, 10, y, W - 10, 1, T.LINE_STRONG);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.text(pdfT("scholarship_audit_total", "Total"), 10, y);
    doc.text(String(result.weightedScore), W - 10, y, { align: "right" });
    y += 10;
  } else {
    doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(...T.INK_SOFT);
    doc.text(pdfT("scholarship_audit_no_score_incomplete", "No score computed — this student's data is incomplete."), 10, y);
    y += 10;
  }

  if (!result.eligible && result.reasonCodes && result.reasonCodes.length) {
    if (y > H - 30) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...T.INK_SOFT);
    const reasonLine = pdfT("scholarship_audit_reason_label", "Reason") + ": " + reasonText(result.reasonCodes, result.actuals, schemeConfig);
    doc.text(fitText(doc, reasonLine, W - 20), 10, y);
  }

  stampFooterAllPages(doc, pdfT("pdf_confidential_scholarship", "CONFIDENTIAL — Scholarship record"));
}

// Batch entry point — wired to the right rail's "Download Certificates"
// button (js/vs-shell.js renderScholarshipPropertiesRail()). Reads the
// current .scholarship-cert-cb checkbox selection straight from the DOM
// itself, same convention generateAllPDFs() in export-pdf.js already uses
// for its own `.exp-student-cb` list — no data-arg plumbing needed.
//
// Everything this click produces — certificate PDF(s) and, if opted in,
// the class-wide Shortlist/By Category/Subject Toppers workbook — goes
// into ONE zip and ONE download. Previously the "include common reports"
// checkbox fired window.downloadScholarshipReport() as a second,
// independent browser download (XLSX.writeFile triggers its own save
// immediately) while the certificate(s) downloaded separately as a second
// file or zip — two files landing in Downloads for what the person
// experienced as one click. buildScholarshipReportBytes() (new, in
// js/scholarship-export.js) returns the workbook as raw bytes instead of
// writing it to disk, so it can be added as just another entry in the
// same JSZip as the certificate PDFs below. A lone certificate with the
// checkbox OFF still downloads unzipped (nothing to combine it with).
async function downloadScholarshipCertificates() {
  const ids = $(".scholarship-cert-cb:checked").map((i, el) => el.getAttribute("data-id")).get();
  if (!ids.length) {
    toast(srT("scholarship_cert_select_student_toast"), "warn");
    return;
  }
  const includeCommon = $("#scholarship-cert-include-common").is(":checked");
  const data = computeScholarshipData();
  const selected = ids
    .map(id => ({
      result: data.engineResults.find(r => r.studentId === id),
      student: data.students.find(s => s.id === id)
    }))
    .filter(x => x.result && x.student);
  if (!selected.length) {
    toast(srT("scholarship_audit_not_found_toast"), "error");
    return;
  }
  const { jsPDF } = window.jspdf;
  const pdfHelpers = await import('../../bal/export/export-pdf.js');
  function safeName(n) { return String(n || "").replace(/[^\w\s-]/g, "").replace(/\s+/g, "_"); }
  function downloadBlob(blob, fname) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = fname;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  // safeRun() (js/debug-log.js) only catches SYNCHRONOUS throws — this
  // work is async (JSZip.generateAsync), so it's wrapped in a real
  // try/catch here instead, logging the same way safeRun's own catch
  // branch would (logCodeError, counts only, no student rows) plus an
  // actual user-facing toast, which a swallowed async rejection would
  // otherwise never surface.
  try {
    // Filename convention: {Eligible|NotEligible}_{StudentName}_{RollNo}.pdf
    // — "RollNo" here is the same student.id used everywhere else in the
    // app (Student ID column from the upload sheet); there is no separate
    // roll-number field in the data model.
    function certFileStem(result, student) {
      const eligible = result.dataComplete ? result.eligible : null;
      const status = eligible === true ? "Eligible" : eligible === false ? "NotEligible" : "DataMissing";
      return status + "_" + safeName(student.name) + "_" + safeName(student.id);
    }
    // Single file only when there's exactly one certificate AND no report
    // to combine it with — any other combination (multiple certificates,
    // or one certificate + the report) needs a zip.
    if (selected.length === 1 && !includeCommon) {
      const { result, student } = selected[0];
      const doc = pdfHelpers.sanitizePdfDoc(new jsPDF("p", "mm", "a4"));
      buildScholarshipCertificatePDF(doc, result, student, data.schemeConfig, pdfHelpers);
      downloadBlob(doc.output("blob"), certFileStem(result, student) + ".pdf");
    } else {
      const zip = new JSZip();
      for (const { result, student } of selected) {
        const doc = pdfHelpers.sanitizePdfDoc(new jsPDF("p", "mm", "a4"));
        buildScholarshipCertificatePDF(doc, result, student, data.schemeConfig, pdfHelpers);
        zip.file(certFileStem(result, student) + ".pdf", doc.output("blob"));
      }
      if (includeCommon) {
        const { fname, bytes } = buildScholarshipReportBytes(data);
        zip.file(fname, bytes);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const inst = safeName((APP.setup && APP.setup.instName) || "Studin");
      downloadBlob(zipBlob, inst + "_Scholarship_Certificates.zip");
    }
    toast(srT("scholarship_cert_toast_success", { count: selected.length }), "success");
  } catch (err) {
    logCodeError("scholarship_certificates", "download_certificates", err, { selected_count: selected.length });
    toast(srT("scholarship_cert_export_failed_toast", { msg: err.message }), "error");
  }
}

export { buildScholarshipCertificatePDF, downloadScholarshipCertificates, openScholarshipDetail };

if (typeof window !== "undefined") {
  window.openScholarshipDetail = openScholarshipDetail;
  window.downloadScholarshipCertificates = downloadScholarshipCertificates;
}
