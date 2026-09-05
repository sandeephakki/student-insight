import { switchDbTab, toggleTrust, validateSetup } from '../../core/app-utils-init.js';
import { runAnalysis } from '../../bal/common/compute-stats.js';
import { selectContinuityPeriod, selectContinuityStudent, toggleContinuityProjection } from './continuity-dashboard.js';
import { addSubject, addTest, filterFAQ, markDirty, setUsageMode, startNewSession, toggleMmSubject, updateTestSubjectCols } from '../../core/project-setup.js';
import { openBucket, openIndividualBucket, renderCompareResult, renderDashboardSampleBanner, resetSmartChatTranscript, setTargetScore, smartChatAskCanned, smartChatPickAmbiguousStudent, smartChatSubmit } from './render-buckets.js';
import { closeModal, dbTabKeyNav, downloadUpdatedSheet, filterStudents, resolveConfirmModal, runSampleFile, saveNarrativeField, saveRemarkField, selectIndividualStudent, setFilter, showSampleFiles, sortStudents, updateRemarkCharCount } from './render-core.js';
import { filterPickerList, onBucketStudentPick, onBucketSubjectPick, openFinding } from './render-findings.js';
import { continueSampleNamesNotice, shareInsightAsImage } from '../../core/render-i18n.js';
import { downloadDebugLog, safeRun } from '../../core/debug-log.js';
import { swBack, swNext, swRefresh } from '../../core/setup-wizard.js';
import { APP, goStep, onCountryChange, onLanguageChange, setThemeChoice } from '../../core/state-nav.js';
import { cancelMergeMode, chooseMergeFork, confirmMergedDownload, deleteRecentFile, generateTemplate, goHomeAfterDownload, handleHomeImportFiles, handleUpdateUpload, resetHomeImport, stayAfterDownload, toggleAI, toggleBulkSectionsUI, toggleScholarshipUI, validateScholarshipCriteria } from '../../core/template-upload.js';
import { vsShellToggle } from '../../core/vs-shell.js';

// FIX (review #4, item 3): replaces the 51 static inline onclick="" handlers
// in index.html with a single delegated listener + data-action/data-arg
// attributes. Behavior is unchanged — every call below is the exact same
// function/argument the removed onclick attribute used to invoke.
// Scope: index.html static handlers only. The ~50 dynamic onclick handlers
// generated inside template literals in js/*.js are NOT touched here — see
// HANDOVER.md item 3.
//
// UPDATE (review #5): index.html's CSP already had 'unsafe-inline' removed
// from script-src, but ~22 static onchange/oninput/onkeydown/ondrag*
// attributes were still inline — the mismatch was throwing "Executing
// inline event handler" CSP violations on every page load. Those are now
// delegated listeners below (change/input/keydown/drag*), so the dynamic
// onclick handlers noted above are the only remaining inline JS in the app.
(function(){
  'use strict';

  // P3 #18: per-action map instead of one big switch. Each handler keeps
  // the exact same (arg, el, ev) call signature and body the switch case
  // had — pure mechanical conversion, no behavior changed.
  var DISPATCH_ACTIONS = {
    setThemeChoice: function(arg){ setThemeChoice(arg); },
    goStep: function(arg){ goStep(arg); },
    enableScholarshipAndOpenGrid: function(){ import('../scholarship/scholarship-nav.js').then(m => m.enableScholarshipAndOpenGrid()); },
    showSampleFiles: function(){ showSampleFiles(); },
    showStudInProForm: function(){ window.showStudInProForm(); },
    vsShellToggle: function(arg){ vsShellToggle(arg); },
    toggleTrust: function(arg){ toggleTrust(arg); },
    triggerHomeImport: function(){
      document.getElementById('home-import-input').click();
    },
    runAnalysis: function(){
      // A fresh analysis run means a genuinely new class/student file —
      // any Smart Search conversation so far refers to data that's about
      // to be replaced, so THIS is the right place to clear it (not
      // every time the Smart Search bucket is merely re-opened — see
      // resetSmartChatTranscript()'s own comment in render-buckets.js
      // for the "moved to another tab and back, chat gone" bug this
      // used to cause).
      resetSmartChatTranscript();
      safeRun('dashboard_analysis', 'run_analysis', runAnalysis);
    },
    startNewSessionCard: function(){
      startNewSession();
      APP.setupCard1Choice = 'new';
      if (typeof swRefresh === 'function') swRefresh();
    },
    triggerUpdateImport: function(){
      APP.setupCard1Choice = 'update';
      document.getElementById('update-sheet-input').click();
    },
    cancelMergeMode: function(){ cancelMergeMode(); },
    chooseMergeFork: function(arg){ chooseMergeFork(arg); },
    swNext: function(){ swNext(); },
    swBack: function(){ swBack(); },
    setUsageMode: function(arg){ setUsageMode(arg); },
    addSubjectAndValidate: function(){
      addSubject();
      validateSetup();
    },
    addTestAndValidate: function(){
      addTest();
      validateSetup();
    },
    generateTemplate: function(){ generateTemplate(); },
    setFilter: function(arg, el){ setFilter(arg, el); },
    sortStudents: function(arg){ sortStudents(arg); },
    switchDbTab: function(arg, el){ switchDbTab(arg, el); },
    switchScholarshipTab: function(arg){ import('../scholarship/scholarship-dashboard.js').then(m => m.switchScholarshipTab(arg)); },
    toggleScholarshipErrorGrid: function(){ import('../scholarship/scholarship-dashboard.js').then(m => m.toggleScholarshipErrorGrid()); },
    saveScholarshipEdits: function(){ import('../scholarship/scholarship-edit-grid.js').then(m => m.saveScholarshipEdits()); },
    openScholarshipStudentDetail: function(arg){ import('../scholarship/scholarship-dashboard.js').then(m => m.openScholarshipStudentDetail(arg)); },
    downloadScholarshipReport: function(){ import('../scholarship/scholarship-dashboard.js').then(m => m.downloadScholarshipReport()); },
    downloadScholarshipCertificates: function(){ import('../scholarship/scholarship-audit-detail.js').then(m => m.downloadScholarshipCertificates()); },
    downloadDebugLog: function(arg, el, ev){ ev.preventDefault(); downloadDebugLog(); },
    exportComparisonReportPDF: function(){ import('../../bal/compare/compute-compare.js').then(m => m.exportComparisonReportPDF()); },
    exportSectionPDFs: function(){
      import('../../bal/compare/compute-compare.js').then(m => m.exportSectionPDFs($('#export-section-select').val()));
    },
    exportAllSectionsPDFs: function(){ import('../../bal/compare/compute-compare.js').then(m => m.exportAllSectionsPDFs()); },
    jumpFaqSeeFormulas: function(){
      goStep('faq');
      setTimeout(function(){
        var el2 = document.getElementById('faq-methodology');
        if (el2) { el2.open = true; el2.scrollIntoView({behavior:'smooth'}); }
      }, 60);
    },
    jumpFaqMethodology: function(arg, el, ev){
      ev.preventDefault();
      var el3 = document.getElementById('faq-methodology');
      if (el3) { el3.open = true; el3.scrollIntoView({behavior:'smooth'}); }
    },
    closeModal: function(){ closeModal(); },
    resolveConfirmModal: function(arg){ resolveConfirmModal(arg); },
    removeHomeCompareFile: function(arg){ import('../../bal/compare/compute-compare.js').then(m => m.removeHomeCompareFile(arg)); },
    resetHomeImport: function(){ resetHomeImport(); },
    selectCompareSection: function(arg){ import('../../bal/compare/compute-compare.js').then(m => m.selectCompareSection(arg)); },
    openBucket: function(arg){ openBucket(arg); },
    selectCompareGroup: function(arg){ import('../../bal/compare/compute-compare.js').then(m => m.selectCompareGroup(arg)); },
    openCrossSectionCompare: function(){ import('../../bal/compare/compute-compare.js').then(m => m.renderCrossSectionComparePicker()); },
    openIndividualBucket: function(arg){ openIndividualBucket(arg); },
    shareInsightAsImage: function(arg){ shareInsightAsImage(arg); },
    dismissSampleBanner: function(){
      APP._isSampleData = false;
      renderDashboardSampleBanner();
    },
    smartChatAskCanned: function(arg, el){
      smartChatAskCanned(arg, el.getAttribute('data-arg2'));
    },
    smartChatPickAmbiguousStudent: function(arg, el){
      smartChatPickAmbiguousStudent(arg, el.getAttribute('data-arg2'));
    },
    // The chat window's own Send button (renderDashboardSmartSearch()) is
    // data-action="smartChatSubmit" — Enter-to-submit is handled by the
    // dedicated keydown case below, not here (see its comment: inline
    // onkeydown="" on the input is CSP-blocked in this document).
    smartChatSubmit: function(){ smartChatSubmit(); },
    selectAllExpStudents: function(){ $('.exp-student-cb').prop('checked', true); },
    unselectAllExpStudents: function(){ $('.exp-student-cb').prop('checked', false); },
    selectAllScholarshipCertStudents: function(){ $('.scholarship-cert-cb').prop('checked', true); },
    unselectAllScholarshipCertStudents: function(){ $('.scholarship-cert-cb').prop('checked', false); },
    generateAllPDFs: function(){ import('../../bal/export/export-pdf.js').then(m => m.generateAllPDFs()); },
    selectContinuityPeriod: function(arg){ selectContinuityPeriod(Number(arg)); },
    selectContinuityStudent: function(arg){ selectContinuityStudent(arg); },
    deleteSubjectRow: function(arg, el){
      $(el).closest('.subj-row').remove();
      updateTestSubjectCols();
      markDirty();
      validateSetup();
    },
    deleteTestRow: function(arg, el){
      $(el).closest('.test-row-wrap').remove();
      markDirty();
      validateSetup();
    },
    confirmMergedDownload: function(){ confirmMergedDownload(); },
    goHomeAfterDownload: function(){ goHomeAfterDownload(); },
    stayAfterDownload: function(){ stayAfterDownload(); },
    toggleAI: function(arg, el){
      toggleAI(arg, el.closest('.ai-check-item') || el);
    },
    saveNarrativeField: function(arg, el){
      saveNarrativeField(arg, el.getAttribute('data-arg2'), el);
    },
    saveRemarkField: function(arg, el){
      saveRemarkField(arg, el.getAttribute('data-arg2'), el);
    },
    downloadUpdatedSheet: function(){ downloadUpdatedSheet(); },
    runSampleFile: function(arg){ runSampleFile([arg]); },
    deleteRecentFile: function(arg, el, ev){
      ev.stopPropagation();
      deleteRecentFile(arg);
    },
    runSampleFileCompareDemo: function(arg){ runSampleFile(arg ? arg.split(',') : []); },
    continueSampleNamesNotice: function(){ continueSampleNamesNotice(); },
    openFinding: function(arg, el){ openFinding(arg, el.getAttribute('data-arg2')); },
    onBucketStudentPick: function(arg){ onBucketStudentPick(arg); },
    onBucketSubjectPick: function(arg){ onBucketSubjectPick(arg); },
    clearPickerInput: function(arg, el){
      document.getElementById(arg).value = '';
      filterPickerList(el.getAttribute('data-arg2'), '');
    }
  };

  function dispatch(action, arg, el, ev){
    var handler = DISPATCH_ACTIONS[action];
    if (handler) { handler(arg, el, ev); return; }
    window.__unknownActions = window.__unknownActions || [];
    window.__unknownActions.push(action);
    if (window.SIA_DEBUG_LOG) console.log('inline-actions: unknown action', action);
  }

  // FIX (selection scroll, all across the app): every "selection" that
  // re-renders the middle content in place — pick a different student,
  // switch Compare sections/groups, open a different bucket/finding/
  // cluster/continuity period, ask a Smart Search follow-up, etc. — should
  // land the user at the TOP of that new content every single time, same
  // as the very first selection does. It only ever appeared to work once:
  // the page simply starts at scrollTop 0, so the first selection needed
  // no scrolling at all to "look right" — nothing was actually resetting
  // the scroll position. The moment the user scrolls down to read one
  // student/section and then picks another, there was no code anywhere
  // moving the view back to the top of the freshly-rendered content, so it
  // stayed wherever it happened to be (or the browser auto-clamped it to
  // some arbitrary point if the new content was shorter) — neither of
  // which puts the new content's title in view.
  // Every one of these interactions funnels through this one delegated
  // dispatch(), so this is the one place a general fix can live: reset the
  // scroll container to the top right after a listed selection action runs.
  // Deliberately excludes navigation (goStep and friends) — those already
  // land at the top of a brand-new panel on their own.
  var SCROLL_RESET_ACTIONS = {
    selectCompareSection: 1, selectCompareGroup: 1, openCrossSectionCompare: 1,
    openBucket: 1, openIndividualBucket: 1,
    switchDbTab: 1, setFilter: 1, sortStudents: 1,
    selectContinuityPeriod: 1, selectContinuityStudent: 1,
    onBucketStudentPick: 1, onBucketSubjectPick: 1, openFinding: 1
    // NB-6 (prompt.md §11.2): backToBuckets / backToBucketList removed from
    // the SCROLL_RESET_ACTIONS list along with the corresponding action
    // handlers above — bucket screen flow was replaced by the Dashboard
    // right-rail (PIB §6d).
    // smartChatAskCanned is deliberately NOT here: it appends to a running
    // chat/answer transcript and already scrolls itself to the BOTTOM (new
    // message) once its (deliberately delayed, ~300-500ms) answer bubble
    // lands — see smartChatScrollToBottom() in render-buckets.js. Forcing
    // scrollTop=0 here would only fight that a moment later. (Its former
    // siblings smartQueryRailAnswer/smartQueryRailAsk were removed
    // 2026-08-28 — confirmed-dead code, see core/vs-shell.js.)
  };
  // #main only actually scrolls at >768px (css/vs-shell.css); below that
  // it's height:auto and the page/body scrolls instead (see the mobile
  // block there), so the container to reset differs by viewport.
  function scrollContainerEl(){
    if (window.innerWidth <= 768) return document.scrollingElement || document.documentElement;
    return document.getElementById('main') || document.scrollingElement || document.documentElement;
  }
  function resetScrollToTop(){
    var sc = scrollContainerEl();
    if (sc) sc.scrollTop = 0;
  }

  document.addEventListener('click', function(ev){
    var el = ev.target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action');
    dispatch(action, el.getAttribute('data-arg'), el, ev);
    if (SCROLL_RESET_ACTIONS[action]) {
      // Reset now (covers the synchronous render), AND again after layout
      // has fully settled — Chart.js canvases, images, and similar resize
      // asynchronously and a real browser's default scroll-anchoring can
      // silently re-adjust scrollTop to compensate for that shift a beat
      // later, undoing an immediate-only reset. jsdom (used in this repo's
      // tests) doesn't model scroll anchoring at all, so this only shows
      // up in a real browser — the double-apply covers it either way.
      resetScrollToTop();
      var raf = window.requestAnimationFrame || function(cb){ return setTimeout(cb, 16); };
      raf(function(){ raf(resetScrollToTop); });
      setTimeout(resetScrollToTop, 150);
    }
  });

  var CHANGE_HANDLERS = {
    'country-select': function(el){ onCountryChange(el.value); },
    'language-select': function(el){ onLanguageChange(el.value); },
    'home-import-input': function(el){ handleHomeImportFiles(Array.from(el.files||[])); el.value=''; },
    'update-sheet-input': function(el){ handleUpdateUpload(el); },
    'inst-type': function(){ markDirty(); },
    'sc-marks': function(){ markDirty(); },
    'sc-pct': function(){ markDirty(); },
    'sc-grade': function(){ markDirty(); },
    'sc-pf': function(){ markDirty(); },
    'individual-student-select': function(el){ selectIndividualStudent(el.value); },
    'compare-pick-a': function(){ renderCompareResult(); },
    'compare-pick-b': function(){ renderCompareResult(); },
    'scholarship-status-filter': function(el){ import('../scholarship/scholarship-dashboard.js').then(m => m.setScholarshipStatusFilter(el.value)); },
    'scholarship-category-filter': function(el){ import('../scholarship/scholarship-dashboard.js').then(m => m.setScholarshipCategoryFilter(el.value)); },
    'scholarship-eligibility-type': function(){ markDirty(); validateScholarshipCriteria(); },
    'scholarship-no-fail-rule': function(){ markDirty(); }
  };

  // ---- Setup-screen live field sanitizers (fast bug-fix pass, screenshot
  // spec 2026-08-28) — pure string transforms + a cursor-preserving
  // applier, so each INPUT_HANDLER below stays a one-liner. ----
  function applyTransform(el, transformFn){
    var start = el.selectionStart, end = el.selectionEnd, oldLen = el.value.length;
    var next = transformFn(el.value);
    if (next === el.value) return;
    el.value = next;
    var diff = next.length - oldLen;
    try { el.setSelectionRange(start + diff, end + diff); } catch (e) {}
  }
  // Institution/Student Name: strip anything but letters/spaces/'-./&,
  // title-case each word. No length cap — "whatever he will enter we
  // accept it" per spec, just no special chars and consistent casing.
  function sanitizeProperName(v){
    v = v.replace(/[^A-Za-z\s'.-]/g, "").replace(/ {2,}/g, " ");
    return v.split(" ").map(function(w){ return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w; }).join(" ");
  }
  // Class/Batch/Semester: letters/digits/spaces/'-'/'&' only. A bare number
  // (e.g. "6") gets the standard "Class-" keyword prefixed. Otherwise the
  // first letter is capitalized, and a dash is inserted between a letter
  // block and a directly-following digit block (e.g. "sem2" -> "Sem-2").
  function sanitizeClassBatch(v){
    v = v.replace(/[^A-Za-z0-9\s&-]/g, "");
    var trimmed = v.trim();
    if (!trimmed) return v;
    if (/^[0-9]+$/.test(trimmed)) return "Class-" + trimmed;
    v = v.charAt(0).toUpperCase() + v.slice(1);
    v = v.replace(/([A-Za-z])(\d)/, "$1-$2");
    return v;
  }
  // Section: at most one letter, forced uppercase — any other input
  // (numbers, symbols, multiple letters) is simply not real section data.
  function sanitizeSection(v){
    var m = v.match(/[A-Za-z]/);
    return m ? m[0].toUpperCase() : "";
  }
  // Academic Year: digits and '-' only (2026, 2026-27, 2026-2027).
  function sanitizeYear(v){ return v.replace(/[^0-9-]/g, ""); }
  // Scheme Name / custom Eligibility Type text: alphanumeric + spaces +
  // '-' only (length already capped by the field's maxlength attribute).
  function sanitizeSchemeStyle(v){ return v.replace(/[^A-Za-z0-9\s-]/g, ""); }
  // Subject/Test names: alphanumeric + spaces + '-' only, 20-char cap,
  // first letter capitalized.
  function sanitizeShortName(v){
    v = v.replace(/[^A-Za-z0-9\s-]/g, "").slice(0, 20);
    return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
  }
  // Numeric setup fields: digits only, optional digit-count cap, optional
  // max value clamp (Min Academic Avg/Attendance Floor/Category Quota/
  // Weightages all reuse this with different limits).
  function clampNumeric(el, maxDigits, maxVal){
    var v = el.value.replace(/[^0-9]/g, "");
    if (maxDigits) v = v.slice(0, maxDigits);
    if (v && maxVal != null && parseInt(v, 10) > maxVal) v = String(maxVal);
    if (v !== el.value) el.value = v;
  }
  var PHONE_RE = /^\+?[0-9\s()-]+$/;
  function isValidPhone(v){ var digits = v.replace(/\D/g, ""); return PHONE_RE.test(v) && digits.length >= 7 && digits.length <= 15; }
  function isValidEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  var INPUT_HANDLERS = {
    'inst-name': function(el){ applyTransform(el, sanitizeProperName); markDirty(); validateSetup(); },
    'inst-location': function(){ markDirty(); },
    // Contact: optional, but if filled must be a clean phone OR a clean
    // email — never a half-typed mix of both. No live transform (can't
    // safely "correct" a phone/email keystroke-by-keystroke); just gate
    // with a visible error state, same red-border pattern err-inst-name
    // already uses.
    'inst-contact': function(el){
      markDirty();
      var v = el.value.trim();
      var ok = !v || isValidPhone(v) || isValidEmail(v);
      var errEl = document.getElementById('err-inst-contact');
      if (errEl) errEl.style.display = ok ? 'none' : '';
      el.style.borderColor = ok ? '' : 'var(--c-danger)';
    },
    'class-name': function(el){ applyTransform(el, sanitizeClassBatch); markDirty(); validateSetup(); },
    'class-section': function(el){ applyTransform(el, sanitizeSection); markDirty(); },
    'class-year': function(el){ applyTransform(el, sanitizeYear); markDirty(); validateSetup(); },
    'class-teacher': function(){ markDirty(); },
    'pass-threshold': function(){ markDirty(); },
    'absent-alert': function(){ markDirty(); },
    'drop-alert': function(){ markDirty(); },
    'bulk-sections-toggle': function(el){ toggleBulkSectionsUI(el.checked); },
    'scholarship-enable': function(el){ toggleScholarshipUI(el.checked); },
    'scholarship-scheme-name': function(el){ applyTransform(el, sanitizeSchemeStyle); markDirty(); validateScholarshipCriteria(); },
    'scholarship-min-academic-avg': function(el){ clampNumeric(el, 3, 100); markDirty(); validateScholarshipCriteria(); },
    'scholarship-max-family-income': function(el){ clampNumeric(el, 7, null); markDirty(); validateScholarshipCriteria(); },
    'scholarship-attendance-floor': function(el){ clampNumeric(el, 3, 365); markDirty(); validateScholarshipCriteria(); },
    'scholarship-category-quota': function(el){ clampNumeric(el, 3, 100); markDirty(); validateScholarshipCriteria(); },
    'scholarship-weightage-academic': function(el){ clampNumeric(el, 3, 100); markDirty(); validateScholarshipCriteria(); },
    'scholarship-weightage-consistency': function(el){ clampNumeric(el, 3, 100); markDirty(); validateScholarshipCriteria(); },
    'scholarship-weightage-growth': function(el){ clampNumeric(el, 3, 100); markDirty(); validateScholarshipCriteria(); },
    'search-student': function(){ filterStudents(); },
    'scholarship-search-input': function(el){ import('../scholarship/scholarship-dashboard.js').then(m => m.setScholarshipSearch(el.value)); },
    'faq-search': function(el){ filterFAQ(el.value); },
    'target-score-input': function(el){ setTargetScore(el.getAttribute('data-arg'), el.value); },
    'bucket-help-input': function(el){ filterPickerList('bucket-help-results', el.value); },
    'bucket-student-input': function(el){ filterPickerList('bucket-student-results', el.value); },
    'bucket-subject-input': function(el){ filterPickerList('bucket-subject-results', el.value); }
  };

  // Generic data-*-action delegated wiring for dynamically-generated
  // controls that can't use a fixed id (per-row/per-section markup —
  // compare section labels, subject/test setup rows, the continuity
  // projection toggle). Mirrors the click/data-action pattern above:
  // data-input-action + data-arg for 'input' events, data-change-action +
  // data-arg for 'change' events. Values are read from the live element
  // (el.value/el.checked) rather than being baked into a JS string, so
  // nothing here ever needs inline script.
  var GENERIC_INPUT_ACTIONS = {
    setTargetScore: function(arg, el){ setTargetScore(arg, el.value); },
    renameHomeCompareFile: function(arg, el){ import('../../bal/compare/compute-compare.js').then(m => m.renameHomeCompareFile(arg, el.value)); },
    updateTestSubjectCols: function(arg, el){
      applyTransform(el, sanitizeShortName);
      updateTestSubjectCols();
      markDirty();
      validateSetup();
    },
    markDirtyValidate: function(arg, el){
      // Shared by test-name-inp (sanitize) and test-date-inp (no text to
      // sanitize, .type="date" has no .value chars to strip) — the
      // sanitizer is a no-op on a date input's value format either way.
      if (el.classList && el.classList.contains('test-name-inp')) applyTransform(el, sanitizeShortName);
      markDirty();
      validateSetup();
    },
    markDirty: function(){ markDirty(); },
    narrativeEdit: function(arg, el){
      $(el).next('.narrative-save-row').find('button').prop('disabled', false);
    },
    remarkEdit: function(arg, el){
      $(el).next('.narrative-save-row').find('button').prop('disabled', false);
      updateRemarkCharCount(el);
    },
    scholarshipCellEdit: function(arg, el){
      // Bug fix (same pass as the Setup screen fields): Edit Data grid
      // cells got the same live-sanitizing treatment as their Setup
      // counterparts — income is numeric-only, everything else here is
      // free text but still shouldn't accept special-character garbage.
      var seField = el.getAttribute('data-arg2');
      if (seField === 'annualFamilyIncome') {
        // 999999999 upper bound matches INCOME_MAX in
        // ui/scholarship/scholarship-edit-grid.js's cellHtml().
        clampNumeric(el, 9, 999999999);
      } else if (seField === 'guardianOccupation') {
        applyTransform(el, sanitizeProperName);
      } else if (seField === 'category' || seField === 'priorScholarshipStatus' || seField === 'specialCategoryFlag' || seField === 'persistentStudentId') {
        applyTransform(el, sanitizeSchemeStyle);
      }
      import('../scholarship/scholarship-edit-grid.js').then(m => m.onScholarshipCellEdit(arg, seField, el));
    }
  };
  function genericInputDispatch(action, arg, el){
    var handler = GENERIC_INPUT_ACTIONS[action];
    if (handler) { handler(arg, el); return; }
    window.__unknownActions = window.__unknownActions || [];
    window.__unknownActions.push(action);
    if (window.SIA_DEBUG_LOG) console.log('inline-actions: unknown input action', action);
  }

  var GENERIC_CHANGE_ACTIONS = {
    renderCompareResult: function(){ renderCompareResult(); },
    crossCompareStudentChange: function(){ import('../../bal/compare/compute-compare.js').then(m => m.renderCrossSectionCompareResult()); },
    toggleContinuityProjection: function(arg, el){ toggleContinuityProjection(el.checked); },
    toggleMmSubject: function(arg, el){ toggleMmSubject(el); }
  };
  function genericChangeDispatch(action, arg, el){
    var handler = GENERIC_CHANGE_ACTIONS[action];
    if (handler) { handler(arg, el); return; }
    window.__unknownActions = window.__unknownActions || [];
    window.__unknownActions.push(action);
    if (window.SIA_DEBUG_LOG) console.log('inline-actions: unknown change action', action);
  }

  document.addEventListener('change', function(ev){
    var fn = CHANGE_HANDLERS[ev.target.id];
    if (fn) { fn(ev.target); return; }
    var el = ev.target.closest('[data-change-action]');
    if (el) genericChangeDispatch(el.getAttribute('data-change-action'), el.getAttribute('data-arg'), el);
  });

  document.addEventListener('input', function(ev){
    var fn = INPUT_HANDLERS[ev.target.id];
    if (fn) { fn(ev.target); return; }
    var el = ev.target.closest('[data-input-action]');
    if (el) genericInputDispatch(el.getAttribute('data-input-action'), el.getAttribute('data-arg'), el);
  });

  document.addEventListener('keydown', function(ev){
    var tabEl = ev.target.closest('.db-tab[data-action]');
    if (tabEl) { dbTabKeyNav(ev, tabEl); return; }
    // FIX: the chat composer's Enter-to-submit was written as an inline
    // onkeydown="" attribute on the <input> (js/render-buckets.js
    // renderDashboardSmartSearch()) — this document's own CSP has no
    // 'unsafe-inline' in script-src (see the CSP <meta> in index.html and
    // its "no per-element inline JS is left anywhere in this document"
    // comment), so the browser silently drops that attribute and Enter
    // does nothing. Delegated here instead, same pattern as every other
    // keyed handler in this file.
    if (ev.key === 'Enter' && ev.target.id === 'chat-composer-input') {
      ev.preventDefault();
      smartChatSubmit();
      return;
    }
    // BUG FIX (keyboard-flow request): plain text/number/date <input>
    // fields inside Setup (and any other form) had no Enter behavior, so
    // a keyboard-only user hit Enter and nothing happened — forcing a
    // reach for the mouse (or Tab, which some users don't expect either).
    // Enter now advances to the next focusable field in DOM order, same
    // as Tab, for the common single-line input types. Buttons/textareas/
    // selects are excluded — Enter has other native meaning there
    // (activate / newline / native dropdown), and the chat composer above
    // already has its own Enter behavior.
    if (ev.key === 'Enter') {
      var tgt = ev.target;
      var tag = tgt.tagName;
      var isPlainInput = tag === 'INPUT' && ['text','number','date','email','tel','search'].indexOf((tgt.type||'text').toLowerCase()) !== -1;
      if (isPlainInput) {
        var focusables = Array.prototype.slice.call(
          document.querySelectorAll('a[href],button:not([disabled]),textarea,input:not([disabled]),select,[tabindex]:not([tabindex="-1"])')
        ).filter(function(el){ return el.offsetParent !== null; }); // visible only
        var idx = focusables.indexOf(tgt);
        if (idx !== -1) {
          ev.preventDefault();
          var next = focusables[idx + 1];
          if (next) next.focus();
        }
        return;
      }
    }
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var btn = ev.target.closest('[role="button"][data-action]');
    if (!btn) return;
    // Only role="button" elements reach here (native <button>/<input>
    // controls already get their own default Enter/Space activation from
    // the browser and are excluded by the selector above), so calling
    // .click() here can't double-trigger a native control.
    ev.preventDefault();
    btn.click();
  });

  var dropZone = document.getElementById('home-drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragover', function(ev){ ev.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', function(){ dropZone.classList.remove('drag-over'); });
    dropZone.addEventListener('drop', function(ev){
      ev.preventDefault();
      dropZone.classList.remove('drag-over');
      handleHomeImportFiles(Array.from((ev.dataTransfer && ev.dataTransfer.files) || []));
    });
  }
})();
