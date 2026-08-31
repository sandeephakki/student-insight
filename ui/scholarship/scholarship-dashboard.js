// Task 08: Scholarship Main Dashboard Screen — the enabled-state working
// view (§30, locked spec). Pure orchestration/render layer over the
// already-built pure-calc modules (Tasks 04/05/06) — this file adds no
// new eligibility/ranking logic of its own, only wires their output to
// DOM + the tab/search/filter UI described in Task 08's brief.
//
// Reuses: kpi-card markup (render-core.js renderKPIs), .data-table markup
// (render-core.js/compute-compare.js), .db-tabs/.db-tab tab pattern
// (index.html #db-tabs + app-utils-init.js switchDbTab), .badge status
// styling (render-core.js flag badges) — no new component classes added.
import { esc, toast } from '../../core/app-utils-init.js';
import { srT } from '../../core/render-i18n.js';
import { splitByDataCompleteness } from '../../bal/scholarship/scholarship-completeness-grid.js';
import { calculateScholarshipEligibility, reasonCodeParams } from '../../bal/scholarship/scholarship-eligibility-engine.js';
import { buildByCategory, buildShortlist, buildSubjectToppers } from '../../bal/scholarship/scholarship-report-views.js';
import { generateScholarshipReport } from '../../bal/scholarship/scholarship-export.js';
import { safeRun } from '../../core/debug-log.js';
import { isSchemeConfigured } from './scholarship-nav.js';
import { APP } from '../../core/state-nav.js';

// Module-local UI state — reset on every renderScholarshipDashboard() call
// (fresh visit / re-enable), not persisted across sessions.
const _state = { tab: "shortlist", search: "", status: "all", category: "all", showErrorGrid: false };

// noFailRule is stored as a boolean in APP.setup.scholarship (project-setup.js)
// but Task 04's engine compares it case-sensitively against the string
// "Yes" (see scholarship-eligibility-engine.js header comment). Normalizing
// here — at the one call site that bridges SETUP state into the engine —
// rather than changing either module's existing, already-tested contract.
function buildSchemeConfig() {
  const sch = (APP.setup && APP.setup.scholarship) || {};
  return {
    eligibilityType: sch.eligibilityType || "",
    minAcademicAvg: sch.minAcademicAvg || 0,
    maxFamilyIncome: sch.maxFamilyIncome || 0,
    noFailRule: sch.noFailRule === true || sch.noFailRule === "Yes" ? "Yes" : "No",
    attendanceFloor: sch.attendanceFloor == null ? Infinity : sch.attendanceFloor,
    categoryQuota: sch.categoryQuota,
    weightAcademic: sch.weightAcademic || 0,
    weightConsistency: sch.weightConsistency || 0,
    weightGrowth: sch.weightGrowth || 0,
    passThreshold: APP.setup.passThreshold
  };
}

// BUG FIX: computeScholarshipData() used to run the eligibility engine +
// splitByDataCompleteness() fresh on every call — including every filter/
// search/tab interaction via renderTabPanelOnly(). splitByDataCompleteness()
// logs a DATA_ERROR (and toasts) per incomplete student per missing field,
// so changing a dropdown re-fired the SAME toasts for the SAME already-known
// incomplete students every time, even though filters never change who's
// data-incomplete — only which rows are visible. The engine/completeness
// result only actually changes when the student data or scheme config
// changes (new upload, SETUP edit), never from a filter/search interaction.
// Cached here on student-array identity + scheme config content so
// filter-only re-renders reuse the prior result — recompute (and the
// logging that comes with it) only happens once per genuine data change.
let _cache = { studentsRef: null, schemeConfigJSON: null, data: null };

function computeScholarshipData() {
  const students = APP.students || [];
  const schemeConfig = buildSchemeConfig();
  const schemeConfigJSON = JSON.stringify(schemeConfig);
  // Cheap + not part of the cache key on purpose: isSchemeConfigured() reads
  // the same fields buildSchemeConfig() already normalizes into schemeConfig
  // (eligibilityType/minAcademicAvg/maxFamilyIncome), so it can't go stale
  // between cache hits — recomputing it fresh every call costs nothing and
  // avoids needing a second cache key.
  const configured = isSchemeConfigured((APP.setup && APP.setup.scholarship) || {});

  if (_cache.studentsRef === students && _cache.schemeConfigJSON === schemeConfigJSON) {
    return { ..._cache.data, configured };
  }

  // Task 12: real risk point (student data / SETUP mismatches can throw
  // here) — wrapped so a genuine bug produces a classified log entry
  // instead of a silent blank dashboard.
  const engineResults = safeRun("scholarship_engine", "calculate_eligibility", () => calculateScholarshipEligibility(students, schemeConfig));
  const split = splitByDataCompleteness(engineResults, students);
  const shortlist = buildShortlist(split.complete, students);
  const byCategory = buildByCategory(split.complete, students);
  const subjectToppers = buildSubjectToppers(students, APP.setup.subjects || []);
  const categories = Array.from(new Set(shortlist.map(r => r.category).filter(Boolean))).sort();
  const data = { students, schemeConfig, engineResults, split, shortlist, byCategory, subjectToppers, categories, configured };

  _cache = { studentsRef: students, schemeConfigJSON, data };
  return data;
}

// Muted palette (same hex the redesigned PDFs use — export-pdf.js
// PDF_THEME GOOD/DANGER) instead of the app's louder generic
// var(--c-success)/var(--c-danger), which reads as too alarming repeated
// down a table of 20-30 "Not Eligible" rows. Also keeps the on-screen
// table, detail view, and certificate PDF visually consistent.
function statusBadgeHtml(eligible) {
  const color = eligible ? "#0f6b5c" : "#a91e2c";
  const label = eligible ? srT("scholarship_dashboard_status_eligible") : srT("scholarship_dashboard_status_not_eligible");
  return `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${esc(label)}</span>`;
}

// BUG FIX: reasonCodes only ever holds FAILURE reasons (see the engine's
// reasonCodes.push(...) calls — nothing is ever pushed for a passing
// check). An eligible student who fails nothing therefore has
// reasonCodes: [] — this used to return "" for that case, so every
// eligible row in the Shortlist table showed a blank Reason cell instead
// of an actual reason, defeating the whole point of the audit-trail
// column (§31 — every row, eligible or not, needs a visible reason).
// Incomplete-data students never reach this function: they're already
// filtered into the separate error grid by splitByDataCompleteness()
// (§29) before the shortlist is built, so an empty array here always
// and only means "eligible, nothing failed" — safe to resolve as such.
function reasonText(reasonCodes, actuals, schemeConfig) {
  if (!reasonCodes || !reasonCodes.length) return srT("scholarship_reason_meets_all_criteria");
  return reasonCodes.map(c => srT("scholarship_reason_" + c, reasonCodeParams(c, actuals, schemeConfig))).join(" ");
}

function statCardsHtml(data) {
  const total = data.shortlist.length;
  const eligible = data.shortlist.filter(r => r.eligible).length;
  const notEligible = total - eligible;
  const missing = data.split.errorGrid.length;
  const cards = [
    { label: srT("scholarship_dashboard_stat_total"), val: total, accent: "#2b3a67", clickable: false },
    { label: srT("scholarship_dashboard_stat_eligible"), val: eligible, accent: "#2ec4b6", clickable: false },
    { label: srT("scholarship_dashboard_stat_not_eligible"), val: notEligible, accent: "#f25454", clickable: false },
    { label: srT("scholarship_dashboard_stat_data_missing"), val: missing, accent: missing > 0 ? "#f9a825" : "#2ec4b6", clickable: true }
  ];
  return `<div id="kpi-row" class="kpi-row" style="margin-bottom:16px">${cards
    .map(
      k =>
        `<div class="kpi-card" style="--kpi-accent:${k.accent}${k.clickable ? ";cursor:pointer" : ""}"${
          k.clickable ? ' data-action="toggleScholarshipErrorGrid" tabindex="0" role="button"' : ""
        }><div class="kpi-label">${esc(k.label)}</div><div class="kpi-val" style="color:${k.accent}">${k.val}</div></div>`
    )
    .join("")}</div>`;
}

function errorGridHtml(data) {
  if (!_state.showErrorGrid) return "";
  if (!data.split.errorGrid.length) return "";
  const rows = data.split.errorGrid
    .map(
      r =>
        `<tr><td>${esc(r.studentId)}</td><td>${esc(r.name)}</td><td>${r.missingFieldKeys.map(k => esc(srT(k))).join(", ")}</td></tr>`
    )
    .join("");
  return `<div class="card" style="padding:12px;margin-bottom:16px">
    <div class="card-title" style="margin-bottom:8px">${esc(srT("scholarship_dashboard_error_grid_title"))}</div>
    <div class="tbl-wrap"><table class="data-table"><thead><tr>
      <th>${esc(srT("scholarship_dashboard_th_id"))}</th>
      <th>${esc(srT("scholarship_dashboard_th_name"))}</th>
      <th>${esc(srT("scholarship_dashboard_error_grid_missing"))}</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}

function filterBarHtml(data) {
  const catOptions = data.categories
    .map(c => `<option value="${esc(c)}"${_state.category === c ? " selected" : ""}>${esc(c)}</option>`)
    .join("");
  return `<div id="scholarship-filter-bar" class="card" style="padding:12px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
    <input type="text" id="scholarship-search-input" placeholder="${esc(
      srT("scholarship_dashboard_search_placeholder")
    )}" value="${esc(_state.search)}" style="flex:1;min-width:180px" />
    <select id="scholarship-status-filter">
      <option value="all"${_state.status === "all" ? " selected" : ""}>${esc(srT("scholarship_dashboard_filter_status_all"))}</option>
      <option value="eligible"${_state.status === "eligible" ? " selected" : ""}>${esc(srT("scholarship_dashboard_status_eligible"))}</option>
      <option value="not_eligible"${_state.status === "not_eligible" ? " selected" : ""}>${esc(
    srT("scholarship_dashboard_status_not_eligible")
  )}</option>
    </select>
    <select id="scholarship-category-filter">
      <option value="all"${_state.category === "all" ? " selected" : ""}>${esc(srT("scholarship_dashboard_filter_category_all"))}</option>
      ${catOptions}
    </select>
  </div>`;
}

function tabsHtml(data) {
  // BUG FIX (flow redesign): all 4 tabs used to render regardless of
  // whether any student actually had complete data — so a freshly
  // downloaded-then-reuploaded template (no student has filled every
  // scholarship cell yet) showed "reports" that were either empty or,
  // pre-this-session, wrongly-eligible. Per the 3-scenario spec: until at
  // least one student has a fully complete row, ONLY Edit Data is
  // reachable — the other three are gated off, not just visually
  // secondary, so there's nothing misleading to click into.
  // Also requires the scheme itself to be configured (real eligibility
  // type + thresholds, not just quick-enable zero-defaults) — otherwise
  // a scheme with no real criteria would show every complete-data student
  // as "eligible / meets all criteria" the moment data-completeness alone
  // unlocked these tabs (the original enabled-but-not-configured bug,
  // scholarship-nav.js isSchemeConfigured()'s own header comment).
  const unlocked = !!(data && data.configured && data.split && data.split.complete && data.split.complete.length > 0);
  const tabs = [
    ["shortlist", "scholarship_dashboard_tab_shortlist"],
    ["category", "scholarship_dashboard_tab_by_category"],
    ["toppers", "scholarship_dashboard_tab_subject_toppers"],
    // Phase 2 Task 03: a 4th tab alongside the existing three (not a
    // replacement for any of them — those three render functions below
    // are untouched by this addition, per that task's own acceptance
    // criteria).
    ["edit", "scholarship_dashboard_tab_edit_data"]
  ];
  return `<div class="db-tabs" role="tablist" aria-label="${esc(srT("scholarship_dashboard_tabs_aria"))}" style="margin-bottom:12px">
    ${tabs
      .map(([id, key]) => {
        const locked = !unlocked && id !== "edit";
        const cls = "db-tab" + (_state.tab === id ? " active" : "") + (locked ? " db-tab-locked" : "");
        const attrs = locked
          ? `disabled title="${esc(srT("scholarship_tab_locked_hint"))}"`
          : `data-action="switchScholarshipTab" data-arg="${id}"`;
        return `<button class="${cls}" role="tab" aria-selected="${_state.tab === id}" aria-disabled="${locked}" ${attrs}>${esc(srT(key))}</button>`;
      })
      .join("")}
  </div>${
    unlocked
      ? ""
      : `<div class="scholarship-tab-lock-banner">${esc(srT("scholarship_tab_locked_banner"))}</div>`
  }`;
}

function applyShortlistFilters(rows) {
  const q = _state.search.trim().toLowerCase();
  return rows.filter(r => {
    if (_state.status === "eligible" && !r.eligible) return false;
    if (_state.status === "not_eligible" && r.eligible) return false;
    if (_state.category !== "all" && r.category !== _state.category) return false;
    if (q && !(String(r.studentId).toLowerCase().includes(q) || String(r.name).toLowerCase().includes(q))) return false;
    return true;
  });
}

// Exposed so the right rail's certificate roster (js/vs-shell.js
// renderScholarshipPropertiesRail()) can show/pre-check the same rows the
// on-screen Shortlist table currently shows — same filter fn, no
// duplicated filter logic. Deliberately keyed off the Shortlist tab's
// filters specifically (search/status/category), since that's the tab
// that has all three; By Category/Subject Toppers are narrower slices of
// the same idea and would only shrink this list further, never grow it.
function getScholarshipVisibleIds() {
  const data = computeScholarshipData();
  return applyShortlistFilters(data.shortlist).map(r => r.studentId);
}

function shortlistTableHtml(data) {
  const rows = applyShortlistFilters(data.shortlist).sort((a, b) => a.rank - b.rank);
  if (!rows.length) {
    return `<div class="bucket-empty-state"><div class="bucket-empty-sub">${esc(srT("scholarship_dashboard_no_rows"))}</div></div>`;
  }
  const body = rows
    .map(
      r => `<tr class="scholarship-row" data-action="openScholarshipStudentDetail" data-arg="${esc(r.studentId)}" style="cursor:pointer">
      <td>${r.rank}</td><td>${esc(r.studentId)}</td><td>${esc(r.name)}</td><td>${esc(r.category)}</td>
      <td>${r.weightedScore}</td><td>${statusBadgeHtml(r.eligible)}</td>
      <td style="font-size:11.5px;color:var(--c-text2)">${esc(reasonText(r.reasonCodes, r.actuals, data.schemeConfig))}</td>
    </tr>`
    )
    .join("");
  return `<div class="tbl-wrap"><table class="data-table"><thead><tr>
    <th>${esc(srT("scholarship_dashboard_th_rank"))}</th>
    <th>${esc(srT("scholarship_dashboard_th_id"))}</th>
    <th>${esc(srT("scholarship_dashboard_th_name"))}</th>
    <th>${esc(srT("scholarship_dashboard_th_category"))}</th>
    <th>${esc(srT("scholarship_dashboard_th_score"))}</th>
    <th>${esc(srT("scholarship_dashboard_th_status"))}</th>
    <th>${esc(srT("scholarship_dashboard_th_reason"))}</th>
  </tr></thead><tbody>${body}</tbody></table></div>`;
}

function byCategoryTableHtml(data) {
  let rows = data.byCategory;
  if (_state.category !== "all") rows = rows.filter(r => r.category === _state.category);
  const q = _state.search.trim().toLowerCase();
  if (q) rows = rows.filter(r => String(r.studentId).toLowerCase().includes(q) || String(r.name).toLowerCase().includes(q));
  if (_state.status === "eligible") rows = rows.filter(r => r.eligible);
  else if (_state.status === "not_eligible") rows = rows.filter(r => !r.eligible);
  rows = rows.slice().sort((a, b) => (a.category > b.category ? 1 : a.category < b.category ? -1 : a.rankWithinCategory - b.rankWithinCategory));
  if (!rows.length) {
    return `<div class="bucket-empty-state"><div class="bucket-empty-sub">${esc(srT("scholarship_dashboard_no_rows"))}</div></div>`;
  }
  const body = rows
    .map(
      r => `<tr><td>${esc(r.category)}</td><td>${r.rankWithinCategory}</td><td>${esc(r.studentId)}</td><td>${esc(r.name)}</td>
      <td>${r.weightedScore}</td><td>${statusBadgeHtml(r.eligible)}</td></tr>`
    )
    .join("");
  return `<div class="tbl-wrap"><table class="data-table"><thead><tr>
    <th>${esc(srT("scholarship_dashboard_th_category"))}</th>
    <th>${esc(srT("scholarship_dashboard_th_rank_in_category"))}</th>
    <th>${esc(srT("scholarship_dashboard_th_id"))}</th>
    <th>${esc(srT("scholarship_dashboard_th_name"))}</th>
    <th>${esc(srT("scholarship_dashboard_th_score"))}</th>
    <th>${esc(srT("scholarship_dashboard_th_status"))}</th>
  </tr></thead><tbody>${body}</tbody></table></div>`;
}

function subjectToppersTableHtml(data) {
  const subjects = APP.setup.subjects || [];
  let rows = data.subjectToppers;
  const q = _state.search.trim().toLowerCase();
  if (q) rows = rows.filter(r => String(r.studentId).toLowerCase().includes(q) || String(r.name).toLowerCase().includes(q));
  rows = rows.slice().sort((a, b) => a.overallRank - b.overallRank);
  if (!rows.length) {
    return `<div class="bucket-empty-state"><div class="bucket-empty-sub">${esc(srT("scholarship_dashboard_no_rows"))}</div></div>`;
  }
  const body = rows
    .map(
      r => `<tr><td>${r.overallRank}</td><td>${esc(r.studentId)}</td><td>${esc(r.name)}</td>
      ${subjects.map(s => `<td>${r[s] != null ? r[s] + "%" : "—"}</td>`).join("")}
      <td>${r.overallAcademicAvgPct}%</td></tr>`
    )
    .join("");
  return `<div class="tbl-wrap"><table class="data-table"><thead><tr>
    <th>${esc(srT("scholarship_dashboard_th_rank"))}</th>
    <th>${esc(srT("scholarship_dashboard_th_id"))}</th>
    <th>${esc(srT("scholarship_dashboard_th_name"))}</th>
    ${subjects.map(s => `<th>${esc(s)}</th>`).join("")}
    <th>${esc(srT("scholarship_dashboard_th_overall_avg"))}</th>
  </tr></thead><tbody>${body}</tbody></table></div>`;
}

function tabPanelHtml(data) {
  if (_state.tab === "category") return byCategoryTableHtml(data);
  if (_state.tab === "toppers") return subjectToppersTableHtml(data);
  return shortlistTableHtml(data);
}

// Search/status/category filters are only meaningful on Shortlist/By
// Category — Subject Toppers ignores status/category (§ Task 06 — that
// view is independent of eligibility entirely) but still honors the name/
// ID search box per this task's "ready for Task 11 wiring" search input.
// Phase 2 Task 03: the Edit Data tab is its own render path
// (renderScholarshipEditGrid(), scholarship-edit-grid.js) — it doesn't
// use computeScholarshipData()'s shortlist/category/toppers output at
// all, so it's branched off before that call rather than added as a
// 4th case inside tabPanelHtml() (which stays exactly as the other three
// tabs left it).
function renderTabPanelOnly() {
  const data = computeScholarshipData();
  const unlocked = data.configured && data.split.complete.length > 0;
  // Guard against a stale/forced state landing on a locked tab (e.g. the
  // scheme's last complete student's row was just edited back to
  // incomplete) — snap back to Edit Data rather than render a report tab
  // with nothing behind it.
  if (!unlocked && _state.tab !== "edit") _state.tab = "edit";
  $("#scholarship-tabs-wrap").html(tabsHtml(data));
  // The search/status/category filter bar and the "data missing" stat
  // card's error-grid toggle only apply to the three read-only report
  // tabs — Edit Data has no filtering concept, it always shows every
  // student (§37 — fixing an incomplete row and general editing are the
  // same one view). Hidden rather than removed so switching back needs
  // no rebuild.
  $("#scholarship-filter-bar").toggle(_state.tab !== "edit");
  if (_state.tab === "edit") {
    if (typeof window.renderScholarshipEditGrid === "function") window.renderScholarshipEditGrid();
    return;
  }
  $("#scholarship-table-panel").html(tabPanelHtml(data));
}

function renderScholarshipDashboard(initialTab) {
  const panel = document.getElementById("scholarship-enabled-placeholder");
  if (!panel) return;
  const data = computeScholarshipData();
  const unlocked = data.configured && data.split.complete.length > 0;
  // Land on Edit Data whenever the scheme isn't unlocked yet, regardless
  // of what initialTab asked for — there's nothing valid to show on the
  // other three tabs until at least one student's row is fully filled.
  _state.tab = !unlocked ? "edit" : initialTab === "edit" ? "edit" : "shortlist";
  _state.search = "";
  _state.status = "all";
  _state.category = "all";
  _state.showErrorGrid = false;
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px">
      <div class="card-title" style="margin:0">${esc(srT("scholarship_dashboard_title"))}</div>
    </div>
    ${statCardsHtml(data)}
    <div id="scholarship-error-grid-wrap">${errorGridHtml(data)}</div>
    ${filterBarHtml(data)}
    <div id="scholarship-tabs-wrap">${tabsHtml(data)}</div>
    <div id="scholarship-table-panel"></div>
  `;
  if (_state.tab === "edit") {
    $("#scholarship-filter-bar").hide();
    if (typeof window.renderScholarshipEditGrid === "function") window.renderScholarshipEditGrid();
  } else {
    $("#scholarship-table-panel").html(tabPanelHtml(data));
  }
}

function switchScholarshipTab(tab) {
  // BUG FIX: switchScholarshipTab was reachable from disabled tab buttons
  // via stale event bindings / direct calls — re-check the lock here too,
  // not just at render time, so nothing can jump to a locked tab.
  if (tab !== "edit") {
    const data = computeScholarshipData();
    if (!data.configured || data.split.complete.length === 0) {
      toast(srT("scholarship_tab_locked_toast"), "warn");
      return;
    }
  }
  _state.tab = tab;
  renderTabPanelOnly();
}

function toggleScholarshipErrorGrid() {
  _state.showErrorGrid = !_state.showErrorGrid;
  const data = computeScholarshipData();
  $("#scholarship-error-grid-wrap").html(errorGridHtml(data));
}

// The right rail's certificate roster mirrors whatever the Shortlist
// filters currently show (getScholarshipVisibleIds() above), so every
// filter change here also has to refresh that rail — not just the
// on-screen table — or the two would drift out of sync the moment a
// search/status/category filter changes.
function refreshScholarshipRailIfOpen() {
  if (typeof window.renderScholarshipPropertiesRail === "function") window.renderScholarshipPropertiesRail();
}

// BUG FIX (flow redesign): the tab-lock bar (#scholarship-tabs-wrap) lives
// outside renderScholarshipEditGrid()'s own DOM region, so a save that
// finally completes the first fully-filled student row updated
// APP.students but left the tabs looking locked until the next full
// panel/page visit. scholarship-edit-grid.js calls this right after a
// successful save so unlocking is immediate.
function refreshScholarshipTabsAfterDataChange() {
  const wrap = document.getElementById("scholarship-tabs-wrap");
  if (!wrap) return;
  const data = computeScholarshipData();
  wrap.innerHTML = tabsHtml(data);
  if ((!data.configured || data.split.complete.length === 0) && _state.tab !== "edit") {
    _state.tab = "edit";
    $("#scholarship-filter-bar").hide();
  }
}
if (typeof window !== "undefined") window.refreshScholarshipTabsAfterDataChange = refreshScholarshipTabsAfterDataChange;

function setScholarshipSearch(v) {
  _state.search = v || "";
  renderTabPanelOnly();
  refreshScholarshipRailIfOpen();
}

function setScholarshipStatusFilter(v) {
  _state.status = v || "all";
  renderTabPanelOnly();
  refreshScholarshipRailIfOpen();
}

function setScholarshipCategoryFilter(v) {
  _state.category = v || "all";
  renderTabPanelOnly();
  refreshScholarshipRailIfOpen();
}

// Row click → routes to Task 09's full detail breakdown. Task 09's view
// doesn't exist yet, so this stub confirms the click is wired (per this
// task's own §7 validation checklist) without dead-ending silently.
function openScholarshipStudentDetail(studentId) {
  if (typeof window.openScholarshipDetail === "function") {
    window.openScholarshipDetail(studentId);
    return;
  }
  toast(srT("scholarship_dashboard_detail_stub_toast"));
}

// Download click → hands off to Task 10's real file-generation function,
// imported directly now that Task 10 exists (the window.generateScholarshipReport
// lookup below is kept only as a defensive fallback in case some other
// surface reassigns it, matching the loose-coupling this stub originally
// documented).
function downloadScholarshipReport() {
  const fn = typeof window.generateScholarshipReport === "function" ? window.generateScholarshipReport : generateScholarshipReport;
  fn(computeScholarshipData(), _state.category);
}

export {
  buildSchemeConfig,
  computeScholarshipData,
  downloadScholarshipReport,
  getScholarshipVisibleIds,
  openScholarshipStudentDetail,
  renderScholarshipDashboard,
  setScholarshipCategoryFilter,
  setScholarshipSearch,
  setScholarshipStatusFilter,
  switchScholarshipTab,
  toggleScholarshipErrorGrid
};

if (typeof window !== "undefined") {
  window.renderScholarshipDashboard = renderScholarshipDashboard;
  window.switchScholarshipTab = switchScholarshipTab;
  window.toggleScholarshipErrorGrid = toggleScholarshipErrorGrid;
  window.setScholarshipSearch = setScholarshipSearch;
  window.setScholarshipStatusFilter = setScholarshipStatusFilter;
  window.setScholarshipCategoryFilter = setScholarshipCategoryFilter;
  window.openScholarshipStudentDetail = openScholarshipStudentDetail;
  window.downloadScholarshipReport = downloadScholarshipReport;
}
