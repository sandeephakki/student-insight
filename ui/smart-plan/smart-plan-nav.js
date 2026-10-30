// ui/smart-plan/smart-plan-nav.js  (Smart Planner tasks 06/07) - DOM + events layer.
// Calls the BAL (bal/smart-plan/*) for every decision; contains no eligibility/prompt/parse/PDF logic.
//
// PIB EXCEPTION - localStorage (read this before removing/"fixing" it, same
// convention as core/onboarding-slider.js's own PIB EXCEPTION note):
//   A generated prompt's token/evidence used to live in memory only, so a
//   hard refresh between "generate prompt" and "paste the answer back in" -
//   a gap that's realistically minutes to days, not seconds - forced
//   re-generating a brand new prompt even though the teacher's answer file
//   was perfectly valid for the one they already sent. Fixed by persisting
//   ONLY the session envelope (token, student IDs, evidence, checked tests)
//   under key `smartplan-session:<fileKey>`, scoped to the exact uploaded
//   file's identity so it's inert the moment a different file is open - same
//   effective privacy boundary as before, surviving a refresh is the only
//   change. Entry self-expires after 7 days and is deleted the moment its
//   result is successfully consumed (see generateReports()) or a new prompt
//   overwrites it (see generatePromptFile()) - never piles up stale tokens.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function sessionLsKey(fileKey) { return 'smartplan-session:' + fileKey; }
function saveSession(fileKey, session) {
  try { localStorage.setItem(sessionLsKey(fileKey), JSON.stringify({ ...session, savedAt: Date.now() })); } catch (e) { /* ignore, see PIB EXCEPTION note above */ }
}
function loadSession(fileKey) {
  try {
    const raw = localStorage.getItem(sessionLsKey(fileKey));
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s.savedAt !== 'number' || Date.now() - s.savedAt > SESSION_TTL_MS) { clearSession(fileKey); return null; }
    return s;
  } catch (e) { return null; }
}
function clearSession(fileKey) { try { localStorage.removeItem(sessionLsKey(fileKey)); } catch (e) { /* ignore */ } }
import { APP } from '../../core/app-state.js';
import { esc, toast } from '../../core/dom-helpers.js';
import { srT } from '../../core/render-i18n.js';
import { COUNTRY_LANGUAGES } from '../../core/shared-constants.js';
import { getStudents, getSetup } from '../../dal/common/data-access.js';
import { computeEligibility } from '../../bal/smart-plan/eligibility.js';
import { buildPrompt, promptFileName } from '../../bal/smart-plan/prompt-builder.js';
import { parseResponse } from '../../bal/smart-plan/response-parser.js';
import { detectKind, isUnreadableName } from '../../bal/smart-plan/result-text.js';
import { buildRedoPrompt, mergeResults, redoPlan, redoFileName } from '../../bal/smart-plan/regenerate.js';
import { computeStandings, buildStudyPlanZip } from '../../bal/smart-plan/study-plan-pdf.js';
import { buildScreenHtml, buildCard1Html, buildCard2Html, buildRailHtml } from './smart-plan-render.js';

const S = {
  fileKey: null, checked: new Set(), deselected: new Set(), eligible: [], excluded: [],
  session: null, result: null, error: '', fileName: '', promptFile: '', busy: null,
  confirmed: false, plan: null, redoWaiting: false, redoFile: '', pasteText: '', note: '', redoneCount: 0,
};
let _setup = null, _students = [];

function resetFor(fileKey) { Object.assign(S, { fileKey, checked: new Set(), deselected: new Set(), eligible: [], excluded: [], session: null, result: null, error: '', fileName: '', promptFile: '', busy: null, confirmed: false, plan: null, redoWaiting: false, redoFile: '', pasteText: '', note: '', redoneCount: 0 }); }
const shortTest = n => { const p = (String((_setup || {}).className || '') + String((_setup || {}).section || '')).replace(/[^a-zA-Z0-9]/g, '').slice(0, 18).toLowerCase(); return p && String(n).toLowerCase().startsWith(p + '-') ? String(n).slice(p.length + 1) : String(n); };
const label = st => (st.name ? st.name + ' (' + st.id + ')' : String(st.id));
const byId = id => _students.find(s => String(s.id) === String(id));
const selectedIds = () => S.eligible.filter(e => !S.deselected.has(e.id)).map(e => e.id);

async function loadData() {
  _setup = await getSetup(); _students = await getStudents();
  const key = (APP.homeSingleFile && APP.homeSingleFile.fileName) + '|' + _students.length + '|' + ((_setup && _setup.tests) || []).length;
  if (S.fileKey !== key) {
    resetFor(key);                                // a different file/analysis: drop selections and any prompt session...
    const saved = loadSession(key);                // ...then offer back a not-yet-consumed, not-yet-expired one for THIS exact file, if any
    if (saved) { S.session = { token: saved.token, studentIds: saved.studentIds, evidence: saved.evidence, testNames: saved.testNames, subjects: saved.subjects, language: saved.language, checked: saved.checked }; S.checked = new Set(saved.checked || []); S.promptFile = saved.promptFile || ''; }
  }
}
function recompute() {
  const r = computeEligibility(_students, [...S.checked]);
  S.eligible = r.eligible;
  S.excluded = r.excluded;
}
function card1Model() {
  const tests = ((_setup && _setup.tests) || []).map(t => ({ name: t.name, label: shortTest(t.name), checked: S.checked.has(t.name) }));
  const sel = selectedIds().length;
  return { tests, checkedCount: S.checked.size, eligibleCount: S.eligible.length, selectedCount: sel,
    excluded: S.excluded.map(e => ({ id: e.id, label: label(byId(e.id) || { id: e.id }), reason: e.reason })), promptFile: S.promptFile };
}
function card2Model() {
  const s = _setup || {};
  const r = S.result;
  const confirm = r && r.needsConfirm && !S.confirmed ? { status: r.tokenStatus, seen: r.tokenSeen || '' } : null;
  const plan = S.plan && S.plan.ids.length ? { count: S.plan.ids.length, rows: S.plan.ids.map(id => ({ label: label(byId(id) || { id }), items: S.plan.reasons[id] })), redoReady: !!S.redoFile, waiting: S.redoWaiting } : null;
  return { expecting: { inst: s.instName || '', cls: s.className || '', section: s.section || '-' }, haveSession: !!S.session, error: S.error, result: r, fileName: S.fileName, busy: S.busy,
    confirm, plan, pasteText: S.pasteText, note: S.note, redone: S.redoneCount, waiting: S.redoWaiting, canBuild: !!(r && r.ok && r.matched.length && !confirm) };
}
function railModel() {
  return { checkedCount: S.checked.size, rows: S.eligible.map(e => ({ id: e.id, label: label(byId(e.id) || { id: e.id }), selected: !S.deselected.has(e.id) })) };
}
function paint(parts) {
  const all = !parts;
  if (all || parts.card1) { const el = document.getElementById('smartplan-card1'); if (el) el.outerHTML = buildCard1Html(card1Model()); }
  if (all || parts.card2) { const el = document.getElementById('smartplan-card2'); if (el) el.outerHTML = buildCard2Html(card2Model()); }
  if (all || parts.rail) { if (typeof window.setRightRail === 'function') window.setRightRail(buildRailHtml(railModel())); }
}

// Entry point: called by openBucket('smartplan') (after the lock gate) via dynamic import.
export async function renderSmartPlanScreen() {
  await loadData();
  const host = document.getElementById('bucket-answer-screen');
  if (!host) return;
  if (!_students.length) { host.innerHTML = `<div class="bucket-empty-state" style="max-width:480px;margin:60px auto"><div class="bucket-empty-sub">${esc(srT('val_run_analysis_first'))}</div></div>`; return; }
  recompute();
  host.innerHTML = buildScreenHtml({ card1: card1Model(), card2: card2Model() });
  if (typeof window.setShellRailOpen === 'function') window.setShellRailOpen('end', true);
  paint({ rail: true });
}

export async function toggleTest(name, on) {
  await loadData();
  if (on) S.checked.add(name); else S.checked.delete(name);
  recompute(); paint();
}
export async function toggleStudent(id, on) {
  await loadData();
  if (on) S.deselected.delete(id); else S.deselected.add(id);
  paint({ card1: true });
}
export async function setAllStudents(all) {
  await loadData();
  S.deselected = all ? new Set() : new Set(S.eligible.map(e => e.id));
  paint();
}

// Every chapter name present anywhere in the loaded class (not just what was sent) - lets the parser flag a real
// chapter cited for a student whose own data never included it.
function classChapters() {
  const set = new Set();
  for (const st of _students) for (const td of Object.values(st.testData || {})) { if (!td) continue; if (td.chapter) set.add(String(td.chapter).trim()); for (const c of Object.values(td.chapters || {})) if (c) set.add(String(c).trim()); }
  return [...set];
}

function currentLanguageName() {
  const code = window.SR_LANG || 'en';
  if (code === 'en') return 'English';
  for (const c of Object.values(COUNTRY_LANGUAGES)) { const l = c.languages.find(x => x.code === code); if (l) { const m = /\(([^)]+)\)/.exec(l.label); return m ? m[1] : l.label; } }
  return 'English';
}
function download(blob, fname) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function generatePromptFile() {
  await loadData();
  const ids = new Set(selectedIds());
  if (!ids.size) return;
  const elig = S.eligible.filter(e => ids.has(e.id));
  const p = buildPrompt(elig, _students, _setup, { outputLanguage: currentLanguageName() });
  const base = (APP.homeSingleFile && APP.homeSingleFile.fileName) || APP._origFileName || (_setup.instName + ' ' + _setup.className);
  const fname = promptFileName(base);
  S.session = { token: p.validationToken, studentIds: p.studentIds, evidence: p.evidence, testNames: p.testNames, subjects: p.subjects, language: p.language, checked: [...S.checked] };
  S.result = null; S.error = ''; S.fileName = ''; S.promptFile = fname; S.confirmed = false; S.plan = null; S.redoWaiting = false; S.redoFile = ''; S.note = ''; S.pasteText = ''; S.redoneCount = 0;
  saveSession(S.fileKey, { ...S.session, promptFile: fname });   // survives a refresh; overwrites (invalidates) any prior one for this file
  download(new Blob([p.xmlString], { type: 'application/xml' }), fname);
  toast(srT('smartplan_prompt_ready', { fname }), 'success');
  paint({ card1: true, card2: true });
}

function parseCtx(expectedIds) {
  return { token: S.session.token, expectedIds: expectedIds || S.session.studentIds, evidence: S.session.evidence, subjects: S.session.subjects, testNames: S.session.testNames, language: S.session.language, chapterVocabulary: classChapters() };
}
// Hard rejections only: wrong class, nothing readable, nothing to parse. A wrong/missing validation token is NOT one of them
// (the result is parsed and the teacher confirms - see card2Model().confirm).
function errorFor(r) {
  if (r.code === 'wrong_class') return srT('smartplan_err_wrong_class', { overlap: r.overlap, expected: r.expectedCount });
  if (r.code === 'unreadable_file') return srT('smartplan_err_unreadable');
  if (r.code === 'no_blocks') return srT('smartplan_err_no_blocks');
  return srT('smartplan_err_empty');
}
// One entry point for BOTH the file picker and the paste box - same parser, same checks.
function processText(text, fileName) {
  S.fileName = fileName || ''; S.error = ''; S.note = '';
  if (!S.session) { S.error = srT('smartplan_upload_need_prompt'); return; }
  const kind = detectKind(text);
  if (kind === 'rtf') S.note = srT('smartplan_rtf_converted');
  const redoing = S.redoWaiting && S.result && S.result.ok && S.plan;
  const r = parseResponse(text, parseCtx(redoing ? S.plan.ids : null));
  if (!r.ok) { S.error = errorFor(r); if (!redoing) { S.result = null; S.plan = null; S.confirmed = false; } return; }   // a bad re-ask never destroys the first result
  if (redoing) {
    S.result = mergeResults(S.result, r, parseCtx());
    S.redoneCount = (S.result.redone || []).length; S.redoWaiting = false; S.redoFile = '';
    if (r.needsConfirm && !S.confirmed) S.confirmed = false;
  } else { S.result = r; S.confirmed = !r.needsConfirm; S.redoneCount = 0; S.redoFile = ''; }
  S.plan = redoPlan(S.result);
}

export async function handleUpload(inputEl) {
  const file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;
  await loadData();
  S.result = S.redoWaiting ? S.result : null;
  if (isUnreadableName(file.name)) { S.fileName = file.name; S.error = srT('smartplan_err_unreadable'); if (!S.redoWaiting) { S.result = null; S.plan = null; } paint({ card2: true }); return; }
  let text = '';
  try { text = await file.text(); } catch (e) { S.fileName = file.name; S.error = srT('smartplan_err_read'); paint({ card2: true }); return; }
  processText(text, file.name);
  if (inputEl) inputEl.value = '';                         // the same file can be picked again after a fix
  paint({ card2: true });
}
export async function handlePaste() {
  await loadData();
  const box = document.getElementById('smartplan-paste');
  const text = box ? box.value : S.pasteText;
  S.pasteText = text;
  S.result = S.redoWaiting ? S.result : null;
  processText(text, '');
  paint({ card2: true });
}
export async function confirmResult() { await loadData(); if (S.result && S.result.ok) S.confirmed = true; paint({ card2: true }); }
export async function discardResult() {
  await loadData();
  S.result = null; S.plan = null; S.confirmed = false; S.fileName = ''; S.error = ''; S.note = ''; S.redoWaiting = false; S.redoFile = ''; S.redoneCount = 0;
  paint({ card2: true });
}
// Re-ask ONLY the flagged students: same token, same evidence, plus a short list of what was wrong with each.
export async function downloadRedoPrompt() {
  await loadData();
  if (!S.session || !S.result || !S.plan || !S.plan.ids.length) return;
  const elig = computeEligibility(_students, S.session.checked).eligible;
  const p = buildRedoPrompt(elig, _students, _setup, S.session, S.plan, { outputLanguage: S.session.language || currentLanguageName() });
  const base = (APP.homeSingleFile && APP.homeSingleFile.fileName) || APP._origFileName || (_setup.instName + ' ' + _setup.className);
  const fname = redoFileName(base);
  S.redoFile = fname; S.redoWaiting = true; S.error = '';
  download(new Blob([p.xmlString], { type: 'application/xml' }), fname);
  toast(srT('smartplan_redo_ready', { fname }), 'success');
  paint({ card2: true });
}

export async function generateReports() {
  await loadData();
  const r = S.result;
  if (!S.session || !r || !r.ok || !r.matched.length || S.busy || (r.needsConfirm && !S.confirmed)) return;
  try {
    const standings = computeStandings(_students, _setup, S.session.checked);
    const items = r.matched.map(id => ({ student: byId(id), plan: r.students[id], standing: standings.byId[id] })).filter(it => it.student && it.plan);
    S.busy = { done: 0, total: items.length }; paint({ card2: true });
    const out = await buildStudyPlanZip(items, _setup, S.session.checked, { jsPDF: window.jspdf.jsPDF, JSZip: window.JSZip }, (done, total) => { S.busy = { done, total }; paint({ card2: true }); });
    download(out.blob, out.fileName);
    clearSession(S.fileKey);   // consumed - don't let the same answer file be replayed again later
    toast(srT('smartplan_reports_done', { fname: out.fileName, n: out.count }), 'success');
  } catch (err) {
    toast(srT('pdf_export_failed', { msg: err && err.message ? err.message : String(err) }), 'error');
  } finally { S.busy = null; paint({ card2: true }); }
}

// test hooks (read-only view of session state) - used by the e2e checklist, never by app code
export function _debugState() { return { checked: [...S.checked], eligible: S.eligible.length, excluded: S.excluded.length, selected: selectedIds().length, hasSession: !!S.session, token: S.session && S.session.token, result: S.result && { ok: S.result.ok, matched: S.result.matched, missing: S.result.missing, tokenStatus: S.result.tokenStatus, needsConfirm: S.result.needsConfirm }, confirmed: S.confirmed, flagged: S.plan ? S.plan.ids : [], error: S.error }; }
