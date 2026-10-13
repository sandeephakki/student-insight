// Single module entry point. Statically imports every app module in the same
// order the old per-file <script type="module"> tags used, so the whole graph
// evaluates in ONE pass: all ports (core/ports.js) are provided before any
// microtask/DOMContentLoaded init runs. The module graph itself is acyclic
// (scripts/check-import-cycles.py).
import './env-config.js';
import './state-nav.js';
import './project-setup.js';
import './template-upload.js';
import '../bal/common/compute-stats.js';
import '../bal/compare/compute-compare.js';
import '../ui/compare/compare-ui.js';
import '../bal/common/compute-continuity.js';
import './render-i18n.js';
import '../ui/common/render-buckets.js';
import '../ui/common/render-findings.js';
import '../ui/common/render-core.js';
import '../ui/common/continuity-dashboard.js';
import '../bal/export/export-pdf.js';
import '../ui/export/export-ui.js';
import './app-utils-init.js';
import '../bal/smart-search/smart-engine.js';
import './setup-wizard.js';
import './vs-shell.js';
import '../ui/common/inline-actions.js';
import './onboarding-slider.js';
import '../ui/common/pitch-deck.js';
import './video-modal.js';
import '../ui/common/studinpro-ticker.js';
