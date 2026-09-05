// Task 07: Left-panel "Scholarship" nav entry — not-enabled feature-intro
// screen + routing into the enabled state (Task 08's real dashboard, a
// placeholder stub here — see studin-scholarship-discussion.md §28).
//
// renderScholarshipPanel() builds #panel-scholarship content on every
// goStep("scholarship") visit (same re-render-per-visit pattern as
// renderHomePage()/renderBuckets(), so a language switch elsewhere is
// picked up on next visit). The nav-visibility toggle that used to live
// here (updateScholarshipNavVisibility()/fileIsLoaded()) moved to
// core/state-nav.js on 2026-08-28 — it only ever touched APP/DOM, not
// anything else in this file, and importing this whole module from
// state-nav.js just for two trivial lines was the actual reason
// scholarship-nav.js couldn't be lazy-loaded before that pass.
import { esc } from '../../core/app-utils-init.js';
import { srT } from '../../core/render-i18n.js';
import { isFeatureOn } from '../../core/feature-registry.js';
import { buildFeatureLockedHtml } from '../common/feature-locked-modal.js';
import { renderScholarshipDashboard } from './scholarship-dashboard.js';
import { swGoto } from '../../core/setup-wizard.js';
import { APP, goStep } from '../../core/state-nav.js';

// BUG FIX (Sample_02 test): `enabled:true` alone used to be treated as
// "this scheme is real" everywhere (dashboard eligibility calc, certificate
// roster in vs-shell.js). But the quick-enable path above ships with
// zero-value defaults, and a scheme whose criteria are all zero/unset
// isn't actually configured — it just happens not to reject anyone. This
// checks that the chosen eligibilityType is a real one AND at least the
// threshold(s) that type cares about have been given a real value, so
// "enabled but never actually set up" is a distinct, detectable state.
const VALID_ELIGIBILITY_TYPES = ["Merit-only", "Need-only", "Merit-cum-Need", "Category-based", "Custom"];
function isSchemeConfigured(sch){
  if(!sch || !sch.enabled) return false;
  const type = sch.eligibilityType;
  if(!VALID_ELIGIBILITY_TYPES.includes(type)) return false;
  const hasAcademic = sch.minAcademicAvg != null && sch.minAcademicAvg > 0;
  const hasIncome = sch.maxFamilyIncome != null && sch.maxFamilyIncome > 0;
  if(type === "Merit-only") return hasAcademic;
  if(type === "Need-only") return hasIncome;
  if(type === "Merit-cum-Need") return hasAcademic && hasIncome;
  if(type === "Category-based") return true; // gated on student.category, no numeric threshold needed
  // Custom: needs at least one real criterion, or it's indistinguishable
  // from an unconfigured scheme (see eligibility-engine.js needsAcademic/
  // needsIncome comments — Custom only applies a check when its field is set).
  return hasAcademic || hasIncome;
}

function renderScholarshipPanel(){
  const panel = document.getElementById("panel-scholarship");
  if(!panel) return;
  // STEP 5 (05-premium-feature-locking.md): Scholarship is Pro-locked
  // (separate from `sch.enabled` below, which is a per-file data setting
  // for once the feature IS unlocked). Checked first — a locked click
  // used to show a modal from state-nav.js's goStep(); now it renders the
  // same decorated explanation straight into the existing
  // #scholarship-not-enabled empty-state slot instead of a popup.
  const notEnabledElLocked = document.getElementById("scholarship-not-enabled");
  const enabledElLocked = document.getElementById("scholarship-enabled-placeholder");
  if(!isFeatureOn(APP.features, "scholarship")){
    panel.dataset.scholarshipState = "locked";
    if(enabledElLocked) enabledElLocked.style.display = "none";
    if(notEnabledElLocked){
      notEnabledElLocked.style.display = "";
      notEnabledElLocked.innerHTML = buildFeatureLockedHtml("scholarship");
    }
    return;
  }
  const sch = (APP.setup && APP.setup.scholarship) || {};
  const enabled = !!sch.enabled;
  panel.dataset.scholarshipState = enabled ? "enabled" : "not-enabled";

  const notEnabledEl = document.getElementById("scholarship-not-enabled");
  const enabledEl = document.getElementById("scholarship-enabled-placeholder");
  if(!notEnabledEl || !enabledEl) return;

  // BUG FIX (3-scenario spec, scenario 3 regression): this used to gate on
  // isSchemeConfigured(sch) instead of plain `enabled`, so an enabled-but-
  // not-yet-configured scheme (criteria not set in Setup yet) never reached
  // the dashboard at all — including its Edit Data grid — even though
  // filling in student data doesn't require the criteria to exist first.
  // Gating on `enabled` here restores always-reachable Edit Data once the
  // checkbox is on. The original bug-2/3 protection (never show a fake
  // "eligible / meets all criteria" report for an unconfigured scheme)
  // still holds — it now lives on the report tabs themselves (see
  // scholarship-dashboard.js tabsHtml()), which also require the scheme to
  // be configured before unlocking, not just Edit Data being reachable.
  if(enabled){
    notEnabledEl.style.display = "none";
    enabledEl.style.display = "";
    // Task 08: real eligible-students dashboard (stat cards, tabs, table)
    // now built by renderScholarshipDashboard() — re-run on every visit,
    // same re-render-per-visit convention this file already documents at
    // the top, so results reflect the current file/criteria/language.
    renderScholarshipDashboard();
    return;
  }

  enabledEl.style.display = "none";
  notEnabledEl.style.display = "";
  const title = srT("scholarship_navpanel_notenabled_title");
  const desc = srT("scholarship_navpanel_notenabled_desc");
  const btnLabel = srT("scholarship_navpanel_enable_btn");
  const btnAction = "enableScholarshipAndOpenGrid";
  const btnArg = "";
  notEnabledEl.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#icon-66"/></svg>'
    + '<div class="bucket-empty-title">' + esc(title) + '</div>'
    + '<div class="bucket-empty-sub">' + esc(desc) + '</div>'
    + '<button type="button" class="btn btn-primary btn-sm" style="margin-top:14px" data-action="' + btnAction + '"' + btnArg + '>' + esc(btnLabel) + '</button>';
}

// Enable button (already-loaded file path — §38 point 2, kept distinct
// from Task 01's brand-new-template checkbox path in project-setup.js).
//
// BUG FIX (3-scenario spec — major bug): this used to stamp
// APP.setup.scholarship with untouched defaults (eligibilityType
// "Merit-cum-Need", every threshold zeroed) and open the Edit Data grid
// directly — the admin never saw, typed, or confirmed a single real
// criterion, and Setup's own scholarship record stayed empty even though
// the module was now "on". Per the spec, enabling Scholarship for the
// first time on an existing/already-loaded sheet must go through the same
// Scholarship Criteria form (index.html #scholarship-fields, Setup wizard
// Step 3) the brand-new-template path already uses, get validated there
// (validateScholarshipCriteria(), template-upload.js), and only THEN land
// on the grid — see swNext()'s APP._scholarshipPendingFromExisting branch
// in setup-wizard.js, which is what actually persists the form and routes
// here once validation passes.
function enableScholarshipAndOpenGrid(){
  APP.setup=APP.setup||{};
  APP._scholarshipPendingFromExisting=true;
  goStep("setup");
  swGoto(3);
  const cb=document.getElementById("scholarship-enable");
  if(cb){
    cb.checked=true;
    if(typeof window.toggleScholarshipUI==="function") window.toggleScholarshipUI(true);
  }
  const nameField=document.getElementById("scholarship-scheme-name");
  if(nameField) nameField.focus();
}

export { enableScholarshipAndOpenGrid, isSchemeConfigured, renderScholarshipPanel };
