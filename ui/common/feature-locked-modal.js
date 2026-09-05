// ui/common/feature-locked-modal.js
// STEP 5 (05-premium-feature-locking.md): one shared "this is a Pro
// feature, here's what it does and how to unlock it" HTML block, reused
// by all 4 locked features (Compare/Scholarship/SmartSearch/Reports) —
// content driven by LOCKED_FEATURE_COPY below, not 4 hand-written blocks.
//
// CHANGED (post-launch feedback from Sandy): this used to be a modal
// (see git history) — locking a feature behind a popup/toast read as an
// error rather than an upsell. Now it's a plain HTML fragment the caller
// drops into its own main-panel container, styled with the same
// `.bucket-empty-state` classes (bucket-empty-title/bucket-empty-sub,
// css/core.css) the Scholarship "not enabled yet" screen already uses —
// so a locked feature looks like a real, decorated empty state on the
// main screen, not a dead-end dialog. Callers: ui/common/render-buckets.js
// openBucket() (compare/smart/export), core/state-nav.js goStep()
// (scholarship). NB-5 (prompt.md §11.2): the floating launcher's
// openPanel() caller was removed along with smart-query-v2-ui.js.

import { esc } from '../../core/app-utils-init.js';
import { srT } from '../../core/render-i18n.js';

const LOCKED_FEATURE_COPY = {
  compare: { titleKey: "locked_compare_title", descKey: "locked_compare_desc" },
  scholarship: { titleKey: "locked_scholarship_title", descKey: "locked_scholarship_desc" },
  smartSearch: { titleKey: "locked_smartsearch_title", descKey: "locked_smartsearch_desc" },
  reports: { titleKey: "locked_reports_title", descKey: "locked_reports_desc" },
};

// Per Sandy's exact spec: both addresses shown, both as mailto: links.
const CONTACT_EMAILS = ["Sandeep@hakki.in", "sandeephakki@gmail.com"];

export function buildFeatureLockedHtml(featureKey){
  const copy = LOCKED_FEATURE_COPY[featureKey];
  if(!copy){
    console.error("buildFeatureLockedHtml: unknown feature key", featureKey);
    return "";
  }
  const mailLinks = CONTACT_EMAILS
    .map(addr => `<a href="mailto:${esc(addr)}">${esc(addr)}</a>`)
    .join(' &nbsp;|&nbsp; ');
  return `
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#icon-55"/></svg>
    <div class="bucket-empty-title">${esc(srT(copy.titleKey))}</div>
    <div class="bucket-empty-sub">${esc(srT(copy.descKey))}</div>
    <div class="bucket-empty-sub" style="margin-top:10px;font-size:11.5px">${esc(srT("locked_modal_contact_intro"))}<br/>${mailLinks}</div>
  `;
}
