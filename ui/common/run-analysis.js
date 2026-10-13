import { startAiLoaderCardCycle, stopAiLoaderCardCycle } from '../../core/app-utils-init.js';
import { toast } from '../../core/dom-helpers.js';
import { collectSetupForm, markClean, unlockStep } from '../../core/project-setup.js';
import { confirmModal, updateExportGate } from './render-core.js';
import { srT } from '../../core/render-i18n.js';
import { APP } from '../../core/app-state.js';
import { goStep } from '../../core/state-nav.js';
import { autoInferSetup, selectAllAI } from '../../core/template-upload.js';
import { computeAnalysis, computeGenderAnalysis, parseStudents, takeParseNotices, validateData } from '../../bal/common/compute-stats.js';
import { sleep, scrollToEl } from '../../core/async-utils.js';
import { esc } from '../../core/dom-helpers.js';
import { provide } from '../../core/ports.js';

// Moved from bal/common/compute-stats.js — this is the UI orchestrator
// (loader, toasts, nav), not business logic, so it lives in the UI layer.
// Body unchanged (incl. the intentional fake-progress loader).
async function runAnalysis(){
  const _runBtn=document.getElementById("btn-home-run-analysis");
  // M1 fix (robustness audit): guard against double-submit (fast re-click /
  // slow mobile double-tap) re-entering this function before the first run
  // finishes. Disabled here, unconditionally re-enabled in the finally below
  // so an exception mid-run (see the global error handler in
  // app-utils-init.js) can never leave it stuck disabled.
  if(_runBtn){if(_runBtn.disabled)return;_runBtn.disabled=true;}
  _runBtn?.classList.remove("btn-glow");
  try{
    if(APP.compareMode){const { runCompareAnalysisCore } = await import('../compare/compare-ui.js');await runCompareAnalysisCore();return;}
    if(!APP.rawData){toast(srT("val_upload_data_first"),"warn");return;}
    // Only collect from form if the form has been filled (has subjects in DOM)
    // Otherwise keep APP.setup as loaded from Excel import
    const domSubjects=$("#subjects-list .subj-row input").map(function(){return $(this).val().trim();}).get().filter(Boolean);
    if(domSubjects.length){collectSetupForm();}
    if(!APP.setup.subjects.length||!APP.setup.tests.length){autoInferSetup();}
    if(!APP.setup.subjects.length){const isIndividual=APP.setup.mode==="individual";toast(isIndividual?srT("val_cant_find_subjects_individual"):srT("val_cant_detect_subjects"),"warn");return;}
    if(!APP.setup.tests.length){const isIndividual=APP.setup.mode==="individual";toast(isIndividual?srT("val_cant_find_tests_individual"):srT("val_cant_detect_tests"),"warn");return;}
    if(!APP.aiFeatures.size)selectAllAI();
    // Data validation
    const _vw=await validateData();
    if(_vw.some(w=>w.e)){
      const vhtml=_vw.map(w=>`<div style="padding:5px 0;font-size:12px"><span style="color:${w.e?'var(--c-danger)':'var(--c-warn)'}">●</span> ${esc(w.m)}</div>`).join("");
      const el=document.getElementById("validation-warnings");
      if(el){el.innerHTML=`<div class="card" style="border-color:var(--c-danger);margin-bottom:12px"><b style="color:var(--c-danger)">${esc(srT("val_data_errors_found"))}</b>${vhtml}</div>`;el.style.display="block";}
      // v2.4: the Analyse/checkbox screen is no longer visited by default —
      // if analysis can't proceed, surface it there anyway (it still exists,
      // it's just not the default stop) rather than failing silently on
      // whatever screen the user happened to be on when this ran.
      goStep("ai");
      toast(srT("val_fix_data_errors_below"),"error");
      return;
    }
    const _warnings=_vw.filter(w=>!w.e);
    if(_warnings.length){
      const el=document.getElementById("validation-warnings");
      if(el){el.innerHTML=`<div class="card" style="border-color:var(--c-warn);margin-bottom:12px"><b style="color:var(--c-warn)">⚠ ${esc(srT("val_data_warnings_will_proceed"))}</b>`+_warnings.map(w=>`<div style="font-size:12px;margin-top:4px">● ${esc(w.m)}</div>`).join("")+`</div>`;el.style.display="block";}
    } else {const el=document.getElementById("validation-warnings");if(el)el.style.display="none";}
    // Nothing else stops a workbook with thousands of rows from freezing the
    // tab — computeAnalysis() and renderStudentCards() both run synchronously
    // over every student. Estimate the row count up front (before the heavier
    // parse/compute work below) and give the teacher a heads-up, since this
    // app's stated target environment is often lower-end classroom hardware.
    const _estMarkKey=Object.keys(APP.rawData).find(k=>k.includes("MARK"))||"";
    const estStudentRows=(APP.rawData["MARKS+CONTEXT"]||APP.rawData["MARKS_CONTEXT"]||APP.rawData[_estMarkKey]||[]).length;
    if(estStudentRows>1500){
      if(!(await confirmModal(srT("val_confirm_large_file",{n:estStudentRows}))))return;
    } else if(estStudentRows>300){
      toast(srT("val_large_class_detected",{n:estStudentRows}),"warn");
    }
    goStep("ai"); // v2.4: bring the loader on-screen even though this step is no longer a manual stop in the normal flow
    $("#ai-loader").show();
    startAiLoaderCardCycle();
    // btn-analyse / phase-actionbar-btns removed (v3.2) — panel-ai is now a pure progress screen, nothing to disable.
    // Bring the loader into view (respecting the fixed header) so the user
    // actually sees the progress instead of staring at a checkbox list that
    // looks frozen while work happens off-screen above them.
    scrollToEl(document.getElementById("ai-loader"));
    // Restored (was dropped by a since-reverted "honest 2-phase" P1 #4
    // cleanup that replaced this with just 2 real-work steps): the original
    // multi-step "processing" screen — a fixed sequence of labelled steps
    // with a short animated delay on each, purely cosmetic (the real work
    // — parseStudents()/computeAnalysis()/computeGenderAnalysis() below —
    // finishes almost instantly on typical class-sized files) so the
    // teacher sees visible, step-by-step progress instead of the loader
    // flashing past in well under a second. Re-added on request — see the
    // matching bug-fix note this replaces.
    const steps=[srT("loading_reading_file"),srT("loading_parsing_records"),srT("loading_computing_marks"),srT("loading_trend_detection"),srT("loading_percentile_ranks"),srT("loading_detecting_support"),srT("loading_sentiment_analysis"),srT("loading_stress_wellbeing"),srT("loading_ai_insights"),srT("loading_next_test_trajectory"),srT("loading_finalising")];
    for(let i=0;i<steps.length;i++){
      $("#ai-loader-msg").text(steps[i]);
      $("#ai-loader-step").text("Step "+(i+1)+" of "+steps.length);
      const pct=Math.round(((i+1)/steps.length)*100);
      $("#ai-prog").css("transform","scaleX("+(pct/100)+")");$("#ai-prog-label").text(pct+"%");
      await sleep(420+Math.random()*280);
    }
    parseStudents();takeParseNotices().forEach(n=>toast(n.msg,n.type));
    // CONTINUITY: a multi-period roster (STUDENTS tab) can include
    // students who left before the current/last period — parseStudents()
    // still creates an entry for them (empty testData), which would
    // otherwise show up as a broken "0%, every subject missing" student
    // in the CURRENT period's full detailed analysis. Drop those before
    // computeAnalysis() runs; they still appear correctly in the
    // Continuity tab's own roster/timeline (APP.continuity, built
    // separately in parseContinuityPeriods()) via their pctByPeriod gaps.
    // No-op for every non-continuity file (APP.setup.periodCount unset).
    if(APP.setup.periodCount>1){
      APP.students=APP.students.filter(st=>Object.values(st.testData||{}).some(td=>td&&Object.keys(td.marks||{}).length));
    }
    // BUG FIX: parseStudents() drops untouched SAMPLE-1..5 rows (see its own
    // comment above), which is correct when real students exist alongside
    // them — but a file that's ONLY the untouched template (every roster row
    // still a sample) now has zero students at this point. Nothing below
    // here checked for that, so computeAnalysis() ran over an empty array
    // and goStep("dashboard") on the last line fired unconditionally,
    // landing the teacher on a blank dashboard with no error shown.
    if(!APP.students.length){
      $("#ai-loader").hide();
      stopAiLoaderCardCycle();
      const el=document.getElementById("validation-warnings");
      if(el){el.innerHTML=`<div class="card" style="border-color:var(--c-danger)"><b style="color:var(--c-danger)">${esc(srT("val_no_student_rows_students_tab"))}</b></div>`;el.style.display="block";}
      goStep("ai");
      toast(srT("val_no_student_rows_students_tab"),"error");
      return;
    }
    await computeAnalysis();await computeGenderAnalysis();
    $("#ai-loader").hide();
    stopAiLoaderCardCycle();
    // btn-analyse / phase-actionbar-btns removed (v3.2) — panel-ai is now a pure progress screen, nothing to re-enable.
    if(APP.students.length){unlockStep("dashboard");unlockStep("export");}
    updateExportGate();
    // GOTCHA FIX (v4.3): markClean() existed but was never called anywhere,
    // so the #unsaved-dot lit on the first Setup edit and stayed lit for the
    // rest of the session regardless of what happened after. Product
    // decision: a completed analysis is the point the current Setup form
    // values get captured into something the user can actually see (the
    // dashboard about to render) — same idea as a "save," for an app with
    // no persistence. Editing Setup again after this still re-dirties via
    // the existing markDirty() calls, so the dot stays meaningful.
    markClean();
    // BUG FIX: openBucket(APP._currentBucketId||"class") in renderBuckets()
    // already defaults to Class when nothing is set — but nothing here ever
    // cleared a stale id left over from a previous run (e.g. "top"/"help"/a
    // student), so re-running analysis reopened whatever bucket was last
    // viewed instead of Class. Compare mode already resets this on its own
    // re-entry points (compute-compare.js); this path never did.
    APP._currentBucketId=null;
    // NB-4 (prompt.md §11.2): dropped the silently-ignored 3rd toast arg —
    // toast() signature is (msg, type) and never read a count.
    toast(srT("toast_analysis_complete",{n:APP.students.length}),"success");goStep("dashboard");
  } finally {
    if(_runBtn)_runBtn.disabled=false;
  }
}

export { runAnalysis };
if(typeof window!=='undefined'){window.runAnalysis=runAnalysis;}

// Ports other modules call into (see core/ports.js).
provide({ runAnalysis });
