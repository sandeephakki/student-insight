import { FEATURE_REGISTRY } from './feature-registry.js';

// Reads Feature_X rows from the parsed SETUP sheet.
//
// STEP 5 (05-premium-feature-locking.md) introduced three-state
// ("on"/"off"/"locked") flags with missing-row defaulting to "locked".
// REVERTED (Sandy-authorized, see planner.md Index table): every
// feature's defaultState in feature-registry.js is back to "on", so a
// missing row again means "everyone has it", matching pre-Step-5 Free
// behavior. The three-state mechanism itself is untouched — an explicit
// "No" row still produces "off", and the on/off/locked plumbing stays in
// place for future use. A row explicitly present
// still works both directions: "Yes" → "on", anything else present
// (including "No") → "off". See core/feature-registry.js's isFeatureOn()
// and its callers for how "off" and "locked" now differ (RESOLVED
// 2026-08-28 — off hides the nav row/launcher entirely, locked keeps it
// visible with a Pro-upsell modal on click).
//
// setupSheet: APP.rawData["SETUP"] as produced by parseWorkbookSheets()
// in core/template-upload.js — an array of rows, each row an array/object
// whose first two positional values are [label, value] (col A / col B
// of the SETUP sheet). This is NOT an array of {label,value} objects —
// confirmed against the real parse output (see buildSetupKv() in
// template-upload.js, which this mirrors) before writing this function.

export function readFeatureFlags(setupSheet) {
  const kv = {};
  (setupSheet || []).forEach(row => {
    const rawK = Object.values(row)[0], rawV = Object.values(row)[1];
    const k = String(rawK === undefined || rawK === null ? "" : rawK).trim();
    const v = String(rawV === undefined || rawV === null ? "" : rawV).trim();
    if (k && v) kv[k] = v;
  });

  const flags = {};
  let anyMissing = false;
  for (const key in FEATURE_REGISTRY) {
    const { setupKey, defaultState } = FEATURE_REGISTRY[key];
    if (Object.prototype.hasOwnProperty.call(kv, setupKey)) {
      flags[key] = kv[setupKey] === "Yes" ? "on" : "off";
    } else {
      flags[key] = defaultState; // "locked" per step 5 — see file header
      anyMissing = true;
    }
  }
  flags._anyRowMissing = anyMissing; // drives the one-time informational toast
  return flags;
}
