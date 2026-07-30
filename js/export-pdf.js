/* ════ EXPORT ════ */

// STRESS-TEST FIX (BUG-1, STRESS_TEST_REPORT.md): jsPDF's built-in
// "helvetica" font only covers WinAnsi/Latin-1 — no emoji, no
// Devanagari/Kannada, etc. Free-text fields (remarks, names) are
// user-authored (including via voice input) and will eventually contain
// characters that font can't render, which previously rendered as blank
// boxes or dropped silently with no visibility into it happening. This
// wraps every jsPDF instance so ANY text passed to .text()/
// splitTextToSize() is sanitized once, centrally — not at each of the
// 100+ individual call sites across this file.
function sanitizePdfDoc(doc){
  const stripUnsupported=v=>String(v==null?"":v).replace(/[^\x00-\xFF]/g,"?");
  const sanitizeArg=a=>{
    if(typeof a==="string")return stripUnsupported(a);
    if(Array.isArray(a))return a.map(sanitizeArg);
    return a;
  };
  const origText=doc.text.bind(doc);
  doc.text=function(text,...rest){return origText(sanitizeArg(text),...rest);};
  const origSplit=doc.splitTextToSize.bind(doc);
  doc.splitTextToSize=function(text,...rest){return origSplit(sanitizeArg(text),...rest);};
  return doc;
}

async function generateAllPDFs(){
  if(!APP.students.length){toast("No students to export.","warn");return;}
  if((APP.dataIssues||[]).length){toast("Fix the "+APP.dataIssues.length+" data quality issue(s) on the Dashboard before exporting.","warn");goStep("dashboard");return;}
  const doS=$("#exp-student").is(":checked"),doT=$("#exp-teacher").is(":checked"),doM=$("#exp-mgmt").is(":checked"),doZ=$("#exp-zip").is(":checked");
  if(!doS&&!doT&&!doM){toast("Select at least one report type to export.","warn");return;}
  // ui-prompt-batch2.md item 2: per-student selection, genuinely new (no
  // prior equivalent) — .exp-student-cb checkboxes live in the Export
  // rail (js/vs-shell.js renderShellRightRail, step==="export"). Falls
  // back to ALL students if the checkboxes aren't found in the DOM at
  // all (vs. found-but-none-checked, which is a real, honored "export
  // nobody" choice) — goStep() always renders the rail before this can
  // be called, so the fallback is a safety net, not the normal path.
  const studentCbs=$(".exp-student-cb");
  const selectedStudents=studentCbs.length
    ? (function(){
        const ids=new Set(studentCbs.filter(":checked").map((i,el)=>el.getAttribute("data-id")).get());
        return APP.students.filter(st=>ids.has(String(st.id)));
      })()
    : APP.students;
  const {jsPDF}=window.jspdf;
  const total=(doS?selectedStudents.length:0)+(doT?1:0)+(doM?1:0);let done=0;
  $("#export-loader").show();
  $("#btn-generate-pdfs").prop("disabled",true).removeClass("btn-glow");
  function prog(msg,pct){$("#export-loader-msg").text(msg);$("#export-prog").css("width",pct+"%");}
  function safeName(n){return n.replace(/[^\w\s-]/g,"").replace(/\s+/g,"_");}
  const urlsToRevoke=[];
  function downloadBlob(blob,fname){const url=URL.createObjectURL(blob);urlsToRevoke.push(url);const link=document.createElement("a");link.href=url;link.download=fname;document.body.appendChild(link);link.click();link.remove();}
  try{
    if(doZ){
      const zip=new JSZip();
      if(doS){for(const st of selectedStudents){prog("Generating: "+st.name+" ("+done+"/"+selectedStudents.length+")",Math.round(done/total*100));await sleep(20);const doc=sanitizePdfDoc(new jsPDF("p","mm","a4"));buildStudentPDF(doc,st);zip.file("Students/"+safeName(st.name)+"_"+safeName(st.id)+".pdf",doc.output("blob"));done++;}}
      if(doT){prog("Generating Teacher Report…",Math.round(done/total*100));await sleep(20);const doc=sanitizePdfDoc(new jsPDF("p","mm","a4"));buildTeacherPDF(doc);zip.file("Teacher_Report.pdf",doc.output("blob"));done++;}
      if(doM){prog("Generating Management Report…",Math.round(done/total*100));await sleep(20);const doc=sanitizePdfDoc(new jsPDF("p","mm","a4"));buildMgmtPDF(doc);zip.file("Management_Report.pdf",doc.output("blob"));done++;}
      prog("Building ZIP…",95);
      const zipBlob=await zip.generateAsync({type:"blob"});
      const s=APP.setup,fname=safeName((s.instName||"StudentInsight")+"_"+(s.className||"Class")+"_"+(s.year||"2026"))+"_Reports.zip";
      downloadBlob(zipBlob,fname);
      toast("ZIP downloaded: "+fname,"success");
    } else {
      // ZIP unchecked — download each selected PDF individually
      if(doS){for(const st of selectedStudents){prog("Generating: "+st.name+" ("+done+"/"+selectedStudents.length+")",Math.round(done/total*100));await sleep(20);const doc=sanitizePdfDoc(new jsPDF("p","mm","a4"));buildStudentPDF(doc,st);downloadBlob(doc.output("blob"),safeName(st.name)+"_"+safeName(st.id)+".pdf");done++;}}
      if(doT){prog("Generating Teacher Report…",Math.round(done/total*100));await sleep(20);const doc=sanitizePdfDoc(new jsPDF("p","mm","a4"));buildTeacherPDF(doc);downloadBlob(doc.output("blob"),"Teacher_Report.pdf");done++;}
      if(doM){prog("Generating Management Report…",Math.round(done/total*100));await sleep(20);const doc=sanitizePdfDoc(new jsPDF("p","mm","a4"));buildMgmtPDF(doc);downloadBlob(doc.output("blob"),"Management_Report.pdf");done++;}
      toast(done+" PDF(s) downloaded individually.","success");
    }
  }catch(err){
    toast("Export failed: "+err.message,"error");
  }finally{
    $("#export-loader").hide();
    $("#btn-generate-pdfs").prop("disabled",false).addClass("btn-glow");
    urlsToRevoke.forEach(u=>setTimeout(()=>URL.revokeObjectURL(u),5000));
  }
}

function fitText(doc,text,maxW){
  text=String(text==null?"":text);
  if(doc.getTextWidth(text)<=maxW)return text;
  let lo=0,hi=text.length;
  while(lo<hi){
    const mid=Math.ceil((lo+hi)/2);
    const candidate=text.slice(0,mid)+"…";
    if(doc.getTextWidth(candidate)<=maxW)lo=mid;else hi=mid-1;
  }
  return lo>0?text.slice(0,lo)+"…":"…";
}
function addPDFHeader(doc,title){
  const s=APP.setup;doc.setFillColor(67,97,238);doc.rect(0,0,210,18,"F");
  doc.setTextColor(255,255,255);doc.setFontSize(12);doc.setFont("helvetica","bold");doc.text("Student Insight",10,11);
  doc.setFontSize(9);doc.setFont("helvetica","normal");doc.text([s.instName,s.className+(s.section?" "+s.section:""),s.year].filter(Boolean).join(" · "),80,11);
  doc.setTextColor(26,29,46);doc.setFontSize(14);doc.setFont("helvetica","bold");doc.text(title,10,30);
  doc.setFont("helvetica","normal");doc.setFontSize(9);doc.setTextColor(90,96,122);doc.text("Generated: "+new Date().toLocaleDateString(),150,30);return 38;
}
// Stamps the branded footer bar — with a clickable link to studin.in — on
// EVERY page of the document (not just whichever page content happened to
// end on), since a report can now legitimately run to several pages.
function stampFooterAllPages(doc,confidentialLabel){
  const W=210,H=297;
  const pageCount=doc.internal.getNumberOfPages();
  for(let p=1;p<=pageCount;p++){
    doc.setPage(p);
    doc.setFillColor(30,58,95);doc.rect(0,H-10,W,10,"F");
    doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(226,229,241);
    doc.textWithLink("Student Insight",10,H-4,{url:(window.APP_CONFIG&&APP_CONFIG.projectPageUrl)||"https://studin.in/"});
    const linkW=doc.getTextWidth("Student Insight");
    doc.text(" — Free & Open Source  |  Privacy-First  |  Built by Sandeep Hakki",10+linkW,H-4);
    doc.text(confidentialLabel,W-10,H-4,{align:"right"});
    if(pageCount>1){doc.setFontSize(6.5);doc.setTextColor(155,164,192);doc.text("Page "+p+" of "+pageCount,W/2,H-4,{align:"center"});}
  }
  doc.setPage(pageCount); // leave cursor state sane for any caller code after
}
// TASK 1d (studin-features-prompt v1.0): same rule as the dashboard's
// flagChapterSuffix() in render-dashboard.js — flags aren't tied to one
// specific test, so the most recent test with a filled Chapter is used.
// Purely additive: blank Chapter means zero change to the flag label.
const PDF_CHAPTER_RELEVANT_FLAG_TYPES=["at-risk","first-below-pass","sharp-drop","declining","burnout","plateau","volatile"];
function chapterSuffixForFlag(st,flagType){
  if(!PDF_CHAPTER_RELEVANT_FLAG_TYPES.includes(flagType))return "";
  const tests=(APP.setup&&APP.setup.tests)||[];
  for(let i=tests.length-1;i>=0;i--){
    const ch=(st.testData[tests[i].name]||{}).chapter;
    if(ch)return " · Ch: "+ch;
  }
  return "";
}
function buildStudentPDF(doc,st){
  const a=st.analysis,s=APP.setup;
  const isIndividual=s.mode==="individual";
  const W=210,H=297;
  // Tracks which page each section lands on, so the "Quick Navigation" bar
  // near the top can add real internal jump-links once we know where
  // things ended up (page breaks aren't known ahead of time).
  const nav={};
  // ── HEADER BAR ──
  doc.setFillColor(30,58,95);doc.rect(0,0,W,22,"F");
  doc.setTextColor(255,255,255);doc.setFont("helvetica","bold");doc.setFontSize(13);
  doc.text(isIndividual?"Student Insight  |  Progress Report":"Student Insight  |  Progress Report",10,10);
  doc.setFontSize(8);doc.setFont("helvetica","normal");
  doc.text([s.instName,isIndividual?(s.className||""):s.className+(s.section?" "+s.section:""),s.year].filter(Boolean).join(" · "),10,17);
  doc.text("Generated: "+new Date().toLocaleDateString(),W-10,17,{align:"right"});
  doc.setTextColor(26,29,46);
  let y=30;
  // ── STUDENT IDENTITY BLOCK ──
  const avgColor=a.overallAvg>=80?[46,196,182]:a.overallAvg>=s.passThreshold?[67,97,238]:[242,92,84];
  doc.setFillColor(248,249,255);doc.roundedRect(8,y,W-16,26,2,2,"F");
  doc.setFont("helvetica","bold");doc.setFontSize(14);doc.setTextColor(26,29,46);
  doc.text(fitText(doc,st.name,(W-37-4)-13),13,y+10);
  doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(90,96,122);
  doc.text(fitText(doc,isIndividual?"ID: "+st.id:"Student ID: "+st.id,(W-37-4)-13),13,y+18);
  // Grade badge (right side)
  doc.setFillColor(...avgColor);doc.roundedRect(W-37,y+3,28,20,3,3,"F");
  doc.setTextColor(255,255,255);doc.setFont("helvetica","bold");doc.setFontSize(16);
  doc.text(a.overallAvg+"%",W-23,y+13,{align:"center"});
  doc.setFontSize(8);doc.text("Grade "+a.grade,W-23,y+21,{align:"center"});
  y+=32;
  // ── QUICK NAVIGATION (real internal links, wired up at the end of this
  // function once we know which page each section landed on) ──
  const navChips=[
    {key:"marks",label:"Marks Table",exists:!!(s.tests&&s.tests.length&&s.subjects&&s.subjects.length)},
    {key:"trend",label:"Trend",exists:a.testAvgs.filter(v=>v!==null).length>=2&&s.tests&&s.tests.length>=2},
    {key:"flags",label:"Alerts",exists:!!(st.flags&&st.flags.length)},
    {key:"remark",label:"Remarks",exists:(s.tests||[]).some(t=>(st.testData[t.name]||{}).remark)},
    // STUDIN-PRO: "Messages" chip pointed at Bottom Line/What's Changed/
    // Strengths, all gated below — nothing left for it to link to.
    // {key:"messages",label:"Messages",exists:[a.parentMessage,a.strengthsLetter,a.trendFacts].some(Boolean)},
    // STUDIN-PRO: "Plan" chip pointed at At Home This Week, gated below —
    // nothing left for it to link to.
    // {key:"studyPlan",label:"Plan",exists:!!(a.homePlan||a.schoolPlan)},
  ].filter(c=>c.exists);
  const navBarY=y;
  doc.setFillColor(242,244,252);doc.roundedRect(8,y,W-16,9,2,2,"F");
  doc.setFont("helvetica","bold");doc.setFontSize(6.5);doc.setTextColor(90,96,122);
  doc.text("JUMP TO:",11,y+5.8);
  let navX=30;
  const navChipCoords=[];
  navChips.forEach(c=>{
    const tw=doc.getTextWidth(c.label)+6;
    navChipCoords.push({...c,x:navX,y:y+1.5,w:tw,h:6});
    doc.setFillColor(255,255,255);doc.setDrawColor(226,229,241);doc.roundedRect(navX,y+1.5,tw,6,1.5,1.5,"FD");
    doc.setTextColor(67,97,238);doc.setFontSize(6.5);doc.setFont("helvetica","bold");
    doc.text(c.label,navX+tw/2,y+5.3,{align:"center"});
    navX+=tw+3;
  });
  y+=13;
  // ── KPI ROW ──
  // Rank/Percentile only mean something with a cohort behind them — in
  // Individual mode they're replaced with Grade and Met-Target, which
  // compare the student only to the scale and to their own target %.
  const kpis=isIndividual?[
    {label:"Grade",val:a.grade,color:[67,97,238]},
    {label:"Met Target",val:a.overallAvg>=s.passThreshold?"Yes":"Not Yet",color:a.overallAvg>=s.passThreshold?[46,196,182]:[249,168,38]},
    {label:"Trend",val:a.trend==="improving"?"UP":a.trend==="declining"?"DOWN":"STABLE",color:a.trend==="improving"?[46,196,182]:a.trend==="declining"?[242,92,84]:[90,96,122]},
    {label:"Absences",val:a.totalAbsent||0,color:a.totalAbsent>=s.absentAlert?[242,92,84]:[90,96,122]},
  ]:[
    {label:"Rank",val:"#"+a.rank,color:[67,97,238]},
    {label:"Percentile",val:a.percentile+"th",color:[46,196,182]},
    {label:"Trend",val:a.trend==="improving"?"UP":a.trend==="declining"?"DOWN":"STABLE",color:a.trend==="improving"?[46,196,182]:a.trend==="declining"?[242,92,84]:[90,96,122]},
    {label:"Absences",val:a.totalAbsent||0,color:a.totalAbsent>=s.absentAlert?[242,92,84]:[90,96,122]},
  ];
  const kW=(W-16)/4;
  kpis.forEach((k,i)=>{
    const kx=8+i*kW;
    doc.setFillColor(255,255,255);doc.setDrawColor(226,229,241);doc.roundedRect(kx,y,kW-2,16,2,2,"FD");
    doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(155,164,192);doc.text(k.label,kx+kW/2-1,y+5,{align:"center"});
    doc.setFont("helvetica","bold");doc.setFontSize(10);doc.setTextColor(...k.color);doc.text(String(k.val),kx+kW/2-1,y+12,{align:"center"});
  });
  y+=22;
  // ── SUBJECT PERFORMANCE BARS ──
  doc.setFont("helvetica","bold");doc.setFontSize(10);doc.setTextColor(26,29,46);
  doc.text("Subject Performance",10,y);y+=5;
  const subjects=Object.entries(a.subjectAvgs||{});
  const barW=W-80,barH=5,labelW=42;
  subjects.forEach(([sub,avg])=>{
    if(y>255){doc.addPage();y=20;}
    doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(26,29,46);
    doc.text(fitText(doc,sub,labelW-4),10,y+4);
    // Background bar
    doc.setFillColor(226,229,241);doc.roundedRect(labelW,y,barW,barH,1,1,"F");
    // Filled bar
    const pct=Math.min(100,avg)/100;
    const barColor=avg>=80?[46,196,182]:avg>=s.passThreshold?[67,97,238]:[242,92,84];
    doc.setFillColor(...barColor);doc.roundedRect(labelW,y,barW*pct,barH,1,1,"F");
    // Score text
    doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(...barColor);
    doc.text(avg+"%",labelW+barW+2,y+4);
    y+=9;
  });
  y+=4;
  // ── FULL MARKS TABLE (every test × every subject, heat-coloured) ──
  // Parents asked for the raw numbers, not just a chart — this table lets
  // them see exactly which test + subject combination went wrong, and by
  // how much, at a glance via colour.
  if(s.tests&&s.tests.length&&s.subjects&&s.subjects.length){
    if(y>230){doc.addPage();y=20;}
    nav.marks=doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFont("helvetica","bold");doc.setFontSize(10);doc.setTextColor(26,29,46);
    doc.text("All Test Scores",10,y);y+=2;
    doc.setFont("helvetica","normal");doc.setFontSize(6.5);doc.setTextColor(155,164,192);
    doc.text("Score shown as scored/max marks  ·  Green = strong (80%+)  ·  Blue = passing  ·  Red = below "+s.passThreshold+"%  ·  gray dash = not taken",10,y+4);
    y+=8;
    // v1.5 — added a "Total" column (scored/max marks across the subjects
    // actually opted, e.g. "231/450 (4/5 opted)") so a parent can see the
    // real total instead of only a percentage, and — for Institution mode —
    // a "Class Avg" row directly under this table so "where does my child
    // stand" is answered right here, not just in the KPI cards up top.
    const firstColW=34,avgColW=13,totalColW=27,lastColW=avgColW+totalColW,
      colW=(W-16-firstColW-lastColW)/s.subjects.length;
    const drawMarksHeader=()=>{
      doc.setFillColor(30,58,95);doc.rect(8,y,W-16,7,"F");
      doc.setFont("helvetica","bold");doc.setFontSize(6.8);doc.setTextColor(255,255,255);
      doc.text("Test",10,y+4.7);
      s.subjects.forEach((sub,i)=>{doc.text(fitText(doc,sub,colW-2),firstColW+i*colW+1,y+4.7);});
      doc.text("Total",firstColW+s.subjects.length*colW+2,y+4.7);
      doc.text("Avg",W-8-avgColW+1,y+4.7);
      y+=7;
    };
    drawMarksHeader();
    // studentsForClassAvg / classAvgForTestSubject only matter in Institution
    // mode — there is no "class" behind an Individual-mode session (§ ~5075).
    const studentsForClassAvg=(!isIndividual&&APP.students&&APP.students.length>1)?APP.students:null;
    const classAvgForTestSubject=(tName,sub,mx)=>{
      if(!studentsForClassAvg)return null;
      const vals=studentsForClassAvg.map(s2=>{const d=s2.testData&&s2.testData[tName];const v=d&&d.marks?d.marks[sub]:undefined;return(v!==undefined&&v!==null&&v!=="")?Math.min(100,(parseFloat(v)||0)/mx*100):null;}).filter(v=>v!==null);
      return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
    };
    s.tests.forEach((t,ti)=>{
      if(y>270){doc.addPage();y=20;drawMarksHeader();}
      const td=st.testData&&st.testData[t.name]||{marks:{}};
      const rowBg=ti%2===0?[248,249,255]:[255,255,255];
      doc.setFillColor(...rowBg);doc.rect(8,y,W-16,6.2,"F");
      doc.setFont("helvetica","normal");doc.setFontSize(6.8);doc.setTextColor(26,29,46);
      doc.text(fitText(doc,t.name,firstColW-3),10,y+4.2);
      let sumScored=0,sumMax=0,opted=0;
      s.subjects.forEach((sub,i)=>{
        const raw=td.marks?td.marks[sub]:undefined;
        const cx=firstColW+i*colW,mx=(t.maxMarks&&t.maxMarks[sub])||100;
        if(raw===undefined||raw===null||raw===""){
          doc.setTextColor(190,196,214);doc.setFontSize(6.8);doc.text("—",cx+colW/2,y+4.2,{align:"center"});
        }else{
          opted++;sumScored+=parseFloat(raw)||0;sumMax+=mx;
          const pctv=Math.min(100,(parseFloat(raw)||0)/mx*100);
          const cc=pctv>=80?[46,196,182]:pctv>=(s.passThreshold||35)?[67,97,238]:[242,92,84];
          doc.setFillColor(...cc.map(v=>Math.min(255,v+165)));
          doc.roundedRect(cx+1,y+0.6,colW-2,5,0.6,0.6,"F");
          doc.setTextColor(...cc.map(v=>Math.max(0,v-70)));doc.setFont("helvetica","bold");doc.setFontSize(6.2);
          // Bug fix: this used to show just the raw score (e.g. "45"), with
          // no indication of what it was out of — confusing when max marks
          // differ by test/subject. Show "raw/max" instead.
          doc.text(raw+"/"+mx,cx+colW/2,y+4.2,{align:"center"});
        }
      });
      // Total column: scored/max across subjects opted for this test, plus
      // how many of the subjects were actually attempted (some may be "—").
      doc.setFont("helvetica","bold");doc.setFontSize(6.2);doc.setTextColor(90,96,122);
      const totalX=firstColW+s.subjects.length*colW+totalColW/2;
      if(opted>0){
        doc.text(sumScored+"/"+sumMax,totalX,y+3.2,{align:"center"});
        doc.setFont("helvetica","normal");doc.setFontSize(5.4);doc.setTextColor(155,164,192);
        doc.text(opted+"/"+s.subjects.length+" opted",totalX,y+5.7,{align:"center"});
      }else{doc.setTextColor(190,196,214);doc.text("—",totalX,y+4.2,{align:"center"});}
      doc.setFont("helvetica","bold");doc.setFontSize(6.8);
      const tavg=a.testAvgs[ti];
      doc.setTextColor(tavg===null?190:26,tavg===null?196:29,tavg===null?214:46);
      doc.text(tavg!==null?tavg+"%":"—",W-8-avgColW+1,y+4.2);
      y+=6.2;
      // Class Avg row — repeated right under each test row (Institution mode
      // only) so the comparison is read in the same glance as the score,
      // instead of forcing a flip back to the KPI cards or dashboard.
      if(studentsForClassAvg){
        if(y>272){doc.addPage();y=20;drawMarksHeader();}
        doc.setFillColor(242,244,252);doc.rect(8,y,W-16,5,"F");
        doc.setFont("helvetica","italic");doc.setFontSize(6);doc.setTextColor(90,96,122);
        doc.text("Class Avg",10,y+3.4);
        s.subjects.forEach((sub,i)=>{
          const cx=firstColW+i*colW,mx=(t.maxMarks&&t.maxMarks[sub])||100;
          const cAvg=classAvgForTestSubject(t.name,sub,mx);
          doc.text(cAvg!==null?cAvg+"%":"—",cx+colW/2,y+3.4,{align:"center"});
        });
        doc.text("—",totalX,y+3.4,{align:"center"});
        const classTestAvgs=studentsForClassAvg.map(s2=>s2.analysis&&s2.analysis.testAvgs&&s2.analysis.testAvgs[ti]).filter(v=>v!==undefined&&v!==null);
        const classTestAvg=classTestAvgs.length?Math.round(classTestAvgs.reduce((a,b)=>a+b,0)/classTestAvgs.length):null;
        doc.text(classTestAvg!==null?classTestAvg+"%":"—",W-8-avgColW+1,y+3.4);
        y+=5;
      }
    });
    y+=3;
    // Where this child stands — tied directly to the table above. Below 12
    // students, percentile math implies false precision (e.g. "14th
    // percentile" out of 8 kids), so just state rank + a plain point
    // difference from the class average instead.
    if(studentsForClassAvg){
      doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(90,96,122);
      const classAvgAll=(()=>{const vals=studentsForClassAvg.map(s2=>s2.analysis&&s2.analysis.overallAvg).filter(v=>v!==undefined&&v!==null);return vals.length?Math.round(vals.reduce((x,y)=>x+y,0)/vals.length):null;})();
      const line=studentsForClassAvg.length>=12
        ?st.name.split(" ")[0]+" ranks #"+a.rank+" of "+studentsForClassAvg.length+" in this class ("+a.percentile+"th percentile — meaning better than "+a.percentile+"% of classmates by overall average; percentile is a ranking, not a percentage score)."
        :st.name.split(" ")[0]+" ranks #"+a.rank+" of "+studentsForClassAvg.length+" in this class"+(classAvgAll!==null?", "+Math.abs(a.overallAvg-classAvgAll)+" points "+(a.overallAvg>=classAvgAll?"above":"below")+" the class average of "+classAvgAll+"%.":".");
      doc.text(line,10,y,{maxWidth:W-16});
      y+=9;
    }
    y+=5;
  }
  // ── TEST TREND SPARKLINE ──
  const valid=a.testAvgs.filter(v=>v!==null);
  if(valid.length>=2&&s.tests&&s.tests.length>=2){
    if(y>250){doc.addPage();y=20;}
    nav.trend=doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFont("helvetica","bold");doc.setFontSize(10);doc.setTextColor(26,29,46);
    doc.text("Test Trend",10,y);y+=4;
    const sparkX=10,sparkY=y,sparkW=W-20,sparkH=18;
    doc.setFillColor(248,249,255);doc.roundedRect(sparkX,sparkY,sparkW,sparkH,2,2,"F");
    // Draw line
    const mn=Math.min(...valid)-5,mx=Math.max(...valid)+5,rng=mx-mn||1;
    const pts=valid.map((v,i)=>[sparkX+4+(i/(valid.length-1))*(sparkW-8),sparkY+sparkH-4-((v-mn)/rng)*(sparkH-8)]);
    const tcolor=valid[valid.length-1]>=valid[0]?[46,196,182]:[242,92,84];
    doc.setDrawColor(...tcolor);doc.setLineWidth(0.8);
    for(let i=1;i<pts.length;i++){doc.line(pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1]);}
    pts.forEach((p,i)=>{doc.setFillColor(...tcolor);doc.circle(p[0],p[1],1,"F");doc.setFontSize(6);doc.setTextColor(...tcolor);doc.text(valid[i]+"%",p[0],p[1]-2,{align:"center"});});
    const segW=sparkW/valid.length;
    s.tests.forEach((t,i)=>{if(i<pts.length){doc.setFontSize(6);doc.setTextColor(155,164,192);doc.text(fitText(doc,t.name,segW-2),pts[i][0],sparkY+sparkH-1,{align:"center"});}});
    y+=sparkH+6;
  }
  // ── FLAGS ──
  if(st.flags&&st.flags.length){
    if(y>262){doc.addPage();y=20;}
    nav.flags=doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(26,29,46);doc.text("Alerts & Flags",10,y);y+=4;
    let fx=10;
    st.flags.forEach(f=>{
      const fc=f.type==="at-risk"?[242,92,84]:f.type==="improving"?[46,196,182]:f.type==="declining"?[249,168,38]:f.type==="burnout"?[230,126,34]:[123,94,167];
      const lbl=(f.label||"")+chapterSuffixForFlag(st,f.type);
      const tw=doc.getTextWidth(lbl)+12;
      doc.setFillColor(...fc.map(v=>Math.min(255,v+160)));
      doc.setDrawColor(...fc);
      doc.roundedRect(fx,y,tw,6,1,1,"FD");
      // Coloured dot
      doc.setFillColor(...fc);
      doc.circle(fx+3.5,y+3,1.5,"F");
      doc.setFontSize(7);doc.setFont("helvetica","bold");doc.setTextColor(...fc);
      doc.text(lbl,fx+6,y+4);
      fx+=tw+4;
      if(fx>W-20){fx=10;y+=8;}
    });
    y+=10;
  }
  // ── TEACHER REMARKS (Task 2a: only if at least one test has a remark) ──
  const remarkEntries=(s.tests||[]).map(t=>({test:t.name,remark:(st.testData[t.name]||{}).remark})).filter(r=>r.remark);
  if(remarkEntries.length){
    if(y>250){doc.addPage();y=20;}
    nav.remark=doc.internal.getCurrentPageInfo().pageNumber;
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(26,29,46);doc.text("Teacher Remarks",10,y);y+=5;
    remarkEntries.forEach(r=>{
      if(y>265){doc.addPage();y=20;}
      doc.setFont("helvetica","bold");doc.setFontSize(7);doc.setTextColor(90,96,122);doc.text(r.test,10,y);
      doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(26,29,46);
      const wrapped=doc.splitTextToSize(r.remark,W-24);
      doc.text(wrapped,10,y+4);
      y+=4+wrapped.length*4+3;
    });
    y+=4;
  }
  // STUDIN-PRO: Chapters Covered — gated per ui-prompt-batch2.md item 3,
  // wrapped not deleted (comment-block convention per §8).
  // const chapterEntries=(s.tests||[]).map(t=>({test:t.name,chapter:(st.testData[t.name]||{}).chapter})).filter(c=>c.chapter);
  // if(chapterEntries.length){
  //   if(y>258){doc.addPage();y=20;}
  //   doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(26,29,46);doc.text("Chapters Covered",10,y);y+=5;
  //   doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(90,96,122);
  //   const chLine=chapterEntries.map(c=>c.test+": "+c.chapter).join("  ·  ");
  //   const chWrapped=doc.splitTextToSize(chLine,W-20);
  //   doc.text(chWrapped,10,y);
  //   y+=chWrapped.length*4+6;
  // }
  // ── NARRATIVE SECTIONS (visually boxed) ──
  // Redesigned: one merged "The Bottom Line" message (was three overlapping
  // cards — Report Card Comment / For Parents / Motivation — repeating the
  // same score+trend sentence), a factual computed "What's Changed" box,
  // and Strengths only when a genuine one exists (previously always
  // printed, falling back to filler text like "is working hard to build
  // strengths" when nothing qualified).
  // STUDIN-PRO: The Bottom Line / What's Changed / Strengths — all three
  // gated (Strengths per ui-prompt-batch2.md item 3, reversing §8's
  // original "Strengths stays in the PDF" decision). Wrapped, not
  // deleted.
  // const sections=[
  //   {title:"The Bottom Line",text:a.parentMessage,bg:[238,240,253],border:[67,97,238]},
  //   {title:"What's Changed",text:a.trendFacts,bg:[244,246,251],border:[140,148,180]},
  //   {title:"Strengths",text:a.strengthsLetter,bg:[230,249,247],border:[46,196,182]},
  // ];
  // sections.filter(s=>s.text).forEach((sec,idx)=>{
  //   if(y>255){doc.addPage();y=20;}
  //   if(idx===0)nav.messages=doc.internal.getCurrentPageInfo().pageNumber;
  //   doc.setFont("helvetica","normal");doc.setFontSize(8.5);
  //   const lines=doc.splitTextToSize(sec.text,W-28);const bh=lines.length*4.5+11;
  //   doc.setFillColor(...sec.bg);doc.setDrawColor(...sec.border);doc.roundedRect(8,y,W-16,bh,2,2,"FD");
  //   doc.setFillColor(...sec.border);doc.rect(8,y,3,bh,"F");
  //   doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...sec.border);doc.text(sec.title,14,y+7);
  //   doc.setFont("helvetica","normal");doc.setFontSize(8.5);doc.setTextColor(26,29,46);
  //   doc.text(lines,14,y+13);y+=bh+5;
  // });
  // STUDIN-PRO: At Home This Week — gated per §8. Wrapped, not deleted.
  // if(a.homePlan){
  //   if(y>240){doc.addPage();y=20;}
  //   nav.studyPlan=doc.internal.getCurrentPageInfo().pageNumber;
  //   doc.setFont("helvetica","normal");doc.setFontSize(8.5);
  //   const lines=doc.splitTextToSize(a.homePlan,W-28);const bh=lines.length*4.5+13;
  //   doc.setFillColor(255,240,214);doc.setDrawColor(249,168,38);doc.roundedRect(8,y,W-16,bh,2,2,"FD");
  //   doc.setFillColor(249,168,38);doc.rect(8,y,3,bh,"F");
  //   doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(122,82,0);doc.text("At Home This Week",14,y+7);
  //   doc.setFont("helvetica","normal");doc.setFontSize(8.5);doc.setTextColor(26,29,46);doc.text(lines,14,y+13);
  //   y+=bh+5;
  // }
  // STUDIN-PRO: At School — gated per §8 (stays in the modal, gated only
  // in the PDF — deliberate asymmetry, not an oversight). Wrapped, not
  // deleted.
  // if(!isIndividual&&a.schoolPlan){
  //   if(y>252){doc.addPage();y=20;}
  //   doc.setFont("helvetica","normal");doc.setFontSize(8.5);
  //   const lines=doc.splitTextToSize(a.schoolPlan,W-28);const bh=lines.length*4.5+12;
  //   doc.setFillColor(253,236,234);doc.setDrawColor(242,92,84);doc.roundedRect(8,y,W-16,bh,2,2,"FD");
  //   doc.setFillColor(242,92,84);doc.rect(8,y,3,bh,"F");
  //   doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(139,26,26);doc.text("At School",14,y+7);
  //   doc.setFont("helvetica","normal");doc.setFontSize(8.5);doc.setTextColor(26,29,46);doc.text(lines,14,y+13);y+=bh+5;
  // }
  // ── WIRE UP QUICK NAVIGATION LINKS ──
  // The nav chips were drawn on page 1; now that every section has been
  // rendered we know which page each landed on, so go back and lay real
  // clickable (internal) link rectangles over those chips.
  const navPage=1; // nav chips are always drawn on page 1, right after the identity block
  doc.setPage(navPage);
  navChipCoords.forEach(c=>{
    const target=nav[c.key];
    if(target)doc.link(c.x,c.y,c.w,c.h,{pageNumber:target});
  });
  // ── FOOTER (stamped on every page) ──
  stampFooterAllPages(doc,isIndividual?"Personal record — not for redistribution":"CONFIDENTIAL — For parent/guardian only");
}
function buildTeacherPDF(doc){
  const s=APP.setup,W=210,H=297;
  const total=APP.students.length||1;
  const atRisk=APP.students.filter(st=>st.flags&&st.flags.some(f=>f.type==="at-risk")).length;
  const improving=APP.students.filter(st=>st.analysis&&st.analysis.trend==="improving").length;
  const declining=APP.students.filter(st=>st.analysis&&st.analysis.trend==="declining").length;
  const classAvg=Math.round(APP.students.reduce((a,st)=>a+(st.analysis&&st.analysis.overallAvg||0),0)/total);
  const passRate=Math.round(APP.students.filter(st=>st.analysis&&st.analysis.overallAvg>=(s.passThreshold||35)).length/total*100);

  // ── HEADER ──
  doc.setFillColor(67,97,238);doc.rect(0,0,W,20,"F");
  doc.setTextColor(255,255,255);doc.setFont("helvetica","bold");doc.setFontSize(12);
  doc.text("Student Insight",10,9);
  doc.setFont("helvetica","normal");doc.setFontSize(8);
  doc.text([s.instName,s.className+(s.section?" "+s.section:""),s.year].filter(Boolean).join(" · "),W/2,12,{align:"center"});
  doc.text("Teacher Report  |  "+new Date().toLocaleDateString(),W-10,12,{align:"right"});
  doc.setTextColor(26,29,46);let y=26;

  // ── KPI ROW (compact) ──
  const kpis=[
    {l:"Students",v:total,c:[67,97,238]},{l:"Class Avg",v:classAvg+"%",c:classAvg>=60?[46,196,182]:[242,92,84]},
    {l:"Pass Rate",v:passRate+"%",c:passRate>=60?[46,196,182]:[242,92,84]},{l:"At Risk",v:atRisk,c:atRisk>0?[242,92,84]:[46,196,182]},
    {l:"Improving",v:improving,c:[46,196,182]},{l:"Declining",v:declining,c:declining>0?[249,168,38]:[46,196,182]},
  ];
  const tW=(W-16)/6;
  kpis.forEach((k,i)=>{
    const tx=8+i*tW;
    doc.setFillColor(248,249,255);doc.setDrawColor(226,229,241);doc.roundedRect(tx,y,tW-1,14,1,1,"FD");
    doc.setFillColor(...k.c);doc.rect(tx,y,tW-1,2,"F");
    doc.setFont("helvetica","normal");doc.setFontSize(6);doc.setTextColor(155,164,192);doc.text(k.l,tx+(tW-1)/2,y+7,{align:"center"});
    doc.setFont("helvetica","bold");doc.setFontSize(10);doc.setTextColor(...k.c);doc.text(String(k.v),tx+(tW-1)/2,y+13,{align:"center"});
  });
  y+=18;

  // ── SUBJECT BAR CHART (compact, horizontal) ──
  if(s.subjects&&s.subjects.length){
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(26,29,46);doc.text("Subject Averages",10,y);y+=4;
    const subData=s.subjects.map(sub=>{
      const vals=APP.students.map(st=>st.analysis&&st.analysis.subjectAvgs&&st.analysis.subjectAvgs[sub]).filter(v=>v!=null&&!isNaN(v));
      return{sub,avg:vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):0};
    });
    const bW=W-70,bH=5,lW=46;
    subData.forEach(({sub,avg})=>{
      doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(26,29,46);
      doc.text(fitText(doc,sub,lW-4),10,y+4);
      doc.setFillColor(226,229,241);doc.roundedRect(lW,y,bW,bH,1,1,"F");
      const bc=avg>=75?[46,196,182]:avg>=(s.passThreshold||35)?[67,97,238]:[242,92,84];
      doc.setFillColor(...bc);doc.roundedRect(lW,y,bW*(avg/100),bH,1,1,"F");
      doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(...bc);doc.text(avg+"%",lW+bW+2,y+4);
      y+=8;
    });
    y+=3;
  }

  // ── RANK TABLE (compact, fits more rows) ──
  doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(26,29,46);doc.text("Student Rankings",10,y);y+=4;
  const cols=[12,50,16,14,18,18,60];
  const heads=["#","Name","Avg","Grade","Trend","EW","Flags"];
  // Table header
  doc.setFillColor(67,97,238);doc.rect(8,y,W-16,6,"F");
  let cx=10;
  heads.forEach((h,i)=>{doc.setFont("helvetica","bold");doc.setFontSize(6.5);doc.setTextColor(255,255,255);doc.text(h,cx,y+4.2);cx+=cols[i];});
  y+=7;

  APP.students.forEach((st,idx)=>{
    if(y>283){doc.addPage();y=10;
      // Re-draw header on new page
      doc.setFillColor(67,97,238);doc.rect(8,y,W-16,6,"F");cx=10;
      heads.forEach((h,i)=>{doc.setFont("helvetica","bold");doc.setFontSize(6.5);doc.setTextColor(255,255,255);doc.text(h,cx,y+4.2);cx+=cols[i];});
      y+=7;
    }
    const a=st.analysis||{};
    doc.setFillColor(idx%2===0?255:248,idx%2===0?255:249,idx%2===0?255:255);doc.rect(8,y-1,W-16,6.5,"F");
    const tc=a.trend==="improving"?[46,196,182]:a.trend==="declining"?[242,92,84]:[120,120,120];
    const ac=a.overallAvg>=80?[46,196,182]:a.overallAvg>=(s.passThreshold||35)?[67,97,238]:[242,92,84];
    const ewc=(a.earlyWarningScore||0)>=50?[242,92,84]:(a.earlyWarningScore||0)>=25?[249,168,38]:[46,196,182];
    const fStr=st.flags&&st.flags.length?st.flags.map(f=>f.label).join(", "):"";
    cx=10;
    doc.setFont("helvetica","bold");doc.setFontSize(7);const fitName=fitText(doc,st.name,cols[1]-3);
    doc.setFont("helvetica","normal");doc.setFontSize(7);const fitFlags=fitText(doc,fStr,cols[6]-3);
    [[String(a.rank||""),ac],[fitName,[26,29,46]],[a.overallAvg+"%",ac],[a.grade||"",ac],
     [a.trend==="improving"?"Up":a.trend==="declining"?"Down":"Stable",tc],[String(a.earlyWarningScore||0),ewc],
     [fitFlags,[150,150,150]]
    ].forEach(([v,color],i)=>{
      doc.setFont("helvetica",i===1?"bold":"normal");doc.setFontSize(7);doc.setTextColor(...color);
      doc.text(String(v||"—"),cx,y+4);cx+=cols[i];
    });
    doc.setDrawColor(226,229,241);doc.setLineWidth(0.2);doc.line(8,y+5.5,W-8,y+5.5);
    y+=6.5;
  });

  // ── AT-RISK BLOCK ──
  const flagged=APP.students.filter(st=>st.flags&&st.flags.some(f=>["at-risk","burnout","plateau"].includes(f.type)));
  if(flagged.length){
    if(y>270){doc.addPage();y=10;}
    y+=4;
    // Wrap each student's flag list to the box width up front so the box
    // height (bh) can grow to fit however many lines a long flag list
    // actually needs, instead of a fixed 6mm-per-student guess that a
    // student with several flags could overflow past the box edge.
    doc.setFont("helvetica","normal");doc.setFontSize(7.5);
    const flaggedLines=flagged.map(st=>doc.splitTextToSize(st.name+" — "+st.flags.map(f=>f.label).join(", "),W-30));
    const totalLines=flaggedLines.reduce((sum,lines)=>sum+lines.length,0);
    const bh=8+totalLines*4.5;
    doc.setFillColor(253,236,234);doc.setDrawColor(242,92,84);doc.roundedRect(8,y,W-16,bh,2,2,"FD");
    doc.setFillColor(242,92,84);doc.rect(8,y,3,bh,"F");
    doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(139,26,26);doc.text("Students Needing Support",14,y+5);y+=8;
    doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(26,29,46);
    flaggedLines.forEach(lines=>{doc.text(lines,16,y);y+=lines.length*4.5;});
    y+=4;
  }

  // ── SUBJECT GAPS (Task 2b: only if the class has a computed weakness list) ──
  const subjectWeakness=(APP.classStats&&APP.classStats.subjectWeakness)||[];
  if(subjectWeakness.length){
    if(y>255){doc.addPage();y=20;}
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(26,29,46);doc.text("Subject Gaps",10,y);y+=5;
    doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(90,96,122);
    doc.text("Sorted by % of class below the pass threshold in that subject.",10,y);y+=5;
    subjectWeakness.slice(0,6).forEach(sw=>{
      if(y>272){doc.addPage();y=20;}
      const wc=sw.pctBelow>=40?[242,92,84]:sw.pctBelow>=20?[249,168,38]:[46,196,182];
      doc.setFillColor(...wc.map(v=>Math.min(255,v+165)));doc.roundedRect(10,y,W-20,7,1,1,"F");
      doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(...wc.map(v=>Math.max(0,v-70)));
      doc.text(sw.subject,13,y+4.8);
      doc.text(sw.pctBelow+"% below pass  ·  class avg "+sw.avgClass+"%",W-13,y+4.8,{align:"right"});
      y+=9;
    });
    y+=3;
  }

  // ── TOP PERFORMERS (Task 2b: top 5 only) ──
  const teacherTop5=[...APP.students]
    .sort((x,y2)=>(x.analysis&&x.analysis.rank||999)-(y2.analysis&&y2.analysis.rank||999)).slice(0,5);
  if(teacherTop5.some(st=>st.analysis&&st.analysis.rank<=3)){
    if(y>260){doc.addPage();y=20;}
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(26,29,46);doc.text("Top Performers",10,y);y+=5;
    teacherTop5.forEach(st=>{
      if(y>278){doc.addPage();y=20;}
      const a=st.analysis||{};
      doc.setFillColor(230,249,247);doc.roundedRect(10,y,W-20,6,1,1,"F");
      doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(26,29,46);
      doc.text(fitText(doc,"#"+a.rank+" "+st.name,W-45),13,y+4.2);
      doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(46,196,182);
      doc.text(a.overallAvg+"%",W-13,y+4.2,{align:"right"});
      y+=7.5;
    });
    y+=3;
  }

  // ── TEST COMPARISON (Task 2b: only if ≥2 tests exist) ──
  if(s.tests&&s.tests.length>=2){
    if(y>250){doc.addPage();y=20;}
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(26,29,46);doc.text("Test Comparison — Class Average",10,y);y+=5;
    const tcBarW=W-70,tcBarH=5,tcLabelW=46;
    s.tests.forEach(t=>{
      if(y>278){doc.addPage();y=20;}
      const vals=APP.students.map(st=>{const idx=s.tests.indexOf(t);return st.analysis&&st.analysis.testAvgs&&st.analysis.testAvgs[idx];}).filter(v=>v!==null&&v!==undefined);
      const avg=vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
      doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(26,29,46);
      doc.text(fitText(doc,t.name,tcLabelW-4),10,y+4);
      doc.setFillColor(226,229,241);doc.roundedRect(tcLabelW,y,tcBarW,tcBarH,1,1,"F");
      if(avg!==null){
        const tc2=avg>=75?[46,196,182]:avg>=(s.passThreshold||35)?[67,97,238]:[242,92,84];
        doc.setFillColor(...tc2);doc.roundedRect(tcLabelW,y,tcBarW*(avg/100),tcBarH,1,1,"F");
        doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(...tc2);doc.text(avg+"%",tcLabelW+tcBarW+2,y+4);
      }
      y+=8;
    });
    y+=3;
  }

  // ── GENDER ANALYSIS (Task 2b: only if statistically meaningful) ──
  if(APP.genderAnalysis&&APP.genderAnalysis.available){
    const ga=APP.genderAnalysis;
    if(y>240){doc.addPage();y=20;}
    const narrative=ga.leadGroup?
      (ga.leadGroup==="Female"?"Girls":"Boys")+" are outperforming "+(ga.leadGroup==="Female"?"boys":"girls")+" overall by "+ga.overallGap+" point"+(ga.overallGap===1?"":"s")+" this term."+
      (ga.maxGapSubject?" The gap is largest in "+ga.maxGapSubject+" ("+ga.maxGapValue+" pts).":"")
      :"Overall performance is essentially even between the two groups this term.";
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(26,29,46);doc.text("Gender Analysis",10,y);y+=5;
    doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(90,96,122);
    const gLines=doc.splitTextToSize(narrative,W-20);
    doc.text(gLines,10,y);y+=gLines.length*4.2+5;
  }

  // ── STUDENT REMARKS SUMMARY (Task 2b: only if any student has a remark) ──
  const remarkedStudents=APP.students.map(st=>({st,entries:(s.tests||[]).map(t=>({test:t.name,remark:(st.testData[t.name]||{}).remark})).filter(e=>e.remark)})).filter(x=>x.entries.length);
  if(remarkedStudents.length){
    if(y>248){doc.addPage();y=20;}
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(26,29,46);doc.text("Teacher Remarks — Notes for PTM",10,y);y+=5;
    remarkedStudents.forEach(({st,entries})=>{
      entries.forEach(e=>{
        if(y>278){doc.addPage();y=20;}
        doc.setFont("helvetica","bold");doc.setFontSize(7);doc.setTextColor(67,97,238);
        doc.text(fitText(doc,st.name+" · "+e.test,60),10,y);
        doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(26,29,46);
        const rLines=doc.splitTextToSize(e.remark,W-80);
        doc.text(rLines,72,y);
        y+=Math.max(4.5,rLines.length*4);
      });
    });
    y+=3;
  }

  // ── FOOTER (stamped on every page) ──
  stampFooterAllPages(doc,"TEACHER CONFIDENTIAL");
}
function buildMgmtPDF(doc){
  const s=APP.setup,sts=APP.students,W=210,H=297;
  const n=sts.length||1;
  const classAvg=Math.round(sts.reduce((a,st)=>a+(st.analysis&&st.analysis.overallAvg||0),0)/n);
  const passRate=Math.round(sts.filter(st=>st.analysis&&st.analysis.overallAvg>=(s.passThreshold||35)).length/n*100);
  const atRisk=sts.filter(st=>st.flags&&st.flags.some(f=>f.type==="at-risk")).length;
  const improving=sts.filter(st=>st.analysis&&st.analysis.trend==="improving").length;
  const declining=sts.filter(st=>st.analysis&&st.analysis.trend==="declining").length;
  const topper=sts[0];

  // ── HEADER (navy, prestigious) ──
  doc.setFillColor(30,58,95);doc.rect(0,0,W,24,"F");
  doc.setFillColor(67,97,238);doc.rect(0,20,W,4,"F");
  doc.setTextColor(255,255,255);doc.setFont("helvetica","bold");doc.setFontSize(14);
  doc.text("Student Insight",10,10);
  doc.setFont("helvetica","normal");doc.setFontSize(8);
  doc.text([s.instName,s.className+(s.section?" "+s.section:""),s.year].filter(Boolean).join("   |   "),10,17);
  doc.text("Management Report   |   "+new Date().toLocaleDateString(),W-10,17,{align:"right"});
  doc.setTextColor(26,29,46);let y=30;

  // ── EXECUTIVE KPI TILES (2 rows of 3) ──
  const kpis=[
    {l:"Total Students",v:n,sub:"",c:[15,32,65]},
    {l:"Class Average",v:classAvg+"%",sub:"",c:classAvg>=60?[46,196,182]:[242,92,84]},
    {l:"Pass Rate",v:passRate+"%",sub:sts.filter(st=>st.analysis&&st.analysis.overallAvg>=(s.passThreshold||35)).length+" students",c:passRate>=60?[46,196,182]:[242,92,84]},
    {l:"At Risk",v:atRisk,sub:atRisk>0?"Needs attention":"All clear",c:atRisk>0?[242,92,84]:[46,196,182]},
    {l:"Improving",v:improving,sub:Math.round(improving/n*100)+"% of class",c:[46,196,182]},
    {l:"Class Topper",v:topper?topper.name.split(" ")[0]:"—",sub:topper?topper.analysis.overallAvg+"%":"",c:[249,168,38]},
  ];
  const tW=(W-20)/3;
  [[0,1,2],[3,4,5]].forEach((row,ri)=>{
    row.forEach((ki,ci)=>{
      const k=kpis[ki],tx=10+ci*tW,ty=y+ri*22;
      doc.setFillColor(255,255,255);doc.setDrawColor(226,229,241);doc.roundedRect(tx,ty,tW-4,19,2,2,"FD");
      doc.setFillColor(...k.c);doc.rect(tx,ty,tW-4,2.5,"F");
      doc.setFont("helvetica","normal");doc.setFontSize(6.5);doc.setTextColor(155,164,192);
      doc.text(k.l,tx+(tW-4)/2,ty+7,{align:"center"});
      doc.setFont("helvetica","bold");doc.setFontSize(12);doc.setTextColor(...k.c);
      doc.text(String(k.v),tx+(tW-4)/2,ty+14,{align:"center"});
      if(k.sub){doc.setFont("helvetica","normal");doc.setFontSize(6);doc.setTextColor(155,164,192);doc.text(fitText(doc,k.sub,tW-6),tx+(tW-4)/2,ty+17,{align:"center"});}
    });
  });
  y+=48;

  // ── SUBJECT PERFORMANCE (visual bars, side by side) ──
  if(s.subjects&&s.subjects.length){
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(26,29,46);doc.text("Subject Performance Overview",10,y);y+=5;
    const subData=s.subjects.map(sub=>{
      const vals=sts.map(st=>st.analysis&&st.analysis.subjectAvgs&&st.analysis.subjectAvgs[sub]).filter(v=>v!=null&&!isNaN(v));
      const avg=vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):0;
      const passing=vals.filter(v=>v>=(s.passThreshold||35)).length;
      return{sub,avg,passing,total:vals.length};
    });
    const bW=(W-24)/subData.length,bH=20;
    subData.forEach(({sub,avg,passing,total:tot},i)=>{
      const bx=10+i*bW;
      const bc=avg>=75?[46,196,182]:avg>=(s.passThreshold||35)?[67,97,238]:[242,92,84];
      // Background
      doc.setFillColor(240,242,250);doc.roundedRect(bx,y,bW-3,bH,1,1,"F");
      // Fill bar (vertical)
      const fillH=(avg/100)*bH;
      doc.setFillColor(...bc);doc.roundedRect(bx,y+bH-fillH,bW-3,fillH,1,1,"F");
      // Label
      doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(255,255,255);
      if(fillH>8)doc.text(avg+"%",bx+(bW-3)/2,y+bH-fillH+6,{align:"center"});
      doc.setFont("helvetica","normal");doc.setFontSize(6.5);doc.setTextColor(26,29,46);
      doc.text(fitText(doc,sub,bW-1),bx+(bW-3)/2,y+bH+5,{align:"center"});
    });
    y+=bH+10;
  }

  // ── TREND SUMMARY BOXES ──
  const trendData=[
    {label:"Consistently Improving",count:improving,color:[46,196,182],bg:[230,249,247]},
    {label:"Consistently Declining",count:declining,color:[242,92,84],bg:[253,236,234]},
    {label:"At-Risk Students",count:atRisk,color:[242,92,84],bg:[253,236,234]},
    {label:"Stable Performance",count:n-improving-declining,color:[67,97,238],bg:[238,240,253]},
  ];
  const tbW=(W-20)/4;
  trendData.forEach(({label,count,color,bg},i)=>{
    const tx=10+i*tbW;
    doc.setFillColor(...bg);doc.setDrawColor(...color);doc.roundedRect(tx,y,tbW-3,18,2,2,"FD");
    doc.setFont("helvetica","bold");doc.setFontSize(14);doc.setTextColor(...color);doc.text(String(count),tx+(tbW-3)/2,y+12,{align:"center"});
    doc.setFont("helvetica","normal");doc.setFontSize(6.5);doc.setTextColor(90,96,122);doc.text(label,tx+(tbW-3)/2,y+17,{align:"center"});
  });
  y+=24;

  // ── TOP PERFORMERS / NEEDS SUPPORT (Task 2c: top 3 only, gated on class
  // size > 5; "Needs Support" column only when at-risk count > 0) ──
  const top3=(n>5)?sts.slice(0,Math.min(3,sts.length)):[];
  const bottom3=atRisk>0?[...sts].filter(st=>st.flags&&st.flags.some(f=>f.type==="at-risk")).slice(0,3):[];
  const halfW=(W-24)/2;

  if(top3.length||bottom3.length){
    if(top3.length){doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(46,196,182);doc.text("Top Performers",10,y);}
    if(bottom3.length){doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(242,92,84);doc.text("At-Risk Students",14+halfW,y);}
    y+=4;

    const maxRows=Math.max(top3.length,bottom3.length);
    for(let i=0;i<maxRows;i++){
      if(y>275){break;}
      const ts=top3[i],bs=bottom3[i];
      // Left: top performer
      if(ts){
        const a=ts.analysis||{};
        doc.setFillColor(230,249,247);doc.roundedRect(10,y,halfW,7,1,1,"F");
        doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(26,29,46);
        doc.text(fitText(doc,"#"+a.rank+" "+ts.name,halfW-22),13,y+5);
        doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(46,196,182);
        doc.text(a.overallAvg+"%",10+halfW-6,y+5,{align:"right"});
      }
      // Right: at-risk
      if(bs){
        const a=bs.analysis||{};
        doc.setFillColor(253,236,234);doc.roundedRect(14+halfW,y,halfW,7,1,1,"F");
        doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(26,29,46);
        doc.text(fitText(doc,bs.name,halfW-22),17+halfW,y+5);
        doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(242,92,84);
        doc.text(a.overallAvg+"%",14+halfW+halfW-6,y+5,{align:"right"});
      }
      y+=8;
    }
    y+=4;
  }

  // ── GENDER PERFORMANCE ANALYSIS (school-level only; diversity_analysis
  // AI feature) — never shown on the per-student PDF, see computeGenderAnalysis()
  if(APP.genderAnalysis){
    const ga=APP.genderAnalysis;
    if(ga.available&&y<230){
      const labels=Object.keys(ga.groups);
      const narrative=ga.leadGroup?
        (ga.leadGroup==="Female"?"Girls":"Boys")+" are outperforming "+(ga.leadGroup==="Female"?"boys":"girls")+" overall by "+ga.overallGap+" point"+(ga.overallGap===1?"":"s")+" this term."+
        (ga.maxGapSubject?" The gap is largest in "+ga.maxGapSubject+" ("+ga.maxGapValue+" pts, led by "+(ga.maxGapLead==="Female"?"girls":"boys")+").":"")
        :"Overall performance is essentially even between the two groups this term.";
      doc.setFont("helvetica","normal");doc.setFontSize(8);
      const lines=doc.splitTextToSize(narrative,W-28);
      const panelH=20;
      const bh=10+panelH+lines.length*4.2+6;
      doc.setFillColor(245,240,251);doc.setDrawColor(123,94,167);doc.roundedRect(8,y,W-16,bh,2,2,"FD");
      doc.setFillColor(123,94,167);doc.rect(8,y,3,bh,"F");
      doc.setFont("helvetica","bold");doc.setFontSize(8.5);doc.setTextColor(123,94,167);doc.text("Gender Performance Analysis",14,y+6);
      const panelW=(W-32)/2;
      labels.forEach((label,i)=>{
        const g=ga.groups[label];
        const px=14+i*(panelW+4),py=y+10;
        const pc=label==="Female"?[199,69,150]:[52,120,201];
        doc.setFillColor(255,255,255);doc.setDrawColor(...pc);doc.roundedRect(px,py,panelW,panelH,1,1,"FD");
        doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(...pc);doc.text(label+" ("+g.count+")",px+4,py+6);
        doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(26,29,46);doc.text(g.avg+"%",px+4,py+13.5);
        doc.setFont("helvetica","normal");doc.setFontSize(6.5);doc.setTextColor(155,164,192);doc.text("Pass rate: "+g.passRate+"%",px+4,py+18);
      });
      doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(26,29,46);doc.text(lines,14,y+10+panelH+5);
      y+=bh+5;
    }
  }

  // ── COMPARE SECTIONS (Task 2c: compare mode only, and only with real data) ──
  if(APP.compareMode&&APP.sectionComparison&&APP.sectionComparison.length){
    if(y>240){doc.addPage();y=20;}
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(26,29,46);doc.text("Compare Sections",10,y);y+=5;
    const ccols=[50,16,18,18,18,40],cheads=["Section","N","Avg","Pass%","At-Risk","Topper"];
    doc.setFillColor(67,97,238);doc.rect(8,y,W-16,6,"F");
    let ccx=10;
    cheads.forEach((h,i)=>{doc.setFont("helvetica","bold");doc.setFontSize(6.5);doc.setTextColor(255,255,255);doc.text(h,ccx,y+4.2);ccx+=ccols[i];});
    y+=7;
    APP.sectionComparison.forEach((r,i)=>{
      if(y>282){doc.addPage();y=20;}
      doc.setFillColor(i%2===0?255:248,i%2===0?255:249,i%2===0?255:255);doc.rect(8,y-1,W-16,6.5,"F");
      ccx=10;
      [[fitText(doc,r.label,ccols[0]-3),[26,29,46]],[String(r.n),[90,96,122]],[r.avg+"%",[67,97,238]],[r.passRate+"%",r.passRate>=60?[46,196,182]:[242,92,84]],[String(r.atRisk),r.atRisk>0?[242,92,84]:[46,196,182]],[fitText(doc,r.topperName,ccols[5]-3),[90,96,122]]]
        .forEach(([v,color],ci)=>{doc.setFont("helvetica",ci===0?"bold":"normal");doc.setFontSize(7);doc.setTextColor(...color);doc.text(String(v),ccx,y+4);ccx+=ccols[ci];});
      y+=6.5;
    });
    y+=5;
  }

  // ── RECOMMENDATION BOX ──
  if(y<265){
    const rec=atRisk>n*0.3?"High at-risk rate detected. Consider remedial sessions for flagged subjects.":improving>n*0.5?"Strong positive trend across the class. Recognition programme recommended.":"Class performance is stable. Monitor declining students closely.";
    doc.setFont("helvetica","normal");doc.setFontSize(8);
    const lines=doc.splitTextToSize("Recommendation: "+rec,W-28);
    const bh=lines.length*4.5+10;
    doc.setFillColor(238,240,253);doc.setDrawColor(67,97,238);doc.roundedRect(8,y,W-16,bh,2,2,"FD");
    doc.setFillColor(67,97,238);doc.rect(8,y,3,bh,"F");
    doc.setFont("helvetica","bold");doc.setFontSize(8.5);doc.setTextColor(67,97,238);doc.text("Strategic Recommendation",14,y+6);
    doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(26,29,46);doc.text(lines,14,y+12);
  }

  // ── FOOTER (stamped on every page) ──
  stampFooterAllPages(doc,"MANAGEMENT CONFIDENTIAL");
}

