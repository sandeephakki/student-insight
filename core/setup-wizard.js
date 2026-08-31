import { validateSetup } from '../core/app-utils-init.js';
import { collectScholarshipForm, collectSetupForm } from './project-setup.js';
import { APP } from '../core/state-nav.js';
import { srT } from '../core/render-i18n.js';
import { generateTemplate, updateAndDownloadScholarshipSetup, validateScholarshipCriteria } from './template-upload.js';
import { renderShellRightRail } from '../core/vs-shell.js';

/* ════ SETUP WIZARD (studin-setup-redesign-prompt v2.0) ════
   Navigation-only layer over the existing #panel-setup fields. No business
   logic, no analysis — collectSetupForm()/validateSetup()/generateTemplate()
   etc. are untouched and still do all the real work. This file just
   controls which of the 4 step divs (#sw-step-1..4) is visible, the
   progress dots, and per-step "can I move forward" gating. */

function swGoto(n){
  n=Math.max(1,Math.min(4,n));
  APP.setupWizardStep=n;
  $(".sw-step").hide();
  $("#sw-step-"+n).show();
  // BUG FIX (3-scenario spec): Step 3's Next button doubles as "Update and
  // Download" for the Setup-first scholarship flow (enableScholarshipAndOpenGrid()
  // in scholarship-nav.js) — swapped here rather than at that one call site
  // so the label self-corrects on every entry into Step 3, from either
  // path, instead of needing a matching reset wired into every possible
  // way to leave/re-enter it.
  if(n===3){
    const nextBtn=document.getElementById("sw-step3-next-btn");
    const label=nextBtn&&nextBtn.querySelector("span");
    if(label){
      const key=APP._scholarshipPendingFromExisting?"scholarship_setup_update_download_btn":"setup_btn_next";
      label.setAttribute("data-i18n",key);
      label.textContent=srT(key);
    }
  }
  const panel=document.getElementById("panel-setup");
  if(panel) panel.scrollTop=0;
  window.scrollTo(0,0);
  swRefresh();
  // vs-shell-plan-v2 Task 5: keep the right-rail step-progress in sync
  // (goStep() only fires once on entering Setup, not on every internal step).
  if(typeof renderShellRightRail==="function" && APP.currentStep==="setup") renderShellRightRail("setup");
}

function swNext(){
  const n=APP.setupWizardStep||1;
  const res=swValidateStep(n);
  const errEl=document.getElementById("sw-err-"+n);
  if(!res.ok){
    if(errEl){ errEl.textContent=res.msg; errEl.style.display=""; }
    if(n===2||n===3) validateSetup(); // light up field-level errors too
    return;
  }
  if(errEl) errEl.style.display="none";
  // BUG FIX (3-scenario spec — Setup-first flow): enableScholarshipAndOpenGrid()
  // (scholarship-nav.js) routes here instead of silently defaulting the
  // scheme and jumping straight to the grid, so an admin enabling
  // Scholarship on an already-loaded file fills in the SAME Scholarship
  // Criteria form/validation the new-template path uses. Once Step 3
  // passes validation here, persist ONLY the scholarship sub-object
  // (collectScholarshipForm(), not the full collectSetupForm() — see that
  // function's own header comment on why), then hand off to
  // updateAndDownloadScholarshipSetup() (template-upload.js) — which
  // regenerates the SETUP sheet into both APP.rawWorkbook AND a fresh
  // backup+zip download, then shows the "what to do next" pop-up (closing
  // it, any way, reloads the tool back to Home) — rather than jumping to
  // the grid immediately ourselves.
  if(n===3 && APP._scholarshipPendingFromExisting){
    APP._scholarshipPendingFromExisting=false;
    APP.setup.scholarship=collectScholarshipForm();
    // Button reverts to plain "Next" immediately — the flag above is now
    // false, but nothing else re-runs swGoto(3) to pick that up unless the
    // admin backs out and returns to this step later.
    const nextBtn=document.getElementById("sw-step3-next-btn");
    const label=nextBtn&&nextBtn.querySelector("span");
    if(label){ label.setAttribute("data-i18n","setup_btn_next"); label.textContent=srT("setup_btn_next"); }
    updateAndDownloadScholarshipSetup();
    return;
  }
  swGoto(n+1);
}

function swBack(){
  swGoto((APP.setupWizardStep||1)-1);
}

// Called by validateSetup() (and swGoto()) — re-renders the progress dots
// and the Step 1 choice-card highlight. Deliberately does NOT touch which
// .sw-step is shown, since validateSetup() fires on every keystroke in
// Steps 2-4 and must not interrupt the user's current step.
function swRefresh(){
  const cur=APP.setupWizardStep||1;
  const dots=$("#sw-progress");
  if(dots.length){
    let html="";
    for(let i=1;i<=4;i++){
      const cls=i===cur?"sw-dot sw-active":(i<cur?"sw-dot sw-done":"sw-dot");
      html+=`<div class="${cls}">${i}</div>`;
    }
    dots.html(html);
  }
  const choice=APP.setupCard1Choice;
  $("#sw-card-new").toggleClass("sw-choice-active",choice==="new");
  $("#sw-card-update").toggleClass("sw-choice-active",choice==="update");
}

function swValidateStep(n){
  if(n===1){
    if(!APP.setupCard1Choice) return {ok:false,msg:srT("val_choose_option_continue")};
    return {ok:true};
  }
  if(n===2){
    const instNameEl=$("#inst-name");
    let instName=instNameEl.val().trim();
    if(instName&&instName===(instNameEl.attr("placeholder")||"").trim())instName="";
    if(!instName){
      const isIndividual=APP.setup.mode==="individual";
      return {ok:false,msg:isIndividual?srT("val_student_name_required"):srT("val_institution_name_required")};
    }
    if(!APP.setup.mode) return {ok:false,msg:srT("val_choose_who_for")};
    return {ok:true};
  }
  if(n===3){
    const isIndividual=APP.setup.mode==="individual";
    const className=$("#class-name").val().trim();
    const year=$("#class-year").val().trim();
    if(!isIndividual&&!className) return {ok:false,msg:srT("val_class_batch_required")};
    if(!year) return {ok:false,msg:srT("val_academic_year_required")};
    // BUG FIX (3-scenario spec): Scholarship Criteria previously had no
    // gate here at all — see validateScholarshipCriteria()'s own header
    // comment in template-upload.js for the full rationale.
    if(!validateScholarshipCriteria()) return {ok:false,msg:srT("scholarship_setup_fix_errors")};
    return {ok:true};
  }
  // Step 4 has no Next button — validateSetup() gates Download instead.
  return {ok:true};
}


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { swBack, swGoto, swNext, swRefresh, swValidateStep };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window.swBack=swBack;window.swGoto=swGoto;window.swNext=swNext;window.swRefresh=swRefresh;window.swValidateStep=swValidateStep;}
