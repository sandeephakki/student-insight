/* ════ PROJECT LIFECYCLE — stateless, no persistence ════ */
function startNewSession(){
  /* "New Project" — reset everything, go to Setup form.
     v1.4: preserve whichever mode (Institution/Individual) was last active
     — via the first-load prompt (PIB §17) or a manual Setup toggle —
     instead of silently forcing Institution. A brand-new page load with no
     prior mode set still defaults to "institution" (APP.setup.mode's
     initial value), so this is a strict superset of the old behaviour. */
  const carryMode=APP.setup.mode==="individual"?"individual":"institution";
  APP.setup={mode:carryMode,modeLocked:false,instName:"",instType:"",location:"",contact:"",className:"",section:"",year:"",teacher:"",scoring:{marks:true,pct:true,grade:false,pf:false},passThreshold:35,absentAlert:3,dropAlert:20,subjects:[],tests:[]};
  APP.students=[];APP.rawData=null;APP.classStats=null;APP.genderAnalysis=null;subjectCount=0;testCount=0;
  APP.mergeMode=false;APP.mergeSource=null;$("#merge-banner").hide();
  APP.compareMode=false;APP.sections=[];APP.sectionComparison=[];
  APP.setupWizardStep=1;APP.setupCard1Choice=null;
  $("#btn-download-template").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M12 3v12'/><polyline points='7 10 12 15 17 10'/><path d='M4 21h16'/></svg> "+i18nLabel("setup_btn_download_template","Download Template"));$("#btn-load-existing").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M12 21V9'/><polyline points='7 14 12 9 17 14'/><path d='M4 21h16'/></svg> "+i18nLabel("setup_btn_load_existing","Load Existing Filled Sheet"));
  $("#subjects-list").empty();$("#tests-list").empty();
  $("#session-name-badge").hide().text("");
  setUsageMode(carryMode,true);
  applyCompareModeUI();
  fillSetupForm(APP.setup); // keep the visible form in sync with the reset state
  unlockStep("setup");goStep("setup");
}
// Entered automatically when 2+ files are dropped on Home's single upload
// zone (v3.1 — no dedicated "Compare Sections / Batches" card/button
// anymore). Institution-only by definition, so
// the mode is set AND locked immediately (no mode-select card shown at all
// — see applyCompareModeUI()/the Setup panel's #compare-setup-banner).
// v1.5 (bug fix — see PIB §18): this used to always land on Setup, forcing
// the teacher to re-type Subjects/Tests/Max Marks by hand even when every
// section already had a filled sheet. It now goes straight to Step 2's
// uploader — Setup stays reachable (unlockStep below) purely as an
// OPTIONAL path for generating a blank shared template, not a forced stop.
function startCompareMode(){
  APP.setup={mode:"institution",modeLocked:true,instName:"",instType:"",location:"",contact:"",className:"",section:"",year:"",teacher:"",scoring:{marks:true,pct:true,grade:false,pf:false},passThreshold:35,absentAlert:3,dropAlert:20,subjects:[],tests:[]};
  APP.students=[];APP.rawData=null;APP.classStats=null;APP.genderAnalysis=null;subjectCount=0;testCount=0;
  APP.mergeMode=false;APP.mergeSource=null;$("#merge-banner").hide();
  APP.compareMode=true;APP.sections=[];APP.sectionComparison=[];APP._compareAutoRan=false;APP.homeSingleFile=null;
  APP.setupWizardStep=1;APP.setupCard1Choice=null;
  $("#home-file-list").hide().empty();
  $("#btn-download-template").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M12 3v12'/><polyline points='7 10 12 15 17 10'/><path d='M4 21h16'/></svg> "+i18nLabel("setup_btn_download_template","Download Template"));$("#btn-load-existing").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M12 21V9'/><polyline points='7 14 12 9 17 14'/><path d='M4 21h16'/></svg> "+i18nLabel("setup_btn_load_existing","Load Existing Filled Sheet"));
  $("#subjects-list").empty();$("#tests-list").empty();
  $("#session-name-badge").hide().text("");
  setUsageMode("institution",true);
  applyCompareModeUI();
  unlockStep("setup");
  // v3.0 rev2: no navigation here anymore — this now runs in the background
  // while the person is already on Home mid multi-file-drop (see
  // handleHomeImportFiles). Home's own #home-import-status area gives the
  // per-file feedback; the old "Upload Data" step this used to jump to no
  // longer exists (§10.1/10.3).
}
// deleteSession() / loadSessionFile() removed (v1.9 cleanup) — both were
// inert leftovers from the already-removed session-persistence feature,
// confirmed to have zero call sites anywhere in the file before deletion.
function markDirty(){_unsaved=true;$("#unsaved-dot").addClass("visible");}
function markClean(){_unsaved=false;$("#unsaved-dot").removeClass("visible");}
function unlockStep(s){$("[data-step='"+s+"']").removeClass("locked");}
function lockStep(s){$("[data-step='"+s+"']").addClass("locked");}

/* ════ FAQ SEARCH ════ */
function filterFAQ(q){
  q=q.trim().toLowerCase();
  let anyVisible=false;
  document.querySelectorAll("#faq-root .faq-section").forEach(function(section){
    let groupHasMatch=false;
    section.querySelectorAll(".faq-item").forEach(function(item){
      const txt=item.textContent.toLowerCase();
      const match=!q||txt.indexOf(q)!==-1;
      item.style.display=match?"":"none";
      if(match){groupHasMatch=true;anyVisible=true;if(q)item.open=true;else item.open=false;}
    });
    section.style.display=groupHasMatch?"":"none";
    if(q&&groupHasMatch)section.open=true;
  });
  document.getElementById("faq-empty").style.display=anyVisible?"none":"block";
}
function initFAQAccordion(){
  // Item-level accordion: only one question open at a time within the whole FAQ.
  const items=document.querySelectorAll("#faq-root .faq-item");
  items.forEach(function(item){
    item.addEventListener("toggle",function(){
      if(item.open){
        items.forEach(function(other){
          if(other!==item)other.open=false;
        });
        item.scrollIntoView({behavior:"smooth",block:"nearest"});
      }
    });
  });
  // Section-level accordion: only one topic section open at a time.
  const sections=document.querySelectorAll("#faq-root .faq-section");
  sections.forEach(function(section){
    section.addEventListener("toggle",function(){
      if(section.open){
        sections.forEach(function(other){
          if(other!==section)other.open=false;
        });
        section.scrollIntoView({behavior:"smooth",block:"nearest"});
      }
    });
  });
  // About page accordion: only one story card open at a time.
  const aboutCards=document.querySelectorAll("#about-acc-root .about-acc");
  aboutCards.forEach(function(card){
    card.addEventListener("toggle",function(){
      if(card.open){
        aboutCards.forEach(function(other){
          if(other!==card)other.open=false;
        });
        card.scrollIntoView({behavior:"smooth",block:"nearest"});
      }
    });
  });
}
document.addEventListener("DOMContentLoaded",initFAQAccordion);
initFAQAccordion();

/* ════ SETUP FORM ════ */
function addSubject(name=""){
  subjectCount++;
  const row=$(`<div class="subj-row" data-subj="subj-${subjectCount}"><span class="row-num">${subjectCount}</span><input type="text" value="${esc(name)}" placeholder="e.g. Mathematics" oninput="updateTestSubjectCols();markDirty();validateSetup()"/><button class="del-btn" onclick="$(this).closest('.subj-row').remove();updateTestSubjectCols();markDirty();validateSetup()">✕</button></div>`);
  $("#subjects-list").append(row);updateTestSubjectCols();
}
function addTest(name="",date=""){
  testCount++;const id="test-"+testCount;const subjects=getSubjects();
  const mmCols=subjects.map((s,i)=>`<div class="mm-chip"><label>${esc(s)}</label><input type="number" class="mm-inp" data-subj="${i}" value="100" min="1" oninput="markDirty()"/></div>`).join("");
  const row=$(`<div class="test-row-wrap" data-test="${id}"><div class="test-row"><span class="row-num">${testCount}</span><input type="text" class="test-name-inp" value="${esc(name)}" placeholder="e.g. Unit Test 1" oninput="markDirty();validateSetup()"/><input type="date" class="test-date-inp" value="${date}" oninput="markDirty()"/><button class="del-btn" onclick="$(this).closest('.test-row-wrap').remove();markDirty();validateSetup()">✕</button></div><div style="font-size:11px;color:var(--c-text3);margin:6px 0 2px 30px">Max marks per subject:</div><div class="mm-grid">${mmCols}</div></div>`);
  $("#tests-list").append(row);
}
function getSubjects(){return $("#subjects-list .subj-row input").map(function(){return $(this).val().trim();}).get().filter(Boolean);}
function updateTestSubjectCols(){
  const subjects=getSubjects();
  $("#tests-list .test-row-wrap").each(function(){
    const wrap=$(this);const existing=wrap.find(".mm-grid");
    const mmCols=subjects.map((s,i)=>{const curVal=wrap.find(".mm-inp[data-subj=\""+i+"\"]").val()||100;return `<div class="mm-chip"><label>${esc(s)}</label><input type="number" class="mm-inp" data-subj="${i}" value="${curVal}" min="1" oninput="markDirty()"/></div>`;}).join("");
    existing.html(mmCols);
  });
}
function collectSetupForm(){
  APP.setup.instName=$("#inst-name").val().trim();APP.setup.instType=$("#inst-type").val();
  APP.setup.location=$("#inst-location").val().trim();APP.setup.contact=$("#inst-contact").val().trim();
  APP.setup.className=$("#class-name").val().trim();APP.setup.section=$("#class-section").val().trim();
  APP.setup.year=$("#class-year").val().trim();APP.setup.teacher=$("#class-teacher").val().trim();
  // clampNum: the HTML min/max attributes on these <input type="number">
  // fields are visual hints only — most browsers don't strictly enforce
  // them on typed or pasted values — so a pasted "-20" or "500" would
  // otherwise sail straight through into a nonsensical pass threshold.
  // Clamp here, and reflect the corrected value back into the field so
  // what's displayed never silently diverges from what's actually used.
  const clampNum=(sel,min,max,fallback)=>{
    const raw=parseInt($(sel).val());
    const v=isNaN(raw)?fallback:Math.min(max,Math.max(min,raw));
    if(v!==raw)$(sel).val(v);
    return v;
  };
  APP.setup.passThreshold=clampNum("#pass-threshold",0,100,35);
  APP.setup.absentAlert=clampNum("#absent-alert",0,365,3);
  APP.setup.dropAlert=clampNum("#drop-alert",0,100,20);
  APP.setup.scoring={marks:$("#sc-marks").is(":checked"),pct:$("#sc-pct").is(":checked"),grade:$("#sc-grade").is(":checked"),pf:$("#sc-pf").is(":checked")};
  APP.setup.subjects=getSubjects();APP.setup.tests=[];
  $("#tests-list .test-row-wrap").each(function(){
    const name=$(this).find(".test-name-inp").val().trim();const date=$(this).find(".test-date-inp").val();
    const maxMarks={};APP.setup.subjects.forEach((s,i)=>{maxMarks[s]=parseInt($(this).find(`.mm-inp[data-subj="${i}"]`).val())||100;});
    if(name)APP.setup.tests.push({name,date,maxMarks});
  });
}
function fillSetupForm(s){
  setUsageMode(s.mode||"institution",true);
  $("#inst-name").val(s.instName||"");$("#inst-type").val(s.instType||"");
  $("#inst-location").val(s.location||"");$("#inst-contact").val(s.contact||"");
  $("#class-name").val(s.className||"");$("#class-section").val(s.section||"");
  $("#class-year").val(s.year||"");$("#class-teacher").val(s.teacher||"");
  $("#pass-threshold").val(s.passThreshold||35);$("#absent-alert").val(s.absentAlert||3);$("#drop-alert").val(s.dropAlert||20);
  if(s.scoring){$("#sc-marks").prop("checked",!!s.scoring.marks);$("#sc-pct").prop("checked",!!s.scoring.pct);$("#sc-grade").prop("checked",!!s.scoring.grade);$("#sc-pf").prop("checked",!!s.scoring.pf);}
  subjectCount=0;testCount=0;$("#subjects-list").empty();$("#tests-list").empty();
  (s.subjects||[]).forEach(sub=>addSubject(sub));
  (s.tests||[]).forEach((t,ti)=>{addTest(t.name,t.date);});
  if(s.tests)s.tests.forEach((t,ti)=>{const wrap=$("#tests-list .test-row-wrap").eq(ti);(s.subjects||[]).forEach((sub,si)=>{wrap.find(`.mm-inp[data-subj="${si}"]`).val((t.maxMarks&&t.maxMarks[sub])||100);});});
  // Bug fix: jQuery's .val() above does NOT fire the "input" event, so the
  // oninput="markDirty();validateSetup()" handlers on these fields never
  // ran — any red-border/"required" warning left over from before the
  // fields were populated (e.g. right after importing a file) used to
  // stay stuck showing even though the data was now actually there.
  // Explicitly re-validate now that the form reflects the real state.
  validateSetup();
}

/* ════ USAGE MODE (Institution vs Individual) ════
   A single flag — APP.setup.mode — drives every institution-vs-individual
   difference downstream: Setup form labels/required-ness, which report
   types are offered on the Export step, and whether the Dashboard shows
   cohort-relative widgets (rank, percentile, class topper, pass rate,
   at-risk-vs-batch) or switches to a single-student progress view.
   Everything else (computeAnalysis, grade bands, health score, trend)
   is unchanged — those already work at n=1. */
function setUsageMode(mode,skipDirty){
  const newMode=mode==="individual"?"individual":"institution";
  // Once a mode is locked (a template has been generated or a real file has
  // been imported/loaded for this project), switching to the OTHER mode
  // would silently strand/mismatch that file's data structure — refuse the
  // switch and explain why, rather than letting the UI drift out of sync
  // with an already-committed template/import.
  if(APP.setup.modeLocked&&newMode!==APP.setup.mode){
    const curLabel=APP.setup.mode==="individual"?"Individual":"Institution";
    toast("Mode is locked to "+curLabel+" for this project — a template or file is already in use. Start a new project (Home → New Project) to switch modes.","warn");
    return;
  }
  if(newMode===APP.setup.mode)skipDirty=true; // E7: re-clicking the already-active mode card shouldn't mark dirty
  APP.setup.mode=newMode;
  $("#mode-card-institution").css({borderColor:APP.setup.mode==="institution"?"var(--c-primary)":"var(--c-border)"}).attr("aria-pressed",APP.setup.mode==="institution"?"true":"false");
  $("#mode-card-individual").css({borderColor:APP.setup.mode==="individual"?"var(--c-primary)":"var(--c-border)"}).attr("aria-pressed",APP.setup.mode==="individual"?"true":"false");
  applyModeUI();
  if(!skipDirty)markDirty();
}
// v3.1: applyHomeModeGating() removed — its only job was toggling Home's
// "Compare Sections / Batches" card (#home-card-compare) by mode, and that
// card is gone. Compare is now reached automatically by dropping 2+ files
// on Home's single upload zone, in either mode — no separate gated entry
// point left to keep in sync.
// Called once a project's mode is "committed" — i.e. a template has been
// downloaded, or a real file (fresh import or "Update Existing Sheet") has
// been loaded — after which switching mode would orphan that file's
// structure. Idempotent; safe to call more than once.
function lockUsageMode(){
  if(APP.setup.modeLocked)return;
  APP.setup.modeLocked=true;
  applyModeLockUI();
}
function applyModeLockUI(){
  const locked=!!APP.setup.modeLocked;
  const activeIsInst=APP.setup.mode==="institution";
  const $inst=$("#mode-card-institution"),$indiv=$("#mode-card-individual");
  $inst.add($indiv).css({opacity:1,cursor:"pointer",pointerEvents:"auto"}).attr("tabindex","0").removeAttr("aria-disabled").removeAttr("title");
  if(locked){
    const $other=activeIsInst?$indiv:$inst;
    $other.css({opacity:.45,cursor:"not-allowed",pointerEvents:"none"}).attr({tabindex:"-1","aria-disabled":"true",title:"Locked — start a new project to switch modes"});
  }
  $("#mode-lock-note").toggle(locked).html(locked?"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><rect x='4' y='11' width='16' height='10' rx='2'/><path d='M8 11V7a4 4 0 0 1 8 0v4'/></svg> Mode locked to "+(activeIsInst?"Institution":"Individual")+" for this project — a template or file is already in use. Start a new project (Home → New Project) to switch modes.":"");
}
function applyModeUI(){
  const isIndividual=APP.setup.mode==="individual";
  // --- Setup form: relabel / hide institution-only fields ---
  $("#inst-card-icon").html(isIndividual?"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M20 21a8 8 0 1 0-16 0'/><circle cx='12' cy='8' r='4'/></svg>":"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><rect x='4' y='3' width='16' height='18' rx='1'/><path d='M9 21V15h6v6'/><path d='M9 7h1M9 11h1M14 7h1M14 11h1'/></svg>");
  $("#inst-card-title").text(isIndividual?"About":"Institution");
  $("#inst-name-label").html(isIndividual?'Student / Aspirant Name <span style="color:var(--c-danger)">*</span>':'Institution Name <span style="color:var(--c-danger)">*</span>');
  $("#inst-name").attr("placeholder",isIndividual?"e.g. Ananya Krishnan":"e.g. Springfield International School");
  $("#inst-name-hint").toggle(isIndividual).text(isIndividual?"If tracking more than one child, use one workbook per child, or add each as a separate row and re-export per child.":"");
  $("#individual-multi-child-hint").toggle(isIndividual);
  $("#inst-type-group,#inst-location-group,#inst-contact-group").toggle(!isIndividual);
  $("#class-card-icon").html(isIndividual?"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><circle cx='12' cy='12' r='9'/><circle cx='12' cy='12' r='5'/><circle cx='12' cy='12' r='1.3'/></svg>":"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z'/><path d='M20 17v3H6.5A2.5 2.5 0 0 1 4 17.5'/></svg>");
  $("#class-card-title").text(isIndividual?"Goal":"Class / Batch");
  $("#class-name-label").html(isIndividual?"Target Exam / Goal (optional)":'Class / Batch <span style="color:var(--c-danger)">*</span>');
  $("#class-name").attr("placeholder",isIndividual?"e.g. UPSC CSE 2027":"e.g. Class 9");
  $("#class-section-group").toggle(!isIndividual);
  $("#class-teacher-label").text(isIndividual?"Mentor / Coach (optional)":"Teacher Name");
  $("#pass-threshold-label").text(isIndividual?"Target %":"Pass %");
  // clear any stale required-field error styling left over from the other mode
  validateSetup();

  // --- Export step: Individual mode has no cohort to report on, so
  // Teacher/Management reports (which are class-wide by construction)
  // are dropped entirely rather than shown empty or misleading. ---
  $("#exp-teacher-card,#exp-mgmt-card,#exp-teacher-option,#exp-mgmt-option").toggle(!isIndividual);
  if(isIndividual){$("#exp-teacher").prop("checked",false);$("#exp-mgmt").prop("checked",false);}
  else if(!$("#exp-teacher-option").is(":visible")){/* re-enabling institution mode restores defaults */}
  $("#exp-student-card-title").html(isIndividual?"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M20 21a8 8 0 1 0-16 0'/><circle cx='12' cy='8' r='4'/></svg> Progress Reports":"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M20 21a8 8 0 1 0-16 0'/><circle cx='12' cy='8' r='4'/></svg> Student Reports");
  $("#exp-student-card-desc").text(isIndividual?"One PDF per student — personal trend, subject breakdown, coaching notes.":"One PDF per student — scores, trend, narrative, study plan.");
  $("#exp-student-label").text(isIndividual?"Progress PDFs":"Student PDFs");
  applyModeLockUI();
}

