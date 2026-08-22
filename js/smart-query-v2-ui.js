import { SmartQueryV2 } from './smart-query-v2.js';
import { srT } from './render-i18n.js';

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
      '</div>';

    document.body.appendChild(launcher);
    document.body.appendChild(panel);

    document.getElementById("sqv2-close").addEventListener("click", closePanel);
    document.getElementById("sqv2-ask").addEventListener("click", handleAsk);
    document.getElementById("sqv2-input").addEventListener("keydown", function(e){
      if(e.key === "Enter") handleAsk();
    });
  }

  function togglePanel(){
    const panel = document.getElementById("sqv2-panel");
    if(!panel) return;
    if(panel.classList.contains("open")) closePanel();
    else openPanel();
  }

  function openPanel(){
    const panel = document.getElementById("sqv2-panel");
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
    if(_loadAttempted || !window.SmartQueryV2) return;
    _loadAttempted = true;
    SmartQueryV2.load().catch(function(){
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
    if(!window.SmartQueryV2 || !SmartQueryV2.isReady()){
      showAnswer(srT("smart_question_bank_not_loaded_retry"));
      return;
    }
    clearResults();
    const res = SmartQueryV2.answerQuestion(questionId);
    showAnswer(res.text);
  }

  function handleAsk(){
    const input = document.getElementById("sqv2-input");
    const text = input ? input.value.trim() : "";
    if(!text) return;
    clearAnswer();
    clearResults();

    if(!window.SmartQueryV2){
      showAnswer(srT("smart_query_not_available_page"));
      return;
    }
    if(!SmartQueryV2.isReady()){
      SmartQueryV2.load().then(function(){ runAsk(text); }).catch(function(){
        showAnswer("Couldn't load the question bank — try again.");
      });
      return;
    }
    runAsk(text);
  }

  function runAsk(text){
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

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
