import { toast } from '../../core/app-utils-init.js';
import { deriveContinuityTerminology } from '../common/compute-continuity.js';
import { computeGenderAnalysis, sleep } from '../common/compute-stats.js';
import { flagChapterSuffix } from '../../ui/common/render-findings.js';
import { bcp47TagFor, i18nLabel, srT } from '../../core/render-i18n.js';
import { APP, goStep } from '../../core/state-nav.js';
import { renderShellRightRail } from '../../core/vs-shell.js';

/* ════ EXPORT ════ */

// i18n-export-fix (regional-report-text): jsPDF's built-in "helvetica"
// font only covers WinAnsi/Latin-1 — no Devanagari/Tamil/Kannada/Bengali/
// etc. The previous version of this function (STRESS_TEST_REPORT.md
// BUG-1) papered over that by replacing every unsupported character with
// "?" — which meant regional-language report text (both the app's own
// translated labels AND anything a teacher typed in their own script,
// e.g. remarks or a student's name) rendered as a wall of question marks
// instead of failing loudly OR working. That was a real improvement over
// silently-dropped/blank-box text at the time, but it's not the same as
// actually supporting regional scripts.
//
// This version fixes it properly instead: any string containing a
// character jsPDF's built-in font can't render is drawn to an offscreen
// <canvas> using the SAME font stack the on-screen UI already uses
// (--font/--font-display in css/core.css, which the browser correctly
// falls back to a system Indic font for — that's why the on-screen app
// already displays Hindi/Tamil/etc. correctly today) and embedded into
// the PDF as an image instead of as jsPDF vector text. Pure-Latin text
// (English UI, numbers, names typed in Latin script) is completely
// unaffected and still renders via doc.text() as fast, crisp, selectable
// vector text — this only kicks in for the characters that actually need
// it, per string, not per-document or per-language.
//
// setTextColor/setFont/setFontSize are intercepted purely to track the
// CURRENT drawing state (jsPDF doesn't expose a getter for text color),
// so the canvas fallback can match the color/weight/size the surrounding
// vector text would have used. They still call through to the real
// jsPDF methods — this is bookkeeping, not a behaviour change.
//
// NOT YET TESTED IN AN ACTUAL BROWSER/jsPDF RUNTIME — this sandbox has no
// way to render a PDF and look at it. Please do a manual QA pass (export
// a report in Hindi and Urdu at minimum — Urdu because RTL shaping is the
// highest-risk case) before treating this as done. Known rough edges to
// check first: vertical baseline alignment next to Latin numbers on the
// same line, and RTL correctness for Urdu specifically.
function sanitizePdfDoc(doc){
  const state={color:[0,0,0],fontFamily:"helvetica",fontStyle:"normal",fontSize:10};
  const MM_PER_PT=0.352778;
  const needsCanvasFallback=s=>/[^\x00-\xFF]/.test(s);

  const origSetTextColor=doc.setTextColor.bind(doc);
  doc.setTextColor=function(...args){
    if(args.length>=3)state.color=[args[0],args[1],args[2]];
    else if(args.length===1)state.color=[args[0],args[0],args[0]];
    return origSetTextColor(...args);
  };
  const origSetFont=doc.setFont.bind(doc);
  doc.setFont=function(family,style,...rest){
    state.fontFamily=family||state.fontFamily;
    if(style!==undefined)state.fontStyle=style;
    return origSetFont(family,style,...rest);
  };
  const origSetFontSize=doc.setFontSize.bind(doc);
  doc.setFontSize=function(size){state.fontSize=size;return origSetFontSize(size);};

  // Renders one line of non-Latin text to a canvas and embeds it as an
  // image at the position/alignment jsPDF's own text() would have used.
  function drawCanvasLine(line,x,y,opts){
    if(!line)return;
    const scale=4; // supersample so it stays crisp when the PDF is zoomed
    const pxFont=state.fontSize*scale;
    const weight=state.fontStyle&&state.fontStyle.indexOf("bold")>=0?"bold ":"";
    const style=state.fontStyle&&state.fontStyle.indexOf("italic")>=0?"italic ":"";
    const fontStack="'Noto Sans','Noto Sans Devanagari','Noto Sans Tamil','Noto Sans Bengali','Noto Sans Kannada','Noto Sans Malayalam','Noto Sans Telugu','Noto Sans Gujarati','Noto Sans Gurmukhi','Noto Sans Oriya','Noto Nastaliq Urdu','sans-serif'";
    const measure=document.createElement("canvas").getContext("2d");
    measure.font=style+weight+pxFont+"px "+fontStack;
    const textW=Math.max(1,measure.measureText(line).width);
    const canvas=document.createElement("canvas");
    canvas.width=Math.ceil(textW+pxFont*0.3);
    canvas.height=Math.ceil(pxFont*1.5);
    const ctx=canvas.getContext("2d");
    ctx.font=style+weight+pxFont+"px "+fontStack;
    ctx.fillStyle="rgb("+state.color[0]+","+state.color[1]+","+state.color[2]+")";
    ctx.textBaseline="alphabetic";
    // Urdu (RTL) needs the canvas itself to lay the glyphs out
    // right-to-left, not just the alignment of where the image sits.
    const isRtl=!!(window.I18N_TABLES&&window.I18N_TABLES[window.SR_LANG]&&window.I18N_TABLES[window.SR_LANG]._meta&&window.I18N_TABLES[window.SR_LANG]._meta.rtl);
    if(isRtl)ctx.direction="rtl";
    ctx.fillText(line,isRtl?canvas.width-pxFont*0.15:pxFont*0.15,pxFont*1.05);

    const fontSizeMm=state.fontSize*MM_PER_PT;
    const pxPerMm=pxFont/fontSizeMm;
    const wMm=canvas.width/pxPerMm,hMm=canvas.height/pxPerMm;
    let drawX=x;
    const align=opts&&opts.align;
    if(align==="center")drawX=x-wMm/2;else if(align==="right")drawX=x-wMm;
    const drawY=y-fontSizeMm*0.78; // approximate ascent so baseline lines up with vector text at the same (x,y)
    try{doc.addImage(canvas.toDataURL("image/png"),"PNG",drawX,drawY,wMm,hMm);}
    catch(e){console.error("PDF canvas-text embed failed, falling back to Latin-stripped text:",e);origText(line.replace(/[^\x00-\xFF]/g,"?"),x,y,opts);}
  }

  const origText=doc.text.bind(doc);
  doc.text=function(text,x,y,opts){
    if(Array.isArray(text)){
      // multi-line: jsPDF advances each line by ~fontSize*lineHeightFactor
      const lineH=state.fontSize*MM_PER_PT*1.15;
      text.forEach((line,i)=>{
        if(typeof line==="string"&&needsCanvasFallback(line))drawCanvasLine(line,x,y+i*lineH,opts);
        else origText(line,x,y+i*lineH,opts);
      });
      return doc;
    }
    if(typeof text==="string"&&needsCanvasFallback(text)){drawCanvasLine(text,x,y,opts);return doc;}
    return origText(text,x,y,opts);
  };
  // splitTextToSize only wraps text to fit a width — jsPDF's own
  // (Latin-metrics) wrapping is an approximation for non-Latin scripts
  // anyway, but it's a reasonable one and this keeps behaviour unchanged
  // for the common case; the per-line canvas fallback above still kicks
  // in correctly for each wrapped line when doc.text() draws them.
  const origSplit=doc.splitTextToSize.bind(doc);
  doc.splitTextToSize=function(text,...rest){return origSplit(text,...rest);};
  return doc;
}

// Small param-aware wrapper around the app's existing i18nLabel() (js/render-dashboard.js)
// so report strings can carry a {{placeholder}} the same way srT() does elsewhere in the
// app, without duplicating the whole i18n table-lookup logic here.
function pdfT(key,fallback,params){
  let s=(typeof i18nLabel==="function")?i18nLabel(key,fallback):fallback;
  if(params)Object.keys(params).forEach(p=>{s=s.split("{{"+p+"}}").join(params[p]);});
  return s;
}

async function generateAllPDFs(){
  if(!APP.students.length){toast(pdfT("pdf_no_students_export","No students to export."),"warn");return;}
  if((APP.dataIssues||[]).length){toast(pdfT("pdf_fix_data_issues","Fix the {{count}} data quality issue(s) on the Dashboard before exporting.",{count:APP.dataIssues.length}),"warn");goStep("dashboard");return;}
  const doS=$("#exp-student").is(":checked"),doT=$("#exp-teacher").is(":checked"),doM=$("#exp-mgmt").is(":checked"),doZ=$("#exp-zip").is(":checked");
  if(!doS&&!doT&&!doM){toast(pdfT("pdf_select_report_type","Select at least one report type to export."),"warn");return;}
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
        // BUG FIX: this app's $ is a minimal jQuery-shim (core/dom-shim.js),
        // not real jQuery — its .filter() only accepts a callback
        // function(i,el), never a CSS pseudo-selector string. Passing
        // ":checked" here called fn.call() on a string, throwing
        // "fn.call is not a function" and aborting PDF export entirely
        // (both the per-student loop below and, upstream, generateAllPDFs()
        // in inline-actions.js). Swap the selector for the equivalent
        // predicate the shim actually supports.
        const ids=new Set(studentCbs.filter((i,el)=>el.checked).map((i,el)=>el.getAttribute("data-id")).get());
        return APP.students.filter(st=>ids.has(String(st.id)));
      })()
    : APP.students;
  const {jsPDF}=window.jspdf;
  const total=(doS?selectedStudents.length:0)+(doT?1:0)+(doM?1:0);let done=0;
  $("#export-loader").show();
  $("#btn-generate-pdfs").prop("disabled",true).removeClass("btn-glow");
  function prog(msg,pct){$("#export-loader-msg").text(msg);$("#export-prog").css("transform","scaleX("+(pct/100)+")");}
  function safeName(n){return n.replace(/[^\w\s-]/g,"").replace(/\s+/g,"_");}
  // Bug fix (student report file naming spec): was `<name>_<id>.pdf` —
  // now `Rank-xx_<name>_<class>_<section if set>_<roll/studID>.pdf`.
  // Rank padded to 2 digits (01, 02… matches "Rank-xx" in the spec).
  function studentFileName(st){
    const rank=String((st.analysis&&st.analysis.rank)||0).padStart(2,"0");
    const s=APP.setup||{};
    const parts=["Rank-"+rank,safeName(st.name)];
    if(s.className) parts.push(safeName(s.className));
    if(s.section) parts.push(safeName(s.section));
    parts.push(safeName(String(st.id)));
    return parts.join("_")+".pdf";
  }
  const urlsToRevoke=[];
  function downloadBlob(blob,fname){const url=URL.createObjectURL(blob);urlsToRevoke.push(url);const link=document.createElement("a");link.href=url;link.download=fname;document.body.appendChild(link);link.click();link.remove();}
  try{
    if(doZ){
      const zip=new JSZip();
      if(doS){for(const st of selectedStudents){prog(pdfT("pdf_generating_student","Generating: {{name}} ({{done}}/{{total}})",{name:st.name,done:done,total:selectedStudents.length}),Math.round(done/total*100));await sleep(20);const doc=sanitizePdfDoc(new jsPDF("p","mm","a4"));buildStudentPDF(doc,st,APP.continuity);zip.file("Students/"+studentFileName(st),doc.output("blob"));done++;}}
      if(doT){prog(pdfT("pdf_generating_teacher","Generating Teacher Report…"),Math.round(done/total*100));await sleep(20);const doc=sanitizePdfDoc(new jsPDF("p","mm","a4"));buildTeacherPDF(doc);zip.file("Teacher_Report.pdf",doc.output("blob"));done++;}
      if(doM){prog(pdfT("pdf_generating_mgmt","Generating Management Report…"),Math.round(done/total*100));await sleep(20);const doc=sanitizePdfDoc(new jsPDF("p","mm","a4"));buildMgmtPDF(doc);zip.file("Management_Report.pdf",doc.output("blob"));done++;}
      prog(pdfT("pdf_building_zip","Building ZIP…"),95);
      const zipBlob=await zip.generateAsync({type:"blob"});
      const s=APP.setup,fname=safeName((s.instName||"StudentInsight")+"_"+(s.className||"Class")+"_"+(s.year||"2026"))+"_Reports.zip";
      downloadBlob(zipBlob,fname);
      toast(pdfT("pdf_zip_downloaded","ZIP downloaded: {{fname}}",{fname:fname}),"success");
    } else {
      // ZIP unchecked — download each selected PDF individually
      if(doS){for(const st of selectedStudents){prog(pdfT("pdf_generating_student","Generating: {{name}} ({{done}}/{{total}})",{name:st.name,done:done,total:selectedStudents.length}),Math.round(done/total*100));await sleep(20);const doc=sanitizePdfDoc(new jsPDF("p","mm","a4"));buildStudentPDF(doc,st,APP.continuity);downloadBlob(doc.output("blob"),studentFileName(st));done++;}}
      if(doT){prog(pdfT("pdf_generating_teacher","Generating Teacher Report…"),Math.round(done/total*100));await sleep(20);const doc=sanitizePdfDoc(new jsPDF("p","mm","a4"));buildTeacherPDF(doc);downloadBlob(doc.output("blob"),"Teacher_Report.pdf");done++;}
      if(doM){prog(pdfT("pdf_generating_mgmt","Generating Management Report…"),Math.round(done/total*100));await sleep(20);const doc=sanitizePdfDoc(new jsPDF("p","mm","a4"));buildMgmtPDF(doc);downloadBlob(doc.output("blob"),"Management_Report.pdf");done++;}
      toast(pdfT("pdf_downloaded_individually","{{count}} PDF(s) downloaded individually.",{count:done}),"success");
    }
  }catch(err){
    toast(pdfT("pdf_export_failed","Export failed: {{msg}}",{msg:err.message}),"error");
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
  const s=APP.setup,T=PDF_THEME;
  doc.setTextColor(...T.ACCENT);doc.setFontSize(12);doc.setFont("helvetica","bold");doc.text("Student Insight",10,11);
  doc.setFontSize(9);doc.setFont("helvetica","normal");doc.setTextColor(...T.INK_SOFT);doc.text([s.instName,s.className+(s.section?" "+s.section:""),s.year].filter(Boolean).join(" · "),80,11);
  pdfRule(doc,8,14,202,1.6,T.INK);
  doc.setTextColor(...T.INK);doc.setFontSize(14);doc.setFont("helvetica","bold");doc.text(title,10,26);
  doc.setFont("helvetica","normal");doc.setFontSize(9);doc.setTextColor(...T.INK_SOFT);doc.text(pdfT("pdf_generated_label","Generated: {{date}}",{date:new Date().toLocaleDateString(bcp47TagFor(window.SR_LANG))}),150,26);return 34;
}
// Stamps the branded footer — a thin top rule + text, no filled bar (see
// PDF_THEME above, Aug 2026 ink-light redesign) — with a clickable link
// to studin.in — on EVERY page of the document (not just whichever page
// content happened to end on), since a report can legitimately run to
// several pages.
//
// marginX/textY let a caller keep the exact same footer layout (rule
// position, font sizes, element order: brand+tagline left, confidential
// label right, "Page X of Y" centred) while sitting it inside a
// decorative page frame — the student keepsake report draws an outer
// frame 6-10mm in from the edge, so its footer needs a bigger inset than
// the frame-less Teacher/Management/Certificate reports. Before this,
// the student report duplicated this whole function by hand with its
// own hardcoded margin (14 vs 8) and baseline (H-12 vs H-4), which is
// why the footer sat at a visibly different position/size across
// reports. Everything now flows through this one function so the four
// report types can never drift out of sync again.
function stampFooterAllPages(doc,confidentialLabel,marginX,textY){
  const W=210,H=297,T=PDF_THEME;
  marginX=marginX||8;textY=textY||H-4;
  const ruleY=textY-4,textX=marginX+2,textXR=W-marginX-2;
  const pageCount=doc.internal.getNumberOfPages();
  for(let p=1;p<=pageCount;p++){
    doc.setPage(p);
    pdfRule(doc,marginX,ruleY,W-marginX,1,T.LINE);
    doc.setFont("helvetica","normal");doc.setFontSize(7);doc.setTextColor(...T.INK_SOFT);
    doc.textWithLink("Student Insight",textX,textY,{url:(window.APP_CONFIG&&window.APP_CONFIG.projectPageUrl)||"https://studin.in/"});
    const linkW=doc.getTextWidth("Student Insight");
    doc.text(pdfT("pdf_footer_tagline"," — Free & Open Source  |  Privacy-First  |  Built by Sandeep Hakki"),textX+linkW,textY);
    doc.text(confidentialLabel,textXR,textY,{align:"right"});
    if(pageCount>1){doc.setFontSize(6.5);doc.setTextColor(...T.LINE);doc.text(pdfT("pdf_page_of","Page {{p}} of {{total}}",{p:p,total:pageCount}),W/2,textY,{align:"center"});}
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
// ════ PDF VISUAL THEME (report redesign, Aug 2026 — see PIB §12 v4.42) ════
// Single source of truth for the ink-light, high-contrast palette used by
// all three PDFs. Was: 5+ hues (navy/teal/red/orange/purple) each with a
// filled solid-colour background block for headers, footers, KPI cards,
// table header rows, zebra-striped rows, and section boxes — expensive
// in toner/ink across a 500-copy print run, and visually loud. Now: TWO
// colours total (ACCENT for brand/neutral, DANGER for at-risk only, GOOD
// for on-target/improving), used as TEXT and LINE colour, never as a
// fill — the only fills left anywhere are subject-bar/KPI-trend-box
// colour-coding, where the fill IS the data being shown, not decoration.
// Lines are drawn heavier/darker than a typical "subtle hairline" on
// purpose — Aug 2026 review feedback was explicit that a light/pale
// theme read as washed out on a laminated keepsake print; contrast here
// comes from line WEIGHT, not from area of fill.
const PDF_THEME=Object.freeze({
  INK:[20,22,42],           // #14162a — body text, near-black
  INK_SOFT:[61,65,87],      // #3d4157 — secondary text, still clearly readable
  LINE:[138,143,174],       // #8a8fae — structural hairlines, visibly present
  LINE_STRONG:[20,22,42],   // header/table-header rules — full ink, same as INK
  ACCENT:[29,43,82],        // #1d2b52 — deep navy, brand + neutral emphasis
  DANGER:[169,30,44],       // #a91e2c — at-risk only, reads clearly even laminated
  GOOD:[15,107,92],         // #0f6b5c — on-target / improving
  WARN:[168,109,20],        // #a86d14 — declining-but-not-at-risk (was orange fill)
  WHITE:[255,255,255],
});
// Draws a horizontal rule at the given weight/colour — used everywhere a
// filled bar used to sit (header underline, table header rule, footer
// top rule, box borders) so contrast comes from line weight not fill.
function pdfRule(doc,x1,y,x2,weightPt,color){
  doc.setDrawColor(...(color||PDF_THEME.LINE_STRONG));doc.setLineWidth(weightPt*0.352778);
  doc.line(x1,y,x2,y);
}

function buildStudentPDF(doc,st,continuityData){
  const a=st.analysis,s=APP.setup;
  const isIndividual=s.mode==="individual";
  const W=210,H=297;
  const T=PDF_THEME;
  // ════ ONE-PAGE KEEPSAKE REDESIGN (Aug 2026, PIB §12 v4.42) ════
  // Was a multi-page document (Quick Navigation jump-bar + internal links,
  // a Journey/continuity chart, a repeated "Class Avg" row under every
  // single test row, and an explanatory marks-legend line) — all of that
  // only earns its space across several pages. Printed once per student
  // every term (hundreds of copies/school/year) and meant to be kept, not
  // browsed, so this version is DELIBERATELY capped to fit one A4 page:
  // no doc.addPage() anywhere in this function. Journey/nav/legend/
  // repeated-class-avg are dropped entirely rather than shrunk — full
  // multi-test drill-down stays available on the in-app Dashboard, this
  // is the printable summary. See PDF_THEME above for the ink-light,
  // high-contrast line-based palette (no filled header/footer/KPI/zebra
  // blocks — contrast comes from line weight, not fill area).
  //
  // Defensive cap: a real class can run more tests across a year than
  // will fit in the marks-table's page-height budget (~10-12 rows
  // comfortably) — rather than silently overflowing past the page edge
  // (which addPage() used to catch, and no longer exists here), only the
  // most recent MAX_TESTS_SHOWN tests are drawn, with a one-line note
  // when older tests were dropped. This mirrors the same truncation
  // pattern already used for the Teacher report's full roster table.
  const MAX_TESTS_SHOWN=10;
  const allTests=s.tests||[];
  const testsShown=allTests.slice(-MAX_TESTS_SHOWN);
  const testsHiddenCount=allTests.length-testsShown.length;

  // ── KEEPSAKE FRAME (outer solid rule + inset hairline) ──
  // Outer weight brought down from 1.6pt (read as a thick black border on
  // print/laminate) to 0.9pt — still a clear frame, no longer heavy.
  doc.setDrawColor(...T.INK);doc.setLineWidth(0.9*0.352778);doc.rect(6,6,W-12,H-12);
  doc.setDrawColor(...T.LINE);doc.setLineWidth(0.4*0.352778);doc.rect(10,10,W-20,H-20);

  const M=14; // left/right content margin, inside the frame
  let y=20;
  // ── HEADER — brand + report kind, rule underneath, no filled bar.
  //    Brand font size (12pt) and meta font size (8.5pt) match every
  //    other report/certificate exactly — was 13pt/8.5pt here, 12pt/8pt
  //    on Teacher, 14pt/8pt on Management, 12pt/9pt on the Certificate,
  //    which is why the "Student Insight" wordmark visibly changed size
  //    across printouts of the same theme. ──
  doc.setTextColor(...T.ACCENT);doc.setFont("helvetica","bold");doc.setFontSize(12);
  doc.text("Student Insight",M,y);
  doc.setTextColor(...T.INK_SOFT);doc.setFont("helvetica","normal");doc.setFontSize(8.5);
  doc.text(pdfT("pdf_progress_report","Progress Report"),M,y+4.8);
  doc.text([s.instName,isIndividual?(s.className||""):s.className+(s.section?" "+s.section:""),s.year].filter(Boolean).join(" · "),W-M,y-1,{align:"right"});
  doc.text(pdfT("pdf_generated_label","Generated: {{date}}",{date:new Date().toLocaleDateString(bcp47TagFor(window.SR_LANG))}),W-M,y+4.8,{align:"right"});
  y+=8;
  pdfRule(doc,M,y,W-M,2,T.INK);
  y+=8;

  // ── IDENTITY STRIP (bordered, no fill) ──
  // Was drawn in T.INK (near-black) at 1.2pt — same ink weight as the
  // section rules, so it competed with them instead of sitting quietly
  // underneath the name. T.LINE is the same palette's structural-hairline
  // colour, kept a touch heavier than a true hairline so it still reads.
  doc.setDrawColor(...T.LINE);doc.setLineWidth(0.8*0.352778);doc.roundedRect(M,y,W-2*M,17,1.5,1.5);
  doc.setFont("helvetica","bold");doc.setFontSize(14);doc.setTextColor(...T.INK);
  doc.text(fitText(doc,st.name,(W-2*M)-55),M+6,y+9.5);
  doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(...T.INK_SOFT);
  doc.text(fitText(doc,isIndividual?pdfT("pdf_id_label","ID: {{id}}",{id:st.id}):pdfT("pdf_student_id_label","Student ID: {{id}}",{id:st.id}),(W-2*M)-55),M+6,y+14.5);
  const avgColor=a.overallAvg>=80?T.GOOD:a.overallAvg>=s.passThreshold?T.ACCENT:T.DANGER;
  doc.setFont("helvetica","bold");doc.setFontSize(17);doc.setTextColor(...avgColor);
  doc.text(a.overallAvg+"%",W-M-6,y+10,{align:"right"});
  doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(...T.INK_SOFT);
  doc.text(pdfT("pdf_grade_prefix","Grade {{grade}}",{grade:a.grade}),W-M-6,y+15,{align:"right"});
  y+=23;

  // ── KPI STRIP (bordered cells, no fill) ──
  const kpis=isIndividual?[
    {label:pdfT("pdf_kpi_grade","Grade"),val:a.grade,color:T.ACCENT},
    {label:pdfT("pdf_kpi_met_target","Met Target"),val:a.overallAvg>=s.passThreshold?pdfT("pdf_val_yes","Yes"):pdfT("pdf_val_not_yet","Not Yet"),color:a.overallAvg>=s.passThreshold?T.GOOD:T.WARN},
    {label:pdfT("pdf_trend","Trend"),val:a.trend==="improving"?pdfT("pdf_val_up","UP"):a.trend==="declining"?pdfT("pdf_val_down","DOWN"):pdfT("pdf_val_stable","STABLE"),color:a.trend==="improving"?T.GOOD:a.trend==="declining"?T.DANGER:T.INK_SOFT},
    {label:pdfT("pdf_kpi_absences","Absences"),val:a.totalAbsent||0,color:a.totalAbsent>=s.absentAlert?T.DANGER:T.INK_SOFT},
  ]:[
    {label:pdfT("pdf_kpi_rank","Rank"),val:"#"+a.rank,color:T.ACCENT},
    {label:pdfT("pdf_kpi_percentile","Percentile"),val:a.percentile+"th",color:T.GOOD},
    {label:pdfT("pdf_trend","Trend"),val:a.trend==="improving"?pdfT("pdf_val_up","UP"):a.trend==="declining"?pdfT("pdf_val_down","DOWN"):pdfT("pdf_val_stable","STABLE"),color:a.trend==="improving"?T.GOOD:a.trend==="declining"?T.DANGER:T.INK_SOFT},
    {label:pdfT("pdf_kpi_absences","Absences"),val:a.totalAbsent||0,color:a.totalAbsent>=s.absentAlert?T.DANGER:T.INK_SOFT},
  ];
  const kW=(W-2*M)/4;
  kpis.forEach((k,i)=>{
    const kx=M+i*kW;
    doc.setDrawColor(...T.LINE);doc.setLineWidth(0.7*0.352778);doc.roundedRect(kx,y,kW-2,15,1.5,1.5);
    doc.setFont("helvetica","normal");doc.setFontSize(6.8);doc.setTextColor(...T.INK_SOFT);
    doc.text(k.label,kx+(kW-2)/2,y+5.5,{align:"center"});
    doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(...k.color);
    doc.text(String(k.val),kx+(kW-2)/2,y+11.5,{align:"center"});
  });
  y+=21;

  // ── MODULE SPACING — one constant used between every section on this
  //    page (subject performance / test scores / flags), so gaps read as
  //    a deliberate rhythm instead of the mismatched 2mm/7mm/10mm gaps
  //    each section used to hardcode individually.
  const MODULE_GAP=7;

  // ── SUBJECT PERFORMANCE (outline track, coloured fill = the data) ──
  doc.setFont("helvetica","bold");doc.setFontSize(9.5);doc.setTextColor(...T.INK);
  doc.text(pdfT("pdf_subject_performance","Subject Performance").toUpperCase(),M,y);
  pdfRule(doc,M,y+1.5,W-M,1.2,T.INK);
  y+=6;
  const subjects=Object.entries(a.subjectAvgs||{});
  // labelW + barW used to fill the FULL remaining width, then the "avg%"
  // text was drawn 2mm past the end of that — i.e. past the right content
  // margin (and sometimes past the frame itself for 3-digit-safe widths).
  // percentColW reserves real space for that text and it's now drawn
  // right-aligned to the margin, so it can never run past the boundary
  // no matter how wide the number is.
  // barH cut from 5mm to 3.2mm — the track was thicker than it needed to
  // be to read as a bar; thinner tracks read just as clearly and use less
  // ink/toner across the coloured fill, which is the part that's printed
  // solid on every copy.
  const percentColW=14,barW=W-2*M-42-percentColW,barH=1.6,labelW=42;
  subjects.forEach(([sub,avg])=>{
    doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(...T.INK_SOFT);
    doc.text(fitText(doc,sub,labelW-4),M,y+4);
    doc.setDrawColor(...T.LINE);doc.setLineWidth(0.5*0.352778);doc.roundedRect(M+labelW,y,barW,barH,0.8,0.8);
    const barColor=avg>=80?T.GOOD:avg>=(s.passThreshold||35)?T.ACCENT:T.DANGER;
    doc.setFillColor(...barColor);doc.roundedRect(M+labelW,y,barW*Math.min(1,avg/100),barH,0.8,0.8,"F");
    doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(...barColor);
    doc.text(avg+"%",W-M,y+4,{align:"right"});
    y+=8;
  });
  y+=MODULE_GAP;

  // ── ALL TEST SCORES (hairline rows, no repeated Class Avg row, no
  //    legend text — colour-coding is limited to red-for-below-threshold
  //    so it doesn't need a legend to be understood at a glance) ──
  if(testsShown.length&&s.subjects&&s.subjects.length){
    doc.setFont("helvetica","bold");doc.setFontSize(9.5);doc.setTextColor(...T.INK);
    doc.text(pdfT("pdf_all_test_scores","All Test Scores").toUpperCase(),M,y);
    pdfRule(doc,M,y+1.5,W-M,1.2,T.INK);
    y+=6;
    const firstColW=32,avgColW=15,totalColW=20;
    // Per-subject columns get squeezed as s.subjects grows (colW shrinks
    // toward 0, marks like "100/100" start overlapping). MIN_SUBJECT_COLW
    // is the floor at which that text still fits at the smallest readable
    // font (6pt). Below it — same fallback pattern as testsHiddenCount
    // above — drop the per-subject columns entirely and show Test/Total/
    // Avg only, with a one-line note pointing to the Dashboard for the
    // full per-subject breakdown, rather than silently overlapping text.
    const MIN_SUBJECT_COLW=9;
    const colW=(W-2*M-firstColW-avgColW-totalColW)/s.subjects.length;
    const showSubjectCols=colW>=MIN_SUBJECT_COLW;
    const rowFontSize=colW>=13?7.4:6.2; // shrink one step before falling back entirely
    doc.setFont("helvetica","bold");doc.setFontSize(7.2);doc.setTextColor(...T.INK);
    doc.text(pdfT("pdf_col_test","Test"),M,y);
    if(showSubjectCols)s.subjects.forEach((sub,i)=>{doc.text(fitText(doc,sub,colW-2),M+firstColW+i*colW,y);});
    doc.text(pdfT("pdf_col_total","Total"),W-M-avgColW-totalColW+2,y);
    doc.text(pdfT("pdf_col_avg","Avg"),W-M-avgColW+2,y);
    y+=1.5;
    pdfRule(doc,M,y,W-M,1.4,T.INK);
    y+=4.5;
    testsShown.forEach((t,ti)=>{
      const td=st.testData&&st.testData[t.name]||{marks:{}};
      doc.setFont("helvetica","normal");doc.setFontSize(7.4);doc.setTextColor(...T.INK);
      doc.text(fitText(doc,t.name,firstColW-3),M,y);
      let sumRaw=0,sumMax=0;
      s.subjects.forEach((sub,i)=>{
        const raw=td.marks?td.marks[sub]:undefined;
        const mx=(t.maxMarks&&t.maxMarks[sub])||100;
        if(raw===undefined||raw===null||raw===""){
          if(showSubjectCols){const cx=M+firstColW+i*colW;doc.setTextColor(...T.LINE);doc.setFontSize(rowFontSize);doc.text("—",cx+colW/2,y,{align:"center"});}
        }else{
          sumRaw+=parseFloat(raw)||0;sumMax+=mx;
          if(showSubjectCols){
            const cx=M+firstColW+i*colW;
            const pctv=Math.min(100,(parseFloat(raw)||0)/mx*100);
            const cc=pctv<(s.passThreshold||35)?T.DANGER:T.INK;
            doc.setTextColor(...cc);doc.setFont("helvetica",pctv<(s.passThreshold||35)?"bold":"normal");doc.setFontSize(rowFontSize);
            doc.text(raw+"/"+mx,cx+colW/2,y,{align:"center"});
          }
        }
      });
      doc.setFont("helvetica","bold");doc.setFontSize(7.4);doc.setTextColor(...T.INK);
      doc.text(fitText(doc,sumMax>0?sumRaw+"/"+sumMax:"—",totalColW-4),W-M-avgColW-totalColW+2,y);
      const tavg=a.testAvgs[allTests.indexOf(t)];
      doc.setFont("helvetica","bold");doc.setFontSize(7.4);
      doc.setTextColor(...(tavg===null?T.LINE:tavg<(s.passThreshold||35)?T.DANGER:T.INK));
      doc.text(tavg!==null?tavg+"%":"—",W-M-avgColW+2,y);
      y+=5.4;
      if(ti<testsShown.length-1)pdfRule(doc,M,y-2,W-M,0.6,T.LINE);
    });
    pdfRule(doc,M,y-1.5,W-M,1,T.INK);
    y+=3;
    if(!showSubjectCols){
      doc.setFont("helvetica","italic");doc.setFontSize(6.6);doc.setTextColor(...T.INK_SOFT);
      doc.text(pdfT("pdf_subjects_too_many_note","Per-subject marks not shown ({{n}} subjects) — full breakdown on Dashboard",{n:s.subjects.length}),M,y);
      y+=4.5;
    }
    if(testsHiddenCount>0){
      doc.setFont("helvetica","italic");doc.setFontSize(6.6);doc.setTextColor(...T.INK_SOFT);
      doc.text(pdfT("pdf_earlier_tests_note","+ {{n}} earlier test(s) — full history on Dashboard",{n:testsHiddenCount}),M,y);
      y+=4.5;
    }
    // Class-position sentence — kept, it's one line and directly answers
    // "where does my child stand", but the per-test Class Avg row that
    // used to repeat under every single row is gone (that alone used to
    // roughly double this table's height for no reading-comprehension
    // gain over one summary line here).
    const studentsForClassAvg=(!isIndividual&&APP.students&&APP.students.length>1)?APP.students:null;
    if(studentsForClassAvg){
      const classAvgAll=(()=>{const vals=studentsForClassAvg.map(s2=>s2.analysis&&s2.analysis.overallAvg).filter(v=>v!==undefined&&v!==null);return vals.length?Math.round(vals.reduce((x,y2)=>x+y2,0)/vals.length):null;})();
      doc.setFont("helvetica","normal");doc.setFontSize(7.6);doc.setTextColor(...T.INK_SOFT);
      const line=studentsForClassAvg.length>=12
        ?st.name.split(" ")[0]+" ranks #"+a.rank+" of "+studentsForClassAvg.length+" ("+a.percentile+"th percentile)."
        :st.name.split(" ")[0]+" ranks #"+a.rank+" of "+studentsForClassAvg.length+(classAvgAll!==null?", "+Math.abs(a.overallAvg-classAvgAll)+" pts "+(a.overallAvg>=classAvgAll?"above":"below")+" the class average of "+classAvgAll+"%.":".");
      doc.text(line,M,y,{maxWidth:W-2*M});
      y+=5.5;
    }
    y+=2;
  }
  y+=MODULE_GAP-2;

  // ── PROGRESS TREND (re-added on request — was dropped in the Aug 2026
  //    one-page redesign on the reasoning that it duplicated "All Test
  //    Scores" above it. Drawn with the same ink-line vector style as the
  //    rest of this report (hairline grid + accent-coloured line/points)
  //    rather than embedding a Chart.js canvas image — keeps the report
  //    fully vector (crisp at any print size, no offscreen-canvas timing
  //    to get right) and matches the report's existing look. Skipped
  //    entirely when there are fewer than 2 tests with a valid average —
  //    same threshold the in-app Dashboard trend chart uses, since a
  //    single point can't show a trend. ──
  const trendVals=testsShown.map(t=>a.testAvgs[allTests.indexOf(t)]);
  const validTrendCount=trendVals.filter(v=>v!==null&&v!==undefined).length;
  // Space guard: this report is deliberately capped to one A4 page (no
  // addPage() anywhere in this function — see the top-of-function note),
  // and everything above here (Subject Performance + All Test Scores) is
  // variable-height depending on how many subjects/tests the class has.
  // Same fallback philosophy as MAX_TESTS_SHOWN/showSubjectCols above:
  // rather than silently drawing the chart past the footer on a
  // subject/test-heavy file, skip it and say so in one line once there
  // genuinely isn't ~38mm of room left before the footer.
  const FOOTER_Y=H-12;
  const hasRoomForTrend=(y+38)<(FOOTER_Y-4);
  if(validTrendCount>=2&&hasRoomForTrend){
    doc.setFont("helvetica","bold");doc.setFontSize(9.5);doc.setTextColor(...T.INK);
    doc.text(pdfT("pdf_progress_trend","Progress Trend").toUpperCase(),M,y);
    pdfRule(doc,M,y+1.5,W-M,1.2,T.INK);
    y+=6;
    const chartH=24,chartTop=y,chartBottom=y+chartH;
    const labelColW=9; // room for the 0/50/100 axis labels on the left
    const chartLeft=M+labelColW,chartRight=W-M,chartW=chartRight-chartLeft;
    // Gridlines at 0/50/100%, with their labels — same three-line minimal
    // axis the Subject Performance bars imply via their track, just made
    // explicit here since a line chart needs a vertical scale to read.
    [0,50,100].forEach(pctLine=>{
      const gy=chartBottom-(pctLine/100)*chartH;
      doc.setDrawColor(...T.LINE);doc.setLineWidth(0.3*0.352778);doc.line(chartLeft,gy,chartRight,gy);
      doc.setFont("helvetica","normal");doc.setFontSize(6);doc.setTextColor(...T.INK_SOFT);
      doc.text(String(pctLine),M,gy+1,{align:"left"});
    });
    // Point x-positions spread evenly across chartW — same spacing Chart.js
    // uses for a category axis with one point per test.
    const n=testsShown.length;
    const px=(i)=>n>1?chartLeft+(i/(n-1))*chartW:chartLeft+chartW/2;
    const py=(v)=>chartBottom-(Math.max(0,Math.min(100,v))/100)*chartH;
    doc.setDrawColor(...T.ACCENT);doc.setLineWidth(0.8*0.352778);
    for(let i=0;i<n-1;i++){
      const v1=trendVals[i],v2=trendVals[i+1];
      if(v1===null||v1===undefined||v2===null||v2===undefined)continue; // gap across a missing test, never interpolated through it
      doc.line(px(i),py(v1),px(i+1),py(v2));
    }
    trendVals.forEach((v,i)=>{
      if(v===null||v===undefined)return;
      doc.setFillColor(...T.WHITE);doc.setDrawColor(...T.ACCENT);doc.setLineWidth(0.6*0.352778);
      doc.circle(px(i),py(v),1.1,"FD");
    });
    y=chartBottom+3.5;
    // X-axis labels — same fitText truncation used for test names in the
    // All Test Scores table above, so a long test name never overlaps its
    // neighbour even with many points crammed into one page width.
    const labelSlotW=chartW/n;
    doc.setFont("helvetica","normal");doc.setFontSize(6);doc.setTextColor(...T.INK_SOFT);
    testsShown.forEach((t,i)=>{
      doc.text(fitText(doc,t.name,labelSlotW-2),px(i),y,{align:"center"});
    });
    y+=MODULE_GAP-1;
  } else if(validTrendCount>=2&&!hasRoomForTrend){
    doc.setFont("helvetica","italic");doc.setFontSize(6.6);doc.setTextColor(...T.INK_SOFT);
    doc.text(pdfT("pdf_trend_chart_omitted","Progress trend chart omitted (page full) — full history on Dashboard"),M,y);
    y+=4.5;
  }

  // Teacher Remarks section removed (per Aug 2026 review — the remarks
  // line was one teacher's note repeated on every keepsake copy; that
  // stays available in-app on the Dashboard). Progress Trend was removed
  // in the same pass but has since been re-added above per request.

  // Flags/Alerts section removed from the student keepsake report (per
  // Aug 2026 review — chip labels like "Burnout Risk" read as alarming on
  // a printed parent-facing copy without the in-app context to explain
  // them; the same flag data stays visible on the in-app Dashboard and in
  // the Teacher/Management reports, where the audience can act on it).

  // ── FOOTER (shared stampFooterAllPages — same rule/text layout as
  //    Teacher/Management/Certificate, just inset to M/H-12 instead of
  //    8/H-4 so it sits inside this report's decorative outer frame) ──
  const footerLabel=isIndividual?pdfT("pdf_confidential_personal","Personal record — not for redistribution"):pdfT("pdf_confidential_parent","CONFIDENTIAL — For parent/guardian only");
  stampFooterAllPages(doc,footerLabel,M,H-12);
}
function buildTeacherPDF(doc){
  const s=APP.setup,W=210,H=297;
  const T=PDF_THEME;
  const total=APP.students.length||1;
  const atRisk=APP.students.filter(st=>st.flags&&st.flags.some(f=>f.type==="at-risk")).length;
  const improving=APP.students.filter(st=>st.analysis&&st.analysis.trend==="improving").length;
  const declining=APP.students.filter(st=>st.analysis&&st.analysis.trend==="declining").length;
  const classAvg=Math.round(APP.students.reduce((a,st)=>a+(st.analysis&&st.analysis.overallAvg||0),0)/total);
  const passRate=Math.round(APP.students.filter(st=>st.analysis&&st.analysis.overallAvg>=(s.passThreshold||35)).length/total*100);

  // ── HEADER (restyled: rule underneath, no filled bar — content/
  //    components unchanged per Aug 2026 review: teacher copies print in
  //    small quantities, so page-count wasn't the constraint here, only
  //    the ink-heavy fills were) ──
  doc.setTextColor(...T.ACCENT);doc.setFont("helvetica","bold");doc.setFontSize(12);
  doc.text("Student Insight",10,10);
  doc.setTextColor(...T.INK_SOFT);doc.setFont("helvetica","normal");doc.setFontSize(8.5);
  doc.text([s.instName,s.className+(s.section?" "+s.section:""),s.year].filter(Boolean).join(" · "),W/2,10,{align:"center"});
  doc.text(pdfT("pdf_teacher_report_title","Teacher Report")+"  |  "+new Date().toLocaleDateString(bcp47TagFor(window.SR_LANG)),W-10,10,{align:"right"});
  let y=15;
  pdfRule(doc,8,y,W-8,1.6,T.INK);
  y+=11;

  // ── KPI ROW (compact, bordered cells, no fill) ──
  const kpis=[
    {l:pdfT("pdf_kpi_students","Students"),v:total,c:T.ACCENT},{l:pdfT("pdf_class_avg","Class Avg"),v:classAvg+"%",c:classAvg>=60?T.GOOD:T.DANGER},
    {l:pdfT("pdf_kpi_pass_rate","Pass Rate"),v:passRate+"%",c:passRate>=60?T.GOOD:T.DANGER},{l:pdfT("pdf_kpi_at_risk","At Risk"),v:atRisk,c:atRisk>0?T.DANGER:T.GOOD},
    {l:pdfT("pdf_kpi_improving","Improving"),v:improving,c:T.GOOD},{l:pdfT("pdf_kpi_declining","Declining"),v:declining,c:declining>0?T.WARN:T.GOOD},
  ];
  const tW=(W-16)/6;
  kpis.forEach((k,i)=>{
    const tx=8+i*tW;
    doc.setDrawColor(...T.LINE);doc.setLineWidth(0.7*0.352778);doc.roundedRect(tx,y,tW-1,14,1,1);
    doc.setFont("helvetica","normal");doc.setFontSize(6);doc.setTextColor(...T.INK_SOFT);doc.text(k.l,tx+(tW-1)/2,y+6,{align:"center"});
    doc.setFont("helvetica","bold");doc.setFontSize(10);doc.setTextColor(...k.c);doc.text(String(k.v),tx+(tW-1)/2,y+12,{align:"center"});
  });
  y+=19;

  // ── SUBJECT BAR CHART (outline track, coloured fill = the data) ──
  if(s.subjects&&s.subjects.length){
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...T.INK);doc.text(pdfT("pdf_subject_averages","Subject Averages"),10,y);y+=4;
    const subData=s.subjects.map(sub=>{
      const vals=APP.students.map(st=>st.analysis&&st.analysis.subjectAvgs&&st.analysis.subjectAvgs[sub]).filter(v=>v!=null&&!isNaN(v));
      return{sub,avg:vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):0};
    });
    // Same fix as the student report: reserve real space for the "avg%"
    // label and right-align it to the margin instead of drawing it 2mm
    // past the end of a bar that already spans the full remaining width.
    // Same fix as the student report: reserve real space for the "avg%"
    // label and right-align it to the margin instead of drawing it 2mm
    // past the end of a bar that already spans the full remaining width.
    // bH cut 5→3.2 to match the student report's thinner track (was a
    // heavier bar than the data needed, more filled ink per copy).
    const percentColW=14,bW=W-70-percentColW,bH=1.6,lW=46;
    subData.forEach(({sub,avg})=>{
      doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(...T.INK_SOFT);
      doc.text(fitText(doc,sub,lW-4),10,y+4);
      doc.setDrawColor(...T.LINE);doc.setLineWidth(0.5*0.352778);doc.roundedRect(lW,y,bW,bH,0.8,0.8);
      const bc=avg>=75?T.GOOD:avg>=(s.passThreshold||35)?T.ACCENT:T.DANGER;
      doc.setFillColor(...bc);doc.roundedRect(lW,y,bW*(avg/100),bH,0.8,0.8,"F");
      doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(...bc);doc.text(avg+"%",W-10,y+4,{align:"right"});
      y+=7.5;
    });
    y+=3;
  }

  // ── RANK TABLE (bold rule as header, hairline rows — no fills) ──
  doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...T.INK);doc.text(pdfT("pdf_student_rankings","Student Rankings"),10,y);y+=4;
  const cols=[12,50,16,14,18,18,60];
  const heads=["#",pdfT("pdf_col_name","Name"),pdfT("pdf_col_avg","Avg"),pdfT("pdf_col_grade","Grade"),pdfT("pdf_trend","Trend"),pdfT("pdf_col_ew","EW"),pdfT("pdf_col_flags","Flags")];
  const drawRankHeader=()=>{
    let hx=10;
    heads.forEach((h,i)=>{doc.setFont("helvetica","bold");doc.setFontSize(6.5);doc.setTextColor(...T.INK);doc.text(h,hx,y+4.2);hx+=cols[i];});
    y+=5.5;
    pdfRule(doc,8,y,W-8,1.4,T.INK);
    y+=2.5;
  };
  drawRankHeader();

  APP.students.forEach((st,idx)=>{
    if(y>283){doc.addPage();y=10;drawRankHeader();}
    const a=st.analysis||{};
    const tc=a.trend==="improving"?T.GOOD:a.trend==="declining"?T.DANGER:T.INK_SOFT;
    const ac=a.overallAvg>=80?T.GOOD:a.overallAvg>=(s.passThreshold||35)?T.ACCENT:T.DANGER;
    const ewc=(a.earlyWarningScore||0)>=50?T.DANGER:(a.earlyWarningScore||0)>=25?T.WARN:T.GOOD;
    const fStr=st.flags&&st.flags.length?st.flags.map(f=>f.label).join(", "):"";
    let cx=10;
    doc.setFont("helvetica","bold");doc.setFontSize(7);const fitName=fitText(doc,st.name,cols[1]-3);
    doc.setFont("helvetica","normal");doc.setFontSize(7);const fitFlags=fitText(doc,fStr,cols[6]-3);
    [[String(a.rank||""),ac],[fitName,T.INK],[a.overallAvg+"%",ac],[a.grade||"",ac],
     [a.trend==="improving"?pdfT("pdf_val_up_cap","Up"):a.trend==="declining"?pdfT("pdf_val_down_cap","Down"):pdfT("pdf_val_stable_cap","Stable"),tc],[String(a.earlyWarningScore||0),ewc],
     [fitFlags,T.INK_SOFT]
    ].forEach(([v,color],i)=>{
      doc.setFont("helvetica",i===1?"bold":"normal");doc.setFontSize(7);doc.setTextColor(...color);
      doc.text(String(v||"—"),cx,y+4);cx+=cols[i];
    });
    pdfRule(doc,8,y+5.5,W-8,0.6,T.LINE);
    y+=6.5;
  });

  // ── STUDENTS NEEDING SUPPORT (proper 2-col table — Name | Flags — with
  //    a header row and hairline rules between students, instead of the
  //    old "Name — flag1, flag2" prose lines wrapped inside a red box.
  //    Same table conventions as Student Rankings above: bold header,
  //    1.4pt rule under it, 0.6pt hairline between rows.) ──
  const flagged=APP.students.filter(st=>st.flags&&st.flags.some(f=>["at-risk","burnout","plateau"].includes(f.type)));
  if(flagged.length){
    const snsNameW=55;
    if(y>260){doc.addPage();y=10;}
    y+=4;
    doc.setFont("helvetica","bold");doc.setFontSize(8.5);doc.setTextColor(...T.DANGER);
    doc.text(pdfT("pdf_students_needing_support","Students Needing Support"),10,y);
    y+=5;
    doc.setFont("helvetica","bold");doc.setFontSize(6.8);doc.setTextColor(...T.INK);
    doc.text(pdfT("pdf_col_name","Name"),10,y);
    doc.text(pdfT("pdf_col_flags","Flags"),10+snsNameW,y);
    y+=2;
    pdfRule(doc,8,y,W-8,1.2,T.INK);
    y+=4;
    flagged.forEach(st=>{
      const flagLine=st.flags.map(f=>f.label).join(", ");
      const wrapped=doc.splitTextToSize(flagLine,W-18-snsNameW);
      if(y+wrapped.length*4>282){doc.addPage();y=20;}
      doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(...T.INK);
      doc.text(fitText(doc,st.name,snsNameW-4),10,y+3.5);
      doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(...T.DANGER);
      doc.text(wrapped,10+snsNameW,y+3.5);
      y+=Math.max(6,wrapped.length*4)+1.5;
      pdfRule(doc,8,y-1.5,W-8,0.6,T.LINE);
    });
    y+=4;
  }

  // ── SUBJECT GAPS (outline rows instead of tinted-fill rows) ──
  const subjectWeakness=(APP.classStats&&APP.classStats.subjectWeakness)||[];
  if(subjectWeakness.length){
    if(y>255){doc.addPage();y=20;}
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...T.INK);doc.text(pdfT("pdf_subject_gaps","Subject Gaps"),10,y);y+=5;
    doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(...T.INK_SOFT);
    doc.text(pdfT("pdf_subject_gaps_note","Sorted by % of class below the pass threshold in that subject."),10,y);y+=5;
    subjectWeakness.slice(0,6).forEach(sw=>{
      if(y>272){doc.addPage();y=20;}
      const wc=sw.pctBelow>=40?T.DANGER:sw.pctBelow>=20?T.WARN:T.GOOD;
      doc.setDrawColor(...wc);doc.setLineWidth(1*0.352778);doc.roundedRect(10,y,W-20,7,1,1);
      doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(...wc);
      doc.text(sw.subject,13,y+4.8);
      doc.text(pdfT("pdf_subject_gap_stat","{{pct}}% below pass  ·  class avg {{avg}}%",{pct:sw.pctBelow,avg:sw.avgClass}),W-13,y+4.8,{align:"right"});
      y+=9;
    });
    y+=3;
  }

  // ── TOP PERFORMERS (outline rows instead of tinted-fill rows) ──
  const teacherTop5=[...APP.students]
    .sort((x,y2)=>(x.analysis&&x.analysis.rank||999)-(y2.analysis&&y2.analysis.rank||999)).slice(0,5);
  if(teacherTop5.some(st=>st.analysis&&st.analysis.rank<=3)){
    if(y>260){doc.addPage();y=20;}
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...T.INK);doc.text(pdfT("pdf_top_performers","Top Performers"),10,y);y+=5;
    teacherTop5.forEach(st=>{
      if(y>278){doc.addPage();y=20;}
      const a=st.analysis||{};
      doc.setDrawColor(...T.GOOD);doc.setLineWidth(1*0.352778);doc.roundedRect(10,y,W-20,6,1,1);
      doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(...T.INK);
      doc.text(fitText(doc,"#"+a.rank+" "+st.name,W-45),13,y+4.2);
      doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(...T.GOOD);
      doc.text(a.overallAvg+"%",W-13,y+4.2,{align:"right"});
      y+=7.5;
    });
    y+=3;
  }

  // ── TEST COMPARISON (outline track, coloured fill = the data) ──
  if(s.tests&&s.tests.length>=2){
    if(y>250){doc.addPage();y=20;}
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...T.INK);doc.text(pdfT("pdf_test_comparison","Test Comparison — Class Average"),10,y);y+=5;
    const tcPercentColW=14,tcBarW=W-70-tcPercentColW,tcBarH=1.6,tcLabelW=46;
    s.tests.forEach(t=>{
      if(y>278){doc.addPage();y=20;}
      const vals=APP.students.map(st=>{const idx=s.tests.indexOf(t);return st.analysis&&st.analysis.testAvgs&&st.analysis.testAvgs[idx];}).filter(v=>v!==null&&v!==undefined);
      const avg=vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
      doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(...T.INK_SOFT);
      doc.text(fitText(doc,t.name,tcLabelW-4),10,y+4);
      doc.setDrawColor(...T.LINE);doc.setLineWidth(0.5*0.352778);doc.roundedRect(tcLabelW,y,tcBarW,tcBarH,0.8,0.8);
      if(avg!==null){
        const tc2=avg>=75?T.GOOD:avg>=(s.passThreshold||35)?T.ACCENT:T.DANGER;
        doc.setFillColor(...tc2);doc.roundedRect(tcLabelW,y,tcBarW*(avg/100),tcBarH,0.8,0.8,"F");
        doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(...tc2);doc.text(avg+"%",W-10,y+4,{align:"right"});
      }
      y+=7.5;
    });
    y+=3;
  }

  // ── GENDER ANALYSIS (Task 2b: only if statistically meaningful) ──
  if(APP.genderAnalysis&&APP.genderAnalysis.available){
    const ga=APP.genderAnalysis;
    if(y>240){doc.addPage();y=20;}
    const narrative=ga.leadGroup?
      pdfT("pdf_gender_lead_narrative","{{lead}} are outperforming {{other}} overall by {{gap}} points this term.",{lead:pdfT(ga.leadGroup==="Female"?"pdf_gender_girls":"pdf_gender_boys",ga.leadGroup==="Female"?"Girls":"Boys"),other:pdfT(ga.leadGroup==="Female"?"pdf_gender_boys":"pdf_gender_girls",ga.leadGroup==="Female"?"Boys":"Girls"),gap:ga.overallGap})+
      (ga.maxGapSubject?pdfT("pdf_gender_gap_largest"," The gap is largest in {{subject}} ({{value}} pts).",{subject:ga.maxGapSubject,value:ga.maxGapValue}):"")
      :pdfT("pdf_gender_even","Overall performance is essentially even between the two groups this term.");
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...T.INK);doc.text(pdfT("pdf_gender_analysis","Gender Analysis"),10,y);y+=5;
    doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(...T.INK_SOFT);
    const gLines=doc.splitTextToSize(narrative,W-20);
    doc.text(gLines,10,y);y+=gLines.length*4.2+5;
  }

  // ── STUDENT REMARKS SUMMARY (Task 2b: only if any student has a remark) ──
  // Given a header row + column rule + hairline row separators so the
  // "Student · Test" / "Remark" columns read as a table instead of two
  // loosely-aligned text runs.
  const remarkedStudents=APP.students.map(st=>({st,entries:(s.tests||[]).map(t=>({test:t.name,remark:(st.testData[t.name]||{}).remark})).filter(e=>e.remark)})).filter(x=>x.entries.length);
  if(remarkedStudents.length){
    const remarkColW=60;
    if(y>245){doc.addPage();y=20;}
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...T.INK);doc.text(pdfT("pdf_teacher_remarks_ptm","Teacher Remarks — Notes for PTM"),10,y);y+=5;
    doc.setFont("helvetica","bold");doc.setFontSize(6.8);doc.setTextColor(...T.INK);
    doc.text(pdfT("pdf_col_student_test","Student · Test"),10,y);
    doc.text(pdfT("pdf_col_remark","Remark"),72,y);
    y+=2;
    pdfRule(doc,8,y,W-8,1.2,T.INK);
    y+=4;
    remarkedStudents.forEach(({st,entries})=>{
      entries.forEach(e=>{
        const rLines=doc.splitTextToSize(e.remark,W-80);
        if(y+rLines.length*4>278){doc.addPage();y=20;}
        doc.setFont("helvetica","bold");doc.setFontSize(7);doc.setTextColor(...T.ACCENT);
        doc.text(fitText(doc,st.name+" · "+e.test,remarkColW),10,y+3);
        doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(...T.INK);
        doc.text(rLines,72,y+3);
        y+=Math.max(6,rLines.length*4)+1.5;
        pdfRule(doc,8,y-1.5,W-8,0.6,T.LINE);
      });
    });
    y+=3;
  }

  // ── FOOTER (stamped on every page) ──
  stampFooterAllPages(doc,pdfT("pdf_confidential_teacher","TEACHER CONFIDENTIAL"));
}
function buildMgmtPDF(doc){
  const s=APP.setup,sts=APP.students,W=210,H=297;
  const T=PDF_THEME;
  const n=sts.length||1;
  const classAvg=Math.round(sts.reduce((a,st)=>a+(st.analysis&&st.analysis.overallAvg||0),0)/n);
  const passRate=Math.round(sts.filter(st=>st.analysis&&st.analysis.overallAvg>=(s.passThreshold||35)).length/n*100);
  const atRisk=sts.filter(st=>st.flags&&st.flags.some(f=>f.type==="at-risk")).length;
  const improving=sts.filter(st=>st.analysis&&st.analysis.trend==="improving").length;
  const declining=sts.filter(st=>st.analysis&&st.analysis.trend==="declining").length;
  const topper=sts[0];

  // ── HEADER (restyled: rule underneath, no filled bars — content/
  //    components unchanged per Aug 2026 review: management copies print
  //    in small quantities, only the ink-heavy fills were the issue) ──
  doc.setTextColor(...T.ACCENT);doc.setFont("helvetica","bold");doc.setFontSize(12);
  doc.text("Student Insight",10,10);
  doc.setTextColor(...T.INK_SOFT);doc.setFont("helvetica","normal");doc.setFontSize(8.5);
  doc.text([s.instName,s.className+(s.section?" "+s.section:""),s.year].filter(Boolean).join("   |   "),10,16);
  doc.text(pdfT("pdf_mgmt_report_title","Management Report")+"   |   "+new Date().toLocaleDateString(bcp47TagFor(window.SR_LANG)),W-10,16,{align:"right"});
  let y=20;
  pdfRule(doc,8,y,W-8,1.6,T.INK);
  y+=10;

  // ── EXECUTIVE KPI TILES (2 rows of 3, bordered, no fill) ──
  const kpis=[
    {l:pdfT("pdf_kpi_total_students","Total Students"),v:n,sub:"",c:T.ACCENT},
    {l:pdfT("pdf_kpi_class_average","Class Average"),v:classAvg+"%",sub:"",c:classAvg>=60?T.GOOD:T.DANGER},
    {l:pdfT("pdf_kpi_pass_rate","Pass Rate"),v:passRate+"%",sub:sts.filter(st=>st.analysis&&st.analysis.overallAvg>=(s.passThreshold||35)).length+" "+pdfT("pdf_students_lc","students"),c:passRate>=60?T.GOOD:T.DANGER},
    {l:pdfT("pdf_kpi_at_risk","At Risk"),v:atRisk,sub:atRisk>0?pdfT("pdf_needs_attention","Needs attention"):pdfT("pdf_all_clear","All clear"),c:atRisk>0?T.DANGER:T.GOOD},
    {l:pdfT("pdf_kpi_improving","Improving"),v:improving,sub:Math.round(improving/n*100)+"% "+pdfT("pdf_of_class","of class"),c:T.GOOD},
    {l:pdfT("pdf_kpi_class_topper","Class Topper"),v:topper?topper.name.split(" ")[0]:"—",sub:topper?topper.analysis.overallAvg+"%":"",c:T.WARN},
  ];
  const tW=(W-20)/3;
  [[0,1,2],[3,4,5]].forEach((row,ri)=>{
    row.forEach((ki,ci)=>{
      const k=kpis[ki],tx=10+ci*tW,ty=y+ri*22;
      doc.setDrawColor(...T.LINE);doc.setLineWidth(0.7*0.352778);doc.roundedRect(tx,ty,tW-4,19,2,2);
      doc.setFont("helvetica","normal");doc.setFontSize(6.5);doc.setTextColor(...T.INK_SOFT);
      doc.text(k.l,tx+(tW-4)/2,ty+6,{align:"center"});
      doc.setFont("helvetica","bold");doc.setFontSize(12);doc.setTextColor(...k.c);
      doc.text(String(k.v),tx+(tW-4)/2,ty+13,{align:"center"});
      if(k.sub){doc.setFont("helvetica","normal");doc.setFontSize(6);doc.setTextColor(...T.INK_SOFT);doc.text(fitText(doc,k.sub,tW-6),tx+(tW-4)/2,ty+17,{align:"center"});}
    });
  });
  y+=48;

  // ── SUBJECT PERFORMANCE (horizontal outline-track bars — same style as
  //    Teacher/Student reports' "Subject Averages"/"Subject Performance":
  //    label left, outline track, coloured fill = the data, avg% right-
  //    aligned to the margin. Was a per-subject vertical column chart;
  //    switched so all three reports read the same way. ──
  if(s.subjects&&s.subjects.length){
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...T.INK);doc.text(pdfT("pdf_subject_perf_overview","Subject Performance Overview"),10,y);y+=5;
    const subData=s.subjects.map(sub=>{
      const vals=sts.map(st=>st.analysis&&st.analysis.subjectAvgs&&st.analysis.subjectAvgs[sub]).filter(v=>v!=null&&!isNaN(v));
      const avg=vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):0;
      const passing=vals.filter(v=>v>=(s.passThreshold||35)).length;
      return{sub,avg,passing,total:vals.length};
    });
    const percentColW=14,barW=W-20-46-percentColW,barH=1.6,labelW=46;
    subData.forEach(({sub,avg})=>{
      doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(...T.INK_SOFT);
      doc.text(fitText(doc,sub,labelW-4),10,y+4);
      doc.setDrawColor(...T.LINE);doc.setLineWidth(0.5*0.352778);doc.roundedRect(10+labelW,y,barW,barH,0.8,0.8);
      const bc=avg>=75?T.GOOD:avg>=(s.passThreshold||35)?T.ACCENT:T.DANGER;
      doc.setFillColor(...bc);doc.roundedRect(10+labelW,y,barW*Math.min(1,avg/100),barH,0.8,0.8,"F");
      doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(...bc);
      doc.text(avg+"%",W-10,y+4,{align:"right"});
      y+=7.5;
    });
    y+=3;
  }

  // ── TREND SUMMARY BOXES (outline, no tinted fill) ──
  const trendData=[
    {label:pdfT("pdf_consistently_improving","Consistently Improving"),count:improving,color:T.GOOD},
    {label:pdfT("pdf_consistently_declining","Consistently Declining"),count:declining,color:T.DANGER},
    {label:pdfT("pdf_at_risk_students","At-Risk Students"),count:atRisk,color:T.DANGER},
    {label:pdfT("pdf_stable_performance","Stable Performance"),count:n-improving-declining,color:T.ACCENT},
  ];
  const tbW=(W-20)/4;
  trendData.forEach(({label,count,color},i)=>{
    const tx=10+i*tbW;
    doc.setDrawColor(...color);doc.setLineWidth(1*0.352778);doc.roundedRect(tx,y,tbW-3,18,2,2);
    doc.setFont("helvetica","bold");doc.setFontSize(14);doc.setTextColor(...color);doc.text(String(count),tx+(tbW-3)/2,y+12,{align:"center"});
    doc.setFont("helvetica","normal");doc.setFontSize(6.5);doc.setTextColor(...T.INK_SOFT);doc.text(label,tx+(tbW-3)/2,y+17,{align:"center"});
  });
  y+=24;

  // ── TOP PERFORMERS / AT-RISK (outline rows instead of tinted-fill rows) ──
  const top3=(n>5)?sts.slice(0,Math.min(3,sts.length)):[];
  const bottom3=atRisk>0?[...sts].filter(st=>st.flags&&st.flags.some(f=>f.type==="at-risk")).slice(0,3):[];
  const halfW=(W-24)/2;

  if(top3.length||bottom3.length){
    if(top3.length){doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(...T.GOOD);doc.text(pdfT("pdf_top_performers","Top Performers"),10,y);}
    if(bottom3.length){doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(...T.DANGER);doc.text(pdfT("pdf_at_risk_students","At-Risk Students"),14+halfW,y);}
    y+=4;

    const maxRows=Math.max(top3.length,bottom3.length);
    for(let i=0;i<maxRows;i++){
      if(y>275){break;}
      const ts=top3[i],bs=bottom3[i];
      if(ts){
        const a=ts.analysis||{};
        doc.setDrawColor(...T.GOOD);doc.setLineWidth(0.8*0.352778);doc.roundedRect(10,y,halfW,7,1,1);
        doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(...T.INK);
        doc.text(fitText(doc,"#"+a.rank+" "+ts.name,halfW-22),13,y+5);
        doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(...T.GOOD);
        doc.text(a.overallAvg+"%",10+halfW-6,y+5,{align:"right"});
      }
      if(bs){
        const a=bs.analysis||{};
        doc.setDrawColor(...T.DANGER);doc.setLineWidth(0.8*0.352778);doc.roundedRect(14+halfW,y,halfW,7,1,1);
        doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(...T.INK);
        doc.text(fitText(doc,bs.name,halfW-22),17+halfW,y+5);
        doc.setFont("helvetica","bold");doc.setFontSize(8);doc.setTextColor(...T.DANGER);
        doc.text(a.overallAvg+"%",14+halfW+halfW-6,y+5,{align:"right"});
      }
      y+=8;
    }
    y+=4;
  }

  // ── GENDER PERFORMANCE ANALYSIS (outline panel instead of tinted fill) ──
  if(APP.genderAnalysis){
    const ga=APP.genderAnalysis;
    if(ga.available&&y<230){
      const labels=Object.keys(ga.groups);
      const narrative=ga.leadGroup?
        pdfT("pdf_gender_lead_narrative","{{lead}} are outperforming {{other}} overall by {{gap}} points this term.",{lead:pdfT(ga.leadGroup==="Female"?"pdf_gender_girls":"pdf_gender_boys",ga.leadGroup==="Female"?"Girls":"Boys"),other:pdfT(ga.leadGroup==="Female"?"pdf_gender_boys":"pdf_gender_girls",ga.leadGroup==="Female"?"Boys":"Girls"),gap:ga.overallGap})+
        (ga.maxGapSubject?pdfT("pdf_gender_gap_largest_led"," The gap is largest in {{subject}} ({{value}} pts, led by {{led}}).",{subject:ga.maxGapSubject,value:ga.maxGapValue,led:pdfT(ga.maxGapLead==="Female"?"pdf_gender_girls":"pdf_gender_boys",ga.maxGapLead==="Female"?"Girls":"Boys")}):"")
        :pdfT("pdf_gender_even","Overall performance is essentially even between the two groups this term.");
      doc.setFont("helvetica","normal");doc.setFontSize(8);
      const lines=doc.splitTextToSize(narrative,W-28);
      const panelH=20;
      const bh=10+panelH+lines.length*4.2+6;
      doc.setDrawColor(...T.ACCENT);doc.setLineWidth(1*0.352778);doc.roundedRect(8,y,W-16,bh,2,2);
      doc.setLineWidth(1.4*0.352778);doc.line(8,y,8,y+bh);
      doc.setFont("helvetica","bold");doc.setFontSize(8.5);doc.setTextColor(...T.ACCENT);doc.text(pdfT("pdf_gender_perf_analysis","Gender Performance Analysis"),14,y+6);
      const panelW=(W-32)/2;
      labels.forEach((label,i)=>{
        const g=ga.groups[label];
        const px=14+i*(panelW+4),py=y+10;
        const pc=label==="Female"?T.DANGER:T.ACCENT;
        doc.setDrawColor(...pc);doc.setLineWidth(0.8*0.352778);doc.roundedRect(px,py,panelW,panelH,1,1);
        doc.setFont("helvetica","bold");doc.setFontSize(7.5);doc.setTextColor(...pc);doc.text(label+" ("+g.count+")",px+4,py+6);
        doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(...T.INK);doc.text(g.avg+"%",px+4,py+13.5);
        doc.setFont("helvetica","normal");doc.setFontSize(6.5);doc.setTextColor(...T.INK_SOFT);doc.text(pdfT("pdf_pass_rate_prefix","Pass rate: {{rate}}%",{rate:g.passRate}),px+4,py+18);
      });
      doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(...T.INK);doc.text(lines,14,y+10+panelH+5);
      y+=bh+5;
    }
  }

  // ── COMPARE SECTIONS (bold rule as header, hairline rows) ──
  if(APP.compareMode&&APP.sectionComparison&&APP.sectionComparison.length){
    if(y>240){doc.addPage();y=20;}
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...T.INK);doc.text(pdfT("pdf_compare_sections","Compare Sections"),10,y);y+=5;
    const ccols=[50,16,18,18,18,40],cheads=[pdfT("pdf_col_section","Section"),"N",pdfT("pdf_col_avg","Avg"),pdfT("pdf_col_pass_pct","Pass%"),pdfT("pdf_col_at_risk_short","At-Risk"),pdfT("pdf_col_topper","Topper")];
    let ccx=10;
    cheads.forEach((h,i)=>{doc.setFont("helvetica","bold");doc.setFontSize(6.5);doc.setTextColor(...T.INK);doc.text(h,ccx,y+4.2);ccx+=ccols[i];});
    y+=5.5;
    pdfRule(doc,8,y,W-8,1.4,T.INK);
    y+=2.5;
    APP.sectionComparison.forEach((r)=>{
      if(y>282){doc.addPage();y=20;}
      ccx=10;
      [[fitText(doc,r.label,ccols[0]-3),T.INK],[String(r.n),T.INK_SOFT],[r.avg+"%",T.ACCENT],[r.passRate+"%",r.passRate>=60?T.GOOD:T.DANGER],[String(r.atRisk),r.atRisk>0?T.DANGER:T.GOOD],[fitText(doc,r.topperName,ccols[5]-3),T.INK_SOFT]]
        .forEach(([v,color],ci)=>{doc.setFont("helvetica",ci===0?"bold":"normal");doc.setFontSize(7);doc.setTextColor(...color);doc.text(String(v),ccx,y+4);ccx+=ccols[ci];});
      pdfRule(doc,8,y+5.5,W-8,0.6,T.LINE);
      y+=6.5;
    });
    y+=5;
  }

  // ── RECOMMENDATION BOX (outline, left rule instead of filled accent bar) ──
  if(y<265){
    const rec=atRisk>n*0.3?pdfT("pdf_rec_high_risk","High at-risk rate detected. Consider remedial sessions for flagged subjects."):improving>n*0.5?pdfT("pdf_rec_strong_trend","Strong positive trend across the class. Recognition programme recommended."):pdfT("pdf_rec_stable","Class performance is stable. Monitor declining students closely.");
    doc.setFont("helvetica","normal");doc.setFontSize(8);
    const lines=doc.splitTextToSize(pdfT("pdf_recommendation_prefix","Recommendation: {{rec}}",{rec:rec}),W-28);
    const bh=lines.length*4.5+10;
    doc.setDrawColor(...T.ACCENT);doc.setLineWidth(1*0.352778);doc.roundedRect(8,y,W-16,bh,2,2);
    doc.setLineWidth(1.4*0.352778);doc.line(8,y,8,y+bh);
    doc.setFont("helvetica","bold");doc.setFontSize(8.5);doc.setTextColor(...T.ACCENT);doc.text(pdfT("pdf_strategic_recommendation","Strategic Recommendation"),14,y+6);
    doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(...T.INK);doc.text(lines,14,y+12);
  }

  // ── FOOTER (stamped on every page) ──
  stampFooterAllPages(doc,pdfT("pdf_confidential_mgmt","MANAGEMENT CONFIDENTIAL"));
}


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { PDF_CHAPTER_RELEVANT_FLAG_TYPES, PDF_THEME, addPDFHeader, buildMgmtPDF, buildStudentPDF, buildTeacherPDF, chapterSuffixForFlag, fitText, generateAllPDFs, pdfRule, pdfT, sanitizePdfDoc, stampFooterAllPages };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window.PDF_CHAPTER_RELEVANT_FLAG_TYPES=PDF_CHAPTER_RELEVANT_FLAG_TYPES;window.PDF_THEME=PDF_THEME;window.addPDFHeader=addPDFHeader;window.buildMgmtPDF=buildMgmtPDF;window.buildStudentPDF=buildStudentPDF;window.buildTeacherPDF=buildTeacherPDF;window.chapterSuffixForFlag=chapterSuffixForFlag;window.fitText=fitText;window.generateAllPDFs=generateAllPDFs;window.pdfRule=pdfRule;window.pdfT=pdfT;window.sanitizePdfDoc=sanitizePdfDoc;window.stampFooterAllPages=stampFooterAllPages;}
