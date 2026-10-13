// js/pitch-deck.js
//
// StudIn pitch-deck image viewer — a SEPARATE, on-demand-only sibling to
// js/onboarding-slider.js. Two distinct "demo" experiences now exist by
// design, not by accident:
//
//   1. js/onboarding-slider.js (#si-onboard) — the native, theme-matched,
//      12-language onboarding tour. Auto-shown once per browser on first
//      visit, and replayable via the "Replay intro / demo mode" button in
//      About. This is the DEFAULT first-run experience.
//   2. THIS FILE (#si-deck) — the original 5-slide image pitch deck
//      (NotebookLM-generated slide art, English only, no language picker,
//      no i18n narrative screens — just the images). NEVER auto-shown.
//      Only reachable via the "View pitch deck (slides)" button in About,
//      for visitors/demos who want the richer illustrated deck instead of
//      the native screens.
//
// Deliberately NOT built on top of StudInOnboarding — reusing that state
// machine (language picker, i18n sweep, ONBOARD_STRINGS_EN, 7-screen
// index) for a 5-image-only viewer would drag in far more machinery than
// this needs. A five-function image carousel is simpler standalone.
//
// Images live in img/onboarding/slide-1.jpg .. slide-5.jpg — same files
// as the original demo package, copied in as-is (accepted tradeoff: they
// don't match the app's own visual theme, same as the earlier prompt-era
// decision documented in js/onboarding-slider.js's own history).

const StudInPitchDeck = (function () {
  const TOTAL = 5;
  let idx = 0;

  function el(id) { return document.getElementById(id); }

  function render() {
    const img = el("si-deck-img");
    const counter = el("si-deck-counter");
    if (img) img.src = `img/onboarding/slide-${idx + 1}.jpg`;
    if (counter) counter.textContent = `${idx + 1} / ${TOTAL}`;
    const back = el("si-deck-back");
    const next = el("si-deck-next");
    if (back) back.disabled = idx === 0;
    if (next) next.textContent = idx === TOTAL - 1 ? "Close" : "Next \u2192";
  }

  function next() {
    if (idx === TOTAL - 1) { close(); return; }
    idx++;
    render();
  }
  function back() {
    if (idx === 0) return;
    idx--;
    render();
  }

  let lastActive = null;

  function open() {
    idx = 0;
    const overlay = el("si-deck");
    if (!overlay) return;
    lastActive = document.activeElement;
    overlay.hidden = false;
    render();
    const closeBtn = el("si-deck-close");
    if (closeBtn) closeBtn.focus();
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("keydown", onTrapTab, true);
  }
  function close() {
    const overlay = el("si-deck");
    if (overlay) overlay.hidden = true;
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("keydown", onTrapTab, true);
    if (lastActive && typeof lastActive.focus === "function") lastActive.focus();
    lastActive = null;
  }
  function onKeydown(ev) {
    if (ev.key === "Escape") close();
    else if (ev.key === "ArrowRight") next();
    else if (ev.key === "ArrowLeft") back();
  }
  function onTrapTab(ev) {
    if (ev.key !== "Tab") return;
    const overlay = el("si-deck");
    if (!overlay || overlay.hidden) return;
    const focusables = overlay.querySelectorAll(
      'a[href],button,textarea,input,select,[tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  function markup() {
    return `
      <div class="si-deck-topbar">
        <span class="si-deck-counter" id="si-deck-counter">1 / ${TOTAL}</span>
        <button class="si-deck-close" id="si-deck-close" aria-label="Close">\u2715</button>
      </div>
      <div class="si-deck-stage">
        <img class="si-deck-img" id="si-deck-img" alt="StudIn pitch deck slide" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7">
      </div>
      <div class="si-deck-bottombar">
        <button class="si-btn si-btn-ghost" id="si-deck-back">Back</button>
        <button class="si-btn si-btn-primary" id="si-deck-next">Next \u2192</button>
      </div>`;
  }

  function init() {
    // Trigger button lives in the About panel, outside this overlay's own
    // markup — bound here (not an inline onclick="") so it works under the
    // app's CSP, which has no 'unsafe-inline' for script-src. Same pattern
    // as StudInOnboarding.init()'s #si-replay-btn wiring.
    const deckBtn = el("si-deck-btn");
    if (deckBtn) deckBtn.addEventListener("click", open);

    const overlay = el("si-deck");
    if (!overlay) return; // container not present on this page — no-op
    overlay.innerHTML = markup();

    const backBtn = el("si-deck-back");
    const nextBtn = el("si-deck-next");
    const closeBtn = el("si-deck-close");
    if (backBtn) backBtn.addEventListener("click", back);
    if (nextBtn) nextBtn.addEventListener("click", next);
    if (closeBtn) closeBtn.addEventListener("click", close);
    // No auto-open call here — unlike StudInOnboarding, this viewer is
    // on-demand only, never shown on first load.
  }

  return { init, open, close };
})();

document.addEventListener("DOMContentLoaded", StudInPitchDeck.init);

// --- ES module export + legacy-global mirror, matching the rest of js/* ---
export { StudInPitchDeck };
if (typeof window !== "undefined") { window.StudInPitchDeck = StudInPitchDeck; }
