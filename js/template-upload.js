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
  sample:{font:{color:{rgb:"888888"},italic:true},alignment:{vertical:"center"}}
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
/* Shared by generateTemplate() (fresh workbook) and generateMergedTemplate()
   (existing workbook + new test columns) — both need the exact same SETUP
   tab, built from whatever's currently in APP.setup, so there's a single
   place that defines what that tab looks like. */
function buildSetupSheet(){
  const {subjects,tests,instName,passThreshold,absentAlert,dropAlert}=APP.setup;
  const setupRows=[["MODE",""],["Usage Mode",APP.setup.mode||"institution"],["INSTITUTION",""],["Institution Name",instName],["Type",APP.setup.instType||""],["Location",APP.setup.location||""],["Contact",APP.setup.contact||""],["CLASS",""],["Class / Batch",APP.setup.className],["Section",APP.setup.section||""],["Academic Year",APP.setup.year],["Class Teacher",APP.setup.teacher||""],["SUBJECTS",""]];
  subjects.forEach((s,i)=>setupRows.push(["Subject "+(i+1),s]));
  setupRows.push(["TESTS",""]);
  tests.forEach((t,i)=>{setupRows.push(["Test "+(i+1)+" Name",t.name]);setupRows.push(["Test "+(i+1)+" Date",t.date||""]);subjects.forEach(s=>setupRows.push(["Max Marks - "+s+" (Test "+(i+1)+")",(t.maxMarks&&t.maxMarks[s])||100]));});
  setupRows.push(["Scoring Method",Object.keys(APP.setup.scoring).filter(k=>APP.setup.scoring[k]).join(", ")]);
  setupRows.push(["Pass Threshold %",passThreshold],["Absent Alert Days",absentAlert],["Sharp Drop Alert %",dropAlert]);
  const SECTION_LABELS=new Set(["MODE","INSTITUTION","CLASS","SUBJECTS","TESTS"]);
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
// NEW SCHEMA — Tab 2: STUDENTS roster. Student ID mandatory, Full Name
// optional (app falls back to printing the ID wherever a name would show
// once this reaches the parser/UI layer — that fallback is a parsing-layer
// change, tracked separately from this template-generation piece), Gender
// mandatory (M/F).
function buildStudentsSheet(){
  const hdr=["Student ID","Full Name","Gender"];
  const rows=[hdr];
  for(let i=1;i<=5;i++)rows.push(["STU00"+i,"","M"]);
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"]=[{wch:16},{wch:28},{wch:10}];
  ws["!rows"]=rows.map((_,r)=>({hpt:r===0?32:20}));
  ws["!views"]=[{state:"frozen",ySplit:1,topLeftCell:"A2",activePane:"bottomLeft"}];
  hdr.forEach((_,c)=>{const cell=ws[colLetter(c)+"1"];if(cell)cell.s=TPL_STYLE.header;});
  for(let r=1;r<rows.length;r++)for(let c=0;c<3;c++){const cell=ws[colLetter(c)+(r+1)];if(cell)cell.s=TPL_STYLE.sample;}
  return ws;
}
// NEW SCHEMA — Tabs 3..N+2: one per test. Student ID + one Marks column
// per subject + Absent Days + Chapter (optional) + Remark (optional).
// Roster fields (Name/Gender) live on STUDENTS only, not repeated here.
function buildTestSheet(test,subjects){
  const hdr=["Student ID"];
  subjects.forEach(s=>hdr.push(s+" Marks"));
  hdr.push("Absent Days","Chapter","Remark");
  const rows=[hdr];
  for(let i=1;i<=5;i++)rows.push(["STU00"+i,...Array(hdr.length-1).fill("")]);
  const ws=XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"]=hdr.map((_,i)=>({wch:i===0?12:i>=hdr.length-2?24:12}));
  ws["!rows"]=rows.map((_,r)=>({hpt:r===0?32:20}));
  ws["!views"]=[{state:"frozen",xSplit:1,ySplit:1,topLeftCell:colLetter(1)+"2",activePane:"bottomRight"}];
  hdr.forEach((_,c)=>{const cell=ws[colLetter(c)+"1"];if(cell)cell.s=TPL_STYLE.header;});
  for(let r=1;r<rows.length;r++){const cell=ws["A"+(r+1)];if(cell)cell.s=TPL_STYLE.sample;}
  return ws;
}
// NEW SCHEMA — final tab: README, explaining the multi-tab layout since
// this is a genuine change from the old single-sheet format teachers may
// already be used to.
function buildReadmeSheet(){
  const lines=[
    ["Student Insight — How this workbook is organised"],
    [""],
    ["SETUP — institution, class, subjects, tests, and scoring settings. Edit here if anything needs to change."],
    ["STUDENTS — your class roster. Student ID is required; Full Name is optional (the ID is shown instead if left blank); Gender is required (M or F)."],
    ["One tab per test — each test/exam gets its own tab, named after the test. Fill marks, absences, chapter (optional), and remarks there."],
    [""],
    ["Adding a new test later: go to Setup -> Update Existing Template -> upload this file -> add the new test -> re-download."],
    ["A new tab is added for the new test; every existing tab and its marks are kept exactly as they are."],
  ];
  const ws=XLSX.utils.aoa_to_sheet(lines);
  ws["!cols"]=[{wch:110}];
  return ws;
}
function generateTemplate(){
  collectSetupForm();
  if(!APP.setup.instName){toast(APP.setup.mode==="individual"?"Fill Student/Aspirant Name first.":"Fill Institution Name first.","warn");return;}
  if(!APP.setup.subjects.length){toast("Add at least one subject.","warn");return;}
  if(!APP.setup.tests.length){toast("Add at least one test.","warn");return;}
  // If a previously-filled workbook was loaded via "Update Existing Sheet",
  // append new-test columns onto its real rows instead of building a fresh
  // 5-sample-row workbook that would silently discard those marks.
  if(APP.mergeMode&&APP.mergeSource){generateMergedTemplate();return;}
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
  const fname=(instName+" "+APP.setup.className+" "+APP.setup.year).replace(/[^\w\s-]/g,"").replace(/\s+/g,"_")+".xlsx";
  XLSX.writeFile(wb,fname);toast("Template downloaded: "+fname,"success");
  // BUG FIX (v3.9, item #4): Download Template is the real end of this
  // flow — the person leaves to fill the file offline and comes back to
  // Home later. Leaving the wizard's in-memory state sitting around meant
  // a later "Back" or "Create New Template" could pick up stale
  // setup/mergeMode data instead of a clean slate. The download itself is
  // a synchronous blob save, so it's unaffected by the reload that follows.
  setTimeout(()=>location.reload(),900);
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
    catch(err){toast("Error reading file: "+err.message,"error");}
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
  toast("Existing sheet loaded — add your new test, then click Update & Download.","success");
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
    toast(isIndividual?"That doesn't look like a file downloaded from this app — please upload the same Excel file you filled in earlier, not a different one.":"That file doesn't have SETUP and STUDENTS tabs — can't safely update it. If this is an older single-sheet Student Insight file, please download a fresh template and re-enter your data — sorry for the inconvenience, the file format has been improved to one tab per test.","error");
    return false;
  }
  const studentsSheetName=wb.SheetNames[sheetNamesUpper.indexOf("STUDENTS")];
  const studentsArr=APP.rawData["_arr_"+studentsSheetName]||[];
  const studentsHeader=(studentsArr[0]||[]).map(h=>h===null||h===undefined?"":String(h).trim());
  if(!studentsHeader.some(h=>h==="Student ID")){
    toast("The STUDENTS tab doesn't have a 'Student ID' column — can't safely update this file.","error");
    return false;
  }
  const studentsRows=studentsArr.slice(1).filter(row=>row&&row.some(v=>v!==null&&v!==undefined&&v!==""));
  if(!studentsRows.length){
    toast(isIndividual?"That file's STUDENTS tab doesn't have any filled-in rows yet — nothing to bring forward. Use Download Template to start fresh instead.":"That file's STUDENTS tab has a header but no student rows yet — nothing to preserve. Use a fresh Download Template instead.","warn");
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
    studentsSheetName,studentsHeader,studentsRows,
    origTestSheetNames,
    sourceFileName:fileName,
    origSubjects:(APP.setup.subjects||[]).slice(),
    dupeIds:[...new Set(dupeIds)],
  };
  APP.mergeMode=true;
  autoInferSetup(); // fills subjects/tests/institution form from the file's SETUP tab (unchanged function)
  APP.mergeSource.origSubjects=(APP.setup.subjects||[]).slice();
  const testNames=origTestSheetNames.join(", ")||"(none detected)";
  let bannerHtml=`Loaded <b>${esc(fileName)}</b> — <b>${studentsRows.length}</b> student(s) on the roster, existing test tab(s): <b>${esc(testNames)}</b>. Now click <b>✚ Add Test</b> below for the new test, then use <b><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M17 1l4 4-4 4'/><path d='M3 11V9a4 4 0 0 1 4-4h14'/><path d='M7 23l-4-4 4-4'/><path d='M21 13v2a4 4 0 0 1-4 4H3'/></svg> Update &amp; Download</b> above. Every existing tab is kept exactly as-is — you'll get a summary to review before anything downloads.`;
  if(APP.mergeSource.dupeIds.length){
    bannerHtml+=`<div style="margin-top:6px;color:#8b1a1a">⚠ Duplicate Student ID(s) already in the STUDENTS tab: ${esc(APP.mergeSource.dupeIds.join(", "))}. Fix these in the source file for reliable analysis.</div>`;
  }
  $("#merge-banner-text").html(bannerHtml);
  $("#merge-banner").show();
  $("#btn-download-template").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M17 1l4 4-4 4'/><path d='M3 11V9a4 4 0 0 1 4-4h14'/><path d='M7 23l-4-4 4-4'/><path d='M21 13v2a4 4 0 0 1-4 4H3'/></svg> Update & Download").prop("disabled",false).css({opacity:1,cursor:"pointer"}).addClass("btn-glow");
  $("#btn-load-existing").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M12 21V9'/><polyline points='7 14 12 9 17 14'/><path d='M4 21h16'/></svg> "+i18nLabel("setup_btn_load_different","Load a Different Sheet"));
  toast("Existing sheet loaded — add your new test, then click Update & Download.","success");
  APP.setupCard1Choice='update';
  if(typeof swGoto==="function") swGoto(2);
  return true;
}
function cancelMergeMode(){
  APP.mergeMode=false;APP.mergeSource=null;APP._pendingMerge=null;
  $("#merge-banner").hide();
  $("#btn-download-template").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M12 3v12'/><polyline points='7 10 12 15 17 10'/><path d='M4 21h16'/></svg> "+i18nLabel("setup_btn_download_template","Download Template"));
  $("#btn-load-existing").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M12 21V9'/><polyline points='7 14 12 9 17 14'/><path d='M4 21h16'/></svg> "+i18nLabel("setup_btn_load_existing","Load Existing Filled Sheet"));
  validateSetup();
  toast("Merge cancelled — back to a fresh template.","info");
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
    toast("No new test found — every test in your Setup form already exists in the loaded sheet. Add the new test's name first (✚ Add Test).","warn");
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
    toast("Update aborted — integrity check failed: "+integrityErrors[0],"error");
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
function generateMergedTemplate(){
  const {subjects,tests}=APP.setup;
  const src=APP.mergeSource;
  const origTestNamesUpper=new Set(src.origTestSheetNames.map(n=>n.toUpperCase().trim()));
  const newTests=tests.filter(t=>!origTestNamesUpper.has(t.name.toUpperCase().trim()));
  if(!newTests.length){
    toast("No new test found — every test in your Setup form already has a tab in the loaded sheet. Add the new test's name first (✚ Add Test).","warn");
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
  // touches their cells at all.
  const origWb=src.workbook;
  const studentsWs=origWb.Sheets[src.studentsSheetName];
  XLSX.utils.book_append_sheet(wb,studentsWs,safeSheetName("STUDENTS",usedNames));
  src.origTestSheetNames.forEach(sheetName=>{
    XLSX.utils.book_append_sheet(wb,origWb.Sheets[sheetName],safeSheetName(sheetName,usedNames));
  });
  newTests.forEach(t=>{
    const sheetName=safeSheetName(t.name,usedNames);
    XLSX.utils.book_append_sheet(wb,buildTestSheet(t,subjects),sheetName);
  });
  usedNames.add("README");
  XLSX.utils.book_append_sheet(wb,buildReadmeSheet(),"README");
  const fname=(APP.setup.instName+" "+APP.setup.className+" "+APP.setup.year).replace(/[^\w\s-]/g,"").replace(/\s+/g,"_")+"_UPDATED_"+timestampTag()+".xlsx";
  APP._pendingMerge={
    wb,fname,
    studentCount:src.studentsRows.length,
    tabsIn:src.origTestSheetNames.length+2, // + SETUP + STUDENTS
    tabsOut:wb.SheetNames.length,
    newTestNames:newTests.map(t=>t.name),
    keptTestNames:src.origTestSheetNames.slice(),
    subjectsChanged,missingOrigTests,dupeIds:src.dupeIds||[],
  };
  renderMergeConfirmModal();
}
function renderMergeConfirmModal(){
  const p=APP._pendingMerge;if(!p)return;
  const warnings=[];
  if(p.subjectsChanged)warnings.push("Your Subjects list is different from the loaded file's. Existing test tabs are untouched either way, but double-check this was intentional.");
  if(p.missingOrigTests.length)warnings.push(`Test tab(s) from the loaded file aren't in your current Setup form: <b>${esc(p.missingOrigTests.join(", "))}</b>. That tab and its marks are still kept exactly as-is in the new file — this just means it wasn't recognised as matching a test in your Setup form. If you meant to keep the same test, re-add it with the exact original name instead of a new one.`);
  if(p.dupeIds.length)warnings.push(`Duplicate Student ID(s) already existed on the STUDENTS tab: ${esc(p.dupeIds.join(", "))}.`);
  const warnHtml=warnings.length?`<div style="margin:10px 0;padding:10px 12px;background:#fff4e0;border-radius:var(--r-sm);font-size:12px;color:#8a5a00">⚠ ${warnings.join("<br>⚠ ")}</div>`:"";
  $("#modal-content").html(`
    <h3 style="font-family:var(--font-display);font-size:17px;margin-bottom:4px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M17 1l4 4-4 4'/><path d='M3 11V9a4 4 0 0 1 4-4h14'/><path d='M7 23l-4-4 4-4'/><path d='M21 13v2a4 4 0 0 1-4 4H3'/></svg> Review before downloading</h3>
    <div style="font-size:12px;color:var(--c-text3);margin-bottom:14px">Nothing has been saved yet. Every existing tab is copied through unchanged — only new blank test tab(s) are added. Check this matches what you expected, then confirm.</div>
    <div class="grid-2" style="gap:10px;margin-bottom:6px">
      <div class="kpi-card"><div class="kpi-label">Students on roster</div><div class="kpi-val" style="font-size:16px">${p.studentCount}</div></div>
      <div class="kpi-card"><div class="kpi-label">Tabs</div><div class="kpi-val" style="font-size:16px">${p.tabsIn} → ${p.tabsOut}</div></div>
    </div>
    <div style="font-size:12.5px;margin:10px 0 4px"><b>New test tab(s) being added:</b> ${esc(p.newTestNames.join(", "))}</div>
    <div style="font-size:11.5px;color:var(--c-text2);max-height:110px;overflow:auto;background:var(--c-surface2);border-radius:var(--r-sm);padding:8px 10px;margin-bottom:6px">Kept unchanged: SETUP, STUDENTS, ${p.keptTestNames.map(n=>esc(n)).join(", ")||"(no prior test tabs)"}<br>Added new: ${p.newTestNames.map(n=>esc(n)).join(", ")}</div>
    ${warnHtml}
    <div style="font-size:11px;color:var(--c-text3);margin-bottom:14px">Will save as: <code>${esc(p.fname)}</code></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Cancel</button>
      <button class="btn btn-success btn-sm" onclick="confirmMergedDownload()">✔ Confirm & Download</button>
    </div>`);
  $("#modal-overlay").addClass("open");
  setTimeout(()=>{const f=document.querySelector('#modal-overlay.open .modal-close');if(f)f.focus();},0);
}
function confirmMergedDownload(){
  const p=APP._pendingMerge;if(!p){closeModal();return;}
  XLSX.writeFile(p.wb,p.fname);
  toast(`Updated file downloaded: ${p.fname} — ${p.studentCount} student(s) kept as-is, added ${p.newTestNames.length} new test tab(s).`,"success");
  unlockStep("data");
  $("#btn-download-template").removeClass("btn-glow");
  $("#btn-setup-next").addClass("btn-glow");
  closeModal();
  // Exit merge mode — the just-downloaded file is now the new baseline; if
  // the teacher wants to add yet another test later, they load that file
  // in fresh via "Load Existing Filled Sheet" again.
  APP.mergeMode=false;APP.mergeSource=null;APP._pendingMerge=null;
  $("#merge-banner").hide();
  $("#btn-download-template").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M12 3v12'/><polyline points='7 10 12 15 17 10'/><path d='M4 21h16'/></svg> "+i18nLabel("setup_btn_download_template","Download Template"));
  $("#btn-load-existing").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M12 21V9'/><polyline points='7 14 12 9 17 14'/><path d='M4 21h16'/></svg> "+i18nLabel("setup_btn_load_existing","Load Existing Filled Sheet"));
  // BUG FIX (v3.9, item #4): same reasoning as the fresh-template path in
  // generateTemplate() — this is the terminal action of the "Update
  // Existing Template" flow, so refresh to a clean slate afterward.
  setTimeout(()=>location.reload(),900);
}

/* ════ SHARED FILE VALIDATION ════
   Used by both upload entry points (Home quick-import and the Step 2
   drop-zone) so file-size and extension guards can't silently apply to
   only one of them. */
function validateUploadFile(f,allowedExts){
  if(!f)return "No file selected.";
  if(f.size>50*1024*1024)return "File too large (max 50MB).";
  const ext=(f.name.split(".").pop()||"").toLowerCase();
  if(!allowedExts.includes(ext))return "Unsupported file. Use "+allowedExts.map(e=>"."+e).join(", ");
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
function parseWorkbookSheets(wb){
  APP.rawData={};
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
   Data/AI Analysis manually. Sample_4 (School Class Teacher) was picked
   as the default because it's a plain single-section Institution-mode
   class, the closest match to the non-power-user persona this feature
   is designed around. */
// v3.0 rev2 (BUILD spec §10.4): tryOneClickSample() removed — the Home
// "Want to try it first?" link now opens showSampleFiles() directly (the
// same modal used elsewhere in the app), instead of a separate single-
// file auto-download path. One sample-data entry point, not two.

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
  if(files.length>=2){
    startCompareMode();
    let remaining=files.length;
    files.forEach(f=>processCompareFile(f,()=>{remaining--;if(remaining===0)afterAllCompareFilesLoaded();}));
    return;
  }
  handleHomeImport(files[0]);
}
function afterAllCompareFilesLoaded(){
  const statusEl=document.getElementById("home-import-status");
  const validCount=APP.sections.filter(s=>s.valid).length;
  renderHomeFileList();
  if(validCount>=1){
    statusEl.style.display="none";statusEl.innerHTML="";
    // v3.0: no auto-run — surface Run Analysis, same as the single-file path.
    // Every valid file gets its own analysis regardless of whether it
    // matches anything else; matching subsets are compared silently once
    // Run Analysis executes (see computeCompareGroups()).
    showHomeRunAnalysisButton();
    return;
  }
  const detail="None of these look like Student Insight templates — check you're uploading the filled Excel file(s) exported from Setup, with SETUP and MARKS+CONTEXT tabs intact.";
  statusEl.innerHTML=`<div class="card" style="border-color:var(--c-warn)">
    <b style="color:var(--c-warn)">Can't analyse these files</b>
    <div style="font-size:12.5px;color:var(--c-text2);margin-top:6px">${esc(detail)}</div>
    <div style="margin-top:10px;font-size:11px"><button type="button" onclick="resetHomeImport()" style="background:none;border:none;padding:0;font:inherit;cursor:pointer;color:var(--c-text3);text-decoration:underline">↺ Start over — pick different files</button></div>
  </div>`;
  statusEl.style.display="block";
  scrollToEl(statusEl);
}
function handleHomeImport(file){
  if(!file)return;
  const fileName=file.name;
  const statusEl=document.getElementById("home-import-status");
  const fileErr=validateUploadFile(file,["xlsx","xls"]);
  if(fileErr){
    statusEl.innerHTML=`<div class="card" style="border-color:var(--c-danger)"><b style="color:var(--c-danger)"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><circle cx='12' cy='12' r='10'/><line x1='15' y1='9' x2='9' y2='15'/><line x1='9' y1='9' x2='15' y2='15'/></svg> ${esc(fileErr)}</b></div>`;
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
  reader.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:"array"});
      parseWorkbookSheets(wb);

      // Auto-read SETUP tab
      autoInferSetup();

      // Validate SETUP completeness
      const errs=validateSetupData();
      if(errs.length){
        const errHtml=errs.map(e=>`<div style="padding:5px 0;border-bottom:1px solid var(--c-border);font-size:12px"><span style="color:${e.required?"var(--c-danger)":"var(--c-warn)"}">${e.required?"✕":"⚠"}</span> ${e.msg}</div>`).join("");
        const hasRequired=errs.some(e=>e.required);
        if(hasRequired){
          statusEl.innerHTML=`<div class="card" style="border-color:var(--c-danger)">
            <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:var(--c-danger)"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><circle cx='12' cy='12' r='10'/><line x1='15' y1='9' x2='9' y2='15'/><line x1='9' y1='9' x2='15' y2='15'/></svg> Setup Incomplete — ${errs.length} issue(s) found in SETUP tab</div>
            ${errHtml}
            <div style="margin-top:10px;font-size:12px;color:var(--c-text2)">Fix the required fields in your Excel SETUP tab and re-import.</div>
            <button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="goStep('setup')">Edit Setup in App</button>
            <div style="margin-top:10px;font-size:11px"><button type="button" onclick="resetHomeImport()" style="background:none;border:none;padding:0;font:inherit;cursor:pointer;color:var(--c-text3);text-decoration:underline">↺ Not this file — start over / import a different one</button></div>
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
      statusEl.innerHTML=`<div class="card" style="border-color:var(--c-danger)"><b style="color:var(--c-danger)"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><circle cx='12' cy='12' r='10'/><line x1='15' y1='9' x2='9' y2='15'/><line x1='9' y1='9' x2='15' y2='15'/></svg> Import failed:</b> ${esc(err.message)}<br><span style="font-size:11.5px;color:var(--c-text2)">Make sure the file is a valid .xlsx or .xls file.</span></div>`;
      statusEl.style.display="block";
      scrollToEl(statusEl);
    }
  };
  reader.readAsArrayBuffer(file);
}

function afterImportSuccess(){
  APP.dataIssues=[]; // reset from any prior session/import; real check happens once analysis runs
  unlockStep("ai");unlockStep("dashboard");unlockStep("export");
  updateExportGate();
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

/* ════ SETUP COMPLETENESS VALIDATION ════ */
function validateSetupData(){
  const s=APP.setup;const errs=[];
  if(!s.instName){errs.push({required:true,msg:"Institution Name is missing from SETUP tab"});}
  if(!s.className){errs.push({required:true,msg:"Class / Batch Name is missing from SETUP tab"});}
  if(!s.year){errs.push({required:true,msg:"Academic Year is missing from SETUP tab"});}
  if(!s.subjects||!s.subjects.length){errs.push({required:true,msg:"No subjects found. Add 'Subject 1', 'Subject 2'... rows to SETUP tab"});}
  if(!s.tests||!s.tests.length){errs.push({required:true,msg:"No tests/assessments found. Add 'Test 1 Name'... rows to SETUP tab"});}
  if(!s.teacher){errs.push({required:false,msg:"Class Teacher name not set (optional but recommended)"});}
  if(!s.passThreshold){errs.push({required:false,msg:"Pass Threshold % not set — defaulting to 35%"});}
  // Duplicate subject/test names (case-insensitive) silently corrupt
  // per-subject aggregation downstream since it's keyed by name — flag
  // as a warning rather than blocking, since the import can still proceed.
  const findDupes=list=>{const seen=new Set(),dupes=new Set();(list||[]).forEach(v=>{const k=String(v).toLowerCase();if(seen.has(k))dupes.add(v);seen.add(k);});return[...dupes];};
  const dupeSubjects=findDupes(s.subjects);
  const dupeTests=findDupes((s.tests||[]).map(t=>t.name));
  if(dupeSubjects.length)errs.push({required:false,msg:"Duplicate subject name(s) in SETUP tab: "+dupeSubjects.join(", ")+" — their data will overwrite each other"});
  if(dupeTests.length)errs.push({required:false,msg:"Duplicate test name(s) in SETUP tab: "+dupeTests.join(", ")+" — their data will overwrite each other"});
  // Check that tests have subjects with max marks
  (s.tests||[]).forEach((t,i)=>{
    const missing=(s.subjects||[]).filter(sub=>!t.maxMarks||!t.maxMarks[sub]);
    if(missing.length)errs.push({required:false,msg:`Test "${t.name}": Max Marks not set for ${missing.join(", ")} — defaulting to 100`});
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
  $("#btn-download-template").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M12 3v12'/><polyline points='7 10 12 15 17 10'/><path d='M4 21h16'/></svg> "+i18nLabel("setup_btn_download_template","Download Template"));$("#btn-load-existing").html("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M12 21V9'/><polyline points='7 14 12 9 17 14'/><path d='M4 21h16'/></svg> "+i18nLabel("setup_btn_load_existing","Load Existing Filled Sheet"));
  // Bug fix: renderHomePage() reset every other piece of import state but
  // never reset the "Run Analysis" button itself — so after removing the
  // only uploaded file (resetHomeImport -> renderHomePage), the button
  // stayed visible/enabled from before, letting the user run analysis
  // with nothing uploaded. Always hide/disable it on a fresh Home render;
  // a real import re-enables it via showHomeRunAnalysisButton().
  (function(){const btn=document.getElementById("btn-home-run-analysis");if(btn){btn.style.display="none";btn.disabled=true;btn.style.opacity=.45;btn.style.cursor="not-allowed";btn.classList.remove("btn-glow");}})();
  // Reset stepper
  document.querySelectorAll(".step-item").forEach(el=>{el.classList.remove("active");el.classList.add("locked");});
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
function autoInferSetup(){
  const setupSheet=APP.rawData["SETUP"]||[];if(!setupSheet.length)return true;
  const kv={};setupSheet.forEach(row=>{const k=String(Object.values(row)[0]||"").trim();const v=String(Object.values(row)[1]||"").trim();if(k&&v)kv[k]=v;});
  if(kv["Usage Mode"]){
    const fileMode=kv["Usage Mode"]==="individual"?"individual":"institution";
    // E1: a session already in progress (has a name typed in, or students
    // already loaded) that conflicts with the imported file's embedded mode
    // is a real misuse risk (e.g. a parent's Individual session receiving an
    // Institution-mode roster) — confirm before silently overwriting the
    // session's mode and swallowing the other file's data un-labeled.
    const sessionInProgress=!!(APP.setup.instName||APP.students.length);
    if(sessionInProgress&&fileMode!==APP.setup.mode){
      const fileLabel=fileMode==="individual"?"Individual":"Institution",curLabel=APP.setup.mode==="individual"?"Individual":"Institution";
      const proceed=confirm(`This file was created in ${fileLabel} mode, but this session is currently in ${curLabel} mode. Switch this session to ${fileLabel} mode and load the file?\n\nCancel to keep ${curLabel} mode and abort this import.`);
      if(!proceed){toast("Import cancelled — session mode unchanged.","warn");APP.rawData=null;return false;}
    }
    APP.setup.mode=fileMode;
    lockUsageMode(); // a real file's data now defines this mode — no more switching without a new project
  }
  if(kv["Institution Name"])APP.setup.instName=kv["Institution Name"];
  if(kv["Type"])APP.setup.instType=kv["Type"];
  if(kv["Location"])APP.setup.location=kv["Location"];
  if(kv["Contact"])APP.setup.contact=kv["Contact"];
  if(kv["Class / Batch"])APP.setup.className=kv["Class / Batch"];
  if(kv["Section"])APP.setup.section=kv["Section"];
  if(kv["Academic Year"])APP.setup.year=kv["Academic Year"];
  // Support "Teacher Name" variant BEFORE reading Class Teacher, so either label works
  if(kv["Teacher Name"]&&!kv["Class Teacher"])kv["Class Teacher"]=kv["Teacher Name"];
  // Absent alert: "Absent Alert (days)" variant — also resolve before use
  if(kv["Absent Alert (days)"]&&!kv["Absent Alert Days"])kv["Absent Alert Days"]=kv["Absent Alert (days)"];
  if(kv["Class Teacher"])APP.setup.teacher=kv["Class Teacher"];
  const clampImportedNum=(raw,min,max,fallback)=>{const n=parseInt(raw);return isNaN(n)?fallback:Math.min(max,Math.max(min,n));};
  if(kv["Pass Threshold %"])APP.setup.passThreshold=clampImportedNum(kv["Pass Threshold %"],0,100,35);
  if(kv["Absent Alert Days"])APP.setup.absentAlert=clampImportedNum(kv["Absent Alert Days"],0,365,3);
  if(kv["Sharp Drop Alert %"])APP.setup.dropAlert=clampImportedNum(kv["Sharp Drop Alert %"],0,100,20);
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
    // Format A: per-subject max marks stored separately
    const hasFormatA=subjects.some(s=>kv["Max Marks - "+s+" (Test "+t+")"]||kv["Max Marks — "+s+" (Test "+t+")"]);
    if(hasFormatA){
      subjects.forEach(s=>{const v=kv["Max Marks - "+s+" (Test "+t+")"]||kv["Max Marks — "+s+" (Test "+t+")"]||null;maxMarks[s]=v?parseInt(v)||100:100;});
    } else {
      // Format B: one global max for all subjects, found in same row as test name
      const testRow=rawRows.find(r=>String(r[0]||"").trim()==="Test "+t&&String(r[1]||"").trim()===name);
      const globalMax=testRow&&testRow[2]==="Max Marks"&&testRow[3]?parseInt(testRow[3])||100:100;
      subjects.forEach(s=>{maxMarks[s]=globalMax;});
    }
    tests.push({name,date:kv["Test "+t+" Date"]||"",maxMarks});
    t++;
  }
  if(tests.length)APP.setup.tests=tests;
  // Even legacy files without a "Usage Mode" cell still commit this session
  // to whichever mode is currently active, once they've supplied real
  // subjects/tests — lock here too so a later mode-card click can't silently
  // orphan the data just loaded.
  if(subjects.length||tests.length)lockUsageMode();
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
  function makeGrid(items,cid){$("#"+cid).html(items.map(f=>`<div class="ai-check-item ${APP.aiFeatures.has(f.id)?"selected":""}" onclick="toggleAI('${f.id}',this)"><input type="checkbox" ${APP.aiFeatures.has(f.id)?"checked":""} onclick="event.stopPropagation();toggleAI('${f.id}',this.closest('.ai-check-item'))"/><div><div class="ai-check-label">${i18nLabel("ai_"+f.id+"_label",f.label)}</div><div class="ai-check-sub">${i18nLabel("ai_"+f.id+"_sub",f.sub)}</div></div></div>`).join(""));}
  makeGrid(AI_FEATURES.perf,"ai-perf-checks");makeGrid(AI_FEATURES.warn,"ai-warn-checks");makeGrid(AI_FEATURES.narr,"ai-narr-checks");makeGrid(AI_FEATURES.well,"ai-well-checks");makeGrid(AI_FEATURES.mgmt,"ai-mgmt-checks");updateAICount();
}
function toggleAI(id,el){if(APP.aiFeatures.has(id))APP.aiFeatures.delete(id);else APP.aiFeatures.add(id);$(el).toggleClass("selected",APP.aiFeatures.has(id));$(el).find("input[type=checkbox]").prop("checked",APP.aiFeatures.has(id));updateAICount();}
function selectAllAI(){Object.values(AI_FEATURES).flat().forEach(f=>APP.aiFeatures.add(f.id));renderAICheckboxes();toast("All "+APP.aiFeatures.size+" AI features selected.","success");}
function clearAllAI(){APP.aiFeatures.clear();renderAICheckboxes();}
function updateAICount(){$("#ai-selected-count").text(APP.aiFeatures.size+" features selected");
  // vs-shell-plan-v2 Task 5: right-rail "Selected features" count, same
  // trigger point as the existing #ai-selected-count text above.
  if(typeof renderShellRightRail==="function" && APP.currentStep==="ai") renderShellRightRail("ai");
}

