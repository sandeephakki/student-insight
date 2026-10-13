// Leaf DOM helpers (zero imports) shared by every layer. Extracted from
// core/app-utils-init.js so esc/toast/etc. no longer drag consumers into the
// core/ui import cycle.

/* ════ UTILS ════ */
// Review P1 #6: extend esc() to also escape single quote and backtick so
// values are safe in single-quoted attribute contexts too (template literals
// inside ${} contexts, e.g. `class='${esc(x)}'`, attribute selectors).
function esc(v){
  return String(v||"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;")
    .replace(/`/g,"&#96;");
}

/* Shared screen-swap helper: .show() plus the .screen-fade-in transition class,
   re-added each call so repeated taps keep re-triggering the animation. */
function showScreen(selectorOrEl){
  const $el = (typeof selectorOrEl==="string") ? $(selectorOrEl) : selectorOrEl;
  $el.removeClass("screen-fade-in");
  $el.show();
  // Force reflow so re-adding the class restarts the CSS animation.
  void $el[0]?.offsetWidth;
  $el.addClass("screen-fade-in");
  return $el;
}

/* Consistent empty-state markup used wherever a bucket/list has nothing to show. */
function emptyStateHtml(title, sub){
  return `<div class="bucket-empty-state">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#icon-48"/></svg>
    <div class="bucket-empty-title">${esc(title)}</div>
    ${sub?`<div class="bucket-empty-sub">${esc(sub)}</div>`:""}
  </div>`;
}

// Review P0 #2: toast() no longer writes `msg` into innerHTML. Use toast()
// for plain strings (auto-escaped via textContent) and toastHTML() for the
// rare case where you intentionally need markup. Past callers passed only
// text or esc()-wrapped text — none passed raw HTML — verified via repo grep.
function _showToastInner(html, type){
  const wrap=$("#toast-wrap");const cap=2;
  while(wrap.children().length>=cap)wrap.children().first().remove();
  const el=$(`<div class="toast ${type}" role="${type==="error"?"alert":"status"}">${html}</div>`);
  wrap.append(el);
  setTimeout(()=>el.fadeOut(300,()=>el.remove()),3500);
}

function toast(msg,type=""){
  const d=document.createElement("div");
  d.textContent=String(msg);
  _showToastInner(d.innerHTML, type);
}

// toastHTML: explicit opt-in for callers that intentionally need markup.
// Caller is responsible for sanitizing the input (use esc() or build with
// DOM APIs).
function toastHTML(html, type=""){_showToastInner(html, type);}

export { esc, showScreen, emptyStateHtml, toast, toastHTML };
if(typeof window!=='undefined'){window.esc=esc;window.showScreen=showScreen;window.emptyStateHtml=emptyStateHtml;window.toast=toast;window.toastHTML=toastHTML;}
