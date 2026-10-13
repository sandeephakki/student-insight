/* 
   EXPORT-UI — the Export-panel driver (generateAllPDFs): reads the export
   checkboxes, shows progress / toasts, loops the PDF builders and triggers
   the download. Split out of bal/export/export-pdf.js (2026-10-03) so the BAL
   file holds only jsPDF document builders (no page navigation / jQuery).
*/
import { toast } from '../../core/dom-helpers.js';
import { sleep } from '../../core/async-utils.js';
import { APP } from '../../core/app-state.js';
import { goStep } from '../../core/state-nav.js';
import { buildMgmtPDF, buildStudentPDF, buildTeacherPDF, pdfT, sanitizePdfDoc } from '../../bal/export/export-pdf.js';

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

export { generateAllPDFs };
if(typeof window!=='undefined'){window.generateAllPDFs=generateAllPDFs;}
