import { esc, switchDbTab, toast } from './app-utils-init.js';
import { runAnalysis } from '../bal/common/compute-stats.js';
import { collectSetupForm } from './project-setup.js';
import { renderBuckets } from '../ui/common/render-buckets.js';
import { renderCharts, showSampleFiles } from '../ui/common/render-core.js';
import { loadLanguage, reapplyI18nStrings, showAiTranslationNotice, srT } from './render-i18n.js';
import { swGoto } from './setup-wizard.js';
import { autoInferSetup, generateMergedTemplate, generateTemplate, renderAICheckboxes, renderHomePage } from './template-upload.js';
import { renderShellLeftRail, renderShellRightRail, setShellRailsOpen } from './vs-shell.js';


/* ════ APP STATE ════ */
const APP={currentStep:"home",features:{},setupCard1Choice:"new",setup:{mode:"institution",modeLocked:false,instName:"",instType:"",location:"",contact:"",className:"",section:"",year:"",teacher:"",scoring:{marks:true,pct:true,grade:false,pf:false},passThreshold:35,absentAlert:3,dropAlert:20,subjects:[],tests:[]},rawData:null,students:[],classStats:null,genderAnalysis:null,filter:"all",sort:"rank",aiFeatures:new Set(),individualSelectedId:null,
  // mergeSource holds the already-filled MARKS+CONTEXT sheet (header row +
  // real student rows, as plain arrays) when the teacher loads an existing
  // workbook via "Update Existing Sheet" on the Setup step. When set,
  // generateTemplate() appends new-test columns onto these exact rows
  // instead of building a fresh 5-sample-row workbook — see
  // generateMergedTemplate() for why this exists: the plain "Download
  // Template" button always regenerates from scratch and has no way to
  // know a previous file's marks should be preserved.
  mergeMode:false,mergeSource:null,_pendingMerge:null,
  // ── COMPARE SECTIONS MODE (Institution only) ──
  // compareMode: entered by dropping 2+ files on Home's single upload
  // zone (no dedicated "Compare" entry point anymore — v3.1). sections[]
  // holds one entry per uploaded section/batch file: {id,fileName,rawData,
  // label,valid,errors,rowCount,students,classStats,genderAnalysis,dataIssues}.
  // sectionComparison is the computed cross-section ranking/aggregate built
  // by computeSectionComparison() once every valid section has been analysed.
  compareMode:false,sections:[],sectionComparison:[],
  // ── HOME SINGLE-FILE CARD ── the non-compare-mode counterpart to
  // sections[] above: set once a lone Home upload passes validation, so
  // renderHomeFileList() can show the same "here's what's uploaded, ✕ to
  // remove it before running" card whether it's 1 file or several.
  homeSingleFile:null
  ,setupWizardStep:1  // 1–4, session-only
};
// FIX (module-system conversion, HANDOVER #4): this line used to declare
// and _compareSectionSeq —
// state-nav.js never actually used any of them; they were only declared
// here because, in the old sloppy-global-script model, declaring `let`
// in the first-loaded file made the names available as bare globals to
// every later file. Under ES modules, imported bindings are read-only
// live views — you can't reassign an imported `let` (and all 5 of these
// get reassigned, not just mutated, in their real usage sites) — so each
// now lives in the file that actually owns/mutates it instead:
// _charts -> render-core.js -> compute-compare.js,
// subjectCount/testCount/_unsaved -> project-setup.js.

/* ════ THEME TOGGLE ════ */
function setThemeChoice(choice){
  // choice: 'light' | 'dark'. Only persists the choice itself (a UI
  // preference), never any student data — consistent with the
  // NO_PERSISTENCE rule elsewhere in this app.
  document.documentElement.setAttribute('data-theme',choice);
  try{localStorage.setItem('si-theme-choice',choice);}catch(e){}
  $('.theme-btn').attr('aria-pressed','false');
  $('.theme-btn[data-theme-choice="'+choice+'"]').attr('aria-pressed','true');
  // Charts read colors from computed CSS custom properties at render time
  // (see renderCharts()), so re-render whichever chart canvases currently
  // exist to pick up the new theme's colors immediately rather than only
  // on next navigation.
  if(typeof renderCharts==='function' && $('#chart-subject-avg').length && $('#panel-dashboard').is(':visible')){
    try{renderCharts();}catch(e){}
  }
}
function initThemeToggle(){
  var saved='light';
  try{ var t=localStorage.getItem('si-theme-choice'); if(t==='light'||t==='dark') saved=t; }catch(e){}
  $('.theme-btn').attr('aria-pressed','false');
  $('.theme-btn[data-theme-choice="'+saved+'"]').attr('aria-pressed','true');
}

// ════ NAV LOCK — SINGLE SOURCE OF TRUTH ════
// Everything that should stop being reachable the moment "Run Analysis"
// is clicked (Setup/Sample Files/About/FAQ/Scholarship nav + Country/
// Language) used to be governed by separate, slightly-mismatched literal
// step-lists at each call site (updateNavHomeOnlyState()'s own dashboard/
// export/scholarshipLocked check, goStep()'s own copy of the same check,
// showSampleFiles()'s own copy again) — none of them included the "ai"
// step (the actual Run Analysis computation), so a stray nav click while
// analysis was mid-run wasn't blocked anywhere. These three primitives
// are now the only place "is the admin mid-task" is defined; every call
// site below composes them instead of repeating step-name literals.
function isRunComputing(){ return APP.currentStep==="ai"; }
function isReviewingResults(){ return APP.currentStep==="dashboard"||APP.currentStep==="export"; }
function isScholarshipLocked(){ return APP.currentStep==="scholarship"&&!!(APP.setup&&APP.setup.scholarship&&APP.setup.scholarship.enabled); }
// Setup / Sample Files / About / FAQ share one rule: locked while
// analysis is computing, while reviewing Dashboard/Export results, while
// a Scholarship scheme is actively being edited, or while the admin is
// actively working the Setup page itself (BUG FIX: previously only the
// first 3 cases locked these — Sample/About/FAQ stayed clickable while
// mid-Setup, letting a stray click derail a half-filled form the same
// way the Dashboard/Export lock already guards against).
function isNavLockedForSetupTabs(){ return isRunComputing()||isReviewingResults()||isScholarshipLocked()||APP.currentStep==="setup"; }
// Scholarship's own nav item only needs to block the actual computing
// window — jumping there from Dashboard/Export afterwards is the normal,
// intended flow, not a distraction to guard against.
function isNavLockedForScholarship(){ return isRunComputing(); }

/* ════ NAV ════ */
// Shared by goStep() (per-step lock) and the Sample Files modal (which
// isn't a step — it's a modal reachable from most steps — see
// render-core.js showSampleFiles()/closeModal()). Single source of truth
// for "should the language selector be locked right now" so the two call
// sites can't drift out of sync.
function isLangLockStep(step){
  return step==="ai"||step==="dashboard"||step==="export"||step==="scholarship"||step==="setup"||step==="about"||step==="faq";
}
// BUG FIX (3-scenario spec): Country was never part of the lock above —
// only Language was — so switching country (which re-derives the
// language list/curriculum defaults) mid-analysis or mid-scholarship-edit
// was still possible even though Language, doing a smaller version of the
// same disruption, was already blocked. Applies the exact same
// isLangLockStep() steps to #country-select too, via one shared setter so
// the two selectors can never drift out of sync with each other.
function applyCountryLangLock(locked){
  const langSel=document.getElementById("language-select");
  const countrySel=document.getElementById("country-select");
  const title=locked?srT("lang_locked_during_analysis"):"";
  if(langSel){ langSel.disabled=locked; langSel.title=title; }
  if(countrySel){ countrySel.disabled=locked; countrySel.title=title; }
}
// Re-applies the lock for whatever APP.currentStep currently is —
// used to restore the correct state after a modal (which locks
// unconditionally while open) closes, since the modal's own open/close
// isn't itself a step change.
function refreshLangLockUI(){
  applyCountryLangLock(isLangLockStep(APP.currentStep));
}
function setLangLockUI(locked){
  applyCountryLangLock(locked);
}

async function goStep(step){
  // v3.0 rev2 (BUILD spec §10.1/§10.3): the old "data"/Upload Data step no
  // longer exists. collectSetupForm() (Setup form → shared schema, for the
  // non-Compare "fill the form first" flow) doesn't need a call here —
  // runAnalysis() already does it safely, gated on whether the Setup
  // form's own subject rows actually have anything in them (see
  // domSubjects.length there), which correctly no-ops for Home's
  // autoInferSetup()-driven single-file flow instead of overwriting it.
  // v4.1 (bug #1/#2 fix): Setup / About / FAQ (and Sample Files, guarded
  // separately in showSampleFiles()) share one rule — open from anywhere
  // except once the user has moved on to Dashboard/Export, where jumping
  // back into any of them mid-review just adds clutter/confusion (per
  // Sandy). Previously About/FAQ used a stricter "Home only" check that
  // also blocked them while mid-Setup — that mismatch was the reported
  // bug. Block the jump and explain why instead of silently navigating;
  // the nav items themselves also get a "disabled" look + tooltip via
  // updateNavHomeOnlyState() below so this rarely even gets clicked.
  // BUG FIX (3-scenario spec): Setup/About/FAQ/Sample Files (and the
  // Country/Language selectors, see isLangLockStep() above and the two
  // #country-select lines below) are now also locked while the admin is
  // actively working the Scholarship dashboard/grid — same "don't let a
  // stray nav click derail mid-edit work" rationale as the existing
  // Dashboard/Export lock, extended here rather than duplicated. Gated on
  // the scheme actually being `enabled` (not just APP.currentStep===
  // "scholarship") so this doesn't also block enableScholarshipAndOpenGrid()
  // (scholarship-nav.js) itself routing scholarship -> setup to fill in the
  // Scholarship Criteria form for the FIRST time, before enabled flips true.
  // BUG FIX: the "locked" toast fired on every click of an already-visibly-
  // disabled nav item (grayed out, tabindex=-1, title tooltip via
  // updateNavHomeOnlyState()) — redundant with that existing visual state
  // and noisy on repeat clicks. Silently no-op instead; the tooltip still
  // explains why.
  if(isNavLockedForSetupTabs()&&(step==="setup"||step==="about"||step==="faq")){
    return;
  }
  if(isRunComputing()&&step==="scholarship"){
    return;
  }
  if(step==="ai"&&!APP.compareMode&&!APP.rawData){toast(srT("val_upload_file_home_first"),"warn");return;}
  if(step==="ai"&&APP.compareMode&&APP.sections.filter(s=>s.valid).length<1){toast(srT("val_upload_1_valid_file_home_first"),"warn");return;}
  if((step==="dashboard"||step==="export")&&!APP.compareMode&&!APP.students.length){toast(srT("val_run_analysis_first"),"warn");return;}
  if((step==="dashboard"||step==="export")&&APP.compareMode&&!APP.sections.some(s=>s.valid&&s.students&&s.students.length)){toast(srT("val_run_analysis_first"),"warn");return;}
  // Task 07: same "file loaded" gate as the nav entry's own visibility
  // (updateScholarshipNavVisibility()) — the nav item is hidden until a
  // file loads so this is mostly defensive, but keeps goStep() safe as
  // the single choke point even if something else tries to jump here.
  if(step==="scholarship"&&!(APP.homeSingleFile||(APP.compareMode&&APP.sections.some(s=>s.valid)))){toast(srT("val_upload_file_home_first"),"warn");return;}
  // STEP 5 (05-premium-feature-locking.md): Scholarship is now
  // locked-by-default. Used to bail out here with a modal before the
  // step changed — now the step change proceeds as normal (checked after
  // the "file loaded" guard above, so a locked message doesn't show for a
  // feature you can't use yet anyway) and renderScholarshipPanel() itself
  // shows the decorated locked explanation in #panel-scholarship instead
  // of the real not-enabled/enabled content — see that file.
  APP.currentStep=step;
  // BUG FIX (i18n-lock): analysis narrative (flag_reason_*, findings, AI
  // summaries) is generated once by computeAnalysis() and baked into
  // APP.students as plain strings — it is NOT re-translated by the
  // data-i18n DOM sweep on a later language switch (that sweep only
  // touches static template strings). Switching language mid-dashboard
  // therefore left analysis text stuck in whatever language was active
  // when "Run Analysis" was clicked, producing a mixed-language screen.
  // Fix: language is locked (dropdown disabled) for the whole life of a
  // run — from the "ai" loading step through "dashboard"/"export" — and
  // only unlocked back on "home" or "setup", the only steps from which a
  // fresh analysis can be started. Pick your language BEFORE running.
  // BUG FIX: language switch mid-scholarship/setup/sample/about/faq was
  // still enabled — switching language there re-renders that screen's
  // strings out from under whatever the user is mid-way through (editing
  // scholarship criteria/grid, reading Sample/About/FAQ copy), same class
  // of distraction the original ai/dashboard/export lock already existed
  // to prevent. Extending the same lock to these 5 steps rather than
  // building a second mechanism.
  const langLockSteps=isLangLockStep(step);
  applyCountryLangLock(langLockSteps);
  // vs-shell-plan-v2 Task 4/5: single hook for all 7 panels instead of one
  // call added per render function — same effect, smaller diff.
  // Wrapped in try/catch: if either ever throws, don't let it silently
  // abort the rest of goStep() (panel switching/nav-highlight/dashboard
  // render all sit below this) — log the real error instead so a rail
  // bug is visible in devtools rather than looking like "nothing renders."
  try{
    // BUG FIX: renderShellLeftRail("home") reads APP.homeSingleFile to
    // build "Current File Details" — but that reset only happened later
    // in this function (renderHomePage() call below), so navigating Home
    // painted the rail with the PREVIOUS file for one frame before the
    // reset caught up. renderHomePage() must run before the rail render
    // whenever step==="home", not after.
    if(step==="home") renderHomePage();
    if(typeof renderShellLeftRail==="function") renderShellLeftRail(step);
    if(typeof renderShellRightRail==="function") renderShellRightRail(step);
    // prompt-v4.19 §2a + v4.20-bugfixes §2a: rails auto-collapse entering
    // Setup, About, or FAQ, auto-restore leaving them — reuses the exact
    // same setShellRailsOpen() car-mirror, just keyed off three steps now
    // instead of one.
    // UI redesign (2026-08): Home added to this list too — on first
    // landing, both rails were duplicating the same "what this app does"
    // pitch as plain bullet lists on either side of a small upload box.
    // That copy now lives as a compact single-row icon strip + sample
    // stat tiles inside the Home panel itself (index.html #panel-home),
    // so the rails default closed here and the upload dropzone gets the
    // full width as the actual hero of the page. Rails are still fully
    // functional if the user manually reopens them (renderShellLeftRail/
    // renderShellRightRail above still populate the same pitch-row
    // content for step==="home" — nothing removed, just no longer forced
    // open by default).
    const railsCollapseOnThisStep = (step==="setup"||step==="about"||step==="faq"||step==="home");
    if(typeof setShellRailsOpen==="function") setShellRailsOpen(!railsCollapseOnThisStep);
  }catch(err){
    console.error("Shell rail render failed for step:",step,err);
  }
  $(".panel").removeClass("active screen-fade-in");$("#panel-"+step).addClass("active screen-fade-in");
  $(".step-item").removeClass("active").removeAttr("aria-current");$("[data-step='"+step+"']").addClass("active").removeClass("locked").attr("aria-current","step");
  updateNavHomeOnlyState();
  updateScholarshipNavVisibility();
  // v4.2: re-render AI feature checkboxes fresh in the current language on
  // every visit to this panel — reapplyI18nStrings() only catches a
  // language switch made WHILE already on this panel; this covers the
  // (likely more common) case of switching language elsewhere first, then
  // navigating here afterward.
  if(step==="ai"&&typeof renderAICheckboxes==="function")renderAICheckboxes();
  if(step==="dashboard"){
    renderBuckets();
    // BUG FIX: db-tab active state lives purely in the DOM (switchDbTab()
    // just toggles classes) and #panel-dashboard is never rebuilt, so
    // whichever tab was last open (e.g. Insights) stayed active across
    // completely unrelated analyses — a fresh run landed the teacher back
    // on the last-viewed tab instead of Students. Reset to the first/
    // default tab every time Dashboard is freshly entered.
    const firstTab=document.getElementById("dbtab-students");
    if(firstTab) switchDbTab("students",firstTab);
  }
  if(step==="scholarship"){
    const { renderScholarshipPanel } = await import('../ui/scholarship/scholarship-nav.js');
    renderScholarshipPanel();
  }
  if(step==="export"){
    if(APP.compareMode){
      const { populateExportSectionPicker } = await import('../bal/compare/compute-compare.js');
      populateExportSectionPicker();
    }
    else $("#exp-count").text(APP.students.length);
  }
  // renderHomePage() for step==="home" already ran above (before the rail
  // render) — see BUG FIX comment. Not called again here.
  if(step==="setup"){
    if(typeof swGoto==="function") swGoto(APP.setupWizardStep||1);
    // prompt-v4.19 §2b (revised): prefill with the plain current year —
    // matches the field's own placeholder ("e.g. 2026"), not a YYYY-YY
    // range format the field was never designed to display.
    if(!APP._classYearPrefilled){
      APP._classYearPrefilled=true;
      const yearEl=document.getElementById("class-year");
      if(yearEl && !yearEl.value.trim()){
        yearEl.value = String(new Date().getFullYear());
      }
    }
  }
}
// v4.1 (bug #1/#2 fix): Setup/Sample Files/About/FAQ now share one rule —
// open from anywhere (Home, Setup itself, AI, etc.), locked only once the
// user has moved on to Dashboard/Export. Previously Sample/About/FAQ used
// a stricter "Home only" rule that also blocked them while mid-Setup,
// which was the actual reported bug (they should never be more locked
// than the Setup tab itself).
function updateNavHomeOnlyState(){
  // Kept in sync with goStep()'s own isNavLockedForSetupTabs()/
  // isNavLockedForScholarship() checks above — same functions, so the
  // visual "disabled" state never drifts from what clicking the item
  // would actually do.
  const setupTabsLocked=isNavLockedForSetupTabs();
  $(".nav-home-only,.nav-setup-tab").toggleClass("disabled",setupTabsLocked).attr("aria-disabled",setupTabsLocked?"true":"false").attr("tabindex",setupTabsLocked?"-1":"0").attr("title",setupTabsLocked?srT("val_home_only"):"");
  const scholarshipNavLocked=isNavLockedForScholarship();
  $(".nav-file-required").toggleClass("disabled",scholarshipNavLocked).attr("aria-disabled",scholarshipNavLocked?"true":"false").attr("tabindex",scholarshipNavLocked?"-1":"0").attr("title",scholarshipNavLocked?srT("val_home_only"):"");
}

// Relocated from ui/scholarship/scholarship-nav.js (2026-08-28, lazy-load
// pass) — only ever depended on APP (defined in this file) and the DOM,
// nothing else in that module. Toggles a class on
// .step-item[data-step="scholarship"], which css/core.css permanently
// hides (`display:none!important` — superseded by the rail-row entry
// point, see planner.md decisions log), so this has been visually a
// no-op for a while; kept exactly as-is rather than removed, since 3
// other call sites in core/template-upload.js still call it and this
// pass is about import-graph cleanup, not behavior changes.
function fileIsLoaded(){
  return !!(APP.homeSingleFile || (APP.compareMode && APP.sections && APP.sections.some(s => s.valid)));
}
function updateScholarshipNavVisibility(){
  const el = document.querySelector('.step-item[data-step="scholarship"]');
  if(el) el.classList.toggle("nav-file-loaded", fileIsLoaded());
}

// PHASE 3 — Only India is active right now; other countries are listed
// but disabled ("coming soon") in the dropdown, per explicit direction.
// All 13 Indian languages now have real (AI-draft, unreviewed) i18n/
// files with exact key parity to en.json (verified). ur.json is RTL
// script — the app has no dir="rtl" layout support yet, so Urdu text
// will render but surrounding UI won't mirror; a real follow-up item.
const COUNTRY_LANGUAGES = {
  IN: { label:"India", defaultLang:"en", languages:[
    {code:"en",label:"English"},{code:"hi",label:"हिन्दी (Hindi)"},{code:"kn",label:"ಕನ್ನಡ (Kannada)"},
    {code:"ta",label:"தமிழ் (Tamil)"},{code:"te",label:"తెలుగు (Telugu)"},{code:"mr",label:"मराठी (Marathi)"},
    {code:"bn",label:"বাংলা (Bengali)"},{code:"gu",label:"ગુજરાતી (Gujarati)"},{code:"ml",label:"മലയാളം (Malayalam)"},
    {code:"pa",label:"ਪੰਜਾਬੀ (Punjabi)"},{code:"or",label:"ଓଡ଼ିଆ (Odia)"},{code:"as",label:"অসমীয়া (Assamese)"},
    {code:"ur",label:"اردو (Urdu)"}
  ]},
  US: { label:"United States", defaultLang:"en", languages:[{code:"en",label:"English"}] },
  GB: { label:"United Kingdom", defaultLang:"en", languages:[{code:"en",label:"English"}] },
  AE: { label:"UAE", defaultLang:"en", languages:[{code:"en",label:"English"},{code:"ur",label:"اردو (Urdu)"}] },
  SG: { label:"Singapore", defaultLang:"en", languages:[{code:"en",label:"English"},{code:"ta",label:"தமிழ் (Tamil)"}] },
  AU: { label:"Australia", defaultLang:"en", languages:[{code:"en",label:"English"}] },
  CA: { label:"Canada", defaultLang:"en", languages:[{code:"en",label:"English"}] }
};
const DEFAULT_COUNTRY = "IN";

function populateCountryDropdown(){
  const sel = $("#country-select");
  if(!sel.length) return;
  // Only India is offered as a selectable option — the other countries in
  // COUNTRY_LANGUAGES are NOT rendered into the <select> at all. An
  // earlier version tried native <option disabled> instead, but that
  // styling is too subtle in some browsers/OS combos to read as
  // "disabled" at a glance — this is the unambiguous fix: if it's not in
  // the list, it can't be picked, full stop. The other countries stay
  // defined in COUNTRY_LANGUAGES (unused for now) so re-enabling one
  // later is just adding it back into this .filter().
  const active = Object.entries(COUNTRY_LANGUAGES).filter(([code])=>code===DEFAULT_COUNTRY);
  sel.html(active.map(([code,c])=>
    `<option value="${code}" selected>${esc(c.label)}</option>`
  ).join(""));
  $("#i18n-more-countries-note").remove();
  populateLanguageDropdown(DEFAULT_COUNTRY);
}
function populateLanguageDropdown(countryCode){
  const country = COUNTRY_LANGUAGES[countryCode] || COUNTRY_LANGUAGES[DEFAULT_COUNTRY];
  const sel = $("#language-select");
  if(!sel.length) return;
  sel.html(country.languages.map(l=>
    `<option value="${l.code}" ${l.code===country.defaultLang?"selected":""}>${esc(l.label)}</option>`
  ).join(""));
}
function onCountryChange(countryCode){
  populateLanguageDropdown(countryCode);
  const country = COUNTRY_LANGUAGES[countryCode] || COUNTRY_LANGUAGES[DEFAULT_COUNTRY];
  loadLanguage(country.defaultLang);
}
function onLanguageChange(langCode){
  loadLanguage(langCode).then(()=>{
    // AI-translation disclosure: shown every single time the user selects
    // any non-English language — including regional-to-regional switches
    // (e.g. Hindi -> Tamil), not just the first English -> regional switch.
    if(langCode!=="en" && window.SR_LANG===langCode){
      showAiTranslationNotice(langCode);
    }
  });
}


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { APP, COUNTRY_LANGUAGES, DEFAULT_COUNTRY, goStep, initThemeToggle, isLangLockStep, isNavLockedForSetupTabs, isNavLockedForScholarship, isRunComputing, onCountryChange, onLanguageChange, populateCountryDropdown, populateLanguageDropdown, refreshLangLockUI, setLangLockUI, setThemeChoice, updateNavHomeOnlyState, updateScholarshipNavVisibility };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window.APP=APP;window.COUNTRY_LANGUAGES=COUNTRY_LANGUAGES;window.DEFAULT_COUNTRY=DEFAULT_COUNTRY;window.goStep=goStep;window.initThemeToggle=initThemeToggle;window.onCountryChange=onCountryChange;window.onLanguageChange=onLanguageChange;window.populateCountryDropdown=populateCountryDropdown;window.populateLanguageDropdown=populateLanguageDropdown;window.setThemeChoice=setThemeChoice;window.updateNavHomeOnlyState=updateNavHomeOnlyState;}
