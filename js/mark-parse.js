/* ════════════════════════════════════════════════════════════════════
   MARK-PARSE — one shared strict-numeric-parsing module for every place
   that reads a number out of an imported/typed cell: test marks, absence
   counts, and configured maximum marks.

   Why this exists (EXCEL_DATA_MATH_AUDIT_PROMPT.md items 2/3/4): the old
   pattern `parseFloat(String(raw).replace(/[^0-9.-]/g,""))` strips
   characters BEFORE parsing, so malformed input gets silently
   reinterpreted instead of rejected — "50.5.5" -> 50.5, "1-2" -> 1,
   "1e2" -> 12 (the "e" is stripped, not read as exponent notation),
   "10/20" -> 1020. A displayed result must never be based on a
   reinterpretation of input text, so every parser here returns a
   structured status instead of ever falling back to a guessed number.

   All three parsers share the same shape:
     { status: "valid" | "blank" | "invalid", value: number|null, reason: string|null }
   - "valid"   -> value is the parsed number, reason is null.
   - "blank"   -> the cell was genuinely empty; value is null.
   - "invalid" -> value is null; reason is a short human-readable string
                  the caller can put straight into a data-issue message.
   Callers must never use `value` unless status === "valid".
   ════════════════════════════════════════════════════════════════════ */

// Plain, unambiguous decimal number: optional leading "-", digits,
// optional ".digits". Deliberately excludes scientific notation ("1e2"),
// slashes ("10/20"), multiple dashes/dots, and anything else that isn't
// a single plain decimal literal.
const PLAIN_NUMBER_RE = /^-?\d+(\.\d+)?$/;
// Thousands-grouped form, e.g. "1,234" or "12,345.5" — only recognized
// when the grouping is unambiguous (groups of exactly 3 digits after the
// first, standard convention), otherwise left alone so unusual reuse of
// "," never gets silently reinterpreted.
const GROUPED_NUMBER_RE = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;

function stripGrouping(s) {
  return GROUPED_NUMBER_RE.test(s) ? s.replace(/,/g, "") : s;
}

// Shared entry point: normalizes raw -> {kind:"blank"} | {kind:"formula"} |
// {kind:"number", text} | {kind:"malformed", text}. Every parser below
// builds on this so "blank"/"formula" handling never drifts between them.
function classifyRaw(raw) {
  if (raw === null || raw === undefined) return { kind: "blank" };
  if (typeof raw === "number") {
    return { kind: "number", text: null, n: raw };
  }
  const s = String(raw).trim();
  if (s === "") return { kind: "blank" };
  if (s.startsWith("=")) return { kind: "formula", text: s };
  return { kind: "text", text: stripGrouping(s) };
}

/**
 * Strict parser for a test mark. Accepts native finite numbers and
 * trimmed decimal strings that match the plain-number format exactly
 * (optionally with unambiguous thousands grouping). Everything else —
 * fraction-like, repeated-decimal, mixed-expression, exponent, or
 * non-finite input — is reported invalid rather than reinterpreted.
 * Negative numbers parse as "valid" here (this function only judges
 * numeric well-formedness); callers that must reject negative marks do
 * that as a separate, explicit business-rule check downstream.
 */
function parseStrictMark(raw) {
  const c = classifyRaw(raw);
  if (c.kind === "blank") return { status: "blank", value: null, reason: null };
  if (c.kind === "formula") return { status: "invalid", value: null, reason: "starts with \"=\" — formulas/untrusted input aren't accepted as marks" };
  if (c.kind === "number") {
    if (!Number.isFinite(c.n)) return { status: "invalid", value: null, reason: "not a finite number" };
    return { status: "valid", value: c.n, reason: null };
  }
  if (!PLAIN_NUMBER_RE.test(c.text)) return { status: "invalid", value: null, reason: "not a valid number format" };
  const n = Number(c.text);
  if (!Number.isFinite(n)) return { status: "invalid", value: null, reason: "not a finite number" };
  return { status: "valid", value: n, reason: null };
}

/**
 * Strict parser for an "Absent Days" cell: whole, non-negative integers
 * only. Decimal, negative, and malformed text are all invalid — none of
 * them are silently coerced to 0. A genuinely blank cell is reported
 * "blank" so the caller can apply its own default-to-zero rule.
 */
function parseStrictAbsence(raw) {
  const c = classifyRaw(raw);
  if (c.kind === "blank") return { status: "blank", value: null, reason: null };
  if (c.kind === "formula") return { status: "invalid", value: null, reason: "starts with \"=\" — formulas/untrusted input aren't accepted" };
  if (c.kind === "number") {
    if (!Number.isInteger(c.n) || c.n < 0) return { status: "invalid", value: null, reason: "must be a whole number of 0 or more" };
    return { status: "valid", value: c.n, reason: null };
  }
  if (!/^\d+$/.test(c.text)) return { status: "invalid", value: null, reason: "must be a whole number of 0 or more" };
  return { status: "valid", value: Number(c.text), reason: null };
}

/**
 * Strict parser for a configured maximum mark (SETUP sheet, manual setup
 * form, continuity periods, compare-mode schema peek). Must be a finite
 * positive integer — 0, negative numbers, decimals, and non-numeric text
 * are all invalid, never silently substituted with 100. A genuinely
 * absent/blank field is reported "blank" so callers can apply the
 * documented legacy fallback (100) ONLY for that case, never for a
 * value that was supplied but invalid.
 */
function parseStrictMaxMark(raw) {
  const c = classifyRaw(raw);
  if (c.kind === "blank") return { status: "blank", value: null, reason: null };
  if (c.kind === "formula") return { status: "invalid", value: null, reason: "starts with \"=\" — formulas/untrusted input aren't accepted" };
  if (c.kind === "number") {
    if (!Number.isInteger(c.n) || c.n <= 0) return { status: "invalid", value: null, reason: "maximum mark must be a positive whole number" };
    return { status: "valid", value: c.n, reason: null };
  }
  if (!/^\d+$/.test(c.text)) return { status: "invalid", value: null, reason: "maximum mark must be a positive whole number" };
  const n = Number(c.text);
  if (n <= 0) return { status: "invalid", value: null, reason: "maximum mark must be a positive whole number" };
  return { status: "valid", value: n, reason: null };
}

export { parseStrictMark, parseStrictAbsence, parseStrictMaxMark };
if (typeof window !== "undefined") {
  window.parseStrictMark = parseStrictMark;
  window.parseStrictAbsence = parseStrictAbsence;
  window.parseStrictMaxMark = parseStrictMaxMark;
}
