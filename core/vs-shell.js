import { emptyStateHtml, esc } from './app-utils-init.js';
import { buildCompareExportControlsHtml, buildCompareSectionListHtml, buildDashboardControlsHtml, buildIndividualDashboardControlsHtml, ensureSmartQueryLoaded, openBucket, renderComparePicker, renderDashboardSmartSearch } from '../ui/common/render-buckets.js';
import { updateExportGate } from '../ui/common/render-core.js';
import { renderClassAnswer, renderClusterGroups, renderFilteredList, renderStudentPicker } from '../ui/common/render-findings.js';
import { i18nLabel, srT } from './render-i18n.js';
import { APP, goStep } from './state-nav.js';
import { getRecentFiles } from './template-upload.js';

/* ============================================================
   Student Insight — VS-Style Shell engine
   (vs-shell-plan-v2.md Task 3 skeleton + Task 7 session state)
   Replaces the scrapped js/app-shell.js. Same setLeftRail()/
   setRightRail() contract the old shell used, new correctly-built
   implementation underneath: fixed-position left/right panels,
   resizable by dragging a divider, collapsible/expandable — not true
   drag-to-anywhere docking (confirmed out of scope).

   Task 4/5/6 (real panel content) not started — blocked on the
   missing shell-redesign-plan.md §4.1-§4.3 key lists. This file
   doesn't know or care what content setLeftRail()/setRightRail() are
   called with once that lands.
============================================================ */

(function(){

  const MIN_W = 160, MAX_W = 420, COLLAPSED_W = 28;
  // vs-shell-plan-v2 Task 8: on first load, mobile (<=768px) starts
  // collapsed (info strip / bottom pill) so the sheet doesn't cover the
  // screen by default; desktop's default (expanded) is unchanged from
  // Task 3 — this only affects the *initial* value, still overridable
  // by the user via vsShellToggle() same as before.
  const mobileDefault = (typeof window !== "undefined" && window.innerWidth <= 768);
  // vs-shell-plan-v2 Task 7: session-persistent (in-memory only,
  // NO_PERSISTENCE — resets on reload) panel state, promoted from a
  // closure-local var to APP.shellState so it's inspectable the same
  // way other app state is. Survives Home -> Setup -> Dashboard
  // navigation because #app-shell-body itself is never torn down.
  //
  // FIX (module-system conversion, HANDOVER #4): this used to read
  // APP.shellState immediately here, at IIFE top level. Under ES modules,
  // vs-shell.js <-> state-nav.js form a circular import (vs-shell.js
  // imports APP from state-nav.js; state-nav.js's own dependency chain
  // transitively imports vs-shell.js), so this file's top-level code can
  // run before state-nav.js has finished initializing APP, throwing
  // "Cannot access 'APP' before initialization". Deferring to first real
  // call (all 12 usages below are already inside functions invoked after
  // the full module graph has loaded) breaks the cycle with no behavior
  // change — same object, same shape, just not read until it's needed.
  let _state = null;
  function getState(){
    if(!_state){
      if(typeof window !== "undefined" && !window.APP) window.APP = {};
      if(!APP.shellState){
        APP.shellState = {
          start: { width: 240, collapsed: mobileDefault }, // desktop: always open. mobile: starts collapsed, same as end
          end:   { width: 240, collapsed: mobileDefault }
        };
      }
      _state = (typeof window !== "undefined") ? APP.shellState : {
        start: { width: 240, collapsed: false },
        end:   { width: 240, collapsed: false }
      };
    }
    return _state;
  }

  // Small inline icon set for the Home rail's pitch rows (prompt-v4.19
  // follow-up: replace the plain <li> bullet wall with something that
  // actually looks designed). Same stroke style as every other icon in
  // the app (viewBox 0 0 24 24, stroke=currentColor, stroke-width 2) so
  // nothing here introduces a new visual language, just applies the
  // existing one to a spot that never had icons at all.
  const PITCH_ICONS = {
    doc:    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    shield: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    users:  '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    globe:  '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 0 0 20"/><path d="M12 2a15 15 0 0 1 0 20"/>',
    chat:   '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4A8.9 8.9 0 0 1 3 15.5 8.4 8.4 0 0 1 11 3a8.9 8.9 0 0 1 8.6 6.1c.27.8.4 1.6.4 2.4Z"/>',
    trend:  '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
    gauge:  '<path d="M12 20a8 8 0 1 0-8-8"/><path d="M12 12 16 8"/>',
    grid:   '<path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M14 14h7v7h-7z"/><path d="M3 14h7v7H3z"/>',
    flag:   '<path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/>',
    trophy: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 5H4a2 2 0 0 0 2 4h1"/><path d="M17 5h3a2 2 0 0 1-2 4h-1"/>',
    heart:  '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5 9-5"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>'
  };
  const HOME_LEFT_ICONS  = ["doc","shield","target","users","globe","chat","trend"];
  const HOME_RIGHT_ICONS = ["gauge","grid","flag","trophy","heart","layers"];
  function pitchRow(iconKey, text){
    const inner = PITCH_ICONS[iconKey] || PITCH_ICONS.doc;
    return '<div class="pitch-row"><span class="pitch-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + inner + '</svg></span><span class="pitch-text">' + esc(text) + '</span></div>';
  }

  function root(){ return document.getElementById("app-shell-body"); }

  function applyWidth(side){
    const el = root();
    if(!el) return;
    const s = getState()[side];
    const px = s.collapsed ? COLLAPSED_W : s.width;
    el.style.setProperty(`--panel-${side}-width`, px + "px");
  }

  // Task 1: persisted open/closed state for the Home "Recent Files"
  // <details>, keyed separately from RECENT_FILES_KEY (that's file data,
  // this is a UI preference) — see renderShellLeftRail()'s home branch.
  const LEFT_RAIL_RECENT_OPEN_KEY = "studin_left_rail_recent_open";
  function getLeftRailRecentOpenPref(){
    try{
      const raw = localStorage.getItem(LEFT_RAIL_RECENT_OPEN_KEY);
      return raw === null ? true : raw === "1"; // default open, matching prior hardcoded behavior
    }catch(err){
      return true;
    }
  }
  function setLeftRailRecentOpenPref(isOpen){
    try{
      localStorage.setItem(LEFT_RAIL_RECENT_OPEN_KEY, isOpen ? "1" : "0");
    }catch(err){
      // Storage can fail (private browsing, quota) — this is a display
      // preference, not core functionality, so fail silently.
    }
  }
  function setLeftRail(html){
    const el = document.getElementById("shell-rail-start");
    if(el) el.innerHTML = html || "";
  }
  function setRightRail(html){
    const el = document.getElementById("shell-rail-end");
    if(el) el.innerHTML = html || "";
  }

  function syncPanelDOM(side){
    const s = getState()[side];
    const panel = document.getElementById(`shell-panel-${side}`);
    const btn = document.getElementById(`shell-panel-${side}-toggle`);
    if(panel) panel.dataset.collapsed = s.collapsed ? "true" : "false";
    if(btn){
      btn.setAttribute("aria-expanded", s.collapsed ? "false" : "true");
      btn.setAttribute("aria-label", s.collapsed ? srT("shell_expand_panel") : srT("shell_collapse_panel"));
    }
  }

  function isMobileViewport(){
    return typeof window !== "undefined" && window.innerWidth <= 768;
  }
  function vsShellToggle(side){
    const s = getState()[side];
    s.collapsed = !s.collapsed;
    syncPanelDOM(side);
    applyWidth(side);
  }
  // ui-prompt-batch2.md item 1: explicit open/close for BOTH sides at
  // once — the manual per-side vsShellToggle() above stays as-is for the
  // chevron click; this is the programmatic "car-mirror" trigger tied to
  // dashboard mode (Smart bucket dashboard vs Classic), not a third
  // mechanism. Reuses the exact same state/transition, just sets rather
  // than flips.
  //
  // Mobile fix: on <=768px the panels render as fixed full-width overlay
  // sheets (top strip / bottom sheet, up to 70vh — see css/vs-shell.css
  // Task 8 block), not side columns. Programmatically forcing one open
  // there means a 70vh sheet slams over the screen with no tap from the
  // user — closing is still always safe (it's the mobile default anyway),
  // so only the "open" direction is skipped on mobile; the sheet only
  // expands from an explicit vsShellToggle() tap.
  function setShellRailsOpen(open){
    if(open && isMobileViewport()) return;
    ["start","end"].forEach(function(side){
      if(side === "start" && !open && !isMobileViewport()) return; // desktop: start always open, no collapse. mobile: can close, same as end
      getState()[side].collapsed = !open;
      syncPanelDOM(side);
      applyWidth(side);
    });
  }
  window.setShellRailsOpen = setShellRailsOpen;
  // v4.20-bugfixes §2b/2c: per-side variant, same internals as above —
  // needed so an Insights bucket can close/open just #shell-rail-end
  // without touching #shell-rail-start (which stays open throughout).
  // Same mobile guard as setShellRailsOpen() above, for the same reason.
  function setShellRailOpen(side, open){
    if(side === "start" && !open && !isMobileViewport()) return; // desktop: start always open, no collapse. mobile: can close, same as end
    if(open && isMobileViewport()) return;
    getState()[side].collapsed = !open;
    syncPanelDOM(side);
    applyWidth(side);
  }
  window.setShellRailOpen = setShellRailOpen;
  // exposed for the onclick="" handlers in index.html
  window.vsShellToggle = vsShellToggle;
  window.setLeftRail = setLeftRail;
  window.setRightRail = setRightRail;

  // mobile fix (screenshot follow-up): on <=768px, the left/right panels
  // render as a top strip / bottom sheet (see css/vs-shell.css mobile
  // block) that stays open until the user manually taps the toggle bar
  // again, covering the main screen the whole time. Any tap on an actual
  // control inside the open sheet (a button, link, bucket row, checkbox/
  // radio, or anything with an onclick handler) should close that sheet
  // right after, so the user lands back on the main screen instead of
  // having to close it themselves. Plain text taps and typing in a text
  // input are deliberately excluded so this doesn't fight normal typing.
  function isActionableTarget(el){
    return !!el.closest('button, a, .bucket-row, .shell-chip, [role="button"], input[type="checkbox"], input[type="radio"], label, [onclick]');
  }
  function isTypingTarget(el){
    return !!el.closest('input[type="text"], input[type="search"], input[type="number"], input:not([type]), textarea, select, [contenteditable="true"]');
  }
  function attachMobileAutoClose(side){
    const content = document.getElementById(side === "start" ? "shell-rail-start" : "shell-rail-end");
    if(!content) return;
    content.addEventListener("click", function(e){
      if(!isMobileViewport()) return;
      if(getState()[side].collapsed) return;
      if(isTypingTarget(e.target)) return;
      if(!isActionableTarget(e.target)) return;
      // let the tapped control's own onclick/handler run first (navigation,
      // toggling a checkbox, answering a Smart Query chip, etc.), then
      // collapse the sheet back to its strip on the next tick.
      setTimeout(function(){
        getState()[side].collapsed = true;
        syncPanelDOM(side);
        applyWidth(side);
      }, 120);
    }, true);
  }

  function initDivider(dividerId, side){
    const divider = document.getElementById(dividerId);
    if(!divider) return;
    let dragging = false, startX = 0, startW = 0;

    // inline-start/end aware: for the start-side panel, dragging toward
    // the core (inline-end) should shrink it; for the end-side panel,
    // dragging toward the core (inline-start) should shrink it. Reading
    // getComputedStyle direction per-drag (rather than assuming ltr)
    // keeps this correct under [dir="rtl"] without a duplicate code path.
    function dirSign(){
      return getComputedStyle(document.documentElement).direction === "rtl" ? -1 : 1;
    }

    function onPointerDown(e){
      if(getState()[side].collapsed) return;
      dragging = true;
      startX = e.clientX;
      startW = getState()[side].width;
      divider.classList.add("shell-divider-active");
      root() && root().classList.add("shell-no-anim");
      divider.setPointerCapture && divider.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e){
      if(!dragging) return;
      const raw = e.clientX - startX;
      const delta = side === "start" ? raw * dirSign() : -raw * dirSign();
      const next = Math.min(MAX_W, Math.max(MIN_W, startW + delta));
      getState()[side].width = next;
      applyWidth(side);
    }
    function onPointerUp(e){
      if(!dragging) return;
      dragging = false;
      divider.classList.remove("shell-divider-active");
      root() && root().classList.remove("shell-no-anim");
      divider.releasePointerCapture && divider.releasePointerCapture(e.pointerId);
    }

    divider.addEventListener("pointerdown", onPointerDown);
    divider.addEventListener("pointermove", onPointerMove);
    divider.addEventListener("pointerup", onPointerUp);
    divider.addEventListener("pointercancel", onPointerUp);

    // keyboard resize for the same divider (role="separator"), 10px steps
    divider.addEventListener("keydown", function(e){
      if(getState()[side].collapsed) return;
      let step = 0;
      if(e.key === "ArrowLeft") step = -10;
      else if(e.key === "ArrowRight") step = 10;
      else return;
      e.preventDefault();
      const sign = side === "start" ? dirSign() : -dirSign();
      getState()[side].width = Math.min(MAX_W, Math.max(MIN_W, getState()[side].width + step * sign));
      applyWidth(side);
    });
  }

  function initShell(){
    syncPanelDOM("start");
    syncPanelDOM("end");
    applyWidth("start");
    applyWidth("end");
    initDivider("shell-divider-start", "start");
    initDivider("shell-divider-end", "end");
    attachMobileAutoClose("start");
    attachMobileAutoClose("end");
    initMobileFirstVisitHint();
    initMobileSheetHeightVar();
    // Item 2 fix (ui-prompt-template.md §4.1): the rails weren't showing
    // any text on Home. goStep("home") already calls
    // renderShellLeftRail()/renderShellRightRail(), but that boot call
    // happens from app-utils-init.js — an earlier <script> tag than this
    // file — so if it ever runs before vs-shell.js has finished loading,
    // those two functions are still undefined and the call is silently
    // skipped (goStep()'s own typeof guard). Re-render explicitly here,
    // once this file is guaranteed loaded, as a safety net — harmless if
    // goStep() already succeeded (just a redundant re-render of the same
    // content), fixes it if goStep() silently no-op'd.
    if(typeof renderShellLeftRail === "function") renderShellLeftRail((window.APP && APP.currentStep) || "home");
    if(typeof renderShellRightRail === "function") renderShellRightRail((window.APP && APP.currentStep) || "home");
  }

  // Bug fix (reported 2026-08-17): "any selection scrolls the middle
  // section up, and it only ever goes up." A MutationObserver-based
  // "restore the user's last scroll position" guard used to live here.
  // It's gone — the actual, confirmed-desired behavior (per follow-up
  // clarification the same day) is the opposite: every fresh selection
  // should land at the TOP of the new content, every time, not stay
  // wherever the user had scrolled. That reset now lives centrally in
  // js/inline-actions.js's delegated click handler (SCROLL_RESET_ACTIONS),
  // which force-sets #main's (or, on mobile, the page's) scrollTop to 0
  // right after each listed selection action runs. A restore-based guard
  // here would fight that fix directly — its MutationObserver callback
  // runs as a microtask after the click handler's synchronous reset,
  // silently undoing it back to the old scrolled position — which is
  // exactly why an earlier attempt at this fix looked like it "wasn't
  // working" no matter what changed in inline-actions.js. See
  // css/vs-shell.css's #main and css/core.css's body rules
  // (overflow-anchor:none) for the other half of that fix: without it, a
  // real browser's own default scroll anchoring can re-adjust scrollTop
  // a beat after inline-actions.js's reset too, once async layout (charts,
  // images) settles.

  // mobile fix (still-banging follow-up, 2026-07-30): the CSS height
  // transition between 36px (collapsed) and min(70vh, calc(100vh - var(
  // --content-top))) (expanded) still read as a snap rather than a slide
  // on mobile Safari — animating `height` to a min()/calc()/vh-based
  // target is exactly the case WebKit doesn't interpolate smoothly on;
  // it recomputes the expression each frame instead of gliding between
  // two known numbers. Fix: resolve that expression down to a concrete
  // pixel number in JS, once at load and again on resize/orientation
  // change, and expose it as --shell-sheet-h for the CSS transition to
  // animate toward instead. The CSS keeps the old min()/calc() as a
  // fallback default (var(--shell-sheet-h, min(...))) so nothing breaks
  // if this runs before the variable is set, or on very old browsers
  // without CSS custom property support.
  function computeMobileSheetHeightPx(){
    const contentTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--content-top")) || 96;
    const px = Math.min(window.innerHeight * 0.7, window.innerHeight - contentTop);
    document.documentElement.style.setProperty("--shell-sheet-h", Math.round(px) + "px");
  }
  function initMobileSheetHeightVar(){
    computeMobileSheetHeightPx();
    let resizeTimer = null;
    window.addEventListener("resize", function(){
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(computeMobileSheetHeightPx, 120);
    });
  }

  // mobile fix (screenshot follow-up, 2026-07-30): a first-time mobile
  // user has no reason to know the thin "FEATURES"/"PROPERTIES" strips
  // at the top/bottom of the screen are tappable sheets, let alone what
  // opening them does — there's no icon, animation, or copy hinting at
  // it, just a static-looking label bar. Fix is purely additive and
  // mobile-only: a gentle looping pulse on the existing drawer-handle
  // pill (::before in CSS) plus a short inline caption next to each
  // title ("Tap for page info & help" / "Tap for tools & actions"),
  // both scoped to `.shell-first-visit` on <body> so desktop is
  // completely unaffected. First genuine tap on EITHER strip clears the
  // class on both (so the user isn't shown the same hint twice in one
  // session) and remembers that via localStorage (no student data, same
  // pattern as the existing si-theme-choice key) so returning visitors
  // never see it again. Deliberately does NOT auto-expand either panel —
  // an uninvited 70vh sheet slamming over the screen on load would be
  // worse than the discoverability problem it's fixing; this only makes
  // the existing tap target easier to notice and understand.
  var SHELL_HINT_SEEN_KEY = "si-shell-hint-seen";
  function shellHintAlreadySeen(){
    try{ return !!localStorage.getItem(SHELL_HINT_SEEN_KEY); }catch(e){ return false; }
  }
  function markShellHintSeen(){
    try{ localStorage.setItem(SHELL_HINT_SEEN_KEY, "1"); }catch(e){}
  }
  function dismissShellHint(){
    document.body.classList.remove("shell-first-visit");
    markShellHintSeen();
  }
  function buildHintCaption(key, fallback){
    var span = document.createElement("span");
    span.className = "shell-panel-toggle-hint";
    span.textContent = (typeof i18nLabel === "function") ? i18nLabel(key, fallback) : fallback;
    return span;
  }
  function initMobileFirstVisitHint(){
    if(!isMobileViewport() || shellHintAlreadySeen()) return;
    document.body.classList.add("shell-first-visit");
    var startToggle = document.getElementById("shell-panel-start-toggle");
    var endToggle = document.getElementById("shell-panel-end-toggle");
    if(startToggle && !startToggle.querySelector(".shell-panel-toggle-hint")){
      startToggle.insertBefore(buildHintCaption("shell_hint_features_peek",srT("shell_hint_features_peek")), startToggle.lastElementChild);
    }
    if(endToggle && !endToggle.querySelector(".shell-panel-toggle-hint")){
      endToggle.insertBefore(buildHintCaption("shell_hint_properties_peek",srT("shell_hint_properties_peek")), endToggle.lastElementChild);
    }
    if(startToggle) startToggle.addEventListener("click", dismissShellHint, {once:true});
    if(endToggle) endToggle.addEventListener("click", dismissShellHint, {once:true});
    // also clear it if the viewport is resized past mobile (e.g. rotation
    // to a tablet width) so it doesn't linger oddly at a desktop size
    window.addEventListener("resize", function onResize(){
      if(!isMobileViewport()){ document.body.classList.remove("shell-first-visit"); window.removeEventListener("resize", onResize); }
    });
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", initShell);
  } else {
    // FIX (module-system conversion, HANDOVER #4): module scripts execute
    // after DOM parsing finishes (like `defer`), so document.readyState is
    // never actually "loading" here in practice — this branch always ran
    // initShell() immediately, at module top-level. That's fine for a
    // classic script, but under ES modules it's a circular-import TDZ
    // crash: initShell() -> syncPanelDOM() -> getState() needs APP from
    // state-nav.js, and state-nav.js's own dependency chain transitively
    // imports vs-shell.js before state-nav.js finishes initializing APP.
    // Deferring via a microtask lets the full synchronous module-
    // evaluation phase (including state-nav.js's own top-level code)
    // finish first. Imperceptible timing change (sub-millisecond) — same
    // synchronous-feeling init from the user's perspective.
    Promise.resolve().then(initShell);
  }

  /* ==========================================================
     Task 4 — Left panel: real content, real i18n.
     VS-Properties-panel style key/value rows. Reads the exact same
     APP.setup/APP.students/APP.sections/APP.homeSingleFile fields
     Setup/Home already display — no new state, no duplicate counters.
     Per shell-redesign-plan.md §2 Phase 2's content table (kept as
     the content mapping even though that file's *layout* phases are
     superseded): Home/About/FAQ show the empty state; Setup/AI/
     Dashboard/Export show file context; Dashboard adds the class/
     section label.
     ========================================================== */
  function row(label, value){
    return '<div class="shell-kv-row"><div class="shell-kv-label">'
      + esc(label) + '</div><div class="shell-kv-value">' + esc(value) + '</div></div>';
  }

  function renderShellLeftRail(step){
    if(typeof srT !== "function" || typeof APP === "undefined"){ return; } // guards early boot ordering
    const contextSteps = { setup:1, ai:1, dashboard:1, export:1, scholarship:1 };
    if(!contextSteps[step]){
      // ui-prompt-template.md item 3: Home gets a light "what this app
      // does" teaser instead of the plain empty state; About/FAQ (and any
      // other non-context step) keep the original empty state unchanged —
      // item 3 is scoped to Home only.
      if(step === "home"){
        // BUG FIX (recent-files feature): the old 7-row "what this app
        // does" pitch strip (PITCH_ICONS/pitchRow/HOME_LEFT_ICONS above)
        // is replaced entirely by "Current File Details" + "Recent
        // Files" — decided this rail is more useful showing real file
        // state than repeating marketing copy once someone has actually
        // used the app. Home-only, matching how "Recent Files" was
        // scoped: it only ever appears here, never on Setup/AI/
        // Dashboard/Export (those keep the existing shared file-details
        // block further down this function, untouched).
        const recent = getRecentFiles();
        if(!recent.length){
          // Nothing to show yet (brand new install, or the admin cleared
          // browser history/site data — recent files live in
          // localStorage, so a history clear wipes this same as any
          // other site data). Per spec: the whole rail goes empty/closed
          // rather than falling back to the old pitch content.
          setLeftRail("");
          return;
        }
        // Task 4 fix: a recent entry that came from a sample file
        // (isSample, set from APP._isSampleData at record time — see
        // recordRecentFile()/afterImportSuccess() in template-upload.js)
        // has a real fetchable path (assetBase+fileName — see
        // runSampleFile()), so clicking it re-runs that fetch directly
        // instead of opening the native file picker. Real uploads still
        // have no path the page can access, so those keep the picker.
        const sf = APP.homeSingleFile;
        const curRows = sf
          ? row(srT("shell_left_file_label"), sf.fileName)
            + row(srT("shell_left_org_label"), (APP.setup && APP.setup.instName) || "—")
            + row(srT("shell_left_records_label"), sf.rowCount || 0)
          : "";
        // Task 2 fix: "Current File Details" only opens when there's
        // actually a value to show — no value means no <details> at all
        // rather than an open-but-empty section.
        let html = sf
          ? '<details class="shell-details" open><summary class="shell-panel-title" style="cursor:pointer">'
            + esc(srT("shell_left_current_file_details_title")) + '</summary>' + curRows + '</details>'
          : "";
        // Scrollable list (see .shell-recent-files-list in css/vs-shell.css)
        // caps visible height once the list grows past a handful of
        // entries — recordRecentFile() in template-upload.js already caps
        // total stored entries at 15 and dedupes by fileName+institution+
        // class+section (moves an existing match to the top instead of
        // adding a second row), so this is purely a display constraint,
        // not a data one.
        const recentRows = recent.map(function(f){
          const label = [f.fileName, [f.className, f.section].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
          const key = [f.fileName, f.instName, f.className, f.section].map(v=>(v||"").trim().toLowerCase()).join("|");
          const rowAction = f.isSample
            ? 'data-action="runSampleFile" data-arg="' + esc(f.fileName) + '"'
            : 'data-action="triggerHomeImport"';
          return '<div class="shell-recent-file-row" ' + rowAction + ' role="button" tabindex="0">'
            + '<span class="shell-recent-file-name">' + esc(label) + '</span>'
            + '<button type="button" class="shell-recent-file-delete" data-action="deleteRecentFile" data-arg="' + esc(key) + '" aria-label="' + esc(srT("shell_left_recent_files_delete_aria") || "Remove") + '">×</button>'
            + '</div>';
        }).join("");
        // Task 1 fix: user's open/closed choice for "Recent Files" survives
        // a browser refresh — renderShellLeftRail() rebuilds this markup
        // from scratch on every load/step-change, so without persisting
        // the choice somewhere outside the DOM it would always reset back
        // to the hardcoded default. Stored separately from the recent-file
        // entries themselves (RECENT_FILES_KEY) since it's a UI preference,
        // not file data.
        const recentOpen = getLeftRailRecentOpenPref();
        html += '<details id="shell-recent-files-details" class="shell-details"' + (recentOpen ? " open" : "") + '><summary class="shell-panel-title" style="cursor:pointer">'
          + esc(srT("shell_left_recent_files_title")) + '</summary>'
          + '<div class="shell-recent-files-list">' + recentRows + '</div>'
          + '<div class="shell-recent-files-hint">' + esc(srT("shell_left_recent_files_hint")) + '</div>'
          + '</details>';
        setLeftRail(html);
        const recentDetailsEl = document.getElementById("shell-recent-files-details");
        if(recentDetailsEl){
          recentDetailsEl.addEventListener("toggle", function(){
            setLeftRailRecentOpenPref(recentDetailsEl.open);
          });
        }
        return;
      } else if(step === "setup" || step === "about" || step === "faq"){
        // prompt-v4.19 §2a + v4.20-bugfixes §2a: these three steps get no
        // rail content at all (car-mirror pattern in goStep() collapses/
        // restores the panel itself).
        setLeftRail("");
      } else {
        setLeftRail('<div class="shell-empty-state">' + esc(srT("shell_left_no_file")) + '</div>');
      }
      return;
    }
    const isMulti = !!APP.compareMode;
    const countLabel = isMulti ? srT("shell_left_multi_file") : srT("shell_left_single_file");
    const fileName = isMulti
      ? "(" + (APP.sections ? APP.sections.length : 0) + ")"
      : (APP.homeSingleFile && APP.homeSingleFile.fileName) || "—";
    const fileValue = fileName + " · " + countLabel;
    const orgValue = (APP.setup && APP.setup.instName) || "—";
    const recordCount = (APP.students && APP.students.length) || 0;

    let rows = ""
      + row(srT("shell_left_file_label"), fileValue)
      + row(srT("shell_left_org_label"), orgValue)
      + row(srT("shell_left_records_label"), recordCount);

    if(step === "dashboard"){
      const classLabel = [APP.setup && APP.setup.className, APP.setup && APP.setup.section]
        .filter(Boolean).join(" ");
      if(classLabel) rows += row(srT("shell_left_org_label"), classLabel);
      // v4.22-compare-mode-shell-parity §6: the active section/group name
      // used to be written into a display:none stub (#db-class-label etc,
      // left behind when prompt-v4.20 §1i deleted the header that used to
      // show it) — genuinely invisible to the user. Shown here instead,
      // same file-details row area every other mode already uses.
      if(APP.compareMode){
        const activeLabel = APP._activeCompareSectionId
          ? ((APP.sections||[]).find(function(s){return s.id===APP._activeCompareSectionId;})||{}).label
          : (APP.sectionComparison && APP.sectionComparison.length ? "Comparing " + APP.sectionComparison.length + " section(s)" : null);
        if(activeLabel) rows += row("Viewing", activeLabel);
      }
    }
    // item 6: wrap in a native <details> — collapsed by default, no new
    // JS needed for the expand/collapse itself.
    let html = '<details class="shell-details"><summary class="shell-panel-title" style="cursor:pointer">'
      + esc(srT("shell_left_file_details_title")) + '</summary>' + rows + '</details>';
    // item 7 (ui-prompt-template.md §4.2): Dashboard's left rail also gets
    // the persistent controls list — mode-aware: Individual mode gets its
    // own bucket set (v4.21-individual-mode-shell-parity §1/§2, full
    // parity with Institution's rail-driven pattern, no more falling
    // through to a separate full-screen tile grid), Institution +
    // non-Compare mode keeps its existing bucket set, Compare mode is
    // untouched (handled separately below).
    // Scholarship shares this same block (not just Dashboard) so that
    // screen isn't a dead end — without it, the only way back to My
    // Whole Class/One Student/etc from Scholarship was the browser back
    // button, since Scholarship is its own step, not a dashboard bucket.
    if((step === "dashboard" || step === "scholarship") && !APP.compareMode){
      if(APP.setup && APP.setup.mode === "individual" && typeof buildIndividualDashboardControlsHtml === "function"){
        html += buildIndividualDashboardControlsHtml();
        // UI review fix (Task 5): canned Smart Search questions no longer
        // append here — moved into the center chat panel itself (see
        // buildSmartQueryCannedQuestionsHtml()'s call inside
        // renderDashboardSmartSearch(), js/render-buckets.js), since
        // burying them below the full bucket nav list meant scrolling
        // past ~9 unrelated items to find them.
      } else if(APP.setup && APP.setup.mode !== "individual" && typeof buildDashboardControlsHtml === "function"){
        html += buildDashboardControlsHtml();
      }
    }
    // v4.22-compare-mode-shell-parity §1/§2: section/group list replaces
    // the old inline #compare-section-picker dropdown. Once a single
    // section is active (APP._activeCompareSectionId set — not viewing
    // the "Compare Sections" group view), that section's data has already
    // been swapped into APP.students/APP.setup/APP.cohortClusters by
    // selectCompareSection(), so the exact same buildDashboardControlsHtml()
    // Institution mode uses works here too, unmodified — real parity, not
    // a lookalike copy. Scholarship included for the same reason as above.
    if((step === "dashboard" || step === "scholarship") && APP.compareMode && typeof buildCompareSectionListHtml === "function"){
      html += buildCompareSectionListHtml();
      if(APP._activeCompareSectionId && typeof buildDashboardControlsHtml === "function"){
        html += buildDashboardControlsHtml();
      }
    }
    // §6 resolved open question: Compare Mode keeps its two export cards
    // SEPARATE (not folded into one button) — surfaced as their own small
    // rail section here, below the section/group list and (when active)
    // per-section bucket list added above.
    if((step === "dashboard" || step === "scholarship") && APP.compareMode && typeof buildCompareExportControlsHtml === "function"){
      html += buildCompareExportControlsHtml();
    }
    setLeftRail(html);
  }
  window.renderShellLeftRail = renderShellLeftRail;

  /* ==========================================================
     Task 5 — Right panel: non-Dashboard phases.
     Every action below maps to an existing function — no new business
     logic, per vs-shell-plan-v2.md Task 5. Dashboard's right panel
     (Smart Query v2) is Task 6, not started — this function does
     nothing on step==="dashboard" so Task 6 has an empty rail to fill.

     Deviation from shell-redesign-plan.md §4.2: no "Continue" action
     is wired for the AI panel. That key assumed AI Features was still
     an interactive picker; it was converted to a passive, non-
     interactive progress screen in v3.2 (see index.html ~1456) —
     analysis is always triggered from Home's own Run Analysis button,
     so there is nothing for a Continue button on this panel to do.
     shell_right_continue was therefore not added to i18n; the
     "Selected features" count is still real and useful, so that part
     of Task 5 is done for the AI panel, the button part is not.
     ========================================================== */
  function actionBtn(label, action, arg){
    return '<button type="button" class="btn btn-secondary btn-sm shell-action-btn" data-action="'
      + action + '"' + (arg !== undefined ? ' data-arg="' + String(arg).replace(/"/g,"&quot;") + '"' : '') + '>' + esc(label) + '</button>';
  }

  function renderShellRightRail(step){
    if(typeof srT !== "function" || typeof APP === "undefined"){ return; }
    let html = "";
    if(step === "home"){
      const rows = [1,2,3,4,5,6].map(function(n,i){
        return pitchRow(HOME_RIGHT_ICONS[i], srT("shell_home_right_pitch_" + n));
      }).join("");
      html += '<div class="pitch-rows">' + rows + '</div>';
    }
    // prompt-v4.19 §2a/§2c: Setup renders no right-rail content (step
    // progress + Download Template removed) — the rail collapses via
    // goStep()'s car-mirror setShellRailsOpen(false) call instead.
    else if(step === "ai"){
      const count = (APP.aiFeatures && APP.aiFeatures.size) || 0;
      html += row(srT("shell_right_selected_features"), count);
    }
    // prompt-v4.20 §1xii follow-up: the old step==="export" branch here
    // was dead code — step is never literally "export" anymore (Export
    // is a rail-selected bucket within step "dashboard", not its own
    // step). See renderExportPropertiesRail() below, called directly from
    // openBucket("export")/buildCompareExportControlsHtml() instead.
    // prompt-v4.19 §2a + v4.20-bugfixes §2a: About/FAQ render no right-
    // rail content either — "Try Sample Files"/"Home" used to live here,
    // but both are already reachable from the persistent top-level nav
    // bar (visible on every step, About/FAQ included), so this isn't the
    // only path to either destination.
    // item 7 (ui-prompt-template.md §4.2) superseded Task 6's chat-thread
    // Smart Query rail: for step==="dashboard", the right rail is now
    // built by whichever render-dashboard.js function openBucket() just
    // dispatched to (renderClassAnswer/renderStudentPicker/renderFilteredList/
    // renderClusterGroups/renderComparePicker/renderDashboardSmartSearch —
    // empty for the no-properties controls, search+list for the others) —
    // do nothing here, don't overwrite what they're about to set. The old
    // renderShellDashboardRail()/smartQueryRailAsk() functions below are
    // kept, not deleted, but no longer called from anywhere; see §9.
    if(step === "dashboard") return;
    // Scholarship is a full step (not a dashboard bucket), so — unlike
    // dashboard's openBucket()-driven right rail — it's built directly
    // here, same as renderExportPropertiesRail() below is for the Export
    // bucket.
    if(step === "scholarship"){ renderScholarshipPropertiesRail(); return; }
    setRightRail(html);
  }
  window.renderShellRightRail = renderShellRightRail;

  // Right panel for the Scholarship step: a checkbox roster of every
  // student the eligibility engine ran on (so a teacher can print
  // certificates for just this year's shortlist, or re-print one student
  // who lost theirs — not an all-or-nothing action), an opt-in for also
  // bundling the existing class-wide XLSX (js/scholarship-export.js
  // generateScholarshipReport(), already reachable from this same
  // dashboard's own Download button — this checkbox just offers to
  // include it in the same trip), and the actual download button, wired
  // to downloadScholarshipCertificates() (js/scholarship-audit-detail.js)
  // which reuses the app's existing jsPDF report pipeline (export-pdf.js)
  // for the certificate itself — same branded header/footer bar every
  // other report PDF already uses.
  async function renderScholarshipPropertiesRail(){
    // BUG FIX: was gated on `enabled` alone — same flag a quick-enable
    // with zero-value defaults flips true — so the certificate roster lit
    // up and let a teacher print certificates off a scheme with no real
    // criteria. Gated on isSchemeConfigured() now, same check the main
    // panel uses (scholarship-nav.js), so both surfaces agree on what
    // counts as a real, usable scheme.
    // BUG FIX: neither check above is the feature-lock gate — a scheme
    // configured BEFORE Scholarship got locked (or one left over from a
    // demo) still passed isSchemeConfigured(), so the rail kept showing
    // the live download/certificate section even while the main panel
    // correctly showed the locked upsell (scholarship-nav.js's own
    // isFeatureOn() check). Rail must agree with the main panel: bail
    // out here the same way if the feature itself isn't "on".
    const { isFeatureOn } = await import('../core/feature-registry.js');
    if(!isFeatureOn(APP.features, "scholarship")){ setRightRail(""); return; }
    const { isSchemeConfigured } = await import('../ui/scholarship/scholarship-nav.js');
    const { computeScholarshipData, getScholarshipVisibleIds } = await import('../ui/scholarship/scholarship-dashboard.js');
    const configured = isSchemeConfigured(APP.setup && APP.setup.scholarship);
    if(!configured){ setRightRail(""); return; }
    const data = (typeof computeScholarshipData === "function") ? computeScholarshipData() : null;
    // Roster mirrors the on-screen Shortlist search/status/category
    // filters (js/scholarship-dashboard.js getScholarshipVisibleIds()) —
    // not every student the engine ran on — so what gets checked here
    // matches what's actually visible on screen, and setScholarship*
    // filter setters call renderScholarshipPropertiesRail() again on
    // every filter change to keep the two in sync.
    const visibleIds = (typeof getScholarshipVisibleIds === "function") ? new Set(getScholarshipVisibleIds()) : null;
    const results = ((data && data.engineResults) || []).filter(function(r){ return !visibleIds || visibleIds.has(r.studentId); });
    const studentsById = {};
    (data && data.students || []).forEach(function(s){ studentsById[s.id] = s; });
    let html = '<button type="button" class="btn btn-primary btn-sm" data-action="downloadScholarshipReport" style="width:100%;margin-block-end:12px">' + esc(srT("scholarship_dashboard_download_btn")) + '</button>';
    const rows = results.map(function(r){
      const st = studentsById[r.studentId] || {};
      const eligible = r.dataComplete ? r.eligible : null;
      // Tick for eligible, warning triangle for not-eligible — a plain
      // color dot made the two easy to mis-scan at a glance in a long
      // roster. Data-incomplete (eligible===null) keeps a neutral dot;
      // that state isn't a pass/fail verdict so it gets no icon shape.
      const statusIcon = eligible === true
        ? '<svg class="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1e8a5f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="flex-shrink:0"><path d="M20 6 9 17l-5-5"/></svg>'
        : eligible === false
          ? '<svg class="ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#b5690a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="flex-shrink:0"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
          : '<span style="width:7px;height:7px;border-radius:50%;background:var(--c-text3);flex-shrink:0" aria-hidden="true"></span>';
      return '<label class="bucket-picker-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">'
        + '<input type="checkbox" class="scholarship-cert-cb" data-id="' + esc(r.studentId) + '" checked style="accent-color:var(--c-primary)"> '
        + statusIcon + ' '
        + esc(st.name || r.studentId)
        + '</label>';
    }).join("");
    html += '<details class="shell-details" open><summary class="shell-panel-title" style="cursor:pointer">'+esc(srT("shell_scholarship_students_label"))+'</summary>'
      + '<div style="display:flex;gap:8px;margin-block-end:8px">'
      + '<button type="button" class="btn btn-secondary btn-sm" data-action="selectAllScholarshipCertStudents">'+esc(srT("btn_select_all"))+'</button>'
      + '<button type="button" class="btn btn-secondary btn-sm" data-action="unselectAllScholarshipCertStudents">'+esc(srT("btn_unselect_all"))+'</button>'
      + '</div>'
      + '<div class="bucket-picker-list" style="max-height:220px">' + (rows || emptyStateHtml(srT("val_no_students"))) + '</div>'
      + '</details>';
    html += '<details class="shell-details" open><summary class="shell-panel-title" style="cursor:pointer">'+esc(srT("shell_scholarship_common_reports_label"))+'</summary>'
      + '<label class="bucket-picker-row" style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">'
      + '<input type="checkbox" id="scholarship-cert-include-common" style="accent-color:var(--c-primary);margin-top:2px">'
      + '<span style="font-size:12px;color:var(--c-text2)">'+esc(srT("shell_scholarship_common_reports_desc"))+'</span>'
      + '</label>'
      + '</details>';
    html += '<button type="button" class="btn btn-success btn-glow shell-action-btn shell-action-btn-sticky" data-action="downloadScholarshipCertificates">' + esc(srT("shell_scholarship_download_certificates")) + '</button>';
    setRightRail(html);
  }
  window.renderScholarshipPropertiesRail = renderScholarshipPropertiesRail;

  // prompt-v4.20 §1xii follow-up fix: Export is a rail-selected bucket
  // (like My Whole Class/One Student/etc), not its own step, so its
  // right-rail content is built directly here and called from
  // openBucket("export") — same picker/checkboxes content the old
  // step==="export" branch built, just actually reachable now. The
  // Generate button reuses id="btn-generate-pdfs" so updateExportGate()'s
  // existing enable/disable logic keeps working unchanged, and gets
  // .btn-glow so it reads as the obvious final action.
  function renderExportPropertiesRail(){
    const hasIssues = !!(APP.dataIssues && APP.dataIssues.length);
    let html = row(srT("shell_right_exports_ready"), hasIssues ? "—" : String(APP.students ? APP.students.length : 0));
    if(hasIssues){
      html += '<div class="shell-empty-state">'+esc(srT("val_fix_data_quality_before_export"))+'</div>';
    } else {
      const students = APP.students || [];
      const isIndividual = APP.setup && APP.setup.mode === "individual";
      const studentRows = students.map(function(st){
        return '<label class="bucket-picker-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">'
          + '<input type="checkbox" class="exp-student-cb" data-id="' + esc(st.id) + '" checked style="accent-color:var(--c-primary)"> '
          + esc(st.name) + '</label>';
      }).join("");
      html += '<details class="shell-details" open><summary class="shell-panel-title" style="cursor:pointer">'+esc(srT("shell_students_label"))+'</summary>'
        + '<div style="display:flex;gap:8px;margin-block-end:8px">'
        + '<button type="button" class="btn btn-secondary btn-sm" data-action="selectAllExpStudents">'+esc(srT("btn_select_all"))+'</button>'
        + '<button type="button" class="btn btn-secondary btn-sm" data-action="unselectAllExpStudents">'+esc(srT("btn_unselect_all"))+'</button>'
        + '</div>'
        + '<div class="bucket-picker-list" style="max-height:220px">' + (studentRows || emptyStateHtml(srT("val_no_students"))) + '</div>'
        + '</details>';
      html += '<details class="shell-details" open><summary class="shell-panel-title" style="cursor:pointer">'+esc(srT("shell_report_types"))+'</summary>'
        + (isIndividual ? '' :
            '<label class="bucket-picker-row" style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="exp-teacher" checked style="accent-color:var(--c-primary)"> '+esc(srT("shell_teacher_report"))+'</label>'
          + '<label class="bucket-picker-row" style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="exp-mgmt" checked style="accent-color:var(--c-primary)"> '+esc(srT("shell_management_report"))+'</label>')
        + '<label class="bucket-picker-row" style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="exp-zip" checked style="accent-color:var(--c-primary)"> Bundle as ZIP</label>'
        + '</details>'
        + '<button type="button" class="btn btn-success btn-glow shell-action-btn shell-action-btn-sticky" id="btn-generate-pdfs" data-action="generateAllPDFs">' + esc(srT("shell_right_generate_zip")) + '</button>';
    }
    setRightRail(html);
    if(typeof updateExportGate === "function") updateExportGate();
  }
  window.renderExportPropertiesRail = renderExportPropertiesRail;

  // REMOVED 2026-08-28 (lazy-load pass): the Task 6 "Dashboard phase Smart
  // Query v2 rail" block that used to live here (ensureSmartQueryLoaded
  // local shadow, appendAnswerCard, renderSmartQueryChips,
  // smartQueryRailAnswer, smartQueryRailAsk, smartQueryRailAsk_run,
  // renderShellDashboardRail) was confirmed fully unreachable — its own
  // header comment already said "SUPERSEDED... no longer called from
  // renderShellRightRail()", and a repo-wide grep confirmed
  // renderShellDashboardRail() (the only thing that ever created the
  // #sqv2-rail-thread/#sqv2-rail-input/#sqv2-rail-chips DOM) had zero real
  // callers anywhere — so nothing downstream of it (including
  // inline-actions.js's dispatcher cases and Enter-key handler for it,
  // also removed same pass) could ever fire. This was the actual reason
  // bal/smart-search/smart-query-v2.js's SmartQueryV2 was in this file's
  // static imports at all. See planner.md decisions log for the full
  // trace. Not a functional change — this code never ran.

})();

// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
// vs-shell.js is a self-executing IIFE with no top-level lexical
// declarations, so the automated symbol scan couldn't see its public API —
// it only ever exposed these via window.X assignment. Re-exporting them here
// (the IIFE above has already run by this point, so window.X already holds
// the real function) so other modules can import them properly instead of
// relying on a bare global that no longer exists under module scoping.
export const renderExportPropertiesRail = window.renderExportPropertiesRail;
export const renderShellLeftRail = window.renderShellLeftRail;
export const renderShellRightRail = window.renderShellRightRail;
export const setLeftRail = window.setLeftRail;
export const setRightRail = window.setRightRail;
export const setShellRailOpen = window.setShellRailOpen;
export const setShellRailsOpen = window.setShellRailsOpen;
export const vsShellToggle = window.vsShellToggle;
