// core/video-modal.js
//
// StudIn marketing video modal — first-visit popup showing YouTube reels/
// demo videos, plus the tile renderer shared with the Home "Properties"
// rail (see core/vs-shell.js renderShellRightRail's "home" branch).
//
// Same two-trigger shape as core/onboarding-slider.js:
//   1. Auto-shown once per browser on first load, gated by localStorage.
//   2. Manually reopened — here, by clicking any video tile in the
//      Properties rail (core/vs-shell.js), which calls openVideo(id) to
//      open this same modal already playing that video.
//
// PIB EXCEPTION — localStorage (see core/onboarding-slider.js's own
// header comment for the full rationale; same kind of exception, same
// narrow scope):
//   si-videos-seen   "1" once the visitor has closed/seen the video
//                     modal — governs the auto-open trigger only. Pure
//                     UI state, never student data.
//
// VIDEO LIST — data/videos.json, a plain manual array of {id, title}
// (id = YouTube video ID only, not the full URL). No YouTube Data API
// key, no live playlist fetch: add a video, push the file, done. This
// also means thumbnails (img.youtube.com) and playback (youtube-nocookie
// embed) are the only outbound calls this feature makes — matches
// StudIn's "nothing extra in the middle" framing better than a live API
// dependency would.

const StudInVideos = (function () {
  const LS_SEEN = "si-videos-seen";
  let VIDEOS = null; // null = not yet loaded
  let lastActive = null;

  // AUTO-SYNCED from data/videos.json — same reason core/render-i18n.js
  // keeps SR_STRINGS_EN inline: file:// (About §2's "a local HTML file",
  // a first-class supported way to run StudIn) blocks fetch() of sibling
  // files in most browsers, so fetch("data/videos.json") fails silently
  // and the rail/modal would otherwise render empty with no console
  // error. This is the fallback used whenever that fetch fails or 404s.
  // Keep this array in sync with data/videos.json by hand on every edit
  // — there's no build step here to auto-generate it.
  const FALLBACK_VIDEOS = [
    { "id": "aWVd2lA915g", "title": "StudIn — Intro" }
  ];

  function el(id) { return document.getElementById(id); }
  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) { /* ignore, see PIB EXCEPTION note above */ }
  }

  function loadVideos() {
    if (VIDEOS) return Promise.resolve(VIDEOS);
    return fetch("data/videos.json")
      .then(function (r) { return r.ok ? r.json() : FALLBACK_VIDEOS; })
      .catch(function () { return FALLBACK_VIDEOS; })
      .then(function (list) { VIDEOS = Array.isArray(list) && list.length ? list : FALLBACK_VIDEOS; return VIDEOS; });
  }
  function getVideos() { return VIDEOS; }

  // Shared tile markup — mode "strip" (modal filmstrip, click loads the
  // video into the big stage above it) or "rail" (Properties panel,
  // click opens this modal instead — the rail column is too narrow for
  // a good player). data-action/data-arg routes through
  // ui/common/inline-actions.js's single delegated listener, same as
  // every other clickable element in this app.
  function tileHtml(v, mode) {
    const action = mode === "rail" ? "openVideoModal" : "selectStageVideo";
    return '<div class="video-tile video-tile-' + mode + '" data-video-id="' + esc(v.id) + '">'
      + '<button type="button" class="video-tile-play" data-action="' + action + '" data-arg="' + esc(v.id) + '" aria-label="' + esc(v.title || "Play video") + '">'
      +   '<img class="video-tile-thumb" src="https://img.youtube.com/vi/' + esc(v.id) + '/mqdefault.jpg" alt="" loading="lazy">'
      +   '<span class="video-tile-play-icon" aria-hidden="true">\u25B6</span>'
      + '</button>'
      + '<span class="video-tile-title">' + esc(v.title || "") + '</span>'
      + '</div>';
  }

  function findVideo(id) {
    return (VIDEOS || []).find(function (v) { return v.id === id; }) || { id: id, title: "" };
  }

  // Loads a video into the big stage (the "center big space" ask) and
  // marks the matching filmstrip tile as active. This is the ONLY thing
  // a filmstrip-tile click does now — it no longer rewrites the tile
  // itself, so the strip stays a stable, clickable row of thumbnails.
  function selectStageVideo(id) {
    const stage = el("si-videos-stage");
    if (stage) {
      const v = findVideo(id);
      stage.innerHTML = '<div class="si-videos-stage-frame">'
        + '<iframe src="https://www.youtube-nocookie.com/embed/' + esc(id) + '?autoplay=1&rel=0" '
        +   'title="' + esc(v.title || "video") + '" '
        +   'frameborder="0" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>'
        + '</div>'
        + '<div class="si-videos-stage-meta">'
        +   '<span class="si-videos-stage-title">' + esc(v.title || "") + '</span>'
        +   '<a class="si-videos-stage-yt-link" href="https://www.youtube.com/watch?v=' + esc(id) + '" target="_blank" rel="noopener">Watch on YouTube \u2197</a>'
        + '</div>';
    }
    const strip = el("si-videos-strip");
    if (strip) {
      strip.querySelectorAll(".video-tile").forEach(function (t) {
        t.classList.toggle("is-active", t.getAttribute("data-video-id") === id);
      });
    }
  }

  function renderStrip() {
    const strip = el("si-videos-strip");
    if (!strip) return;
    strip.innerHTML = (VIDEOS || []).map(function (v) { return tileHtml(v, "strip"); }).join("");
  }

  function open(focusId) {
    const overlay = el("si-videos");
    if (!overlay) return;
    loadVideos().then(function () {
      renderStrip();
      lastActive = document.activeElement;
      overlay.hidden = false;
      lsSet(LS_SEEN, "1");
      const closeBtn = el("si-videos-close");
      if (closeBtn) closeBtn.focus();
      document.addEventListener("keydown", onKeydown);
      document.addEventListener("keydown", onTrapTab, true);
      // Only feature a video in the big stage when opened for a specific
      // one (Properties rail tile click) — otherwise the stage opens on
      // its "pick a video below" placeholder, per the ask that a tile
      // click is what earns the big center space, not the modal opening.
      if (focusId) selectStageVideo(focusId);
    });
  }
  function close() {
    const overlay = el("si-videos");
    if (overlay) overlay.hidden = true;
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("keydown", onTrapTab, true);
    if (lastActive && typeof lastActive.focus === "function") lastActive.focus();
    lastActive = null;
  }
  function onKeydown(ev) { if (ev.key === "Escape") close(); }
  function onTrapTab(ev) {
    if (ev.key !== "Tab") return;
    const overlay = el("si-videos");
    if (!overlay || overlay.hidden) return;
    const focusables = overlay.querySelectorAll('a[href],button,[tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  // Opens the modal with one specific video already playing — used by
  // the Properties rail tiles (core/vs-shell.js).
  function openVideo(id) { open(id); }

  function markup() {
    return '<div class="si-videos-panel">'
      +   '<div class="si-videos-topbar">'
      +     '<span class="si-videos-title" id="si-videos-title">Watch StudIn in action</span>'
      +     '<button class="si-videos-close" id="si-videos-close" aria-label="Close">\u2715</button>'
      +   '</div>'
      +   '<div class="si-videos-stage" id="si-videos-stage"><div class="si-videos-stage-empty">Pick a video below to play it here</div></div>'
      +   '<div class="si-videos-strip" id="si-videos-strip"></div>'
      + '</div>';
  }

  function init() {
    const overlay = el("si-videos");
    if (!overlay) return; // container not present on this page — no-op
    overlay.innerHTML = markup();

    // Backdrop + close button only — filmstrip tile clicks (data-action=
    // "selectStageVideo") are dispatched by ui/common/inline-actions.js's
    // delegated listener, which calls selectStageVideo() above directly.
    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay) { close(); return; }
      const closeBtn = ev.target.closest("#si-videos-close");
      if (closeBtn) { close(); return; }
    });

    loadVideos().then(function () {
      if (lsGet(LS_SEEN) !== "1") open();
      // Safety-net re-render — same fix class as vs-shell.js's own
      // initShell() comment ("boot call happens from an earlier <script>
      // tag..."), just the other direction: THIS file's <script> tag is
      // the later one. If goStep("home")'s boot render already hit the
      // Home rail's video branch before this module had run,
      // window.StudInVideos didn't exist yet, so that branch's own guard
      // silently produced no tiles and nothing was left to retry. Now
      // that this file is loaded, re-render once if still on Home —
      // harmless no-op if the rail already has tiles.
      if (window.APP && window.APP.currentStep === "home" && typeof window.renderShellRightRail === "function") {
        window.renderShellRightRail("home");
      }
    });
  }

  return { init: init, open: open, openVideo: openVideo, close: close, loadVideos: loadVideos, getVideos: getVideos, tileHtml: tileHtml, selectStageVideo: selectStageVideo };
})();

document.addEventListener("DOMContentLoaded", StudInVideos.init);

// --- ES module export + legacy-global mirror, matching the rest of js/* ---
export { StudInVideos };
if (typeof window !== "undefined") { window.StudInVideos = StudInVideos; }
