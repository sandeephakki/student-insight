import { runAnalysis } from '../bal/common/compute-stats.js';
import { getSubjects, setUsageMode } from './project-setup.js';
import { closeModal, destroyCharts, filterStudents, renderCharts } from '../ui/common/render-core.js';
import { swRefresh } from './setup-wizard.js';
import { srT } from './render-i18n.js';
import { APP, goStep, initThemeToggle, populateCountryDropdown } from './state-nav.js';
import { AI_FEATURES, renderAICheckboxes, selectAllAI } from './template-upload.js';

/* ════ SAVE (stateless app — no persistence by design) ════
   Per the privacy-first/offline-first direction, Student Insight never
   writes student data to localStorage or any server. "Save" simply tells
   the user their Excel file IS the save — nothing is silently stored. */
function saveSession(){
  toast(srT("val_no_data_stored"),"warn");
}

/* ════ UTILS ════ */
function esc(v){return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

// Relocated from bal/compare/compute-compare.js (2026-08-30, Compare
// lazy-load pass) — this is called unconditionally at page boot (below,
// alongside initEnvBadge()/initThemeToggle()), so it has to live in an
// always-loaded file regardless. It's a pure 4-line DOM visibility toggle
// with zero dependency on anything else in compute-compare.js (just $ and
// APP, both already available here) — keeping it in the heavy compute
// file was the actual reason that whole file couldn't be lazy-loaded.
function applyCompareModeUI(){
  const cm=!!APP.compareMode;
  $("#compare-setup-banner").toggle(cm);
  $("#mode-select-card").toggle(!cm);
  $("#compare-export-card,#compare-per-section-export-card").toggle(cm);
  $("#btn-generate-pdfs").toggle(!cm);
}

/* FIX (review #6): the two ".ai-loader-formula-card" boxes in #ai-loader
   (index.html) used to be blank ".skeleton-card" shimmer rectangles.
   Now they cycle through short symbol+label pairs drawn from metrics the
   app actually computes/displays elsewhere (reusing existing i18n keys —
   no new translation strings needed), giving the loading screen a sense
   of live activity without inventing a number that might not match the
   real result a moment later. Runs on its own fixed-cadence interval
   rather than being wired to compute-stats.js's specific step array, so
   the same two helpers work unmodified from both runAnalysis() (10
   fake steps) and the Compare-mode per-section loader in
   compute-compare.js (N sections) — call start when #ai-loader is shown,
   stop right before it's hidden (see both call sites), and also from the
   global error handler above so a mid-analysis crash can't leave the
   interval running forever. */
const AI_LOADER_FORMULA_SETS=[
  [{symbol:"x̄",key:"kpi_average"},{symbol:"Δ",key:"kpi_trend"},{symbol:"P",key:"pdf_kpi_percentile"}],
  [{symbol:"%",key:"kpi_pass_rate"},{symbol:"⚑",key:"detail_flags_label"},{symbol:"#",key:"th_rank"}]
];
let _aiLoaderCardInterval=null;
let _aiLoaderCardTick=0;
function _renderAiLoaderFormulaCards(){
  AI_LOADER_FORMULA_SETS.forEach((set,i)=>{
    const el=document.getElementById("ai-loader-formula-"+(i+1));
    if(!el)return;
    const item=set[_aiLoaderCardTick%set.length];
    const symEl=el.querySelector(".ai-loader-formula-symbol");
    const labelEl=el.querySelector(".ai-loader-formula-label");
    if(symEl)symEl.textContent=item.symbol;
    if(labelEl){labelEl.setAttribute("data-i18n",item.key);labelEl.textContent=srT(item.key);}
  });
}
function startAiLoaderCardCycle(){
  stopAiLoaderCardCycle(); // guard against a stray interval if start is ever called twice without an intervening stop
  _aiLoaderCardTick=0;
  _renderAiLoaderFormulaCards();
  _aiLoaderCardInterval=setInterval(function(){_aiLoaderCardTick++;_renderAiLoaderFormulaCards();},900);
}
function stopAiLoaderCardCycle(){
  if(_aiLoaderCardInterval){clearInterval(_aiLoaderCardInterval);_aiLoaderCardInterval=null;}
}

/* Shared screen-swap helper — jQuery .show() plus the .screen-fade-in
   transition class (see css/core.css), used by every bucket/legacy/Smart
   Search screen swap so the whole app transitions the same way, not just
   the newer screens. Re-adds the class each call (removing first) so
   repeated taps between screens keep re-triggering the animation instead
   of it only firing once. */
function showScreen(selectorOrEl){
  const $el = (typeof selectorOrEl==="string") ? $(selectorOrEl) : selectorOrEl;
  $el.removeClass("screen-fade-in");
  $el.show();
  // Force reflow so re-adding the class restarts the CSS animation.
  void $el[0]?.offsetWidth;
  $el.addClass("screen-fade-in");
  return $el;
}

/* Consistent empty-state markup — used wherever a bucket/list legitimately
   has nothing to show (no students yet, no data for this view) instead of
   a blank area or an ad-hoc line of text. */
function emptyStateHtml(title, sub){
  return `<div class="bucket-empty-state">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
    <div class="bucket-empty-title">${esc(title)}</div>
    ${sub?`<div class="bucket-empty-sub">${esc(sub)}</div>`:""}
  </div>`;
}

function validateSetup(){
  const isIndividual=APP.setup.mode==="individual";
  const instNameEl=$("#inst-name");
  let instName=instNameEl.val().trim();
  // E4: guard against a user literally typing the placeholder text (e.g. "e.g. Ananya Krishnan")
  // instead of realizing it was example/hint text — treat that as an empty field.
  if(instName&&instName===(instNameEl.attr("placeholder")||"").trim())instName="";
  const className=$("#class-name").val().trim();
  const year=$("#class-year").val().trim();
  const subjects=getSubjects();
  const tests=$("#tests-list .test-row-wrap .test-name-inp").map(function(){return $(this).val().trim();}).get().filter(Boolean);

  // inline field errors
  $("#err-inst-name").toggle(!instName).text(isIndividual?srT("val_student_name_required_short"):srT("val_institution_name_required_short"));
  if(!instName) $("#inst-name").css("border-color","var(--c-danger)"); else $("#inst-name").css("border-color","");
  // Class / Batch is only mandatory in Institution mode — an individual
  // aspirant/parent may have no "batch" at all, and forcing a fake one
  // in would just pollute the reports with meaningless text.
  const classRequired=!isIndividual;
  $("#err-class-name").toggle(classRequired&&!className);
  if(classRequired&&!className) $("#class-name").css("border-color","var(--c-danger)"); else $("#class-name").css("border-color","");
  $("#err-class-year").toggle(!year);
  if(!year) $("#class-year").css("border-color","var(--c-danger)"); else $("#class-year").css("border-color","");

  // Bug fix: a test's max-marks grid is built from the subject list — no
  // subjects means no columns to score against, so there's no use in
  // letting someone create a test yet. Gate the button itself rather than
  // only complaining after the fact.
  const hasSubjects=subjects.length>0;
  $("#btn-add-test").prop("disabled",!hasSubjects).css({opacity:hasSubjects?1:.45,cursor:hasSubjects?"pointer":"not-allowed"});
  $("#tests-need-subject-hint").toggle(!hasSubjects);

  // Bug fix (setup screen spec): no institution runs more than 12
  // subjects (incl. labs) at once — gate the button itself, same pattern
  // as the "needs a subject first" gate on Add Test above.
  const MAX_SUBJECTS=12;
  const atMaxSubjects=subjects.length>=MAX_SUBJECTS;
  $("#btn-add-subject").prop("disabled",atMaxSubjects).css({opacity:atMaxSubjects?.45:1,cursor:atMaxSubjects?"not-allowed":"pointer"});
  $("#subjects-max-hint").toggle(atMaxSubjects);

  // Bug fix (setup screen spec): a test row with a name but no date is
  // half-filled — mandatory, same red-border treatment as the other
  // required fields on this screen.
  let missingTestDate=false;
  $("#tests-list .test-row-wrap").each(function(){
    const $row=$(this);
    const name=$row.find(".test-name-inp").val().trim();
    const dateEl=$row.find(".test-date-inp");
    const bad=!!name&&!dateEl.val();
    dateEl.css("border-color",bad?"var(--c-danger)":"");
    if(bad) missingTestDate=true;
  });

  // Bug fix (setup screen spec): Contact is optional but must be a clean
  // phone or email if filled — not gating Next/Download on this (it's
  // optional data, not a required field), but flagging live via
  // inst-contact's own INPUT_HANDLER (ui/common/inline-actions.js).

  // Duplicate names corrupt per-subject/per-test aggregation downstream —
  // e.g. two subjects named "Maths" and "maths" would silently overwrite
  // each other in subjectAvgs, since it's keyed by name. Case-insensitive
  // check since that's the realistic way teachers create an accidental dupe.
  const findDupes=list=>{const seen=new Set(),dupes=new Set();list.forEach(v=>{const k=v.toLowerCase();if(seen.has(k))dupes.add(v);seen.add(k);});return[...dupes];};
  const dupeSubjects=findDupes(subjects);
  const dupeTests=findDupes(tests);

  const missing=[];
  if(!instName) missing.push(isIndividual?srT("setup_student_name_label"):srT("setup_institution_name_label"));
  if(classRequired&&!className) missing.push(srT("setup_class_batch"));
  if(!year) missing.push(srT("db_academic_year"));
  if(!subjects.length) missing.push(srT("val_at_least_one_subject"));
  if(!tests.length) missing.push(srT("val_at_least_one_test"));
  if(dupeSubjects.length) missing.push(srT("val_dupe_subject_names",{names:dupeSubjects.join(", ")}));
  if(dupeTests.length) missing.push(srT("val_dupe_test_names",{names:dupeTests.join(", ")}));
  if(missingTestDate) missing.push("Test date");

  const valid=missing.length===0;
  $("#btn-download-template").prop("disabled",!valid).css({opacity:valid?1:.45,cursor:valid?"pointer":"not-allowed"}).toggleClass("btn-glow",valid);
  const errEl=document.getElementById("sw-err-4");
  if(errEl){ errEl.style.display=valid?"none":""; errEl.textContent=valid?"":srT("val_still_needed",{items:missing.join(", ")}); }
  if(typeof swRefresh==="function") swRefresh();
  return valid;
}
function toast(msg,type=""){const wrap=$("#toast-wrap");const cap=2;while(wrap.children().length>=cap)wrap.children().first().remove();const el=$(`<div class="toast ${type}" role="${type==="error"?"alert":"status"}">${msg}</div>`);wrap.append(el);setTimeout(()=>el.fadeOut(300,()=>el.remove()),3500);}
function initEnvBadge(){const env=(window.APP_CONFIG&&window.APP_CONFIG.env)||"PROD";if(env!=="PROD"){$("#env-badge").text(env).show();}$("#project-page-link,#footer-project-link").attr("href",(window.APP_CONFIG&&window.APP_CONFIG.projectPageUrl)||"https://studin.in/");}


/* TRUST ACCORDION */
let _activeTrust=null;
function toggleTrust(id){
  const detail=document.getElementById('trust-detail');
  const bodies=document.querySelectorAll('.trust-body');
  const pills=document.querySelectorAll('.trust-pill');
  if(_activeTrust===id){
    detail.style.display='none';
    bodies.forEach(b=>b.style.display='none');
    pills.forEach(p=>p.classList.remove('active'));
    _activeTrust=null;return;
  }
  bodies.forEach(b=>b.style.display='none');
  const target=document.getElementById(id);
  if(target){target.style.display='block';detail.style.display='block';}
  pills.forEach((p,i)=>p.classList.toggle('active',['t1','t2','t3','t4','t5','t6'][i]===id));
  _activeTrust=id;
}


/* ── DASHBOARD TAB SWITCHING ── */
function switchDbTab(name, el){
  document.querySelectorAll('.db-tab').forEach(t=>{t.classList.remove('active');t.setAttribute('aria-selected','false');t.tabIndex=-1;});
  document.querySelectorAll('.db-tab-panel').forEach(p=>p.classList.remove('active'));
  if(el){el.classList.add('active');el.setAttribute('aria-selected','true');el.tabIndex=0;}
  const panel = document.getElementById('tab-'+name);
  if(panel) panel.classList.add('active');
  // Bug fix: the All/At-Risk/Improving/Declining/Flagged filter chips only
  // ever affect the Students list and the Heatmap (see filterStudents(),
  // which re-renders exactly those two) — they have no effect on Analytics,
  // Alerts, Wellbeing or Insights. Leaving them visible (and seemingly
  // clickable) on those tabs made the app look broken/unresponsive when a
  // teacher clicked one and nothing on screen changed. Only show them on
  // the tabs where they actually do something.
  const isIndividual=APP.setup.mode==="individual";
  $("#db-filter-bar").toggle(!isIndividual&&(name==="students"||name==="heatmap"));
  // Bug fix: this used to be gated on window._chartsBuilt so it only ever
  // ran ONCE per page load, globally. That meant re-running analysis (e.g.
  // after removing/re-adding a Compare-mode section) or switching between
  // sections left the Analytics tab's charts blank or stale on every visit
  // after the first — renderCharts() was simply never called again.
  // renderCharts() already calls destroyCharts() first, so it's always
  // safe to call fresh; just do that every time this tab is opened.
  if(name==='analytics'){
    try{ renderCharts(); }catch(e){ console.error('chart build',e); }
  }
}

/* ════ KEYBOARD ════ */
$(document).on("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key==="s"){e.preventDefault();saveSession();}if(e.key==="Escape")closeModal();});
$(document).on("keydown","[role=button]",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();this.click();}});
$("#modal-overlay").on("click",function(e){if($(e.target).is("#modal-overlay"))closeModal();});

/* ════ SERVICE WORKER ════ */
// v4.1 (bug #4 fix): previously computed an absolute swPath by checking
// whether location.pathname contained the literal string "/student-insight/"
// — fragile (hardcodes a specific repo name, breaks for any other subpath)
// and already wrong in practice since QA is the only one that needs it and
// prod doesn't. A plain relative "sw.js" is resolved by the browser against
// the current document URL automatically, so it registers correctly under
// any hosting shape (root domain, GH Pages project subpath, local folder)
// with zero env-detection code needed here.
if("serviceWorker" in navigator&&location.protocol!=="file:"){
  navigator.serviceWorker.register("sw.js").then(function(reg){
    // H3 fix (robustness audit): sw.js's skipWaiting()/clients.claim() take
    // over immediately with no notice — if this tab is open (mid-Setup, mid-
    // Insights, or mid-analysis of a large file) when a new version deploys,
    // it could silently start being served by a different SW version than
    // the JS already loaded in memory. Rather than removing skipWaiting()
    // (which would delay every user's update until their next full reload
    // regardless of whether they're mid-session), tell the user an update
    // landed and let them choose when to reload — NO_PERSISTENCE means
    // nothing in progress is actually lost either way.
    function showUpdateBanner(){
      if(document.getElementById("sw-update-banner"))return;
      const bar=document.createElement("div");
      bar.id="sw-update-banner";
      bar.setAttribute("role","status");
      bar.style.cssText="position:fixed;left:0;right:0;bottom:0;z-index:99999;background:var(--c-primary,#1e40af);color:#fff;padding:10px 16px;display:flex;gap:12px;align-items:center;justify-content:center;font-size:13px;flex-wrap:wrap;box-shadow:0 -2px 8px rgba(0,0,0,.15)";
      bar.innerHTML='<span>'+esc(srT('val_new_version_available'))+'</span>';
      const btn=document.createElement("button");
      btn.textContent=srT("btn_refresh_now");
      btn.style.cssText="background:#fff;color:#111;border:0;border-radius:6px;padding:4px 12px;font-weight:600;cursor:pointer";
      btn.onclick=function(){location.reload();};
      const dismiss=document.createElement("button");
      dismiss.textContent=srT("btn_later");
      dismiss.setAttribute("aria-label",srT("aria_dismiss_update_notice"));
      dismiss.style.cssText="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:6px;padding:4px 12px;cursor:pointer";
      dismiss.onclick=function(){bar.remove();};
      bar.appendChild(btn);bar.appendChild(dismiss);
      document.body.appendChild(bar);
    }
    reg.addEventListener("updatefound",function(){
      const newWorker=reg.installing;
      if(!newWorker)return;
      newWorker.addEventListener("statechange",function(){
        // "installed" + an existing controller means this is an update to an
        // already-open tab, not the very first install — that's the only
        // case worth interrupting the user for.
        if(newWorker.state==="installed"&&navigator.serviceWorker.controller){
          showUpdateBanner();
        }
      });
    });
  }).catch(()=>{});
}

/* ════ FAQ ACCORDION REVEAL (v5.0-modernization step 2) ════
   Native <details>/<summary> already gives correct open/close behavior
   and accessibility for free — this only adds a visual reveal to the
   answer content once it opens, reusing the exact same showScreen()/
   .screen-fade-in mechanism every other screen swap in the app already
   uses (see above), rather than inventing a second animation system.
   Close stays instant (native <details> collapsing has no content to
   animate anyway once hidden) — only the open direction gets the reveal. */
document.addEventListener("DOMContentLoaded", function(){
  document.querySelectorAll(".faq-item").forEach(function(details){
    details.addEventListener("toggle", function(){
      if(!details.open) return;
      const answer = details.querySelector(".faq-a");
      if(answer) showScreen($(answer));
    });
  });
});

/* ════ GLOBAL ERROR HANDLER (C2, robustness audit) ════
   No window.onerror/unhandledrejection handler existed anywhere before
   this. An uncaught exception mid-runAnalysis() (malformed cell data, an
   unexpected undefined, a third-party library edge case) could leave the
   loader animation frozen forever with zero explanation — and because
   this app has NO_PERSISTENCE, the only recovery was a full reload,
   silently losing whatever was in progress. Logs to console only (never
   to any remote endpoint — nothing here compromises NO_PERSISTENCE). */
let _lastGlobalErrorToastAt=0;
function _reportGlobalError(kind,err,extra){
  console.error("["+kind+"] Unhandled error — current step: "+(typeof APP!=="undefined"&&APP.currentStep||"unknown"),err,extra||"");
  const now=Date.now();
  if(now-_lastGlobalErrorToastAt<4000)return; // avoid a toast storm if several fire at once
  _lastGlobalErrorToastAt=now;
  try{
    $("#ai-loader").hide();
    stopAiLoaderCardCycle();
    document.getElementById("btn-home-run-analysis")?.removeAttribute("disabled");
    toast(srT("toast_global_error_reload"),"error");
  }catch(e){/* toast()/jQuery unavailable this early — nothing more we can do client-side */}
}
window.addEventListener("error",function(e){_reportGlobalError("error",e.error||e.message,{file:e.filename,line:e.lineno});});
window.addEventListener("unhandledrejection",function(e){_reportGlobalError("unhandledrejection",e.reason);});

/* ════ INIT ════ */
$(function(){
  if(location.protocol!=="file:"){const ml=document.createElement("link");ml.rel="manifest";ml.href="manifest.json";document.head.appendChild(ml);}
  // Stateless design: wipe any previously stored session data on load
  try{localStorage.removeItem("sia_sessions");localStorage.removeItem("sia_auth");localStorage.removeItem("sia_gs_url");}catch(e){}
  Object.values(AI_FEATURES).flat().forEach(f=>APP.aiFeatures.add(f.id));renderAICheckboxes();initEnvBadge();applyCompareModeUI();initThemeToggle();populateCountryDropdown(); // pre-select all AI features silently (no toast) — selectAllAI() is reserved for the explicit "Select All" button / analysis-time fallback
  setUsageMode("institution",true); // default card visuals before any Setup interaction
  goStep("home"); // always shows clean home
  // v1.8: the first-load Institution/Individual popup (v1.4-v1.7) was
  // removed per direct feedback — see PIB §17. Institution stays the
  // default (as it always was); Setup's mode-select card is still the
  // real place to switch, same as before v1.4 ever existed.
});


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { _activeTrust, _lastGlobalErrorToastAt, _reportGlobalError, applyCompareModeUI, emptyStateHtml, esc, initEnvBadge, saveSession, showScreen, startAiLoaderCardCycle, stopAiLoaderCardCycle, switchDbTab, toast, toggleTrust, validateSetup };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window._activeTrust=_activeTrust;window._lastGlobalErrorToastAt=_lastGlobalErrorToastAt;window._reportGlobalError=_reportGlobalError;window.emptyStateHtml=emptyStateHtml;window.esc=esc;window.initEnvBadge=initEnvBadge;window.saveSession=saveSession;window.showScreen=showScreen;window.switchDbTab=switchDbTab;window.toast=toast;window.toggleTrust=toggleTrust;window.validateSetup=validateSetup;}
