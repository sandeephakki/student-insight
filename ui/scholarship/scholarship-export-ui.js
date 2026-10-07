import { esc, toast } from '../../core/dom-helpers.js';
import { srT } from '../../core/render-i18n.js';
import { exportScholarshipReport } from '../../bal/scholarship/scholarship-export.js';

// UI wrapper around the BAL export: owns the toasts (BAL must not touch the DOM).
function generateScholarshipReport(data, categoryFilter) {
  const r = exportScholarshipReport(data, categoryFilter);
  if (r.ok) toast(srT("scholarship_export_toast_success", { fname: esc(r.fname) }), "success");
  else if (r.reason === "no_data") toast(srT("val_no_data_loaded") || "No data loaded.", "warn");
}

export { generateScholarshipReport };
