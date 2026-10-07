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

// m: {expecting, haveSession, error, result, fileName, busy}
function buildCard2Html(m) {
  const expecting = `<div id="smartplan-expecting" style="font-size:13px;font-weight:600;color:var(--c-text);margin-block-end:10px">${esc(srT('smartplan_expecting', { inst: m.expecting.inst, cls: m.expecting.cls, section: m.expecting.section }))}</div>`;
  const pick = `<button type="button" class="btn btn-secondary" data-action="smartPlanPickFile" ${m.haveSession ? '' : 'disabled'}>${esc(srT('smartplan_upload_btn'))}</button>
    <input type="file" id="smartplan-upload" accept=".txt,.md,.text,.xml,text/plain" data-change-action="smartPlanUpload" style="display:none">
    <span style="font-size:12.5px;color:var(--c-text3);margin-inline-start:10px">${esc(m.fileName || '')}</span>`;
  const need = m.haveSession ? '' : `<div style="font-size:12.5px;color:var(--c-text3);margin-block-start:8px">${esc(srT('smartplan_upload_need_prompt'))}</div>`;
  const err = m.error ? `<div id="smartplan-error" role="alert" style="margin-block-start:12px;padding:10px 12px;border:1.5px solid var(--c-danger,#a91e2c);border-radius:var(--r-sm);color:var(--c-danger,#a91e2c);font-size:13px;font-weight:600">${esc(m.error)}</div>` : '';
  const ok = m.result && m.result.matched.length;
  const gen = m.result ? `<button type="button" class="btn btn-primary" data-action="smartPlanGenerateReports" ${ok && !m.busy ? '' : 'disabled'} style="margin-block-start:14px">${esc(m.busy ? srT('smartplan_building', { done: m.busy.done, total: m.busy.total }) : srT('smartplan_generate_reports', { n: m.result.matched.length }))}</button>` : '';
  return card(h(srT('smartplan_card2_title')) + sub(srT('smartplan_card2_hint')) + expecting + pick + need + err + summaryHtml(m.result) + gen, 'smartplan-card2');
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
