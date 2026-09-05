import { applyCompareModeUI, esc, toast, validateSetup } from '../core/app-utils-init.js';
import { parseStudents, runAnalysis, scrollToEl } from '../bal/common/compute-stats.js';
import { parseStrictMark, parseStrictMaxMark } from '../bal/common/mark-parse.js';
import { collectSetupForm, fillSetupForm, lockUsageMode, setUsageMode, startCompareMode, unlockStep } from './project-setup.js';
import { buildDashboardControlsHtml } from '../ui/common/render-buckets.js';
import { closeModal, gsapModalEntrance, showSampleFiles, updateExportGate } from '../ui/common/render-core.js';
import { i18nLabel, srT } from '../core/render-i18n.js';
import { readFeatureFlags } from '../core/read-feature-flags.js';
import { applyCountryScholarshipGate } from '../core/feature-registry.js';
import { swGoto } from './setup-wizard.js';
// NB-5 (prompt.md §11.2): smart-query-v2-ui.js deleted (zero callers;
// smart-search replaced by Dashboard right-rail per PIB §6d). The
// updateSmartLauncherVisibility() import it used to provide is gone too.
import { APP, updateScholarshipNavVisibility } from '../core/state-nav.js';
import { renderShellLeftRail, renderShellRightRail } from '../core/vs-shell.js';

/* ════ EXCEL TEMPLATE GENERATION ════ */
// Style constants for generateTemplate() — requires xlsx-js-style (see
// top-of-file library note) since stock SheetJS Community can only READ
// cell styles, not write them.
const TPL_STYLE={
  header:{font:{bold:true,sz:11,color:{rgb:"FFFFFF"}},fill:{fgColor:{rgb:"1F3864"}},
    alignment:{vertical:"center",horizontal:"center",wrapText:true},
    border:{top:{style:"thin",color:{rgb:"1F3864"}},bottom:{style:"thin",color:{rgb:"1F3864"}},
      left:{style:"thin",color:{rgb:"1F3864"}},right:{style:"thin",color:{rgb:"1F3864"}}}},
  section:{font:{bold:true,sz:11,color:{rgb:"1F3864"}},fill:{fgColor:{rgb:"D9E2F3"}},
    alignment:{vertical:"center"}},
  label:{font:{color:{rgb:"333333"}},alignment:{vertical:"center"}},
  sample:{font:{color:{rgb:"888888"},italic:true},alignment:{vertical:"center"}},
  // Used by buildTestSheetWithFormulas() for the live-formula Student ID
  // column — deliberately distinct from both `header` (bold/blue) and
  // `sample` (gray-italic placeholder text) so these cells read as
  // "computed, don't overtype" rather than either a header or a
  // fill-me-in placeholder. Subtle light-gray fill, normal (non-italic)
  // text.
  formula:{font:{color:{rgb:"333333"}},fill:{fgColor:{rgb:"F2F2F2"}},alignment:{vertical:"center"}}
};
function colLetter(n){let s="";n++;while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26);}return s;}
// NEW SCHEMA (multi-tab redesign): Excel sheet names can't contain
// \ / ? * [ ] : , can't be blank, can't exceed 31 chars, and must be
// unique within the workbook — a raw test name like "Unit Test 2/26"
// would silently corrupt the file without this.
function safeSheetName(name,usedNames){
  let n=String(name||"Test").replace(/[\\/?*\[\]:]/g,"-").trim().slice(0,31)||"Test";
  let candidate=n,i=2;
  while(usedNames.has(candidate)){
    const suffix=" ("+i+")";
    candidate=n.slice(0,31-suffix.length)+suffix;
    i++;
  }
  usedNames.add(candidate);
  return candidate;
}
// Builds "<Class/Batch><Section>" (e.g. "Sem1", "Class7A") for prefixing
// test-tab names and SETUP's Test N Name in lockstep — same readability
// convention already used across samples/ (see samples/README.md's "Tab
// naming convention"), now applied to templates actually downloaded from
// the live wizard too, not just the static samples. Idempotent: if a
// test's name already starts with this prefix (e.g. re-downloading after
// an earlier "Add Test" round-trip), it's left alone instead of doubling
// up into "Sem1-Sem1-Test 1".
function classPrefixForTabs(){
  const rawClassName=String(APP.setup.className||"");
  const rawSection=String(APP.setup.section||"");
  // Keep the dash (className is expected in "Class-5A" style from the
  // setup-field sanitizer) — previously stripped ALL non-alphanumerics,
  // which silently dropped it and produced "Class5A-Test-1" instead of
  // "Class-5A-Test-1".
  let className=rawClassName.replace(/[^a-zA-Z0-9-]/g,"");
  // Legacy/imported data saved before the sanitizer existed may still be
  // "Class5A" with no dash — insert one at the first letter/digit boundary
  // so old and new data normalize to the same tab-naming convention.
  className=className.replace(/([A-Za-z])(\d)/,"$1-$2");
  let section=rawSection.replace(/[^a-zA-Z0-9]/g,"");
  // Bug found via real uploaded files (Class / Batch "Class 6-B" + Section
  // "B" produced tab name "Class6BB"): if the class name already ends
  // with the section (a very common way people fill in "Class / Batch",
  // e.g. "6-B" or "6B"), appending Section again just duplicates that
  // last bit rather than adding new information — drop it in that case.
  if(section && className.toLowerCase().endsWith(section.toLowerCase())) section="";
  let base=className+(section?"-"+section:"");
  if(!base)base="Class";
  return base.slice(0,18); // leaves room for a reasonably long test name within Excel's 31-char sheet-name limit
}
function applyTabPrefix(tests){
  const prefix=classPrefixForTabs();
  tests.forEach(t=>{if(!t.name.startsWith(prefix+"-"))t.name=prefix+"-"+t.name;});
}
/* Shared by generateTemplate() (fresh workbook) and generateMergedTemplate()
   (existing workbook + new test columns) — both need the exact same SETUP
   tab, built from whatever's currently in APP.setup, so there's a single
   place that defines what that tab looks like. */
function buildSetupSheet(){
  const {subjects,tests,instName,passThreshold,absentAlert,dropAlert}=APP.setup;
  const setupRows=[["MODE",""],["Usage Mode",APP.setup.mode||"institution"],["INSTITUTION",""],["Institution Name",instName],["Type",APP.setup.instType||""],["Location",APP.setup.location||""],["Contact",APP.setup.contact||""],["CLASS",""],["Class / Batch",APP.setup.className],["Section",APP.setup.section||""],["Academic Year",APP.setup.year],["Class Teacher",APP.setup.teacher||""],["SUBJECTS",""]];
  subjects.forEach((s,i)=>setupRows.push(["Subject "+(i+1),s]));
  setupRows.push(["TESTS",""]);
  tests.forEach((t,i)=>{setupRows.push(["Test "+(i+1)+" Name",t.name]);setupRows.push(["Test "+(i+1)+" Date",t.date||""]);
    // subjectsIncluded absent = legacy test saved before the per-test picker
    // existed -> every subject was included, same as current fallback below.
    const included=t.subjectsIncluded||subjects;
    subjects.filter(s=>included.includes(s)).forEach(s=>setupRows.push(["Max Marks - "+s+" (Test "+(i+1)+")",(t.maxMarks&&t.maxMarks[s])||100]));});
  setupRows.push(["Scoring Method",Object.keys(APP.setup.scoring).filter(k=>APP.setup.scoring[k]).join(", ")]);
  setupRows.push(["Pass Threshold %",passThreshold],["Absent Alert Days",absentAlert],["Sharp Drop Alert %",dropAlert]);
  // Task 02: SCHOLARSHIP CRITERIA — always written (schema stable per
  // §24/§26) whether or not the module is enabled; fields below the Enable
  // row are only ACTIVE/required when Enable = Yes, enforced in
  // validateSetupData(), not by omitting them here. No Weightage -
  // Attendance row (superseded — see this task's spec; Attendance is a
  // hard floor only, §25 point 2). Category Quota % carries its
  // "informational only" note in column C, same plain-text-cell pattern as
  // the reference sample file (no real xlsx cell-comment object used
  // anywhere else in this codebase).
  const sch=APP.setup.scholarship||{};
  const yn=v=>v?"Yes":"No";
  setupRows.push(["SCHOLARSHIP CRITERIA",""]);
  setupRows.push(["Enable Scholarship Module",yn(sch.enabled)]);
  setupRows.push(["Scheme Name",sch.schemeName||""]);
  setupRows.push(["Eligibility Type",sch.eligibilityType||""]);
  setupRows.push(["Min Academic Avg %",sch.minAcademicAvg==null?"":sch.minAcademicAvg]);
  setupRows.push(["Max Family Income (INR)",sch.maxFamilyIncome==null?"":sch.maxFamilyIncome]);
  setupRows.push(["No-Fail Rule (Y/N)",yn(sch.noFailRule)]);
  setupRows.push(["Attendance Floor - Max Absent Days (total across tests)",sch.attendanceFloor==null?"":sch.attendanceFloor]);
  setupRows.push(["Category Quota %",sch.categoryQuota==null?"":sch.categoryQuota,srT("scholarship_category_quota_note")]);
  setupRows.push(["Weightage - Academic",sch.weightAcademic==null?60:sch.weightAcademic]);
  setupRows.push(["Weightage - Consistency",sch.weightConsistency==null?20:sch.weightConsistency]);
  setupRows.push(["Weightage - Growth",sch.weightGrowth==null?20:sch.weightGrowth]);
  const SECTION_LABELS=new Set(["MODE","INSTITUTION","CLASS","SUBJECTS","TESTS","SCHOLARSHIP CRITERIA"]);
  const wsSetup=XLSX.utils.aoa_to_sheet(setupRows);
  wsSetup["!cols"]=[{wch:34},{wch:28}];
  wsSetup["!rows"]=setupRows.map(()=>({hpt:20}));
  wsSetup["!views"]=[{state:"frozen",ySplit:1,topLeftCell:"A2",activePane:"bottomLeft"}];
  setupRows.forEach((row,r)=>{
    const isSection=SECTION_LABELS.has(row[0]);
    ["A","B"].forEach(col=>{
      const addr=col+(r+1),cell=wsSetup[addr];if(!cell)return;
      cell.s=isSection?TPL_STYLE.section:TPL_STYLE.label;
    });
  });
  return wsSetup;
}
// prompt-02-nperiod-import-fork.md "Start a new class/semester" fork —
// writes SETUP's repeated "Period N ..." block format (same one
// parseContinuityPeriods()/extractPeriodBlocks() above read) instead of
// buildSetupSheet()'s flat single-period format. `periods` is the FULL
// list — every period being kept (copied through verbatim if the source
// was already multi-period, or reconstructed from the old file's flat
// SETUP if this is the first fork on a legacy single-period file) PLUS
// the new one the user just filled in via the normal Setup form. Scoring
// Config stays flat/global (Pass Threshold etc) rather than per-period —
// parseContinuityPeriods() never reads a per-period scoring block, only
// the flat one, so writing one per period would just be dead data nothing
// reads back.
function buildContinuitySetupSheet(periods){
  const rows=[["MODE",""],["Usage Mode",APP.setup.mode||"institution"],
    ["INSTITUTION",""],["Institution Name",APP.setup.instName],["Type",APP.setup.instType||""],
    ["Location",APP.setup.location||""],["Contact",APP.setup.contact||""],
    ["CONTINUITY",""],["Period Count",periods.length]];
  const sectionLabels=new Set(["MODE","INSTITUTION","CONTINUITY","SCORING CONFIG"]);
  periods.forEach((p,idx)=>{
    const n=idx+1,sec="PERIOD "+n;
    sectionLabels.add(sec);
    rows.push([sec,""]);
    rows.push(["Period "+n+" Label",p.label]);
    rows.push(["Period "+n+" Academic Year / Term",p.year||""]);
    rows.push(["Period "+n+" Teacher / Coordinator",p.teacher||""]);
    p.subjects.forEach((s,si)=>rows.push(["Period "+n+" Subject "+(si+1),s]));
    p.tests.forEach((t,ti)=>{
      rows.push(["Period "+n+" Test "+(ti+1)+" Name",t.name]);
      rows.push(["Period "+n+" Test "+(ti+1)+" Date",t.date||""]);
      const included=t.subjectsIncluded||p.subjects;
      p.subjects.filter(s=>included.includes(s)).forEach(s=>rows.push(["Period "+n+" Max Marks - "+s+" (Test "+(ti+1)+")",(t.maxMarks&&t.maxMarks[s])||100]));
    });
  });
  rows.push(["SCORING CONFIG",""]);
  rows.push(["Scoring Method",Object.keys(APP.setup.scoring).filter(k=>APP.setup.scoring[k]).join(", ")]);
  rows.push(["Pass Threshold %",APP.setup.passThreshold],["Absent Alert Days",APP.setup.absentAlert],["Sharp Drop Alert %",APP.setup.dropAlert]);
  const wsSetup=XLSX.utils.aoa_to_sheet(rows);
  wsSetup["!cols"]=[{wch:34},{wch:28}];
  wsSetup["!rows"]=rows.map(()=>({hpt:20}));
  wsSetup["!views"]=[{state:"frozen",ySplit:1,topLeftCell:"A2",activePane:"bottomLeft"}];
  rows.forEach((row,r)=>{
    const isSection=sectionLabels.has(row[0]);
    ["A","B"].forEach(col=>{
      const addr=col+(r+1),cell=wsSetup[addr];if(!cell)return;
      cell.s=isSection?TPL_STYLE.section:TPL_STYLE.label;
    });
  });
  return wsSetup;
}
function buildStudentsSheet(){
  // Columns 4-9 (Category..Special Category Flag) are the Phase 1
  // scholarship fields — locked order per studin-scholarship-discussion.md
  // §24. All 6 optional/nullable; sample rows leave them blank on purpose
  // (not sample-filled) since they're not part of the core roster identity.
  const hdr=["Student ID","Full Name","Gender","Category","Annual Family Income","Guardian Occupation","Prior Scholarship Status","Persistent Student ID","Special Category Flag"];
  const rows=[hdr];
  // Was "STU001".."STU005" — a user who left these untouched and just
  // filled marks against them got silently-wrong analysis (the "SAMPLE-N"
  // ID + placeholder name here make that obvious in Excel; the actual
  // safety net — auto-skipping these if still untouched on import — is
  // in parseStudents(), js/compute-stats.js, matched against
  // SAMPLE_STUDENT_IDS below).
  for(let i=1;i<=5;i++)rows.push(["SAMPLE-"+i,"⚠ Replace this row — delete or overwrite","M","","","","","",""]);
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"]=[{wch:16},{wch:34},{wch:10},{wch:14},{wch:18},{wch:22},{wch:20},{wch:18},{wch:22}];
  ws["!rows"]=rows.map((_,r)=>({hpt:r===0?32:20}));
  ws["!views"]=[{state:"frozen",ySplit:1,topLeftCell:"A2",activePane:"bottomLeft"}];
  hdr.forEach((_,c)=>{const cell=ws[colLetter(c)+"1"];if(cell)cell.s=TPL_STYLE.header;});
  for(let r=1;r<rows.length;r++)for(let c=0;c<hdr.length;c++){const cell=ws[colLetter(c)+(r+1)];if(cell)cell.s=TPL_STYLE.sample;}
  return ws;
}
// NEW SCHEMA — Tabs 3..N+2: one per test. Student ID + one Marks column
// per subject + Absent Days + Chapter (optional) + Remark (optional).
// Roster fields (Name/Gender) live on STUDENTS only, not repeated here.
function buildTestSheet(test,subjects){
  // Only generate marks columns for subjects this test actually includes
  // (subjectsIncluded, when the Setup UI's per-test picker set it) — a
  // test that excluded a subject shouldn't get a column for it at all.
  const testSubjects=(test.subjectsIncluded&&test.subjectsIncluded.length)?test.subjectsIncluded:subjects;
  const hdr=["Student ID"];
  testSubjects.forEach(s=>hdr.push(s+" Marks"));
  hdr.push("Absent Days","Chapter","Remark");
  const rows=[hdr];
  for(let i=1;i<=5;i++)rows.push(["SAMPLE-"+i,...Array(hdr.length-1).fill("")]);
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"]=hdr.map((_,i)=>({wch:i===0?12:i>=hdr.length-2?24:12}));
  ws["!rows"]=rows.map((_,r)=>({hpt:r===0?32:20}));
  ws["!views"]=[{state:"frozen",xSplit:1,ySplit:1,topLeftCell:colLetter(1)+"2",activePane:"bottomRight"}];
  hdr.forEach((_,c)=>{const cell=ws[colLetter(c)+"1"];if(cell)cell.s=TPL_STYLE.header;});
  for(let r=1;r<rows.length;r++){const cell=ws["A"+(r+1)];if(cell)cell.s=TPL_STYLE.sample;}
  return ws;
}
// Same tab layout as buildTestSheet(), but for the two call sites where a
// real STUDENTS roster already exists (adding a test to an existing class,
// or appending a new period in a continuity workbook) — column A gets a
// live formula pulling the Student ID from STUDENTS!A{row} instead of the
// SAMPLE-N placeholder text, so the teacher doesn't have to retype a
// roster that's already on file. buildTestSheet() itself is untouched and
// still used by generateTemplate(), where there's no real roster yet to
// point a formula at.
// `studentCount` rows get a formula; +5 extra buffer rows beyond that so a
// teacher who adds a couple of students to STUDENTS later still gets
// auto-fill without having to regenerate the template. Buffer rows past
// the real roster resolve to "" via the IF-guard (STUDENTS!A{r}=""), not
// an error or a stray 0.
function buildTestSheetWithFormulas(test,subjects,studentCount){
  const testSubjects=(test.subjectsIncluded&&test.subjectsIncluded.length)?test.subjectsIncluded:subjects;
  const hdr=["Student ID"];
  testSubjects.forEach(s=>hdr.push(s+" Marks"));
  hdr.push("Absent Days","Chapter","Remark");
  const rows=[hdr];
  const totalRows=studentCount+5;
  for(let i=0;i<totalRows;i++)rows.push(["",...Array(hdr.length-1).fill("")]);
  const ws=XLSX.utils.aoa_to_sheet(rows);
  // Overwrite column A of each data row with a live formula in place of
  // the blank string aoa_to_sheet() just wrote there.
  for(let r=0;r<totalRows;r++){
    const rowNum=r+2; // sheet row, 1-indexed, +1 for the header row
    ws["A"+rowNum]={t:"str",f:"IF(STUDENTS!A"+rowNum+"=\"\",\"\",STUDENTS!A"+rowNum+")"};
  }
  ws["!cols"]=hdr.map((_,i)=>({wch:i===0?12:i>=hdr.length-2?24:12}));
  ws["!rows"]=rows.map((_,r)=>({hpt:r===0?32:20}));
  ws["!views"]=[{state:"frozen",xSplit:1,ySplit:1,topLeftCell:colLetter(1)+"2",activePane:"bottomRight"}];
  hdr.forEach((_,c)=>{const cell=ws[colLetter(c)+"1"];if(cell)cell.s=TPL_STYLE.header;});
  for(let r=0;r<totalRows;r++){const cell=ws["A"+(r+2)];if(cell)cell.s=TPL_STYLE.formula;}
  return ws;
}
// NEW SCHEMA — final tab: README, explaining the multi-tab layout since
// this is a genuine change from the old single-sheet format teachers may
// already be used to.
function buildReadmeSheet(){
  const lines=[
    [srT("readme_title")],
    [""],
    [srT("readme_setup_tab")],
    [srT("readme_students_tab")],
    [srT("readme_test_tabs")],
    [""],
    [srT("readme_add_test")],
    [srT("readme_add_test_note")],
  ];
  const ws=XLSX.utils.aoa_to_sheet(lines);
  ws["!cols"]=[{wch:110}];
  return ws;
}
// Task 03: REFERENCE tab — guidance-only value lists for the STUDENTS
// tab's Category / Prior Scholarship Status / Special Category Flag
// columns (Task 01). A dedicated tab, not embedded in SETUP's key-value
// rows, so Phase 2's editable grid can read a clean list without parsing
// mixed config (§36). Never enforced/blocking on its own — the actual
// soft (Warning-style) dropdown wiring lives in
// injectScholarshipDataValidations() below, since xlsx-js-style 1.2.0 has
// no native data-validation write API (confirmed: zero "dataValidation"
// occurrences in its bundle) — Excel data validations are written via
// direct XML injection into the generated .xlsx after XLSX.write().
const REFERENCE_LISTS={
  category:["General","OBC","SC","ST","EWS","Other"],
  priorScholarshipStatus:["None","Fresh Applied","Renewal"],
  specialCategoryFlag:["Disability (specify type)","Single Parent Household","Below Poverty Line","Orphan","Other"],
};
function buildReferenceSheet(){
  const hdr=["Category","Prior Scholarship Status","Special Category Flag"];
  const lists=[REFERENCE_LISTS.category,REFERENCE_LISTS.priorScholarshipStatus,REFERENCE_LISTS.specialCategoryFlag];
  const maxLen=Math.max(...lists.map(l=>l.length));
  const rows=[hdr];
  for(let i=0;i<maxLen;i++)rows.push(lists.map(l=>l[i]||""));
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"]=[{wch:14},{wch:24},{wch:28}];
  ws["!rows"]=rows.map((_,r)=>({hpt:r===0?32:20}));
  hdr.forEach((_,c)=>{const cell=ws[colLetter(c)+"1"];if(cell)cell.s=TPL_STYLE.header;});
  for(let r=1;r<rows.length;r++)for(let c=0;c<hdr.length;c++){const cell=ws[colLetter(c)+(r+1)];if(cell)cell.s=TPL_STYLE.sample;}
  return ws;
}
// Excel column letters of the three STUDENTS columns REFERENCE's lists
// apply to (see buildStudentsSheet(): D=Category, G=Prior Scholarship
// Status, I=Special Category Flag). Range end row 1048576 = full column,
// same idiom Excel itself uses for a growable list, not a fixed row cap.
function scholarshipDataValidationSpecs(){
  const rangeEnd=1048576;
  const colRange=col=>{const n=REFERENCE_LISTS[col.key].length+1;return "REFERENCE!$"+col.refCol+"$2:$"+col.refCol+"$"+n;};
  const specs=[
    {sqref:"D2:D"+rangeEnd,key:"category",refCol:"A"},
    {sqref:"G2:G"+rangeEnd,key:"priorScholarshipStatus",refCol:"B"},
    {sqref:"I2:I"+rangeEnd,key:"specialCategoryFlag",refCol:"C"},
  ];
  return specs.map(s=>({sqref:s.sqref,formula1:colRange(s)}));
}
// Injects genuine Excel data-validation XML into the STUDENTS sheet of an
// already-built workbook's raw .xlsx bytes — the only way to get real
// dropdowns out of xlsx-js-style (see comment above buildReferenceSheet).
// errorStyle="warning" (not the Excel default "stop") is what makes this
// non-blocking: Excel still shows the dropdown/suggestion, but typing a
// value not on the list pops a Warning the user can dismiss and keep,
// never a hard block — required by §6 (schools whose categories don't
// match this list must still be able to type their own).
// Returns a Promise<Uint8Array> — the patched .xlsx bytes.
function injectScholarshipDataValidations(wbBytes){
  const specs=scholarshipDataValidationSpecs();
  return JSZip.loadAsync(wbBytes).then(zip=>
    zip.file("xl/workbook.xml").async("string").then(wbXml=>{
      const m=new RegExp('<sheet name="STUDENTS"[^>]*r:id="(rId\\d+)"').exec(wbXml);
      if(!m)return zip; // no STUDENTS sheet (shouldn't happen) — degrade to unmodified file rather than throw
      const rId=m[1];
      return zip.file("xl/_rels/workbook.xml.rels").async("string").then(relsXml=>{
        const rm=new RegExp('<Relationship Id="'+rId+'"[^>]*Target="([^"]+)"').exec(relsXml);
        if(!rm)return zip;
        const target="xl/"+rm[1];
        return zip.file(target).async("string").then(sheetXml=>{
          const dvXml='<dataValidations count="'+specs.length+'">'+
            specs.map(s=>'<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="warning" sqref="'+s.sqref+'"><formula1>'+s.formula1+'</formula1></dataValidation>').join("")+
            '</dataValidations>';
          // Schema order (CT_Worksheet): dataValidations must come before
          // ignoredErrors (and hyperlinks/printOptions/pageMargins etc) if
          // present, else Excel/LibreOffice will flag the file for repair.
          let newXml;
          if(sheetXml.indexOf("<ignoredErrors")!==-1)newXml=sheetXml.replace("<ignoredErrors",dvXml+"<ignoredErrors");
          else newXml=sheetXml.replace("</worksheet>",dvXml+"</worksheet>");
          zip.file(target,newXml);
          return zip;
        });
      });
    })
  ).then(zip=>zip.generateAsync({type:"uint8array"})); // BUG FIX: "array" gave plain JS Array (Blob stringifies it via comma-join → corrupt file); "uint8array" gives real binary bytes
}
// Task 03: write+download path for a workbook that needs the REFERENCE
// dropdown validation injected (see injectScholarshipDataValidations()
// above). XLSX.writeFile() can't be used here since the validation only
// exists once we patch the raw zip bytes post-write — same manual
// Blob+<a> download trigger already used by generateBulkSectionTemplates()
// below, just for a single file instead of a zip.
// Scoped to generateTemplate()'s fresh-template path only (this task's
// spec + test step 5) — generateMergedTemplate()/
// generateContinuityAppendTemplate()/generateBulkSectionTemplates() keep
// using plain XLSX.writeFile()/XLSX.write() untouched, out of scope here.
function downloadWorkbookWithScholarshipValidation(wb,fname,onDone){
  const bytes=XLSX.write(wb,{bookType:"xlsx",type:"array"});
  injectScholarshipDataValidations(bytes).then(patchedBytes=>{
    const blob=new Blob([patchedBytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;link.download=fname;
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
    if(onDone)onDone();
  }).catch(err=>{
    // Injection failure (unexpected zip/XML shape) must never block the
    // teacher from getting a usable file — fall back to the plain
    // (dropdown-less) workbook rather than losing the download entirely.
    console.error("Scholarship dropdown injection failed, falling back to plain template:",err);
    XLSX.writeFile(wb,fname);
    if(onDone)onDone();
  });
}
function generateTemplate(){
  collectSetupForm();
  if(!APP.setup.instName){toast(APP.setup.mode==="individual"?srT("val_fill_student_name_first"):srT("val_fill_institution_name_first"),"warn");return;}
  if(!APP.setup.subjects.length){toast(srT("val_add_one_subject"),"warn");return;}
  if(!APP.setup.tests.length){toast(srT("val_add_one_test"),"warn");return;}
  // If a previously-filled workbook was loaded via "Update Existing Sheet",
  // append new-test columns onto its real rows instead of building a fresh
  // 5-sample-row workbook that would silently discard those marks.
  if(APP.mergeMode&&APP.mergeSource){
    if(APP.mergeForkChoice==="new_period"){generateContinuityAppendTemplate();return;}
    generateMergedTemplate();return;
  }
  // Bulk sections — a school with 7A/7B/7C shouldn't need to fill this
  // form 3 times. Scoped to fresh template generation only (not merge
  // mode) — see the checkbox in index.html's Class/Batch step.
  const bulkOn=document.getElementById("bulk-sections-toggle");
  if(bulkOn&&bulkOn.checked){generateBulkSectionTemplates();return;}
  applyTabPrefix(APP.setup.tests);
  const wb=XLSX.utils.book_new();
  const {subjects,tests,instName}=APP.setup;
  XLSX.utils.book_append_sheet(wb,buildSetupSheet(),"SETUP");
  XLSX.utils.book_append_sheet(wb,buildStudentsSheet(),"STUDENTS");
  const usedNames=new Set(["SETUP","STUDENTS"]);
  tests.forEach(t=>{
    const sheetName=safeSheetName(t.name,usedNames);
    XLSX.utils.book_append_sheet(wb,buildTestSheet(t,subjects),sheetName);
  });
  usedNames.add("README");
  XLSX.utils.book_append_sheet(wb,buildReadmeSheet(),"README");
  usedNames.add("REFERENCE");
  XLSX.utils.book_append_sheet(wb,buildReferenceSheet(),"REFERENCE");
  const fname=(instName+" "+APP.setup.className+" "+APP.setup.year).replace(/[^\w\s-]/g,"").replace(/\s+/g,"_")+".xlsx";
  downloadWorkbookWithScholarshipValidation(wb,fname,()=>{
    toast(srT("toast_template_downloaded",{fname:fname}),"success");
    // BUG FIX (screenshot review): used to auto-reload to Home 900ms later
    // unconditionally, silently erasing a correctly-filled form even when
    // the teacher still needed to revisit/correct it. Now ask instead — see
    // showPostDownloadPrompt().
    setTimeout(()=>showPostDownloadPrompt(),400);
  });
}
// BUG FIX (screenshot review): auto-reloading straight to Home right after
// a download silently erased a correctly-filled-in form — if the teacher
// realizes a subject/mark is wrong, or wants to add one more test, that
// state is just gone. Instead of location.reload() firing unconditionally,
// ask: go to Home (clears the form, same as the old behavior) or Stay Here
// (keep everything exactly as filled, so they can revisit/correct and
// generate again). No timeout, no auto-navigation — the user decides.
function showPostDownloadPrompt(){
  $("#modal-content").html(`
    <h3 style="font-family:var(--font-display);font-size:17px;margin-bottom:8px">✔ ${esc(srT("post_download_title"))}</h3>
    <div style="font-size:12.5px;color:var(--c-text2);margin-bottom:16px">${esc(srT("post_download_desc"))}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-secondary btn-sm" data-action="stayAfterDownload">${esc(srT("btn_stay_here"))}</button>
      <button class="btn btn-success btn-sm" data-action="goHomeAfterDownload">${esc(srT("btn_go_home"))}</button>
    </div>`);
  gsapModalEntrance();
  setTimeout(()=>{const f=document.querySelector('#modal-overlay.open .modal-close');if(f)f.focus();},0);
}
function goHomeAfterDownload(){
  if(typeof closeModal==="function")closeModal();
  location.reload();
}
function stayAfterDownload(){
  if(typeof closeModal==="function")closeModal();
  // Deliberately a no-op beyond closing the modal — the form/state is
  // untouched so the user can keep editing right where they left off.
}
// Task 02: Scholarship Criteria opt-in gate — same show/hide pattern as
// toggleBulkSectionsUI() above. Enable = No/blank leaves the fields hidden
// and non-required; nothing else in the app reacts to this until Task 04.
function toggleScholarshipUI(checked){
  const el=document.getElementById("scholarship-fields");
  if(el)el.style.display=checked?"":"none";
  // validateScholarshipCriteria() (below) already clears every scholarship
  // error (including weightage) when unchecked, and re-checks everything
  // when checked — supersedes the old direct validateScholarshipWeightage()
  // call, which only ever covered the 3 weightage fields.
  validateScholarshipCriteria();
}
// Weightage - Academic/Consistency/Growth must sum to 100 when the module
// is enabled (§26). Decision (Task 02 step 1): blocking, not just a
// warning — matches how this codebase already treats other values whose
// invalidity would corrupt a downstream calculation (invalid Max Marks,
// duplicate Subject/Test names in validateSetupData() below), rather than
// the softer "not required" class of issue (missing Teacher, missing Pass
// Threshold). A non-100 split would silently mis-weight every student's
// scholarship score with no visible sign anything was wrong.
function validateScholarshipWeightage(){
  const errEl=document.getElementById("err-scholarship-weightage");
  if(!$("#scholarship-enable").is(":checked")){if(errEl)errEl.style.display="none";return true;}
  const a=parseInt($("#scholarship-weightage-academic").val())||0;
  const c=parseInt($("#scholarship-weightage-consistency").val())||0;
  const g=parseInt($("#scholarship-weightage-growth").val())||0;
  const sum=a+c+g;
  if(sum!==100){
    if(errEl){errEl.textContent=srT("scholarship_weightage_sum_error",{sum:sum});errEl.style.display="";}
    return false;
  }
  if(errEl)errEl.style.display="none";
  return true;
}
// BUG FIX (3-scenario spec — Setup-first flow): the Scholarship Criteria
// form (index.html #scholarship-fields) had no live/gating validation of
// its own beyond the three weightage fields above — Scheme Name,
// Eligibility Type, Min Academic Avg, Max Family Income, Attendance Floor
// and Category Quota could all be left blank (or garbage) with nothing
// stopping Setup's wizard "Next" button. The only place any of this was
// actually checked was validateSetupData() below, AFTER the admin had
// already downloaded a template, filled it offline, and re-uploaded it —
// far too late to catch a typo or a skipped field. This mirrors that same
// function's required-field list (same fields, same "required when
// enabled" rule, same scholarship_required_error/scholarship_weightage_
// sum_error messages) so the two can never disagree about what's valid,
// but runs live against the DOM the moment the admin is filling the form
// in Setup, with inline per-field errors instead of a single sheet-level
// error list. Wired into swValidateStep(3) (setup-wizard.js) so "Next"
// is blocked, exactly like the min-max-marks/dupe-name checks elsewhere.
function validateScholarshipCriteria(){
  const fieldIds=["scheme-name","eligibility-type","min-academic-avg","max-family-income","attendance-floor","category-quota"];
  const setErr=(id,msg)=>{
    const el=document.getElementById("err-scholarship-"+id);
    if(el){el.textContent=msg||"";el.style.display=msg?"":"none";}
    const input=document.getElementById("scholarship-"+id);
    if(input)input.style.borderColor=msg?"var(--c-danger)":"";
  };
  if(!$("#scholarship-enable").is(":checked")){
    fieldIds.forEach(id=>setErr(id,""));
    return validateScholarshipWeightage();
  }
  let ok=true;
  // Scheme Name: required, length-capped (matches collectSetupForm()'s
  // own FIELD_MAX=120 elsewhere, tightened to 80 here since this is a
  // short scheme label, not a free-text field), and blocked on the same
  // handful of characters that would break HTML attributes/markup if this
  // string ever ended up somewhere not already run through esc() — not a
  // narrow allow-list, since institution/scheme names legitimately use
  // every one of the app's 13 supported scripts.
  const schemeName=$("#scholarship-scheme-name").val().trim();
  if(!schemeName){
    setErr("scheme-name",srT("scholarship_required_error",{field:srT("scholarship_scheme_name_label")}));
    ok=false;
  }else if(schemeName.length>80){
    setErr("scheme-name",srT("scholarship_scheme_name_too_long",{max:80}));
    ok=false;
  }else if(/[<>{}`]/.test(schemeName)){
    setErr("scheme-name",srT("scholarship_scheme_name_invalid_chars"));
    ok=false;
  }else setErr("scheme-name","");

  const eligibilityType=$("#scholarship-eligibility-type").val();
  if(!eligibilityType){
    setErr("eligibility-type",srT("scholarship_required_error",{field:srT("scholarship_eligibility_type_label")}));
    ok=false;
  }else setErr("eligibility-type","");

  // Numeric fields: required-when-enabled (matches validateSetupData()),
  // and each range-checked against the same min/max the <input> already
  // advertises via its HTML attributes — those attributes are a visual
  // hint only, not a hard browser guarantee, so a pasted out-of-range or
  // non-numeric value needs its own check here too.
  const numField=(id,label,min,max)=>{
    const raw=$("#scholarship-"+id).val();
    if(raw===""||raw===null||raw===undefined){
      setErr(id,srT("scholarship_required_error",{field:srT(label)}));
      ok=false;
      return;
    }
    const n=parseFloat(raw);
    if(isNaN(n)||n<min||n>max){
      setErr(id,srT("scholarship_field_out_of_range",{min:min,max:max}));
      ok=false;
      return;
    }
    setErr(id,"");
  };
  numField("min-academic-avg","scholarship_min_academic_avg_label",0,100);
  numField("max-family-income","scholarship_max_family_income_label",0,999999999);
  numField("attendance-floor","scholarship_attendance_floor_label",0,365);
  numField("category-quota","scholarship_category_quota_label",0,100);

  if(!validateScholarshipWeightage())ok=false;
  return ok;
}
function toggleBulkSectionsUI(checked){
  const el=document.getElementById("bulk-sections-fields");
  if(el)el.style.display=checked?"":"none";
  const err=document.getElementById("err-bulk-sections");
  if(err)err.style.display="none";
  // Bulk mode replaces the single Section field's role — hide it rather
  // than leaving two conflicting "which section?" inputs on screen at
  // once. #class-section's value is simply unused while bulk is on.
  const singleGroup=document.getElementById("class-section-group");
  if(singleGroup)singleGroup.style.display=checked?"none":"";
}
// Bulk sections (e.g. Class 7 A/B/C, one Setup form, one ZIP of N files —
// see the checkbox in index.html's Class/Batch step). Same Institution/
// Class/Batch/Subjects/Tests/Scoring/Teacher for every file (A3 answer:
// one shared, editable Teacher field, no per-section override UI — if a
// section genuinely needs a different teacher, edit that file's SETUP
// tab after generating); only Section differs, and each file's test tabs
// get their OWN correctly-prefixed names (Class7A-Test1 vs Class7B-Test1),
// never sharing mutated state between sections.
function generateBulkSectionTemplates(){
  const raw=(document.getElementById("bulk-sections-list")||{}).value||"";
  const sectionNames=[...new Set(raw.split(",").map(s=>s.trim()).filter(Boolean))];
  const errEl=document.getElementById("err-bulk-sections");
  if(sectionNames.length<2){
    if(errEl)errEl.style.display="";
    toast(srT("val_bulk_sections_need_two"),"warn");
    return;
  }
  if(errEl)errEl.style.display="none";
  if(!APP.setup.instName){toast(APP.setup.mode==="individual"?srT("val_fill_student_name_first"):srT("val_fill_institution_name_first"),"warn");return;}
  if(!APP.setup.subjects.length){toast(srT("val_add_one_subject"),"warn");return;}
  if(!APP.setup.tests.length){toast(srT("val_add_one_test"),"warn");return;}
  // Pristine, unprefixed snapshot — each section clones from THIS, never
  // from another section's already-prefixed tests (applyTabPrefix() is
  // only idempotent against ITS OWN prefix; feeding it an already-
  // prefixed name from a DIFFERENT section would double-prefix instead
  // of correctly re-prefixing).
  const origTests=APP.setup.tests.map(t=>({name:t.name,date:t.date||"",maxMarks:Object.assign({},t.maxMarks)}));
  const origSection=APP.setup.section;
  const zip=new JSZip();
  sectionNames.forEach(sectionName=>{
    APP.setup.section=sectionName;
    const sectionTests=origTests.map(t=>({name:t.name,date:t.date,maxMarks:Object.assign({},t.maxMarks)}));
    applyTabPrefix(sectionTests);
    APP.setup.tests=sectionTests; // buildSetupSheet()/buildTestSheet() read APP.setup.tests directly
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,buildSetupSheet(),"SETUP");
    XLSX.utils.book_append_sheet(wb,buildStudentsSheet(),"STUDENTS");
    const usedNames=new Set(["SETUP","STUDENTS"]);
    sectionTests.forEach(t=>{
      const sheetName=safeSheetName(t.name,usedNames);
      XLSX.utils.book_append_sheet(wb,buildTestSheet(t,APP.setup.subjects),sheetName);
    });
    usedNames.add("README");
    XLSX.utils.book_append_sheet(wb,buildReadmeSheet(),"README");
    const fname=(APP.setup.instName+" "+APP.setup.className+sectionName+" "+APP.setup.year).replace(/[^\w\s-]/g,"").replace(/\s+/g,"_")+".xlsx";
    zip.file(fname,XLSX.write(wb,{bookType:"xlsx",type:"array"}));
  });
  APP.setup.section=origSection;
  APP.setup.tests=origTests; // restore the live form to its pristine, unprefixed state
  const zipFname=(APP.setup.instName+"_"+APP.setup.className+"_AllSections_TEMPLATES_"+timestampTag()).replace(/[^\w-]/g,"_")+".zip";
  zip.generateAsync({type:"blob"}).then(blob=>{
    const url=URL.createObjectURL(blob);
    const link=document.createElement("a");
    link.href=url;link.download=zipFname;
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),4000);
    toast(srT("toast_bulk_templates_downloaded",{n:sectionNames.length,fname:zipFname}),"success");
    // BUG FIX (screenshot review): same reasoning as generateTemplate() —
    // ask before wiping the form instead of auto-reloading.
    setTimeout(()=>showPostDownloadPrompt(),400);
  });
}

/* ════ UPDATE EXISTING SHEET (add a new test, keep old marks) ════
   Loads an already-filled workbook (e.g. the one with Test 1 marks in it),
   reads its real MARKS+CONTEXT rows verbatim (not through parseStudents —
   we want the untouched cell values, including formatting quirks, so nothing
   is silently reinterpreted), and auto-fills the Setup form from its SETUP
   tab so the teacher only has to click "Add Test" for the new one(s) before
   re-downloading. See generateMergedTemplate() for the actual merge, and
   confirmMergedDownload() for the pre-download safety check. */
function handleUpdateUpload(input){
  const file=input.files[0];if(!file)return;
  const fileErr=validateUploadFile(file,["xlsx","xls"]);
  if(fileErr){toast(fileErr,"error");input.value="";return;}
  const r=new FileReader();
  r.onload=e=>{
    try{loadMergeSourceFromArrayBuffer(e.target.result,file.name);}
    catch(err){toast(srT("val_error_reading_file",{msg:err.message}),"error");}
    input.value="";
  };
  r.readAsArrayBuffer(file);
}
/* ════════════════════════════════════════════════════════════════════
   OLD SINGLE-SHEET SCHEMA — loadMergeSourceFromArrayBuffer()
   Kept commented out for reference/safety per explicit request. Delete
   once the new multi-tab version below has been confirmed working.
   ════════════════════════════════════════════════════════════════════
function loadMergeSourceFromArrayBuffer_OLD(arrayBuffer,fileName){
  const wb=XLSX.read(new Uint8Array(arrayBuffer),{type:"array"});
  parseWorkbookSheets(wb);
  const markKey=Object.keys(APP.rawData).find(k=>k.includes("MARK")&&k.includes("CONTEXT"))||Object.keys(APP.rawData).find(k=>k.includes("MARK"));
  const rawArr=markKey?APP.rawData["_arr_"+markKey]:null;
  const isIndividual=APP.setup.mode==="individual";
  if(!rawArr||!rawArr.length){toast(isIndividual?"We couldn't read your data from that file — make sure you're uploading the same Excel file you downloaded from this app earlier.":"Couldn't find a MARKS+CONTEXT tab in that file.","error");return false;}
  const header=(rawArr[0]||[]).map(h=>h===null||h===undefined?"":String(h).trim());
  if(!header.some(h=>h==="Student ID")){toast(isIndividual?"That doesn't look like a file downloaded from this app — please upload the same Excel file you filled in earlier, not a different one.":"That file's MARKS+CONTEXT tab doesn't look like a Student Insight sheet (no 'Student ID' column found) — can't safely merge into it.","error");return false;}
  const dataRows=rawArr.slice(1)
    .filter(row=>row&&row.some(v=>v!==null&&v!==undefined&&v!==""))
    .map(row=>header.map((_,i)=>{const v=row[i];return v===null||v===undefined?"":v;}));
  if(!dataRows.length){toast(isIndividual?"That file doesn't have any filled-in rows yet — nothing to bring forward. Use Download Template to start fresh instead.":"That sheet has a header but no student rows yet — nothing to preserve. Use a fresh Download Template instead.","warn");return false;}
  const idCol=header.indexOf("Student ID");
  const seenIds={};const dupeIds=[];
  dataRows.forEach(row=>{const id=String(row[idCol]||"").trim().toUpperCase();if(!id)return;if(seenIds[id])dupeIds.push(row[idCol]);seenIds[id]=true;});
  const origTestNames=header.filter(h=>/ - Absent Days$/.test(h)||/ — Absent Days$/.test(h)).map(h=>h.replace(/ [-—] Absent Days$/,""));
  APP.mergeSource={header,rows:dataRows,sourceFileName:fileName,origTestNames,
    origSubjects:(APP.setup.subjects||[]).slice(), dupeIds:[...new Set(dupeIds)]};
  APP.mergeMode=true;
  autoInferSetup();
  APP.mergeSource.origSubjects=(APP.setup.subjects||[]).slice();
  const testNames=(APP.setup.tests||[]).map(t=>t.name).join(", ")||"(none detected)";
  let bannerHtml=`Loaded <b>${esc(fileName)}</b> — <b>${dataRows.length}</b> student row(s), existing test(s): <b>${esc(testNames)}</b>. Now click <b>✚ Add Test</b> below for Test 2 (or Test 3), then use Update & Download.`;
  if(APP.mergeSource.dupeIds.length){
    bannerHtml+=`<div style="margin-top:6px;color:#8b1a1a">⚠ Duplicate Student ID(s) already in this file: ${esc(APP.mergeSource.dupeIds.join(", "))}.</div>`;
  }
  $("#merge-banner-text").html(bannerHtml);
  $("#merge-banner").show();
  toast(srT("val_existing_sheet_loaded"),"success");
  APP.setupCard1Choice='update';
  if(typeof swGoto==="function") swGoto(2);
  return true;
}
════════════════════════════════════════════════════════════════════ */

// NEW SCHEMA (multi-tab redesign): the workbook now carries SETUP,
// STUDENTS (roster: ID/Name/Gender), one tab per test, and README —
// instead of diffing/appending columns on one flat sheet, an "update" is
// now literally "keep every existing tab byte-for-byte, add new blank
// test tab(s) for whatever's new". Reuses parseWorkbookSheets() (already
// schema-agnostic — no changes needed there) and autoInferSetup() (reads
// the SETUP tab, also unchanged) as-is.
function loadMergeSourceFromArrayBuffer(arrayBuffer,fileName){
  const wb=XLSX.read(new Uint8Array(arrayBuffer),{type:"array"});
  parseWorkbookSheets(wb);
  const isIndividual=APP.setup.mode==="individual";
  const sheetNamesUpper=wb.SheetNames.map(n=>n.toUpperCase().trim());
  if(!sheetNamesUpper.includes("SETUP")||!sheetNamesUpper.includes("STUDENTS")){
    toast(isIndividual?srT("val_not_app_file_individual"):srT("val_missing_setup_students_tabs"),"error");
    return false;
  }
  const studentsSheetName=wb.SheetNames[sheetNamesUpper.indexOf("STUDENTS")];
  const studentsArr=APP.rawData["_arr_"+studentsSheetName]||[];
  const studentsHeader=(studentsArr[0]||[]).map(h=>h===null||h===undefined?"":String(h).trim());
  if(!studentsHeader.some(h=>h==="Student ID")){
    toast(srT("val_students_tab_no_id_col"),"error");
    return false;
  }
  const studentsRows=studentsArr.slice(1).filter(row=>row&&row.some(v=>v!==null&&v!==undefined&&v!==""));
  if(!studentsRows.length){
    toast(isIndividual?srT("val_students_tab_empty_individual"):srT("val_students_tab_empty"),"warn");
    return false;
  }
  // Duplicate-ID check now lives on the STUDENTS tab, since that's the
  // single source of student identity in the new schema (test tabs no
  // longer carry Name/Gender at all).
  const idCol=studentsHeader.indexOf("Student ID");
  const seenIds={};const dupeIds=[];
  studentsRows.forEach(row=>{const id=String(row[idCol]||"").trim().toUpperCase();if(!id)return;if(seenIds[id])dupeIds.push(row[idCol]);seenIds[id]=true;});
  // Every sheet that isn't SETUP/STUDENTS/README is treated as a test tab
  // — its sheet name IS the test name (that's exactly what generateTemplate()
  // writes via safeSheetName()). autoInferSetup() below reads the *canonical*
  // test names from the SETUP tab, which is what APP.setup.tests ends up
  // holding; origTestSheetNames here is what actually exists as tabs right
  // now, used to detect which of those are genuinely new further down.
  const reservedUpper=new Set(["SETUP","STUDENTS","README"]);
  const origTestSheetNames=wb.SheetNames.filter(n=>!reservedUpper.has(n.toUpperCase().trim()));
  APP.mergeSource={
    workbook:wb, // the real parsed workbook — existing tabs get copied through untouched, not re-diffed row-by-row
    // BUG FIX (backup file loses all formatting): the backup download used
    // to be XLSX.write(workbook) of this same parsed `wb` — but XLSX.read()
    // here doesn't preserve original cell styles (fills/bold/borders), so
    // every re-serialized "backup" came out completely unstyled even though
    // the original upload was fine. Stash the untouched original bytes so
    // the backup can be the literal source file, not a lossy round-trip
    // through the parser.
    origArrayBuffer:arrayBuffer,
    studentsSheetName,studentsHeader,studentsRows,
    origTestSheetNames,
    sourceFileName:fileName,
    origSubjects:(APP.setup.subjects||[]).slice(),
    dupeIds:[...new Set(dupeIds)],
    origSetupKv:buildSetupKv(APP.rawData["SETUP"]||[]), // raw SETUP kv, BEFORE autoInferSetup()/the Setup form can touch it — the "Start a new class/semester" fork needs the untouched original to reconstruct/copy-through old period(s)
  };
  // prompt-02-nperiod-import-fork.md: "ask exactly one question, only at
  // that moment, never upfront" — asked HERE, before autoInferSetup() pre-
  // fills the Setup form with the old file's values, per the product
  // decision this was built against (fork question comes before the
  // teacher sees/touches the form at all).
  renderMergeForkModal();
  return true;
}
// Called once the fork modal's choice is made (chooseMergeFork below).
// This is everything loadMergeSourceFromArrayBuffer used to do
// unconditionally after building APP.mergeSource — unchanged for the
// "Add a test" choice; the "Start a new class/semester" choice needs the
// exact same Setup-form pre-fill (A2: "keep the values same" as the
// editable starting point), so both paths share this.
function continueLoadMergeSource(){
  const src=APP.mergeSource;if(!src)return;
  APP.mergeMode=true;
  autoInferSetup(); // fills subjects/tests/institution form from the file's SETUP tab (unchanged function)
  APP.mergeSource.origSubjects=(APP.setup.subjects||[]).slice();
  // Snapshot of the OLD (pre-edit) period's full data — needed by
  // generateContinuityAppendTemplate() to reconstruct Period 1 verbatim
  // when the source is a legacy single-period file (no existing "Period
  // N ..." blocks to copy through). Deep-enough copy: tests array holds
  // its own maxMarks objects, not shared references the user's later
  // form edits could mutate out from under this snapshot.
  APP.mergeSource.origPeriodSnapshot={
    label:APP.setup.className||"",section:APP.setup.section||"",year:APP.setup.year||"",
    teacher:APP.setup.teacher||"",subjects:(APP.setup.subjects||[]).slice(),
    tests:(APP.setup.tests||[]).map(t=>({name:t.name,date:t.date||"",maxMarks:Object.assign({},t.maxMarks)})),
  };
  // prompt-02-nperiod-import-fork.md: "new subjects/tests/scoring, since a
  // new period is a new subject set by definition — do not try to reuse
  // old subjects." Institution Name/Class-Batch/Section/Teacher/Year stay
  // pre-filled (A2 — legitimately often unchanged, just needs editing/
  // validating), but Subjects/Tests are cleared to force a genuinely
  // fresh start. Bug found via screenshot: leaving the OLD period's 4
  // tests sitting pre-filled meant a user who only meant to add ONE new
  // test (clicked ✚ Add Test, typed it, didn't think to also delete the
  // 3 old ones still shown) got all 4 silently created as new, empty
  // tabs for the new period. fillSetupForm() re-called so the Setup
  // form UI actually reflects the now-empty Subjects/Tests, not just
  // the underlying APP.setup state.
  if(APP.mergeForkChoice==="new_period"){
    APP.setup.subjects=[];
    APP.setup.tests=[];
    fillSetupForm(APP.setup);
  }
  const testNames=src.origTestSheetNames.join(", ")||"(none detected)";
  let bannerHtml=srT("merge_banner_loaded",{fileName:esc(src.sourceFileName),count:src.studentsRows.length,tests:esc(testNames)})+` <b><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-17'/></svg> `+esc(srT("merge_update_download"))+`</b> `+esc(srT("merge_banner_tail"));
  if(APP.mergeForkChoice==="new_period"){
    bannerHtml=srT("merge_fork_new_period_banner",{fileName:esc(src.sourceFileName),count:src.studentsRows.length})||bannerHtml;
  }
  if(src.dupeIds.length){
    bannerHtml+=`<div style="margin-top:6px;color:#8b1a1a">⚠ `+esc(srT("val_dupe_ids_students_fix",{ids:esc(src.dupeIds.join(", "))}))+`</div>`;
  }
  $("#merge-banner-text").html(bannerHtml);
  $("#merge-banner").show();
  $("#btn-download-template").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-17'/></svg> Update & Download").prop("disabled",false).css({opacity:1,cursor:"pointer"}).addClass("btn-glow");
  $("#btn-load-existing").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-08'/></svg> "+i18nLabel("setup_btn_load_different","Load a Different Sheet"));
  toast(srT("toast_existing_sheet_loaded"),"success");
  APP.setupCard1Choice='update';
  // BUG FIX (screenshot review): used to land on step 2 (About), forcing
  // the teacher to click Next through 2 and 3 to reach step 4 where ✚ Add
  // Test / Update & Download actually live — even though autoInferSetup()
  // above already filled steps 2 and 3 from the uploaded file's SETUP tab.
  // Go straight to step 4; Back still works normally if they want to
  // review/correct Institution or Class/Batch details first.
  if(typeof swGoto==="function") swGoto(4);
  return true;
}
function cancelMergeMode(){
  APP.mergeMode=false;APP.mergeSource=null;APP._pendingMerge=null;APP.mergeForkChoice=null;
  $("#merge-banner").hide();
  $("#btn-download-template").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-22'/></svg> "+i18nLabel("setup_btn_download_template","Download Template"));
  $("#btn-load-existing").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-08'/></svg> "+i18nLabel("setup_btn_load_existing","Load Existing Filled Sheet"));
  validateSetup();
  toast(srT("toast_merge_cancelled"),"info");
}
// yyyyMMdd_HHmm in local time, for collision-proof, always-newest-sorts-last
// filenames — repeated updates (Test 2 today, Test 3 next month) never
// overwrite or get silently "(1)"-renamed by the browser's own download manager.
function timestampTag(){
  const d=new Date(),p=n=>String(n).padStart(2,"0");
  return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+"_"+p(d.getHours())+p(d.getMinutes());
}
/* ════════════════════════════════════════════════════════════════════
   OLD SINGLE-SHEET SCHEMA — generateMergedTemplate()
   Kept commented out for reference/safety per explicit request. Delete
   once the new multi-tab version below has been confirmed working.
   ════════════════════════════════════════════════════════════════════
function generateMergedTemplate_OLD(){
  const {subjects,tests}=APP.setup;
  const src=APP.mergeSource;
  const origHasTest=name=>src.header.some(h=>h.startsWith(name+" - ")||h.startsWith(name+" — "));
  const newTests=tests.filter(t=>!origHasTest(t.name));
  if(!newTests.length){
    toast(srT("val_no_new_test_found"),"warn");
    return;
  }
  const missingOrigTests=(src.origTestNames||[]).filter(n=>!tests.some(t=>t.name===n));
  const subjectsChanged=(()=>{
    const a=[...(src.origSubjects||[])].map(s=>s.toLowerCase()).sort();
    const b=[...subjects].map(s=>s.toLowerCase()).sort();
    return a.length!==b.length||a.some((v,i)=>v!==b[i]);
  })();
  const appendHeader=[];
  newTests.forEach(t=>{subjects.forEach(s=>appendHeader.push(t.name+" - "+s+" Marks"));appendHeader.push(t.name+" - Absent Days");appendHeader.push(t.name+" - Chapter");appendHeader.push(t.name+" - Remark");});
  const fullHeader=src.header.concat(appendHeader);
  const blankTail=Array(appendHeader.length).fill("");
  const mergedDataRows=src.rows.map(row=>row.concat(blankTail));
  const markRows=[fullHeader,...mergedDataRows];
  const integrityErrors=[];
  if(mergedDataRows.length!==src.rows.length)integrityErrors.push(`Row count changed unexpectedly (${src.rows.length} → ${mergedDataRows.length}).`);
  mergedDataRows.forEach((row,i)=>{if(row.length!==fullHeader.length)integrityErrors.push(`Row ${i+2} has ${row.length} cells, expected ${fullHeader.length}.`);});
  src.rows.forEach((origRow,i)=>{
    for(let c=0;c<src.header.length;c++){
      if(String(mergedDataRows[i][c])!==String(origRow[c])){integrityErrors.push(`Row ${i+2}, column "${fullHeader[c]}" doesn't match the original — aborting.`);}
    }
  });
  if(integrityErrors.length){
    toast(srT("val_update_aborted_integrity",{reason:integrityErrors[0]}),"error");
    return;
  }
  const wsMarks=XLSX.utils.aoa_to_sheet(markRows);
  wsMarks["!cols"]=fullHeader.map((_,i)=>({wch:i<3?16:19}));
  wsMarks["!rows"]=markRows.map((_,r)=>({hpt:r===0?60:20}));
  wsMarks["!views"]=[{state:"frozen",xSplit:3,ySplit:1,topLeftCell:colLetter(3)+"2",activePane:"bottomRight"}];
  fullHeader.forEach((_,c)=>{const addr=colLetter(c)+"1",cell=wsMarks[addr];if(cell)cell.s=TPL_STYLE.header;});
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,buildSetupSheet(),"SETUP");
  XLSX.utils.book_append_sheet(wb,wsMarks,"MARKS+CONTEXT");
  const fname=(APP.setup.instName+" "+APP.setup.className+" "+APP.setup.year).replace(/[^\w\s-]/g,"").replace(/\s+/g,"_")+"_UPDATED_"+timestampTag()+".xlsx";
  APP._pendingMerge={wb,fname,rowsIn:src.rows.length,rowsOut:mergedDataRows.length,colsIn:src.header.length,colsOut:fullHeader.length,appendHeader,newTestNames:newTests.map(t=>t.name),subjectsChanged,missingOrigTests,dupeIds:src.dupeIds||[]};
  renderMergeConfirmModal();
}
════════════════════════════════════════════════════════════════════ */

// NEW SCHEMA (multi-tab redesign): "update" is now sheet-level, not
// row/column-level — existing SETUP/STUDENTS/test tabs are copied through
// from the original parsed workbook completely untouched (the actual
// worksheet objects, not re-serialized row-by-row), and only genuinely
// new test(s) get a brand new blank tab appended. This removes the need
// for the old per-cell integrity diff entirely — nothing that already
// existed is ever re-written, so it can't drift from the original by
// definition. SETUP and README ARE regenerated fresh, since SETUP is
// meant to reflect current settings and README is static boilerplate.
// UI Bugs report: "when user wants to update the sheet/template, if they
// missed a subject on a test they already have data for, adding that
// subject in Setup doesn't add anywhere to actually enter marks for it
// on that existing test." Root cause: generateMergedTemplate() below
// always copies existing test-tab worksheet objects straight through
// untouched (the safety guarantee that old marks can never be altered),
// so a subject added to Setup only ever gets a column on genuinely NEW
// test tabs — an existing tab has no cell for it at all. This patches an
// existing tab's raw data with new blank columns (one per newly-added
// subject, inserted where buildTestSheet()/buildTestSheetWithFormulas()
// always place subject columns — right before "Absent Days") so there's
// somewhere to actually fill in the missed marks. Every existing cell
// (Student IDs, every prior subject's marks, Absent Days/Chapter/Remark)
// is carried through unchanged in both position and value — only new,
// previously-nonexistent cells are added.
function appendSubjectColumnsToTestSheet(sheetName,addedSubjects){
  const rawArr=(APP.rawData["_arr_"+sheetName]||[]).map(r=>(r||[]).slice());
  if(!rawArr.length||!addedSubjects.length) return APP.rawWorkbook.Sheets[sheetName];
  const header=rawArr[0].map(h=>h===null||h===undefined?"":String(h));
  let insertAt=header.findIndex(h=>h.trim().toLowerCase()==="absent days");
  if(insertAt===-1) insertAt=header.length;
  const newHeaderCells=addedSubjects.map(s=>s+" Marks");
  const newRows=rawArr.map((row,ri)=>{
    const r=row.slice();
    while(r.length<insertAt) r.push(""); // pad short/ragged rows so splice lands at the intended column
    const filler=ri===0?newHeaderCells:newHeaderCells.map(()=>"");
    r.splice(insertAt,0,...filler);
    return r;
  });
  const ws=XLSX.utils.aoa_to_sheet(newRows);
  const finalHeader=newRows[0]||[];
  ws["!cols"]=finalHeader.map((_,i)=>({wch:i===0?12:i>=finalHeader.length-2?24:12}));
  ws["!rows"]=newRows.map((_,r)=>({hpt:r===0?32:20}));
  ws["!views"]=[{state:"frozen",xSplit:1,ySplit:1,topLeftCell:colLetter(1)+"2",activePane:"bottomRight"}];
  finalHeader.forEach((_,c)=>{const cell=ws[colLetter(c)+"1"];if(cell)cell.s=TPL_STYLE.header;});
  return ws;
}
// UI improvement (Sandeep, "gives the feeling we've taken a backup before
// updating"): the "Add a test" update flow used to always invent a new
// _UPDATED_<timestamp> filename, discarding the original name entirely.
// Now the main download reuses the exact original filename (so re-saving
// it over the source file in Excel/Explorer genuinely feels like "the
// same file, updated in place"), and a second, separate download goes
// out first with the untouched pre-update content, named with a
// "backup" keyword + timestamp so it's unmistakably a safety copy taken
// before the update happened.
function deriveUpdateFilenames(originalName){
  const base=String(originalName||"workbook").trim().replace(/\.(xlsx|xls|xlsm)$/i,"")||"workbook";
  return{
    mainFname:base+".xlsx",
    backupFname:base+"_backup_"+timestampTag()+".xlsx",
  };
}
// Extends an already-loaded file's STUDENTS sheet in place with whichever
// Phase 1 scholarship columns (Category..Special Category Flag — same 6
// fields, same order, as buildStudentsSheet()'s header for a brand-new
// template) it's still missing. Existing columns and every existing
// student row are left untouched; only the missing headers are appended
// past the sheet's current last column, so re-running this on a file
// that's already been extended is a no-op.
function addScholarshipColumnsToStudentsSheet(wb){
  const sheetNamesUC=wb.SheetNames.map(n=>n.trim().toUpperCase());
  const idx=sheetNamesUC.indexOf("STUDENTS");
  if(idx===-1)return; // no STUDENTS sheet — nothing to extend
  const ws=wb.Sheets[wb.SheetNames[idx]];
  if(!ws||!ws["!ref"])return;
  const range=XLSX.utils.decode_range(ws["!ref"]);
  const SCHOLARSHIP_COLUMNS=["Category","Annual Family Income","Guardian Occupation","Prior Scholarship Status","Persistent Student ID","Special Category Flag"];
  const COLUMN_WIDTHS={"Category":14,"Annual Family Income":18,"Guardian Occupation":22,"Prior Scholarship Status":20,"Persistent Student ID":18,"Special Category Flag":22};
  const existing=new Set();
  for(let c=range.s.c;c<=range.e.c;c++){
    const cell=ws[XLSX.utils.encode_cell({r:range.s.r,c})];
    if(cell&&cell.v!=null)existing.add(String(cell.v).trim());
  }
  const missing=SCHOLARSHIP_COLUMNS.filter(col=>!existing.has(col));
  if(!missing.length)return; // already has every scholarship column
  if(!ws["!cols"])ws["!cols"]=[];
  let nextCol=range.e.c+1;
  missing.forEach(col=>{
    ws[XLSX.utils.encode_cell({r:range.s.r,c:nextCol})]={t:"s",v:col,s:TPL_STYLE.header};
    ws["!cols"][nextCol]={wch:COLUMN_WIDTHS[col]};
    nextCol++;
  });
  range.e.c=nextCol-1;
  ws["!ref"]=XLSX.utils.encode_range(range);
}
// Adds the REFERENCE tab (guidance-only value lists for Category / Prior
// Scholarship Status / Special Category Flag — buildReferenceSheet()) to
// an already-loaded file enabling Scholarship for the first time, same as
// a brand-new template already gets. Only added if missing — never
// overwrites an existing REFERENCE tab, in case an admin has customized
// the lists by hand in Excel.
function addReferenceSheetIfMissing(wb){
  const sheetNamesUC=wb.SheetNames.map(n=>n.trim().toUpperCase());
  if(sheetNamesUC.indexOf("REFERENCE")!==-1)return;
  wb.SheetNames.push("REFERENCE");
  wb.Sheets["REFERENCE"]=buildReferenceSheet();
}
// BUG FIX (3-scenario spec — Setup-first flow, "scholarship data not
// updated in both files"): enabling Scholarship on an already-loaded
// file used to only ever update APP.setup.scholarship in memory — the
// actual workbook (APP.rawWorkbook, the basis for every future
// save/download this session, including scholarship-edit-grid.js's own
// saveScholarshipEdits() once student data is filled in) never got its
// SETUP sheet regenerated, so the in-memory model and any file the admin
// actually walked away with silently disagreed about the scheme. Fixes
// BOTH: regenerates SETUP fresh via buildSetupSheet() (which already
// reads straight from APP.setup.scholarship, so it can't drift from what
// was just typed) into APP.rawWorkbook itself, AND into the file that
// gets downloaded here — same backup+zip shape as saveScholarshipEdits(),
// for the same reason (raw pre-edit bytes preserved untouched as a real
// backup, one JSZip, one download). Also extends STUDENTS with the
// scholarship columns it's missing (addScholarshipColumnsToStudentsSheet()
// above) and adds the REFERENCE tab if missing (addReferenceSheetIfMissing()
// above) — a file enabling Scholarship for the first time otherwise has
// nowhere for the admin to actually enter the eligibility data, and no
// guidance-list dropdowns to source values from.
function updateAndDownloadScholarshipSetup(){
  if(!APP.rawWorkbook||!APP._origFileBytes){
    toast(srT("scholarship_edit_no_source_file"),"error");
    return false;
  }
  let wb;
  try{
    wb=structuredClone(APP.rawWorkbook);
  }catch(err){
    toast(srT("scholarship_edit_clone_failed"),"error");
    return false;
  }
  const sheetNamesUC=wb.SheetNames.map(n=>n.trim().toUpperCase());
  const setupIdx=sheetNamesUC.indexOf("SETUP");
  const newSetupSheet=buildSetupSheet();
  if(setupIdx===-1){
    wb.SheetNames.unshift("SETUP");
    wb.Sheets["SETUP"]=newSetupSheet;
  }else{
    wb.Sheets[wb.SheetNames[setupIdx]]=newSetupSheet;
  }
  addScholarshipColumnsToStudentsSheet(wb);
  addReferenceSheetIfMissing(wb);
  // Keep the in-memory workbook in sync too — see header comment above.
  APP.rawWorkbook=wb;

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
    showScholarshipSetupSavedModal(zipFname);
  });
  return true;
}
// Pop-up shown right after the download above — tells the admin the file
// is saved and how to proceed (offline-fill-and-reupload, or fill directly
// in the in-app grid). No "Go to Scholarship Tab" shortcut here: any way of
// dismissing this one (the Close button, the X icon, backdrop click, Esc)
// should refresh the tool back to Home instead of just closing on top of
// the Setup screen — see the APP._scholarshipSetupSavedModalOpen check in
// closeModal() (render-core.js).
function showScholarshipSetupSavedModal(zipFname){
  APP._scholarshipSetupSavedModalOpen=true;
  $("#modal-content").html(`
    <h3 style="font-family:var(--font-display);font-size:17px;margin-bottom:4px">${esc(srT("scholarship_setup_saved_modal_title"))}</h3>
    <div style="font-size:12.5px;color:var(--c-text3);margin-bottom:16px">${srT("scholarship_setup_saved_modal_desc",{fname:esc(zipFname)})}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button type="button" class="btn btn-primary btn-sm" data-action="closeModal">${esc(srT("scholarship_setup_saved_modal_close_btn"))}</button>
    </div>`);
  gsapModalEntrance();
  setTimeout(()=>{const f=document.querySelector('#modal-overlay.open button');if(f)f.focus();},0);
}
function generateMergedTemplate(){
  const {subjects,tests}=APP.setup;
  const src=APP.mergeSource;
  const origTestNamesUpper=new Set(src.origTestSheetNames.map(n=>n.toUpperCase().trim()));
  const newTests=tests.filter(t=>!origTestNamesUpper.has(t.name.toUpperCase().trim()));
  applyTabPrefix(newTests);
  const origSubjSet=new Set((src.origSubjects||[]).map(s=>s.trim().toLowerCase()));
  const addedSubjects=subjects.filter(s=>!origSubjSet.has(s.trim().toLowerCase()));
  // Only bail out when there's genuinely nothing to merge in — a new
  // test tab OR a subject to append to the existing tabs. Previously this
  // checked newTests alone, so a teacher who'd only added a missed
  // subject (no new test) got "no new test found" and the download never
  // ran, even though appendSubjectColumnsToTestSheet() below exists
  // specifically to handle that case.
  if(!newTests.length&&!addedSubjects.length){
    toast(srT("val_no_new_test_found"),"warn");
    return;
  }
  // A test that existed in the file but is no longer in the Setup form —
  // most likely a rename (e.g. "Test 1" edited to "Unit Test 1") rather
  // than a deliberate removal. Its tab is still kept either way (nothing
  // is ever deleted), this is purely an informational warning.
  const currentTestNamesUpper=new Set(tests.map(t=>t.name.toUpperCase().trim()));
  const missingOrigTests=src.origTestSheetNames.filter(n=>!currentTestNamesUpper.has(n.toUpperCase().trim()));
  const subjectsChanged=(()=>{
    const a=[...(src.origSubjects||[])].map(s=>s.toLowerCase()).sort();
    const b=[...subjects].map(s=>s.toLowerCase()).sort();
    return a.length!==b.length||a.some((v,i)=>v!==b[i]);
  })();
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,buildSetupSheet(),"SETUP"); // regenerated fresh from current Setup form
  const usedNames=new Set(["SETUP"]);
  // STUDENTS + every existing test tab: copy the ORIGINAL worksheet object
  // straight through. This is the safety guarantee — old marks physically
  // cannot be altered by this code path, because this code path never
  // touches their cells at all. The one exception: if new subjects were
  // added, existing test tabs get new blank columns appended for them
  // (appendSubjectColumnsToTestSheet above) — every existing cell still
  // keeps its original value, only new cells are added.
  const origWb=src.workbook;
  const studentsWs=origWb.Sheets[src.studentsSheetName];
  XLSX.utils.book_append_sheet(wb,studentsWs,safeSheetName("STUDENTS",usedNames));
  src.origTestSheetNames.forEach(sheetName=>{
    const ws=addedSubjects.length
      ? appendSubjectColumnsToTestSheet(sheetName,addedSubjects)
      : origWb.Sheets[sheetName];
    XLSX.utils.book_append_sheet(wb,ws,safeSheetName(sheetName,usedNames));
  });
  newTests.forEach(t=>{
    const sheetName=safeSheetName(t.name,usedNames);
    XLSX.utils.book_append_sheet(wb,buildTestSheetWithFormulas(t,subjects,src.studentsRows.length),sheetName);
  });
  usedNames.add("README");
  XLSX.utils.book_append_sheet(wb,buildReadmeSheet(),"README");
  const {mainFname:fname,backupFname}=deriveUpdateFilenames(src.sourceFileName);
  APP._pendingMerge={
    wb,fname,backupFname,backupBytes:src.origArrayBuffer,
    studentCount:src.studentsRows.length,
    tabsIn:src.origTestSheetNames.length+2, // + SETUP + STUDENTS
    tabsOut:wb.SheetNames.length,
    newTestNames:newTests.map(t=>t.name),
    keptTestNames:src.origTestSheetNames.slice(),
    subjectsChanged,missingOrigTests,dupeIds:src.dupeIds||[],
    addedSubjects,
  };
  renderMergeConfirmModal();
}
// prompt-02-nperiod-import-fork.md "Start a new class/semester" fork.
// Builds a genuine multi-period continuity workbook: every PRIOR period
// (copied through verbatim — either the source's own existing "Period N
// ..." blocks if it was already multi-period, or reconstructed as a
// single Period 1 from the legacy source's flat SETUP if this is the
// first fork ever done on it) PLUS the new period the user just filled
// into the Setup form. Same copy-the-worksheet-object safety guarantee
// as generateMergedTemplate() — no prior period's marks cells are ever
// touched, only appended alongside.
function generateContinuityAppendTemplate(){
  const src=APP.mergeSource;if(!src)return;
  const origWb=src.workbook;
  const existingPeriods=extractPeriodBlocks(src.origSetupKv);
  const priorPeriods=existingPeriods.length?existingPeriods:[{
    label:src.origPeriodSnapshot.label,year:src.origPeriodSnapshot.year,
    teacher:src.origPeriodSnapshot.teacher,subjects:src.origPeriodSnapshot.subjects,
    tests:src.origPeriodSnapshot.tests,
  }];
  const newTests=(APP.setup.tests||[]).map(t=>({name:t.name,date:t.date||"",maxMarks:Object.assign({},t.maxMarks)}));
  applyTabPrefix(newTests); // "<Class/Batch><Section>-<TestName>", same convention as every other generated tab
  const newPeriod={
    label:APP.setup.className||"",year:APP.setup.year||"",teacher:APP.setup.teacher||"",
    subjects:(APP.setup.subjects||[]).slice(),tests:newTests,
  };
  // A2/confirmed: Class/Batch must genuinely differ from the immediately
  // preceding period (case-insensitive) — Section/Year/Teacher/Subjects/
  // Tests are all allowed to repeat (a subject can legitimately continue).
  const prevLabel=priorPeriods[priorPeriods.length-1].label;
  if(newPeriod.label.trim().toLowerCase()===String(prevLabel||"").trim().toLowerCase()){
    toast(srT("val_new_period_same_class",{label:esc(newPeriod.label)}),"error");
    return;
  }
  const allPeriods=[...priorPeriods,newPeriod];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,buildContinuitySetupSheet(allPeriods),"SETUP");
  const usedNames=new Set(["SETUP"]);
  const studentsWs=origWb.Sheets[src.studentsSheetName];
  XLSX.utils.book_append_sheet(wb,studentsWs,safeSheetName("STUDENTS",usedNames));
  // Every prior period's tabs, copied straight through untouched — this
  // is the ONLY line that reads old marks data, and it never touches a
  // single cell, only the worksheet object reference.
  priorPeriods.forEach(p=>{
    p.tests.forEach(t=>{
      const ws=origWb.Sheets[t.name];
      if(ws)XLSX.utils.book_append_sheet(wb,ws,safeSheetName(t.name,usedNames));
    });
  });
  // New period's tabs — empty templates (5 sample rows, same as any
  // fresh template/newly-added test), ready to fill. Per A3, new joiners
  // for this period go straight into the STUDENTS tab by hand in Excel —
  // no UI for it here, to avoid a second, easier-to-desync source of
  // student identity/uniqueness alongside the sheet itself.
  newPeriod.tests.forEach(t=>{
    XLSX.utils.book_append_sheet(wb,buildTestSheetWithFormulas(t,newPeriod.subjects,src.studentsRows.length),safeSheetName(t.name,usedNames));
  });
  usedNames.add("README");
  XLSX.utils.book_append_sheet(wb,buildReadmeSheet(),"README");
  const fname=(APP.setup.instName+" "+newPeriod.label+" "+APP.setup.year).replace(/[^\w\s-]/g,"").replace(/\s+/g,"_")+"_CONTINUITY_"+timestampTag()+".xlsx";
  // Backup treatment extended to this fork too: this flow still reads
  // every prior period's tabs straight out of the original workbook (see
  // the comment above priorPeriods.forEach), so the same "take a backup
  // of what we're building on top of" reasoning applies here as much as
  // it does to "Add a test" — it just keeps its OWN distinct
  // _CONTINUITY_ filename rather than reusing the source's name, since
  // this genuinely is a new period's file, not an in-place update of the
  // one being read. confirmMergedDownload() already bundles backup+main
  // into one zip download whenever backupBytes/backupFname are present,
  // so no change needed there.
  const backupFname=deriveUpdateFilenames(src.sourceFileName).backupFname;
  APP._pendingMerge={
    wb,fname,backupFname,backupBytes:src.origArrayBuffer,continuityMode:true,
    studentCount:src.studentsRows.length,
    periodCount:allPeriods.length,
    priorPeriodLabels:priorPeriods.map(p=>p.label),
    newPeriodLabel:newPeriod.label,
    newTestNames:newPeriod.tests.map(t=>t.name),
    dupeIds:src.dupeIds||[],
  };
  renderMergeConfirmModal();
}
// prompt-02-nperiod-import-fork.md: the ONE question asked when a
// teacher re-uploads an existing sheet, right after it loads (A1: before
// they touch the Setup form) — "Add a test" is the pre-existing flow,
// completely unchanged; "Start a new class/semester" is new (see
// chooseMergeFork/generateContinuityAppendTemplate below).
function renderMergeForkModal(){
  const src=APP.mergeSource;if(!src)return;
  $("#modal-content").html(`
    <h3 style="font-family:var(--font-display);font-size:17px;margin-bottom:4px">${esc(srT("merge_fork_title"))}</h3>
    <div style="font-size:12.5px;color:var(--c-text3);margin-bottom:16px">${srT("merge_fork_desc",{fileName:esc(src.sourceFileName)})}</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn btn-secondary" style="text-align:left;padding:12px 14px" data-action="chooseMergeFork" data-arg="add_test">
        <div style="font-weight:700;font-size:13.5px">${esc(srT("merge_fork_add_test_label"))}</div>
        <div style="font-size:11.5px;color:var(--c-text3);margin-top:2px;font-weight:400">${esc(srT("merge_fork_add_test_desc"))}</div>
      </button>
      <button class="btn btn-secondary" style="text-align:left;padding:12px 14px" data-action="chooseMergeFork" data-arg="new_period">
        <div style="font-weight:700;font-size:13.5px">${esc(srT("merge_fork_new_period_label"))}</div>
        <div style="font-size:11.5px;color:var(--c-text3);margin-top:2px;font-weight:400">${esc(srT("merge_fork_new_period_desc"))}</div>
      </button>
    </div>`);
  gsapModalEntrance();
  setTimeout(()=>{const f=document.querySelector('#modal-overlay.open button');if(f)f.focus();},0);
}
function chooseMergeFork(choice){
  if(!APP.mergeSource)return;
  APP.mergeForkChoice=(choice==="new_period")?"new_period":"add_test";
  closeModal();
  continueLoadMergeSource();
}
function renderMergeConfirmModal(){
  const p=APP._pendingMerge;if(!p)return;
  if(p.continuityMode){
    const warnHtml=(p.dupeIds&&p.dupeIds.length)?`<div style="margin:10px 0;padding:10px 12px;background:#fff4e0;border-radius:var(--r-sm);font-size:12px;color:#8a5a00">⚠ ${esc(srT("val_dupe_ids_students_tab",{ids:esc(p.dupeIds.join(", "))}))}</div>`:"";
    $("#modal-content").html(`
      <h3 style="font-family:var(--font-display);font-size:17px;margin-bottom:4px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-17'/></svg> ${esc(srT("merge_fork_confirm_title"))}</h3>
      <div style="font-size:12px;color:var(--c-text3);margin-bottom:14px">${esc(srT("merge_fork_confirm_desc"))}</div>
      <div class="grid-2" style="gap:10px;margin-bottom:6px">
        <div class="kpi-card"><div class="kpi-label">${esc(srT("merge_students_on_roster"))}</div><div class="kpi-val" style="font-size:16px">${p.studentCount}</div></div>
        <div class="kpi-card"><div class="kpi-label">${esc(srT("merge_fork_period_count"))}</div><div class="kpi-val" style="font-size:16px">${p.periodCount}</div></div>
      </div>
      <div style="font-size:12.5px;margin:10px 0 4px"><b>${esc(srT("merge_fork_new_period_is"))}</b> ${esc(p.newPeriodLabel)}</div>
      <div style="font-size:11.5px;color:var(--c-text2);max-height:110px;overflow:auto;background:var(--c-surface2);border-radius:var(--r-sm);padding:8px 10px;margin-bottom:6px">${esc(srT("merge_kept_unchanged"))} SETUP, STUDENTS, ${p.priorPeriodLabels.map(n=>esc(n)).join(", ")}<br>${esc(srT("merge_added_new"))} ${p.newTestNames.map(n=>esc(n)).join(", ")}</div>
      <div style="font-size:11.5px;color:var(--c-text3);margin-bottom:6px">${esc(srT("merge_fork_new_joiners_note"))}</div>
      ${warnHtml}
      <div style="font-size:11px;color:var(--c-text3);margin-bottom:14px">${p.backupFname?`${esc(srT("merge_will_save_as_zip_with_backup"))}<br><code>${esc(p.fname.replace(/\.xlsx$/i,""))}_with_backup.zip</code><div style="margin-top:4px">(<code>${esc(p.backupFname)}</code> + <code>${esc(p.fname)}</code>)</div>`:`${esc(srT("merge_will_save_as"))} <code>${esc(p.fname)}</code>`}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary btn-sm" data-action="closeModal">${esc(srT("btn_cancel"))}</button>
        <button class="btn btn-success btn-sm" data-action="confirmMergedDownload">✔ ${esc(srT("btn_confirm_download"))}</button>
      </div>`);
    gsapModalEntrance();
    setTimeout(()=>{const f=document.querySelector('#modal-overlay.open .modal-close');if(f)f.focus();},0);
    return;
  }
  const warnings=[];
  if(p.addedSubjects&&p.addedSubjects.length){
    warnings.push(srT("val_subjects_added_to_existing",{subjects:esc(p.addedSubjects.join(", "))}));
  }else if(p.subjectsChanged){
    warnings.push(srT("val_subjects_list_changed"));
  }
  if(p.missingOrigTests.length)warnings.push(srT("val_missing_orig_tests",{names:esc(p.missingOrigTests.join(", "))}));
  if(p.dupeIds.length)warnings.push(srT("val_dupe_ids_students_tab",{ids:esc(p.dupeIds.join(", "))}));
  const warnHtml=warnings.length?`<div style="margin:10px 0;padding:10px 12px;background:#fff4e0;border-radius:var(--r-sm);font-size:12px;color:#8a5a00">⚠ ${warnings.join("<br>⚠ ")}</div>`:"";
  $("#modal-content").html(`
    <h3 style="font-family:var(--font-display);font-size:17px;margin-bottom:4px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-17'/></svg> ${esc(srT("merge_review_title"))}</h3>
    <div style="font-size:12px;color:var(--c-text3);margin-bottom:14px">${esc(srT("merge_review_desc"))}</div>
    <div class="grid-2" style="gap:10px;margin-bottom:6px">
      <div class="kpi-card"><div class="kpi-label">${esc(srT("merge_students_on_roster"))}</div><div class="kpi-val" style="font-size:16px">${p.studentCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">${esc(srT("merge_tabs_label"))}</div><div class="kpi-val" style="font-size:16px">${p.tabsIn} → ${p.tabsOut}</div></div>
    </div>
    <div style="font-size:12.5px;margin:10px 0 4px"><b>${esc(srT("merge_new_test_tabs_being_added"))}</b> ${esc(p.newTestNames.join(", "))}</div>
    <div style="font-size:11.5px;color:var(--c-text2);max-height:110px;overflow:auto;background:var(--c-surface2);border-radius:var(--r-sm);padding:8px 10px;margin-bottom:6px">${esc(srT("merge_kept_unchanged"))} SETUP, STUDENTS, ${p.keptTestNames.map(n=>esc(n)).join(", ")||esc(srT("merge_no_prior_test_tabs"))}<br>${esc(srT("merge_added_new"))} ${p.newTestNames.map(n=>esc(n)).join(", ")}</div>
    ${warnHtml}
    <div style="font-size:11px;color:var(--c-text3);margin-bottom:14px">${p.backupFname?`${esc(srT("merge_will_save_as_zip_with_backup"))}<br><code>${esc(p.fname.replace(/\.xlsx$/i,""))}_with_backup.zip</code><div style="margin-top:4px">(<code>${esc(p.backupFname)}</code> + <code>${esc(p.fname)}</code>)</div>`:`${esc(srT("merge_will_save_as"))} <code>${esc(p.fname)}</code>`}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-secondary btn-sm" data-action="closeModal">${esc(srT("btn_cancel"))}</button>
      <button class="btn btn-success btn-sm" data-action="confirmMergedDownload">✔ ${esc(srT("btn_confirm_download"))}</button>
    </div>`);
  gsapModalEntrance();
  setTimeout(()=>{const f=document.querySelector('#modal-overlay.open .modal-close');if(f)f.focus();},0);
}
function confirmMergedDownload(){
  const p=APP._pendingMerge;if(!p){closeModal();return;}
  // BUG FIX (browser download-spam block): two separate XLSX.writeFile()
  // calls — even 400ms apart — get treated by Chrome/Edge/Firefox as
  // multiple-file download spam from one page action; the second (main)
  // file is frequently silently blocked, so the teacher only ends up with
  // the backup and thinks the update never happened. Bundling both into
  // one ZIP means exactly one browser download prompt/save, which nothing
  // blocks. Applies to both forks now — "Add a test" and "Start a new
  // class/semester" (continuityMode) both populate backupBytes/
  // backupFname, since both read prior data straight out of the original
  // workbook and both benefit from a safety copy of it.
  if(p.backupBytes&&p.backupFname){
    const zip=new JSZip();
    // Raw original bytes, not a re-serialized XLSX.write() — see the note
    // on origArrayBuffer above for why. This is what actually keeps the
    // backup's formatting intact.
    zip.file(p.backupFname,p.backupBytes);
    zip.file(p.fname,XLSX.write(p.wb,{bookType:"xlsx",type:"array"}));
    const zipFname=p.fname.replace(/\.xlsx$/i,"")+"_with_backup.zip";
    zip.generateAsync({type:"blob"}).then(blob=>{
      const url=URL.createObjectURL(blob);
      const link=document.createElement("a");
      link.href=url;link.download=zipFname;
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),4000);
      toast(srT("toast_updated_file_downloaded",{fname:zipFname,count:p.studentCount,newCount:p.newTestNames.length}),"success");
      finishMergedDownload(p);
    });
    return;
  }
  XLSX.writeFile(p.wb,p.fname);
  toast(srT("toast_updated_file_downloaded",{fname:p.fname,count:p.studentCount,newCount:p.newTestNames.length}),"success");
  finishMergedDownload(p);
}
// Shared tail of confirmMergedDownload() — same regardless of whether the
// zip-with-backup path or the plain single-file path fired above.
function finishMergedDownload(p){
  unlockStep("data");
  $("#btn-download-template").removeClass("btn-glow");
  $("#btn-setup-next").addClass("btn-glow");
  closeModal();
  // Exit merge mode — the just-downloaded file is now the new baseline; if
  // the teacher wants to add yet another test later, they load that file
  // in fresh via "Load Existing Filled Sheet" again.
  APP.mergeMode=false;APP.mergeSource=null;APP._pendingMerge=null;APP.mergeForkChoice=null;
  $("#merge-banner").hide();
  $("#btn-download-template").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-22'/></svg> "+i18nLabel("setup_btn_download_template","Download Template"));
  $("#btn-load-existing").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-08'/></svg> "+i18nLabel("setup_btn_load_existing","Load Existing Filled Sheet"));
  // BUG FIX (screenshot review): same reasoning as generateTemplate() —
  // ask before wiping the form instead of auto-reloading. The merge
  // confirm modal we were just showing is reused for this next prompt.
  setTimeout(()=>showPostDownloadPrompt(),400);
}

/* ════ SHARED FILE VALIDATION ════
   Used by both upload entry points (Home quick-import and the Step 2
   drop-zone) so file-size and extension guards can't silently apply to
   only one of them. */
function validateUploadFile(f,allowedExts){
  if(!f)return srT("val_no_file_selected");
  if(f.size>50*1024*1024)return srT("val_file_too_large");
  const ext=(f.name.split(".").pop()||"").toLowerCase();
  if(!allowedExts.includes(ext))return srT("val_unsupported_file",{exts:allowedExts.map(e=>"."+e).join(", ")});
  return null;
}

/* ════ SHARED WORKBOOK → APP.rawData PARSER ════
   Single source of truth for turning a parsed SheetJS workbook into
   APP.rawData. This used to be duplicated independently in the Home
   quick-import path and the Step 2 drop-zone path, and the two had
   drifted apart:
    - A fix for grouped/repeated subject-header columns (e.g. "GS Paper 1"
      appearing once per test block) only landed in the Home path. Plain
      object keys can never hold the same header name twice, so without
      capturing the raw positional row (__raw) + raw header array
      (_hdr_<sheet>), every earlier test's marks silently collapsed to
      just the last test's values.
    - Formula-injection stripping (blanking any cell value starting with
      "=") was only applied to every sheet in the Home path; the Step 2
      path only stripped it from SETUP, leaving Teacher Remark / mark
      cells imported via Step 2 unsanitised.
   Both entry points now call this one function so a fix here always
   applies everywhere. */
// Canonical sheet-name lookup (EXCEL_DATA_MATH_AUDIT_PROMPT.md item 5):
// trim + Unicode-safe case-fold every sheet name ONCE here, at parse
// time, and hand back a single normalized-name -> actual-sheet-name map
// that every later lookup (validateData, parseStudents, downloadUpdatedSheet…)
// must go through instead of indexing APP.rawData with a hand-typed name
// directly. A collision (two distinct sheet names that normalize to the
// same key, e.g. "Mid-Term" and "MID-TERM ") is reported rather than
// silently resolved to whichever sheet happened to be seen first.
function canonicalSheetKey(name){
  return String(name||"").normalize("NFKC").trim().toLocaleUpperCase();
}
function buildSheetIndex(sheetNames){
  const index={},collisions=[];
  (sheetNames||[]).forEach(name=>{
    const key=canonicalSheetKey(name);
    if(!key)return;
    if(index[key]!==undefined&&index[key]!==name){
      collisions.push({key,names:[index[key],name]});
    } else {
      index[key]=name;
    }
  });
  return {index,collisions};
}
// Resolve a SETUP-configured test name to the actual worksheet key it
// refers to, or null if no worksheet normalizes to that name. Every
// consumer of a test/subject sheet name should call this once and reuse
// the resolved key, rather than indexing APP.rawData with the raw SETUP
// label (which may differ from the worksheet's exact spelling in case
// or surrounding whitespace).
function resolveSheetName(rawData,name){
  const idx=rawData&&rawData._sheetIndex;
  if(!idx)return null;
  const resolved=idx[canonicalSheetKey(name)];
  return resolved===undefined?null:resolved;
}
function parseWorkbookSheets(wb){
  APP.rawData={};
  const {index:sheetIndex,collisions:sheetCollisions}=buildSheetIndex(wb.SheetNames);
  APP.rawData._sheetIndex=sheetIndex;
  APP.rawData._sheetCollisions=sheetCollisions;
  // Keep the original SheetJS workbook object around (not just the
  // flattened arrays already extracted below) so a later "Download
  // Updated Sheet" can clone-and-patch it in place — preserving
  // formulas, styles, validation, hidden sheets, and unrelated tabs —
  // instead of rebuilding a new workbook from arrays. See item 7.
  APP.rawWorkbook=wb;
  wb.SheetNames.forEach(name=>{
    const ws=wb.Sheets[name];
    const rawArr=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});
    const normName=name.replace(/[^A-Za-z0-9]/g,"_").toUpperCase();

    // SETUP is a label/value sheet (col A = label, col B = value), not a
    // table with a header row — running it through header-row detection
    // below would swallow the "Institution Name" row as a phantom header
    // and silently drop it from the data. Parse it positionally instead.
    if(name.toUpperCase().trim()==="SETUP"){
      const rows=rawArr
        .filter(row=>row&&row[0]!==null&&row[0]!==undefined&&String(row[0]).trim()!=="")
        .map(row=>row.map(v=>(typeof v==="string"&&v.trim().startsWith("="))?null:(v===null||v===undefined?"":v)));
      APP.rawData[name]=rows;
      APP.rawData["_arr_"+name]=rawArr;
      APP.rawData[normName]=rows;
      return;
    }

    // Find real header row (most non-null cells, with a bonus for known keywords)
    let headerIdx=0,bestScore=0;
    const hints=["student id","full name","institution name","subject 1","key","colour"];
    for(let i=0;i<Math.min(rawArr.length,8);i++){
      const row=rawArr[i]||[];const nonNull=row.filter(v=>v!==null&&v!=="").length;
      const hintHit=hints.some(h=>row.map(v=>String(v||"").toLowerCase()).join("|").includes(h))?15:0;
      if(nonNull+hintHit>bestScore){bestScore=nonNull+hintHit;headerIdx=i;}
    }
    const hdr=(rawArr[headerIdx]||[]).map(h=>h===null||h===undefined?null:String(h).replace(/—/g,"-").replace(/[\n\r]+/g," ").replace(/\s+/g," ").trim());
    const rows=[];
    for(let r=headerIdx+1;r<rawArr.length;r++){
      const row=rawArr[r];if(!row||row.every(v=>v===null||v===undefined||v===""))continue;
      const obj={};
      hdr.forEach((h,i)=>{if(!h)return;let v=row[i];if(typeof v==="string"&&v.trim().startsWith("="))v=null;obj[h]=(v===null||v===undefined)?"":v;});
      // Templates can repeat the same header (e.g. a subject name) once per
      // test block. Plain object keys can only hold the LAST such value,
      // silently losing every earlier test's marks. Stash the untouched
      // (but still formula-stripped) positional row alongside the object
      // (non-enumerable so it doesn't leak into Object.keys()/JSON use
      // elsewhere) so downstream grouped-header parsing can recover every
      // occurrence by column position.
      const rawRowStripped=row.map(v=>(typeof v==="string"&&v.trim().startsWith("="))?null:v);
      Object.defineProperty(obj,"__raw",{value:rawRowStripped,enumerable:false,configurable:true});
      rows.push(obj);
    }
    APP.rawData[name]=rows;
    APP.rawData["_arr_"+name]=rawArr;
    APP.rawData["_hdr_"+name]=hdr;
    APP.rawData[normName]=rows;
  });
  // Phase 2 Task 04: REFERENCE tab (Category / Prior Scholarship Status /
  // Special Category Flag example-value columns — see buildReferenceSheet()
  // above, the exact layout this reads back) parsed into a plain
  // {fieldKey:[values...]} map for the edit-grid's dropdown suggestions.
  // Missing tab (a file predating this feature) leaves this null — the
  // grid falls back to REFERENCE_LISTS' generic defaults, never an error.
  APP._scholarshipReferenceLists=parseReferenceSheet(wb);
  // Phase 2 Task 05: a fresh file/re-import means any in-progress
  // scholarship-grid edits belong to data that's about to be replaced —
  // same reasoning as resetSmartChatTranscript() in inline-actions.js for
  // Smart Search. Clearing here (single funnel point for every import
  // path: home import, sample file, compare mode) rather than at each
  // call site.
  if(typeof window!=="undefined"&&typeof window.clearScholarshipEditBuffer==="function"){
    window.clearScholarshipEditBuffer();
  }
}
// Phase 2 Task 04: reads the REFERENCE tab back out of an uploaded
// workbook. Same sheet-name-lookup convention as the STUDENTS/SETUP
// lookups above (case/whitespace-insensitive match against SheetNames)
// rather than a second differently-structured reader. Returns null (not
// an empty map) when the tab is absent so callers can tell "no tab" apart
// from "tab present but genuinely empty", though both fall back to plain
// text entry in the grid either way.
function parseReferenceSheet(wb){
  const name=wb.SheetNames.find(n=>n.trim().toUpperCase()==="REFERENCE");
  if(!name)return null;
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:""});
  if(!rows.length)return null;
  const hdr=(rows[0]||[]).map(h=>String(h||"").trim());
  // Matches buildReferenceSheet()'s own 3-column header exactly.
  const keyByCol={"Category":"category","Prior Scholarship Status":"priorScholarshipStatus","Special Category Flag":"specialCategoryFlag"};
  const out={};
  hdr.forEach((h,c)=>{
    const key=keyByCol[h];
    if(!key)return;
    const vals=[];
    for(let r=1;r<rows.length;r++){
      const v=String((rows[r]||[])[c]||"").trim();
      if(v&&!vals.includes(v))vals.push(v);
    }
    out[key]=vals;
  });
  return Object.keys(out).length?out:null;
}

/* ════ HOME IMPORT — direct Excel import from home screen ════
   Only .xlsx/.xls (matching the file input's accept attribute) — CSV
   support is deliberately kept to the Step 2 drop-zone only, since this
   quick-import path is meant to mirror "select the filled-in template
   you downloaded", which is always an Excel file. */
/* ════ TRY SAMPLE DATA — zero-touch Home entry (v2.3, spec §2.1) ════
   Deliberately reuses the exact same parseWorkbookSheets() ->
   autoInferSetup() -> afterImportSuccess() -> runAnalysis() pipeline as a
   real Import Filled Excel — no parallel data path invented. The one
   real difference from a manual import: the file comes from a fetch()
   instead of a <input type=file>, and success chains straight into
   runAnalysis() (which defaults to "select all AI features" when none
   have been chosen) so the teacher never has to click through Setup/
   Data/AI Analysis manually. Sample_04 (PUC / Junior College) was picked
   as the default because it's a plain single-section Institution-mode
   class, the closest match to the non-power-user persona this feature
   is designed around. */
// v3.0 rev2 (BUILD spec §10.4): tryOneClickSample() removed — the Home
// "Want to try it first?" link now opens showSampleFiles() directly (the
// same modal used elsewhere in the app), instead of a separate single-
// file auto-download path. One sample-data entry point, not two.

// Compare mode is capped at 5 files total — enough for a school's worth of
// sections/batches side-by-side without the section-ranking table/management
// grid becoming unreadable. Enforced here since this is the single choke
// point every file enters through (input picker, drag-drop, and the
// "try all 3 compare samples" demo all call this — see grep of callers).
const MAX_COMPARE_FILES=5;
function handleHomeImportFiles(files){
  files=(files||[]).filter(Boolean);
  if(!files.length)return;
  APP._isSampleData=false; // FEEDBACK #9: any real upload clears the "you're viewing sample data" banner
  // v2.4: 2+ files at once now go through Compare Sections silently — no
  // "Compare Sections" click needed. Once every file has finished loading,
  // afterAllCompareFilesLoaded() checks whether they actually share the
  // same subjects/tests: if ≥2 do, comparison analysis runs immediately;
  // if not, a plain-language "these don't match" message is shown instead
  // of the per-file technical validation detail.
  // Also covers dropping ONE more file onto the zone while already in
  // Compare mode (files.length===1 but APP.compareMode true) — previously
  // that silently fell through to the single-file path below instead of
  // adding a 4th/5th section. startCompareMode() is NOT called again here
  // when already in Compare mode — it unconditionally wipes APP.sections,
  // which would have deleted every section added so far.
  if(files.length>=2||APP.compareMode){
    if(!APP.compareMode)startCompareMode();
    const room=Math.max(0,MAX_COMPARE_FILES-APP.sections.length);
    if(files.length>room){
      toast(srT("val_compare_max_files",{max:MAX_COMPARE_FILES,skipped:files.length-room}),"warn");
      files=files.slice(0,room);
    }
    if(!files.length)return;
    let remaining=files.length;
    import('../bal/compare/compute-compare.js').then(function(m){
      files.forEach(f=>m.processCompareFile(f,()=>{remaining--;if(remaining===0)afterAllCompareFilesLoaded();}));
    });
    return;
  }
  handleHomeImport(files[0]);
}
async function afterAllCompareFilesLoaded(){
  const statusEl=document.getElementById("home-import-status");
  const validCount=APP.sections.filter(s=>s.valid).length;
  const { renderHomeFileList } = await import('../bal/compare/compute-compare.js');
  renderHomeFileList();
  if(validCount>=1){
    statusEl.style.display="none";statusEl.innerHTML="";
    // v3.0: no auto-run — surface Run Analysis, same as the single-file path.
    // Every valid file gets its own analysis regardless of whether it
    // matches anything else; matching subsets are compared silently once
    // Run Analysis executes (see computeCompareGroups()).
    showHomeRunAnalysisButton();
    updateScholarshipNavVisibility(); // Task 07: compare-mode equivalent of the single-file path above
    return;
  }
  const detail=srT("val_cant_analyse_files_detail");
  statusEl.innerHTML=`<div class="card" style="border-color:var(--c-warn)">
    <b style="color:var(--c-warn)">${esc(srT("val_cant_analyse_files"))}</b>
    <div style="font-size:12.5px;color:var(--c-text2);margin-top:6px">${esc(detail)}</div>
    <div style="margin-top:10px;font-size:11px"><button type="button" data-action="resetHomeImport" style="background:none;border:none;padding:0;font:inherit;cursor:pointer;color:var(--c-text3);text-decoration:underline">↺ Start over — pick different files</button></div>
  </div>`;
  statusEl.style.display="block";
  scrollToEl(statusEl);
}
function handleHomeImport(file){
  if(!file)return;
  APP._isSampleData=false; // FEEDBACK #9 (same as handleHomeImportFiles): a real single-file
  // upload must also clear the "you're viewing sample data" banner — this path is reached
  // whenever exactly one file is selected (handleHomeImportFiles() delegates here), so the
  // multi-file caller alone resetting the flag left single-file imports still flagged as sample.
  const fileName=file.name;
  const statusEl=document.getElementById("home-import-status");
  const fileErr=validateUploadFile(file,["xlsx","xls"]);
  if(fileErr){
    statusEl.innerHTML=`<div class="card" style="border-color:var(--c-danger)"><b style="color:var(--c-danger)"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-51'/></svg> ${esc(fileErr)}</b></div>`;
    statusEl.style.display="block";scrollToEl(statusEl);
    return;
  }
  // Reset immediately so same file can be selected again on next attempt
  statusEl.innerHTML=`<div class="card" style="padding:14px;border-color:var(--c-primary)"><div style="font-size:12.5px">⏳ Reading <b>${esc(fileName)}</b>...</div></div>`;
  statusEl.style.display="block";
  // No scroll here — this message is transient and gets replaced within
  // milliseconds by the result below. Scrolling for both would fire two
  // smooth-scrolls back to back and look like the page jumping around.

  const reader=new FileReader();
  reader.onload=async e=>{
    try{
      const { resolveMarksRows, renderHomeFileList } = await import('../bal/compare/compute-compare.js');
      const wb=XLSX.read(e.target.result,{type:"array"});
      // Phase 2 Task 07: raw original bytes + filename, same
      // origArrayBuffer convention loadMergeSourceFromArrayBuffer() below
      // already uses for its own backup — kept here too so the
      // scholarship edit-grid's "Update and Download" can zip an
      // untouched pre-edit backup alongside the updated file, without a
      // re-serialized (and therefore reformatted) copy standing in for it.
      APP._origFileBytes=e.target.result;
      APP._origFileName=fileName;
      parseWorkbookSheets(wb);

      // Auto-read SETUP tab
      const inferOk=autoInferSetup();
      // autoInferSetup() returns false (and sets APP.rawData=null) only when
      // the user explicitly cancelled the "switch project mode?" confirm —
      // stop here so that deliberate cancel doesn't fall through to
      // resolveMarksRows(null) below and surface as a scary "Import failed"
      // error. autoInferSetup() already showed its own "cancelled" toast.
      if(!inferOk){statusEl.style.display="none";statusEl.innerHTML="";return;}

      // Validate SETUP completeness
      const errs=validateSetupData();
      if(errs.length){
        const errHtml=errs.map(e=>`<div style="padding:5px 0;border-bottom:1px solid var(--c-border);font-size:12px"><span style="color:${e.required?"var(--c-danger)":"var(--c-warn)"}">${e.required?"✕":"⚠"}</span> ${e.msg}</div>`).join("");
        const hasRequired=errs.some(e=>e.required);
        if(hasRequired){
          // BUG FIX: this card used to always say "issue(s) found in SETUP
          // tab" and always show "Edit Setup in App" — accurate for a
          // missing Institution Name/Subjects/etc, but wrong for a
          // STUDENTS-tab problem (empty roster, all-5-rows-still-sample,
          // 2+ children in one Individual-mode file): those aren't Setup
          // fields, there's nothing to "Edit Setup" to fix, and the button
          // just sent the user to a screen that couldn't help. Only offer
          // it when at least one blocking issue is actually a Setup field;
          // title/CTA copy fall back to a tab-agnostic phrasing otherwise
          // since each issue's own message already names its tab.
          const requiredErrs=errs.filter(e=>e.required);
          const hasSetupTabIssue=requiredErrs.some(e=>e.tab==="setup");
          const allSetupTab=requiredErrs.every(e=>e.tab==="setup");
          const cardTitle=allSetupTab?srT("val_setup_incomplete_title",{n:errs.length}):srT("val_file_issues_title",{n:errs.length});
          const fixHint=allSetupTab?srT("val_fix_setup_tab_hint"):srT("val_fix_file_issues_hint");
          const editSetupBtn=hasSetupTabIssue?`<button class="btn btn-secondary btn-sm" style="margin-top:10px" data-action="goStep" data-arg="setup">${esc(srT("val_edit_setup_in_app_btn"))}</button>`:"";
          statusEl.innerHTML=`<div class="card" style="border-color:var(--c-danger)">
            <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:var(--c-danger)"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-51'/></svg> ${esc(cardTitle)}</div>
            ${errHtml}
            <div style="margin-top:10px;font-size:12px;color:var(--c-text2)">${esc(fixHint)}</div>
            ${editSetupBtn}
            <div style="margin-top:10px;font-size:11px"><button type="button" data-action="resetHomeImport" style="background:none;border:none;padding:0;font:inherit;cursor:pointer;color:var(--c-text3);text-decoration:underline">${esc(srT("val_not_this_file_start_over"))}</button></div>
          </div>`;
          statusEl.style.display="block";
          scrollToEl(statusEl);
          return;// stop here — required fields missing, can't auto-proceed
        }
        // Non-blocking warnings only — note them briefly, then continue
        // straight through, same as a clean import (v2.4: no manual
        // "Continue to Analysis" click for the teacher to make).
        statusEl.innerHTML=`<div class="card" style="border-color:var(--c-warn)">
          <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:var(--c-warn)">⚠ Setup Warnings — ${errs.length} noted, continuing anyway</div>
          ${errHtml}
        </div>`;
        statusEl.style.display="block";
        APP.homeSingleFile={fileName,rowCount:resolveMarksRows(APP.rawData).length};
        renderHomeFileList();
        afterImportSuccess();
        return;
      }
      statusEl.style.display="none";statusEl.innerHTML="";
      APP.homeSingleFile={fileName,rowCount:resolveMarksRows(APP.rawData).length};
      renderHomeFileList();
      afterImportSuccess();
    }catch(err){
      statusEl.innerHTML=`<div class="card" style="border-color:var(--c-danger)"><b style="color:var(--c-danger)"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-51'/></svg> ${esc(srT("val_import_failed_label"))}</b> ${esc(err.message)}<br><span style="font-size:11.5px;color:var(--c-text2)">${esc(srT("val_import_failed_hint"))}</span></div>`;
      statusEl.style.display="block";
      scrollToEl(statusEl);
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ════ RECENT FILES (Home left rail, "Recent Files") ════
   Home-screen-only convenience list — filename + institution/class/section
   + timestamp ONLY, in localStorage. Deliberately NOT file content, NOT a
   file handle: this app is local-first/no-persistence by design (DPDP Act
   2023 — see PIB §1), so this list is purely a memory-jogger ("which file
   was Section-C again?"), not a real reopen. Clicking an entry just opens
   the native file picker (triggerHomeImport, already wired in
   inline-actions.js) — browsers give web pages no path access to jump
   straight to a specific file without the (Chromium-only) File System
   Access API, which was deliberately not used here to keep this working
   identically across all browsers. Cleared automatically whenever the
   browser's own history/site-data is cleared, same as any localStorage —
   no separate "clear" UI needed for that reason. */
const RECENT_FILES_KEY="studin_recent_files";
const RECENT_FILES_MAX=15;
const RECENT_FILES_FIELD_MAX=200; // per-field char cap, defense in depth vs unbounded localStorage growth
function capField(v){return (v||"").toString().slice(0,RECENT_FILES_FIELD_MAX);}
function getRecentFiles(){
  try{
    const raw=localStorage.getItem(RECENT_FILES_KEY);
    const list=raw?JSON.parse(raw):[];
    if(!Array.isArray(list))return [];
    // NB-8 (prompt.md §11.2): per-entry shape check on parse. The write
    // path caps string fields via capField() but doesn't enforce types, and
    // any prior bad write or external localStorage tampering can leave
    // entries with non-string fields. recentFileKey() calls
    // .trim().toLowerCase() on every field unconditionally — a non-string
    // here (e.g. {fileName: {…}} from a broken earlier build) would throw
    // a TypeError and take the recent-files list down for the rest of the
    // session. Filter out anything that doesn't match the documented
    // shape, rather than trusting raw JSON.
    return list.filter(isRecentFileShape).map(e=>({
      fileName:capField(e.fileName),
      instName:capField(e.instName),
      className:capField(e.className),
      section:capField(e.section),
      ts:typeof e.ts==="number"?e.ts:0,
      isSample:!!e.isSample,
    }));
  }catch(err){
    console.error("getRecentFiles: couldn't read/parse localStorage, treating as empty",err);
    return [];
  }
}
// NB-8: documented shape guard — fileName is the only mandatory field
// (recordRecentFile() refuses to write without one); every other field
// may legitimately be the empty string. isSample is a strict boolean.
function isRecentFileShape(e){
  return e && typeof e==="object" && typeof e.fileName==="string";
}
function recentFileKey(entry){
  // Dedup key is fileName+institution+class+section, not filename alone —
  // two different schools' files can share a generic name (e.g.
  // "marks.xlsx"), and collapsing those into one entry would silently
  // point the admin at the wrong school's history.
  return [entry.fileName,entry.instName,entry.className,entry.section].map(v=>(v||"").trim().toLowerCase()).join("|");
}
function recordRecentFile(entry){
  if(!entry||!entry.fileName)return;
  try{
    const list=getRecentFiles();
    const key=recentFileKey(entry);
    const next=list.filter(e=>recentFileKey(e)!==key); // drop any existing match — moved to top below, not duplicated
    next.unshift({fileName:capField(entry.fileName),instName:capField(entry.instName),className:capField(entry.className),section:capField(entry.section),ts:Date.now(),isSample:!!entry.isSample});
    localStorage.setItem(RECENT_FILES_KEY,JSON.stringify(next.slice(0,RECENT_FILES_MAX)));
  }catch(err){
    // Storage can fail (private browsing, quota) — this is a convenience
    // feature, not core functionality, so fail silently rather than
    // interrupting the actual file import that's in progress.
    console.error("recordRecentFile: couldn't write to localStorage",err);
  }
}
function deleteRecentFile(key){
  try{
    const next=getRecentFiles().filter(e=>recentFileKey(e)!==key);
    localStorage.setItem(RECENT_FILES_KEY,JSON.stringify(next));
  }catch(err){
    console.error("deleteRecentFile: couldn't write to localStorage",err);
  }
  if(typeof renderShellLeftRail==="function") renderShellLeftRail(APP.currentStep||"home");
}

function afterImportSuccess(){
  // Record this import into the Home "Recent Files" list — fileName comes
  // from APP.homeSingleFile (just set by the caller above), institution/
  // class/section from APP.setup (already populated by autoInferSetup()
  // earlier in this same import). Compare-mode multi-file imports don't
  // call this path (see afterAllCompareFilesLoaded/processCompareFile
  // above), so only single-file Home imports feed the recent list — that
  // matches Home being the only screen "Recent Files" appears on.
  if(APP.homeSingleFile&&APP.homeSingleFile.fileName){
    recordRecentFile({
      fileName:APP.homeSingleFile.fileName,
      instName:(APP.setup&&APP.setup.instName)||"",
      className:(APP.setup&&APP.setup.className)||"",
      section:(APP.setup&&APP.setup.section)||"",
      isSample:!!APP._isSampleData
    });
  }
  APP.dataIssues=[]; // reset from any prior session/import; real check happens once analysis runs
  unlockStep("ai");unlockStep("dashboard");unlockStep("export");
  updateExportGate();
  // Task 07: Scholarship nav entry appears as soon as a file is loaded —
  // same moment Current File Details starts showing in the Home rail —
  // not gated on Run Analysis like Insights/Export above.
  updateScholarshipNavVisibility();
  // v3.0 (BUILD spec §2.3, reverses v2.4): no auto-run. A valid import just
  // unlocks the Home "Run Analysis" button — the person clicks it to
  // actually trigger runAnalysis() (loader, goStep('ai'), buckets).
  showHomeRunAnalysisButton();
}
function showHomeRunAnalysisButton(){
  const btn=document.getElementById("btn-home-run-analysis");
  if(!btn)return;
  btn.style.display="inline-flex";
  btn.disabled=false;
  btn.style.opacity=1;btn.style.cursor="pointer";
  // prompt-v4.20 §2: glow/pulse until clicked, so the next action is
  // obvious without hunting for it — reuses the existing .btn-glow
  // animation (same one #btn-generate-pdfs already uses), removed by the
  // button's own onclick (runAnalysis()) the moment it's actually pressed.
  btn.classList.add("btn-glow");
  scrollToEl(btn);
}

// Same reserved template placeholder IDs compute-stats.js's parseStudents()
// filters out post-analysis (kept as a separate copy here, not an import,
// to avoid pulling analysis code into the import path — see that file's
// own comment for why these 5 IDs exist). Used below to catch the file
// BEFORE Run Analysis even becomes clickable, not just after.
const SAMPLE_STUDENT_IDS=new Set(["SAMPLE-1","SAMPLE-2","SAMPLE-3","SAMPLE-4","SAMPLE-5"]);
// True only when EVERY roster row is one of the reserved sample IDs AND
// none of them has anything entered anywhere else in the workbook (any
// test tab, any column besides Student ID). A real student who happens to
// reuse a SAMPLE-N id but has actual marks/absence/remark/chapter data
// still counts as real here — same "any real data anywhere disqualifies
// it" rule parseStudents() uses, just checked on the raw cells since
// nothing has been parsed into marks yet at this point in the flow.
function isUntouchedSampleTemplate(rawData){
  const normId=v=>String(v||"").trim().toUpperCase();
  const studentRows=(rawData&&rawData["STUDENTS"])||[];
  const realRows=studentRows.filter(r=>normId(r["Student ID"]));
  if(!realRows.length)return false; // handled separately by the "no rows at all" check
  if(!realRows.every(r=>SAMPLE_STUDENT_IDS.has(normId(r["Student ID"]))))return false;
  const reservedSheets=new Set(["STUDENTS","SETUP","README","REFERENCE"]);
  for(const sheetName of Object.keys(rawData||{})){
    if(sheetName.startsWith("_"))continue; // skip _sheetIndex/_sheetCollisions/_arr_*/_hdr_* internal keys
    if(reservedSheets.has(sheetName.trim().toUpperCase()))continue;
    const rows=rawData[sheetName];
    if(!Array.isArray(rows))continue;
    for(const row of rows){
      const id=normId(row["Student ID"]);
      if(!id||!SAMPLE_STUDENT_IDS.has(id))continue;
      for(const key of Object.keys(row)){
        if(key==="Student ID")continue;
        const v=row[key];
        if(v!==null&&v!==undefined&&String(v).trim()!=="")return false;
      }
    }
  }
  return true;
}

/* ════ SETUP COMPLETENESS VALIDATION ════ */
function validateSetupData(){
  const s=APP.setup;const errs=[];
  if(!s.instName){errs.push({required:true,tab:"setup",msg:srT("val_setup_missing_institution")});}
  if(!s.className){errs.push({required:true,tab:"setup",msg:srT("val_setup_missing_class")});}
  if(!s.year){errs.push({required:true,tab:"setup",msg:srT("val_setup_missing_year")});}
  if(!s.subjects||!s.subjects.length){errs.push({required:true,tab:"setup",msg:srT("val_setup_no_subjects")});}
  if(!s.tests||!s.tests.length){errs.push({required:true,tab:"setup",msg:srT("val_setup_no_tests")});}
  // BUG FIX: an empty template (SETUP filled in, but no rows on STUDENTS)
  // sailed straight through here into afterImportSuccess() — this check
  // already existed for the "Add Test"/merge upload path
  // (loadMergeSourceFromArrayBuffer) but was missing from THIS path (Home
  // quick-import / Step 2 drop-zone / sample-file load), which is what let
  // a blank template be "analysed" instead of rejected.
  const studentRows=(APP.rawData&&APP.rawData["STUDENTS"])||[];
  if(!studentRows.length){errs.push({required:true,tab:"students",msg:srT(s.mode==="individual"?"val_students_tab_empty_individual":"val_students_tab_empty")});}
  // BUG FIX: a file whose STUDENTS tab still has only the 5 untouched
  // SAMPLE-1..5 template rows (non-zero length, so the check above didn't
  // catch it) used to sail through here, enable Run Analysis, and only
  // fail — silently, with a blank dashboard — after the loader animation
  // finished (parseStudents() drops those rows late, in compute-stats.js).
  // Caught here instead, at the same point the genuinely-empty case is
  // caught, so Run Analysis never becomes clickable for this file either.
  else if(isUntouchedSampleTemplate(APP.rawData)){errs.push({required:true,tab:"students",msg:srT("val_students_tab_all_sample")});}
  if(!s.teacher){errs.push({required:false,tab:"setup",msg:srT("val_setup_teacher_not_set")});}
  if(!s.passThreshold){errs.push({required:false,tab:"setup",msg:srT("val_setup_pass_threshold_not_set")});}
  // Individual mode is one workbook per child — Subjects/Max Marks in
  // SETUP are workbook-global, so a second child in the same STUDENTS tab
  // silently inherits the first child's subject list and max-marks scale
  // (wrong for two kids in different grades). Enforced here, the same
  // choke point every import path (Home quick-import, Step 2 drop-zone,
  // sample-file load) already runs through.
  if(s.mode==="individual"){
    const rosterRows=(APP.rawData&&APP.rawData["STUDENTS"])||[];
    if(rosterRows.length>1){errs.push({required:true,tab:"students",msg:srT("val_individual_one_child_per_file")});}
  }
  // Duplicate subject/test names (case-insensitive, after trimming)
  // silently corrupt per-subject/per-test aggregation downstream since
  // marks are stored keyed by name — a duplicate reuses the same object
  // key and can double-count or overwrite marks. Blocking, not a warning:
  // see EXCEL_DATA_MATH_AUDIT_PROMPT.md item 6. Applies identically to
  // manually entered setup, imported setup, and continuity-period setup,
  // since collectSetupForm()/autoInferSetup()/parseContinuityPeriods() all
  // funnel into this same s.subjects/s.tests shape before this runs.
  const findDupes=list=>{const seen=new Set(),dupes=new Set();(list||[]).forEach(v=>{const k=String(v).trim().toLowerCase();if(seen.has(k))dupes.add(v);seen.add(k);});return[...dupes];};
  const dupeSubjects=findDupes(s.subjects);
  const dupeTests=findDupes((s.tests||[]).map(t=>t.name));
  if(dupeSubjects.length)errs.push({required:true,tab:"setup",msg:srT("val_setup_dupe_subjects",{names:dupeSubjects.join(", ")})});
  if(dupeTests.length)errs.push({required:true,tab:"setup",msg:srT("val_setup_dupe_tests",{names:dupeTests.join(", ")})});
  // Check that tests have subjects with max marks — only for subjects this
  // test actually includes (t.subjectsIncluded). A subject deliberately
  // excluded from a test (unchecked in the per-test picker, or absent from
  // an imported workbook's Max Marks rows for that test) has no maxMarks
  // entry by design — that's not a missing value to warn about, it's not
  // part of this test at all. Checking against the full subject list
  // produced a false "Max Marks not set for Computer Science" warning on
  // every import where a test legitimately didn't cover every subject.
  (s.tests||[]).forEach((t,i)=>{
    const relevantSubjects=(t.subjectsIncluded&&t.subjectsIncluded.length)?t.subjectsIncluded:(s.subjects||[]);
    const missing=relevantSubjects.filter(sub=>!t.maxMarks||!t.maxMarks[sub]);
    if(missing.length)errs.push({required:false,tab:"setup",msg:srT("val_setup_max_marks_not_set",{test:t.name,subjects:missing.join(", ")})});
  });
  // Invalid (supplied-but-not-usable) max marks — 0, negative, decimal,
  // non-numeric — collected by readMaxMark() during autoInferSetup()/
  // parseContinuityPeriods(). These are always blocking: a bad max mark
  // corrupts every percentage/weighted total/trend/grade/ranking that
  // depends on it, with no visible sign anything went wrong. See
  // EXCEL_DATA_MATH_AUDIT_PROMPT.md item 4.
  (s._maxMarkErrors||[]).forEach(e=>{
    errs.push({required:true,tab:"setup",msg:`Invalid maximum mark for "${e.label}": entered "${e.raw}" — ${e.reason}.`});
  });
  // Scholarship Criteria (Task 02, §26): Enable = Yes makes every field in
  // the section required, and the three weightages must sum to 100 — both
  // blocking, same severity as the invalid-max-marks/dupe-name checks
  // above, since a missing criterion or a bad weightage split would
  // silently corrupt Task 04's eligibility engine rather than just being
  // "not filled in yet" (contrast with Teacher/Pass Threshold above, which
  // stay non-blocking).
  const sch=s.scholarship;
  if(sch&&sch.enabled){
    if(!sch.schemeName)errs.push({required:true,tab:"setup",msg:srT("scholarship_required_error",{field:srT("scholarship_scheme_name_label")})});
    if(!sch.eligibilityType)errs.push({required:true,tab:"setup",msg:srT("scholarship_required_error",{field:srT("scholarship_eligibility_type_label")})});
    if(sch.minAcademicAvg===null||sch.minAcademicAvg===undefined)errs.push({required:true,tab:"setup",msg:srT("scholarship_required_error",{field:srT("scholarship_min_academic_avg_label")})});
    if(sch.maxFamilyIncome===null||sch.maxFamilyIncome===undefined)errs.push({required:true,tab:"setup",msg:srT("scholarship_required_error",{field:srT("scholarship_max_family_income_label")})});
    if(sch.attendanceFloor===null||sch.attendanceFloor===undefined)errs.push({required:true,tab:"setup",msg:srT("scholarship_required_error",{field:srT("scholarship_attendance_floor_label")})});
    if(sch.categoryQuota===null||sch.categoryQuota===undefined)errs.push({required:true,tab:"setup",msg:srT("scholarship_required_error",{field:srT("scholarship_category_quota_label")})});
    const wSum=(sch.weightAcademic||0)+(sch.weightConsistency||0)+(sch.weightGrowth||0);
    if(wSum!==100)errs.push({required:true,tab:"setup",msg:srT("scholarship_weightage_sum_error",{sum:wSum})});
  }
  // Sheet-name collisions (two worksheet tabs that normalize to the same
  // name) — see EXCEL_DATA_MATH_AUDIT_PROMPT.md item 5. Always blocking:
  // not a SETUP field, so it's not fixable via the in-app Setup form —
  // needs the actual tab renamed in Excel and re-imported.
  ((APP.rawData&&APP.rawData._sheetCollisions)||[]).forEach(c=>{
    errs.push({required:true,tab:"file",msg:`Two worksheet tabs have the same name once trimmed/case-folded: "${c.names[0]}" and "${c.names[1]}" — rename one of them and re-import.`});
  });
  return errs;
}

/* ════ renderHomePage ════ */
function renderHomePage(){
  // Always start fresh — stateless
  APP.setup={mode:"institution",modeLocked:false,instName:"",instType:"",location:"",contact:"",className:"",section:"",year:"",teacher:"",scoring:{marks:true,pct:true,grade:false,pf:false},passThreshold:35,absentAlert:3,dropAlert:20,subjects:[],tests:[]};
  APP.rawData=null;APP.students=[];APP.classStats=null;APP.genderAnalysis=null;
  APP.mergeMode=false;APP.mergeSource=null;$("#merge-banner").hide();
  APP.compareMode=false;APP.sections=[];APP.sectionComparison=[];APP.homeSingleFile=null;
  // Issue 3 fix — see the matching comment in project-setup.js's
  // startNewSession(). renderHomePage() is the shared exit point for both
  // Home reset and resetHomeImport(), so clearing continuity here covers
  // both boundaries.
  APP.continuity=null;APP._continuityActivePeriodIdx=0;APP._continuitySelectedId=null;
  $("#btn-download-template").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-22'/></svg> "+i18nLabel("setup_btn_download_template","Download Template"));$("#btn-load-existing").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-08'/></svg> "+i18nLabel("setup_btn_load_existing","Load Existing Filled Sheet"));
  // Bug fix: renderHomePage() reset every other piece of import state but
  // never reset the "Run Analysis" button itself — so after removing the
  // only uploaded file (resetHomeImport -> renderHomePage), the button
  // stayed visible/enabled from before, letting the user run analysis
  // with nothing uploaded. Always hide/disable it on a fresh Home render;
  // a real import re-enables it via showHomeRunAnalysisButton().
  (function(){const btn=document.getElementById("btn-home-run-analysis");if(btn){btn.style.display="none";btn.disabled=true;btn.style.opacity=.45;btn.style.cursor="not-allowed";btn.classList.remove("btn-glow");}})();
  // Reset stepper
  document.querySelectorAll(".step-item").forEach(el=>{el.classList.remove("active");el.classList.add("locked");});
  updateScholarshipNavVisibility(); // Task 07: hide again — homeSingleFile/sections just cleared above
  document.querySelector('.step-item[data-step="home"]')?.classList.remove("locked");
  document.querySelector('.step-item[data-step="setup"]')?.classList.remove("locked");
  document.querySelector('.step-item[data-step="about"]')?.classList.remove("locked");
  document.querySelector('.step-item[data-step="samplefiles"]')?.classList.remove("locked");
  document.querySelector('.step-item[data-step="faq"]')?.classList.remove("locked");
  // Clear any leftover import result card (success/warning/error) from a
  // previous file so Home always starts blank — on refresh and whenever
  // the user navigates back here.
  $("#home-import-status").hide().empty();
  $("#home-file-list").hide().empty();
  // Safety reset — home-paths-grid is never hidden anymore during import
  // (v3.1 bug fix: it used to be, which hid the Run Analysis button along
  // with it since both live in the same wrapper), but keep this here in
  // case anything else ever touches its visibility.
  $("#home-paths-grid").show();
  // The header's session-name badge (e.g. "Apex IAS Academy") is only ever
  // set when a setup/import loads (see line ~1854); Home resetting APP.setup
  // above must also clear it here, or it keeps showing the previous
  // institution's name after the user returns Home.
  $("#session-name-badge").hide().text("");
  // Re-sync the Setup panel's mode cards (border highlight + lock state) to
  // the just-reset APP.setup — without this, a mode locked by a previous
  // project would stay visually disabled even after this fresh reset.
  setUsageMode("institution",true);
  applyCompareModeUI();
  // Bug fix: the lines above only reset the in-memory APP.setup object —
  // the actual Setup panel <input> fields (institution name, class name,
  // subjects, tests, etc.) were never cleared, so clicking "New Project"
  // right after this used to land on a Setup screen still showing the
  // PREVIOUS project's data, even though APP.setup itself was already
  // blank. Sync the visible form to match now, so it's genuinely blank
  // before the user ever gets there.
  fillSetupForm(APP.setup);
}
// "Not this file" / "Wrong file?" — Home import found a problem (or the
// user just changed their mind) and wants to pick a different file. Reuses
// the same full reset as navigating back to Home, then clears the file
// input so the browser doesn't refuse a re-selection of the same filename.
function resetHomeImport(){
  renderHomePage();
  const fileInput=document.getElementById("home-import-input");
  if(fileInput)fileInput.value="";
  scrollToEl(document.getElementById("panel-home"));
}

/* ════ FILE UPLOAD (Step 2 drop-zone) ════ */
// v3.0 rev2 (BUILD spec §10.1): triggerFileUpload()/handleFileSelect()/
// handleFileDrop()/processFile()/parseWorkbook() removed — their DOM
// (#file-input, #drop-zone, #btn-data-continue, #data-loaded-card) no
// longer exists now that the Upload Data panel is gone. Home's drop zone
// (handleHomeImportFiles → processCompareFile) is the only upload path
// now, for 1 file or many alike. CSV upload support (accepted here, never
// by Home's .xlsx/.xls-only zone) is dropped along with this panel.
// prompt-01-schema-foundation-2period.md / prompt-02-nperiod-import-fork.md's
// designed multi-period SETUP schema, parsed for real. Reads the repeated
// "Period N Label" / "Period N Subject i" / "Period N Test t Name" /
// "Period N Max Marks - <Subject> (Test t)" blocks kv already holds (same
// flat-row SETUP-sheet scan autoInferSetup always did — nothing new about
// HOW these get read, just WHICH keys). Two things happen:
//   1. APP.continuity gets built — {periods, subjectsByPeriod, students:
//      [{id,name,pctByPeriod}]} — the exact shape js/continuity-dashboard.js
//      already reads (built against fixture data originally; this is the
//      first time anything real produces that shape).
//   2. The CURRENT period (always the last one, per prompt-02) has its
//      Subject/Test/Max-Marks keys ALIASED onto kv's plain "Subject i" /
//      "Test t Name" / "Max Marks - X (Test t)" keys — so every line of
//      autoInferSetup below this call, and parseStudents() after it, run
//      completely unchanged and parse the current period as if it were an
//      ordinary single-period file. Only the current period gets full
//      detailed analysis (KPIs/heatmap/flags/wellbeing) — earlier periods
//      only feed the lighter Continuity dashboard's per-period % — exactly
//      the split prompt-02 specified, achieved by NOT touching that
//      pipeline at all rather than teaching it about periods.
// extractPeriodBlocks(kv) — pure read of the repeated "Period N ..."
// blocks, no side effects (no APP.* writes). Shared by parseContinuityPeriods
// (below) and generateContinuityAppendTemplate() (the "Start a new class/
// semester" fork, which needs an ALREADY-multi-period source's existing
// blocks copied through verbatim when appending yet another period).
// Returns [] when Period Count is absent/1 — a plain legacy single-period
// source, not an error.
// Records one invalid-max-mark finding against APP.setup._maxMarkErrors
// (reset per real import at the top of autoInferSetup()) so validateData()
// can turn it into a blocking error naming the precise SETUP label/test/
// subject, per EXCEL_DATA_MATH_AUDIT_PROMPT.md item 4. A genuinely blank
// max-mark field is NOT an error here — callers fall back to 100 only for
// that case, via readMaxMark()'s own blank handling below.
function recordMaxMarkError(label,raw,reason){
  if(!APP.setup._maxMarkErrors)APP.setup._maxMarkErrors=[];
  APP.setup._maxMarkErrors.push({label,raw,reason});
}
// Shared strict max-mark read: valid supplied value -> use it; genuinely
// blank field -> the documented legacy fallback of 100; anything else
// (0, negative, non-integer, non-numeric) -> record a blocking error and
// still return 100 as a placeholder so downstream code has *a* number to
// run with, but the workbook is rejected before analysis regardless.
function readMaxMark(raw,label){
  const r=parseStrictMaxMark(raw);
  if(r.status==="valid")return r.value;
  if(r.status==="blank")return 100;
  recordMaxMarkError(label,raw,r.reason);
  return 100;
}
function extractPeriodBlocks(kv){
  const periodCount=parseInt(kv["Period Count"])||0;
  if(periodCount<2)return [];
  const periods=[];
  for(let p=1;p<=periodCount;p++){
    const label=kv[`Period ${p} Label`]||`Period ${p}`;
    const year=kv[`Period ${p} Academic Year / Term`]||"";
    const teacher=kv[`Period ${p} Teacher / Coordinator`]||"";
    const subjects=[];let si=1;
    while(kv[`Period ${p} Subject ${si}`]){subjects.push(kv[`Period ${p} Subject ${si}`]);si++;}
    const tests=[];let ti=1;
    while(kv[`Period ${p} Test ${ti} Name`]){
      const tname=kv[`Period ${p} Test ${ti} Name`];
      const date=kv[`Period ${p} Test ${ti} Date`]||"";
      const maxMarks={};const subjectsIncluded=[];
      // Same fix as the main (non-continuity) Format-A parser above: only a
      // subject with an actual "Period N Max Marks - X (Test M)" key present
      // is part of this test. Previously every period subject got a maxMarks
      // entry unconditionally (missing ones silently defaulted to 100 via
      // readMaxMark(undefined,...)), and since no subjectsIncluded was
      // recorded, that phantom 100 flowed into the current period's
      // Format-A aliasing below and inflated the denominator for a subject
      // no one was actually tested on.
      subjects.forEach(s=>{
        const raw=kv[`Period ${p} Max Marks - ${s} (Test ${ti})`];
        if(raw===undefined)return;
        maxMarks[s]=readMaxMark(raw,`Period ${p} Max Marks - ${s} (Test ${ti})`);
        subjectsIncluded.push(s);
      });
      tests.push({name:tname,date,maxMarks,subjectsIncluded});
      ti++;
    }
    periods.push({label,year,teacher,subjects,tests});
  }
  return periods;
}
function parseContinuityPeriods(kv){
  const periods=extractPeriodBlocks(kv);
  if(!periods.length)return;
  const periodCount=periods.length;
  APP.setup.periodCount=periodCount; // gates the Continuity rail item (js/render-buckets.js buildDashboardControlsHtml)

  // Alias the CURRENT (last) period's flat keys — "current period = last
  // period in file, always, no manual override this phase" (prompt-02).
  const cur=periods[periods.length-1];
  if(!kv["Class / Batch"])kv["Class / Batch"]=cur.label;
  if(!kv["Academic Year"]&&cur.year)kv["Academic Year"]=cur.year;
  cur.subjects.forEach((s,i)=>{kv[`Subject ${i+1}`]=s;});
  cur.tests.forEach((t,i)=>{
    kv[`Test ${i+1} Name`]=t.name;
    // Only alias subjects this test actually covers (t.subjectsIncluded, set
    // above in extractPeriodBlocks) — aliasing every cur.subjects entry
    // unconditionally used to manufacture a "Max Marks - X (Test N)" key
    // for a subject this test never included, which then defeated the main
    // Format-A parser's own subjectsIncluded restriction (it saw the key
    // present and wrongly counted the subject in).
    (t.subjectsIncluded||cur.subjects).forEach(s=>{kv[`Max Marks - ${s} (Test ${i+1})`]=String(t.maxMarks[s]);});
  });

  // Build APP.continuity — per-student overall % per period, present-only
  // (absence is a real gap, never zero-filled — same rule the dashboard's
  // cohort chart and roster badges already enforce, now fed real data
  // instead of only the fixture in js/continuity-dashboard.js).
  const rosterRows=APP.rawData["STUDENTS"]||[];
  const rosterIds=[],rosterNames={};
  rosterRows.forEach(row=>{
    const id=String(row["Student ID"]||"").trim();
    if(!id||id in rosterNames)return;
    rosterIds.push(id);rosterNames[id]=String(row["Full Name"]||"").trim()||id;
  });
  const students=rosterIds.map(id=>({id,name:rosterNames[id],pctByPeriod:periods.map(()=>null)}));
  const idxOf={};students.forEach((s,i)=>{idxOf[s.id]=i;});

  periods.forEach((p,pIdx)=>{
    const acc={}; // id -> {sum,cnt} of per-test average %, across this period's tests
    p.tests.forEach(t=>{
      // Same canonical (trim + case-fold) sheet lookup as parseStudents()/
      // validateData() — item 5. Without this, a period test whose tab
      // name differs only in case from its SETUP-period label would
      // silently contribute nothing to continuity, with no error shown.
      const resolvedKey=resolveSheetName(APP.rawData,t.name);
      const sheet=resolvedKey?APP.rawData[resolvedKey]:undefined;
      if(!sheet)return;
      sheet.forEach(row=>{
        const id=String(row["Student ID"]||"").trim();
        if(!id||!(id in idxOf))return;
        let sum=0,cnt=0;
        p.subjects.forEach(s=>{
          const raw=row[s+" Marks"]!==undefined?row[s+" Marks"]:row[s];
          if(raw===undefined||raw===null||raw==="")return;
          // Strict parse (item 2) — this is the continuity-period path
          // parseStudents() itself doesn't cover. A malformed value here
          // must be skipped, exactly like a blank cell, never
          // reinterpreted into a different number that quietly feeds
          // into a student's cross-period trend.
          const parsed=parseStrictMark(raw);
          if(parsed.status!=="valid"||parsed.value<0)return;
          const n=parsed.value;
          const mx=t.maxMarks[s]||100;
          sum+=Math.max(0,Math.min(100,(n/mx)*100));cnt++;
        });
        if(!cnt)return;
        if(!acc[id])acc[id]={sum:0,cnt:0};
        acc[id].sum+=sum/cnt;acc[id].cnt+=1;
      });
    });
    Object.keys(acc).forEach(id=>{students[idxOf[id]].pctByPeriod[pIdx]=Math.round(acc[id].sum/acc[id].cnt);});
  });

  APP.continuity={periods:periods.map(p=>({label:p.label,year:p.year})),
    subjectsByPeriod:periods.map(p=>p.subjects.slice()),students,institutionType:kv["Type"]||""};
}

// Shared by autoInferSetup() and the "Start a new class/semester" fork
// (loadMergeSourceFromArrayBuffer/generateContinuityAppendTemplate) — both
// need the same flat key->value scan of a SETUP sheet's raw rows.
// Presence-check (not truthiness-check) when reading each SETUP row's
// value: a literal 0 (e.g. an explicitly-entered max mark of 0) is falsy
// in JS but a genuinely SUPPLIED value — `String(v||"")` would silently
// turn 0 into "" and drop the key entirely, so autoInferSetup() would
// never even see it to flag it as invalid, reproducing the exact
// "0 silently becomes 100" bug the item-4 fix was supposed to close, one
// layer further upstream than autoInferSetup() itself. See
// EXCEL_DATA_MATH_AUDIT_PROMPT.md item 4.
function buildSetupKv(setupSheet){
  const kv={};
  (setupSheet||[]).forEach(row=>{
    const rawK=Object.values(row)[0],rawV=Object.values(row)[1];
    const k=String(rawK===undefined||rawK===null?"":rawK).trim();
    const v=String(rawV===undefined||rawV===null?"":rawV).trim();
    if(k&&v)kv[k]=v;
  });
  return kv;
}
function autoInferSetup(){
  const setupSheet=APP.rawData["SETUP"]||[];if(!setupSheet.length)return true;
  APP.setup._maxMarkErrors=[]; // reset per import — see recordMaxMarkError()
  const kv=buildSetupKv(setupSheet);
  // Step 2 (feature-toggle-pattern.md): compute Feature_X flags once per
  // file load. Missing rows default to Yes, so every existing sample/
  // institution file (none of which have Feature_X rows today) behaves
  // identically to before this step. See core/read-feature-flags.js.
  // APP._rawFeatures keeps the untouched Excel-parsed Feature_X flags;
  // APP.features is the *effective* set every check site in the app
  // actually reads, derived from the raw set via applyCountryScholarshipGate()
  // (India-only feature — see that function's own comment). Kept as two
  // separate fields, not one mutated in place, so switching the country
  // dropdown back to India can restore the file's real
  // Feature_Scholarship setting instead of it staying stuck "off" —
  // see onCountryChange() in core/state-nav.js, which recomputes
  // APP.features from APP._rawFeatures on every country change.
  APP._rawFeatures=readFeatureFlags(setupSheet);
  APP.features=applyCountryScholarshipGate(APP._rawFeatures, APP.country);
  // NB-5 (prompt.md §11.2): updateSmartLauncherVisibility() removed — the
  // floating Smart Search launcher it used to drive is gone with
  // smart-query-v2-ui.js.
  // Issue 3 fix: a single-period workbook replacing a file within an
  // already-open Home page must not leave a PRIOR file's continuity state
  // behind. parseContinuityPeriods(kv) below only runs (and rebuilds
  // APP.continuity) for a genuine multi-period file, so a plain
  // single-period replacement would otherwise silently keep showing the
  // previous file's longitudinal trends/labels. Clear unconditionally
  // here, before the Period Count check, so both paths start clean.
  APP.continuity=null;APP._continuityActivePeriodIdx=0;APP._continuitySelectedId=null;
  // ── CONTINUITY: multi-period SETUP (prompt-01/02's designed schema,
  // finally wired up — see PIB §9 continuity-schema-not-built-yet for
  // the long history of this being flagged as missing). If "Period
  // Count" is absent or 1, this is a complete no-op and every line below
  // runs exactly as it always has — zero behavior change for any
  // existing single-period file, legacy or otherwise.
  if((parseInt(kv["Period Count"])||0)>1)parseContinuityPeriods(kv);
  // Free-text SETUP fields had no length cap at all — unlike Full Name
  // (120) and Remark (1000), a huge pasted blob into e.g. Institution
  // Name could still distort PDF/table headers with no warning. Same
  // pattern as those: truncate, keep going (never block import over
  // this), surface ONE consolidated toast naming which fields got cut.
  const FIELD_MAX=120;
  const truncatedFields=[];
  const capField=(raw,max,label)=>{
    const s=String(raw);
    if(s.length<=max)return s;
    truncatedFields.push(label);
    return s.slice(0,max);
  };
  if(kv["Usage Mode"]){
    const fileMode=kv["Usage Mode"]==="individual"?"individual":"institution";
    // E1: a session already in progress (has a name typed in, or students
    // already loaded) that conflicts with the imported file's embedded mode
    // is a real misuse risk (e.g. a parent's Individual session receiving an
    // Institution-mode roster) — confirm before silently overwriting the
    // session's mode and swallowing the other file's data un-labeled.
    const sessionInProgress=!!(APP.setup.instName||APP.students.length);
    if(sessionInProgress&&fileMode!==APP.setup.mode){
      const fileLabel=fileMode==="individual"?srT("val_mode_individual"):srT("val_mode_institution"),curLabel=APP.setup.mode==="individual"?srT("val_mode_individual"):srT("val_mode_institution");
      const proceed=confirm(srT("val_mode_mismatch_confirm",{fileLabel:fileLabel,curLabel:curLabel}));
      if(!proceed){toast(srT("toast_import_cancelled"),"warn");APP.rawData=null;return false;}
    }
    APP.setup.mode=fileMode;
    lockUsageMode(); // a real file's data now defines this mode — no more switching without a new project
  }
  if(kv["Institution Name"])APP.setup.instName=capField(kv["Institution Name"],FIELD_MAX,"Institution Name");
  if(kv["Type"])APP.setup.instType=kv["Type"];
  if(kv["Location"])APP.setup.location=capField(kv["Location"],FIELD_MAX,"Location");
  if(kv["Contact"])APP.setup.contact=capField(kv["Contact"],FIELD_MAX,"Contact");
  if(kv["Class / Batch"])APP.setup.className=capField(kv["Class / Batch"],FIELD_MAX,"Class / Batch");
  if(kv["Section"])APP.setup.section=capField(kv["Section"],FIELD_MAX,"Section");
  if(kv["Academic Year"])APP.setup.year=capField(kv["Academic Year"],FIELD_MAX,"Academic Year");
  // Support "Teacher Name" variant BEFORE reading Class Teacher, so either label works
  if(kv["Teacher Name"]&&!kv["Class Teacher"])kv["Class Teacher"]=kv["Teacher Name"];
  // Absent alert: "Absent Alert (days)" variant — also resolve before use
  if(kv["Absent Alert (days)"]&&!kv["Absent Alert Days"])kv["Absent Alert Days"]=kv["Absent Alert (days)"];
  if(kv["Class Teacher"])APP.setup.teacher=capField(kv["Class Teacher"],FIELD_MAX,"Class Teacher");
  const clampImportedNum=(raw,min,max,fallback)=>{const n=parseInt(raw);return isNaN(n)?fallback:Math.min(max,Math.max(min,n));};
  if(kv["Pass Threshold %"])APP.setup.passThreshold=clampImportedNum(kv["Pass Threshold %"],0,100,35);
  if(kv["Absent Alert Days"])APP.setup.absentAlert=clampImportedNum(kv["Absent Alert Days"],0,365,3);
  if(kv["Sharp Drop Alert %"])APP.setup.dropAlert=clampImportedNum(kv["Sharp Drop Alert %"],0,100,20);
  // Task 02: SCHOLARSHIP CRITERIA read-back. buildSetupKv() above already
  // ignores any column beyond B (the Category Quota note) and any row
  // whose key nothing here reads — so a legacy sample file's leftover
  // "Weightage - Attendance" row (superseded by this task, see spec) is
  // silently skipped, never looked up, never thrown on.
  if(kv["Enable Scholarship Module"]!==undefined||kv["Scheme Name"]!==undefined){
    const isYes=v=>String(v||"").trim().toLowerCase()==="yes";
    APP.setup.scholarship={
      enabled:isYes(kv["Enable Scholarship Module"]),
      schemeName:capField(kv["Scheme Name"]||"",FIELD_MAX,"Scheme Name"),
      eligibilityType:kv["Eligibility Type"]||"",
      minAcademicAvg:kv["Min Academic Avg %"]!==undefined?clampImportedNum(kv["Min Academic Avg %"],0,100,null):null,
      maxFamilyIncome:kv["Max Family Income (INR)"]!==undefined?clampImportedNum(kv["Max Family Income (INR)"],0,999999999,null):null,
      noFailRule:isYes(kv["No-Fail Rule (Y/N)"]),
      attendanceFloor:kv["Attendance Floor - Max Absent Days (total across tests)"]!==undefined?clampImportedNum(kv["Attendance Floor - Max Absent Days (total across tests)"],0,365,null):null,
      categoryQuota:kv["Category Quota %"]!==undefined?clampImportedNum(kv["Category Quota %"],0,100,null):null,
      weightAcademic:kv["Weightage - Academic"]!==undefined?clampImportedNum(kv["Weightage - Academic"],0,100,60):60,
      weightConsistency:kv["Weightage - Consistency"]!==undefined?clampImportedNum(kv["Weightage - Consistency"],0,100,20):20,
      weightGrowth:kv["Weightage - Growth"]!==undefined?clampImportedNum(kv["Weightage - Growth"],0,100,20):20,
    };
  }
  const subjects=[];let i=1;while(kv["Subject "+i]){subjects.push(kv["Subject "+i]);i++;}
  if(subjects.length)APP.setup.subjects=subjects;

  // Build raw rows for Format B parsing ["Test 1","Unit Test 1","Max Marks",50]
  const rawRows=setupSheet.map(row=>Object.values(row));

  const tests=[];let t=1;
  // Format A: kv has "Test 1 Name"
  // Format B: kv has "Test 1" = "Unit Test 1", and raw row has ["Test 1","Unit Test 1","Max Marks",50]
  while(kv["Test "+t+" Name"]||kv["Test "+t]){
    const name=kv["Test "+t+" Name"]||kv["Test "+t]||"";
    if(!name){t++;continue;}
    const maxMarks={};
    // subjectsIncluded: which subjects this specific test actually covers.
    // Format A only writes a "Max Marks - X (Test N)" row for subjects the
    // Setup UI's per-test picker had checked (see buildSetupSheet()) — a
    // subject with no such row here was deliberately excluded from this
    // test, not just "not filled in yet". Previously this parser read
    // every subject regardless (defaulting a missing one to the 100
    // legacy fallback via readMaxMark(null,...)) and never set
    // subjectsIncluded at all, so fillSetupForm()/collectSetupForm()'s own
    // "no subjectsIncluded -> default every subject to included" fallback
    // then wrongly re-included it — adding its max marks to the
    // denominator with no matching numerator and deflating the test %
    // (e.g. a student who actually scored 87% on the 7 subjects a test
    // covered showed as 55% once an 8th, untested subject's max marks got
    // counted against them). Restrict both maxMarks and subjectsIncluded
    // to subjects with an actual row present, matching the write side.
    const subjectsIncluded=[];
    // Format A: per-subject max marks stored separately
    // Presence-check (not truthiness-check) for Format A detection/lookup:
    // a supplied max mark of 0 is falsy but MUST still be treated as
    // "present" so it reaches readMaxMark() and gets flagged as invalid —
    // `kv[k]||kv[k2]` would silently treat an explicit 0 as "absent" and
    // fall through to null (-> the 100 legacy fallback), reproducing the
    // exact item-4 bug for that one value. See EXCEL_DATA_MATH_AUDIT_PROMPT.md item 4.
    const hasFormatA=subjects.some(s=>kv["Max Marks - "+s+" (Test "+t+")"]!==undefined||kv["Max Marks — "+s+" (Test "+t+")"]!==undefined);
    if(hasFormatA){
      subjects.forEach(s=>{
        const vA=kv["Max Marks - "+s+" (Test "+t+")"],vB=kv["Max Marks — "+s+" (Test "+t+")"];
        if(vA===undefined&&vB===undefined)return; // no row for this subject -> not part of this test
        const v=vA!==undefined?vA:vB;
        maxMarks[s]=readMaxMark(v,`Max Marks - ${s} (Test ${t}: ${name})`);
        subjectsIncluded.push(s);
      });
    } else {
      // Format B: one global max for all subjects, found in same row as test name —
      // no per-subject picker in this legacy format, so every subject applies.
      const testRow=rawRows.find(r=>String(r[0]||"").trim()==="Test "+t&&String(r[1]||"").trim()===name);
      const globalRaw=testRow&&testRow[2]==="Max Marks"?testRow[3]:null;
      const globalMax=readMaxMark(globalRaw,`Max Marks (Test ${t}: ${name})`);
      subjects.forEach(s=>{maxMarks[s]=globalMax;subjectsIncluded.push(s);});
    }
    tests.push({name,date:kv["Test "+t+" Date"]||"",maxMarks,subjectsIncluded});
    t++;
  }
  if(tests.length)APP.setup.tests=tests;
  // Even legacy files without a "Usage Mode" cell still commit this session
  // to whichever mode is currently active, once they've supplied real
  // subjects/tests — lock here too so a later mode-card click can't silently
  // orphan the data just loaded.
  if(subjects.length||tests.length)lockUsageMode();
  if(truncatedFields.length)toast(srT("val_setup_fields_truncated",{fields:truncatedFields.join(", "),max:FIELD_MAX}),"warn");
  fillSetupForm(APP.setup);$("#session-name-badge").text(APP.setup.instName||"Session").show();
  return true;
}

/* ════ AI CHECKBOXES ════ */
const AI_FEATURES={
  perf:[
    {id:"avg",label:"Subject-wise Average",sub:"Mean marks per subject per test"},
    {id:"pct",label:"Percentage Calculation",sub:"% score per subject and overall"},
    {id:"rank",label:"Class Ranking",sub:"Rank 1–N by overall average"},
    {id:"grade",label:"Grade Assignment",sub:"A/B/C/D/F by percentage bands"},
    {id:"trend",label:"Performance Trend",sub:"Improving / Stable / Declining across tests"},
    {id:"prediction",label:"Next Test Prediction",sub:"Projected score from trend (2+ tests)"},
    {id:"percentile",label:"Percentile Calculation",sub:"Where student stands within the class"},
    {id:"subject_strength",label:"Subject Strength & Weakness",sub:"Best and weakest subject per student"},
    {id:"consistency",label:"Consistency Score",sub:"Low variance = consistent; high = unpredictable"},
    {id:"growth_rate",label:"Growth Rate",sub:"Score velocity — how fast improving or declining"},
    {id:"topper_gap",label:"Topper Gap Analysis",sub:"How far each student is from class topper"},
    {id:"cumulative",label:"Cumulative Average",sub:"Running average across all tests to date"},
  ],
  warn:[
    {id:"at_risk",label:"At-Risk Detection",sub:"Scored below pass threshold in any subject"},
    {id:"sharp_drop",label:"Sharp Drop Alert",sub:"Sudden marks drop ≥ configurable % between tests"},
    {id:"chronic_absent",label:"Chronic Absenteeism",sub:"Exceeds absence threshold near test dates"},
    {id:"volatile",label:"Volatile Performance",sub:"High score variance — inconsistent pattern"},
    {id:"multiple_fails",label:"Multiple Subject Failures",sub:"Failing in 2 or more subjects simultaneously"},
    {id:"class_difficulty",label:"Class Difficulty Flag",sub:"Subject where >40% of class is struggling"},
    {id:"plateau",label:"Plateau Detection",sub:"No improvement across 3+ consecutive tests"},
    {id:"early_warning",label:"Early Warning Score",sub:"Composite risk score for proactive intervention"},
    {id:"peer_outlier",label:"Peer Outlier",sub:"Performing unusually above or below peer group"},
    {id:"subject_collapse",label:"Subject Collapse",sub:"Was strong, now suddenly failing in a subject"},
  ],
  narr:[
    {id:"parent_summary",label:"Parent-Friendly Summary",sub:"Plain-language progress narrative for parents"},
    {id:"motivation",label:"Motivational Message",sub:"Personalised encouragement based on trend"},
    {id:"study_plan",label:"Study Plan",sub:"Targeted recommendations for weak subjects"},
    {id:"intervention",label:"Intervention Note",sub:"Teacher guidance for at-risk students"},
    {id:"strengths_letter",label:"Strengths Letter",sub:"Highlight what the student excels at"},
    {id:"competitive_readiness",label:"Competitive Readiness",sub:"Readiness signal for entrance exams (JEE/NEET/IAS)"},
    {id:"teacher_remarks_ai",label:"AI Remark Sentiment",sub:"Classify teacher remarks as positive / neutral / concern"},
    {id:"progress_narrative",label:"Progress Narrative",sub:"Story of the student's journey across all tests"},
  ],
  well:[
    {id:"stress_score",label:"Stress Indicator",sub:"Composite score from volatility, absences & trend"},
    {id:"anxiety_flag",label:"Anxiety Flag",sub:"Pattern of consistent underperformance suggesting anxiety"},
    {id:"wellbeing_summary",label:"Wellbeing Summary",sub:"Class-level psychosocial overview for teacher"},
    {id:"burnout_risk",label:"Burnout Risk",sub:"Declining performance after previous high scores"},
    {id:"resilience_score",label:"Resilience Score",sub:"Ability to recover after a drop — positive rebound"},
    {id:"engagement_index",label:"Engagement Index",sub:"Proxy for class engagement via attendance + trend"},
  ],
  mgmt:[
    {id:"class_health",label:"Class Health Score",sub:"Overall class performance index 0–100"},
    {id:"subject_audit",label:"Subject Audit",sub:"Which subjects need curriculum or teaching review"},
    {id:"intervention_priority",label:"Intervention Priority List",sub:"Ranked list of students needing immediate support"},
    {id:"test_difficulty",label:"Test Difficulty Analysis",sub:"Was the test too hard or too easy vs class history"},
    {id:"year_projection",label:"Year-End Projection",sub:"Projected final scores based on current trajectory"},
    {id:"diversity_analysis",label:"Gender & Group Analysis",sub:"Performance patterns across gender groups"},
  ],
};
function renderAICheckboxes(){
  // v4.2: label/sub now resolved via i18nLabel("ai_<id>_label"/"ai_<id>_sub")
  // instead of reading f.label/f.sub directly — AI_FEATURES itself stays
  // English-only as the canonical fallback/data source; the display text
  // comes from the current language's i18n table when available.
  function makeGrid(items,cid){$("#"+cid).html(items.map(f=>`<div class="ai-check-item ${APP.aiFeatures.has(f.id)?"selected":""}" data-action="toggleAI" data-arg="${f.id}"><input type="checkbox" ${APP.aiFeatures.has(f.id)?"checked":""} data-action="toggleAI" data-arg="${f.id}"/><div><div class="ai-check-label">${i18nLabel("ai_"+f.id+"_label",f.label)}</div><div class="ai-check-sub">${i18nLabel("ai_"+f.id+"_sub",f.sub)}</div></div></div>`).join(""));}
  makeGrid(AI_FEATURES.perf,"ai-perf-checks");makeGrid(AI_FEATURES.warn,"ai-warn-checks");makeGrid(AI_FEATURES.narr,"ai-narr-checks");makeGrid(AI_FEATURES.well,"ai-well-checks");makeGrid(AI_FEATURES.mgmt,"ai-mgmt-checks");updateAICount();
}
function toggleAI(id,el){if(APP.aiFeatures.has(id))APP.aiFeatures.delete(id);else APP.aiFeatures.add(id);$(el).toggleClass("selected",APP.aiFeatures.has(id));$(el).find("input[type=checkbox]").prop("checked",APP.aiFeatures.has(id));updateAICount();}
function selectAllAI(){Object.values(AI_FEATURES).flat().forEach(f=>APP.aiFeatures.add(f.id));renderAICheckboxes();toast(srT("toast_all_ai_features_selected",{count:APP.aiFeatures.size}),"success");}
function clearAllAI(){APP.aiFeatures.clear();renderAICheckboxes();}
function updateAICount(){$("#ai-selected-count").text(APP.aiFeatures.size+" features selected");
  // vs-shell-plan-v2 Task 5: right-rail "Selected features" count, same
  // trigger point as the existing #ai-selected-count text above.
  if(typeof renderShellRightRail==="function" && APP.currentStep==="ai") renderShellRightRail("ai");
}


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { AI_FEATURES, REFERENCE_LISTS, TPL_STYLE, afterAllCompareFilesLoaded, deriveUpdateFilenames, afterImportSuccess, applyTabPrefix, autoInferSetup, buildReadmeSheet, buildReferenceSheet, buildSetupSheet, buildStudentsSheet, buildTestSheet, buildTestSheetWithFormulas, buildSheetIndex, cancelMergeMode, canonicalSheetKey, chooseMergeFork, classPrefixForTabs, clearAllAI, colLetter, confirmMergedDownload, deleteRecentFile, downloadWorkbookWithScholarshipValidation, generateBulkSectionTemplates, generateMergedTemplate, generateTemplate, getRecentFiles, goHomeAfterDownload, handleHomeImport, handleHomeImportFiles, handleUpdateUpload, injectScholarshipDataValidations, loadMergeSourceFromArrayBuffer, parseContinuityPeriods, parseReferenceSheet, parseWorkbookSheets, renderAICheckboxes, renderHomePage, renderMergeConfirmModal, resetHomeImport, resolveSheetName, safeSheetName, selectAllAI, showHomeRunAnalysisButton, showPostDownloadPrompt, showScholarshipSetupSavedModal, stayAfterDownload, timestampTag, toggleAI, toggleBulkSectionsUI, toggleScholarshipUI, updateAICount, updateAndDownloadScholarshipSetup, validateScholarshipCriteria, validateScholarshipWeightage, validateSetupData, validateUploadFile };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window.AI_FEATURES=AI_FEATURES;window.REFERENCE_LISTS=REFERENCE_LISTS;window.TPL_STYLE=TPL_STYLE;window.deriveUpdateFilenames=deriveUpdateFilenames;window.afterAllCompareFilesLoaded=afterAllCompareFilesLoaded;window.afterImportSuccess=afterImportSuccess;window.applyTabPrefix=applyTabPrefix;window.autoInferSetup=autoInferSetup;window.buildReadmeSheet=buildReadmeSheet;window.buildReferenceSheet=buildReferenceSheet;window.buildSetupSheet=buildSetupSheet;window.buildStudentsSheet=buildStudentsSheet;window.buildTestSheet=buildTestSheet;window.buildTestSheetWithFormulas=buildTestSheetWithFormulas;window.buildSheetIndex=buildSheetIndex;window.canonicalSheetKey=canonicalSheetKey;window.cancelMergeMode=cancelMergeMode;window.chooseMergeFork=chooseMergeFork;window.classPrefixForTabs=classPrefixForTabs;window.clearAllAI=clearAllAI;window.colLetter=colLetter;window.confirmMergedDownload=confirmMergedDownload;window.generateBulkSectionTemplates=generateBulkSectionTemplates;window.generateMergedTemplate=generateMergedTemplate;window.generateTemplate=generateTemplate;window.getRecentFiles=getRecentFiles;window.deleteRecentFile=deleteRecentFile;window.downloadWorkbookWithScholarshipValidation=downloadWorkbookWithScholarshipValidation;window.goHomeAfterDownload=goHomeAfterDownload;window.showPostDownloadPrompt=showPostDownloadPrompt;window.stayAfterDownload=stayAfterDownload;window.handleHomeImport=handleHomeImport;window.handleHomeImportFiles=handleHomeImportFiles;window.handleUpdateUpload=handleUpdateUpload;window.injectScholarshipDataValidations=injectScholarshipDataValidations;window.loadMergeSourceFromArrayBuffer=loadMergeSourceFromArrayBuffer;window.parseContinuityPeriods=parseContinuityPeriods;window.parseReferenceSheet=parseReferenceSheet;window.parseWorkbookSheets=parseWorkbookSheets;window.renderAICheckboxes=renderAICheckboxes;window.renderHomePage=renderHomePage;window.renderMergeConfirmModal=renderMergeConfirmModal;window.resetHomeImport=resetHomeImport;window.resolveSheetName=resolveSheetName;window.safeSheetName=safeSheetName;window.selectAllAI=selectAllAI;window.showHomeRunAnalysisButton=showHomeRunAnalysisButton;window.showScholarshipSetupSavedModal=showScholarshipSetupSavedModal;window.timestampTag=timestampTag;window.toggleAI=toggleAI;window.toggleBulkSectionsUI=toggleBulkSectionsUI;window.toggleScholarshipUI=toggleScholarshipUI;window.updateAICount=updateAICount;window.updateAndDownloadScholarshipSetup=updateAndDownloadScholarshipSetup;window.validateScholarshipCriteria=validateScholarshipCriteria;window.validateScholarshipWeightage=validateScholarshipWeightage;window.validateSetupData=validateSetupData;window.validateUploadFile=validateUploadFile;}
