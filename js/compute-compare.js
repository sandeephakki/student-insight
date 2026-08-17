import { esc, startAiLoaderCardCycle, stopAiLoaderCardCycle, toast } from './app-utils-init.js';
import { deriveRosterStatus } from './compute-continuity.js';
import { computeAnalysis, computeGenderAnalysis, parseStudents, runAnalysis, scrollToEl, sleep } from './compute-stats.js';
import { bcp47TagFor, srT } from './render-i18n.js';
import { buildMgmtPDF, buildStudentPDF, buildTeacherPDF, fitText, generateAllPDFs, pdfT, stampFooterAllPages } from './export-pdf.js';
import { lockStep, markClean, unlockStep } from './project-setup.js';
import { buildCompareSectionListHtml, openBucket, openIndividualBucket, renderComparePicker, renderDashboardSampleBanner } from './render-buckets.js';
import { updateExportGate } from './render-core.js';
import { renderClusterGroups } from './render-findings.js';
import { APP, goStep } from './state-nav.js';
import { autoInferSetup, handleHomeImportFiles, parseWorkbookSheets, resetHomeImport, selectAllAI, validateUploadFile } from './template-upload.js';
import { renderShellLeftRail, setRightRail, setShellRailOpen, setShellRailsOpen } from './vs-shell.js';

// FIX (module-system conversion, HANDOVER #4): moved here from state-nav.js
// (never used there) — this file is the real owner, incrementing it via
// addCompareSection(). See the matching note in state-nav.js.
let _compareSectionSeq = 0;

/* ════════════════════════════════════════════════════════════════════
   COMPUTE-COMPARE — multi-file comparison, management grid, schema
   matching across uploaded sections, weak-subject/flagged-section
   rollups, export section picker.
   Split out of the former compute-engine.js (review #5) — pure move,
   no logic changed. Depends on nothing from compute-stats.js at load
   time (only calls its functions later, at runtime, same as before).
   ════════════════════════════════════════════════════════════════════ */
function applyCompareModeUI(){
  const cm=!!APP.compareMode;
  $("#compare-setup-banner").toggle(cm);
  $("#mode-select-card").toggle(!cm);
  $("#compare-export-card,#compare-per-section-export-card").toggle(cm);
  $("#btn-generate-pdfs").toggle(!cm);
}

function safeFileName(n){return String(n||"").replace(/[^\w\s-]/g,"").replace(/\s+/g,"_");}

/* ── Upload handlers ── */
// v3.0 rev2: triggerCompareFileUpload()/handleCompareFileSelect()/
// handleCompareFileDrop() removed — targeted #compare-drop-zone/
// #compare-file-input, both deleted with the old Upload Data panel.
// processCompareFile() itself is kept — Home's own multi-file drop calls
// it directly (see handleHomeImportFiles).
// Shared by fingerprintRawData()/addCompareSection() (Compare mode) and the
// single-file Home upload path alike — one place that knows how to find the
// MARKS+CONTEXT sheet regardless of minor naming variants.
// BUG FIX (v3.8): current templates split marks across one sheet PER TEST
// ("Prelims Mock 1", "Unit Test 1", etc.) with the roster in its own
// STUDENTS sheet — there is no single "MARKS+CONTEXT" sheet in any current
// sample/template. Looking for a sheet name containing "MARK" therefore
// always came back empty, showing "0 rows detected" on every real upload
// (cosmetic on the Home single-file card, but also made Compare Mode wrongly
// flag every valid file with "No student rows found"). STUDENTS is the
// reliable roster regardless of how the per-test sheets are named; the old
// MARKS+CONTEXT lookup is kept as a fallback for any legacy single-sheet file.
function resolveMarksRows(rawData){
  if(rawData["STUDENTS"]&&rawData["STUDENTS"].length)return rawData["STUDENTS"];
  const markKey=Object.keys(rawData).find(k=>k.includes("MARK")&&k.includes("CONTEXT"))||Object.keys(rawData).find(k=>k.includes("MARK"))||"";
  return rawData["MARKS+CONTEXT"]||rawData["MARKS_CONTEXT"]||rawData[markKey]||[];
}
function processCompareFile(file,done){
  const err=validateUploadFile(file,["xlsx","xls"]);
  if(err){toast(file.name+": "+err,"error");if(done)done();return;}
  // Bug fix: the same file could be uploaded twice with zero validation —
  // it would silently get added as a second, separate section, double-
  // counting those students in the comparison (and their averages moving
  // the school-wide/class numbers) with no warning it had happened.
  // Cheapest, most common case: reject on an exact filename match before
  // even reading the file. A content-based check below (in
  // addCompareSection) also catches a renamed copy of the same data.
  if(APP.sections.some(s=>s.fileName.toLowerCase()===file.name.toLowerCase())){
    toast(srT("val_file_already_uploaded_compare",{fname:file.name}),"warn");
    if(done)done();
    return;
  }
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:"array"});
      parseWorkbookSheets(wb); // overwrites the shared APP.rawData — snapshotted into this section immediately below, so it's safe even though later files will overwrite it again
      const sectionRawData=APP.rawData;
      const peek=peekSectionSetup(sectionRawData);
      // v1.6 (per confirmed spec): no shared APP.setup schema is adopted or
      // enforced here anymore — every file carries its OWN schema (subjects/
      // tests/max-marks straight off its own SETUP tab), and validity is
      // purely "does this look like a Student Insight template" (see
      // addCompareSection). Whether two files' schemas happen to MATCH each
      // other is decided later, per group, in computeCompareGroups() — not
      // gated here against whichever file happened to be uploaded first.
      addCompareSection(file.name,sectionRawData,peek);
    }catch(err2){
      toast(srT("val_error_reading_named",{fname:file.name,msg:err2.message}),"error");
    }
    if(done)done();
  };
  reader.onerror=()=>{toast(srT("val_could_not_read_named",{fname:file.name}),"error");if(done)done();};
  reader.readAsArrayBuffer(file);
}
// Read a section file's own SETUP tab (subjects/tests/max-marks/label)
// WITHOUT touching the shared APP.setup — this is a read-only peek used
// purely for validation + auto-labelling, mirroring autoInferSetup()'s
// SETUP-tab parsing but never assigning anything to global state.
function peekSectionSetup(rawData){
  const setupRows=rawData["SETUP"]||[];
  const kv={};
  setupRows.forEach(row=>{const k=String(row[0]||"").trim();const v=row[1]===undefined||row[1]===null?"":String(row[1]).trim();if(k)kv[k]=v;});
  const subjects=[];let i=1;while(kv["Subject "+i]){subjects.push(kv["Subject "+i]);i++;}
  const rawRows=setupRows.map(row=>Object.values(row));
  const tests=[];let t=1;
  // Mirrors autoInferSetup()'s Format A ("Max Marks - <Subject> (Test N)")
  // / Format B (single "Max Marks" cell shared by all subjects) handling —
  // duplicated here (read-only) rather than calling autoInferSetup() itself,
  // since that function mutates the shared APP.setup as a side effect and
  // this is only ever meant to peek at a file, never apply it.
  while(kv["Test "+t+" Name"]||kv["Test "+t]){
    const name=kv["Test "+t+" Name"]||kv["Test "+t]||"";
    if(!name){t++;continue;}
    const maxMarks={};
    const hasFormatA=subjects.some(s=>kv["Max Marks - "+s+" (Test "+t+")"]||kv["Max Marks — "+s+" (Test "+t+")"]);
    if(hasFormatA){
      subjects.forEach(s=>{const v=kv["Max Marks - "+s+" (Test "+t+")"]||kv["Max Marks — "+s+" (Test "+t+")"]||null;maxMarks[s]=v?(parseInt(v)||100):100;});
    } else {
      const testRow=rawRows.find(r=>String(r[0]||"").trim()==="Test "+t&&String(r[1]||"").trim()===name);
      const globalMax=testRow&&testRow[2]==="Max Marks"&&testRow[3]?(parseInt(testRow[3])||100):100;
      subjects.forEach(s=>{maxMarks[s]=globalMax;});
    }
    tests.push({name,maxMarks});
    t++;
  }
  const instName=kv["Institution Name"]||"";
  const className=kv["Class / Batch"]||kv["Class/Batch"]||kv["Class"]||"";
  const section=kv["Section"]||"";
  const label=[className,section].filter(Boolean).join(" - ")||instName||"";
  return {instName,className,section,label,subjects,tests};
}
// Structural template check ONLY — "does this look like a Student Insight
// file at all" (recognizable Subjects/Tests in its own SETUP tab, and at
// least one student row) — NOT "does it match any other uploaded file".
// Whether two files' schemas match each other is a separate question,
// answered later per-group in computeCompareGroups(); a file failing THIS
// check is unrecoverable (we have no schema to analyse it with at all), but
// a file that passes is always analysed on its own, whether or not any
// other uploaded file shares its subjects/tests.
function validateTemplateStructure(peek,rowCount){
  const errors=[];
  if(!peek.subjects||!peek.subjects.length)errors.push(srT("val_couldnt_detect_subjects_setup"));
  if(!peek.tests||!peek.tests.length)errors.push(srT("val_couldnt_detect_tests_setup"));
  if(!rowCount)errors.push(srT("val_no_student_rows_setup"));
  return errors;
}
// Cheap content fingerprint for a section's marks data — used to catch a
// duplicate upload even when the file was renamed (the filename check in
// processCompareFile only catches an exact name match).
function fingerprintRawData(rawData){
  return JSON.stringify(resolveMarksRows(rawData));
}
function addCompareSection(fileName,rawData,peek){
  const rowCount=resolveMarksRows(rawData).length;
  const errors=validateTemplateStructure(peek,rowCount);
  const fp=fingerprintRawData(rawData);
  const dup=APP.sections.find(s=>s._fp===fp&&fp!=="[]");
  if(dup){
    toast(fileName+": this has the same student data as \""+dup.label+"\" (already added under a different filename) — skipped to avoid double-counting.","warn");
    return;
  }
  const id="sec"+(++_compareSectionSeq);
  // Each section keeps its OWN schema straight off its own SETUP tab —
  // no shared/adopted schema anymore. computeCompareGroups() (run once
  // analysis starts) is what decides which sections' schemas match closely
  // enough to be silently compared against each other.
  // className/section carried alongside subjects/tests purely so
  // schemaSignature() can strip THIS file's own "<Class><Section>-" tab
  // prefix (applyTabPrefix()'s convention, baked into every generated
  // template's Test N Name) before comparing test names across files —
  // see schemaSignature() for why this matters.
  const schema=errors.length?null:{subjects:peek.subjects.slice(),tests:peek.tests.map(t=>({name:t.name,date:"",maxMarks:Object.assign({},t.maxMarks)})),className:peek.className,section:peek.section};
  APP.sections.push({id,fileName,rawData,label:peek.label||fileName.replace(/\.[^.]+$/,""),
    valid:errors.length===0,errors,rowCount,schema,students:null,classStats:null,genderAnalysis:null,dataIssues:null,_fp:fp});
  invalidateStaleComparison();
  toast(errors.length?fileName+": "+errors.join(" "):fileName+" added ("+rowCount+" row"+(rowCount===1?"":"s")+").",errors.length?"error":"success");
  renderHomeFileList();
}
// v3.0 rev2 (BUILD spec §10.3/10.5) originally removed renameCompareSection()/
// removeCompareSection()/renderCompareSectionsList()/updateCompareContinueButton()
// /triggerCompareFileUpload()/handleCompareFileSelect()/handleCompareFileDrop()
// since they only ever targeted the old Setup-panel Compare upload UI
// (#compare-sections-list, #btn-compare-continue, #compare-drop-zone), which
// no longer exists now that Home's single upload zone is the only surface
// (§10.1/10.3). Re-added below as Home-native equivalents (#home-file-list)
// so a multi-file drop still shows a persistent, editable list of what's
// been uploaded — not just transient toasts — mirroring the old Compare
// panel's list UX but living under Home's own drop zone instead.
function renderHomeFileList(){
  const wrap=$("#home-file-list");
  if(APP.compareMode&&APP.sections.length){
    const validCount=APP.sections.filter(s=>s.valid).length;
    wrap.html(`<div class="card" style="padding:14px">
      <div style="font-weight:700;font-size:13px;margin-bottom:10px">${APP.sections.length} file(s) uploaded · ${validCount} valid section(s)</div>
      ${APP.sections.map(sec=>`
        <div style="padding:8px 0;border-top:1px solid var(--c-border)">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:220px">
              <span style="font-size:16px" aria-hidden="true">${sec.valid?"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false' style='color:var(--c-success)'><path d='M22 11.1V12a10 10 0 1 1-5.9-9.1'/><polyline points='22 4 12 14.5 9 11.5'/></svg>":"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false' style='color:var(--c-danger)'><circle cx='12' cy='12' r='10'/><line x1='15' y1='9' x2='9' y2='15'/><line x1='9' y1='9' x2='15' y2='15'/></svg>"}</span>
              <input type="text" value="${esc(sec.label)}" oninput="renameHomeCompareFile('${sec.id}',this.value)" aria-label="Section label for ${esc(sec.fileName)}" style="padding:5px 8px;font-size:13px;font-weight:700;border:1px solid var(--c-border);border-radius:var(--r-sm);min-width:160px" placeholder="Section label"/>
              <span style="font-size:11.5px;color:var(--c-text3)">${esc(sec.fileName)} · ${sec.rowCount} row${sec.rowCount===1?"":"s"}</span>
            </div>
            <button class="btn btn-secondary btn-sm" data-action="removeHomeCompareFile" data-arg="${sec.id}">✕ Remove</button>
          </div>
          ${sec.errors&&sec.errors.length?`<div style="margin-top:8px;font-size:12px;color:var(--c-danger)">${sec.errors.map(e=>"⚠ "+esc(e)).join("<br>")}</div>`:""}
        </div>`).join("")}
    </div>`);
    wrap.show();
    return;
  }
  // Single-file path (not Compare mode) — same "here's what's uploaded,
  // ✕ to remove it" card, just for the one file, so it doesn't silently
  // vanish between the drop zone and the Run Analysis button.
  if(APP.homeSingleFile){
    const f=APP.homeSingleFile;
    wrap.html(`<div class="card" style="padding:14px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:220px">
          <span style="font-size:16px" aria-hidden="true"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false' style='color:var(--c-success)'><path d='M22 11.1V12a10 10 0 1 1-5.9-9.1'/><polyline points='22 4 12 14.5 9 11.5'/></svg></span>
          <div>
            <div style="font-weight:700;font-size:13px">${esc(f.fileName)}</div>
            <div style="font-size:11.5px;color:var(--c-text3)">${f.rowCount} row${f.rowCount===1?"":"s"} detected</div>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" data-action="resetHomeImport">✕ Remove</button>
      </div>
    </div>`);
    wrap.show();
    return;
  }
  wrap.hide().empty();
}
function renameHomeCompareFile(id,val){
  const sec=APP.sections.find(s=>s.id===id);
  if(sec)sec.label=val.trim()||sec.fileName.replace(/\.[^.]+$/,"");
}
// Mirrors old code's removeCompareSection(), but re-evaluates Home's own
// status area/Run Analysis button afterwards instead of the old Setup-panel
// Continue button, since that's the only surface left (§10.1/10.3).
function removeHomeCompareFile(id){
  APP.sections=APP.sections.filter(s=>s.id!==id);
  invalidateStaleComparison();
  if(!APP.sections.length){
    // Nothing left — fully reset back to a blank Home import state rather
    // than leaving an empty compare-mode limbo behind.
    resetHomeImport();
    return;
  }
  renderHomeFileList();
  const btn=document.getElementById("btn-home-run-analysis");
  const validCount=APP.sections.filter(s=>s.valid).length;
  if(validCount>=1){
    if(btn){btn.style.display="inline-flex";btn.disabled=false;btn.style.opacity=1;btn.style.cursor="pointer";btn.classList.add("btn-glow");}
    $("#home-import-status").hide().empty();
  } else {
    if(btn){btn.style.display="none";}
    const statusEl=document.getElementById("home-import-status");
    statusEl.innerHTML=`<div class="card" style="border-color:var(--c-warn)">
      <b style="color:var(--c-warn)">No valid files left</b>
      <div style="font-size:12.5px;color:var(--c-text2);margin-top:6px">Drop another Student Insight file below.</div>
    </div>`;
    statusEl.style.display="block";
  }
}
// Bug fix (shared by add/removeCompareSection): once a Compare Mode
// comparison has actually been run, APP.sectionComparison holds results for
// that exact set of sections, and Dashboard/Export get unlocked. If the
// section list then changes (a section added, removed, or swapped) without
// re-running "Run Comparison Analysis", those steps used to stay unlocked
// and would keep showing the comparison computed for the OLD set of
// sections — silently stale. Clear it and re-lock so the only way back
// into Dashboard/Export is to actually re-run the comparison.
function invalidateStaleComparison(){
  if(APP.sectionComparison&&APP.sectionComparison.length){
    APP.sectionComparison=[];
    lockStep("dashboard");lockStep("export");
    toast(srT("val_section_list_changed"),"info");
  }
}
/* ── Per-section analysis (reuses parseStudents/computeAnalysis/computeGenderAnalysis as-is) ── */
async function runCompareAnalysisCore(){
  const validSections=APP.sections.filter(s=>s.valid);
  if(validSections.length<1){toast("No valid files to analyse — check the errors above.","warn");return;}
  if(!APP.aiFeatures.size)selectAllAI();
  goStep("ai"); // v2.4: bring the loader on-screen even without a manual stop here
  $("#ai-loader").show();
  startAiLoaderCardCycle();
  // btn-analyse removed (v3.2) — panel-ai is now a pure progress screen.
  scrollToEl(document.getElementById("ai-loader"));
  for(let i=0;i<validSections.length;i++){
    const sec=validSections[i];
    $("#ai-loader-msg").text("Analysing "+sec.label+"…");
    $("#ai-loader-step").text("Section "+(i+1)+" of "+validSections.length);
    const pct=Math.round(((i+1)/validSections.length)*100);
    $("#ai-prog").css("width",pct+"%");$("#ai-prog-label").text(pct+"%");
    await sleep(280+Math.random()*220);
    // Each file is parsed against its OWN schema (not a shared one) — a
    // UPSC aspirant's file and a Class 7 file can both be analysed
    // correctly in the same batch, each using its own Subjects/Tests.
    APP.setup.subjects=(sec.schema&&sec.schema.subjects)||[];
    APP.setup.tests=(sec.schema&&sec.schema.tests)||[];
    APP.rawData=sec.rawData;
    parseStudents();computeAnalysis();computeGenderAnalysis();
    sec.students=APP.students;sec.classStats=APP.classStats;sec.genderAnalysis=APP.genderAnalysis;sec.dataIssues=APP.dataIssues;sec.cohortClusters=APP.cohortClusters;
  }
  $("#ai-loader").hide();
  stopAiLoaderCardCycle();
  computeCompareGroups();
  unlockStep("dashboard");unlockStep("export");
  const comparable=APP.compareGroups.filter(g=>g.sections.length>=2);
  const msg=comparable.length
    ? " — "+comparable.length+" matching group"+(comparable.length===1?"":"s")+" ("+comparable.map(g=>g.sections.length).join(", ")+" section"+(comparable.some(g=>g.sections.length!==1)?"s":"")+") compared automatically."
    : validSections.length>1?" — no two files share the same subjects/tests, so each is shown individually.":".";
  toast(validSections.length+" file(s) analysed"+msg,"success");
  // GOTCHA FIX (v4.3): same reasoning as the single-file path in
  // runAnalysis() above — Compare Mode has its own separate success point,
  // so it needs its own markClean() call rather than relying on the one
  // in runAnalysis() (which this function's caller returns out of early,
  // before ever reaching it).
  markClean();
  goStep("dashboard");
}
// A schema "signature" used purely to silently GROUP sections that share
// the same subjects/tests/max-marks (same class, different section/batch)
// — normalized so upload order and subject/test ORDER don't matter, only
// the actual content does. Two sections landing in the same group is what
// triggers a silent side-by-side comparison; sections with no match in the
// batch just stay standalone (still fully analysed, still in the dropdown).
// Every generated template names its test tabs "<Class><Section>-<Test
// Name>" (applyTabPrefix() in template-upload.js — e.g. "Class7A-Final
// Exam"), so two otherwise-identical sections (same subjects/tests/max
// marks, different section) NEVER had equal t.name strings — the whole
// point of Compare Mode (silently grouping "same class, different
// section" files) could never fire. Strip each file's OWN class+section
// prefix (reconstructed the same way applyTabPrefix built it, from that
// file's own peeked SETUP tab — schema.className/section) before hashing
// test names, so the comparison is on the test's real name, not on which
// section it came from. Falls back to the untouched name if the test
// wasn't actually prefixed (e.g. an older/manually-edited file).
function stripSectionTestPrefix(name,schema){
  const prefix=(String((schema&&schema.className)||"")+String((schema&&schema.section)||"")).replace(/[^a-zA-Z0-9]/g,"").slice(0,18);
  if(prefix&&name.toLowerCase().startsWith(prefix.toLowerCase()+"-"))return name.slice(prefix.length+1);
  return name;
}
function schemaSignature(schema){
  const subjectsLc=(schema.subjects||[]).map(s=>s.trim().toLowerCase()).sort();
  const maxMarksLookup=Object.create(null);
  (schema.subjects||[]).forEach(s=>{maxMarksLookup[s.trim().toLowerCase()]=s;});
  const testsSig=(schema.tests||[]).map(t=>{
    const mm=(schema.subjects||[]).slice().sort((a,b)=>a.trim().toLowerCase().localeCompare(b.trim().toLowerCase()))
      .map(s=>s.trim().toLowerCase()+":"+((t.maxMarks&&t.maxMarks[s])||100)).join(",");
    const bareName=stripSectionTestPrefix(t.name.trim(),schema);
    return bareName.toLowerCase()+"["+mm+"]";
  }).sort();
  return JSON.stringify({subjectsLc,testsSig});
}
// Groups every analysed valid section by matching schema signature. Groups
// of 2+ get a silent comparison computed (computeSectionComparisonFor) —
// this is the "two files match the class but section/batch differ" case.
// Singleton groups (a file that matches nothing else in the batch, e.g. an
// individual aspirant's sheet dropped alongside a school class) are left
// as standalone entries — still fully analysed, just not compared against
// anything, since there's nothing compatible to compare them to.
function computeCompareGroups(){
  const analysed=APP.sections.filter(s=>s.valid&&s.schema&&s.students&&s.students.length);
  const bySig={};
  analysed.forEach(s=>{
    const sig=schemaSignature(s.schema);
    (bySig[sig]=bySig[sig]||{schema:s.schema,sections:[]}).sections.push(s);
  });
  APP.compareGroups=Object.values(bySig).map((g,i)=>({
    id:"grp"+(i+1),
    subjects:g.schema.subjects,
    sections:g.sections,
    comparison:g.sections.length>=2?computeSectionComparisonFor(g.sections,g.schema.subjects):null
  }));
}
/* ── Management View: Class × Section aggregation for a school director ──
   Compare Mode already lets you upload arbitrary "sections" with free-text
   labels (e.g. "Class 7 - C"). Rather than rebuild Setup/Upload to support
   a formal multi-class model, this parses the labels already in use to
   detect a Class × Section structure, and degrades gracefully (falls back
   to the existing flat section-ranking view) whenever it can't confidently
   find one — e.g. a normal single-class comparison of Section A/B/C. */
function parseClassSection(label){
  const s=(label||"").trim();
  // "Class 7 - C", "Class 7 – Section C", "Grade 6 Section B"
  let m=s.match(/^(.*?)[\s\-–—:,]*\bsec(?:tion)?\.?\s*([A-Za-z0-9]+)\s*$/i);
  if(m&&m[1].trim())return{cls:m[1].trim(),sec:m[2].trim().toUpperCase()};
  // "Class 7 - C", "7th Grade-B", "Class 7C" trailing " - X" / "X" token
  m=s.match(/^(.*?)[\s]*[-–—][\s]*([A-Za-z0-9]{1,3})\s*$/);
  if(m&&m[1].trim())return{cls:m[1].trim(),sec:m[2].trim().toUpperCase()};
  // "6A", "10B" — class number directly followed by a section letter
  m=s.match(/^(.*\d)\s*([A-Za-z])$/);
  if(m&&m[1].trim())return{cls:m[1].trim(),sec:m[2].trim().toUpperCase()};
  return {cls:s,sec:""}; // couldn't confidently split — whole label is the "class"
}
function computeManagementGrid(){
  const rows=APP.sectionComparison||[];
  if(!rows.length)return null;
  const parsed=rows.map(r=>({...r,...parseClassSection(r.label)}));
  const classKeys=[...new Set(parsed.map(r=>r.cls))];
  // Only worth showing as a grid if we found more than one class AND at
  // least some rows actually carried a distinct section token — otherwise
  // this is just the normal single-class section comparison, and the
  // existing flat Section Ranking table below is the right view for that.
  const hasSections=parsed.some(r=>r.sec);
  if(classKeys.length<2||!hasSections)return null;
  const sectionKeys=[...new Set(parsed.map(r=>r.sec).filter(Boolean))].sort();
  const classes=classKeys.map(cls=>{
    const secs=parsed.filter(r=>r.cls===cls).sort((a,b)=>a.sec.localeCompare(b.sec));
    const n=secs.reduce((a,r)=>a+r.n,0);
    const avg=n?Math.round(secs.reduce((a,r)=>a+r.avg*r.n,0)/n):0;
    const passRate=n?Math.round(secs.reduce((a,r)=>a+r.passRate*r.n,0)/n):0;
    const atRisk=secs.reduce((a,r)=>a+r.atRisk,0);
    return {cls,secs,n,avg,passRate,atRisk};
  }).sort((a,b)=>b.avg-a.avg);
  const totalStudents=rows.reduce((a,r)=>a+r.n,0);
  const schoolAvg=totalStudents?Math.round(rows.reduce((a,r)=>a+r.avg*r.n,0)/totalStudents):0;
  const schoolPassRate=totalStudents?Math.round(rows.reduce((a,r)=>a+r.passRate*r.n,0)/totalStudents):0;
  const totalAtRisk=rows.reduce((a,r)=>a+r.atRisk,0);
  const subjects=APP.setup.subjects||[];
  const subjSchoolAvg=subjects.map(sub=>{
    const w=rows.reduce((a,r)=>a+(r.subjectAvgs[sub]||0)*r.n,0);
    return {subject:sub,avg:totalStudents?Math.round(w/totalStudents):0};
  }).sort((a,b)=>a.avg-b.avg); // weakest first
  return {classes,sectionKeys,parsed,totalStudents,schoolAvg,schoolPassRate,totalAtRisk,subjSchoolAvg};
}
// Computes ranked comparison rows for an explicit set of (already-matching-
// schema) sections against an explicit subjects list — used per-group by
// computeCompareGroups() rather than reading a single global shared schema,
// since different groups in the same batch can have entirely different
// subjects (e.g. a school class group vs. a UPSC-aspirant group).
function computeSectionComparisonFor(sections,subjects){
  const passThreshold=APP.setup.passThreshold||35;
  const rows=sections.map(sec=>{
    const n=sec.students.length;
    const avg=n?Math.round(sec.students.reduce((a,st)=>a+(st.analysis.overallAvg||0),0)/n):0;
    const passCount=sec.students.filter(st=>(st.analysis.overallAvg||0)>=passThreshold).length;
    const passRate=n?Math.round(passCount/n*100):0;
    const atRisk=sec.students.filter(st=>st.flags&&st.flags.some(f=>f.type==="at-risk")).length;
    const topper=sec.students.slice().sort((a,b)=>(b.analysis.overallAvg||0)-(a.analysis.overallAvg||0))[0];
    const subjectAvgs={};
    (subjects||[]).forEach(sub=>{
      const vals=sec.students.map(st=>st.analysis.subjectAvgs&&st.analysis.subjectAvgs[sub]).filter(v=>v!=null&&!isNaN(v));
      subjectAvgs[sub]=vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):0;
    });
    return {id:sec.id,label:sec.label,n,avg,passRate,atRisk,topperName:topper?topper.name:"—",topperAvg:topper?(topper.analysis.overallAvg||0):0,subjectAvgs};
  }).sort((a,b)=>b.avg-a.avg);
  rows.forEach((r,i)=>r.rank=i+1);
  return rows;
}

/* ── Compare Dashboard: section list + overview + drill-down ──
   Lists every analysed file individually (so mixed/incompatible uploads —
   an individual aspirant's sheet next to a school class — still each get
   their own dashboard), PLUS one "Compare:" entry per group of 2+
   sections that share the same schema (computeCompareGroups()). The list
   itself now lives in the left rail — see buildCompareSectionListHtml()
   in js/render-dashboard.js (v4.22-compare-mode-shell-parity §1) — this
   used to populate an inline #compare-section-picker dropdown instead. */
// v4.22-compare-mode-shell-parity §2: selecting a single section now
// works exactly like Institution mode's own bucket flow — once this
// section's data is loaded into APP.students/APP.setup/APP.cohortClusters
// (the same shape openBucket() already expects), every existing bucket —
// My Whole Class through Export — works for it with zero changes to the
// bucket functions themselves. Replaces the old selectCompareView(val)'s
// "else" branch.
function selectCompareSection(id){
  const sec=APP.sections.find(s=>s.id===id);
  if(!sec||!sec.students)return;
  // Each section carries its own schema — restore it before rendering,
  // since a different section (or the group/comparison view) may have
  // last set APP.setup.subjects/tests to something else entirely.
  APP.setup.subjects=(sec.schema&&sec.schema.subjects)||APP.setup.subjects;
  APP.setup.tests=(sec.schema&&sec.schema.tests)||APP.setup.tests;
  APP.students=sec.students;APP.classStats=sec.classStats;APP.genderAnalysis=sec.genderAnalysis;
  APP.dataIssues=sec.dataIssues||[];APP.cohortClusters=sec.cohortClusters||null; // §5 fix — this section's own clusters, not whichever ran last
  APP._activeCompareSectionId=id;
  APP._activeCompareGroupId=null;
  APP.sectionComparison=[];
  if(typeof updateExportGate==="function") updateExportGate();
  if(typeof renderShellLeftRail==="function") renderShellLeftRail("dashboard"); // refresh active-row highlight, same pattern as openBucket()/openIndividualBucket()
  if(typeof setShellRailsOpen==="function") setShellRailsOpen(true);
  $("#bucket-screen,#bucket-list-screen").hide();
  openBucket(APP._currentBucketId||"class");
}
// v4.22-compare-mode-shell-parity §3: promotes the existing comparison
// (renderCompareOverview() — ranked section table + management grid when
// detected, already fully computed by computeCompareGroups()) into the
// same persistent center container every other bucket-equivalent view
// uses, instead of a separate #compare-overview-panel. No per-item
// picker for this view (it's a report, not a list to drill into further)
// — same "no properties" pattern renderComparePicker()/renderClusterGroups()
// already use for the right rail.
function selectCompareGroup(groupId){
  const group=(APP.compareGroups||[]).find(g=>g.id===groupId);
  if(!group)return;
  APP.sectionComparison=group.comparison||[];
  APP.setup.subjects=group.subjects||[];
  APP._activeCompareSectionId=null;
  APP._activeCompareGroupId=groupId;
  if(typeof renderShellLeftRail==="function") renderShellLeftRail("dashboard");
  if(typeof setShellRailsOpen==="function") setShellRailsOpen(true);
  if(typeof setShellRailOpen==="function") setShellRailOpen("end", false);
  if(typeof setRightRail==="function") setRightRail("");
  $("#legacy-dashboard-body,#bucket-screen,#bucket-list-screen").hide();
  $("#bucket-answer-screen").show();
  renderDashboardSampleBanner();
  renderCompareOverview(); // retargeted to #bucket-answer-screen, see below
  if(typeof unlockStep==="function") unlockStep("export");
  if(typeof updateExportGate==="function") updateExportGate();
}
function renderManagementGrid(mg){
  if(!mg)return "";
  const kpis=`<div class="grid-4" style="margin-bottom:16px">
    <div class="kpi-card"><div class="kpi-label">Classes × Sections</div><div class="kpi-val">${mg.classes.length} × ${mg.sectionKeys.length}</div></div>
    <div class="kpi-card"><div class="kpi-label">School Avg</div><div class="kpi-val" style="color:${mg.schoolAvg>=60?"var(--c-success)":mg.schoolAvg>=35?"var(--c-warn)":"var(--c-danger)"}">${mg.schoolAvg}%</div></div>
    <div class="kpi-card"><div class="kpi-label">School Pass Rate</div><div class="kpi-val">${mg.schoolPassRate}%</div></div>
    <div class="kpi-card"><div class="kpi-label">Total At-Risk</div><div class="kpi-val" style="color:${mg.totalAtRisk>0?"var(--c-danger)":"inherit"}">${mg.totalAtRisk}</div></div>
  </div>`;
  const cellColor=v=>v>=80?"#e3f9f2":v>=60?"#eef1fe":v>=35?"#fff6e5":"#fdecea";
  const cellText=v=>v>=80?"#0e7a63":v>=60?"#3346a8":v>=35?"#8a5b00":"#b23328";
  const headerRow=`<tr><th style="text-align:left">${esc(srT("th_class"))}</th>${mg.sectionKeys.map(sk=>`<th>${esc(sk)}</th>`).join("")}<th>${esc(srT("card_class_avg"))}</th></tr>`;
  const bodyRows=mg.classes.map(c=>{
    const cells=mg.sectionKeys.map(sk=>{
      const row=c.secs.find(r=>r.sec===sk);
      if(!row)return `<td style="text-align:center;color:var(--c-text3)">—</td>`;
      return `<td style="text-align:center;cursor:pointer" data-action="selectCompareSection" data-arg="${row.id}" title="${esc(srT("title_click_to_open",{label:row.label}))}">
        <div style="background:${cellColor(row.avg)};color:${cellText(row.avg)};border-radius:6px;padding:6px 4px;font-weight:700">${row.avg}%<div style="font-size:9px;font-weight:500;opacity:.8">${row.n} students</div></div>
      </td>`;
    }).join("");
    return `<tr><td style="font-weight:700;white-space:nowrap">${esc(c.cls)}</td>${cells}<td style="text-align:center;font-weight:800;color:${cellText(c.avg)}">${c.avg}%</td></tr>`;
  }).join("");
  const grid=`<div class="card" style="margin-bottom:16px">
    <div class="card-title" style="margin-bottom:4px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><rect x='4' y='3' width='16' height='18' rx='1'/><path d='M9 21V15h6v6'/><path d='M9 7h1M9 11h1M14 7h1M14 11h1'/></svg> Class × Section Overview</div>
    <div style="font-size:11.5px;color:var(--c-text2);margin-bottom:12px">Colour = average score. Click any cell to open that section's full dashboard.</div>
    <div class="tbl-wrap"><table class="data-table"><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table></div>
  </div>`;
  const bestClass=mg.classes[0],worstClass=mg.classes[mg.classes.length-1];
  // Weak-subjects and flagged-sections cards used to be built here too, but
  // that meant they only ever showed up in the (rarer) multi-class case —
  // a director comparing sections of ONE class needs them just as much.
  // They're now computed generally in renderCompareOverview() (see
  // computeWeakSubjects()/computeFlaggedSections()) and shown regardless
  // of whether this Class×Section grid is present at all.
  return `<div class="card" style="margin-bottom:16px;background:linear-gradient(135deg,#1e3a5f,#2a4a7f);color:#fff">
    <div style="font-weight:800;font-size:15px;margin-bottom:2px">Management Summary — All Classes &amp; Sections</div>
    <div style="font-size:11.5px;opacity:.85">Best performing class: ${esc(bestClass.cls)} (${bestClass.avg}%) · Needs most attention: ${esc(worstClass.cls)} (${worstClass.avg}%)</div>
  </div>`+kpis+grid;
}
// General-purpose, ALWAYS-available versions of the two most useful bits of
// the Management grid — weakest subjects and flagged sections — that don't
// require multi-class detection. computeManagementGrid() still gates the
// actual Class×Section GRID TABLE on 2+ classes (that visualisation only
// makes sense with real classes), but a director comparing sections of a
// SINGLE class needs "which subject is weakest" and "which sections need
// attention" just as much — these used to only appear when the class grid
// did, which was backwards.
function computeWeakSubjects(rows){
  const subjects=APP.setup.subjects||[];
  const totalN=rows.reduce((a,r)=>a+r.n,0);
  if(!totalN)return [];
  return subjects.map(sub=>{
    const w=rows.reduce((a,r)=>a+(r.subjectAvgs[sub]||0)*r.n,0);
    return {subject:sub,avg:Math.round(w/totalN)};
  }).sort((a,b)=>a.avg-b.avg);
}
function computeFlaggedSections(rows){
  return rows.filter(r=>r.avg<(APP.setup.passThreshold||35)||r.atRisk>=Math.max(3,Math.round(r.n*0.2)));
}
function renderWeakSubjectsCard(weakest){
  weakest=weakest.slice(0,5);
  if(!weakest.length)return "";
  const bars=weakest.map(w=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
    <div style="width:110px;font-size:11px;color:var(--c-text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(w.subject)}</div>
    <div style="flex:1;background:var(--c-surface2);border-radius:4px;height:14px;overflow:hidden"><div style="width:${w.avg}%;background:${w.avg<35?"var(--c-danger)":w.avg<60?"var(--c-warn)":"var(--c-primary)"};height:100%"></div></div>
    <div style="width:38px;font-size:11px;font-weight:700;text-align:right">${w.avg}%</div>
  </div>`).join("");
  return `<div class="card" style="margin-bottom:16px">
    <div class="card-title" style="margin-bottom:4px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><polyline points='3 7 9 13 13 9 21 18'/><polyline points='15 18 21 18 21 12'/></svg> ${esc(srT("card_weakest_subjects_compared"))}</div>
    <div style="font-size:11.5px;color:var(--c-text2);margin-bottom:10px">${esc(srT("card_averaged_across_sections"))}</div>
    ${bars}
  </div>`;
}
function renderFlaggedSectionsCard(flagged){
  if(!flagged.length)return "";
  return `<div class="card" style="margin-bottom:16px;border-left:3px solid var(--c-danger)">
    <div class="card-title" style="margin-bottom:8px">🚩 Sections Needing Attention</div>
    ${flagged.map(r=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--c-border);cursor:pointer" data-action="selectCompareSection" data-arg="${r.id}">
      <span style="font-weight:600">${esc(r.label)}</span>
      <span style="font-size:12px;color:var(--c-text2)">${r.avg}% avg · ${r.atRisk} at-risk of ${r.n}</span>
    </div>`).join("")}
  </div>`;
}
function renderCompareOverview(){
  const rows=APP.sectionComparison||[];
  const wrap=$("#bucket-answer-screen");
  if(!rows.length){wrap.html('<div class="bucket-empty">No analysed sections yet.</div>');return;}
  const mg=computeManagementGrid();
  // mgHtml now only covers the banner + KPI strip + Class×Section grid
  // table (all genuinely multi-class-only) — the weak-subjects and
  // flagged-sections cards it used to also render are pulled out below so
  // they always show, single-class or not. See renderManagementGrid().
  const mgHtml=mg?renderManagementGrid(mg):"";
  const best=rows[0],worst=rows[rows.length-1];
  const kpis=`<div class="grid-4" style="margin-bottom:16px">
    <div class="kpi-card"><div class="kpi-label">Sections Compared</div><div class="kpi-val">${rows.length}</div></div>
    <div class="kpi-card"><div class="kpi-label">Top Section</div><div class="kpi-val" style="font-size:16px">${esc(best.label)} (${best.avg}%)</div></div>
    <div class="kpi-card"><div class="kpi-label">Needs Attention</div><div class="kpi-val" style="font-size:16px">${esc(worst.label)} (${worst.avg}%)</div></div>
    <div class="kpi-card"><div class="kpi-label">${esc(srT("kpi_total_students"))}</div><div class="kpi-val">${rows.reduce((a,r)=>a+r.n,0)}</div></div>
  </div>`;
  const tableRows=rows.map(r=>`<tr style="cursor:pointer" data-action="selectCompareSection" data-arg="${r.id}" title="${esc(srT("title_click_to_open",{label:r.label}))}">
    <td style="font-weight:700">#${r.rank}</td>
    <td style="font-weight:600">${esc(r.label)} <span style="color:var(--c-primary);font-size:10px">↗</span></td>
    <td>${r.n}</td>
    <td style="font-weight:700;color:${r.avg>=60?"var(--c-success)":r.avg>=35?"var(--c-warn)":"var(--c-danger)"}">${r.avg}%</td>
    <td>${r.passRate}%</td>
    <td style="color:${r.atRisk>0?"var(--c-danger)":"var(--c-text2)"}">${r.atRisk}</td>
    <td>${esc(r.topperName)} (${r.topperAvg}%)</td>
  </tr>`).join("");
  const table=`<div class="card" style="margin-bottom:16px">
    <div class="card-title" style="margin-bottom:2px">Section Ranking</div>
    <div style="font-size:11px;color:var(--c-text2);margin-bottom:10px">Click any row to open that section's full dashboard.</div>
    <div class="tbl-wrap"><table class="data-table"><thead><tr><th>Rank</th><th>Section</th><th>Students</th><th>Avg %</th><th>Pass Rate</th><th>At-Risk</th><th>Topper</th></tr></thead><tbody>${tableRows}</tbody></table></div>
  </div>`;
  const weakCard=renderWeakSubjectsCard(computeWeakSubjects(rows));
  const flagCard=renderFlaggedSectionsCard(computeFlaggedSections(rows));
  const subjects=APP.setup.subjects||[];
  const subjectCards=subjects.map(sub=>{
    const bars=rows.map(r=>{
      const v=r.subjectAvgs[sub]||0;
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <div style="width:120px;font-size:11px;color:var(--c-text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(r.label)}">${esc(r.label)}</div>
        <div style="flex:1;background:var(--c-surface2);border-radius:4px;height:14px;overflow:hidden"><div style="width:${v}%;background:var(--c-primary);height:100%"></div></div>
        <div style="width:38px;font-size:11px;font-weight:700;text-align:right">${v}%</div>
      </div>`;
    }).join("");
    return `<div class="card" style="margin-bottom:12px"><div class="card-title" style="margin-bottom:10px">${esc(sub)}</div>${bars}</div>`;
  }).join("");
  wrap.html(`<div class="bucket-answer-title">${esc(srT("bucket_compare_sections_title"))}</div>`+mgHtml+kpis+table+flagCard+weakCard+`<div class="card-title" style="margin:4px 0 10px">${esc(srT("card_subject_wise_comparison"))}</div>`+subjectCards);
}

/* ── Compare Export: comparison PDF + per-section report bundles ── */
function populateExportSectionPicker(){
  const secs=APP.sections.filter(s=>s.valid&&s.students);
  $("#export-section-select").html(secs.map(s=>`<option value="${s.id}">${esc(s.label)}</option>`).join(""));
}
// Reuses the EXISTING generateAllPDFs()/buildStudentPDF()/buildTeacherPDF()/
// buildMgmtPDF() untouched — temporarily points the same global state a
// single section's snapshot uses for the dashboard drill-down, generates,
// then restores. No PDF logic is duplicated.
async function exportSectionPDFs(sectionId){
  const sec=APP.sections.find(s=>s.id===sectionId);
  if(!sec||!sec.students){toast("Pick a section to export.","warn");return;}
  const saved={students:APP.students,classStats:APP.classStats,genderAnalysis:APP.genderAnalysis,dataIssues:APP.dataIssues,className:APP.setup.className,section:APP.setup.section};
  APP.students=sec.students;APP.classStats=sec.classStats;APP.genderAnalysis=sec.genderAnalysis;APP.dataIssues=sec.dataIssues||[];
  APP.setup.className=sec.label;APP.setup.section="";
  try{await generateAllPDFs();}
  finally{
    APP.students=saved.students;APP.classStats=saved.classStats;APP.genderAnalysis=saved.genderAnalysis;APP.dataIssues=saved.dataIssues;
    APP.setup.className=saved.className;APP.setup.section=saved.section;
  }
}
async function exportAllSectionsPDFs(){
  const secs=APP.sections.filter(s=>s.valid&&s.students);
  if(!secs.length){toast("No analysed sections to export.","warn");return;}
  for(const sec of secs){await exportSectionPDFs(sec.id);await sleep(400);}
}
async function exportComparisonReportPDF(){
  const rows=APP.sectionComparison||[];
  if(!rows.length){toast(srT("val_run_comparison_first"),"warn");return;}
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF("p","mm","a4");
  const W=210;
  doc.setFillColor(30,58,95);doc.rect(0,0,W,22,"F");
  doc.setTextColor(255,255,255);doc.setFont("helvetica","bold");doc.setFontSize(13);
  doc.text(pdfT("pdf_section_comparison_header","Student Insight  |  Section Comparison Report"),10,10);
  doc.setFontSize(8);doc.setFont("helvetica","normal");
  doc.text([APP.setup.instName,APP.setup.year].filter(Boolean).join(" · "),10,17);
  doc.text("Generated: "+new Date().toLocaleDateString(bcp47TagFor(window.SR_LANG)),W-10,17,{align:"right"});
  doc.setTextColor(26,29,46);
  let y=32;
  const mg=computeManagementGrid();
  // Executive summary now always renders (previously gated entirely behind
  // multi-class detection) — weakest-subjects and flagged-sections are
  // useful for a single-class, multi-section comparison too, which is the
  // MORE common case in practice. Only the Class×Section grid table itself
  // stays multi-class-only, since it genuinely doesn't make sense with one.
  {
    doc.setFont("helvetica","bold");doc.setFontSize(13);
    doc.text(mg?pdfT("pdf_exec_summary_all","Executive Summary — All Classes & Sections"):pdfT("pdf_exec_summary","Executive Summary"),10,y);y+=9;
    doc.setFont("helvetica","normal");doc.setFontSize(9);doc.setTextColor(90,96,122);
    doc.text(mg?(mg.classes.length+" classes × "+mg.sectionKeys.length+" sections · "+mg.totalStudents+" students total"):(rows.length+" section"+(rows.length===1?"":"s")+" compared · "+rows.reduce((a,r)=>a+r.n,0)+" students total"),10,y);y+=8;
    // KPI strip
    const kpiBoxes=mg?[[pdfT("pdf_school_avg","School Avg"),mg.schoolAvg+"%"],[pdfT("pdf_pass_rate","Pass Rate"),mg.schoolPassRate+"%"],[pdfT("pdf_total_at_risk","Total At-Risk"),String(mg.totalAtRisk)],[pdfT("pdf_best_class","Best Class"),mg.classes[0].cls]]
      :[[pdfT("pdf_sections","Sections"),String(rows.length)],[pdfT("pdf_top_section","Top Section"),rows[0].label],[pdfT("pdf_needs_attention","Needs Attention"),rows[rows.length-1].label],[pdfT("pdf_total_at_risk","Total At-Risk"),String(rows.reduce((a,r)=>a+r.atRisk,0))]];
    const bw=(W-20-3*4)/4;
    kpiBoxes.forEach((kb,i)=>{
      const bx=10+i*(bw+4);
      doc.setFillColor(242,244,252);doc.roundedRect(bx,y,bw,16,2,2,"F");
      doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(90,96,122);doc.text(kb[0],bx+3,y+6);
      doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(26,29,46);doc.text(fitText(doc,kb[1],bw-6),bx+3,y+12.5);
    });
    y+=24;
    // Class x Section grid — multi-class only
    if(mg){
      doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(26,29,46);doc.text("Class × Section Grid (avg %)",10,y);y+=6;
      const gCols=mg.sectionKeys.length,firstW=32,cellW=(W-20-firstW)/Math.max(1,gCols);
      doc.setFillColor(30,58,95);doc.rect(10,y,W-20,6,"F");
      doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(255,255,255);
      doc.text("Class",12,y+4.2);
      mg.sectionKeys.forEach((sk,i)=>doc.text(sk,10+firstW+i*cellW+cellW/2,y+4.2,{align:"center"}));
      y+=6;
      mg.classes.forEach((c,ci)=>{
        if(y>270){doc.addPage();y=20;}
        doc.setFillColor(ci%2===0?248:255,ci%2===0?249:255,ci%2===0?255:255);doc.rect(10,y,W-20,6,"F");
        doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(26,29,46);
        doc.text(fitText(doc,c.cls,firstW-4),12,y+4.2);
        mg.sectionKeys.forEach((sk,i)=>{
          const row=c.secs.find(r=>r.sec===sk);
          const cx=10+firstW+i*cellW;
          if(!row){doc.setTextColor(190,196,214);doc.text("—",cx+cellW/2,y+4.2,{align:"center"});return;}
          const cc=row.avg>=80?[46,196,182]:row.avg>=60?[43,58,103]:row.avg>=35?[201,151,30]:[242,92,84];
          doc.setTextColor(...cc.map(v=>Math.max(0,v-60)));doc.text(row.avg+"%",cx+cellW/2,y+4.2,{align:"center"});
        });
        y+=6;
      });
      y+=6;
    }
    // Weakest subjects — always
    const weakSubj=computeWeakSubjects(rows).slice(0,5);
    if(weakSubj.length){
      if(y>250){doc.addPage();y=20;}
      doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(26,29,46);doc.text(mg?pdfT("pdf_school_wide_weakest","School-wide Weakest Subjects"):pdfT("card_weakest_subjects_compared","Weakest Subjects (across compared sections)"),10,y);y+=6;
      doc.setFont("helvetica","normal");doc.setFontSize(8.5);
      weakSubj.forEach(w=>{
        if(y>278){doc.addPage();y=20;}
        doc.setTextColor(26,29,46);doc.text(fitText(doc,w.subject,55),10,y-1.5);
        doc.setFillColor(230,230,240);doc.rect(70,y-3.5,100,3.5,"F");
        doc.setFillColor(w.avg<35?242:67,w.avg<35?92:97,w.avg<35?84:238);doc.rect(70,y-3.5,w.avg,3.5,"F");
        doc.text(w.avg+"%",174,y-1.5);
        y+=6;
      });
      y+=4;
    }
    // Flagged sections — always
    const flagged=computeFlaggedSections(rows);
    if(flagged.length){
      if(y>250){doc.addPage();y=20;}
      doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(139,26,26);doc.text("Sections Needing Attention",10,y);y+=6;
      doc.setFont("helvetica","normal");doc.setFontSize(8.5);doc.setTextColor(26,29,46);
      flagged.forEach(r=>{
        if(y>278){doc.addPage();y=20;}
        doc.text("• "+fitText(doc,r.label+" — "+r.avg+"% avg, "+r.atRisk+" at-risk of "+r.n,180),12,y);
        y+=5.5;
      });
      y+=4;
    }
    doc.addPage();y=20;
  }
  doc.setFont("helvetica","bold");doc.setFontSize(12);doc.text("Section Ranking",10,y);y+=8;
  doc.setFontSize(9);doc.setFont("helvetica","bold");
  const cols=[["Rank",10],["Section",26],["Students",84],["Avg %",106],["Pass %",128],["At-Risk",150],["Topper",170]];
  cols.forEach(([label,x])=>doc.text(label,x,y));
  y+=5;doc.setDrawColor(226,229,241);doc.line(10,y-3,200,y-3);
  doc.setFont("helvetica","normal");
  rows.forEach(r=>{
    if(y>272){doc.addPage();y=20;}
    doc.text(String(r.rank),10,y);
    doc.text(fitText(doc,r.label,54),26,y);
    doc.text(String(r.n),84,y);
    doc.text(r.avg+"%",106,y);
    doc.text(r.passRate+"%",128,y);
    doc.text(String(r.atRisk),150,y);
    doc.text(fitText(doc,r.topperName,36),170,y);
    y+=6;
  });
  y+=8;
  (APP.setup.subjects||[]).forEach(sub=>{
    if(y>255){doc.addPage();y=20;}
    doc.setFont("helvetica","bold");doc.setFontSize(11);doc.text(sub+" — Section Averages",10,y);y+=7;
    doc.setFont("helvetica","normal");doc.setFontSize(9);
    rows.forEach(r=>{
      if(y>278){doc.addPage();y=20;}
      const v=r.subjectAvgs[sub]||0;
      doc.text(fitText(doc,r.label,55),10,y-2.5);
      doc.setFillColor(230,230,240);doc.rect(70,y-4,100,3.5,"F");
      doc.setFillColor(43,58,103);doc.rect(70,y-4,v,3.5,"F");
      doc.text(v+"%",174,y-2.5);
      y+=6;
    });
    y+=4;
  });
  stampFooterAllPages(doc,"MANAGEMENT CONFIDENTIAL");
  const fname=safeFileName((APP.setup.instName||"StudentInsight")+"_Section_Comparison")+".pdf";
  doc.save(fname);
  toast(srT("toast_comparison_report_downloaded",{fname:fname}),"success");
}

// Only returns a Strengths note when a genuine strength exists (a subject
// at/above 70%). Previously this fell back to "is working hard to build
// strengths" even when nothing was — that reads as filler to a parent, not
// as a strength, and actually undermines trust in a report that's honest
// everywhere else. Returning null lets the caller omit the section.
function generateStrengthsLetter(st){
  const a=st.analysis,name=st.name.split(" ")[0];
  const topSubjs=Object.entries(a.subjectAvgs||{}).filter(([,v])=>v>=70).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([s])=>s);
  if(!topSubjs.length)return null;
  return `${name} shows genuine strength in ${topSubjs.join(" and ")}${a.overallAvg>=80?" — performing at an excellent level and ready for greater challenges":a.trend==="improving"?" — and the trajectory is very encouraging":""}.${a.resilient?" "+name+" has also shown great resilience, bouncing back after difficult periods.":""}`;
}
function computePercentiles(){const n=APP.students.length;if(!n)return;const sorted=[...APP.students].sort((a,b)=>a.analysis.overallAvg-b.analysis.overallAvg);sorted.forEach((st,i)=>{st.analysis.percentile=n>1?Math.round((i/(n-1))*100):100;});}

/* ════ CONTINUITY (2-PERIOD SCHEMA FOUNDATION — prompt-01-schema-foundation-2period.md) ════
   Pure functions only, per that prompt's scope — no UI wiring, no reads
   of APP.* here on purpose, so these stay testable in isolation and safe
   to land ahead of the actual multi-period SETUP/STUDENTS/MARKS tab
   parsing work (a much bigger, separately-scoped change — see chat notes
   for why that part isn't in this same pass). No new stored state; both
   are computed fresh from whatever the caller passes in. */

// deriveRosterStatus(studentId, periodIdx, periodsPresence)
//   periodsPresence: array indexed by period (0-based), each element a
//     Set<string> of student IDs that have at least one marks row in
//     that period's <PeriodLabel>-Test<N> tabs (the roster-diff signal
//     IS presence/absence of rows — no separate diff table, per spec).
//   Returns one of: "continuing" | "joined" | "left" | "not_present".
//   "not_present" covers the "student doesn't exist in this slice yet"
//   case (e.g. a student who only appears starting in a later period
//   this slice doesn't include, or someone who genuinely never appears
//   anywhere in the periods given) — a caller should render this as "no
//   status to show yet," never as a crash or a false joined/left guess.
//   The caller supplies periodsPresence by scanning which
//   <PeriodLabel>-Test<N> tabs contain a row for each student ID; that
//   scan itself lives with the SETUP/STUDENTS/MARKS parsing change,
//   intentionally NOT built in this pass.


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { _compareSectionSeq, addCompareSection, applyCompareModeUI, computeCompareGroups, computeFlaggedSections, computeManagementGrid, computePercentiles, computeSectionComparisonFor, computeWeakSubjects, exportAllSectionsPDFs, exportComparisonReportPDF, exportSectionPDFs, fingerprintRawData, generateStrengthsLetter, invalidateStaleComparison, parseClassSection, peekSectionSetup, populateExportSectionPicker, processCompareFile, removeHomeCompareFile, renameHomeCompareFile, renderCompareOverview, renderFlaggedSectionsCard, renderHomeFileList, renderManagementGrid, renderWeakSubjectsCard, resolveMarksRows, runCompareAnalysisCore, safeFileName, schemaSignature, selectCompareGroup, selectCompareSection, validateTemplateStructure };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window._compareSectionSeq=_compareSectionSeq;window.addCompareSection=addCompareSection;window.applyCompareModeUI=applyCompareModeUI;window.computeCompareGroups=computeCompareGroups;window.computeFlaggedSections=computeFlaggedSections;window.computeManagementGrid=computeManagementGrid;window.computePercentiles=computePercentiles;window.computeSectionComparisonFor=computeSectionComparisonFor;window.computeWeakSubjects=computeWeakSubjects;window.exportAllSectionsPDFs=exportAllSectionsPDFs;window.exportComparisonReportPDF=exportComparisonReportPDF;window.exportSectionPDFs=exportSectionPDFs;window.fingerprintRawData=fingerprintRawData;window.generateStrengthsLetter=generateStrengthsLetter;window.invalidateStaleComparison=invalidateStaleComparison;window.parseClassSection=parseClassSection;window.peekSectionSetup=peekSectionSetup;window.populateExportSectionPicker=populateExportSectionPicker;window.processCompareFile=processCompareFile;window.removeHomeCompareFile=removeHomeCompareFile;window.renameHomeCompareFile=renameHomeCompareFile;window.renderCompareOverview=renderCompareOverview;window.renderFlaggedSectionsCard=renderFlaggedSectionsCard;window.renderHomeFileList=renderHomeFileList;window.renderManagementGrid=renderManagementGrid;window.renderWeakSubjectsCard=renderWeakSubjectsCard;window.resolveMarksRows=resolveMarksRows;window.runCompareAnalysisCore=runCompareAnalysisCore;window.safeFileName=safeFileName;window.schemaSignature=schemaSignature;window.selectCompareGroup=selectCompareGroup;window.selectCompareSection=selectCompareSection;window.validateTemplateStructure=validateTemplateStructure;}
