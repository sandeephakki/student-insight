// Master list of togglable features. Each entry maps a feature key
// (matches the SETUP tab row name, minus "Feature_" prefix) to a
// lazy-import function for its entry point(s).
//
// core/ and ui/common/, bal/common/, dal/common/ are NEVER in this
// registry — they are always-on base product, not togglable features.
//
// STEP 5 (05-premium-feature-locking.md): defaultEnabled(true/false) →
// defaultState("on"/"off"/"locked"). Sandy-authorized, deliberate change:
// compare/scholarship/smartSearch flip from defaultEnabled:true to
// defaultState:"locked" (Pro-only, unlock via manual contact), and a new
// "reports" entry is added (PDF export was live/ungated in Free before
// this step, not previously in this registry at all). See planner.md
// Index table + Decisions log for the authorization record.
//
// FINDING (step 2, RESOLVED 2026-08-28 for Scholarship/SmartSearch): true
// lazy-loading (feature code not loaded at all when off/locked) turned out
// to be blocked by the existing module graph, not just unwired —
// core/state-nav.js, core/vs-shell.js, core/render-i18n.js,
// ui/common/render-buckets.js, and ui/common/inline-actions.js (all
// always-loaded) all held static imports of Scholarship's and/or
// SmartSearch's code, plus the standalone floating Smart Search launcher
// had its own separate static import of the same SmartQueryV2 module. All
// converted to dynamic import() at the real trigger points — see
// planner.md's decisions log, 2026-08-28 entry, for the full trace
// including two confirmed-dead code paths removed along the way and two
// real regressions caught and fixed before shipping. Verified by
// repo-wide grep: zero static imports of any Scholarship or SmartSearch
// file remain in any always-loaded file. Compare is NOT resolved — its
// code isn't isolated in its own dedicated file the way Scholarship/
// SmartSearch's was (some of it lives inside ui/common/render-buckets.js
// itself, mixed with real core/common dashboard code), so there's no
// clean seam to convert without the ui/compare/ file-split
// folder-structure.md already left pending — a real architectural
// decision, not a mechanical wiring task.
//
// FINDING (step 5, RESOLVED 2026-08-28): the 05-premium-feature-locking.md
// prompt guessed Reports' PDF-build code (buildStudentPDF/buildTeacherPDF/
// buildMgmtPDF in bal/export/export-pdf.js) was only reachable via
// bal/compare/compute-compare.js's import of it, implying Reports and
// Compare might share a single code-level gate. That undercounted it —
// export-pdf.js was statically imported from 4 places, not 1 (one of
// which, core/vs-shell.js's, turned out to be entirely dead code and was
// just deleted). The other 3 (compute-compare.js, ui/common/inline-actions.js,
// ui/scholarship/scholarship-audit-detail.js) were converted to dynamic
// import() at their real trigger points. Verified: zero static imports of
// export-pdf.js remain anywhere in the repo. See planner.md's decisions
// log for the full trace.
//
// This file and read-feature-flags.js are still real and usable today
// for anything that only needs to know a feature's on/off/locked state
// (e.g. showing the locked modal instead of the real feature, which
// ui/common/render-buckets.js's openBucket() and core/state-nav.js's
// goStep() do —
// see isFeatureOn() below) — that was always true and remains true;
// what changed 2026-08-28 is that Scholarship/Reports' code
// now also genuinely doesn't download until one of those real trigger
// points fires. Compare's code still downloads regardless of its lock
// state, same as always.

export const FEATURE_REGISTRY = {
  scholarship: {
    setupKey: "Feature_Scholarship",
    defaultState: "on", // REVERTED (Sandy-authorized): back to on-by-default —
                              // see planner.md Index table for this change.
    // Genuinely lazy as of 2026-08-28 — core's static imports of
    // scholarship-nav.js/scholarship-dashboard.js/scholarship-audit-detail.js/
    // scholarship-edit-grid.js were removed from every always-loaded file.
    loadUI: () => import('../ui/scholarship/scholarship-nav.js'),
  },
  compare: {
    setupKey: "Feature_Compare",
    defaultState: "on",
    // TBD: compute-compare.js is still a single mixed UI+BAL file living
    // in bal/compare/ (see planner.md decisions log) — folder-structure.md
    // left ui/compare/ empty pending that split. No clean UI-only entry
    // point exists yet to lazy-load, so this feature is registered but
    // NOT wired for lazy-loading until that split happens.
    loadUI: null,
  },
  smartSearch: {
    setupKey: "Feature_SmartSearch",
    defaultState: "on",
    // NB-5 (prompt.md §11.2): smart-engine-ui.js deleted along with the
    // smart-search-screen DOM stub — Smart Search is fully replaced by the
    // Dashboard right-rail wiring (see PIB §6d). loadUI stays null here to
    // match the `reports` pattern: no single UI screen to lazy-load.
    loadUI: null,
  },
  reports: {
    // NEW (step 5) — Reports/PDF export was not in the registry at all
    // before this step (it wasn't gated, it just worked). Confirmed entry
    // points: buildStudentPDF/buildTeacherPDF/buildMgmtPDF/generateAllPDFs
    // in bal/export/export-pdf.js. Import-level entanglement RESOLVED
    // 2026-08-28 (see FINDING above) — export-pdf.js is now only reached
    // via dynamic import() at its 3 real trigger points across
    // compute-compare.js/inline-actions.js/scholarship-audit-detail.js,
    // not from one single UI entry point the way scholarship/smartSearch
    // have, so loadUI stays null here deliberately (there's no single
    // screen to lazy-load — Reports doesn't have its own dashboard panel,
    // it's 3 separate export buttons scattered across other features'
    // screens) rather than because it's still blocked.
    setupKey: "Feature_Reports",
    defaultState: "on",
    loadUI: null,
  },
};

// Three-state check used by every UI-layer lock gate (openBucket(),
// goStep()) — kept here, next to the
// registry it reads state shape from, rather than duplicated at each call
// site. Pure function, no APP/DOM dependency, so this file stays safely
// importable from core, ui, and (if ever needed) bal without creating a
// layer violation — it takes the already-computed flags object (APP.features)
// as a parameter instead of reaching for global state itself.
//
// "off" and "locked" both still block the feature and both still use
// isFeatureOn() (false for either) at every click-time gate below —
// that part is unchanged and correct: whether a feature is reachable at
// all is a separate question from whether its nav row is visible.
// RESOLVED 2026-08-28 (was previously flagged as an open question for
// Sandy — see planner.md decisions log): "off" now hides the row/button
// entirely (feature doesn't exist for that institution); "locked" keeps
// it visible and shows the Pro-upsell modal on click. See
// ui/common/render-buckets.js's buildDashboardControlsHtml() (rail rows)
// for where that distinction is actually made —
// isFeatureOn() itself intentionally stays a simple on/not-on check.
export function isFeatureOn(flags, key) {
  return !!(flags && flags[key] === "on");
}

// Scholarship is India-specific (categories/quotas modeled on Indian
// reservation policy — see i18n/TRANSLATION_REFERENCE.md's Architecture
// notes section) and isn't a fit for other countries' school systems.
// Rather than translate/build it out for a global audience, it's gated
// off entirely outside India — same "off" state every existing check
// site (render-buckets.js's dashboard row, scholarship-nav.js,
// vs-shell.js's right rail) already treats as "hide this completely",
// so this reuses that exact behavior instead of adding new UI-hiding
// logic anywhere. Pure function, no APP/DOM dependency, matching
// isFeatureOn()'s own invariant above — callers apply this to derive
// the *effective* features object from the raw Excel-parsed one, they
// don't mutate the raw one, so switching the country dropdown back to
// India can always recover the original Feature_Scholarship setting
// without needing to re-parse the file.
export function applyCountryScholarshipGate(features, countryCode) {
  if (features && countryCode && countryCode !== "IN") {
    return { ...features, scholarship: "off" };
  }
  return features;
}
