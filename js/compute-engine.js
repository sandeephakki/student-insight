/* ════ ANALYSIS ════ */
async function runAnalysis(){
  const _runBtn=document.getElementById("btn-home-run-analysis");
  // M1 fix (robustness audit): guard against double-submit (fast re-click /
  // slow mobile double-tap) re-entering this function before the first run
  // finishes. Disabled here, unconditionally re-enabled in the finally below
  // so an exception mid-run (see the global error handler in
  // app-utils-init.js) can never leave it stuck disabled.
  if(_runBtn){if(_runBtn.disabled)return;_runBtn.disabled=true;}
  _runBtn?.classList.remove("btn-glow");
  try{
    if(APP.compareMode){await runCompareAnalysisCore();return;}
    if(!APP.rawData){toast("Upload data first.","warn");return;}
    // Only collect from form if the form has been filled (has subjects in DOM)
    // Otherwise keep APP.setup as loaded from Excel import
    const domSubjects=$("#subjects-list .subj-row input").map(function(){return $(this).val().trim();}).get().filter(Boolean);
    if(domSubjects.length){collectSetupForm();}
    if(!APP.setup.subjects.length||!APP.setup.tests.length){autoInferSetup();}
    if(!APP.setup.subjects.length){const isIndividual=APP.setup.mode==="individual";toast(isIndividual?"We couldn't find your subjects — go back to Setup and re-generate the template.":"Cannot detect subjects. Check SETUP tab or fill Step 1.","warn");return;}
    if(!APP.setup.tests.length){const isIndividual=APP.setup.mode==="individual";toast(isIndividual?"We couldn't find your tests — go back to Setup and re-generate the template.":"Cannot detect tests. Check SETUP tab or fill Step 1.","warn");return;}
    if(!APP.aiFeatures.size)selectAllAI();
    // Data validation
    const _vw=validateData();
    if(_vw.some(w=>w.e)){
      const vhtml=_vw.map(w=>`<div style="padding:5px 0;font-size:12px"><span style="color:${w.e?'var(--c-danger)':'var(--c-warn)'}">●</span> ${w.m}</div>`).join("");
      const el=document.getElementById("validation-warnings");
      if(el){el.innerHTML=`<div class="card" style="border-color:var(--c-danger);margin-bottom:12px"><b style="color:var(--c-danger)">Data errors found</b>${vhtml}</div>`;el.style.display="block";}
      // v2.4: the Analyse/checkbox screen is no longer visited by default —
      // if analysis can't proceed, surface it there anyway (it still exists,
      // it's just not the default stop) rather than failing silently on
      // whatever screen the user happened to be on when this ran.
      goStep("ai");
      toast("Fix the data error(s) shown below before analysis can run.","error");
      return;
    }
    const _warnings=validateData().filter(w=>!w.e);
    if(_warnings.length){
      const el=document.getElementById("validation-warnings");
      if(el){el.innerHTML=`<div class="card" style="border-color:var(--c-warn);margin-bottom:12px"><b style="color:var(--c-warn)">⚠ Data warnings (analysis will proceed)</b>`+_warnings.map(w=>`<div style="font-size:12px;margin-top:4px">● ${w.m}</div>`).join("")+`</div>`;el.style.display="block";}
    } else {const el=document.getElementById("validation-warnings");if(el)el.style.display="none";}
    // Nothing else stops a workbook with thousands of rows from freezing the
    // tab — computeAnalysis() and renderStudentCards() both run synchronously
    // over every student. Estimate the row count up front (before the heavier
    // parse/compute work below) and give the teacher a heads-up, since this
    // app's stated target environment is often lower-end classroom hardware.
    const _estMarkKey=Object.keys(APP.rawData).find(k=>k.includes("MARK"))||"";
    const estStudentRows=(APP.rawData["MARKS+CONTEXT"]||APP.rawData["MARKS_CONTEXT"]||APP.rawData[_estMarkKey]||[]).length;
    if(estStudentRows>1500){
      if(!confirm(`This file looks like it has ${estStudentRows}+ student rows. Analysing a class this large may take a while and could freeze the tab on slower computers. Continue anyway?`))return;
    } else if(estStudentRows>300){
      toast(`Large class detected (~${estStudentRows} students) — analysis may take longer than usual.`,"warn");
    }
    goStep("ai"); // v2.4: bring the loader on-screen even though this step is no longer a manual stop in the normal flow
    $("#ai-loader").show();
    // btn-analyse / phase-actionbar-btns removed (v3.2) — panel-ai is now a pure progress screen, nothing to disable.
    // Bring the loader into view (respecting the fixed header) so the user
    // actually sees the progress instead of staring at a checkbox list that
    // looks frozen while work happens off-screen above them.
    scrollToEl(document.getElementById("ai-loader"));
    const steps=["Reading uploaded file…","Parsing student records…","Computing marks & percentages…","Running trend detection…","Calculating percentile ranks…","Detecting students requiring support…","Sentiment analysis on remarks…","Running stress & wellbeing scoring…","Generating AI-assisted insights…","Estimating next-test trajectory…","Finalising academic insights…"];
    for(let i=0;i<steps.length;i++){
      $("#ai-loader-msg").text(steps[i]);
      $("#ai-loader-step").text("Step "+(i+1)+" of "+steps.length);
      const pct=Math.round(((i+1)/steps.length)*100);
      $("#ai-prog").css("width",pct+"%");$("#ai-prog-label").text(pct+"%");
      await sleep(420+Math.random()*280);
    }
    parseStudents();computeAnalysis();computeGenderAnalysis();
    $("#ai-loader").hide();
    // btn-analyse / phase-actionbar-btns removed (v3.2) — panel-ai is now a pure progress screen, nothing to re-enable.
    if(APP.students.length){unlockStep("dashboard");unlockStep("export");}
    updateExportGate();
    // GOTCHA FIX (v4.3): markClean() existed but was never called anywhere,
    // so the #unsaved-dot lit on the first Setup edit and stayed lit for the
    // rest of the session regardless of what happened after. Product
    // decision: a completed analysis is the point the current Setup form
    // values get captured into something the user can actually see (the
    // dashboard about to render) — same idea as a "save," for an app with
    // no persistence. Editing Setup again after this still re-dirties via
    // the existing markDirty() calls, so the dot stays meaningful.
    markClean();
    toast("Analysis complete - "+APP.students.length+" students processed.","success");goStep("dashboard");
  } finally {
    if(_runBtn)_runBtn.disabled=false;
  }
}
/* ════════════════════════════════════════════════════════════════════
   OLD SINGLE-SHEET SCHEMA — validateData()
   Kept commented out for reference/safety per explicit request. Delete
   once the new multi-tab version below has been confirmed working.
   ════════════════════════════════════════════════════════════════════
function validateData_OLD(){
  const w=[];
  const markKey=Object.keys(APP.rawData).find(k=>k.includes("MARK"))||"";
  const marks=APP.rawData["MARKS+CONTEXT"]||APP.rawData["MARKS_CONTEXT"]||APP.rawData[markKey]||[];
  const normId=v=>String(v||"").trim().toUpperCase();
  const ids=marks.map(r=>normId(r["Student ID"])).filter(Boolean);
  const dups=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
  if(dups.length)w.push({e:1,m:"Duplicate Student IDs: "+dups.join(", ")});
  if(!ids.length)w.push({e:1,m:"No student rows found in MARKS+CONTEXT. Upload a filled Excel."});
  const noName=marks.filter(r=>normId(r["Student ID"])&&!String(r["Full Name"]||"").trim()).length;
  if(noName)w.push({e:0,m:noName+" row(s) have a Student ID but no Full Name filled in."});
  return w;
}
════════════════════════════════════════════════════════════════════ */

// NEW SCHEMA (multi-tab redesign): student identity now lives solely on
// STUDENTS, so that's what duplicate-ID/no-rows checks run against. Two
// new checks that had no equivalent in the single-sheet world: (1) every
// configured test's name must match an actual tab name in the uploaded
// file — this is also the "confirms the template is genuinely ours" check
// requested explicitly, since a file that was hand-edited or built by
// something else is very unlikely to have tab names matching exactly;
// (2) orphan rows (marks for a Student ID not on the roster) are counted
// here as a warning banner, in addition to the per-row detail already
// pushed into APP.dataIssues by parseStudents().
function validateData(){
  const w=[];
  const normId=v=>String(v||"").trim().toUpperCase();
  const studentsRows=APP.rawData["STUDENTS"];

  if(studentsRows===undefined){
    w.push({e:1,m:"No STUDENTS tab found. If this is an older Student Insight file, please download a fresh template and re-enter your data — sorry for the inconvenience, the file format has been updated to one tab per test."});
    return w; // nothing else is checkable without a roster
  }
  const ids=(studentsRows||[]).map(r=>normId(r["Student ID"])).filter(Boolean);
  const dups=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
  if(dups.length)w.push({e:1,m:"Duplicate Student IDs on the STUDENTS tab: "+dups.join(", ")});
  if(!ids.length)w.push({e:1,m:"No student rows found on the STUDENTS tab. Upload a filled Excel."});

  // TEMPLATE-AUTHENTICITY CHECK (explicitly requested): every test's name
  // in Setup must exist as an actual tab name in the uploaded workbook —
  // confirms this is genuinely a Student Insight file, and catches a
  // renamed test/tab before it silently produces an empty test.
  const sheetNamesUpper=new Set(Object.keys(APP.rawData).filter(k=>!k.startsWith("_")).map(n=>n.toUpperCase().trim()));
  const missingTabs=(APP.setup.tests||[]).filter(t=>!sheetNamesUpper.has(t.name.toUpperCase().trim())).map(t=>t.name);
  if(missingTabs.length)w.push({e:1,m:`No tab found matching test name "${missingTabs.join('", "')}" — the tab name must exactly match the test name in Setup (this also confirms the file is a genuine Student Insight template).`});

  // Gender is required by the template design (M/F) but only feeds the
  // optional gender-analysis feature — a warning, not a hard block.
  const noGender=(studentsRows||[]).filter(r=>normId(r["Student ID"])&&!String(r["Gender"]||"").trim()).length;
  if(noGender)w.push({e:0,m:noGender+" student(s) on the STUDENTS tab don't have a Gender filled in (expected M or F)."});

  // Orphan rows — marks entered for a Student ID that isn't on the
  // roster. parseStudents() already records the per-row detail; this is
  // the aggregate warning shown before analysis even runs, whenever
  // possible (parseStudents() itself hasn't necessarily run yet the first
  // time validateData() is called, so this re-derives the count directly).
  const rosterIds=new Set(ids);
  let orphanCount=0;
  (APP.setup.tests||[]).forEach(t=>{
    const sheet=APP.rawData[t.name];
    if(!sheet)return;
    sheet.forEach(row=>{
      const id=normId(row["Student ID"]);
      if(id&&!rosterIds.has(id))orphanCount++;
    });
  });
  if(orphanCount)w.push({e:0,m:orphanCount+" row(s) across test tabs have a Student ID that isn't on the STUDENTS roster — those rows will be skipped."});

  return w;
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

/* ════ SCROLL HELPER ════
   The topbar + stepper are fixed/sticky (~96px). Native scrollIntoView()
   doesn't know about them, so it happily scrolls a target's top edge to
   y=0 — which is *behind* those fixed bars. The element then sits half
   hidden and the page visibly "jumps up" further than expected.
   This helper scrolls to the correct position (leaving clearance below
   the fixed bars) and skips the scroll entirely if the target is
   already comfortably in view, so repeated calls in quick succession
   (e.g. a "reading…" message immediately followed by a "done" message)
   don't produce a jarring double-jump. */
function scrollToEl(el){
  if(!el)return;
  const headerH=(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--content-top"))||96)+14;
  const rect=el.getBoundingClientRect();
  // Already fully visible below the fixed header and above the viewport
  // bottom? Don't move the page at all.
  if(rect.top>=headerH&&rect.bottom<=window.innerHeight)return;
  const targetY=window.scrollY+rect.top-headerH;
  window.scrollTo({top:Math.max(0,targetY),behavior:"smooth"});
}

/* ════════════════════════════════════════════════════════════════════
   OLD SINGLE-SHEET SCHEMA — parseStudents()
   Kept commented out for reference/safety per explicit request. Delete
   once the new multi-tab version below has been confirmed working.
   ════════════════════════════════════════════════════════════════════
function parseStudents_OLD(){
  const {subjects,tests}=APP.setup;
  APP.dataIssues=[];
  const markKey=Object.keys(APP.rawData).find(k=>k.includes("MARK")&&k.includes("CONTEXT"))||Object.keys(APP.rawData).find(k=>k.includes("MARK"))||"";
  const markSheetName=APP.rawData["MARKS+CONTEXT"]?"MARKS+CONTEXT":(APP.rawData["MARKS_CONTEXT"]?"MARKS_CONTEXT":markKey);
  const markSheet=APP.rawData[markSheetName]||[];
  const _hdrRow=APP.rawData["_hdr_"+markSheetName]||Object.keys(markSheet[0]||{});
  const _firstSubj=(subjects[0]||"").trim();
  const _subjCount=_firstSubj?_hdrRow.filter(k=>(k||"").trim()===_firstSubj).length:0;
  const isGrouped=_subjCount>1;
  let posMap=null;
  if(isGrouped){
    posMap={};
    const ko={};
    _hdrRow.forEach((k,i)=>{if(!k)return;const kn=k.trim();if(!ko[kn])ko[kn]=[];ko[kn].push(i);});
    tests.forEach((t,ti)=>{
      posMap[t.name]={};
      subjects.forEach(s=>{const pos=ko[s.trim()]||[];if(pos[ti]!==undefined)posMap[t.name][s]=pos[ti];});
      const abPos=ko["Absent Days"]||ko["AbsentDays"]||[];if(abPos[ti]!==undefined)posMap[t.name]["__absent"]=abPos[ti];
      const rmPos=ko["Teacher Remark"]||ko["Remark"]||[];if(rmPos[0]!==undefined)posMap[t.name]["__remark"]=rmPos[0];
      const chPos=ko["Chapter"]||[];if(chPos[0]!==undefined)posMap[t.name]["__chapter"]=chPos[0];
    });
  }
  function getVal(row,testName,short,full){
    if(posMap&&posMap[testName]&&posMap[testName][short]!==undefined){
      const raw=row.__raw;
      const pv=raw?raw[posMap[testName][short]]:undefined;
      if(pv!==undefined&&pv!==null&&pv!==""){const n=parseFloat(String(pv).replace(/[^0-9.-]/g,""));return isNaN(n)?pv:n;}
    }
    const keys=[testName+" - "+short+" Marks",testName+" — "+short+" Marks",testName+" - "+short,testName+" — "+short,testName+"-"+short,testName+"_"+short,full,short];
    for(const k of keys){
      if(k===undefined||k===null)continue;
      const kn=k.replace(/—/g,"-").replace(/[\n\r]/g," ").replace(/\s+/g," ").trim();
      const v=row[k]!==undefined?row[k]:(row[kn]!==undefined?row[kn]:undefined);
      if(v!==undefined&&v!==null&&v!==""){
        const n=parseFloat(String(v).replace(/[^0-9.-]/g,""));
        return isNaN(n)?v:n;
      }
    }
    return null;
  }
  function getRawVal(row,testName,short,full){
    if(posMap&&posMap[testName]&&posMap[testName][short]!==undefined){
      const raw=row.__raw;
      const pv=raw?raw[posMap[testName][short]]:undefined;
      if(pv!==undefined&&pv!==null&&pv!=="")return pv;
    }
    const keys=[testName+" - "+short+" Marks",testName+" — "+short+" Marks",testName+" - "+short,testName+" — "+short,testName+"-"+short,testName+"_"+short,full,short];
    for(const k of keys){
      if(k===undefined||k===null)continue;
      const kn=k.replace(/—/g,"-").replace(/[\n\r]/g," ").replace(/\s+/g," ").trim();
      const v=row[k]!==undefined?row[k]:(row[kn]!==undefined?row[kn]:undefined);
      if(v!==undefined&&v!==null&&v!=="")return v;
    }
    return null;
  }
  const normId=v=>String(v||"").trim().toUpperCase();
  const legacyStudentSheet=APP.rawData["STUDENTS"]||[];
  const legacyMap={};
  legacyStudentSheet.forEach(r=>{
    const rawId=String(r["Student ID"]||r["ID"]||"").trim();
    const key=normId(rawId);
    const name=String(r["Full Name"]||r["Name"]||r["Student Name"]||"").trim();
    const skipWords=["excellent","good (","average (","below pass"];
    if((key||name)&&!skipWords.some(w=>name.toLowerCase().includes(w))&&!key.toLowerCase().startsWith("student"))
      legacyMap[key]={id:rawId,name,gender:r["Gender"]||"",dob:r["Date of Birth"]||"",
        contact:r["Parent Contact"]||r["Contact"]||"",address:r["Address"]||""};
  });
  const studentData={};
  let skippedBlankRows=0;
  markSheet.forEach(row=>{
    const rawId=String(row["Student ID"]||"").trim();const key=normId(rawId);
    const legacy=legacyMap[key];
    const nm=String(row["Full Name"]||row["Student Name"]||row["Name"]||"").trim();
    if(!key)return;
    if(!nm&&!(legacy&&legacy.name)){skippedBlankRows++;return;}
    if(!studentData[key])studentData[key]={id:rawId,name:nm||(legacy&&legacy.name)||rawId,
      gender:row["Gender"]||(legacy&&legacy.gender)||"",dob:row["Date of Birth"]||(legacy&&legacy.dob)||"",
      contact:row["Parent Contact"]||row["Contact"]||(legacy&&legacy.contact)||"",
      address:row["Address"]||(legacy&&legacy.address)||"",
      testData:{}};
    tests.forEach(t=>{
      if(!studentData[key].testData[t.name])studentData[key].testData[t.name]={marks:{},absents:0,remark:"",chapter:""};
      subjects.forEach(s=>{
        const raw=getRawVal(row,t.name,s);
        if(raw===null||raw===undefined)return;
        const cleaned=String(raw).trim();
        const stripped=cleaned.replace(/[^0-9.-]/g,"");
        const n=parseFloat(stripped);
        const studentLabel=studentData[key].name||rawId;
        if(isNaN(n)){
          APP.dataIssues.push({studentId:rawId,studentName:studentLabel,test:t.name,subject:s,
            message:`entered "${raw}" — not a valid number, mark ignored`});
          return;
        }
        if(stripped!==cleaned){
          APP.dataIssues.push({studentId:rawId,studentName:studentLabel,test:t.name,subject:s,
            message:`entered "${raw}" — contained non-numeric characters, read as ${n}`});
        }
        if(n<0){
          APP.dataIssues.push({studentId:rawId,studentName:studentLabel,test:t.name,subject:s,
            message:`entered ${n} — negative marks aren't valid, mark ignored`});
          return;
        }
        studentData[key].testData[t.name].marks[s]=n;
      });
      const abKey=posMap&&posMap[t.name]?posMap[t.name]["__absent"]:undefined;
      const ab=abKey!==undefined?(row.__raw?row.__raw[abKey]:undefined):getVal(row,t.name,"Absent Days");
      if(ab!==null&&ab!=="")studentData[key].testData[t.name].absents=parseInt(ab)||0;
      const rmKey=posMap&&posMap[t.name]?posMap[t.name]["__remark"]:undefined;
      const rm=rmKey!==undefined?(row.__raw?row.__raw[rmKey]:undefined):getVal(row,t.name,"Remark");
      if(rm!==null&&rm!=="")studentData[key].testData[t.name].remark=String(rm);
      const chKey=posMap&&posMap[t.name]?posMap[t.name]["__chapter"]:undefined;
      const ch=chKey!==undefined?(row.__raw?row.__raw[chKey]:undefined):getVal(row,t.name,"Chapter");
      if(ch!==null&&ch!=="")studentData[key].testData[t.name].chapter=String(ch).trim();
    });
  });
  APP.students=Object.values(studentData);
  if(skippedBlankRows>0)toast(skippedBlankRows+" empty template row"+(skippedBlankRows>1?"s were":" was")+" skipped.","info");
}
════════════════════════════════════════════════════════════════════ */

// NEW SCHEMA (multi-tab redesign): STUDENTS tab is now the single source
// of student identity (id/name/gender) — marks come from N separate
// per-test sheets, joined back to the roster by Student ID. No more
// grouped-header/posMap positional-column gymnastics: one test = one
// sheet = one normal flat header row, so a plain key lookup is enough.
// A row in a test tab whose Student ID isn't on the roster is now a real,
// named failure mode ("orphan row") that didn't exist in the single-sheet
// world — surfaced per-row in APP.dataIssues, same place mark-quality
// issues already show up.
function parseStudents(){
  const {subjects,tests}=APP.setup;
  APP.dataIssues=[];
  const normId=v=>String(v||"").trim().toUpperCase();

  // ── ROSTER — STUDENTS tab, single source of student identity ──
  const rosterRows=APP.rawData["STUDENTS"]||[];
  const studentData={};
  const rosterOrder=[];
  rosterRows.forEach(row=>{
    const rawId=String(row["Student ID"]||"").trim();
    if(!rawId)return; // blank ID — unused template sample row, skip silently
    const key=normId(rawId);
    if(studentData[key])return; // duplicate roster ID — validateData() surfaces this as a blocking error separately
    let nm=String(row["Full Name"]||"").trim();
    // M2/L1 fix (robustness audit): an unbounded Full Name (thousands of
    // characters, whether pasted by mistake or adversarially crafted) is
    // displayed as-is everywhere `.name` is read — dashboard cards, PDF
    // headers/footers, Smart Search — and a fixed-width PDF layout box has
    // no wrap/ellipsis of its own, so it can silently overflow or corrupt
    // that page. Cap defensively and surface it as a visible data issue
    // rather than letting it distort rendering downstream.
    const NAME_MAX=120;
    if(nm.length>NAME_MAX){
      APP.dataIssues.push({studentId:rawId,studentName:nm.slice(0,NAME_MAX),test:"",subject:"",
        message:`Full Name is ${nm.length} characters — truncated to ${NAME_MAX} for display/export.`});
      nm=nm.slice(0,NAME_MAX);
    }
    // Full Name is optional by design — falls back to the ID everywhere
    // `.name` is displayed (dashboard, PDFs, remarks, Smart Search…) since
    // they all already read this one field.
    studentData[key]={id:rawId,name:nm||rawId,hasName:!!nm,
      gender:String(row["Gender"]||"").trim(),testData:{}};
    rosterOrder.push(key);
    tests.forEach(t=>{studentData[key].testData[t.name]={marks:{},absents:0,remark:"",chapter:""};});
  });

  function getRawVal(row,short){
    const keys=[short+" Marks",short];
    for(const k of keys){
      const v=row[k];
      if(v!==undefined&&v!==null&&v!=="")return v;
    }
    return null;
  }
  function getVal(row,short){
    const raw=getRawVal(row,short);
    if(raw===null)return null;
    const n=parseFloat(String(raw).replace(/[^0-9.-]/g,""));
    return isNaN(n)?raw:n;
  }

  // ── MARKS — one sheet per test, joined back to the roster by Student ID ──
  let orphanCount=0;
  tests.forEach(t=>{
    const sheet=APP.rawData[t.name];
    if(!sheet){
      // Also checked as a hard, blocking validation in validateData() —
      // this per-test note is the softer "this one test has nothing"
      // case, kept so partial uploads (some tests filled, one not yet)
      // still analyse the tests that ARE present.
      APP.dataIssues.push({studentId:"",studentName:"",test:t.name,subject:"",
        message:`No tab named "${t.name}" was found in the uploaded file — this test has no marks.`});
      return;
    }
    sheet.forEach(row=>{
      const rawId=String(row["Student ID"]||"").trim();
      if(!rawId)return;
      const key=normId(rawId);
      if(!studentData[key]){
        orphanCount++;
        APP.dataIssues.push({studentId:rawId,studentName:rawId,test:t.name,subject:"",
          message:`Student ID "${rawId}" appears in the "${t.name}" tab but not on the STUDENTS roster — this row was skipped.`});
        return;
      }
      subjects.forEach(s=>{
        const raw=getRawVal(row,s);
        if(raw===null||raw===undefined)return; // genuinely blank cell — nothing to flag
        const cleaned=String(raw).trim();
        const stripped=cleaned.replace(/[^0-9.-]/g,"");
        const n=parseFloat(stripped);
        const studentLabel=studentData[key].name;
        if(isNaN(n)){
          APP.dataIssues.push({studentId:rawId,studentName:studentLabel,test:t.name,subject:s,
            message:`entered "${raw}" — not a valid number, mark ignored`});
          return;
        }
        if(stripped!==cleaned){
          APP.dataIssues.push({studentId:rawId,studentName:studentLabel,test:t.name,subject:s,
            message:`entered "${raw}" — contained non-numeric characters, read as ${n}`});
        }
        if(n<0){
          APP.dataIssues.push({studentId:rawId,studentName:studentLabel,test:t.name,subject:s,
            message:`entered ${n} — negative marks aren't valid, mark ignored`});
          return;
        }
        studentData[key].testData[t.name].marks[s]=n;
      });
      const ab=getVal(row,"Absent Days");
      if(ab!==null&&ab!=="")studentData[key].testData[t.name].absents=parseInt(ab)||0;
      const rm=getRawVal(row,"Remark")||getRawVal(row,"Teacher Remark");
      if(rm!==null&&rm!==""){
        let remarkStr=String(rm);
        const REMARK_MAX=1000;
        if(remarkStr.length>REMARK_MAX){
          APP.dataIssues.push({studentId:rawId,studentName:studentData[key].name,test:t.name,subject:"",
            message:`Remark is ${remarkStr.length} characters — truncated to ${REMARK_MAX} for display/export.`});
          remarkStr=remarkStr.slice(0,REMARK_MAX);
        }
        studentData[key].testData[t.name].remark=remarkStr;
      }
      const ch=getRawVal(row,"Chapter");
      if(ch!==null&&ch!=="")studentData[key].testData[t.name].chapter=String(ch).trim();
    });
  });

  APP.students=rosterOrder.map(k=>studentData[k]);
  if(orphanCount>0)toast(orphanCount+" row"+(orphanCount>1?"s had":" had")+" a Student ID not on the roster and "+(orphanCount>1?"were":"was")+" skipped — see Data Issues.","warn");
}

/* ════ COMPUTE ANALYSIS ════ */
// TASK (Project Bible v2 §4.3, "remark sentiment tagging"): the
// "AI Remark Sentiment" checkbox (ai_teacher_remarks_ai) and the
// "Sentiment analysis on remarks…" loader step have existed since the AI
// panel was built, but nothing ever computed a tone — confirmed nothing
// in this codebase read or wrote a sentiment/tone value anywhere before
// this. Deterministic keyword match, not a real NLP/ML model — same
// "everything computed locally, nothing sent anywhere" constraint as the
// rest of this app applies to free-text teacher remarks too, so an
// API-based sentiment call was never on the table. English-only (remarks
// are free-text teacher input, not part of the app's own translated UI)
// and doesn't handle negation ("not lazy" reads as negative) — a known,
// stated limitation of a lightweight heuristic, not a hidden one.
const REMARK_CONCERN_WORDS=["weak","struggl","poor","lack","irregular","careless","distract","worry","worri","concern","fail","declin","inconsistent","lazy","disturb","disrupt","inattentive","low effort","needs improvement","needs to improve","must improve","not focus","losing interest","falling behind"];
const REMARK_POSITIVE_WORDS=["excellent","outstanding","great","good","improv","consistent","hardworking","hard-working","sincere","active","bright","confident","strong","well done","keep it up","diligent","dedicated","punctual","attentive","enthusiastic","brilliant","proud","commendable","impressive"];
function classifyRemarkTone(text){
  if(!text||!text.trim())return null;
  const t=text.toLowerCase();
  const concernHits=REMARK_CONCERN_WORDS.filter(w=>t.includes(w)).length;
  const positiveHits=REMARK_POSITIVE_WORDS.filter(w=>t.includes(w)).length;
  if(concernHits>positiveHits)return "concern";
  if(positiveHits>concernHits)return "positive";
  return "neutral";
}

function computeAnalysis(){
  const {subjects,tests,passThreshold,absentAlert,dropAlert}=APP.setup;
  // Not reset here — parseStudents() (which always runs immediately before
  // this) already reset it at the true start of the analysis run, and owns
  // the invalid/negative-mark issues it detects. Resetting again here would
  // silently wipe those out before this loop even runs.
  APP.students.forEach(st=>{
    st.analysis={};const testAvgs=[];const cumAvgByTest=[];let cumMarks=0,cumMax=0;
    tests.forEach((t)=>{
      const td=st.testData[t.name]||{marks:{},absents:0,remark:"",chapter:""};
      td.remarkTone=classifyRemarkTone(td.remark);
      let total=0,maxTotal=0,scored=0;
      subjects.forEach(s=>{const m=td.marks[s];const mx=(t.maxMarks&&t.maxMarks[s])||100;if(m!==null&&m!==undefined&&m!==""){const mv=parseFloat(m)||0;if(mv>mx)APP.dataIssues.push({studentId:st.id,studentName:st.name,test:t.name,subject:s,message:`entered ${mv}, exceeds max of ${mx} — will inflate this test's percentage`});total+=Math.min(mv,mx);maxTotal+=mx;scored++;}else maxTotal+=mx;});
      testAvgs.push(scored?Math.round((total/maxTotal)*100):null);
      if(scored){cumMarks+=total;cumMax+=maxTotal;}
      // Cumulative avg *as of this test* (not the final overallAvg) — used
      // only by computeExtraInsights() below to derive class-rank movement
      // between the last two tests. Purely additive; doesn't change
      // testAvgs/overallAvg/anything already relied on.
      cumAvgByTest.push(cumMax?Math.round((cumMarks/cumMax)*100):null);
    });
    const valid=testAvgs.filter(v=>v!==null);
    // Best / worst individual test — generic, works for any institution,
    // needs no data beyond what's already collected.
    let bestI=-1,worstI=-1;
    testAvgs.forEach((v,i)=>{if(v!==null){if(bestI===-1||v>testAvgs[bestI])bestI=i;if(worstI===-1||v<testAvgs[worstI])worstI=i;}});
    st.analysis.bestTest=bestI>-1?{name:tests[bestI].name,pct:testAvgs[bestI]}:null;
    st.analysis.worstTest=(worstI>-1&&worstI!==bestI)?{name:tests[worstI].name,pct:testAvgs[worstI]}:null;
    // Remark-tone rollup — counts, not the classifier itself (see
    // classifyRemarkTone above, already run per-test in the loop above).
    const tones=tests.map(t=>(st.testData[t.name]||{}).remarkTone).filter(Boolean);
    st.analysis.remarkToneSummary=tones.length?{
      positive:tones.filter(x=>x==="positive").length,
      neutral:tones.filter(x=>x==="neutral").length,
      concern:tones.filter(x=>x==="concern").length,
      total:tones.length
    }:null;
    // Single rounding from raw cumulative totals (avoids compounding rounding error from averaging pre-rounded per-test %s)
    st.analysis.overallAvg=cumMax?Math.round((cumMarks/cumMax)*100):0;
    st.analysis.testAvgs=testAvgs;
    st.analysis.cumAvgByTest=cumAvgByTest;
    const a=st.analysis.overallAvg;
    st.analysis.grade=a>=90?"A+":a>=80?"A":a>=70?"B":a>=60?"C":a>=passThreshold?"D":"F";
    let trend="stable";if(valid.length>=2){const diff=valid[valid.length-1]-valid[0];trend=diff>=5?"improving":diff<=-5?"declining":"stable";}
    st.analysis.trend=trend;
    st.flags=[];
    if(APP.dataIssues.some(di=>di.studentId===st.id))st.flags.push({type:"data-error",label:"⚠ Data Error",color:"#c0392b"});
    if(a<passThreshold)st.flags.push({type:"at-risk",label:"At Risk",color:"var(--c-danger)"});
    // Distinct from At Risk (which looks at the cumulative overall average
    // and can't fire until several bad tests have already dragged it down).
    // This catches the exact moment a previously-passing student's *latest*
    // test dropped below the pass threshold for the first time — useful even
    // when their overall average is still comfortably above the line.
    if(valid.length>=2&&valid[valid.length-1]<passThreshold&&valid.slice(0,-1).every(v=>v>=passThreshold)){
      st.flags.push({type:"first-below-pass",label:"First Time Below Pass",color:"#d35400"});
    }
    if(trend==="declining")st.flags.push({type:"declining",label:"Declining",color:"var(--c-warn)"});
    if(trend==="improving")st.flags.push({type:"improving",label:"Improving",color:"var(--c-success)"});
    if(valid.length>=2)for(let i=1;i<valid.length;i++){if(valid[i]!==null&&valid[i-1]!==null&&(valid[i-1]-valid[i])>=dropAlert){st.flags.push({type:"sharp-drop",label:"Sharp Drop",color:"var(--c-danger)"});break;}}
    let totalAbsent=0;tests.forEach(t=>{totalAbsent+=(st.testData[t.name]&&st.testData[t.name].absents)||0;});
    st.analysis.totalAbsent=totalAbsent;
    if(totalAbsent>=absentAlert)st.flags.push({type:"absent",label:"High Absence",color:"var(--c-purple)"});
    if(valid.length>=2){const mean=valid.reduce((a,b)=>a+b,0)/valid.length;const variance=valid.reduce((a,b)=>a+(b-mean)**2,0)/valid.length;if(Math.sqrt(variance)>15)st.flags.push({type:"volatile",label:"Volatile",color:"#3bc9db"});}
    const subjectAvgs={};subjects.forEach(s=>{const vals=tests.map(t=>{const m=(st.testData[t.name]||{}).marks&&st.testData[t.name].marks[s];const mx=(t.maxMarks&&t.maxMarks[s])||100;return m!==null&&m!==undefined&&m!==""?Math.min(100,m/mx*100):null;}).filter(v=>v!==null);subjectAvgs[s]=vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):0;});
    st.analysis.subjectAvgs=subjectAvgs;
    const sortedSubjs=Object.entries(subjectAvgs).sort((a,b)=>b[1]-a[1]);
    st.analysis.strongSubject=sortedSubjs[0]&&sortedSubjs[0][0];st.analysis.weakSubject=sortedSubjs[sortedSubjs.length-1]&&sortedSubjs[sortedSubjs.length-1][0];
    const stressScore=Math.min(100,Math.round((totalAbsent*5)+(trend==="declining"?30:0)+(a<passThreshold?40:0)));
    st.analysis.stressScore=stressScore;st.analysis.wellbeingFlag=stressScore>=60?"high":stressScore>=30?"moderate":"low";
    if(valid.length>=2){const slope=(valid[valid.length-1]-valid[0])/(valid.length-1);st.analysis.predictedNext=Math.max(0,Math.min(100,Math.round(valid[valid.length-1]+slope)));}else st.analysis.predictedNext=null;
    // Extended AI features
    if(valid.length>=2){const mean=valid.reduce((a,b)=>a+b,0)/valid.length;const sd=Math.sqrt(valid.reduce((a,b)=>a+(b-mean)**2,0)/valid.length);st.analysis.consistencyScore=Math.max(0,Math.round(100-sd*2));}else st.analysis.consistencyScore=100;
    // Relative growth (last vs first valid test) blows up when the starting
    // score is near zero — e.g. 0% -> 50% computes as +5000%, which is
    // technically "correct" as a ratio but meaningless/embarrassing on a
    // report a parent reads. Clamp to a still-informative but sane range.
    st.analysis.growthRate=valid.length>=2?Math.max(-300,Math.min(300,Math.round(((valid[valid.length-1]-valid[0])/Math.max(valid[0],1))*100))):0;
    st.analysis.cumulativeAvg=valid.length?Math.round(valid.reduce((a,b)=>a+b,0)/valid.length):0;
    // Burnout: was high (>70) then dropped
    const wasHigh=valid.length>=2&&valid[0]>=70;const nowLow=valid.length>=2&&valid[valid.length-1]<(valid[0]-15);st.analysis.burnoutRisk=wasHigh&&nowLow;
    if(st.analysis.burnoutRisk)st.flags.push({type:"burnout",label:"Burnout Risk",color:"#e67e22"});
    // Resilience: recovered after drop
    let recovered=false;for(let i=2;i<valid.length;i++){if(valid[i-1]<valid[i-2]-10&&valid[i]>valid[i-1]+8)recovered=true;}st.analysis.resilient=recovered;
    if(recovered)st.flags.push({type:"resilient",label:"Resilient",color:"#27ae60"});
    // Engagement index: (100 - absentPct) * trend multiplier
    const absentPct=Math.min(100,(st.analysis.totalAbsent/(APP.setup.tests.length*3||1))*100);
    const trendMult=st.analysis.trend==="improving"?1.1:st.analysis.trend==="declining"?0.8:1;
    st.analysis.engagementIndex=Math.min(100,Math.round((100-absentPct)*trendMult));
    // Strengths letter
    st.analysis.strengthsLetter=generateStrengthsLetter(st);
    // Competitive readiness
    st.analysis.competitiveReadiness=st.analysis.overallAvg>=80?"High":st.analysis.overallAvg>=65?"Moderate":st.analysis.overallAvg>=50?"Developing":"Needs Support";
    // Early warning composite
    const ewScore=(st.flags.filter(f=>f.type==="at-risk").length*40)+(st.flags.filter(f=>f.type==="sharp-drop").length*20)+(st.flags.filter(f=>f.type==="absent").length*15)+(st.flags.filter(f=>f.type==="volatile").length*10)+(st.flags.filter(f=>f.type==="burnout").length*15);
    st.analysis.earlyWarningScore=Math.min(100,ewScore);
    // Plateau: all avgs within 5% of each other across 3+ tests
    if(valid.length>=3){const r=Math.max(...valid)-Math.min(...valid);st.analysis.plateau=r<=8;if(st.analysis.plateau&&st.analysis.overallAvg<70)st.flags.push({type:"plateau",label:"Plateau",color:"#8e44ad"});}
    else st.analysis.plateau=false;

    // ── STUDENT HEALTH SCORE (0–100) ──
    const hs_acad=Math.min(100,st.analysis.overallAvg);
    const hs_cons=st.analysis.consistencyScore||100;
    const hs_trend=st.analysis.trend==="improving"?100:st.analysis.trend==="declining"?20:60;
    const hs_eng=st.analysis.engagementIndex||100;
    st.analysis.healthScore=Math.round((hs_acad*0.4)+(hs_cons*0.2)+(hs_trend*0.2)+(hs_eng*0.2));
    st.analysis.healthBand=st.analysis.healthScore>=80?"Excellent":st.analysis.healthScore>=65?"Good":st.analysis.healthScore>=50?"Average":st.analysis.healthScore>=35?"Below Average":"Needs Support";

    // ── DATA QUALITY ── (computed before explainedWarnings below so a
    // flag pushed here still picks up its explanation text)
    const filledSubjects=subjects.filter(s=>tests.some(t=>st.testData[t.name]&&st.testData[t.name].marks[s]!=null&&st.testData[t.name].marks[s]!==""));
    st.analysis.missingSubjects=subjects.filter(s=>!filledSubjects.includes(s));
    st.analysis.hasDataGaps=st.analysis.missingSubjects.length>0||(valid.length<tests.length);
    // This was computed but never surfaced anywhere in the UI — a student
    // missing marks for an entire subject had no visible indicator at all.
    if(st.analysis.missingSubjects.length)st.flags.push({type:"data-gap",label:"⚠ Missing: "+st.analysis.missingSubjects.join(", "),color:"#8e7cc3"});

    // Moved here (was previously called mid-way through flag computation, before
    // burnout/resilient/plateau/data-gap were pushed — those flags were silently
    // invisible to every narrative field below).
    st.analysis.parentMessage=generateParentMessage(st);st.analysis.trendFacts=generateTrendFacts(st);st.analysis.homePlan=generateHomePlan(st);st.analysis.schoolPlan=generateSchoolPlan(st);

    // ── EXPLAINABLE WARNINGS ──
    st.analysis.explainedWarnings=st.flags.map(f=>{
      const fn=st.name.split(" ")[0];
      const reasons={
        "at-risk":`${fn} scored ${st.analysis.overallAvg}%, below the pass threshold of ${APP.setup.passThreshold}%. Immediate academic support is recommended.`,
        "first-below-pass":`${fn} passed every prior test but fell below the ${APP.setup.passThreshold}% pass threshold on the most recent one (${valid[valid.length-1]}%). Worth checking in now, before it becomes a pattern.`,
        "sharp-drop":`A sharp performance drop was detected between tests. Check for health issues, external factors, or learning gaps in specific subjects.`,
        "declining":`Trend is declining across ${valid.length} tests (${valid[0]}% → ${valid[valid.length-1]}%). Investigate root causes and increase personalised support.`,
        "absent":`Total absences of ${st.analysis.totalAbsent} days across test periods exceeds the alert threshold. Missed lessons may be impacting performance significantly.`,
        "volatile":`High score variance detected. ${fn} performs inconsistently — may indicate test anxiety, inconsistent preparation, or external disruptions.`,
        "burnout":`${fn} started strong (${valid[0]}%) but has declined by ${Math.round(valid[0]-valid[valid.length-1])}%. This pattern suggests burnout — consider reducing pressure and restoring motivation.`,
        "plateau":`Scores remain flat (within ${Math.round(Math.max(...valid)-Math.min(...valid))}%) across ${valid.length} tests. Stagnation suggests the current teaching approach may need variation.`,
        "resilient":`${fn} recovered well after a performance dip — a strong resilience indicator.`,
        "data-gap":`No marks were found for ${st.analysis.missingSubjects.join(", ")} across any test. Confirm whether ${fn} genuinely didn't sit these, or whether the source sheet is missing entries.`,
      };
      return{...f,reason:reasons[f.type]||f.label};
    });
  });
  // E5: a scale mismatch (e.g. every subject's Max Marks left at the 100
  // default while the real exam is scored out of 200/250, UPSC-style) looks
  // identical to genuinely poor performance — every student clusters near 0%
  // or near 100% with almost no variance, class-wide, across every test.
  // That's a statistical signature a real class's marks almost never
  // produce, so flag it as a likely configuration issue rather than
  // letting it silently report as an implausible 0%/100% pass rate.
  (function detectScaleMismatch(){
    const allPct=[];
    APP.students.forEach(st=>{(st.analysis&&st.analysis.testAvgs||[]).forEach(v=>{if(v!==null&&v!==undefined)allPct.push(v);});});
    if(allPct.length<Math.max(3,APP.students.length))return; // not enough signal yet
    const allHigh=allPct.every(v=>v>=90),allLow=allPct.every(v=>v<50);
    if(allHigh||allLow){
      APP.dataIssues.push({studentId:"",studentName:"",test:"",subject:"",
        scaleMismatch:true,
        message:allHigh
          ?"Every student scores ≥90% against the configured Max Marks across every test — this often means Max Marks is set lower than the exam's real scale. Check the Max Marks values in Setup before trusting these results."
          :"Every student scores below 50% against the configured Max Marks across every test — this often means Max Marks is set higher than the exam's real scale. Check the Max Marks values in Setup before trusting these results."});
    }
  })();
  APP.students.sort((a,b)=>b.analysis.overallAvg-a.analysis.overallAvg);
  // Standard competition ranking ("1224" ranking): students tied on
  // overallAvg share the same rank, and the next distinct score's rank
  // skips ahead by the number of students tied above it. Previously this
  // was just `i+1`, so two students with an identical average got
  // different ranks purely based on incidental sort order — statistically
  // wrong and looks arbitrary/unfair when a teacher or parent compares
  // two equal scores.
  APP.students.forEach((st,i)=>{
    st.analysis.rank=(i>0&&st.analysis.overallAvg===APP.students[i-1].analysis.overallAvg)?APP.students[i-1].analysis.rank:i+1;
  });
  const trueTop=APP.students.length?APP.students[0].analysis.overallAvg:0;
  APP.students.forEach(st=>{st.analysis.topperGap=Math.max(0,trueTop-st.analysis.overallAvg);});
  computeExtraInsights();
  computePercentiles();
  computeClassStats();
  computePeerOutliers();
  computeCohortClusters();
}
// ── PEER OUTLIER DETECTION (bible §5 "Outlier detection, z-score, both
// directions") — the "Peer Outlier" checkbox has existed in the AI
// Features picker (AI_FEATURES) since early versions but nothing ever
// actually computed it; toggling it silently did nothing. This is the
// real implementation: z-score of each student's overallAvg against the
// class mean/SD (both already sitting in APP.classStats — no new pass
// over the raw data needed). Runs after computeClassStats() since it
// needs the class-wide mean/SD to exist first. Purely additive: pushes
// onto the same st.flags/explainedWarnings arrays every other flag
// already uses, so Alerts tab, "Flagged" filter, and PDF export pick it
// up automatically with no extra wiring.
function computePeerOutliers(){
  const cs=APP.classStats||{};
  const n=cs.n||0,mean=cs.mean,sd=cs.sd;
  // Needs a real class to be statistically meaningful — same floor used
  // elsewhere in this file (e.g. attendanceCorrelation's min group size).
  if(n<4||!sd){APP.students.forEach(st=>{st.analysis.zScore=null;st.analysis.peerOutlier=null;});return;}
  APP.students.forEach(st=>{
    const z=(st.analysis.overallAvg-mean)/sd;
    st.analysis.zScore=Math.round(z*100)/100;
    st.analysis.peerOutlier=null;
    if(Math.abs(z)>=2){
      const dir=z>0?"high":"low";
      st.analysis.peerOutlier=dir;
      const fn=st.name.split(" ")[0]||st.name;
      const type=dir==="high"?"peer-outlier-high":"peer-outlier-low";
      const label=dir==="high"?"Outlier (High)":"Outlier (Low)";
      const color=dir==="high"?"#0ca678":"#e8590c";
      const reason=`${fn}'s overall average (${st.analysis.overallAvg}%) is a statistical outlier vs the class — z-score ${st.analysis.zScore} against a class mean of ${mean}% (SD ${sd}). ${dir==="high"?"Unusually far ahead of":"Unusually far below"} peers — worth a closer look either way.`;
      st.flags.push({type,label,color});
      st.analysis.explainedWarnings=(st.analysis.explainedWarnings||[]).concat([{type,label,color,reason}]);
    }
  });
}
/* ════ COHORT CLUSTERING — k-means (bible §5 "Student clustering",
   §8 Phase 3) ════
   Deliberately gated to real class sizes (n>=30) per the bible's own
   caveat: with the ~8-10 row demo/sample files this app ships with,
   k-means would just re-partition students by overall average — nothing
   the existing rank/trend/flag system doesn't already say — while
   *looking* like a sophisticated insight. That's worse than not having
   it. At n>=30 there's enough spread for genuine multi-dimensional
   patterns (e.g. "moderate average but highly volatile" vs "moderate
   average and rock-steady") to actually separate from noise.

   MATHS, for anyone auditing this:
   - 4 features per student: overallAvg, consistencyScore, trend slope
     (points/test, signed), absence rate (absent days / test count).
     All already computed in computeAnalysis()'s per-student pass except
     slope, which is derived fresh here the same way predictedNext's
     slope is derived above (last-valid minus first-valid, over test
     count) — kept local rather than stored on st.analysis to avoid two
     sources of truth for "the trend slope."
   - Features are z-score standardized ((x-mean)/sd) across the cohort
     BEFORE clustering. Without this, overallAvg (0-100 range) would
     dominate absence rate (0-1 range) purely on scale, not on actual
     signal — standardizing is what makes "4 features" mean 4 features,
     not 1.something.
   - Initialization is k-means++ (probability-weighted by squared
     distance to nearest existing centroid), not naive random-k-points —
     naive init is the single most common source of bad/inconsistent
     k-means results (centroids starting close together, converging to
     a poor local minimum).
   - 10 independent restarts, keeping the lowest-inertia (sum of squared
     distances to assigned centroid) result — k-means only guarantees
     convergence to *a* local minimum, not *the* global one, so restarts
     are the standard mitigation, not an optional nicety.
   - Empty-cluster reseeding: if an iteration leaves a centroid with zero
     members (can happen with k-means++ init), it's reseeded to the point
     currently farthest from its assigned centroid, per standard k-means
     practice — otherwise that cluster silently dies and you effectively
     get k-1 clusters while still labeling/reporting k of them.
   - Deterministic seeded RNG (mulberry32) rather than Math.random(), so
     re-running analysis on the same import produces the same grouping —
     important for a teacher who re-opens the same Excel file expecting
     the same read, not a different clustering every time.
   - Cluster *labels* (e.g. "High & Steady") are assigned AFTER
     clustering, by inspecting each centroid's real (un-standardized)
     values — k-means itself has no concept of "good"/"bad", it only
     finds where the data clumps; the labeling is a separate, simple,
     inspectable rule layered on top, not something the algorithm itself
     produces. */
function _kmEuclidSq(a,b){let s=0;for(let i=0;i<a.length;i++){const d=a[i]-b[i];s+=d*d;}return s;}
function _kmPlusPlusInit(vectors,k,rng){
  const centroids=[vectors[Math.floor(rng()*vectors.length)].slice()];
  while(centroids.length<k){
    const dists=vectors.map(v=>Math.min(...centroids.map(c=>_kmEuclidSq(v,c))));
    const sum=dists.reduce((a,b)=>a+b,0);
    if(sum===0){centroids.push(vectors[Math.floor(rng()*vectors.length)].slice());continue;}
    let r=rng()*sum,idx=0;
    for(;idx<dists.length-1;idx++){r-=dists[idx];if(r<=0)break;}
    centroids.push(vectors[idx].slice());
  }
  return centroids;
}
function _kmSingleRun(vectors,k,maxIter,rng){
  let centroids=_kmPlusPlusInit(vectors,k,rng);
  let labels=new Array(vectors.length).fill(-1);
  for(let iter=0;iter<maxIter;iter++){
    const newLabels=vectors.map(v=>{
      let best=0,bestD=Infinity;
      centroids.forEach((c,ci)=>{const d=_kmEuclidSq(v,c);if(d<bestD){bestD=d;best=ci;}});
      return best;
    });
    const changed=newLabels.some((l,i)=>l!==labels[i]);
    labels=newLabels;
    if(!changed)break;
    const dims=vectors[0].length;
    const sums=Array.from({length:k},()=>new Array(dims).fill(0));
    const counts=new Array(k).fill(0);
    vectors.forEach((v,i)=>{const c=labels[i];counts[c]++;for(let d=0;d<dims;d++)sums[c][d]+=v[d];});
    centroids=sums.map((s,ci)=>{
      if(counts[ci]===0){
        let farI=0,farD=-1;
        vectors.forEach((v,i)=>{const d=_kmEuclidSq(v,centroids[labels[i]]);if(d>farD){farD=d;farI=i;}});
        return vectors[farI].slice();
      }
      return s.map(x=>x/counts[ci]);
    });
  }
  let inertia=0;
  vectors.forEach((v,i)=>{inertia+=_kmEuclidSq(v,centroids[labels[i]]);});
  return {labels,centroids,inertia};
}
function _kmRun(vectors,k,restarts,maxIter,seed){
  let s=seed>>>0;
  function rng(){s|=0;s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;}
  let best=null;
  for(let r=0;r<restarts;r++){
    const res=_kmSingleRun(vectors,k,maxIter,rng);
    if(!best||res.inertia<best.inertia)best=res;
  }
  return best;
}
function computeCohortClusters(){
  APP.cohortClusters=null;
  if(APP.setup.mode==="individual")return; // one student — clustering is meaningless
  const students=APP.students||[];
  const n=students.length;
  // Bible §5/§8 gate — see block comment above for why.
  if(n<30)return;
  const tests=APP.setup.tests||[];
  const raw=students.map(st=>{
    const a=st.analysis||{};
    const valid=(a.testAvgs||[]).filter(v=>v!==null&&v!==undefined);
    const slope=valid.length>=2?(valid[valid.length-1]-valid[0])/(valid.length-1):0;
    const absenceRate=tests.length?(a.totalAbsent||0)/tests.length:0;
    return {overallAvg:a.overallAvg||0,consistency:a.consistencyScore!=null?a.consistencyScore:100,slope,absenceRate};
  });
  const dims=["overallAvg","consistency","slope","absenceRate"];
  const stats={};
  dims.forEach(d=>{
    const vals=raw.map(r=>r[d]);
    const mean=vals.reduce((a,b)=>a+b,0)/n;
    const sd=Math.sqrt(vals.reduce((a,b)=>a+(b-mean)**2,0)/n)||1; // guard: a dead-flat feature (sd=0) would divide by zero — treat as already-neutral instead
    stats[d]={mean,sd};
  });
  const vectors=raw.map(r=>dims.map(d=>(r[d]-stats[d].mean)/stats[d].sd));
  const k=n>=60?4:3;
  // Fixed seed (not date/time-based) so the same import always produces
  // the same grouping — see block comment above.
  const {labels,centroids,inertia}=_kmRun(vectors,k,10,200,1234567);
  const centroidsReal=centroids.map(c=>{const o={};dims.forEach((d,i)=>{o[d]=Math.round((c[i]*stats[d].sd+stats[d].mean)*10)/10;});return o;});
  const order=centroidsReal.map((c,i)=>({i,avg:c.overallAvg})).sort((a,b)=>b.avg-a.avg);
  const groups=order.map((o,rankIdx)=>{
    const c=centroidsReal[o.i];
    let label;
    if(rankIdx===0)label=c.consistency>=70?"High & Steady":"High but Volatile";
    else if(rankIdx===order.length-1)label=c.slope<-1?"Low & Declining":"Needs Support";
    else label=c.consistency<60?"Moderate but Inconsistent":"Moderate & Steady";
    const memberIdx=[];labels.forEach((l,si)=>{if(l===o.i)memberIdx.push(si);});
    return {clusterIndex:o.i,label,centroid:c,students:memberIdx.map(si=>students[si])};
  });
  students.forEach((st,i)=>{st.analysis.cohortClusterLabel=(groups.find(g=>g.clusterIndex===labels[i])||{}).label||null;});
  APP.cohortClusters={k,dims,inertia:Math.round(inertia*100)/100,groups};
}
/* ════ EXTRA INSIGHTS (added on top of the original analysis engine —
   generic, no new data columns required, works for any institution) ════
   Runs after ranking/topperGap so it can use the class-wide picture
   (subject averages, per-test cumulative standings) that only exists
   once every student has been processed once. */
function computeExtraInsights(){
  const {subjects,tests}=APP.setup;
  // 1) Subject-vs-class-average delta: how far above/below the class's own
  // average this student is, per subject — same subjectAvgs data every
  // other feature already uses, just re-aggregated one level up.
  const classSubjectAvg={};
  subjects.forEach(s=>{
    const vals=APP.students.map(st=>st.analysis.subjectAvgs[s]||0);
    classSubjectAvg[s]=vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):0;
  });
  APP.students.forEach(st=>{
    const deltas={};
    subjects.forEach(s=>{deltas[s]=Math.round((st.analysis.subjectAvgs[s]||0)-classSubjectAvg[s]);});
    st.analysis.subjectDeltas=deltas;
  });
  // 2) Class-rank movement between the last two tests, using each
  // student's cumulative average AS OF that point in time (cumAvgByTest,
  // captured during the main loop above) — not the final overallAvg. The
  // existing `rank` field only reflects the end state; this answers
  // "is this student's standing in the class moving up or down right now."
  if(tests.length>=2){
    const idxCurr=tests.length-1, idxPrev=tests.length-2;
    function rankAt(idx){
      const ranked=APP.students.map(st=>({id:st.id,v:st.analysis.cumAvgByTest[idx]})).filter(r=>r.v!==null).sort((a,b)=>b.v-a.v);
      const rankMap={};
      ranked.forEach((r,i)=>{rankMap[r.id]=(i>0&&r.v===ranked[i-1].v)?rankMap[ranked[i-1].id]:i+1;});
      return rankMap;
    }
    const prevRanks=rankAt(idxPrev),currRanks=rankAt(idxCurr);
    APP.students.forEach(st=>{
      const p=prevRanks[st.id],c=currRanks[st.id];
      st.analysis.rankMovement=(p!=null&&c!=null)?(p-c):null; // positive = moved up in the class
    });
  }else{
    APP.students.forEach(st=>{st.analysis.rankMovement=null;});
  }
}

function computeClassStats(){
  const {subjects,passThreshold}=APP.setup;
  const avgs=APP.students.map(st=>st.analysis.overallAvg).filter(v=>!isNaN(v)).sort((a,b)=>a-b);
  if(!avgs.length){APP.classStats={};return APP.classStats;}
  const n=avgs.length;
  const mean=Math.round(avgs.reduce((a,b)=>a+b,0)/n);
  const median=n%2===0?(avgs[n/2-1]+avgs[n/2])/2:avgs[Math.floor(n/2)];
  const q1=avgs[Math.floor(n*0.25)];const q3=avgs[Math.floor(n*0.75)];
  const sd=Math.round(Math.sqrt(avgs.reduce((a,b)=>a+(b-mean)**2,0)/n));
  const hAvg=Math.round(APP.students.reduce((s,st)=>s+(st.analysis.healthScore||0),0)/n);
  // Attendance-vs-performance correlation (class level only). Min group
  // size of 2 on both sides is a basic anonymity/noise floor — same spirit
  // as the gender-analysis privacy floor elsewhere, just a lighter bar
  // since attendance isn't a protected personal category the way gender is.
  const noAbsence=APP.students.filter(st=>(st.analysis.totalAbsent||0)===0);
  const someAbsence=APP.students.filter(st=>(st.analysis.totalAbsent||0)>0);
  const attendanceCorrelation=(noAbsence.length>=2&&someAbsence.length>=2)?{
    noAbsence:{avg:Math.round(noAbsence.reduce((a,s)=>a+s.analysis.overallAvg,0)/noAbsence.length),n:noAbsence.length},
    someAbsence:{avg:Math.round(someAbsence.reduce((a,s)=>a+s.analysis.overallAvg,0)/someAbsence.length),n:someAbsence.length}
  }:null;
  // Class-wide subject weakness — which SUBJECT needs attention, not which
  // student. Reuses subjectAvgs (already computed per student); nothing new.
  const subjectWeakness=(subjects&&subjects.length)?subjects.map(s=>{
    const vals=APP.students.map(st=>st.analysis.subjectAvgs[s]||0);
    const belowCount=vals.filter(v=>v<passThreshold).length;
    return {subject:s,pctBelow:Math.round((belowCount/n)*100),avgClass:Math.round(vals.reduce((a,b)=>a+b,0)/n)};
  }).sort((a,b)=>b.pctBelow-a.pctBelow):[];
  // Subject-vs-subject correlation matrix — do strong-in-Physics students
  // also tend to be strong in Maths? Pairwise Pearson r across every
  // student's subjectAvgs. Reuses the same subjectAvgs subjectWeakness
  // uses above; nothing new is computed per student.
  // Gate at n>=10: unlike attendanceCorrelation's 2-vs-2 group-average
  // comparison, a single Pearson r computed over a handful of points is
  // extremely sensitive to one outlier — 10 is a reasoned floor for this
  // app (no existing precedent to match exactly; percentile suppresses
  // below 12, k-means clustering gates at 30, this sits between the two
  // since it's a class-level summary stat like attendanceCorrelation, not
  // a per-student computation).
  // NOTE: correlation is scale/shift-invariant, so z-standardizing inputs
  // first (as computeCohortClusters() above does for its feature vectors)
  // would produce an IDENTICAL r — that step is skipped here on purpose,
  // not omitted by oversight.
  const subjectCorrelation=(subjects&&subjects.length>=2&&n>=10)?(()=>{
    function pearson(xs,ys){
      const m=xs.length;
      const mx=xs.reduce((a,b)=>a+b,0)/m,my=ys.reduce((a,b)=>a+b,0)/m;
      let num=0,dx2=0,dy2=0;
      for(let i=0;i<m;i++){const dx=xs[i]-mx,dy=ys[i]-my;num+=dx*dy;dx2+=dx*dx;dy2+=dy*dy;}
      if(dx2===0||dy2===0)return null; // zero-variance subject (every student scored identically) — r is genuinely undefined, not 0
      return Math.round((num/Math.sqrt(dx2*dy2))*100)/100;
    }
    const seriesBySubject={};
    subjects.forEach(s=>{seriesBySubject[s]=APP.students.map(st=>st.analysis.subjectAvgs[s]||0);});
    const matrix=subjects.map(a=>subjects.map(b=>a===b?1:pearson(seriesBySubject[a],seriesBySubject[b])));
    const pairs=[];
    for(let i=0;i<subjects.length;i++)for(let j=i+1;j<subjects.length;j++){
      const r=matrix[i][j];
      if(r!==null)pairs.push({a:subjects[i],b:subjects[j],r});
    }
    pairs.sort((p,q)=>Math.abs(q.r)-Math.abs(p.r));
    return {subjects,matrix,pairs,n};
  })():null;
  APP.classStats={mean,median,q1,q3,sd,n,healthAvg:hAvg,min:avgs[0],max:avgs[n-1],
    distribution:{excellent:avgs.filter(v=>v>=80).length,good:avgs.filter(v=>v>=60&&v<80).length,average:avgs.filter(v=>v>=35&&v<60).length,below:avgs.filter(v=>v<35).length},
    attendanceCorrelation,subjectWeakness,subjectCorrelation};
  return APP.classStats;
}
/* ════ GENDER-GAP ANALYSIS (school/institutional level only) ════
   Wires up the "diversity_analysis" AI feature checkbox to real logic —
   see the AI_FEATURES doc block above. This is deliberately a class/school
   aggregate metric, never surfaced per-student: a single child's gender is
   not a useful or appropriate thing to print on their own report, but
   "are girls outperforming boys in Math this term?" is a legitimate,
   commonly-asked question at the class/institution level.
   MIN_GENDER_GROUP is a privacy floor, not just a statistics one — with
   very small groups, an "average" is effectively naming an identifiable
   student's score, which is exactly the kind of exposure a privacy-first
   tool should avoid by default. */
function normGender(raw){
  const s=String(raw||"").trim().toLowerCase();
  if(["m","male","boy","b"].includes(s))return "Male";
  if(["f","female","girl","g"].includes(s))return "Female";
  return null; // blank / "Other" / non-binary / typos — excluded from the
               // binary comparison rather than guessed at
}
function computeGenderAnalysis(){
  APP.genderAnalysis=null;
  if(!APP.aiFeatures.has("diversity_analysis"))return null;
  const MIN_GENDER_GROUP=3;
  const {subjects,passThreshold}=APP.setup;
  const groups={Male:[],Female:[]};
  APP.students.forEach(st=>{const g=normGender(st.gender);if(g)groups[g].push(st);});
  const eligible=Object.entries(groups).filter(([,arr])=>arr.length>=MIN_GENDER_GROUP);
  if(eligible.length<2){
    APP.genderAnalysis={available:false,
      reason:!Object.values(groups).some(a=>a.length)?"No Gender column found — add one to the MARKS+CONTEXT tab to enable this.":
        "Not enough students with a recognised Gender value in at least two groups (need "+MIN_GENDER_GROUP+"+ each) to report a meaningful comparison."};
    return APP.genderAnalysis;
  }
  const stats={};
  eligible.forEach(([label,arr])=>{
    const avg=Math.round(arr.reduce((a,st)=>a+(st.analysis.overallAvg||0),0)/arr.length);
    const passRate=Math.round(arr.filter(st=>(st.analysis.overallAvg||0)>=passThreshold).length/arr.length*100);
    const subjectAvgs={};
    subjects.forEach(s=>{
      const vals=arr.map(st=>st.analysis.subjectAvgs&&st.analysis.subjectAvgs[s]).filter(v=>v!=null&&!isNaN(v));
      subjectAvgs[s]=vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):0;
    });
    stats[label]={count:arr.length,avg,passRate,subjectAvgs};
  });
  const result={available:true,groups:stats};
  const labels=Object.keys(stats);
  if(labels.length===2){
    const [a,b]=labels;
    const diff=stats[a].avg-stats[b].avg;
    result.leadGroup=diff===0?null:(diff>0?a:b);
    result.overallGap=Math.abs(diff);
    let maxGapSubject=null,maxGap=-1;
    subjects.forEach(s=>{
      const d=Math.abs((stats[a].subjectAvgs[s]||0)-(stats[b].subjectAvgs[s]||0));
      if(d>maxGap){maxGap=d;maxGapSubject=s;}
    });
    result.maxGapSubject=maxGapSubject;result.maxGapValue=maxGap;
    result.maxGapLead=maxGapSubject&&(stats[a].subjectAvgs[maxGapSubject]>=stats[b].subjectAvgs[maxGapSubject]?a:b);
  }
  APP.genderAnalysis=result;
  return result;
}

/* ════════════════════════════════════════════════════════════════════════
   COMPARE SECTIONS MODE (Institution only) — see startCompareMode().
   Everything below is purely additive: it reuses the existing single-cohort
   pipeline (parseWorkbookSheets → parseStudents → computeAnalysis →
   computeGenderAnalysis) and the existing single-cohort dashboard/PDF
   renderers by temporarily pointing the same global APP.rawData/APP.students
   /APP.classStats/APP.genderAnalysis/APP.dataIssues at one section's data at
   a time ("temporal isolation"), rather than duplicating any scoring,
   ranking, flagging, dashboard, or PDF logic. When APP.compareMode is false
   (the default), none of this runs and nothing here is reachable.
   ════════════════════════════════════════════════════════════════════════ */

// Toggles every compare-mode-specific UI block on/off across Home/Setup/
// Upload/Dashboard/Export. Called on entering/exiting compare mode and on
// every full reset (New Project, Home). Single source of truth for which
// UI is visible — keeps the single-section flow's markup untouched when off.
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
    toast(file.name+" was already uploaded for this comparison. Remove it first if you want to re-add it.","warn");
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
      toast("Error reading "+file.name+": "+err2.message,"error");
    }
    if(done)done();
  };
  reader.onerror=()=>{toast("Could not read "+file.name+".","error");if(done)done();};
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
  if(!peek.subjects||!peek.subjects.length)errors.push("Couldn't detect any Subjects from its SETUP tab.");
  if(!peek.tests||!peek.tests.length)errors.push("Couldn't detect any Tests from its SETUP tab.");
  if(!rowCount)errors.push("No student rows found in its STUDENTS tab.");
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
  const schema=errors.length?null:{subjects:peek.subjects.slice(),tests:peek.tests.map(t=>({name:t.name,date:"",maxMarks:Object.assign({},t.maxMarks)}))};
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
            <button class="btn btn-secondary btn-sm" onclick="removeHomeCompareFile('${sec.id}')">✕ Remove</button>
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
        <button class="btn btn-secondary btn-sm" onclick="resetHomeImport()">✕ Remove</button>
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
    toast("Section list changed — previous comparison cleared. Run Comparison Analysis again.","info");
  }
}
/* ── Per-section analysis (reuses parseStudents/computeAnalysis/computeGenderAnalysis as-is) ── */
async function runCompareAnalysisCore(){
  const validSections=APP.sections.filter(s=>s.valid);
  if(validSections.length<1){toast("No valid files to analyse — check the errors above.","warn");return;}
  if(!APP.aiFeatures.size)selectAllAI();
  goStep("ai"); // v2.4: bring the loader on-screen even without a manual stop here
  $("#ai-loader").show();
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
  // btn-analyse removed (v3.2) — panel-ai is now a pure progress screen.
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
function schemaSignature(schema){
  const subjectsLc=(schema.subjects||[]).map(s=>s.trim().toLowerCase()).sort();
  const testsSig=(schema.tests||[]).map(t=>{
    const orig=(schema.subjects||[]).find(s=>s.trim().toLowerCase()===subjectsLc[0])||"";
    const mm=(schema.subjects||[]).slice().sort((a,b)=>a.trim().toLowerCase().localeCompare(b.trim().toLowerCase()))
      .map(s=>s.trim().toLowerCase()+":"+((t.maxMarks&&t.maxMarks[s])||100)).join(",");
    return t.name.trim().toLowerCase()+"["+mm+"]";
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
  const headerRow=`<tr><th style="text-align:left">Class</th>${mg.sectionKeys.map(sk=>`<th>${esc(sk)}</th>`).join("")}<th>Class Avg</th></tr>`;
  const bodyRows=mg.classes.map(c=>{
    const cells=mg.sectionKeys.map(sk=>{
      const row=c.secs.find(r=>r.sec===sk);
      if(!row)return `<td style="text-align:center;color:var(--c-text3)">—</td>`;
      return `<td style="text-align:center;cursor:pointer" onclick="selectCompareSection('${row.id}')" title="Click to open ${esc(row.label)}">
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
    <div class="card-title" style="margin-bottom:4px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><polyline points='3 7 9 13 13 9 21 18'/><polyline points='15 18 21 18 21 12'/></svg> Weakest Subjects (across compared sections)</div>
    <div style="font-size:11.5px;color:var(--c-text2);margin-bottom:10px">Averaged across every compared section, weighted by student count.</div>
    ${bars}
  </div>`;
}
function renderFlaggedSectionsCard(flagged){
  if(!flagged.length)return "";
  return `<div class="card" style="margin-bottom:16px;border-left:3px solid var(--c-danger)">
    <div class="card-title" style="margin-bottom:8px">🚩 Sections Needing Attention</div>
    ${flagged.map(r=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--c-border);cursor:pointer" onclick="selectCompareSection('${r.id}')">
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
    <div class="kpi-card"><div class="kpi-label">Total Students</div><div class="kpi-val">${rows.reduce((a,r)=>a+r.n,0)}</div></div>
  </div>`;
  const tableRows=rows.map(r=>`<tr style="cursor:pointer" onclick="selectCompareSection('${r.id}')" title="Click to open ${esc(r.label)}">
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
  wrap.html(`<div class="bucket-answer-title">Compare Sections</div>`+mgHtml+kpis+table+flagCard+weakCard+`<div class="card-title" style="margin:4px 0 10px">Subject-wise Comparison (per test, per section)</div>`+subjectCards);
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
  if(!rows.length){toast("Run Comparison Analysis first.","warn");return;}
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF("p","mm","a4");
  const W=210;
  doc.setFillColor(30,58,95);doc.rect(0,0,W,22,"F");
  doc.setTextColor(255,255,255);doc.setFont("helvetica","bold");doc.setFontSize(13);
  doc.text("Student Insight  |  Section Comparison Report",10,10);
  doc.setFontSize(8);doc.setFont("helvetica","normal");
  doc.text([APP.setup.instName,APP.setup.year].filter(Boolean).join(" · "),10,17);
  doc.text("Generated: "+new Date().toLocaleDateString(),W-10,17,{align:"right"});
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
    doc.text(mg?"Executive Summary — All Classes & Sections":"Executive Summary",10,y);y+=9;
    doc.setFont("helvetica","normal");doc.setFontSize(9);doc.setTextColor(90,96,122);
    doc.text(mg?(mg.classes.length+" classes × "+mg.sectionKeys.length+" sections · "+mg.totalStudents+" students total"):(rows.length+" section"+(rows.length===1?"":"s")+" compared · "+rows.reduce((a,r)=>a+r.n,0)+" students total"),10,y);y+=8;
    // KPI strip
    const kpiBoxes=mg?[["School Avg",mg.schoolAvg+"%"],["Pass Rate",mg.schoolPassRate+"%"],["Total At-Risk",String(mg.totalAtRisk)],["Best Class",mg.classes[0].cls]]
      :[["Sections",String(rows.length)],["Top Section",rows[0].label],["Needs Attention",rows[rows.length-1].label],["Total At-Risk",String(rows.reduce((a,r)=>a+r.atRisk,0))]];
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
          const cc=row.avg>=80?[46,196,182]:row.avg>=60?[67,97,238]:row.avg>=35?[201,151,30]:[242,92,84];
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
      doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(26,29,46);doc.text(mg?"School-wide Weakest Subjects":"Weakest Subjects (across compared sections)",10,y);y+=6;
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
      doc.setFillColor(67,97,238);doc.rect(70,y-4,v,3.5,"F");
      doc.text(v+"%",174,y-2.5);
      y+=6;
    });
    y+=4;
  });
  stampFooterAllPages(doc,"MANAGEMENT CONFIDENTIAL");
  const fname=safeFileName((APP.setup.instName||"StudentInsight")+"_Section_Comparison")+".pdf";
  doc.save(fname);
  toast("Comparison report downloaded: "+fname,"success");
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

