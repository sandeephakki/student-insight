// Task 12: App-Wide Debug Log System.
//
// Schema is §35's JSON shape (session_id + entries[], DATA_ERROR/CODE_ERROR)
// — this supersedes the earlier .txt/TECH_ERROR design from §14-§18
// entirely (per this task's Context note: "this JSON schema below wins").
// What DOES still stand from §14-§18, since §35 doesn't reopen it: the
// 500-entry cap with oldest-first rotation, no manual clear button, no
// auto-clear on export, and reusing the existing toast(msg, type) utility
// (js/app-utils-init.js) rather than building a new one.
//
// Not scholarship-specific — this file has no dependency on any
// scholarship-* module. js/scholarship-completeness-grid.js already calls
// window.logDebugEntry(entry) with a fully-shaped DATA_ERROR object (see
// that file) — this module just needs to make that name real.
import { esc, toast } from './app-utils-init.js';
import { srT } from './render-i18n.js';
import { APP } from './state-nav.js';

const STORAGE_KEY = "studin_debug_log";
const CAP = 500;

function pad2(n) {
  return String(n).padStart(2, "0");
}

// One session_id per page load (format matches §35's own example:
// "sess_2026-08-25_14-02"). §35 says "the log does not outlive the tab" —
// reconciling that with §14's original reason for mirroring to
// localStorage in the first place (surviving the app going
// frozen/unresponsive mid-session, so an in-memory-only log isn't lost
// before the user gets a chance to export) is done below: entries ARE
// mirrored to localStorage as they're written, so they survive a crash
// that leaves the tab open, but on every fresh module load (a real
// reload/new tab) any stored entries tagged with a *different* session_id
// are discarded rather than carried forward — so the log still behaves as
// session-only from the user's perspective, it just isn't purely
// in-memory during the session it belongs to.
const SESSION_ID = "sess_" + (function () {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "_" + pad2(d.getHours()) + "-" + pad2(d.getMinutes());
})();

let _entries = [];
(function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.session_id === SESSION_ID && Array.isArray(parsed.entries)) {
      _entries = parsed.entries;
    }
    // Different (or missing) session_id → belongs to a previous tab/session;
    // leave _entries empty, per §35's session scoping.
  } catch (e) {
    // Corrupt/inaccessible localStorage (private browsing, quota, bad JSON)
    // — degrade to an empty in-memory log rather than throwing on load.
    _entries = [];
  }
})();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ session_id: SESSION_ID, entries: _entries }));
  } catch (e) {
    // localStorage full/unavailable — the log still works for the rest of
    // this page load (in-memory + still exportable), it just won't
    // survive a crash. Never let a logging failure become a thrown error.
  }
}

// CODE_ERROR's input_context must never carry student-identifying data
// (§35: "never student names/marks/PII") — enforced here, in the one
// place every CODE_ERROR entry passes through, rather than trusted to
// every call site. Deliberately broad/conservative: any key that even
// looks like it could hold personal data is dropped, not just exact
// known-bad names.
const PII_KEY_PATTERN = /name|student|income|category|marks?|score|grade|email|phone|address|remark|reason/i;
function sanitizeInputContext(obj) {
  if (obj == null || typeof obj !== "object") return {};
  const out = {};
  Object.keys(obj).forEach(k => {
    if (PII_KEY_PATTERN.test(k)) {
      console.warn("[debug-log] dropped potentially-identifying key from input_context:", k);
      return;
    }
    const v = obj[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? sanitizeInputContext(v) : v;
  });
  return out;
}

const DATA_ERROR_KEYS = ["timestamp", "type", "module", "action", "student_id", "field", "value_found", "message"];
const CODE_ERROR_KEYS = ["timestamp", "type", "module", "action", "error_name", "error_message", "stack_trace", "input_context"];

// Central logging function — every DATA_ERROR and CODE_ERROR entry in the
// app goes through this one function (§ Task 12 §1: one function + a
// `type` field, chosen over two parallel functions, so there's exactly
// one place that owns capping/persistence/toast/PII-stripping). Accepts
// an already-shaped entry object — js/scholarship-completeness-grid.js's
// existing logDataError() stub already builds and calls
// window.logDebugEntry(entry) this way, so it needed zero changes once
// this file exists.
function logDebugEntry(rawEntry) {
  try {
    if (!rawEntry || (rawEntry.type !== "DATA_ERROR" && rawEntry.type !== "CODE_ERROR")) return null;
    const allowedKeys = rawEntry.type === "DATA_ERROR" ? DATA_ERROR_KEYS : CODE_ERROR_KEYS;
    const entry = { timestamp: rawEntry.timestamp || new Date().toISOString() };
    allowedKeys.forEach(k => {
      if (k === "timestamp") return;
      if (rawEntry[k] !== undefined) entry[k] = rawEntry[k];
    });
    if (entry.type === "CODE_ERROR") {
      entry.input_context = sanitizeInputContext(entry.input_context);
    }

    _entries.push(entry);
    if (_entries.length > CAP) {
      _entries = _entries.slice(_entries.length - CAP); // drop oldest first, keep newest 500
    }
    persist();

    if (entry.type === "DATA_ERROR") {
      toast(srT("scholarship_log_data_error_toast", { message: esc(entry.message || "") }), "warn");
    } else {
      toast(srT("scholarship_log_code_error_toast"), "error");
    }
    return entry;
  } catch (e) {
    // A logging bug must never crash the app it's trying to help debug.
    console.error("[debug-log] logDebugEntry failed:", e);
    return null;
  }
}

// "func (file:line) -> func (file:line)" chain, matching §35's example —
// best-effort parse of Error.stack (format isn't fully standardized
// across browsers), never throws on an unexpected shape.
function formatStackTrace(err) {
  if (!err || !err.stack) return "";
  try {
    return String(err.stack)
      .split("\n")
      .slice(1)
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        const withFn = l.match(/^at\s+(.*?)\s+\((.*?):(\d+):\d+\)$/);
        if (withFn) return withFn[1] + " (" + withFn[2].split("/").pop() + ":" + withFn[3] + ")";
        const bare = l.match(/^at\s+(.*):(\d+):\d+$/);
        if (bare) return bare[1].split("/").pop() + ":" + bare[2];
        return l.replace(/^at\s+/, "");
      })
      .join(" -> ");
  } catch (e) {
    return "";
  }
}

// Convenience wrapper for the CODE_ERROR shape — used by the global
// catch-all hooks and safeRun() below, and available for any future call
// site that needs to log a caught technical error directly.
function logCodeError(module, action, err, inputContext) {
  return logDebugEntry({
    type: "CODE_ERROR",
    module,
    action,
    error_name: (err && err.name) || "Error",
    error_message: (err && err.message) || String(err),
    stack_trace: formatStackTrace(err),
    input_context: inputContext || {}
  });
}

// Convenience wrapper for the DATA_ERROR shape, for call sites building
// one directly rather than throwing an isDataError-tagged error through
// safeRun().
function logDataErrorEntry(module, action, studentId, field, valueFound, message) {
  return logDebugEntry({
    type: "DATA_ERROR",
    module,
    action,
    student_id: studentId,
    field,
    value_found: valueFound == null ? "" : valueFound,
    message
  });
}

// Wraps a risk-point function (import / calculation / export) and
// classifies whatever it throws: code that detects bad *data* throws with
// `err.isDataError = true` (plus studentId/field/valueFound on the error
// object) → DATA_ERROR; anything else → CODE_ERROR with stack + context.
// Always re-throws after logging — logging is a side channel, never a
// substitute for the caller's own error handling.
function safeRun(module, action, fn, getInputContext) {
  try {
    return fn();
  } catch (err) {
    if (err && err.isDataError) {
      logDataErrorEntry(module, action, err.studentId, err.field, err.valueFound, err.message);
    } else {
      let ctx;
      try {
        ctx = typeof getInputContext === "function" ? getInputContext() : undefined;
      } catch (e) {
        ctx = undefined;
      }
      logCodeError(module, action, err, ctx);
    }
    throw err;
  }
}

// Global catch-all for anything not explicitly wrapped by safeRun().
// Uses addEventListener (not `window.onerror =`) specifically so this
// coexists with the existing global handler in js/app-utils-init.js
// (_reportGlobalError, wired the same way) rather than overwriting it —
// both fire independently on the same event.
window.addEventListener("error", function (e) {
  const err = e.error instanceof Error ? e.error : new Error(String(e.message || "Unknown error"));
  logCodeError("uncaught", "window-error", err, { step: (typeof APP !== "undefined" && APP.currentStep) || null });
});
window.addEventListener("unhandledrejection", function (e) {
  const err = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
  logCodeError("uncaught", "unhandled-promise-rejection", err, { step: (typeof APP !== "undefined" && APP.currentStep) || null });
});

// Export — read-only, non-destructive (§16/§35's "download never clears
// the log" policy still stands). Reuses the app's existing Blob + anchor
// `.click()` download technique (same pattern as js/export-pdf.js's local
// downloadBlob()) rather than a new download mechanism.
function downloadDebugLog() {
  const payload = { session_id: SESSION_ID, entries: _entries };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "studin_debug_log_" + SESSION_ID + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getDebugLogEntries() {
  return _entries.slice();
}

export { downloadDebugLog, getDebugLogEntries, logCodeError, logDataErrorEntry, logDebugEntry, safeRun, SESSION_ID };

if (typeof window !== "undefined") {
  window.logDebugEntry = logDebugEntry;
  window.logCodeError = logCodeError;
  window.logDataErrorEntry = logDataErrorEntry;
  window.safeRun = safeRun;
  window.downloadDebugLog = downloadDebugLog;
  window.getDebugLogEntries = getDebugLogEntries;
}
