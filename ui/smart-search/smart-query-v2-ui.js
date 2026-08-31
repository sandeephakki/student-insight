import { srT } from '../../core/render-i18n.js';
import { APP } from '../../core/state-nav.js';
import { isFeatureOn } from '../../core/feature-registry.js';
import { buildFeatureLockedHtml } from '../common/feature-locked-modal.js';

// Assigned inside the IIFE below, exported at the bottom of this module —
// this file was written as a fully self-contained IIFE with zero exports;
// this is the minimal addition to expose one function to
// core/template-upload.js without restructuring the rest of it.
let updateSmartLauncherVisibility;

/* ============================================================
   Student Insight — Smart Query v2 UI
   Minimal, self-contained floating panel that lets a user type a
   free-text question and get an answer from SmartQueryV2
   (js/smart-query-v2.js). Injects its own DOM and CSS — no changes
   to index.html markup needed beyond the <script> tag that loads
   this file.

   This is a functional first entry point, not the final shell-rail
   UI described in shell-redesign-plan.md — that plan's Phase 3 can
   replace this panel's rendering later without touching
   js/smart-query-v2.js, since all the logic lives there.
============================================================ */

(function(){

  const STYLE = `
#sqv2-launcher{position:fixed;right:20px;bottom:20px;z-index:1200;width:52px;height:52px;border-radius:50%;background:#2b3a67;color:#fff;border:none;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer;font-size:22px;display:flex;align-items:center;justify-content:center}
#sqv2-launcher.sqv2-launcher-hidden{display:none}
#sqv2-launcher:hover{background:#3451d1}
#sqv2-panel{position:fixed;right:20px;bottom:82px;z-index:1200;width:340px;max-width:calc(100vw - 40px);max-height:70vh;background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(20,25,60,.25);border:1px solid #e2e5f1;display:none;flex-direction:column;overflow:hidden;font-family:"SF Pro Text","Inter",system-ui,-apple-system,sans-serif}
#sqv2-panel.open{display:flex}
#sqv2-header{padding:12px 14px;background:#2b3a67;color:#fff;font-weight:700;font-size:13.5px;display:flex;justify-content:space-between;align-items:center}
#sqv2-close{background:none;border:none;color:#fff;font-size:16px;cursor:pointer;line-height:1;opacity:.85}
#sqv2-close:hover{opacity:1}
#sqv2-body{flex:1;overflow-y:auto;padding:10px 12px}
#sqv2-answer{font-size:13px;color:#1a1d2e;line-height:1.55;padding:10px;background:#f0f2fa;border-radius:10px;margin-bottom:10px;display:none}
#sqv2-answer.show{display:block}
.sqv2-result-item{padding:8px 10px;border:1px solid #e2e5f1;border-radius:8px;font-size:12.5px;color:#1a1d2e;margin-bottom:6px;cursor:pointer}
.sqv2-result-item:hover{background:#f0f2fa}
.sqv2-result-cat{font-size:11px;color:#9ba4c0;margin-bottom:2px}
#sqv2-inputrow{display:flex;gap:6px;padding:10px 12px;border-top:1px solid #e2e5f1}
#sqv2-input{flex:1;padding:8px 10px;border:1px solid #e2e5f1;border-radius:8px;font-size:13px;font-family:inherit}
#sqv2-ask{background:#2b3a67;color:#fff;border:none;border-radius:8px;padding:0 14px;font-size:13px;font-weight:700;cursor:pointer}
#sqv2-empty{font-size:12px;color:#9ba4c0;padding:10px 2px}
`;

  function injectStyle(){
    if(document.getElementById("sqv2-style")) return;
    const s = document.createElement("style");
    s.id = "sqv2-style";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function injectDom(){
    if(document.getElementById("sqv2-launcher")) return;

    const launcher = document.createElement("button");
    launcher.id = "sqv2-launcher";
    launcher.type = "button";
    launcher.title = "Ask a question about this class";
    launcher.innerHTML = "💬";
    launcher.addEventListener("click", togglePanel);

    const panel = document.createElement("div");
    panel.id = "sqv2-panel";
    panel.innerHTML =
      '<div id="sqv2-header"><span>Ask a question</span><button id="sqv2-close" type="button" aria-label="Close">✕</button></div>' +
      '<div id="sqv2-body">' +
        '<div id="sqv2-answer"></div>' +
        '<div id="sqv2-results"></div>' +
        '<div id="sqv2-empty">Type a question below — e.g. "which subject is weakest" or "any students at risk".</div>' +
      '</div>' +
      '<div id="sqv2-inputrow">' +
        '<input id="sqv2-input" type="text" placeholder="'+escapeHtml(srT("smart_ask_placeholder"))+'" autocomplete="off"/>' +
        '<button id="sqv2-ask" type="button">Ask</button>' +
      '</div>' +
      '<div style="font-size:10.5px;color:#9ba4c0;padding:4px 12px 8px">'+escapeHtml(srT("smart_v2_prefix_tip"))+'</div>';

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    document.getElementById("sqv2-close").addEventListener("click", closePanel);
    document.getElementById("sqv2-ask").addEventListener("click", handleAsk);
    document.getElementById("sqv2-input").addEventListener("keydown", function(e){
      if(e.key === "Enter") handleAsk();
    });
    // Snapshot of the real, unlocked body markup — restored by openPanel()
    // if a locked view ever overwrote it (see the BUG FIX note there).
    _bodyDefaultHtml = document.getElementById("sqv2-body").innerHTML;
    applyLauncherVisibility();
  }
  let _bodyDefaultHtml = "";
  let _bodyShowingLocked = false;

  // Sandy decision (2026-08-28, planner.md decisions log): "off"
  // (Feature_SmartSearch: No, an institution explicitly declining the
  // feature) now hides the launcher entirely, distinct from "locked"
  // (Pro-upsell — stays visible, click shows buildFeatureLockedHtml()
  // inside the panel via openPanel() above, unchanged). Exported so
  // core/template-upload.js can re-run this after APP.features is
  // (re)computed on each file load — the launcher mounts once at page
  // init, before any file (and so before real flag state) exists, so a
  // one-time check in injectDom() alone would only ever see the default
  // "off"-is-false empty-object state and could never hide it once a
  // file with an explicit "No" loads.
  function applyLauncherVisibility(){
    const launcher = document.getElementById("sqv2-launcher");
    if(!launcher) return; // not mounted yet — injectDom()'s own call handles that case
    launcher.classList.toggle("sqv2-launcher-hidden", APP.features && APP.features.smartSearch === "off");
  }
  updateSmartLauncherVisibility = applyLauncherVisibility;

  function togglePanel(){
    const panel = document.getElementById("sqv2-panel");
    if(!panel) return;
    if(panel.classList.contains("open")) closePanel();
    else openPanel();
  }

  function openPanel(){
    // STEP 5 (05-premium-feature-locking.md): the #sqv2-launcher button
    // is mounted globally on document.body regardless of which bucket is
    // active — it's a real bypass of openBucket("smart")'s lock check in
    // ui/common/render-buckets.js if not also gated here directly. Nav
    // stays visible (launcher button never removed); the panel still
    // opens on click, but its body shows the decorated locked
    // explanation instead of the Q&A UI (no popup/modal, same as
    // everywhere else this feature is gated).
    // BUG FIX: the old comment here claimed overwriting #sqv2-body once
    // was "fine since unlocking happens via a fresh file/session... no
    // real path back to the unlocked UI without a reload" — that
    // assumption was wrong (feature flags CAN flip live mid-session, e.g.
    // loading a new file with a different SETUP sheet, or a flag edit
    // during testing). Once locked, the panel was permanently stuck
    // showing the locked message and a hidden input row forever after,
    // even once isFeatureOn() started returning true. Restore the real
    // body markup + input row whenever we open unlocked and the last
    // open left it in the locked state.
    const panel = document.getElementById("sqv2-panel");
    if(!isFeatureOn(APP.features,"smartSearch")){
      panel.classList.add("open");
      document.getElementById("sqv2-body").innerHTML =
        '<div style="text-align:center;padding:10px 4px">' + buildFeatureLockedHtml("smartSearch") + '</div>';
      document.getElementById("sqv2-inputrow").style.display = "none";
      _bodyShowingLocked = true;
      return;
    }
    if(_bodyShowingLocked){
      document.getElementById("sqv2-body").innerHTML = _bodyDefaultHtml;
      document.getElementById("sqv2-inputrow").style.display = "";
      _bodyShowingLocked = false;
    }
    panel.classList.add("open");
    ensureLoaded();
    document.getElementById("sqv2-input").focus();
  }

  function closePanel(){
    const panel = document.getElementById("sqv2-panel");
    if(panel) panel.classList.remove("open");
  }

  let _loadAttempted = false;
  function ensureLoaded(){
    if(_loadAttempted) return;
    _loadAttempted = true;
    import('../../bal/smart-search/smart-query-v2.js').then(function(){
      return window.SmartQueryV2.load();
    }).catch(function(){
      showAnswer("Couldn't load the question bank — try reopening this panel.");
    });
  }

  function showAnswer(text){
    const el = document.getElementById("sqv2-answer");
    if(!el) return;
    el.textContent = text;
    el.classList.add("show");
    document.getElementById("sqv2-empty").style.display = "none";
  }

  function clearAnswer(){
    const el = document.getElementById("sqv2-answer");
    if(el){ el.textContent = ""; el.classList.remove("show"); }
  }

  function showResults(results){
    const wrap = document.getElementById("sqv2-results");
    if(!wrap) return;
    wrap.innerHTML = "";
    if(!results.length) return;
    document.getElementById("sqv2-empty").style.display = "none";
    results.forEach(function(r){
      const item = document.createElement("div");
      item.className = "sqv2-result-item";
      item.innerHTML = '<div class="sqv2-result-cat">' + escapeHtml(r.category||"") + '</div>' + escapeHtml(r.label);
      item.addEventListener("click", function(){ answerAndShow(r.id); });
      wrap.appendChild(item);
    });
  }

  function clearResults(){
    const wrap = document.getElementById("sqv2-results");
    if(wrap) wrap.innerHTML = "";
  }

  function escapeHtml(v){
    return String(v||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function answerAndShow(questionId){
    if(!window.SmartQueryV2 || !window.SmartQueryV2.isReady()){
      showAnswer(srT("smart_question_bank_not_loaded_retry"));
      return;
    }
    const SmartQueryV2 = window.SmartQueryV2;
    clearResults();
    const res = SmartQueryV2.answerQuestion(questionId);
    showAnswer(res.text);
  }

  function handleAsk(){
    const input = document.getElementById("sqv2-input");
    const text = input ? input.value.trim() : "";
    if(!text) return;
    // BUG FIX: input value was never reset after Ask — every prior
    // question stayed sitting in the box after the answer came back
    // (matches core/render-buckets.js's smartChatSubmit(), which already
    // clears its own composer the same way).
    if(input) input.value = "";
    clearAnswer();
    clearResults();

    if(!window.SmartQueryV2 || !window.SmartQueryV2.isReady()){
      import('../../bal/smart-search/smart-query-v2.js').then(function(){
        return window.SmartQueryV2.load();
      }).then(function(){ runAsk(text); }).catch(function(){
        showAnswer("Couldn't load the question bank — try again.");
      });
      return;
    }
    runAsk(text);
  }

  function runAsk(text){
    const SmartQueryV2 = window.SmartQueryV2;
    const result = SmartQueryV2.ask(text);
    if(result.matched){
      showAnswer(result.text);
      return;
    }
    // No confident single match — fall back to showing the ranked
    // candidate list (if any) so the user can pick one, rather than
    // just showing a dead-end deflection message.
    const m = SmartQueryV2.match(text, 5);
    if(m.ok && m.results.length){
      showResults(m.results);
    } else {
      showAnswer(result.text || (m.text || "I couldn't find a matching question."));
    }
  }

  function init(){
    injectStyle();
    injectDom();
  }

  // FIX (live-browser bug found 2026-08-30, "Cannot access 'APP' before
  // initialization"): module scripts execute after DOM parsing (like
  // `defer`), so document.readyState is never actually "loading" here in
  // practice — this branch always ran init() immediately, at module
  // top-level. Under ES modules that's a circular-import TDZ crash:
  // init() -> injectDom() -> applyLauncherVisibility() needs APP from
  // state-nav.js, and this file is reached via a cycle (state-nav.js ->
  // template-upload.js -> this file -> state-nav.js, created 2026-08-30
  // when template-upload.js started importing updateSmartLauncherVisibility
  // from here) before state-nav.js finishes initializing APP. This crash
  // also cascaded into a second, separate-looking error in vs-shell.js
  // (getState() needing the same not-yet-initialized APP) — that file
  // already had the correct fix for its OWN pre-existing state-nav.js
  // cycle (deferring initShell() the same way below), but couldn't help
  // once this crash interrupted state-nav.js's module evaluation before
  // it ever got there. Same fix as vs-shell.js's initShell(): deferring
  // via a microtask lets the full synchronous module-evaluation phase
  // (including state-nav.js's own top-level code) finish first.
  // Imperceptible timing change (sub-millisecond).
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  } else {
    Promise.resolve().then(init);
  }

})();

export { updateSmartLauncherVisibility };
