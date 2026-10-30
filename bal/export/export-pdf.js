import { weakestSubjectChapter } from '../common/bucket-rules.js';
import { bcp47TagFor, i18nLabel } from '../../core/render-i18n.js';
import { APP } from '../../core/app-state.js';

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

  // ADDITIVE (Smart Planner): width in mm of one string as it will actually be drawn at the CURRENT font/size - canvas-measured
  // for non-Latin text (jsPDF's own splitTextToSize measures those characters with Helvetica metrics, so lines overflow the page).
  // Returns null when it cannot measure (no canvas), so callers fall back to an estimate. Nothing else uses this.
  doc.measureTextMm=function(str){
    const t=String(str==null?"":str);
    if(!needsCanvasFallback(t))return doc.getTextWidth(t);
    try{
      const fontStack="'Noto Sans','Noto Sans Devanagari','Noto Sans Tamil','Noto Sans Bengali','Noto Sans Kannada','Noto Sans Malayalam','Noto Sans Telugu','Noto Sans Gujarati','Noto Sans Gurmukhi','Noto Sans Oriya','Noto Nastaliq Urdu','sans-serif'";
      const px=state.fontSize*4;const c=document.createElement("canvas").getContext("2d");
      const weight=state.fontStyle&&state.fontStyle.indexOf("bold")>=0?"bold ":"";const style=state.fontStyle&&state.fontStyle.indexOf("italic")>=0?"italic ":"";
      c.font=style+weight+px+"px "+fontStack;
      return c.measureText(t).width/(px/(state.fontSize*MM_PER_PT));
    }catch(e){return null;}
  };

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
    doc.text(pdfT("pdf_footer_tagline"," — Open Source  |  Privacy-First  |  Built by Sandeep Hakki"),textX+linkW,textY);
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
  const ch=weakestSubjectChapter(st);                 // subject-wise chapters: weakest subject's chapter (see bucket-rules.js)
  return ch?"  Ch: "+ch:"";
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

// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { PDF_CHAPTER_RELEVANT_FLAG_TYPES, PDF_THEME, addPDFHeader, chapterSuffixForFlag, fitText, pdfRule, pdfT, sanitizePdfDoc, stampFooterAllPages };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window.PDF_CHAPTER_RELEVANT_FLAG_TYPES=PDF_CHAPTER_RELEVANT_FLAG_TYPES;window.PDF_THEME=PDF_THEME;window.addPDFHeader=addPDFHeader;window.chapterSuffixForFlag=chapterSuffixForFlag;window.fitText=fitText;window.pdfRule=pdfRule;window.pdfT=pdfT;window.sanitizePdfDoc=sanitizePdfDoc;window.stampFooterAllPages=stampFooterAllPages;}
