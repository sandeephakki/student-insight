import { switchDbTab, toggleTrust, validateSetup } from './app-utils-init.js';
import { exportAllSectionsPDFs, exportComparisonReportPDF, exportSectionPDFs, removeHomeCompareFile, selectCompareGroup, selectCompareSection } from './compute-compare.js';
import { runAnalysis } from './compute-stats.js';
import { selectContinuityPeriod, selectContinuityStudent } from './continuity-dashboard.js';
import { generateAllPDFs } from './export-pdf.js';
import { addSubject, addTest, filterFAQ, markDirty, setUsageMode, startNewSession, updateTestSubjectCols } from './project-setup.js';
import { backToBucketList, backToBuckets, openBucket, openIndividualBucket, renderDashboardSampleBanner, smartChatAskCanned, smartChatSubmit } from './render-buckets.js';
import { closeModal, dbTabKeyNav, downloadUpdatedSheet, filterStudents, runSampleFile, saveNarrativeField, saveRemarkField, selectIndividualStudent, setFilter, showSampleFiles, sortStudents } from './render-core.js';
import { filterPickerList, onBucketStudentPick, onBucketSubjectPick, openFinding } from './render-findings.js';
import { shareInsightAsImage } from './render-i18n.js';
import { swBack, swNext, swRefresh } from './setup-wizard.js';
import { APP, goStep, onCountryChange, onLanguageChange, setThemeChoice } from './state-nav.js';
import { cancelMergeMode, chooseMergeFork, confirmMergedDownload, generateTemplate, handleHomeImportFiles, handleUpdateUpload, toggleAI, toggleBulkSectionsUI } from './template-upload.js';
import { smartQueryRailAnswer, smartQueryRailAsk, vsShellToggle } from './vs-shell.js';

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

  function dispatch(action, arg, el, ev){
    switch(action){
      case 'setThemeChoice': setThemeChoice(arg); break;
      case 'goStep': goStep(arg); break;
      case 'showSampleFiles': showSampleFiles(); break;
      case 'vsShellToggle': vsShellToggle(arg); break;
      case 'toggleTrust': toggleTrust(arg); break;
      case 'triggerHomeImport':
        document.getElementById('home-import-input').click();
        break;
      case 'runAnalysis': runAnalysis(); break;
      case 'startNewSessionCard':
        startNewSession();
        APP.setupCard1Choice = 'new';
        if (typeof swRefresh === 'function') swRefresh();
        break;
      case 'triggerUpdateImport':
        APP.setupCard1Choice = 'update';
        document.getElementById('update-sheet-input').click();
        break;
      case 'cancelMergeMode': cancelMergeMode(); break;
      case 'chooseMergeFork': chooseMergeFork(arg); break;
      case 'swNext': swNext(); break;
      case 'swBack': swBack(); break;
      case 'setUsageMode': setUsageMode(arg); break;
      case 'addSubjectAndValidate':
        addSubject();
        validateSetup();
        break;
      case 'addTestAndValidate':
        addTest();
        validateSetup();
        break;
      case 'generateTemplate': generateTemplate(); break;
      case 'setFilter': setFilter(arg, el); break;
      case 'sortStudents': sortStudents(arg); break;
      case 'switchDbTab': switchDbTab(arg, el); break;
      case 'exportComparisonReportPDF': exportComparisonReportPDF(); break;
      case 'exportSectionPDFs':
        exportSectionPDFs($('#export-section-select').val());
        break;
      case 'exportAllSectionsPDFs': exportAllSectionsPDFs(); break;
      case 'jumpFaqSeeFormulas':
        goStep('faq');
        setTimeout(function(){
          var el2 = document.getElementById('faq-methodology');
          if (el2) { el2.open = true; el2.scrollIntoView({behavior:'smooth'}); }
        }, 60);
        break;
      case 'jumpFaqMethodology':
        ev.preventDefault();
        var el3 = document.getElementById('faq-methodology');
        if (el3) { el3.open = true; el3.scrollIntoView({behavior:'smooth'}); }
        break;
      case 'closeModal': closeModal(); break;
      case 'removeHomeCompareFile': removeHomeCompareFile(arg); break;
      case 'selectCompareSection': selectCompareSection(arg); break;
      case 'openBucket': openBucket(arg); break;
      case 'selectCompareGroup': selectCompareGroup(arg); break;
      case 'openIndividualBucket': openIndividualBucket(arg); break;
      case 'shareInsightAsImage': shareInsightAsImage(arg); break;
      case 'dismissSampleBanner':
        APP._isSampleData = false;
        renderDashboardSampleBanner();
        break;
      case 'smartChatAskCanned':
        smartChatAskCanned(arg, el.getAttribute('data-arg2'));
        break;
      // The chat window's own Send button (renderDashboardSmartSearch()) is
      // data-action="smartChatSubmit" — Enter-to-submit is handled by the
      // dedicated keydown case above, not here (see its comment: inline
      // onkeydown="" on the input is CSP-blocked in this document).
      case 'smartChatSubmit': smartChatSubmit(); break;
      case 'selectAllExpStudents': $('.exp-student-cb').prop('checked', true); break;
      case 'unselectAllExpStudents': $('.exp-student-cb').prop('checked', false); break;
      case 'generateAllPDFs': generateAllPDFs(); break;
      case 'smartQueryRailAnswer': smartQueryRailAnswer(arg); break;
      case 'smartQueryRailAsk': smartQueryRailAsk(); break;
      case 'selectContinuityPeriod': selectContinuityPeriod(Number(arg)); break;
      case 'selectContinuityStudent': selectContinuityStudent(arg); break;
      case 'deleteSubjectRow':
        $(el).closest('.subj-row').remove();
        updateTestSubjectCols();
        markDirty();
        validateSetup();
        break;
      case 'deleteTestRow':
        $(el).closest('.test-row-wrap').remove();
        markDirty();
        validateSetup();
        break;
      case 'confirmMergedDownload': confirmMergedDownload(); break;
      case 'toggleAI':
        toggleAI(arg, el.closest('.ai-check-item') || el);
        break;
      case 'saveNarrativeField':
        saveNarrativeField(arg, el.getAttribute('data-arg2'), el);
        break;
      case 'saveRemarkField':
        saveRemarkField(arg, el.getAttribute('data-arg2'), el);
        break;
      case 'downloadUpdatedSheet': downloadUpdatedSheet(); break;
      case 'runSampleFile': runSampleFile([arg]); break;
      case 'runSampleFileCompareDemo': runSampleFile(arg ? arg.split(',') : []); break;
      case 'backToBuckets': backToBuckets(); break;
      case 'backToBucketList': backToBucketList(); break;
      case 'openFinding': openFinding(arg, el.getAttribute('data-arg2')); break;
      case 'onBucketStudentPick': onBucketStudentPick(arg); break;
      case 'onBucketSubjectPick': onBucketSubjectPick(arg); break;
      case 'clearPickerInput':
        document.getElementById(arg).value = '';
        filterPickerList(el.getAttribute('data-arg2'), '');
        break;
      default:
        window.__unknownActions = window.__unknownActions || [];
        window.__unknownActions.push(action);
        if (window.SIA_DEBUG_LOG) console.log('inline-actions: unknown action', action);
    }
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
    selectCompareSection: 1, selectCompareGroup: 1,
    openBucket: 1, openIndividualBucket: 1,
    switchDbTab: 1, setFilter: 1, sortStudents: 1,
    selectContinuityPeriod: 1, selectContinuityStudent: 1,
    onBucketStudentPick: 1, onBucketSubjectPick: 1, openFinding: 1,
    backToBuckets: 1, backToBucketList: 1
    // smartChatAskCanned / smartQueryRailAnswer / smartQueryRailAsk are
    // deliberately NOT here: those append to a running chat/answer
    // transcript and already scroll themselves to the BOTTOM (new
    // message) once their (deliberately delayed, ~300-500ms) answer
    // bubble lands — see smartChatScrollToBottom() in render-buckets.js.
    // Forcing scrollTop=0 here would only fight that a moment later.
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
    'individual-student-select': function(el){ selectIndividualStudent(el.value); }
  };

  var INPUT_HANDLERS = {
    'inst-name': function(){ markDirty(); validateSetup(); },
    'inst-location': function(){ markDirty(); },
    'inst-contact': function(){ markDirty(); },
    'class-name': function(){ markDirty(); validateSetup(); },
    'class-section': function(){ markDirty(); },
    'class-year': function(){ markDirty(); validateSetup(); },
    'class-teacher': function(){ markDirty(); },
    'pass-threshold': function(){ markDirty(); },
    'absent-alert': function(){ markDirty(); },
    'drop-alert': function(){ markDirty(); },
    'bulk-sections-toggle': function(el){ toggleBulkSectionsUI(el.checked); },
    'search-student': function(){ filterStudents(); },
    'faq-search': function(el){ filterFAQ(el.value); }
  };

  document.addEventListener('change', function(ev){
    var fn = CHANGE_HANDLERS[ev.target.id];
    if (fn) fn(ev.target);
  });

  document.addEventListener('input', function(ev){
    var fn = INPUT_HANDLERS[ev.target.id];
    if (fn) fn(ev.target);
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
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var btn = ev.target.closest('[role="button"][data-action]');
    if (!btn) return;
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
