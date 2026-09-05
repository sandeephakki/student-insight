// StudInPro footer ticker.
//
// REWRITE NOTE: the previous version used CSS @keyframes + listening for
// the "animationend" DOM event to chain to the next item. Across several
// rounds of real testing, that kept showing the badge but no scrolling
// text — and it's genuinely hard to diagnose blind (dynamically
// created/replaced elements, animation-event timing, and
// animation-play-state interactions all have known cross-browser rough
// edges). Rather than keep guessing, this version drives the scroll
// position directly from JS on every animation frame — no CSS animation,
// no animationend, no event to silently not fire. If this still doesn't
// move, the bug is somewhere much more basic (element not found, script
// not loading) and will be easy to tell apart from a subtle animation-
// timing issue.
//
// Behavior (per product decision — see conversation record):
//  - All items joined into one continuous right-to-left scroll, looping
//    forever — a full lap takes LOOP_SECONDS.
//  - On hover/touch: motion stops completely and a "tap to learn more"
//    hint appears instead. Only an actual click opens the form.
//  - Context-aware: items matching APP.currentStep are moved to the
//    front of the loop, so they're the first thing seen on that screen.
//  - Clicking anywhere on the ticker opens the shared #modal-overlay with
//    the StudInPro form.
//
// All wording lives in i18n/studinpro/<lang>.json (with a hard English
// fallback baked in below for zero dependency on i18n load timing). All
// item identity/context lives in core/studinpro-items.js. This file only
// renders/animates — it should never need editing just to add or change
// a promo line.

import { STUDINPRO_ITEMS } from '../../core/studinpro-items.js';
import { gsapModalEntrance } from './render-core.js';

(function(){
  var LOOP_SECONDS = 70;
  var SEPARATOR = "   •   ";

  var _paused = false;
  var _pauseStart = null;
  var _rafId = null;
  var _startTs = null;
  var _wrap, _viewport, _text;

  // Hard English fallback, kept in sync with i18n/studinpro/en.json, so
  // real text always renders regardless of whether the async i18n JSON
  // fetch (core/render-i18n.js loadLanguage()) has completed — or even
  // been triggered at all (it only runs once onboarding/language
  // selection happens; SR_STRINGS_EN, the inline JS fallback table used
  // in the meantime, never had these new "studinpro.*" keys added to it,
  // so without this map srT() would return the raw, unresolved key).
  // srT() (once its table is genuinely ready) overrides this — this is
  // only the floor, never the ceiling.
  var FALLBACK = {
    "studinpro.item.pro_intro": "StudInPro is an advanced ERP that solves your institution's everyday challenges.",
    "studinpro.item.contact_query": "For StudInPro or any other query, contact: sandeep@hakki.in | sandeephakki@gmail.com",
    "studinpro.form_modal_title": "StudInPro — Tell us about your school",
    "studinpro.form_modal_desc": "StudIn stays free, always. This just helps us understand who's using it, so we can build StudInPro around real needs.",
    "studinpro.form_modal_email_note": "Prefer email? Reach us directly:",
    "studinpro.already_submitted_msg": "Thanks — we've already received your details. We'll be in touch about StudInPro soon.",
    "studinpro.fill_again_btn": "Fill the form again",
    "studinpro.ticker.aria_label": "StudInPro announcements, updates every few seconds"
  };

  // Shared text lookup: real translation if the table has it, else the
  // hard English fallback above, else the bare key as a last resort (so
  // a genuinely new/mistyped key is at least visible/debuggable instead
  // of silently blank).
  function t(key){
    if(typeof srT === "function"){
      var txt = srT(key);
      if(txt && txt !== key) return txt; // real, resolved translation
    }
    return FALLBACK[key] || key;
  }

  function itemText(it){
    return t("studinpro.item." + it.id);
  }

  // Context items first (so the screen a user is actually on shows its
  // relevant line earliest in the loop), rest after, each group sorted by
  // priority descending.
  function buildOrder(){
    var step = (window.APP && APP.currentStep) || "home";
    var items = (typeof STUDINPRO_ITEMS !== "undefined") ? STUDINPRO_ITEMS.slice() : [];
    var matching = items.filter(function(it){ return (it.context||[]).indexOf(step) !== -1; });
    var rest = items.filter(function(it){ return (it.context||[]).indexOf(step) === -1; });
    var byPriorityDesc = function(a,b){ return (b.priority||0)-(a.priority||0); };
    matching.sort(byPriorityDesc);
    rest.sort(byPriorityDesc);
    return matching.concat(rest);
  }

  function buildJoinedText(){
    var order = buildOrder();
    return order.map(itemText).join(SEPARATOR) + SEPARATOR; // trailing separator before it loops back to start
  }

  function tick(ts){
    if(_startTs === null) _startTs = ts;
    if(!_paused){
      var elapsed = (ts - _startTs) / 1000; // seconds
      var viewportW = _viewport.clientWidth;
      var textW = _text.offsetWidth || 1;
      var totalTravel = viewportW + textW; // from fully off right to fully off left
      var pxPerSecond = totalTravel / LOOP_SECONDS;
      var traveled = (elapsed * pxPerSecond) % totalTravel;
      var x = viewportW - traveled; // start at right edge, move left
      _text.style.transform = "translateX(" + x + "px)";
    }
    // While paused, do nothing — leave _startTs untouched so the text
    // stays frozen exactly where it was. pauseForHover()/resumeAfterHover()
    // below shift _startTs forward by the paused duration on resume, so
    // motion continues smoothly from the same spot rather than jumping
    // back to the start.
    _rafId = requestAnimationFrame(tick);
  }

  function renderStudInProTicker(){
    _wrap = document.getElementById("studinpro-ticker");
    _viewport = document.getElementById("studinpro-ticker-scroll");
    if(!_wrap || !_viewport) return;
    var label = t("studinpro.ticker.aria_label");
    _wrap.setAttribute("aria-label", label||"");
    _viewport.innerHTML = '<span id="studinpro-ticker-text"></span>';
    _text = document.getElementById("studinpro-ticker-text");
    _text.textContent = buildJoinedText();
    _startTs = null; // restart the sweep cleanly with the new text
    if(_rafId === null) _rafId = requestAnimationFrame(tick);
  }

  function pauseForHover(){
    _paused = true;
    _pauseStart = performance.now();
    var hint = document.getElementById("studinpro-ticker-hint");
    if(hint) hint.style.display = "inline";
  }
  function resumeAfterHover(){
    if(_pauseStart !== null && _startTs !== null){
      _startTs += (performance.now() - _pauseStart); // shift forward by however long we were paused, so motion continues from the same spot
    }
    _pauseStart = null;
    _paused = false;
    var hint = document.getElementById("studinpro-ticker-hint");
    if(hint) hint.style.display = "none";
  }

  document.addEventListener("DOMContentLoaded", function(){
    var wrap = document.getElementById("studinpro-ticker");
    if(!wrap) return;
    wrap.addEventListener("mouseenter", pauseForHover);
    wrap.addEventListener("mouseleave", resumeAfterHover);
    wrap.addEventListener("touchstart", pauseForHover, {passive:true});
    renderStudInProTicker();
  });

  window.renderStudInProTicker = renderStudInProTicker;

  // Shared modal (#modal-overlay/#modal-box/#modal-content), same pattern
  // used by Sample Files / Student Detail / AI Translation Notice modals
  // elsewhere in this app.
  var FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdFO5frAoJzarVMbtXcZNF4JCky42SqYivqN4velVZ0kMisbg/viewform?embedded=true";
  var SUBMITTED_KEY = "studinProFormSubmitted";

  function hasAlreadySubmitted(){
    try { return window.localStorage.getItem(SUBMITTED_KEY) === "1"; } catch(e){ return false; }
  }
  function markSubmitted(){
    try { window.localStorage.setItem(SUBMITTED_KEY, "1"); } catch(e){ /* privacy mode etc — ignore, worst case they see the form again next time */ }
  }

  function showStudInProForm(){
    var esc_ = (typeof esc === "function") ? esc : function(s){ return s; };

    if(hasAlreadySubmitted()){
      // Already filled it out once — don't show the form again by
      // default, just a short, friendly confirmation. "Fill it again"
      // stays available in case they genuinely want to (new institution,
      // correction, etc.) rather than hard-blocking them.
      var modalContent = document.getElementById("modal-content");
      if(modalContent) modalContent.innerHTML =
        '<h3 style="font-family:var(--font-display);font-size:16px;margin-bottom:10px">' + esc_(t("studinpro.form_modal_title")) + '</h3>' +
        '<div style="font-size:13px;color:var(--c-text2);line-height:1.5;margin-bottom:16px">' + esc_(t("studinpro.already_submitted_msg")) + '</div>' +
        '<button type="button" class="btn btn-sm" id="studinpro-fill-again-btn">' + esc_(t("studinpro.fill_again_btn")) + '</button>' +
        '<div style="font-size:12px;color:var(--c-text3);margin-top:14px">' + esc_(t("studinpro.form_modal_email_note")) +
          ' <a href="mailto:sandeep@hakki.in">sandeep@hakki.in</a> · <a href="mailto:sandeephakki@gmail.com">sandeephakki@gmail.com</a></div>';
      if(typeof gsapModalEntrance === "function") gsapModalEntrance();
      var again = document.getElementById("studinpro-fill-again-btn");
      if(again) again.addEventListener("click", function(){ renderFormIframe(); });
      return;
    }
    renderFormIframe();
  }

  function renderFormIframe(){
    var esc_ = (typeof esc === "function") ? esc : function(s){ return s; };
    var modalContent2 = document.getElementById("modal-content");
    if(modalContent2) modalContent2.innerHTML =
      '<h3 style="font-family:var(--font-display);font-size:16px;margin-bottom:10px">' + esc_(t("studinpro.form_modal_title")) + '</h3>' +
      '<div style="font-size:13px;color:var(--c-text2);line-height:1.5;margin-bottom:14px">' + esc_(t("studinpro.form_modal_desc")) + '</div>' +
      '<iframe id="studinpro-form-iframe" src="' + FORM_URL + '" style="width:100%;min-height:420px;border:1px solid var(--c-border);border-radius:var(--r-sm)" loading="lazy"></iframe>' +
      '<div style="font-size:12px;color:var(--c-text3);margin-top:12px">' + esc_(t("studinpro.form_modal_email_note")) +
        ' <a href="mailto:sandeep@hakki.in">sandeep@hakki.in</a> · <a href="mailto:sandeephakki@gmail.com">sandeephakki@gmail.com</a></div>';
    if(typeof gsapModalEntrance === "function") gsapModalEntrance();
    setTimeout(function(){
      var f = document.querySelector('#modal-overlay.open .modal-close');
      if(f) f.focus();
    }, 0);

    // Submission detection: a Google Form embedded via iframe is
    // cross-origin, so it can't post a message to us directly — but on
    // successful submit, Google navigates the SAME iframe from the
    // question page to a "your response has been recorded" page, which
    // fires a second "load" event on that iframe. We don't need to read
    // the iframe's content (we can't, cross-origin) — just count loads:
    // the first is the form itself rendering, the second is the
    // post-submit confirmation page, which is our submitted signal.
    var iframe = document.getElementById("studinpro-form-iframe");
    if(!iframe) return;
    var loadCount = 0;
    iframe.addEventListener("load", function(){
      loadCount++;
      if(loadCount >= 2){
        markSubmitted();
        if(typeof closeModal === "function") closeModal();
      }
    });
  }
  window.showStudInProForm = showStudInProForm;
})();
