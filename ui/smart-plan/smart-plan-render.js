// ui/smart-plan/smart-plan-render.js  (Smart Planner task 07) - pure HTML builders, no state, no events.
import { esc } from '../../core/dom-helpers.js';
import { srT } from '../../core/render-i18n.js';

const card = (inner, id) => `<div class="card" ${id ? `id="${id}"` : ''} style="padding:18px 20px;margin-block-end:16px">${inner}</div>`;
const h = (t) => `<div style="font-size:15px;font-weight:700;color:var(--c-text);margin-block-end:4px">${esc(t)}</div>`;
const sub = (t) => `<div style="font-size:12.5px;color:var(--c-text3);margin-block-end:12px">${esc(t)}</div>`;

// tests: [{name, label, checked}]
function buildCard1Html(m) {
  const tests = m.tests.map(t => `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;cursor:pointer">
      <input type="checkbox" data-change-action="smartPlanToggleTest" data-arg="${esc(t.name)}" ${t.checked ? 'checked' : ''} style="accent-color:var(--c-primary)">
      <span>${esc(t.label)}</span></label>`).join('');
  let status;
  if (!m.checkedCount) status = `<div style="font-size:12.5px;color:var(--c-text3);margin-block:10px">${esc(srT('smartplan_no_tests_checked'))}</div>`;
  else status = `<div style="font-size:12.5px;color:var(--c-text2);margin-block:10px"><b>${esc(srT('smartplan_eligible_count', { n: m.eligibleCount }))}</b> · ${esc(srT('smartplan_selected_count', { n: m.selectedCount }))}</div>`;
  let excluded = '';
  if (m.excluded.length) {
    excluded = `<div id="smartplan-excluded" style="margin-block-start:10px;padding:10px 12px;border:1px dashed var(--c-border);border-radius:var(--r-sm)">
      <div style="font-size:12.5px;font-weight:600;color:var(--c-text2)">${esc(srT('smartplan_excluded_title', { n: m.excluded.length }))}</div>
      <div style="font-size:12px;color:var(--c-text3);margin-block:2px 6px">${esc(srT('smartplan_excluded_reason'))}</div>
      <div style="font-size:12.5px;color:var(--c-text2);line-height:1.6">${m.excluded.map(e => esc(e.label)).join(' · ')}</div></div>`;
  }
  const btn = `<button type="button" class="btn btn-primary" data-action="smartPlanGeneratePrompt" ${m.selectedCount ? '' : 'disabled'} style="margin-block-start:14px">${esc(srT('smartplan_generate_prompt'))}</button>`;
  const ready = m.promptFile ? `<div style="font-size:12.5px;color:var(--c-primary);margin-block-start:10px">${esc(srT('smartplan_prompt_ready', { fname: m.promptFile }))}</div>` : '';
  return card(h(srT('smartplan_card1_title')) + sub(srT('smartplan_card1_hint')) +
    `<div style="font-size:12px;font-weight:600;color:var(--c-text3);text-transform:uppercase;letter-spacing:.04em">${esc(srT('smartplan_tests_label'))}</div>` +
    tests + status + excluded + btn + ready, 'smartplan-card1');
}

function summaryHtml(r) {
  if (!r) return '';
  const lines = [];
  lines.push(`<div style="font-weight:600">${esc(srT('smartplan_parse_summary', { ok: r.matched.length, total: r.matched.length + r.needRegenerate.length }))}</div>`);
  if (r.missing.length) lines.push(`<div style="color:var(--c-danger,#a91e2c)">${esc(srT('smartplan_missing', { ids: r.missing.join(', ') }))}</div>`);
  if (r.parseFailed.length) lines.push(`<div style="color:var(--c-danger,#a91e2c)">${esc(srT('smartplan_parse_failed', { ids: r.parseFailed.map(f => f.id).join(', ') }))}</div>`);
  if (r.unexpected.length) lines.push(`<div style="color:var(--c-text2)">${esc(srT('smartplan_unexpected', { ids: r.unexpected.join(', ') }))}</div>`);
  const flagged = Object.values(r.students).filter(s => s.flags && s.flags.length).length;
  if (flagged) lines.push(`<div style="color:var(--c-warn,#a86d14)">${esc(srT('smartplan_flagged', { n: flagged }))}</div>`);
  return `<div id="smartplan-summary" style="margin-block-start:12px;font-size:12.5px;display:grid;gap:4px">${lines.join('')}</div>`;
}

const WARN = 'var(--c-warn,#a86d14)';
const panel = (inner, colour, id) => `<div ${id ? `id="${id}"` : ''} style="margin-block-start:12px;padding:10px 12px;border:1.5px solid ${colour};border-radius:var(--r-sm);font-size:12.5px;color:var(--c-text2);display:grid;gap:8px">${inner}</div>`;

// teacher must confirm when the student IDs match but the validation code does not
function confirmHtml(c) {
  if (!c) return '';
  const msg = c.status === 'different' ? srT('smartplan_confirm_different', { seen: c.seen }) : srT('smartplan_confirm_missing');
  return panel(`<div style="font-weight:700;color:var(--c-text)">${esc(srT('smartplan_confirm_title'))}</div><div>${esc(msg)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-primary btn-sm" data-action="smartPlanConfirm">${esc(srT('smartplan_confirm_yes'))}</button>
    <button type="button" class="btn btn-secondary btn-sm" data-action="smartPlanDiscard">${esc(srT('smartplan_confirm_no'))}</button></div>`, WARN, 'smartplan-confirm');
}
const MAX_FLAG_ROWS = 8;
// students whose answer needs a closer look + the one-click "re-ask only these" prompt
function flagHtml(p, busy) {
  if (!p) return '';
  const rows = p.rows.slice(0, MAX_FLAG_ROWS).map(r => `<div><b style="color:var(--c-text)">${esc(r.label)}</b>: ${r.items.map(it => esc(srT('smartplan_issue_' + it.code, it.params || {}))).join(' · ')}</div>`).join('');
  const more = p.rows.length > MAX_FLAG_ROWS ? `<div>${esc(srT('smartplan_flag_more', { n: p.rows.length - MAX_FLAG_ROWS }))}</div>` : '';
  const waiting = p.waiting ? `<div id="smartplan-redo-waiting" style="font-weight:600;color:var(--c-primary)">${esc(srT('smartplan_redo_waiting'))}</div>` : '';
  return panel(`<div style="font-weight:700;color:var(--c-text)">${esc(srT('smartplan_flag_title', { n: p.count }))}</div><div>${esc(srT('smartplan_flag_hint'))}</div>${rows}${more}${waiting}
    <div><button type="button" class="btn btn-secondary btn-sm" data-action="smartPlanRedoPrompt" ${busy ? 'disabled' : ''}>${esc(srT('smartplan_redo_btn', { n: p.count }))}</button></div>`, WARN, 'smartplan-flags');
}

// m: {expecting, haveSession, error, result, fileName, busy, confirm, plan, pasteText, note, redone, waiting, canBuild}
function buildCard2Html(m) {
  const expecting = `<div id="smartplan-expecting" style="font-size:13px;font-weight:600;color:var(--c-text);margin-block-end:10px">${esc(srT('smartplan_expecting', { inst: m.expecting.inst, cls: m.expecting.cls, section: m.expecting.section }))}</div>`;
  const pick = `<button type="button" class="btn btn-secondary" data-action="smartPlanPickFile" ${m.haveSession ? '' : 'disabled'}>${esc(srT('smartplan_upload_btn'))}</button>
    <input type="file" id="smartplan-upload" accept=".txt,.md,.text,.xml,.rtf,text/plain,text/rtf" data-change-action="smartPlanUpload" style="display:none">
    <span style="font-size:12.5px;color:var(--c-text3);margin-inline-start:10px">${esc(m.fileName || '')}</span>`;
  const paste = `<div style="margin-block-start:14px"><div style="font-size:12.5px;color:var(--c-text3);margin-block-end:6px">${esc(srT('smartplan_paste_label'))}</div>
    <textarea id="smartplan-paste" rows="5" ${m.haveSession ? '' : 'disabled'} placeholder="${esc(srT('smartplan_paste_placeholder'))}" style="width:100%;box-sizing:border-box;font-family:var(--font-mono,monospace);font-size:12px;padding:8px;border:1px solid var(--c-border);border-radius:var(--r-sm);background:var(--c-surface,transparent);color:var(--c-text)">${esc(m.pasteText || '')}</textarea>
    <button type="button" class="btn btn-secondary btn-sm" data-action="smartPlanPasteCheck" ${m.haveSession ? '' : 'disabled'} style="margin-block-start:6px">${esc(srT('smartplan_paste_btn'))}</button></div>`;
  const need = m.haveSession ? '' : `<div style="font-size:12.5px;color:var(--c-text3);margin-block-start:8px">${esc(srT('smartplan_upload_need_prompt'))}</div>`;
  const err = m.error ? `<div id="smartplan-error" role="alert" style="margin-block-start:12px;padding:10px 12px;border:1.5px solid var(--c-danger,#a91e2c);border-radius:var(--r-sm);color:var(--c-danger,#a91e2c);font-size:13px;font-weight:600">${esc(m.error)}</div>` : '';
  const note = m.note ? `<div id="smartplan-note" style="margin-block-start:8px;font-size:12.5px;color:var(--c-text3)">${esc(m.note)}</div>` : '';
  const redone = m.redone ? `<div style="margin-block-start:8px;font-size:12.5px;color:var(--c-primary)">${esc(srT('smartplan_redone', { n: m.redone }))}</div>` : '';
  const ok = m.result && m.result.matched.length;
  const needConfirm = m.confirm ? `<div style="font-size:12.5px;color:var(--c-text3);margin-block-start:10px">${esc(srT('smartplan_confirm_needed'))}</div>` : '';
  const gen = m.result ? `<button type="button" class="btn btn-primary" data-action="smartPlanGenerateReports" ${ok && m.canBuild && !m.busy ? '' : 'disabled'} style="margin-block-start:14px">${esc(m.busy ? srT('smartplan_building', { done: m.busy.done, total: m.busy.total }) : srT('smartplan_generate_reports', { n: m.result.matched.length }))}</button>` : '';
  return card(h(srT('smartplan_card2_title')) + sub(srT('smartplan_card2_hint')) + expecting + pick + paste + need + err + note + confirmHtml(m.confirm) + summaryHtml(m.result) + redone + flagHtml(m.plan, m.busy) + needConfirm + gen, 'smartplan-card2');
}

function buildScreenHtml(m) {
  return `<div id="smartplan-screen" style="max-width:760px;margin:0 auto;padding:6px 4px">
    <div style="margin-block-end:14px">${h(srT('smartplan_title'))}${sub(srT('smartplan_intro'))}</div>
    ${buildCard1Html(m.card1)}${buildCard2Html(m.card2)}</div>`;
}

// rows: [{id,label,selected}]
function buildRailHtml(m) {
  if (!m.checkedCount || !m.rows.length) {
    return `<div class="shell-panel-title">${esc(srT('smartplan_rail_title'))}</div><div style="font-size:12.5px;color:var(--c-text3);padding:6px 2px">${esc(srT('smartplan_rail_empty'))}</div>`;
  }
  const rows = m.rows.map(r => `<label style="display:flex;align-items:center;gap:8px;padding:4px 2px;font-size:12.5px;cursor:pointer">
      <input type="checkbox" class="smartplan-student-cb" data-change-action="smartPlanToggleStudent" data-arg="${esc(r.id)}" ${r.selected ? 'checked' : ''} style="accent-color:var(--c-primary)">
      <span>${esc(r.label)}</span></label>`).join('');
  return `<div class="shell-panel-title">${esc(srT('smartplan_rail_title'))} (${m.rows.length})</div>
    <div style="display:flex;gap:8px;margin-block:6px">
      <button type="button" class="btn btn-secondary btn-sm" data-action="smartPlanSelectAll" data-arg="all">${esc(srT('smartplan_select_all'))}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-action="smartPlanSelectAll" data-arg="none">${esc(srT('smartplan_select_none'))}</button></div>
    <div id="smartplan-student-list" style="max-height:60vh;overflow:auto">${rows}</div>`;
}

export { buildScreenHtml, buildCard1Html, buildCard2Html, buildRailHtml };
