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
    if(!APP.setupCard1Choice) return {ok:false,msg:"Choose an option to continue."};
    return {ok:true};
  }
  if(n===2){
    const instNameEl=$("#inst-name");
    let instName=instNameEl.val().trim();
    if(instName&&instName===(instNameEl.attr("placeholder")||"").trim())instName="";
    if(!instName){
      const isIndividual=APP.setup.mode==="individual";
      return {ok:false,msg:isIndividual?"Student / Aspirant name is required.":"Institution name is required."};
    }
    if(!APP.setup.mode) return {ok:false,msg:"Choose who this is for."};
    return {ok:true};
  }
  if(n===3){
    const isIndividual=APP.setup.mode==="individual";
    const className=$("#class-name").val().trim();
    const year=$("#class-year").val().trim();
    if(!isIndividual&&!className) return {ok:false,msg:"Class / Batch is required."};
    if(!year) return {ok:false,msg:"Academic year is required."};
    return {ok:true};
  }
  // Step 4 has no Next button — validateSetup() gates Download instead.
  return {ok:true};
}
