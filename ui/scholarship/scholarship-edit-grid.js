// Phase 2 — Tasks 03/05/06/07: the Scholarship tab's inline-editable
// grid, its in-memory edit-state buffer, the save-button validation
// gate, and the backup+zip "Update and Download" action.
//
// Kept as one file (rather than four) since all four pieces share the
// same small piece of state (the edit buffer) and none is independently
// useful without the others — same reasoning Task 07's own spec gives
// for shipping its parser+wiring together.
import { esc, toast } from '../../core/app-utils-init.js';
import { srT } from '../../core/render-i18n.js';
import { splitByDataCompleteness } from '../../bal/scholarship/scholarship-completeness-grid.js';
import { calculateScholarshipEligibility } from '../../bal/scholarship/scholarship-eligibility-engine.js';
import { REFERENCE_LISTS, deriveUpdateFilenames } from '../../core/template-upload.js';
import { APP } from '../../core/state-nav.js';

// ---- Task 05: in-memory edit-state store ----------------------------
// Staging buffer, NOT a mutation of APP.students — see this task's own
// spec for why (Task 07's backup needs pre-edit APP.students untouched).
// Keyed by student id; only holds fields actually edited, not a full
// per-student copy. Session-only (no persistence), and deliberately
// module-local rather than hung off APP, so nothing outside this file's
// exported accessors can read/write it directly.
const EDIT_FIELDS=["category","annualFamilyIncome","guardianOccupation","priorScholarshipStatus","persistentStudentId","specialCategoryFlag"];
let _buffer={};

// Deliberate choice (Task 05 §5): the buffer survives navigating away
// from and back to the Scholarship tab — re-rendering the grid must not
// silently discard in-progress edits just because the user checked
// another tab. It's only ever cleared by a successful save (Task 07) or
// by parseWorkbookSheets() on a genuinely new file/re-import (see
// template-upload.js — a new file's student ids aren't this buffer's to
// keep).
function clearScholarshipEditBuffer(){ _buffer={}; }
function hasScholarshipPendingEdits(){ return Object.keys(_buffer).length>0; }

// Read-through accessor: buffer value if edited, else the original
// student field. Used by both the grid's own re-render and Task 06's
// validation, so neither ever has to reach into APP.students directly
// for something that might have a pending edit.
function getScholarshipEditValue(student,field){
  const b=_buffer[student.id];
  if(b&&Object.prototype.hasOwnProperty.call(b,field))return b[field];
  return student[field]||"";
}
function setScholarshipEditValue(studentId,field,value){
  if(!EDIT_FIELDS.includes(field))return;
  if(!_buffer[studentId])_buffer[studentId]={};
  _buffer[studentId][field]=value;
}
// The buffer-merged view Task 06's validation (and Task 07's save) run
// against — a NEW array of NEW student objects, never APP.students
// itself and never a mutation of its member objects. Matches this
// codebase's existing reassign-not-mutate convention for APP.students
// (compute-stats.js), which is also what keeps Task 08's dashboard
// memoization cache correctly invalidating after a save.
function getScholarshipMergedStudents(){
  const students=APP.students||[];
  if(!Object.keys(_buffer).length)return students;
  return students.map(st=>{
    const b=_buffer[st.id];
    return b?Object.assign({},st,b):st;
  });
}

// ---- Task 06: validation gate ----------------------------------------
// Reuses splitByDataCompleteness()'s own scheme-aware missingFields
// output — no second required-field ruleset invented here. Called
// against the buffer-merged view so an edit fills in the field the
// SAME render pass it's typed, no page reload needed.
function buildSchemeConfigForEdit(){
  const sch=(APP.setup&&APP.setup.scholarship)||{};
  return {
    eligibilityType:sch.eligibilityType||"",
    minAcademicAvg:sch.minAcademicAvg||0,
    maxFamilyIncome:sch.maxFamilyIncome||0,
    noFailRule:sch.noFailRule===true||sch.noFailRule==="Yes"?"Yes":"No",
    attendanceFloor:sch.attendanceFloor==null?Infinity:sch.attendanceFloor,
    categoryQuota:sch.categoryQuota,
    weightAcademic:sch.weightAcademic||0,
    weightConsistency:sch.weightConsistency||0,
    weightGrowth:sch.weightGrowth||0,
    passThreshold:APP.setup.passThreshold
  };
}
function scholarshipEditValidationState(){
  const students=getScholarshipMergedStudents();
  const schemeConfig=buildSchemeConfigForEdit();
  const engineResults=calculateScholarshipEligibility(students,schemeConfig);
  const split=splitByDataCompleteness(engineResults,students);
  return {
    allComplete:split.errorGrid.length===0,
    incompleteStudentIds:split.errorGrid.map(e=>e.studentId)
  };
}

// ---- Task 03/04: grid render + REFERENCE-sourced dropdowns ----------
const FIELD_COL={category:3,annualFamilyIncome:4,guardianOccupation:5,priorScholarshipStatus:6,persistentStudentId:7,specialCategoryFlag:8};
const CATEGORICAL_FIELDS=["category","priorScholarshipStatus","specialCategoryFlag"];

function referenceOptions(field){
  const uploaded=APP._scholarshipReferenceLists;
  if(uploaded&&uploaded[field]&&uploaded[field].length)return uploaded[field];
  return REFERENCE_LISTS[field]||[];
}

// Native <input list="..."> combo-box (Task 04 §4's preferred approach):
// natively supports both pick-from-list and free typing in one control,
// zero extra UI for the free-text case, no rejection of an out-of-list
// value.
function datalistsHtml(){
  return CATEGORICAL_FIELDS.map(f=>
    `<datalist id="se-dl-${f}">${referenceOptions(f).map(v=>`<option value="${esc(v)}"></option>`).join("")}</datalist>`
  ).join("");
}

// BUG FIX: this used to be near-unvalidated — annualFamilyIncome had only
// min="0" (no upper bound, so e.g. 999999999999 was accepted), the
// categorical fields (category/priorScholarshipStatus/specialCategoryFlag)
// accepted ANY free text since <input list> never enforces datalist
// membership, and persistentStudentId had no length limit at all. Bounds
// below mirror what project-setup.js's own clampNum() already uses for
// the equivalent SETUP-side income field (0–999,999,999), so a value that
// would be rejected there can't sneak in here instead.
const INCOME_MAX = 999999999;
function cellHtml(student,field,missing){
  const val=getScholarshipEditValue(student,field);
  const errCls=missing?" has-error":"";
  const common=`class="se-cell${errCls}" data-input-action="scholarshipCellEdit" data-arg="${esc(student.id)}" data-arg2="${field}"`;
  if(CATEGORICAL_FIELDS.includes(field)){
    return `<input type="text" list="se-dl-${field}" maxlength="60" ${common} value="${esc(val)}">`;
  }
  if(field==="annualFamilyIncome"){
    return `<input type="number" min="0" max="${INCOME_MAX}" step="1" ${common} value="${esc(val)}">`;
  }
  return `<input type="text" maxlength="60" ${common} value="${esc(val)}">`;
}

function renderScholarshipEditGrid(){
  const wrap=document.getElementById("scholarship-table-panel");
  if(!wrap)return;
  const students=APP.students||[];
  const vstate=scholarshipEditValidationState();
  const incompleteIds=new Set(vstate.incompleteStudentIds);
  // Per-student, per-field "is this the field that's actually missing"
  // needs the same engine output the gate uses — cheap to recompute
  // (small N, memoized dashboard cache untouched) rather than a second
  // parallel completeness pass.
  const schemeConfig=buildSchemeConfigForEdit();
  const merged=getScholarshipMergedStudents();
  const engineResults=calculateScholarshipEligibility(merged,schemeConfig);
  const missingByStudent={};
  engineResults.forEach(r=>{ if(!r.dataComplete) missingByStudent[r.studentId]=r.missingFields||[]; });

  const rows=students.map(st=>{
    const missing=missingByStudent[st.id]||[];
    const rowCls=incompleteIds.has(st.id)?" se-row-incomplete":"";
    const cells=["category","annualFamilyIncome","guardianOccupation","priorScholarshipStatus","persistentStudentId","specialCategoryFlag"]
      .map(f=>`<td>${cellHtml(st,f,missing.includes(f))}</td>`).join("");
    return `<tr class="scholarship-edit-row${rowCls}" data-student-row="${esc(st.id)}"><td>${esc(st.id)}</td><td>${esc(st.name)}</td>${cells}</tr>`;
  }).join("");

  const disabled=vstate.allComplete?"":"disabled";
  const gateNote=vstate.allComplete?""
    :`<div class="sw-err" style="margin-top:10px">${esc(srT("scholarship_edit_gate_incomplete",{count:vstate.incompleteStudentIds.length}))}</div>`;

  wrap.innerHTML=`
    ${datalistsHtml()}
    <div class="tbl-wrap"><table class="data-table"><thead><tr>
      <th>${esc(srT("scholarship_dashboard_th_id"))}</th>
      <th>${esc(srT("scholarship_dashboard_th_name"))}</th>
      <th>${esc(srT("scholarship_edit_th_category"))}</th>
      <th>${esc(srT("scholarship_edit_th_income"))}</th>
      <th>${esc(srT("scholarship_edit_th_guardian_occupation"))}</th>
      <th>${esc(srT("scholarship_edit_th_prior_status"))}</th>
      <th>${esc(srT("scholarship_edit_th_persistent_id"))}</th>
      <th>${esc(srT("scholarship_edit_th_special_flag"))}</th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <div style="margin-top:14px;display:flex;justify-content:flex-end">
      <button type="button" class="btn btn-primary" id="scholarship-save-btn" data-action="saveScholarshipEdits" ${disabled}>${esc(srT("scholarship_edit_save_btn"))}</button>
    </div>
    ${gateNote}
  `;
}

// data-input-action="scholarshipCellEdit" handler — inline-actions.js
// calls this on every keystroke (same 'input' delegation every other
// text field in the app already uses). Buffers the edit, then only
// re-renders the one changed cell's error state + the save button's
// disabled state — not the whole grid/table on every keystroke, so
// typing doesn't lose focus/cursor position.
function onScholarshipCellEdit(studentId,field,el){
  setScholarshipEditValue(studentId,field,el.value);
  const vstate=scholarshipEditValidationState();
  const btn=document.getElementById("scholarship-save-btn");
  if(btn)btn.disabled=!vstate.allComplete;
  const row=el.closest("tr.scholarship-edit-row");
  if(row)row.classList.toggle("se-row-incomplete",vstate.incompleteStudentIds.includes(studentId));
}

// ---- Task 07: Update and Download — backup + zip + flush ------------
// Closely follows confirmMergedDownload()'s existing shape (template-
// upload.js): raw pre-edit bytes as the backup (never a re-serialized
// XLSX.write() — that would silently reformat it), one JSZip containing
// both files, one single download/click/revoke, since two separate
// XLSX.writeFile() calls get treated as download spam and the second one
// is frequently blocked by the browser.
function applyEditsToStudentsSheet(wb){
  const nameUC=wb.SheetNames.map(n=>n.trim().toUpperCase());
  const idx=nameUC.indexOf("STUDENTS");
  if(idx===-1)return false;
  const ws=wb.Sheets[wb.SheetNames[idx]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
  const idColUC=0; // column A, per buildStudentsSheet()'s locked header order
  const rowByStudentId={};
  for(let r=1;r<rows.length;r++){
    const id=String((rows[r]||[])[idColUC]||"").trim();
    if(id)rowByStudentId[id]=r;
  }
  Object.keys(_buffer).forEach(studentId=>{
    const r=rowByStudentId[studentId];
    if(r===undefined)return; // edited student not present in this file's STUDENTS sheet — nothing to patch
    const edits=_buffer[studentId];
    Object.keys(edits).forEach(field=>{
      const c=FIELD_COL[field];
      if(c===undefined)return;
      const addr=XLSX.utils.encode_cell({r,c});
      const existing=ws[addr];
      const patched=existing?Object.assign({},existing,{t:"s",v:edits[field]}):{t:"s",v:edits[field]};
      delete patched.w;
      ws[addr]=patched;
    });
  });
  return true;
}

function saveScholarshipEdits(){
  const vstate=scholarshipEditValidationState();
  if(!vstate.allComplete)return; // button should already be disabled — hard-stop regardless
  if(!hasScholarshipPendingEdits()){
    toast(srT("scholarship_edit_nothing_to_save"),"warn");
    return;
  }
  if(!APP.rawWorkbook||!APP._origFileBytes){
    toast(srT("scholarship_edit_no_source_file"),"error");
    return;
  }
  let wb;
  try{
    wb=structuredClone(APP.rawWorkbook);
  }catch(err){
    toast(srT("scholarship_edit_clone_failed"),"error");
    return;
  }
  if(!applyEditsToStudentsSheet(wb)){
    toast(srT("scholarship_edit_no_students_sheet"),"error");
    return;
  }

  const {mainFname:fname,backupFname}=deriveUpdateFilenames(APP._origFileName);
  const zip=new JSZip();
  zip.file(backupFname,APP._origFileBytes);
  zip.file(fname,XLSX.write(wb,{bookType:"xlsx",type:"array"}));
  const zipFname=fname.replace(/\.xlsx$/i,"")+"_with_backup.zip";
  zip.generateAsync({type:"blob"}).then(blob=>{
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;link.download=zipFname;
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
    toast(srT("scholarship_edit_saved_toast",{fname:zipFname}),"success");

    // Fold the just-saved edits into a NEW APP.students array (never
    // mutate the existing one/its member objects) — Task 08's whole
    // premise: this is what lets computeScholarshipData()'s existing
    // array-identity memoization invalidate correctly for free, with no
    // manual cache-bust needed anywhere.
    APP.students=(APP.students||[]).map(st=>{
      const edits=_buffer[st.id];
      return edits?Object.assign({},st,edits):st;
    });
    clearScholarshipEditBuffer();
    renderScholarshipEditGrid();
    // Flow redesign: let the tab bar re-evaluate the unlock state now
    // that APP.students reflects the save — see scholarship-dashboard.js
    // refreshScholarshipTabsAfterDataChange().
    if (typeof window.refreshScholarshipTabsAfterDataChange === "function") window.refreshScholarshipTabsAfterDataChange();
  });
}

export {
  EDIT_FIELDS, clearScholarshipEditBuffer, getScholarshipEditValue,
  getScholarshipMergedStudents, hasScholarshipPendingEdits,
  onScholarshipCellEdit, renderScholarshipEditGrid, saveScholarshipEdits,
  scholarshipEditValidationState, setScholarshipEditValue
};
if(typeof window!=='undefined'){
  window.clearScholarshipEditBuffer=clearScholarshipEditBuffer;
  window.onScholarshipCellEdit=onScholarshipCellEdit;
  window.renderScholarshipEditGrid=renderScholarshipEditGrid;
  window.saveScholarshipEdits=saveScholarshipEdits;
}
