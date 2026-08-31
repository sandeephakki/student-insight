import { esc, showScreen } from '../../core/app-utils-init.js';
import { isFeatureOn } from '../../core/feature-registry.js';
import { buildFeatureLockedHtml } from './feature-locked-modal.js';
import { getStudentContinuityContext } from '../../bal/common/compute-continuity.js';
import { sleep } from '../../bal/common/compute-stats.js';
import { renderContinuityBucket } from './continuity-dashboard.js';
import { startNewSession } from '../../core/project-setup.js';
import { buildStudentHealthScoreHtml, buildStudentKpiBottomGridHtml, buildStudentKpiStripHtml, buildStudentKpiTopGridHtml, buildStudentScoreTableHtml, populateIndividualSwitcher, renderBucketStudentTrendChart, renderBucketSubjectDistChart, renderDashboard, updateExportGate } from './render-core.js';
import { renderClusterGroups, renderFilteredList, renderStudentPicker, renderSubjectPicker } from './render-findings.js';
import { generateHomePlan, generateParentMessage, generateSchoolPlan, generateTrendFacts, generateWhatChangedSummary, i18nLabel, shareInsightAsImage, srT } from '../../core/render-i18n.js';
import { APP, goStep } from '../../core/state-nav.js';
import { renderExportPropertiesRail, renderShellLeftRail, renderShellRightRail, setRightRail, setShellRailOpen, setShellRailsOpen } from '../../core/vs-shell.js';

/* ════════════════════════════════════════════════════════════════════
   RENDER-BUCKETS — bucket list rendering (at-risk/top/etc), dashboard
   control rail, individual-student dashboard buckets, Smart Query
   chat UI (chat bubbles, canned questions, submit/run).
   Split out of the former render-dashboard.js (review #5) — pure move,
   no logic changed.
   ════════════════════════════════════════════════════════════════════ */
const BUCKET_HELP_FLAG_TYPES=["at-risk","first-below-pass","declining","sharp-drop","absent","volatile","burnout","data-gap","plateau","peer-outlier-low"];
const BUCKET_TOP_FLAG_TYPES=["improving","resilient","peer-outlier-high"];

function bucketIsHelp(st){
  if((st.flags||[]).some(f=>BUCKET_HELP_FLAG_TYPES.includes(f.type)))return true;
  if(st.analysis&&st.analysis.wellbeingFlag&&st.analysis.wellbeingFlag!=="low")return true;
  if(st.analysis&&st.analysis.rankMovement<0)return true;
  return false;
}
function bucketIsTop(st){
  if(st.analysis&&st.analysis.rank<=3)return true;
  if((st.flags||[]).some(f=>BUCKET_TOP_FLAG_TYPES.includes(f.type)))return true;
  if(st.analysis&&st.analysis.competitiveReadiness==="High")return true;
  if(st.analysis&&st.analysis.rankMovement>0)return true;
  return false;
}

async function renderBuckets(){
  updateExportGate(); // EXPORT_GATE invariant: re-derive every time the Dashboard step is entered, same as renderDashboard() does — buckets is now an alternate entry point, not a replacement for the gate check.
  // See render-core.js renderDashboard() — one child per workbook is now
  // enforced at import, so this only ever shows for a pre-existing file
  // saved before that rule and never re-exported since.
  $("#individual-student-switcher").css("display", (APP.setup.mode==="individual"&&APP.students.length>1) ? "flex" : "none");
  if(APP.compareMode){
    const { selectCompareGroup, selectCompareSection } = await import('../../bal/compare/compute-compare.js');
    $("#bucket-screen,#bucket-list-screen").hide();
    $("#panel-export").hide();
    // v4.24-compare-mode-default: fresh entry now defaults to the Compare
    // group view (side-by-side ranking) when a matching group of 2+
    // sections exists — that's the whole point of uploading multiple
    // files for Compare. Falls back to the first valid section only when
    // nothing matched (singleton uploads). Re-entry (leaving to Setup and
    // coming back) still restores whichever section/group was last
    // active, unchanged.
    const stillActiveGroup=APP._activeCompareGroupId && (APP.compareGroups||[]).some(g=>g.id===APP._activeCompareGroupId&&g.sections.length>=2);
    if(stillActiveGroup && APP.sectionComparison && APP.sectionComparison.length){
      selectCompareGroup(APP._activeCompareGroupId);
    } else {
      const validSecs=(APP.sections||[]).filter(s=>s.valid&&s.students);
      const stillValidSection=APP._activeCompareSectionId && validSecs.some(s=>s.id===APP._activeCompareSectionId);
      if(stillValidSection){
        selectCompareSection(APP._activeCompareSectionId);
      } else {
        const firstGroup=(APP.compareGroups||[]).find(g=>g.sections.length>=2);
        if(firstGroup) selectCompareGroup(firstGroup.id);
        else{
          const targetId=validSecs[0]&&validSecs[0].id;
          if(targetId) selectCompareSection(targetId);
        }
      }
    }
    return;
  }
  // FEEDBACK #6 (UI bugs, item 6): the old KPI/cards/heatmap/wellbeing
  // dashboard is still fully implemented (renderDashboard() and friends) —
  // Compare Mode and Individual mode still use it directly (branches
  // above). The former "Classic Dashboard" manual toggle for Institution+
  // non-Compare mode is retired — prompt-v4.20 §1ii/§1iv removed its only
  // trigger (#btn-classic-dashboard), so there is exactly one view for
  // that combination now: the rail-driven bucket screen below.
  // v4.21-individual-mode-shell-parity §3: Individual mode now migrates
  // onto the same persistent-center pattern Institution mode already
  // uses — #bucket-answer-screen stays up, openIndividualBucket() just
  // re-populates it in place, instead of the old #bucket-screen (full
  // tile grid) → #bucket-answer-screen two-level swap. "report" (Progress
  // Report) is the default landing bucket — the closest analog to
  // Institution's "class" default (richest, most-summary view).
  if(APP.setup.mode==="individual"){
    populateIndividualSwitcher();
    $("#bucket-screen,#bucket-list-screen").hide();
    $("#legacy-dashboard-body").hide();
    $("#panel-export").hide();
    $("#bucket-answer-screen").show();
    if(typeof setShellRailsOpen==="function") setShellRailsOpen(true);
    openIndividualBucket(window._individualBucketCurrent||"report");
    return;
  }
  // ui-prompt-template.md item 7: rail-driven, in-place Dashboard for
  // Institution + non-Compare mode (per PIB §9 smart-reveal-scope — Compare
  // mode keeps its own separate branch above, unchanged. Individual mode
  // used to be a second unchanged early-return here too, but is now
  // migrated onto this identical pattern by its own branch above —
  // v4.21-individual-mode-shell-parity — just with a different bucket set
  // via buildIndividualDashboardControlsHtml() instead of
  // buildDashboardControlsHtml()). #bucket-screen and #bucket-list-screen
  // are retired for both modes now — left empty/hidden —
  // #bucket-answer-screen is now the single, persistent, always-visible
  // center content area; the old full-screen bucket-grid moved to the left
  // rail (buildDashboardControlsHtml(), called from renderShellLeftRail()),
  // and the student/subject/help/Smart-Search pickers moved to the right
  // rail (renderDashboardPropertiesRail(), called from renderShellRightRail()).
  $("#bucket-screen,#bucket-list-screen").hide();
  $("#legacy-dashboard-body").hide();
  $("#bucket-answer-screen").show();
  // ui-prompt-batch2.md item 1: Smart (bucket) Dashboard, general — rails
  // open. Also covers "reopen automatically when switching back from
  // Classic to Smart," since this is the same code path either way.
  if(typeof setShellRailsOpen==="function") setShellRailsOpen(true);
  openBucket(APP._currentBucketId || "class");
}

// Icon set + control list shared by the left rail (buildDashboardControlsHtml,
// js/vs-shell.js calls this) and, historically, the old #bucket-screen card
// grid this replaced. badge counts (helpCount/topCount/cluster count) are
// computed fresh every call — same values renderBuckets() always used, not a
// new computation.
const DASHBOARD_CONTROL_ICONS={
  class:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>',
  student:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 21a8 8 0 1 0-16 0"/><circle cx="12" cy="8" r="4"/></svg>',
  subject:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  help:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0z"/></svg>',
  top:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4a2 2 0 0 0 2 2"/><path d="M17 6h3a2 2 0 0 1-2 2"/></svg>',
  compare:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 3v18"/><path d="M16 3v18"/><path d="M3 8h5"/><path d="M16 8h5"/><path d="M3 16h5"/><path d="M16 16h5"/></svg>',
  clusters:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/></svg>',
  continuity:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/></svg>',
  smart:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>',
  export:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3.3 8.5l8.7 4.5 8.7-4.5"/><path d="M12 22V13"/></svg>',
  // Same star glyph as the (now-hidden) top-nav Scholarship tab —
  // this rail row is the sole entry point into it now.
  scholarship:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1z"/></svg>'
};
// SHARED BUCKET DEFINITION TABLE — single source of truth for every
// left-rail bucket across BOTH Institution and Individual mode. This is
// the "bucket-rail shared source of truth" fix: previously
// buildDashboardControlsHtml() (Institution) and individualBucketDefs()
// (Individual) each hand-wrote their own bucket list with no shared
// data, which is exactly how "Smart Search" once leaked into Individual
// mode — it was simply never excluded by hand in one of the two places,
// nothing structurally prevented it. Now every bucket's id/label/desc is
// defined ONCE here with an explicit `modes` tag, and both render
// functions below filter this table instead of listing buckets by hand
// — a bucket can only appear in a mode it's explicitly tagged for.
// Institution-only concerns (badge counts, extra visibility gates like
// "only show Clusters if cohortClusters exist") stay in
// buildDashboardControlsHtml() itself, layered on top of this table,
// since those depend on live app state this table shouldn't own.
const BUCKET_DEFS=[
  {id:"class",modes:["institution"],labelKey:"bucket_class_label",descKey:"bucket_class_desc"},
  {id:"student",modes:["institution"],labelKey:"bucket_student_label",descKey:"bucket_student_desc"},
  {id:"subject",modes:["institution"],labelKey:"bucket_subject_label",descKey:"bucket_subject_desc"},
  {id:"help",modes:["institution"],labelKey:"bucket_help_label",descKey:"bucket_help_desc"},
  {id:"top",modes:["institution"],labelKey:"bucket_top_label",descKey:"bucket_top_desc"},
  {id:"compare",modes:["institution"],labelKey:"bucket_compare_label",descKey:"bucket_compare_desc"},
  {id:"clusters",modes:["institution"],labelKey:"bucket_clusters_label",descKey:"bucket_clusters_desc"},
  {id:"continuity",modes:["institution"],labelKey:"bucket_continuity_label",descKey:"bucket_continuity_desc"},
  // Deliberately institution-only — see the removal note that used to
  // live on individualBucketDefs(): a single already-fully-visible child
  // has nothing extra for a free-text "search across students" to offer.
  {id:"smart",modes:["institution"],labelKey:"bucket_smart_label",descKey:"bucket_smart_desc"},
  // Left-rail entry point for the Scholarship panel (formerly its own
  // top-nav tab, data-step="scholarship" — that tab is now permanently
  // hidden in CSS and this row is the only way in). Not a real "bucket"
  // (no sub-list inside #panel-dashboard) — action/arg below route it
  // straight to goStep("scholarship") instead of openBucket.
  {id:"scholarship",modes:["institution"],labelKey:"bucket_scholarship_label",descKey:"bucket_scholarship_desc"},
  {id:"export",modes:["institution"],labelKey:"bucket_export_label",descKey:"bucket_export_desc"},
  {id:"report",modes:["individual"],labelKey:"individual_bucket_report_label",descKey:"individual_bucket_report_desc"},
  {id:"subjects",modes:["individual"],labelKey:"individual_bucket_subjects_label",descKey:"individual_bucket_subjects_desc"},
  {id:"plan",modes:["individual"],labelKey:"individual_bucket_plan_label",descKey:"individual_bucket_plan_desc"},
  {id:"wellbeing",modes:["individual"],labelKey:"individual_bucket_wellbeing_label",descKey:"individual_bucket_wellbeing_desc"},
];
function bucketDefsForMode(mode){
  return BUCKET_DEFS.filter(b=>b.modes.includes(mode)).map(b=>({id:b.id,label:srT(b.labelKey),desc:srT(b.descKey)}));
}
// item 7g/h (OPEN QUESTION, confirmed by user: one merged list): "Smart
// Search" is listed here as an ordinary control alongside the others.
// v4.23-smart-query-chat: its center-panel answer is now a real chat
// window wired to SmartQueryV2.ask() (renderDashboardSmartSearch()/
// smartChatSubmit()/smartChatRunQuery() below), and its canned-question
// list moved into the LEFT rail (buildSmartQueryCannedQuestionsHtml(),
// appended by renderShellLeftRail() when this bucket is active) — not the
// right rail, which now closes for this bucket like the other
// no-per-item-picker buckets.
function buildDashboardControlsHtml(){
  const students=APP.students||[];
  const helpCount=students.filter(bucketIsHelp).length;
  const topCount=students.filter(bucketIsTop).length;
  const defs=bucketDefsForMode("institution");
  const byId=Object.fromEntries(defs.map(d=>[d.id,d]));
  const buckets=[
    {...byId.class,badge:null},
    {...byId.student,badge:null},
    {...byId.subject,badge:null},
    {...byId.help,badge:helpCount},
    {...byId.top,badge:topCount}
  ];
  if(APP.features.compare!=="off"){
    buckets.push({...byId.compare,badge:null});
  }
  if(APP.cohortClusters&&APP.cohortClusters.groups&&APP.cohortClusters.groups.length){
    buckets.push({...byId.clusters,badge:APP.cohortClusters.groups.length});
  }
  // prompt-03-cohort-dashboard-ui.md: new rail entry, ONLY when the
  // loaded file has more than one period. APP.setup.periodCount is not
  // set by anything yet (real N-period SETUP parsing wasn't built — see
  // PIB §9 continuity-schema-not-built-yet), so in real usage this stays
  // off until that lands; this gate is what will make it appear once it
  // does, without needing to touch this file again.
  if(APP.setup&&APP.setup.periodCount>1){
    buckets.push({...byId.continuity,badge:null});
  }
  if(APP.features.smartSearch!=="off"){
    buckets.push({...byId.smart,badge:null});
  }
  // Below Smart Search, above Export — routes to goStep("scholarship")
  // rather than openBucket() (see BUCKET_DEFS comment above).
  if(APP.features.scholarship!=="off"){
    buckets.push({...byId.scholarship,badge:null,action:"goStep",arg:"scholarship"});
  }
  if(APP.features.reports!=="off"){
    buckets.push({...byId.export,badge:null});
  }
  const active=(APP.currentStep==="scholarship")?"scholarship":(APP._currentBucketId||"class");
  const rows=buckets.map(b=>{
    const badgeHtml=(b.badge!==null)?`<span class="bucket-badge">${esc(srT("bucket_count_badge",{count:b.badge},b.badge))}</span>`:"";
    const activeClass=(!APP._forceLegacyView && b.id===active)?" bucket-row-active":"";
    return `<div class="bucket-row${activeClass}" role="button" tabindex="0" data-action="${b.action||"openBucket"}" data-arg="${b.arg||b.id}">
      <span class="bucket-icon" aria-hidden="true">${DASHBOARD_CONTROL_ICONS[b.id]}</span>
      <span class="bucket-text"><span class="bucket-label">${esc(b.label)}</span><span class="bucket-desc">${esc(b.desc)}</span></span>
      ${badgeHtml}
    </div>`;
  }).join("");
  return `<div class="bucket-list">${rows}</div>`;
}
const COMPARE_ROW_ICONS={
  section:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21V15h6v6"/><path d="M9 7h1M9 11h1M14 7h1M14 11h1"/></svg>',
  group:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/></svg>',
  crossCompare:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="7" cy="12" r="4"/><circle cx="17" cy="12" r="4"/></svg>'
};
// v4.22-compare-mode-shell-parity §1: replaces #compare-section-picker's
// inline dropdown — same data populateCompareSectionPicker() used to
// assemble (every valid section, plus one row per computeCompareGroups()
// match of 2+ sections), same .bucket-list/.bucket-row markup as every
// other rail list in the app. Active row keyed off APP._activeCompareSectionId
// (a section) or a null value while APP.sectionComparison is populated
// (viewing the "Compare Sections" group view instead).
function buildCompareSectionListHtml(){
  const secs=(APP.sections||[]).filter(s=>s.valid&&s.students);
  const groups=(APP.compareGroups||[]).filter(g=>g.sections.length>=2);
  const activeSectionId=APP._activeCompareSectionId||null;
  const viewingGroup=!activeSectionId && APP.sectionComparison && APP.sectionComparison.length;
  const groupRows=groups.map(g=>{
    const activeClass=(viewingGroup && APP._activeCompareGroupId===g.id)?" bucket-row-active":"";
    const label="Compare: "+g.sections.map(s=>s.label).join(", ");
    return `<div class="bucket-row${activeClass}" role="button" tabindex="0" data-action="selectCompareGroup" data-arg="${esc(g.id)}">
      <span class="bucket-icon" aria-hidden="true">${COMPARE_ROW_ICONS.group}</span>
      <span class="bucket-text"><span class="bucket-label">${esc(label)}</span><span class="bucket-desc">${g.sections.length} sections, side-by-side ranking</span></span>
    </div>`;
  }).join("");
  // Per-section rows removed (compare-left-panel-simplify): rail now shows
  // only compare-related entries (group rows + cross-compare), not one row
  // per individual class/section — kept the rail focused on comparison,
  // not class browsing. selectCompareSection()/COMPARE_ROW_ICONS.section
  // are unused by this list now but left in place — still called
  // programmatically by renderBuckets()'s auto-select fallback above.
  // Cross-section student compare — only worth offering once there are at
  // least 2 analysed sections to pick from (same or different groups; it
  // doesn't require a matching-schema group like the ranking table above).
  // Placed right below the "Compare: ..." group row(s) and above the
  // individual per-section rows — it's a comparison view like the group
  // row above it, not a single-section dashboard like the rows below it.
  const crossCompareRow=secs.length>=2?`<div class="bucket-row${APP._viewingCrossCompare?" bucket-row-active":""}" role="button" tabindex="0" data-action="openCrossSectionCompare">
      <span class="bucket-icon" aria-hidden="true">${COMPARE_ROW_ICONS.crossCompare}</span>
      <span class="bucket-text"><span class="bucket-label">${esc(srT("bucket_cross_compare_title"))}</span><span class="bucket-desc">${esc(srT("bucket_cross_compare_desc"))}</span></span>
    </div>`:"";
  return `<div class="bucket-list">${groupRows}${crossCompareRow}</div>`;
}
// Classic/Smart toggle retired (prompt-v4.20 §1ii/§1iv) — showLegacyDashboard()/
// showSmartBucketView() no longer have any caller (both used APP._forceLegacyView,
// which is now permanently false). Left undefined rather than kept-as-dead-code:
// nothing else in the app reads or calls them.

/* ── INDIVIDUAL/PARENT MODE BUCKETS ──
   Extends the same progressive-disclosure pattern used for Institution
   mode to Individual/Parent mode, instead of falling through to the older
   tile/tab body — per explicit design direction ("dashboard to smart
   search vice versa should be same theme and flawless... you decide").
   Reuses the SAME .bucket-list/.bucket-row/.bucket-answer-title CSS
   classes (visual consistency, zero new styles) and the SAME real
   narrative generators already used elsewhere (generateParentMessage,
   generateHomePlan, generateTrendFacts) — no fabricated content, this is
   the same data the old Individual-mode legacy body showed, just entered
   through one tap instead of shown all at once. generateSchoolPlan is
   intentionally NOT used here — it's teacher-facing guidance, not
   appropriate for a parent/individual-aspirant audience (see its own
   comment in generateSchoolPlan()). Two-level flow (list -> answer),
   simpler than Institution's three-level flow, since there's no
   "which student" picker step — the child-switcher above already
   selects that. ── */
function currentIndividualStudent(){
  const sts=APP.students||[];
  if(!sts.length) return null;
  if(!APP.individualSelectedId||!sts.find(s=>s.id===APP.individualSelectedId)) APP.individualSelectedId=sts[0].id;
  return sts.find(s=>s.id===APP.individualSelectedId)||sts[0];
}
const INDIVIDUAL_BUCKET_ICONS={
  report:'<svg class="ic" width="1.4em" height="1.4em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
  subjects:'<svg class="ic" width="1.4em" height="1.4em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  plan:'<svg class="ic" width="1.4em" height="1.4em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  wellbeing:'<svg class="ic" width="1.4em" height="1.4em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  smart:'<svg class="ic" width="1.4em" height="1.4em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>'
};
// Pure — returns Individual mode's bucket definitions for the given
// (already-resolved) current child, no DOM access. Single source of
// truth for both the rail builder below and anything else that needs
// to know what buckets exist for this child (e.g. picking a default id).
function individualBucketDefs(st){
  const defs=bucketDefsForMode("individual");
  const byId=Object.fromEntries(defs.map(d=>[d.id,d]));
  const buckets=[byId.report,byId.subjects,byId.plan];
  if(st && st.analysis && st.analysis.wellbeingFlag){
    buckets.push(byId.wellbeing);
  }
  // Smart Search is tagged institution-only in BUCKET_DEFS above (shared
  // source of truth) — nothing to exclude by hand here anymore, it's
  // structurally not in bucketDefsForMode("individual")'s output at all.
  return buckets;
}
// v4.21-individual-mode-shell-parity §1: left-rail builder for Individual
// mode, mirroring buildDashboardControlsHtml() exactly (same .bucket-list/
// .bucket-row/icon/badge/active-highlight markup) — Institution mode and
// Individual mode's bucket lists now look and behave identically, just
// built from a different bucket set and a different "current id" tracker
// (window._individualBucketCurrent instead of APP._currentBucketId).
function buildIndividualDashboardControlsHtml(){
  const st=currentIndividualStudent();
  if(!st) return `<div class="bucket-list"><div class="bucket-row" style="cursor:default"><span class="bucket-text"><span class="bucket-label">No student data yet</span></span></div></div>`;
  const buckets=individualBucketDefs(st);
  const active=window._individualBucketCurrent||"report";
  const rows=buckets.map(b=>{
    const activeClass=(b.id===active)?" bucket-row-active":"";
    return `<div class="bucket-row${activeClass}" role="button" tabindex="0" data-action="openIndividualBucket" data-arg="${b.id}">
      <span class="bucket-icon" aria-hidden="true">${INDIVIDUAL_BUCKET_ICONS[b.id]}</span>
      <span class="bucket-text"><span class="bucket-label">${esc(b.label)}</span><span class="bucket-desc">${esc(b.desc)}</span></span>
    </div>`;
  }).join("");
  return `<div class="bucket-list">${rows}</div>`;
}
function openIndividualBucket(id){
  const st=currentIndividualStudent();
  if(!st) return;
  window._individualBucketCurrent=id;
  // Same dead-end fix as openBucket() above: the left rail's Individual-
  // mode bucket list can now also show while on the Scholarship step, but
  // this function only ever touches elements inside #panel-dashboard.
  // Route through goStep("dashboard") first when arriving from anywhere
  // else, so the top-level panel actually switches back; its dashboard
  // branch re-enters here via renderBuckets() -> openIndividualBucket()
  // using window._individualBucketCurrent set just above.
  if(APP.currentStep!=="dashboard"){
    if(typeof goStep==="function") goStep("dashboard");
    return;
  }
  // v4.21 §5: same active-row refresh pattern Institution's openBucket()
  // already has, so the left-rail bucket list (now where the picker
  // actually lives, §1/§2) highlights whichever bucket is open.
  try{
    if(typeof renderShellLeftRail==="function") renderShellLeftRail("dashboard");
  }catch(err){
    console.error("Shell left-rail refresh failed in openIndividualBucket:",id,err);
  }
  // v4.21 §4: none of Individual mode's four buckets have a per-item
  // picker (the child switcher above already narrows to one student, so
  // there's nothing left to pick inside a bucket) — close the right rail
  // for all four, same "no properties" pattern Institution's picker-less
  // buckets (Compare/Clusters/Top) already use.
  if(typeof setRightRail==="function") setRightRail("");
  if(typeof setShellRailOpen==="function") setShellRailOpen("end", false);
  if(id==="report") return renderIndividualReportAnswer(st);
  if(id==="subjects") return renderIndividualSubjectsAnswer(st);
  if(id==="plan") return renderIndividualPlanAnswer(st);
  if(id==="wellbeing") return renderIndividualWellbeingAnswer(st);
  if(id==="smart") return renderDashboardSmartSearch();
}
// backToIndividualBuckets() removed — it was a deliberate v4.21 no-op kept
// only as a safety net for old inline onclick="" markup that might still
// reference it. The Issue-1 CSP fix (all inline handlers replaced with
// data-*-action delegated wiring) and a dom-smoke pass covering every
// clickable element with 0 unrecognized actions confirmed nothing calls
// it anymore, so it's gone rather than kept as permanent dead weight.
function renderIndividualReportAnswer(st){
  const a=st.analysis||{};
  const validTestCount=(a.testAvgs||[]).filter(v=>v!==null&&v!==undefined).length;
  const hasTrend=validTestCount>=2;
  // Only the actual "Progress Trend" line chart belongs here — it's the one
  // thing this screen shows that nowhere else does. The single-test
  // fallback used to swap in a "Subject Breakdown" bar chart, but that's
  // the exact same chart the "Subjects & Marks" bucket already renders
  // (renderIndividualSubjectsAnswer below) — showing it here too just
  // duplicated it across two screens for no added information. With <2
  // tests there's nothing trend-specific to show yet, so this screen
  // simply omits the chart and leans on the "one test so far" banner
  // already below to point at what unlocks it.
  const nextTestPrompt=hasTrend?"":`<div class="card" style="padding:12px 16px;margin-top:14px;background:var(--c-primary-soft);border-color:var(--c-primary)">
    <div style="font-size:12.5px;color:var(--c-text)"><strong>One test so far.</strong> Add the next test's marks (Setup → Update Existing Template) to unlock progress trend, next-test prediction, and consistency scoring — all set up already, just waiting on more data.</div>
  </div>`;
  // Requested fixed order for Individual mode's Progress Report: title,
  // sub, top KPI grid-4, score table, health score, bottom KPI grid-4
  // (consistency/growth/engagement/ew). buildStudentKpiStripHtml() (still
  // used as-is by Institution mode's buildStudentDetailHtml) bundles all
  // three of those pieces together with no gap for the table in between,
  // so here they're called individually via the split-out
  // buildStudentKpiTopGridHtml/buildStudentHealthScoreHtml/
  // buildStudentKpiBottomGridHtml instead. The narrative paragraphs
  // (parent message / what-changed / trend facts) that used to sit here
  // now live in the Recommendations bucket below, next to the "what to
  // focus on" guidance they actually pair with.
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">Progress Report — ${esc(st.name)}</div>
    <div class="bucket-answer-sub">Overall: ${esc(String(a.overallAvg))}% · Grade ${esc(a.grade||"-")} · Trend: ${esc(a.trend||"-")}</div>
    ${buildStudentKpiTopGridHtml(st)}
    ${buildStudentScoreTableHtml(st)}
    ${buildStudentHealthScoreHtml(st)}
    ${buildStudentKpiBottomGridHtml(st)}
    ${hasTrend?`<div class="chart-container" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="card-title">Progress Trend</div>
        <button class="btn btn-secondary btn-sm" data-action="shareInsightAsImage" data-arg="${esc(st.id)}"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M12 15V3'/><path d='M7 8l5-5 5 5'/><path d='M4 21h16'/></svg> Share as Image</button>
      </div>
      <canvas id="bucket-chart-student-trend"></canvas>
    </div>`:""}
    ${nextTestPrompt}
    <div class="card" id="target-score-card" style="padding:14px 16px;margin-top:14px"></div>
  `).addClass("screen-fade-in").show();
  if(hasTrend){
    renderBucketStudentTrendChart("bucket-chart-student-trend",st);
  }
  renderTargetScoreCard(st.id);
}
// TASK (Project Bible v2 §5, "target-score tracker"): "Let a parent type
// a target % for the next test; show gap vs. predictedNext. Pure UI
// state (in-memory only, resets on reload per NO_PERSISTENCE) — no
// schema change." _targetScoreInputs deliberately lives only as a plain
// module-level variable — never written to APP.setup, st.analysis, or
// anything else that gets read/exported anywhere — so it satisfies
// NO_PERSISTENCE by construction: a page reload (or even just re-running
// analysis) wipes it, same as any other unsaved browser state.
let _targetScoreInputs={};
function renderTargetScoreCard(studentId){
  const st=APP.students.find(s=>s.id===studentId);if(!st)return;
  const a=st.analysis||{};
  const savedTarget=_targetScoreInputs[studentId];
  const html=`<div class="card-title" style="margin-bottom:8px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><circle cx='12' cy='12' r='10'/><circle cx='12' cy='12' r='6'/><circle cx='12' cy='12' r='2'/></svg> Target for Next Test</div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <label style="font-size:12.5px;color:var(--c-text2)">Target %</label>
      <input type="number" id="target-score-input" min="0" max="100" step="1" value="${savedTarget!=null?savedTarget:""}" placeholder="e.g. 85" style="width:80px;text-align:center;padding:6px 8px;border:1px solid var(--c-border);border-radius:var(--r-sm);font-size:13px" data-input-action="setTargetScore" data-arg="${esc(studentId)}"/>
    </div>
    <div id="target-score-gap" style="margin-top:10px"></div>
    <div style="font-size:11px;color:var(--c-text3);margin-top:8px">This target is just for you to plan around — it isn't saved anywhere and resets if you reload or re-analyse.</div>`;
  $("#target-score-card").html(html);
  renderTargetScoreGap(studentId);
}
function setTargetScore(studentId,val){
  const n=parseFloat(val);
  if(val===""||isNaN(n)){delete _targetScoreInputs[studentId];}
  else{_targetScoreInputs[studentId]=Math.max(0,Math.min(100,n));}
  renderTargetScoreGap(studentId);
}
function renderTargetScoreGap(studentId){
  const st=APP.students.find(s=>s.id===studentId);if(!st)return;
  const a=st.analysis||{};
  const target=_targetScoreInputs[studentId];
  const el=$("#target-score-gap");
  if(target==null){el.html("");return;}
  if(a.predictedNext==null){
    el.html(`<div style="font-size:12.5px;color:var(--c-text3)">Not enough test history yet to project a next-test score (need at least 2 tests) — so there's nothing to compare your target against yet.</div>`);
    return;
  }
  const gap=Math.round((target-a.predictedNext)*10)/10;
  if(gap<=0){
    el.html(`<div style="padding:10px 12px;background:var(--c-success)18;border-radius:var(--r-sm);font-size:12.5px;color:var(--c-success);font-weight:600">On track — the current trend projects ${a.predictedNext}%, already at or above your ${target}% target.</div>`);
  }else{
    const severity=gap>15?"var(--c-danger)":"var(--c-warn)";
    el.html(`<div style="padding:10px 12px;background:${severity}18;border-radius:var(--r-sm);font-size:12.5px;color:${severity};font-weight:600">The current trend projects ${a.predictedNext}% — ${gap} point${gap===1?"":"s"} short of your ${target}% target.</div>`);
  }
}
function renderIndividualSubjectsAnswer(st){
  const avgs=(st.analysis&&st.analysis.subjectAvgs)||{};
  const rows=Object.entries(avgs).sort((a,b)=>a[1]-b[1]).map(([subj,val])=>`<div class="subject-row"><span>${esc(subj)}</span><span>${esc(String(val))}%</span></div>`).join("");
  const validTestCount=((st.analysis&&st.analysis.testAvgs)||[]).filter(v=>v!==null&&v!==undefined).length;
  const hasTrend=validTestCount>=2;
  const chartTitle=hasTrend?"Progress Trend":"Subject Breakdown";
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">Subjects & Marks — ${esc(st.name)}</div>
    <div class="bucket-answer-body">
      <div class="subject-row-list">${rows||"<p>No subject data available yet.</p>"}</div>
    </div>
    <div class="chart-container" style="margin-top:14px"><div class="card-title">${esc(chartTitle)}</div><canvas id="bucket-chart-student-trend2"></canvas></div>
  `).addClass("screen-fade-in").show();
  if(hasTrend){
    renderBucketStudentTrendChart("bucket-chart-student-trend2",st);
  } else {
    const distRows=Object.entries(avgs).map(([subj,val])=>({name:subj,avg:val})).sort((x,y)=>x.avg-y.avg);
    renderBucketSubjectDistChart("bucket-chart-student-trend2",distRows);
  }
}
function renderIndividualPlanAnswer(st){
  // The parent-message / what-changed / trend-facts narrative used to sit
  // in the Progress Report screen (bucket-answer-body there), but it reads
  // as "here's what to think about" — a better fit next to the Recommendations
  // bucket's own "what to focus on" guidance than sandwiched between the
  // Progress Report's score table and its charts.
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">Recommendations — ${esc(st.name)}</div>
    <div class="bucket-answer-body">
      <p>${esc(generateParentMessage(st,getStudentContinuityContext(st.id)))}</p>
      <p>${esc(generateWhatChangedSummary(st,getStudentContinuityContext(st.id)))}</p>
      <p>${esc(generateTrendFacts(st,getStudentContinuityContext(st.id)))}</p>
      <p>${esc(generateHomePlan(st,getStudentContinuityContext(st.id)))}</p>
    </div>
  `).addClass("screen-fade-in").show();
}
function renderIndividualWellbeingAnswer(st){
  const a=st.analysis||{};
  const note = a.wellbeingFlag==="high" ? srT("smart_worth_supportive_conv") :
               a.wellbeingFlag==="moderate" ? srT("smart_keep_an_eye") :
               srT("smart_no_particular_concern");
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">${esc(srT("bucket_wellbeing_title",{name:st.name}))}</div>
    <div class="bucket-answer-body"><p>${esc(srT("bucket_wellbeing_flag_line",{flag:a.wellbeingFlag,score:String(a.stressScore)}))} ${esc(note)}</p></div>
  `).addClass("screen-fade-in").show();
}

// item f: sample-data banner, text only — no "Set Up My Own Class" button
// (that button called startNewSession(), which had an undiagnosed bug that
// could break the app from this context; removing the button made root-
// causing it moot — the same action is always reachable from Home anyway).
function renderDashboardSampleBanner(){
  const el=$("#dashboard-sample-banner");
  if(!APP._isSampleData){ el.html(""); return; }
  el.html(`<div class="card dashboard-sample-banner-card" style="padding:10px 14px;margin-bottom:14px;border-color:var(--c-warn,#f9a826);background:#fff8ec;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <div style="font-size:12.5px;color:#8a5a00"><strong>${esc(srT("bucket_viewing_sample_data"))}</strong> ${esc(srT("bucket_sample_data_desc"))}</div>
    <button type="button" class="btn btn-secondary btn-sm" data-action="dismissSampleBanner" aria-label="Dismiss">✕</button>
  </div>`);
}

// v4.23-smart-query-chat §1: canned questions now live in the LEFT rail
// (below the bucket list), replacing the old right-rail question list —
// called from renderShellLeftRail() only while the Smart Search bucket is
// the active one. Tapping a question feeds the same chat flow (§4) a
// typed question would, via smartChatAskCanned() below — it does NOT
// answer separately in the rail the way the old right-rail list did.
// v4.29: Smart Search is now reachable from both Institution mode
// (APP._currentBucketId) and Individual mode (window._individualBucketCurrent)
// — each mode tracks its own active bucket separately, so call-sites that
// need to know "is the smart bucket showing right now" must check
// whichever tracker the current mode actually uses.
function isSmartBucketActive(){
  return APP.setup.mode==="individual"
    ? window._individualBucketCurrent==="smart"
    : APP._currentBucketId==="smart";
}
// UI review fix (Task 5, "example prompts are buried"): this used to render
// into the LEFT rail, below the ~9-item bucket nav list — a user had to
// scroll past unrelated nav items to find it, while the center chat panel
// sat mostly empty. Moved into the center panel instead (called from
// renderDashboardSmartSearch() below, only while the thread is still
// empty) — same questions, same data-action/data-arg wiring, rendered as
// .chat-suggestion-chip pills (the class already used for the deflection/
// suggestion chips elsewhere in this chat) rather than a bucket-row list,
// which fits the empty center panel better than a rail-style list would.
function buildSmartQueryCannedQuestionsHtml(){
  // FIX ("Smart Search giving no value" report): this returned "" always,
  // so the panel never showed any tappable questions while Smart Search
  // was open — SmartQueryV2.availableQuestions() already existed and
  // worked, this just never rendered its output. Loads lazily and
  // re-renders once ready, same pattern ensureSmartQueryLoaded() callers
  // use elsewhere.
  if(!window.SmartQueryV2 || !window.SmartQueryV2.isReady()){
    ensureSmartQueryLoaded(function(){
      if(isSmartBucketActive() && typeof window.renderDashboardSmartSearch==="function"){
        window.renderDashboardSmartSearch();
      }
    });
    return "";
  }
  const SmartQueryV2 = window.SmartQueryV2;
  const questions=SmartQueryV2.availableQuestions();
  // Institution mode: also list the per-student template questions ("Is
  // this student improving or declining?", etc.) in this SAME list,
  // instead of a separate "Individual" grid — a prior pass split Class
  // and Individual questions into two visually distinct grids, but
  // per-report that read as two disconnected features; merging them (per
  // the earlier fix) should have meant "one list containing both kinds of
  // question", not "one list that only ever shows the class kind". These
  // are appended via SmartQueryV2.perStudentQuestions() (a small dedicated
  // export) rather than by relaxing evalRequires's "selectedStudent"
  // guard, so match()'s free-text scoring/dedup logic above stays
  // untouched. Individual mode doesn't need this: availableQuestions()
  // already includes per_student there (exactly one child, so
  // "selectedStudent" is always true).
  const allQuestions=(APP.setup.mode!=="individual" && typeof SmartQueryV2.perStudentQuestions==="function")
    ? questions.concat(SmartQueryV2.perStudentQuestions())
    : questions;
  if(!allQuestions.length) return "";
  const chips=allQuestions.map(function(q){
    // No inline onkeydown here — this doc's CSP blocks it anyway (see the
    // delegated Enter/Space handler in js/inline-actions.js, which already
    // covers any [role="button"][data-action] element, this one included).
    return `<button type="button" class="chat-suggestion-chip" data-action="smartChatAskCanned" data-arg="${esc(q.id)}" data-arg2="${esc(q.label)}">${esc(q.label)}</button>`;
  }).join("");
  return `<div class="chat-suggestions chat-suggestions-canned">${chips}</div>`;
}
// Loader guard shared with the old rail implementation's naming, kept
// separate from vs-shell.js's own copy (different module scope) — same
// one-shot "don't double-load" behavior.
let _smartChatLoadAttempted=false;
function ensureSmartQueryLoaded(cb){
  if(window.SmartQueryV2 && SmartQueryV2.isReady()){ if(cb) cb(); return; }
  if(_smartChatLoadAttempted) return;
  _smartChatLoadAttempted=true;
  import('../../bal/smart-search/smart-query-v2.js').then(function(){
    return window.SmartQueryV2.load();
  }).then(function(){ if(cb) cb(); }).catch(function(){});
}

// v4.23-smart-query-chat §3: transcript lives only as a plain in-memory
// array, same pattern as _targetScoreInputs above — NO_PERSISTENCE, reset
// on reload or on a genuinely new analysis run (see resetSmartChatTranscript(),
// called from inline-actions.js right before runAnalysis() — a fresh class/
// student file means the old conversation refers to data that's gone).
// It is NOT reset just because renderDashboardSmartSearch() re-runs — that
// happens on every re-entry into this bucket (bucket switch, tab switch and
// back, etc.), since #bucket-answer-screen's innerHTML gets torn down and
// rebuilt from scratch by every bucket every time. Previously this function
// also reset the array itself, so navigating away from Smart Search and
// back wiped an in-progress conversation for no reason ("big bug — moved to
// other tab and back, all gone" report) — the DOM was rebuilt, which is
// necessary, but the conversation memory didn't need to go with it.
let _smartChatTranscript=[];
function resetSmartChatTranscript(){
  _smartChatTranscript=[];
}

// item g/h retired the old right-rail search+list UI (superseded by
// v4.23-smart-query-chat) — Smart Search is now a real chat window in the
// center panel, wired to SmartQueryV2.ask()/match() instead of a substring
// filter. Canned questions moved to the left rail (buildSmartQueryCannedQuestionsHtml()
// above); this just builds the thread+composer skeleton and clears the
// right rail (§2 — no per-item properties for this bucket, same "no
// properties" pattern as renderComparePicker()/renderClusterGroups()).
// v4.29 §layout: JS-computed height, not CSS percentage chaining.
// #bucket-answer-screen's ancestor (.panel) is display:block/height:auto
// by design (every other bucket/tab needs normal document flow), so a
// pure-CSS height:100% chain down to the chat window is fragile — it
// depends on every ancestor in between also getting a matching rule,
// and on :has() support/cascade order lining up exactly right. Setting
// the pixel height directly here is unambiguous and works regardless.
function smartChatFitHeight(){
  const wrap=document.getElementById("bucket-answer-screen");
  const main=document.getElementById("main");
  if(!wrap||!main) return;
  if(!wrap.querySelector(".chat-window")) return; // no-op when this bucket isn't showing chat
  if(window.innerWidth<=768){
    // Mobile already uses natural page flow (see css/vs-shell.css's
    // @media(max-width:768px) block, #main{height:auto} there) — don't
    // fight that with an inline pixel height here.
    wrap.style.height="";wrap.style.display="";wrap.style.flexDirection="";wrap.style.minHeight="";
    return;
  }
  const mainRect=main.getBoundingClientRect();
  const wrapTop=wrap.getBoundingClientRect().top;
  const available=mainRect.bottom-wrapTop-16;
  wrap.style.height=Math.max(available,320)+"px";
  wrap.style.display="flex";
  wrap.style.flexDirection="column";
  wrap.style.minHeight="0";
}
if(typeof window!=="undefined"){
  window.addEventListener("resize", function(){ smartChatFitHeight(); });
}
// Rebuilds one already-recorded transcript entry back into a DOM bubble,
// without re-pushing it onto _smartChatTranscript (it's already there) —
// used only by renderDashboardSmartSearch()'s replay below. Mirrors the
// three shapes smartChatAppendUserBubble/smartChatReplaceWithAnswerBubble/
// smartChatReplaceWithSuggestionsBubble each produce, minus the
// thinking-bubble/word-reveal choreography (replay shows the final state
// immediately — no need to re-animate a conversation that already happened).
function smartChatRenderTranscriptEntry(thread,entry){
  if(entry.role==="user"){
    const bubble=document.createElement("div");
    bubble.className="chat-bubble chat-bubble-user";
    bubble.textContent=entry.text;
    thread.appendChild(bubble);
  } else if(entry.role==="suggestions"){
    const wrap=document.createElement("div");
    const chips=(entry.results||[]).map(function(r){
      const idJs=String(r.id).replace(/'/g,"\\'");
      const labelJs=String(r.label).replace(/'/g,"\\'");
      return `<button type="button" class="chat-suggestion-chip" data-action="smartChatAskCanned" data-arg="${idJs}" data-arg2="${labelJs}">${esc(r.label)}</button>`;
    }).join("");
    wrap.className="chat-suggestions";
    wrap.innerHTML=`<div class="chat-bubble chat-bubble-answer">${esc(entry.text)}</div>${chips}`;
    thread.appendChild(wrap);
  } else if(entry.role==="student_picker"){
    const wrap=document.createElement("div");
    wrap.className="chat-suggestions";
    wrap.innerHTML=`<div class="chat-bubble chat-bubble-answer">${esc(entry.text)}</div>${smartChatStudentPickerChipsHtml(entry.students||[],entry.originalQuery||"")}`;
    thread.appendChild(wrap);
  } else {
    const bubble=document.createElement("div");
    bubble.className="chat-bubble chat-bubble-answer";
    bubble.textContent=entry.text;
    thread.appendChild(bubble);
  }
}
function renderDashboardSmartSearch(){
  if(typeof setRightRail==="function") setRightRail("");
  if(typeof setShellRailOpen==="function") setShellRailOpen("end", false);
  // FIX ("Smart Search giving no value" report): this used to just show a
  // static "coming in StudIn Pro" notice instead of the real chat window —
  // every function this markup wires up (smartChatSubmit, smartChatRunQuery,
  // smartChatAskCanned, etc., all below) was already fully built and the
  // CSS for .chat-window/.chat-thread/.chat-composer already existed
  // (css/core.css), so this was purely a missing render step, not a
  // missing feature. Structure matches what smartChatFitHeight() and the
  // .chat-* CSS both already expect.
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">${esc(srT("bucket_smart_label"))}</div>
    <div class="chat-window">
      <div class="chat-thread" id="chat-thread">${_smartChatTranscript.length?"":`<div class="chat-empty-hint">${esc(srT("smart_v2_chat_empty_hint"))}</div>${buildSmartQueryCannedQuestionsHtml()}`}</div>
      <div class="chat-composer">
        <input id="chat-composer-input" class="input" type="text" autocomplete="off" placeholder="${esc(srT("smart_v2_input_placeholder"))}"/>
        <button type="button" class="btn btn-primary" data-action="smartChatSubmit">${esc(srT("smart_v2_send"))}</button>
      </div>
      <div class="chat-composer-tip" style="font-size:11px;color:var(--c-text2);padding:2px 4px 0">${esc(srT("smart_v2_prefix_tip"))}</div>
    </div>
  `);
  // Replay whatever conversation already happened — re-entering this
  // bucket (switching tabs and back, etc.) shouldn't look like the whole
  // thing vanished just because the DOM under it got rebuilt.
  const thread=document.getElementById("chat-thread");
  if(thread && _smartChatTranscript.length){
    _smartChatTranscript.forEach(function(entry){ smartChatRenderTranscriptEntry(thread,entry); });
  }
  ensureSmartQueryLoaded();
  smartChatFitHeight();
  smartChatScrollToBottom();
  // Bug fix: cursor didn't land in the composer on opening this screen —
  // teacher had to click the input before typing. Enter-to-submit was
  // already wired (see inline-actions.js's delegated keydown handler),
  // this was purely a missing focus() call.
  const composer=document.getElementById("chat-composer-input");
  if(composer) composer.focus();
}
function smartChatScrollToBottom(){
  const el=document.getElementById("chat-thread");
  if(el) el.scrollTop=el.scrollHeight;
}
function smartChatClearEmptyHint(){
  const el=document.getElementById("chat-thread");
  if(el && el.children.length===1 && el.children[0].className==="chat-empty-hint") el.innerHTML="";
}
function smartChatAppendUserBubble(text){
  smartChatClearEmptyHint();
  _smartChatTranscript.push({role:"user",text:text});
  const thread=document.getElementById("chat-thread");
  if(!thread) return;
  const bubble=document.createElement("div");
  bubble.className="chat-bubble chat-bubble-user";
  bubble.textContent=text;
  thread.appendChild(bubble);
  smartChatScrollToBottom();
}
// v4.23 §4.2/§5: brief, honest, generic thinking indicator — dots only,
// never fabricated "analyzing marks…" step text. The real answer is
// already computed synchronously by SmartQueryV2 before this ever shows;
// the delay is a pure reveal-timing affordance, capped low.
function smartChatAppendThinkingBubble(){
  const thread=document.getElementById("chat-thread");
  if(!thread) return null;
  const bubble=document.createElement("div");
  bubble.className="chat-bubble chat-bubble-thinking";
  bubble.innerHTML='<span class="chat-thinking-dot"></span><span class="chat-thinking-dot"></span><span class="chat-thinking-dot"></span>';
  thread.appendChild(bubble);
  smartChatScrollToBottom();
  return bubble;
}
function smartChatReplaceWithAnswerBubble(thinkingEl,text){
  _smartChatTranscript.push({role:"answer",text:text});
  if(!thinkingEl) return;
  thinkingEl.className="chat-bubble chat-bubble-answer";
  const reduced=window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(reduced){
    thinkingEl.textContent=text;
    smartChatScrollToBottom();
    return;
  }
  // v4.28 §3: word-by-word reveal — answer is already fully computed
  // above, this is timing-only (no fabricated intermediate content).
  const words=text.split(" ");
  let i=0;
  thinkingEl.textContent="";
  (function tick(){
    thinkingEl.textContent += (i>0?" ":"") + words[i];
    i++;
    smartChatScrollToBottom();
    if(i<words.length) setTimeout(tick,30);
  })();
}
function smartChatReplaceWithSuggestionsBubble(thinkingEl,results,deflectionText){
  _smartChatTranscript.push({role:"suggestions",text:deflectionText,results:results});
  if(!thinkingEl) return;
  thinkingEl.className="chat-suggestions";
  const chips=results.map(function(r){
    const idJs=String(r.id).replace(/'/g,"\\'");
    const labelJs=String(r.label).replace(/'/g,"\\'");
    return `<button type="button" class="chat-suggestion-chip" data-action="smartChatAskCanned" data-arg="${idJs}" data-arg2="${labelJs}">${esc(r.label)}</button>`;
  }).join("");
  thinkingEl.innerHTML=`<div class="chat-bubble chat-bubble-answer">${esc(deflectionText)}</div>${chips}`;
  smartChatScrollToBottom();
}
// "There's more than one student matching that — X or Y. Which one did
// you mean?" (report: "no assumption, ask me instead") — same shape as
// smartChatReplaceWithSuggestionsBubble but the chips resolve to a
// specific STUDENT, not a specific question, and tapping one re-runs the
// original query pinned to that student (SmartQueryV2.matchForStudent()).
// Each chip carries the original query text itself (data-arg2, HTML-escaped
// like any other data-arg2 value in this file — see smartChatAskCanned's
// label param above) rather than relying on shared mutable state, so this
// keeps working correctly even after a transcript replay (tab-switch-and-
// back) where "the last ambiguous question asked" wouldn't otherwise be
// recoverable.
function smartChatReplaceWithStudentPickerBubble(thinkingEl,students,promptText,originalQuery){
  _smartChatTranscript.push({role:"student_picker",text:promptText,students:students,originalQuery:originalQuery});
  if(!thinkingEl) return;
  thinkingEl.className="chat-suggestions";
  thinkingEl.innerHTML=`<div class="chat-bubble chat-bubble-answer">${esc(promptText)}</div>${smartChatStudentPickerChipsHtml(students,originalQuery)}`;
  smartChatScrollToBottom();
}
function smartChatStudentPickerChipsHtml(students,originalQuery){
  return students.map(function(s){
    const idJs=String(s.id).replace(/'/g,"\\'");
    return `<button type="button" class="chat-suggestion-chip" data-action="smartChatPickAmbiguousStudent" data-arg="${idJs}" data-arg2="${esc(originalQuery)}">${esc(s.name)}</button>`;
  }).join("");
}
// Tapping a student-picker chip after an ambiguous query ("Hegde" matching
// two students) — re-runs the ORIGINAL question, this time pinned to the
// picked student, via the same auto-answer/suggestion-chip threshold logic
// smartChatRunQuery() uses for a normal match(). Kept as its own function
// (rather than routing back through smartChatRunQuery) because the
// question was already typed once; only the ambiguous NAME needed
// resolving, not the whole query.
function smartChatPickAmbiguousStudent(studentId,originalQuery){
  const SmartQueryV2 = window.SmartQueryV2;
  const student=(window.APP && APP.students || []).find(function(s){ return String(s.id)===String(studentId); });
  smartChatAppendUserBubble(student?student.name:String(studentId));
  const thinkingBubble=smartChatAppendThinkingBubble();
  const AUTO_ANSWER_THRESHOLD=6;
  setTimeout(function(){
    const m=SmartQueryV2.matchForStudent(originalQuery,studentId,5);
    if(m.ok && m.results.length){
      const top=m.results[0];
      if(top.score>=AUTO_ANSWER_THRESHOLD){
        const answer=SmartQueryV2.answerQuestion(top.id);
        smartChatReplaceWithAnswerBubble(thinkingBubble,answer.text);
      } else {
        smartChatReplaceWithSuggestionsBubble(thinkingBubble,m.results,srT("smart_v2_deflection_hint"));
      }
    } else {
      smartChatReplaceWithAnswerBubble(thinkingBubble,m.text||"I couldn't find a matching question.");
    }
  },200+Math.random()*150);
}
// v4.23 §0/§4: submit flow, ported verbatim from vs-shell.js's dead
// smartQueryRailAsk_run() (ask() first, fall back to match() candidates
// as tappable chips on no confident hit, deflection message otherwise) —
// same control flow, retargeted at the chat thread instead of the rail.
function smartChatRunQuery(text){
  const SmartQueryV2 = window.SmartQueryV2;
  const userThinkingBubble=smartChatAppendThinkingBubble();
  const delay=280+Math.random()*220; // same rhythm as the AI-loader's sleep() elsewhere in this codebase
  setTimeout(function(){
    // v4.28 Cause A fix: call match() exactly once and derive both
    // outcomes (auto-answer vs. suggestion chips) from that single
    // result, instead of a doomed second call with identical input.
    const AUTO_ANSWER_THRESHOLD=6; // top.score>=6 auto-answers; lower-but-scored results become chips
    const m=SmartQueryV2.match(text,5);
    if(m.ambiguousStudents && m.ambiguousStudents.length>1){
      smartChatReplaceWithStudentPickerBubble(userThinkingBubble,m.ambiguousStudents,m.text,text);
    } else if(m.ok && m.results.length){
      const top=m.results[0];
      if(top.score>=AUTO_ANSWER_THRESHOLD){
        const answer=SmartQueryV2.answerQuestion(top.id);
        smartChatReplaceWithAnswerBubble(userThinkingBubble,answer.text);
      } else {
        smartChatReplaceWithSuggestionsBubble(userThinkingBubble,m.results,srT("smart_v2_deflection_hint"));
      }
    } else {
      smartChatReplaceWithAnswerBubble(userThinkingBubble,m.text||"I couldn't find a matching question.");
    }
  },delay);
}
function smartChatSubmit(){
  const input=document.getElementById("chat-composer-input");
  const text=input?input.value.trim():"";
  if(!text) return;
  if(input) input.value="";
  smartChatAppendUserBubble(text);
  if(!window.SmartQueryV2 || !window.SmartQueryV2.isReady()){
    ensureSmartQueryLoaded(function(){ smartChatRunQuery(text); });
    return;
  }
  smartChatRunQuery(text);
}
// Tapping a canned question (left rail, §1, or a suggestion chip in the
// thread, §4.3) — answerQuestion(id) is already known-good for this
// exact id, so it always resolves to a real answer bubble, no fallback
// branch needed here.
function smartChatAskCanned(questionId,label){
  const SmartQueryV2 = window.SmartQueryV2;
  // Per-student questions (e.g. "Is this student improving or declining?")
  // need to know WHICH student in Institution mode — Individual mode
  // always has exactly one child, so this only applies there. Answering
  // about an arbitrary/first student when none was specified would be
  // silently misleading, so instead this drops the question into the
  // chat composer and asks the person to add a name — the exact same
  // free-text path ("Is Priya improving?") that already resolves
  // per-student questions correctly via match()'s student-name matching.
  const flat=(window.SmartQueryV2 && typeof SmartQueryV2._flatQuestions==="function")?SmartQueryV2._flatQuestions():[];
  const q=flat.find(x=>x.id===questionId);
  if(q && q._categoryId==="per_student" && APP.setup.mode!=="individual"){
    smartChatAppendUserBubble(label);
    const thinkingBubble=smartChatAppendThinkingBubble();
    smartChatReplaceWithAnswerBubble(thinkingBubble,srT("smart_which_student_prompt"));
    const input=document.getElementById("chat-composer-input");
    if(input){
      input.value=label+" ";
      input.focus();
    }
    return;
  }
  smartChatAppendUserBubble(label);
  const thinkingBubble=smartChatAppendThinkingBubble();
  const delay=280+Math.random()*220;
  setTimeout(function(){
    if(!window.SmartQueryV2||!SmartQueryV2.isReady()){
      smartChatReplaceWithAnswerBubble(thinkingBubble,srT("val_smart_search_unavailable"));
      return;
    }
    const res=SmartQueryV2.answerQuestion(questionId);
    smartChatReplaceWithAnswerBubble(thinkingBubble,res.text);
  },delay);
}

function emptyStateHtml(text){
  return `<div class="bucket-empty">${esc(text)}</div>`;
}

// BUG FIX (report: selecting "Section Comparison Report" vs "Per-Section
// Reports" in compare mode's left rail had no effect on which of
// #compare-export-card/#compare-per-section-export-card showed, or on the
// right-rail "properties" panel — both rows called openBucket("export")
// with the exact same argument, so there was no way for openBucket() to
// tell them apart. Each row now gets its own id ("export-comparison" /
// "export-persection") and the same active-row highlighting
// buildDashboardControlsHtml() already does elsewhere (keyed off
// APP._currentBucketId) — see openBucket() for the id-specific
// card/right-rail handling this enables.
function buildCompareExportControlsHtml(){
  const active=APP._currentBucketId;
  const rows=[
    {id:"export-comparison",label:srT("bucket_compare_report_label"),desc:srT("bucket_compare_report_desc")},
    {id:"export-persection",label:srT("bucket_persection_label"),desc:srT("bucket_persection_desc")}
  ].map(b=>{
    const activeClass=(!APP._forceLegacyView && b.id===active)?" bucket-row-active":"";
    return `<div class="bucket-row${activeClass}" role="button" tabindex="0" data-action="openBucket" data-arg="${b.id}">
    <span class="bucket-text"><span class="bucket-label">${esc(b.label)}</span><span class="bucket-desc">${esc(b.desc)}</span></span>
  </div>`;
  }).join("");
  return `<div class="bucket-list">${rows}</div>`;
}

function openBucket(id){
  // STEP 5 (05-premium-feature-locking.md): Compare/SmartSearch/Reports
  // are now locked-by-default. This is the single choke point for both
  // "compare"/"smart" and every Reports export id ("export",
  // "export-comparison", "export-persection" — the latter two are
  // Compare-mode sub-views, already unreachable unless Compare itself is
  // unlocked, but mapped here too for defense-in-defense). lockedKey is
  // resolved here but acted on further down (after the dashboard-step
  // routing below), so a locked click still lands on the real Dashboard
  // step/rail state — it just renders the decorated locked explanation
  // into #bucket-answer-screen instead of the real bucket content.
  const LOCK_MAP = {compare:"compare", smart:"smartSearch", export:"reports", "export-comparison":"reports", "export-persection":"reports"};
  const lockedKey = LOCK_MAP[id] && !isFeatureOn(APP.features, LOCK_MAP[id]) ? LOCK_MAP[id] : null;
  // prompt-v4.20 §1xii follow-up fix: Export used to be a special-cased
  // early-return (scroll the always-rendered #panel-export into view) —
  // that's what caused its content to visually stack underneath whatever
  // bucket was previously open instead of replacing it, and it never set
  // APP._currentBucketId so the rail never highlighted it either. It's
  // handled as a normal bucket switch below now (see id==="export").
  window._bucketCurrent=id;
  APP._currentBucketId=id;
  APP._forceLegacyView=false; // selecting any control leaves Classic Dashboard view, per item 8/f
  // BUG FIX (highlight/stuck-panel): "export-comparison"/"export-persection"
  // are top-level Compare-mode views (buildCompareExportControlsHtml()),
  // not tied to any one group/section/cross-compare row — without this,
  // clicking one left its OWN highlight on AND left whichever group/
  // section/cross-compare row was active before still highlighted too
  // (buildCompareSectionListHtml() computes its active row purely from
  // APP._activeCompareGroupId/_activeCompareSectionId/_viewingCrossCompare,
  // which this never touched). Bare "export" is deliberately excluded —
  // that's a specific SECTION's own export while its dashboard is open,
  // and should leave that section's row highlighted.
  if(APP.compareMode&&(id==="export-comparison"||id==="export-persection")){
    APP._activeCompareGroupId=null;APP._activeCompareSectionId=null;APP._viewingCrossCompare=false;
  }
  // BUG FIX (Scholarship dead-end): this whole function only ever shows/
  // hides elements INSIDE #panel-dashboard (#bucket-answer-screen,
  // #legacy-dashboard-body, #panel-export, etc). That's correct while
  // already on the Dashboard step, but the left rail's bucket-list is now
  // also shown on the Scholarship step (so it isn't a dead end) — clicking
  // a bucket row from there called this function directly, without ever
  // switching the top-level `.panel` back to #panel-dashboard (that swap
  // only happens inside goStep()), so the Scholarship panel stayed
  // visible underneath and nothing appeared to change. Route through
  // goStep("dashboard") first when arriving from anywhere else — its own
  // step==="dashboard" branch calls renderBuckets(), which calls back into
  // openBucket(APP._currentBucketId) using the id already set above, so
  // the requested bucket still ends up open; this call just returns once
  // that chain finishes.
  if(APP.currentStep!=="dashboard"){
    if(typeof goStep==="function") goStep("dashboard");
    return;
  }
  try{
    if(typeof renderShellLeftRail==="function") renderShellLeftRail("dashboard"); // refresh active-row highlight
  }catch(err){
    console.error("Shell left-rail refresh failed in openBucket:",id,err);
  }
  // v4.20-bugfixes §2b/§2c: My Whole Class/Top Performers/Compare Two
  // Students/Performance Groups have no per-item right-rail content, so
  // collapse #shell-rail-end (animated, same transition as Setup/About/
  // FAQ's both-rails collapse); One Student/One Subject/Who Needs Help/
  // Smart Search/Export Reports DO populate real right-rail content, so
  // make sure it's re-opened in case a previous bucket had closed it.
  // #shell-rail-start (left rail) is untouched either way.
  if(typeof setShellRailOpen==="function"){
    const RAIL_END_CLOSED_FOR = {class:1,top:1,compare:1,clusters:1,smart:1,continuity:1};
    setShellRailOpen("end", !RAIL_END_CLOSED_FOR[id]);
  }
  if(lockedKey){
    $("#legacy-dashboard-body,#panel-export").hide();
    $("#bucket-answer-screen").html(`<div class="bucket-empty-state" style="max-width:480px;margin:60px auto">${buildFeatureLockedHtml(lockedKey)}</div>`).show();
    if(typeof setRightRail==="function") setRightRail("");
    return;
  }
  // prompt-v4.20 §1iii: "My Whole Class" IS the rich KPI/tabs/student-card
  // dashboard (renderDashboard() into #legacy-dashboard-body) — not a
  // separate "Classic" toggle (that manual toggle is retired, see §1ii/iv
  // above), just what this one bucket renders. Every other bucket below
  // still uses the lighter #bucket-answer-screen content.
  if(id==="class"){
    $("#bucket-answer-screen,#panel-export").hide();
    $("#legacy-dashboard-body").show();
    renderDashboardSampleBanner();
    if(typeof setRightRail==="function") setRightRail("");
    renderDashboard();
    return;
  }
  // prompt-v4.20 §1xii follow-up fix: Export is a normal bucket switch too
  // now (was a special-cased scroll-to before — that's what caused its
  // content to stack underneath whatever bucket was previously open,
  // instead of replacing it). Center shows only #panel-export's "What
  // Gets Generated" cards; the student/report-type picker + Generate
  // button live in the right rail via renderExportPropertiesRail().
  if(id==="export"||id==="export-comparison"||id==="export-persection"){
    $("#legacy-dashboard-body,#bucket-answer-screen").hide();
    $("#panel-export").show();
    renderDashboardSampleBanner();
    $("#exp-count").text((APP.students||[]).length);
    if(APP.compareMode) import('../../bal/compare/compute-compare.js').then(m => m.populateExportSectionPicker());
    // BUG FIX (report: both compare-mode export cards showed together, and
    // the right-rail "properties" panel always showed the student list,
    // regardless of which left-rail row was selected): applyCompareModeUI()
    // (js/compute-compare.js) still toggles both
    // #compare-export-card/#compare-per-section-export-card together purely
    // off APP.compareMode — that's still correct for entering/leaving
    // compare mode as a whole. Within compare mode, though, the two rows
    // are mutually exclusive views, so which one is currently selected
    // (this id) decides which single card shows and what the right rail
    // renders: "Section Comparison Report" is one class-wide PDF with
    // nothing to pick, so its right rail is empty; "Per-Section Reports"
    // reuses the normal student/teacher/management picker (same one
    // Institution mode's own Export Reports control uses), since it's
    // exporting the same kinds of PDFs, just scoped to one section at a
    // time via the section dropdown already inside its own card.
    if(id==="export-comparison"){
      $("#compare-export-card").show();
      $("#compare-per-section-export-card").hide();
      if(typeof setRightRail==="function") setRightRail("");
    } else if(id==="export-persection"){
      $("#compare-export-card").hide();
      $("#compare-per-section-export-card").show();
      if(typeof renderExportPropertiesRail==="function") renderExportPropertiesRail();
    } else if(typeof renderExportPropertiesRail==="function"){
      // Plain "export" — Institution mode's single Export Reports control,
      // or Compare mode's per-section-active generic export row (see
      // buildDashboardControlsHtml() call site in vs-shell.js). Unchanged.
      renderExportPropertiesRail();
    }
    return;
  }
  $("#legacy-dashboard-body,#panel-export").hide();
  $("#bucket-answer-screen").show();
  renderDashboardSampleBanner();
  if(id==="student")return renderStudentPicker();
  if(id==="subject")return renderSubjectPicker();
  if(id==="help")return renderFilteredList("help");
  if(id==="top")return renderFilteredList("top");
  if(id==="clusters"){
    return renderClusterGroups();
  }
  if(id==="compare")return renderComparePicker();
  if(id==="smart")return renderDashboardSmartSearch();
  if(id==="continuity")return renderContinuityBucket();
}
// TASK (Project Bible v2 §5a, "Student-vs-student comparison — scoped
// correctly, Classic view"). Scope guard is implicit, not a separate
// check: both dropdowns are populated only from APP.students (the one
// currently-loaded roster), so a cross-file/cross-class comparison is
// structurally impossible here — there is no second roster to pick from.
// Smart Query v2's two-student question variant is not built here; that
// depends on js/smart-query-v2.js, which does not exist yet.
function renderComparePicker(){
  if(typeof setRightRail==="function") setRightRail(""); // item e: no properties for this control
  const students=APP.students||[];
  const opts=students.map(st=>`<option value="${esc(st.id)}">${esc(st.name)}</option>`).join("");
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">Compare Two Students</div>
    <div class="bucket-picker-hint">Pick any two students from this class — comparison only ever uses this same roster, so it's always apples-to-apples.</div>
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:10px">
      <select id="compare-pick-a" style="flex:1;min-width:180px;padding:8px 10px;border:1px solid var(--c-border);border-radius:var(--r-sm);font-size:13px" ><option value="">Select student A…</option>${opts}</select>
      <span style="color:var(--c-text3);font-weight:700">vs</span>
      <select id="compare-pick-b" style="flex:1;min-width:180px;padding:8px 10px;border:1px solid var(--c-border);border-radius:var(--r-sm);font-size:13px" ><option value="">Select student B…</option>${opts}</select>
    </div>
    <div id="compare-result" style="margin-top:16px"></div>
  `);
}
function renderCompareResult(){
  const idA=$("#compare-pick-a").val(),idB=$("#compare-pick-b").val();
  const el=$("#compare-result");
  if(!idA||!idB){el.html("");return;}
  if(idA===idB){el.html(`<div style="color:var(--c-text3);padding:10px">${esc(srT("val_pick_two_different_students"))}</div>`);return;}
  const stA=(APP.students||[]).find(s=>s.id===idA),stB=(APP.students||[]).find(s=>s.id===idB);
  if(!stA||!stB)return;
  const a=stA.analysis||{},b=stB.analysis||{};
  const subjects=APP.setup.subjects||[];
  function rowsFor(label,valA,valB,unit,lowerIsBetter){
    let better=null;
    if(valA!==valB&&typeof valA==="number"&&typeof valB==="number"){
      better=(lowerIsBetter?valA<valB:valA>valB)?"A":"B";
    }
    return `<tr><td style="font-weight:600;color:var(--c-text2)">${esc(label)}</td>
      <td style="text-align:center;${better==="A"?"font-weight:700;color:var(--c-success)":""}">${valA!==null&&valA!==undefined?esc(String(valA))+(unit||""):"—"}</td>
      <td style="text-align:center;${better==="B"?"font-weight:700;color:var(--c-success)":""}">${valB!==null&&valB!==undefined?esc(String(valB))+(unit||""):"—"}</td></tr>`;
  }
  let rows="";
  rows+=rowsFor(srT("detail_overall_avg"),a.overallAvg,b.overallAvg,"%");
  rows+=rowsFor(srT("kpi_grade"),a.grade,b.grade,"");
  rows+=rowsFor(srT("th_rank"),a.rank,b.rank,"",true);
  rows+=rowsFor(srT("kpi_trend"),a.trend,b.trend,"");
  rows+=rowsFor(srT("detail_consistency"),a.consistencyScore,b.consistencyScore,"");
  rows+=rowsFor(srT("card_total_absences"),a.totalAbsent,b.totalAbsent,typeof a.totalAbsent==="number"||typeof b.totalAbsent==="number"?" days":"",true);
  subjects.forEach(s=>{
    const va=(a.subjectAvgs||{})[s],vb=(b.subjectAvgs||{})[s];
    rows+=rowsFor(s,va!==undefined?va:null,vb!==undefined?vb:null,"%");
  });
  el.html(`<div style="overflow-x:auto"><table class="data-table"><thead><tr><th></th><th style="text-align:center">${esc(stA.name)}</th><th style="text-align:center">${esc(stB.name)}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="font-size:11px;color:var(--c-text3);margin-top:10px">Same class, same subjects, same tests, same max marks — this comparison is always apples-to-apples. Highlighted cell = better on that row.</div>`);
}
function backToBuckets(){
  $("#bucket-list-screen,#bucket-answer-screen").hide();
  $("#bucket-screen").show();
}
// Screen C → Screen B, same bucket, per spec (never back to A from here).
function backToBucketList(){
  $("#bucket-answer-screen").hide();
  showScreen("#bucket-list-screen");
}

// TASK 1c (studin-features-prompt v1.0): flags in this app are trend/class
// level, not tied to one specific test, so there's no direct flag→test
// link to key off. The Chapter field is only meaningful as "what was being
// taught", so when a flag's reason plausibly relates to a particular
// test's content, the most recent test that has a Chapter filled in is
// used. Purely additive — blank Chapter means zero change to the string.


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { BUCKET_HELP_FLAG_TYPES, BUCKET_TOP_FLAG_TYPES, COMPARE_ROW_ICONS, DASHBOARD_CONTROL_ICONS, INDIVIDUAL_BUCKET_ICONS, _smartChatLoadAttempted, _smartChatTranscript, _targetScoreInputs, backToBucketList, backToBuckets, bucketIsHelp, bucketIsTop, buildCompareExportControlsHtml, buildCompareSectionListHtml, buildDashboardControlsHtml, buildIndividualDashboardControlsHtml, buildSmartQueryCannedQuestionsHtml, currentIndividualStudent, emptyStateHtml, ensureSmartQueryLoaded, individualBucketDefs, isSmartBucketActive, openBucket, openIndividualBucket, renderBuckets, renderComparePicker, renderCompareResult, renderDashboardSampleBanner, renderDashboardSmartSearch, renderIndividualPlanAnswer, renderIndividualReportAnswer, renderIndividualSubjectsAnswer, renderIndividualWellbeingAnswer, renderTargetScoreCard, renderTargetScoreGap, resetSmartChatTranscript, setTargetScore, smartChatAppendThinkingBubble, smartChatAppendUserBubble, smartChatAskCanned, smartChatClearEmptyHint, smartChatFitHeight, smartChatPickAmbiguousStudent, smartChatReplaceWithAnswerBubble, smartChatReplaceWithSuggestionsBubble, smartChatReplaceWithStudentPickerBubble, smartChatRunQuery, smartChatScrollToBottom, smartChatSubmit };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window.BUCKET_HELP_FLAG_TYPES=BUCKET_HELP_FLAG_TYPES;window.BUCKET_TOP_FLAG_TYPES=BUCKET_TOP_FLAG_TYPES;window.COMPARE_ROW_ICONS=COMPARE_ROW_ICONS;window.DASHBOARD_CONTROL_ICONS=DASHBOARD_CONTROL_ICONS;window.INDIVIDUAL_BUCKET_ICONS=INDIVIDUAL_BUCKET_ICONS;window._smartChatLoadAttempted=_smartChatLoadAttempted;window._smartChatTranscript=_smartChatTranscript;window._targetScoreInputs=_targetScoreInputs;window.backToBucketList=backToBucketList;window.backToBuckets=backToBuckets;window.bucketIsHelp=bucketIsHelp;window.bucketIsTop=bucketIsTop;window.buildCompareExportControlsHtml=buildCompareExportControlsHtml;window.buildCompareSectionListHtml=buildCompareSectionListHtml;window.buildDashboardControlsHtml=buildDashboardControlsHtml;window.buildIndividualDashboardControlsHtml=buildIndividualDashboardControlsHtml;window.buildSmartQueryCannedQuestionsHtml=buildSmartQueryCannedQuestionsHtml;window.currentIndividualStudent=currentIndividualStudent;window.emptyStateHtml=emptyStateHtml;window.ensureSmartQueryLoaded=ensureSmartQueryLoaded;window.individualBucketDefs=individualBucketDefs;window.isSmartBucketActive=isSmartBucketActive;window.openBucket=openBucket;window.openIndividualBucket=openIndividualBucket;window.renderBuckets=renderBuckets;window.renderComparePicker=renderComparePicker;window.renderCompareResult=renderCompareResult;window.renderDashboardSampleBanner=renderDashboardSampleBanner;window.renderDashboardSmartSearch=renderDashboardSmartSearch;window.renderIndividualPlanAnswer=renderIndividualPlanAnswer;window.renderIndividualReportAnswer=renderIndividualReportAnswer;window.renderIndividualSubjectsAnswer=renderIndividualSubjectsAnswer;window.renderIndividualWellbeingAnswer=renderIndividualWellbeingAnswer;window.renderTargetScoreCard=renderTargetScoreCard;window.renderTargetScoreGap=renderTargetScoreGap;window.resetSmartChatTranscript=resetSmartChatTranscript;window.setTargetScore=setTargetScore;window.smartChatAppendThinkingBubble=smartChatAppendThinkingBubble;window.smartChatAppendUserBubble=smartChatAppendUserBubble;window.smartChatAskCanned=smartChatAskCanned;window.smartChatClearEmptyHint=smartChatClearEmptyHint;window.smartChatFitHeight=smartChatFitHeight;window.smartChatReplaceWithAnswerBubble=smartChatReplaceWithAnswerBubble;window.smartChatReplaceWithSuggestionsBubble=smartChatReplaceWithSuggestionsBubble;window.smartChatRunQuery=smartChatRunQuery;window.smartChatScrollToBottom=smartChatScrollToBottom;window.smartChatSubmit=smartChatSubmit;}
