// ui/smart-plan/smart-plan-nav.js  (Smart Planner tasks 06/07) - DOM + events layer.
// Calls the BAL (bal/smart-plan/*) for every decision; contains no eligibility/prompt/parse/PDF logic.
// All state is session-only, in memory: nothing here is written to localStorage or sent anywhere.
import { APP } from '../../core/app-state.js';
import { esc, toast } from '../../core/dom-helpers.js';
import { srT } from '../../core/render-i18n.js';
import { COUNTRY_LANGUAGES } from '../../core/shared-constants.js';
import { getStudents, getSetup } from '../../dal/common/data-access.js';
import { computeEligibility } from '../../bal/smart-plan/eligibility.js';
import { buildPrompt, promptFileName } from '../../bal/smart-plan/prompt-builder.js';
import { parseResponse } from '../../bal/smart-plan/response-parser.js';
import { computeStandings, buildStudyPlanZip } from '../../bal/smart-plan/study-plan-pdf.js';
import { buildScreenHtml, buildCard1Html, buildCard2Html, buildRailHtml } from './smart-plan-render.js';

const S = {
  fileKey: null, checked: new Set(), deselected: new Set(), eligible: [], excluded: [],
  session: null, result: null, error: '', fileName: '', promptFile: '', busy: null,
};
let _setup = null, _students = [];

function resetFor(fileKey) { Object.assign(S, { fileKey, checked: new Set(), deselected: new Set(), eligible: [], excluded: [], session: null, result: null, error: '', fileName: '', promptFile: '', busy: null }); }
const shortTest = n => { const p = (String((_setup || {}).className || '') + String((_setup || {}).section || '')).replace(/[^a-zA-Z0-9]/g, '').slice(0, 18).toLowerCase(); return p && String(n).toLowerCase().startsWith(p + '-') ? String(n).slice(p.length + 1) : String(n); };
const label = st => (st.name ? st.name + ' (' + st.id + ')' : String(st.id));
const byId = id => _students.find(s => String(s.id) === String(id));
const selectedIds = () => S.eligible.filter(e => !S.deselected.has(e.id)).map(e => e.id);

async function loadData() {
  _setup = await getSetup(); _students = await getStudents();
  const key = (APP.homeSingleFile && APP.homeSingleFile.fileName) + '|' + _students.length + '|' + ((_setup && _setup.tests) || []).length;
  if (S.fileKey !== key) resetFor(key);          // a different file/analysis: drop selections and any prompt session
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
  return { expecting: { inst: s.instName || '', cls: s.className || '', section: s.section || '-' }, haveSession: !!S.session, error: S.error, result: S.result, fileName: S.fileName, busy: S.busy };
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
  S.session = { token: p.validationToken, studentIds: p.studentIds, evidence: p.evidence, testNames: p.testNames, subjects: p.subjects, checked: [...S.checked] };
  S.result = null; S.error = ''; S.fileName = ''; S.promptFile = fname;
  download(new Blob([p.xmlString], { type: 'application/xml' }), fname);
  toast(srT('smartplan_prompt_ready', { fname }), 'success');
  paint({ card1: true, card2: true });
}

export async function handleUpload(inputEl) {
  const file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;
  await loadData();
  S.fileName = file.name; S.result = null; S.error = '';
  if (!S.session) { S.error = srT('smartplan_upload_need_prompt'); paint({ card2: true }); return; }
  let text = '';
  try { text = await file.text(); } catch (e) { S.error = srT('smartplan_err_read'); paint({ card2: true }); return; }
  const r = parseResponse(text, { token: S.session.token, expectedIds: S.session.studentIds, evidence: S.session.evidence, subjects: S.session.subjects, testNames: S.session.testNames, chapterVocabulary: classChapters() });
  if (!r.ok) {
    // Hard rejection: specific, impossible to miss, and the Generate Reports button is not even rendered.
    S.error = srT(r.code === 'token_mismatch' ? 'smartplan_err_token_mismatch' : 'smartplan_err_token_missing');
  } else { S.result = r; }
  paint({ card2: true });
}

export async function generateReports() {
  await loadData();
  const r = S.result;
  if (!S.session || !r || !r.ok || !r.matched.length || S.busy) return;
  try {
    const standings = computeStandings(_students, _setup, S.session.checked);
    const items = r.matched.map(id => ({ student: byId(id), plan: r.students[id], standing: standings.byId[id] })).filter(it => it.student && it.plan);
    S.busy = { done: 0, total: items.length }; paint({ card2: true });
    const out = await buildStudyPlanZip(items, _setup, S.session.checked, { jsPDF: window.jspdf.jsPDF, JSZip: window.JSZip }, (done, total) => { S.busy = { done, total }; paint({ card2: true }); });
    download(out.blob, out.fileName);
    toast(srT('smartplan_reports_done', { fname: out.fileName, n: out.count }), 'success');
  } catch (err) {
    toast(srT('pdf_export_failed', { msg: err && err.message ? err.message : String(err) }), 'error');
  } finally { S.busy = null; paint({ card2: true }); }
}

// test hooks (read-only view of session state) - used by the e2e checklist, never by app code
export function _debugState() { return { checked: [...S.checked], eligible: S.eligible.length, excluded: S.excluded.length, selected: selectedIds().length, hasSession: !!S.session, token: S.session && S.session.token, result: S.result && { ok: S.result.ok, matched: S.result.matched, missing: S.result.missing }, error: S.error }; }
