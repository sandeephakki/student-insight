/* ════ NARRATIVES ════
   Redesigned from a parent's actual reading experience, not just from what
   was easy to compute. The old six-card layout (Report Card Comment / For
   Parents / Strengths / Motivation / Study Plan / Intervention) repeated
   the same "scored X%, there's been a decline" sentence three times in
   slightly different words, used one flat encouraging tone regardless of
   how serious the situation actually was, and gave generic advice
   ("revise fundamentals, practice 30 min daily") that wasn't tied to which
   subject actually needed it. Replaced with:
     - parentMessage: ONE plain-language paragraph, tone genuinely scaled
       to severity (a bottom-of-class declining student reads very
       differently from a strong, improving one — no "good effort!" on a
       report that also says "at risk").
     - trendFacts: concrete numbers (which test, how many points, which
       test named "declining" actually shows it) instead of a vague label.
     - homePlan / schoolPlan: split by who actually does the action, each
       anchored to the specific weakest subject rather than a canned list.
   ════ */
// Concrete, checkable trend facts instead of a vague "there has been a
// decline" — names the actual tests and the actual point swing, and is
// honest about a tie for weakest subject instead of arbitrarily picking one
// (the marks table right above this can show two subjects tied at the same
// %, so silently naming only one of them would look inconsistent).
// Shared by generateTrendFacts() and generateHomePlan(). Naming "the
// weakest subjects" only makes sense when it's a genuine minority of the
// subject list — if a student is struggling roughly evenly everywhere,
// the tie-for-lowest can end up covering every subject, and then telling
// a parent to focus "specifically" on all of them isn't specific at all.
// broad=true flags that degenerate case so callers can say something
// honest instead ("no single weak spot") rather than naming everything.
function weakestSubjectsInfo(st){
  const entries=Object.entries(st.analysis.subjectAvgs||{});
  if(!entries.length)return{entries,minVal:null,weakest:[],broad:false};
  const minVal=Math.min(...entries.map(([,v])=>v));
  const weakest=entries.filter(([,v])=>v===minVal).map(([s])=>s);
  const broad=entries.length>2&&weakest.length>=Math.ceil(entries.length*0.6);
  return{entries,minVal,weakest,broad};
}
function generateTrendFacts(st){
  const a=st.analysis,name=st.name.split(" ")[0];
  const points=(APP.setup.tests||[]).map((t,i)=>({name:t.name,val:a.testAvgs[i]})).filter(p=>p.val!==null&&p.val!==undefined);
  const{minVal,weakest,broad}=weakestSubjectsInfo(st);
  const weakBit=broad?` Struggling fairly evenly across every subject (~${minVal}%) — no single weak spot to point to.`
    :weakest.length?` Needs the most attention right now: ${weakest.join(" and ")} (${minVal}%).`:"";
  if(points.length<2)return(points.length===1?`Only one test on record so far (${points[0].name}: ${points[0].val}%) — not enough data yet for a trend.`:"No scored tests on record yet.")+weakBit;
  const first=points[0],last=points[points.length-1],delta=last.val-first.val;
  const dirWord=delta>3?"risen":delta<-3?"fallen":"stayed roughly steady";
  const deltaBit=Math.abs(delta)>3?` — a ${Math.abs(delta)}-point ${delta>0?"rise":"fall"} over ${points.length} tests`:"";
  return `${name} has ${dirWord} from ${first.val}% (${first.name}) to ${last.val}% (${last.name})${deltaBit}.${weakBit}`;
}
function generateParentMessage(st){
  const a=st.analysis,name=st.name.split(" ")[0];
  const atRisk=(st.flags||[]).some(f=>f.type==="at-risk");
  // Tone genuinely changes by severity instead of a flat "good effort!"
  // regardless of how serious the flags on the same report say it is.
  if(atRisk&&a.trend==="declining")return `${name} is currently in the bottom band of the class at ${a.overallAvg}%, and scores have been falling test over test. This needs real attention now, not just more of the same studying. We'd like to sit down together — parents and teacher — this week to agree on a plan.`;
  if(a.trend==="declining")return `${name} scored ${a.overallAvg}% this term, and there's a downward trend worth catching early. Nothing alarming yet, but it's the right time for some extra support at home before it compounds.`;
  if(a.overallAvg>=80)return `${name} is performing strongly at ${a.overallAvg}%${a.trend==="improving"?", and still improving":""}. Keep doing what's working — this is a good stage to add some stretch rather than more repetition.`;
  if(a.trend==="improving")return `${name} is at ${a.overallAvg}% and moving in the right direction. Keep the current routine going — consistency is what's paying off here.`;
  return `${name} is holding steady at ${a.overallAvg}%. No red flags, but there's room to push further with focused practice.`;
}
// Split by who actually does the action — a parent reading "practice 30 min
// daily" has no idea if that's meant for home or school. homePlan is what
// the family can do; schoolPlan (Institution mode only) is what the
// teacher/school is doing or recommending, merged from the old separate
// Study Plan + Intervention Note (which frequently repeated each other).
function generateHomePlan(st){
  const name=st.name.split(" ")[0];
  const{minVal,weakest,broad}=weakestSubjectsInfo(st);
  if(!weakest.length||minVal>=70)return "Keep up the current routine — nothing specific needs fixing at home right now.";
  if(broad)return `This week: struggling roughly evenly across every subject means there's no single fix — rotate, one subject per day (20–30 min), and spend that time on fundamentals rather than more practice volume. Trying to cover everything at once usually fixes nothing.`;
  return `This week: 20–30 min/day on ${weakest.join(" and ")} specifically, not general revision. Have ${name} explain one solved problem out loud each day — that surfaces real gaps faster than more worksheets.`;
}
// TASK (Project Bible v2 §5, "What changed since last test" one-liner):
// the doc suggested reusing subjectDeltas — checked it first and that
// field is actually "this student's subject average vs the CLASS
// average," computed in computeExtraInsights() in compute-engine.js. In
// Individual mode there's no class to compare against, so that value is
// always exactly 0 there — not usable for a last-test comparison, and
// misleading even in institution mode (a 0 there means "average for the
// class," not "no change since last test"). Computing the real
// last-vs-previous-test delta fresh instead, straight from raw per-test
// marks — same Math.min(mv,mx) clamping and maxMarks fallback
// computeAnalysis() already uses per test, so the numbers agree.
// TASK (Project Bible v2 §5, "Shareable single-insight image"): "Render
// one insight card (e.g. the parent message + trend chart) to a
// downloadable PNG via canvas, for sharing outside the app. Read-only
// rendering of existing fields." No new computation — generateParentMessage,
// generateWhatChangedSummary, and the already-rendered Chart.js trend
// canvas are all reused as-is. Colors below are the hex values behind
// this app's own --c-primary/--c-text/etc CSS variables (Canvas 2D can't
// read CSS custom properties directly), kept in sync by hand — if the
// palette in css/core.css's :root block ever changes, update here too.
function wrapCanvasText(ctx,text,maxWidth){
  const words=text.split(" ");
  const lines=[];let line="";
  words.forEach(w=>{
    const test=line?line+" "+w:w;
    if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=w;}
    else line=test;
  });
  if(line)lines.push(line);
  return lines;
}
function shareInsightAsImage(studentId){
  const st=APP.students.find(s=>s.id===studentId);if(!st)return;
  const a=st.analysis||{};
  const srcChart=document.getElementById("bucket-chart-student-trend");
  const W=800,PAD=40;
  const measureCanvas=document.createElement("canvas");
  const mctx=measureCanvas.getContext("2d");
  const parentMsg=generateParentMessage(st);
  const whatChanged=generateWhatChangedSummary(st);
  mctx.font="15px Inter, sans-serif";
  const msgLines=wrapCanvasText(mctx,parentMsg,W-PAD*2);
  mctx.font="italic 13px Inter, sans-serif";
  const changedLines=wrapCanvasText(mctx,whatChanged,W-PAD*2);
  const headerH=90,nameH=66,msgH=msgLines.length*22+8,changedH=changedLines.length*19+24;
  const chartAspect=(srcChart&&srcChart.width)?srcChart.height/srcChart.width:0.5;
  const chartDrawH=srcChart?(W-PAD*2)*chartAspect:0;
  const footerH=46;
  const H=headerH+nameH+msgH+changedH+chartDrawH+footerH+PAD;
  const canvas=document.createElement("canvas");
  canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#ffffff";ctx.fillRect(0,0,W,H);
  ctx.fillStyle="#4361ee";ctx.fillRect(0,0,W,headerH);
  ctx.fillStyle="#ffffff";ctx.font="700 20px 'DM Sans', sans-serif";ctx.textBaseline="alphabetic";
  ctx.fillText("Student Insight — Progress Report",PAD,headerH/2-4);
  ctx.font="12px Inter, sans-serif";ctx.fillStyle="rgba(255,255,255,.85)";
  ctx.fillText(new Date().toLocaleDateString(),PAD,headerH/2+18);
  let y=headerH+40;
  ctx.fillStyle="#1a1d2e";ctx.font="700 24px 'DM Sans', sans-serif";
  ctx.fillText(st.name,PAD,y);
  y+=28;
  ctx.font="600 15px Inter, sans-serif";ctx.fillStyle="#5a607a";
  ctx.fillText(`Overall: ${a.overallAvg}%  ·  Grade ${a.grade||"-"}  ·  Trend: ${a.trend||"-"}`,PAD,y);
  y+=32;
  ctx.font="15px Inter, sans-serif";ctx.fillStyle="#1a1d2e";
  msgLines.forEach(l=>{ctx.fillText(l,PAD,y);y+=22;});
  y+=10;
  ctx.font="italic 13px Inter, sans-serif";ctx.fillStyle="#5a607a";
  changedLines.forEach(l=>{ctx.fillText(l,PAD,y);y+=19;});
  y+=18;
  if(srcChart){
    ctx.drawImage(srcChart,PAD,y,W-PAD*2,chartDrawH);
    y+=chartDrawH+20;
  }
  ctx.strokeStyle="#e2e5f1";ctx.beginPath();ctx.moveTo(PAD,y);ctx.lineTo(W-PAD,y);ctx.stroke();
  y+=22;
  ctx.font="11px Inter, sans-serif";ctx.fillStyle="#9ba4c0";
  ctx.fillText("Privacy-first, offline analysis — nothing in this report was ever uploaded anywhere.",PAD,y);
  canvas.toBlob(function(blob){
    if(!blob){toast("Couldn't generate the image — try again.","warn");return;}
    const url=URL.createObjectURL(blob);
    const dl=document.createElement("a");
    dl.href=url;
    dl.download=(st.name||"student").replace(/[^\w\s-]/g,"").replace(/\s+/g,"_")+"_progress_report.png";
    document.body.appendChild(dl);dl.click();document.body.removeChild(dl);
    setTimeout(()=>URL.revokeObjectURL(url),2000);
    toast("Image downloaded — ready to share.","success");
  },"image/png");
}
function generateWhatChangedSummary(st){
  const a=st.analysis,name=st.name.split(" ")[0];
  const tests=APP.setup.tests||[],subjects=APP.setup.subjects||[];
  const validIdx=[];
  (a.testAvgs||[]).forEach((v,i)=>{if(v!==null&&v!==undefined)validIdx.push(i);});
  if(validIdx.length<2)return `Not enough test history yet to compare — need at least 2 scored tests (currently ${validIdx.length}).`;
  const prevI=validIdx[validIdx.length-2],lastI=validIdx[validIdx.length-1];
  const prevTest=tests[prevI],lastTest=tests[lastI];
  const overallDelta=a.testAvgs[lastI]-a.testAvgs[prevI];
  function subjPct(testIdx,subject){
    const t=tests[testIdx],td=st.testData[t.name]||{marks:{}};
    const m=td.marks[subject];if(m===null||m===undefined||m==="")return null;
    const mx=(t.maxMarks&&t.maxMarks[subject])||100;
    return Math.round((Math.min(parseFloat(m)||0,mx)/mx)*100);
  }
  let biggest=null;
  subjects.forEach(s=>{
    const p1=subjPct(prevI,s),p2=subjPct(lastI,s);
    if(p1===null||p2===null)return;
    const d=p2-p1;
    if(!biggest||Math.abs(d)>Math.abs(biggest.d))biggest={subject:s,d};
  });
  const overallDir=overallDelta>0?"up":overallDelta<0?"down":"unchanged";
  const overallBit=overallDelta===0?`stayed at ${a.testAvgs[lastI]}% overall`:`went ${overallDir} ${Math.abs(overallDelta)} point${Math.abs(overallDelta)===1?"":"s"} overall (${a.testAvgs[prevI]}% → ${a.testAvgs[lastI]}%)`;
  const subjBit=(biggest&&biggest.d!==0)?`, mainly driven by ${biggest.subject} (${biggest.d>0?"+":""}${biggest.d})`:"";
  return `Since ${prevTest.name}, ${name} has ${overallBit}${subjBit}.`;
}
function generateSchoolPlan(st){
  const a=st.analysis;
  const RISK_TYPES=["data-error","at-risk","first-below-pass","declining","sharp-drop","absent","volatile","burnout","data-gap"];
  const riskFlags=(st.flags||[]).filter(f=>RISK_TYPES.includes(f.type));
  if(!riskFlags.length)return null; // nothing to report — omit instead of padding with "no intervention needed"
  const flags=riskFlags.map(f=>f.label).join(", ");
  return `Flags: ${flags}. `+(a.stressScore>=60?"High stress indicators — recommend a one-on-one check-in. ":"")+"Suggested: parent-teacher meeting, targeted practice material, close monitoring on the next test.";
}

/* ════ DASHBOARD ════ */
function renderDataIssueBanner(){
  const issues=APP.dataIssues||[];
  const el=document.getElementById("data-issue-banner");
  if(!el)return;
  if(!issues.length){el.style.display="none";return;}
  const rows=issues.map(i=>i.scaleMismatch?`<b>Possible scale mismatch:</b> ${esc(i.message)}`:`${esc(i.studentName)} — ${esc(i.subject)} (${esc(i.test)}): ${esc(i.message)}`).join("<br>");
  el.innerHTML=`<b>⚠ Data quality issue${issues.length>1?"s":""} found (${issues.length}):</b> some mark cells couldn't be trusted as-is — see below. Please correct the source sheet and re-import. Export is disabled until these are fixed.<div style="max-height:220px;overflow-y:auto;margin-top:8px;padding-right:6px;border-top:1px solid #f5c6c1">${rows}</div>`;
  el.style.display="block";
}
/* ════ SMART REVEAL — buckets(A) / filtered list(B) / full answer(C) ════
   BUCKETS_SCOPE: Institution mode, non-Compare only. Compare Mode and
   Individual mode fall straight through to the pre-existing full
   renderDashboard() body (#legacy-dashboard-body) — the bucket model
   ("My Whole Class" / "Who Needs Help" etc.) presumes a multi-student
   class cohort, which doesn't apply to either of those modes. Revisit
   if/when a Compare- or Individual-specific bucket set is designed.
   Presentation-layer only — no new analytics; reuses st.analysis /
   st.analysis.explainedWarnings / APP.classStats exactly as computed by
   the existing engine. See BUILD spec student-insight-smart-reveal for
   the full design decisions this implements. */

// i18n discipline (PIB spec §4): every user-facing string here is a
// tag-key lookup through srT(), never concatenated, even though only an
// English table is populated now — this is Phase 5 scaffolding done
// up-front rather than retrofitted later.
// AUTO-SYNCED from i18n/en.json (root-cause fix for the raw-key-name bug —
// see loadLanguage() below: this inline copy is what actually renders on
// the very first synchronous paint, AND is the only thing that renders at
// all when fetch(i18n/en.json) fails outright (e.g. opened as a local
// file:// page — a first-class supported use case, see About §2 'A local
// HTML file' — file:// blocks fetch() of sibling files in most browsers).
// A hand-curated *subset* here silently drifts from en.json and reappears
// as raw key names on screen the moment the fetch can't complete. Keep
// this block and i18n/en.json in sync on every string change — regenerate
// with: python3 scripts/sync-sr-strings-en.py (see that file).
// AUTO-SYNCED from i18n/en.json (root-cause fix for the raw-key-name bug —
// see loadLanguage() below: this inline copy is what actually renders on
// the very first synchronous paint, AND is the only thing that renders at
// all when fetch(i18n/en.json) fails outright (e.g. opened as a local
// file:// page — a first-class supported use case, see About §2 'A local
// HTML file' — file:// blocks fetch() of sibling files in most browsers).
// A hand-curated *subset* here silently drifts from en.json and reappears
// as raw key names on screen the moment the fetch can't complete. Keep
// this block and i18n/en.json in sync on every string change — regenerate
// with: python3 scripts/sync-sr-strings-en.py (see that file).
const SR_STRINGS_EN={
  _comment:"English string table — the authoritative source for translation. This is the SAME content kept inline in js/render-dashboard.js (SR_STRINGS_EN) as an emergency fallback per PIB SPLIT_STATIC/i18n rules — if this file fails to fetch, the app still works in English using the inline copy. Do not let the two drift: this file mirrors SR_STRINGS_EN exactly. SCOPE NOTE: this covers only the ~18 pre-existing Smart Reveal bucket strings plus the newer Smart Search strings added in Phase 2/3 — it is NOT a full extraction of every user-facing string in the app (setup forms, FAQ, export screens, etc. are still hardcoded English throughout index.html/js/*.js). Full extraction is future work, not done here — see handoff doc.",
  about_bio_desc:"Educator and builder based in India, working on free, privacy-first tools that give teachers, institutions, and parents back control of their own data — Student Insight is one of them, built as a social cause rather than a product.",
  about_bio_email_btn:"sandeep@hakki.in",
  about_bio_kicker:"Who built this",
  about_bio_name:"Sandeep S Hakki",
  about_bio_projectpage_btn:"Project Page",
  about_builtby:"Built by Sandeep Hakki",
  about_eyebrow:"Student Insight — About",
  about_formulas_btn:"See Exact Formulas →",
  about_formulas_desc:"Every average, rank, percentile, trend and composite score, written out as exact formulas — for the maths/statistics/analytics people your institute will ask.",
  about_formulas_title:"Want to verify the maths yourself?",
  about_hero_sub:"Student Insight is the StudIn analytic tool that turns a spreadsheet of marks into ranks, trends, at-risk flags, and plain-language findings — without ever asking you to hand your data to a server first. Unlike traditional web applications that require user accounts, cloud storage, or centralized databases, Student Insight is designed as a completely stateless, privacy-first analytics platform. The application itself never becomes the owner of your data. Instead, it serves as an intelligent processing engine that transforms your spreadsheets into meaningful educational insights while keeping complete control in your hands.",
  about_hero_title:"You have students' marks. <span style=\"color:#2ec4b6\">Let's build meaningful insight from them.</span>",
  about_philosophy_cite:"Our Philosophy",
  about_philosophy_quote:"Student Insight is a privacy-first, offline education analytics platform where educators own their data, projects live in user-controlled files, and the application serves only as an intelligent analysis engine.",
  about_sec1_p1:"Student Insight never treats the browser as permanent storage.",
  about_sec1_p2:"Your data is stored only in files that you own.",
  about_sec1_p3:"Every project can be imported, analyzed, updated, exported, shared, archived, or backed up without depending on an online account or remote server.",
  about_sec1_p4:"If you move to another computer, your project moves with you. If you disconnect from the internet, your project continues to work.",
  about_sec1_p5:"<strong>Your data remains yours.</strong>",
  about_sec1_title:"Your Data Always Belongs to You",
  about_sec2_host1:"GitHub Pages",
  about_sec2_host2:"A local HTML file",
  about_sec2_host3:"A USB drive",
  about_sec2_host4:"A school intranet",
  about_sec2_host5:"An offline classroom computer",
  about_sec2_p1:"Student Insight is intentionally designed to run from a single static website. It works equally well whether it is opened from:",
  about_sec2_p2:"No installation. No server. No database. No subscriptions. No vendor lock-in.",
  about_sec2_title:"Built for GitHub Pages and Static Hosting",
  about_sec3_no1:"User accounts",
  about_sec3_no2:"Cloud synchronization",
  about_sec3_no3:"Remote databases",
  about_sec3_no4:"Cookies or fingerprinting",
  about_sec3_no5:"Personal data collection",
  about_sec3_no6:"Background uploads of your files",
  about_sec3_p1:"Educational records are among the most sensitive types of information.",
  about_sec3_p2:"Student Insight is designed so that student information never needs to leave the educator's device. The application does not require:",
  about_sec3_p3:"The browser simply processes the data that you choose to open — your uploaded spreadsheets and student records never leave your device.",
  about_sec3_p4:"To understand how many people use Student Insight, the site uses <strong>Cloudflare Web Analytics</strong> — a cookieless, aggregate-only visit counter that does not use fingerprinting and collects no personal data. It only ever sees anonymous page-view counts, never anything from the files you upload or analyze.",
  about_sec3_title:"Privacy by Design",
  about_sec4_p1:"Traditional systems store information inside databases. Student Insight stores knowledge inside educator-owned project files.",
  about_sec4_p2:"The application can always reconstruct the complete working environment from those files.",
  about_sec4_p3:"Nothing important depends on browser memory. Nothing important depends on server storage.",
  about_sec4_p4:"This carries through the whole academic year, not just a single test. As Test 2 and Test 3 come in, the same file grows to hold them — the Setup step can load an already-filled sheet and add the next test's columns onto it directly, so nothing already recorded is ever re-entered or discarded along the way.",
  about_sec4_p5:"<strong>Your project remains portable, transparent, and future-proof.</strong>",
  about_sec4_title:"Your Spreadsheet is the Source of Truth",
  about_sec5_chip1:"Schools",
  about_sec5_chip2:"Colleges",
  about_sec5_chip3:"Universities",
  about_sec5_chip4:"Coaching Centres",
  about_sec5_chip5:"Individual Tutors",
  about_sec5_chip6:"Training Institutes",
  about_sec5_chip7:"Online Learning Programs",
  about_sec5_chip8:"Parents",
  about_sec5_chip9:"Self-Prep Aspirants",
  about_sec5_p1:"Its architecture is designed to support:",
  about_sec5_title:"Designed for Every Educational Institution — and Individuals",
  about_sec6_p1:"Student Insight is not another student management system. Its purpose is to help educators understand learning.",
  about_sec6_p2:"The goal is not simply to collect data.",
  about_sec6_p3:"<strong>The goal is to transform educational data into educational intelligence.</strong>",
  about_sec6_title:"Beyond Marks and Attendance",
  about_sec7_col1:"Every educator or parent accesses the same application.<br>Every user owns their own data.<br>Every project remains independent.",
  about_sec7_col2:"No shared sessions.<br>No shared storage.<br>No hidden cloud dependency.",
  about_sec7_col3:"The application is temporary.<br><br>Your project is permanent.",
  about_sec7_title:"Offline First. Stateless by Design.",
  about_sec8_p1:"Because Student Insight is built around open file formats and user-owned data, everyone remains free to archive, migrate, or extend their projects without being tied to proprietary infrastructure.",
  about_sec8_title:"Open, Portable and Future Ready",
  about_stat_cost:"Cost, forever",
  about_stat_license_label:"Open source licence",
  about_stat_offline:"Offline capable",
  about_stat_servers:"Servers involved",
  ai_anxiety_flag_label:"Anxiety Flag",
  ai_anxiety_flag_sub:"Pattern of consistent underperformance suggesting anxiety",
  ai_at_risk_label:"At-Risk Detection",
  ai_at_risk_sub:"Scored below pass threshold in any subject",
  ai_avg_label:"Subject-wise Average",
  ai_avg_sub:"Mean marks per subject per test",
  ai_burnout_risk_label:"Burnout Risk",
  ai_burnout_risk_sub:"Declining performance after previous high scores",
  ai_chronic_absent_label:"Chronic Absenteeism",
  ai_chronic_absent_sub:"Exceeds absence threshold near test dates",
  ai_class_difficulty_label:"Class Difficulty Flag",
  ai_class_difficulty_sub:"Subject where >40% of class is struggling",
  ai_class_health_label:"Class Health Score",
  ai_class_health_sub:"Overall class performance index 0–100",
  ai_competitive_readiness_label:"Competitive Readiness",
  ai_competitive_readiness_sub:"Readiness signal for entrance exams (JEE/NEET/IAS)",
  ai_consistency_label:"Consistency Score",
  ai_consistency_sub:"Low variance = consistent; high = unpredictable",
  ai_cumulative_label:"Cumulative Average",
  ai_cumulative_sub:"Running average across all tests to date",
  ai_diversity_analysis_label:"Gender & Group Analysis",
  ai_diversity_analysis_sub:"Performance patterns across gender groups",
  ai_early_warning_label:"Early Warning Score",
  ai_early_warning_sub:"Composite risk score for proactive intervention",
  ai_engagement_index_label:"Engagement Index",
  ai_engagement_index_sub:"Proxy for class engagement via attendance + trend",
  ai_grade_label:"Grade Assignment",
  ai_grade_sub:"A/B/C/D/F by percentage bands",
  ai_growth_rate_label:"Growth Rate",
  ai_growth_rate_sub:"Score velocity — how fast improving or declining",
  ai_intervention_label:"Intervention Note",
  ai_intervention_priority_label:"Intervention Priority List",
  ai_intervention_priority_sub:"Ranked list of students needing immediate support",
  ai_intervention_sub:"Teacher guidance for at-risk students",
  ai_motivation_label:"Motivational Message",
  ai_motivation_sub:"Personalised encouragement based on trend",
  ai_multiple_fails_label:"Multiple Subject Failures",
  ai_multiple_fails_sub:"Failing in 2 or more subjects simultaneously",
  ai_parent_summary_label:"Parent-Friendly Summary",
  ai_parent_summary_sub:"Plain-language progress narrative for parents",
  ai_pct_label:"Percentage Calculation",
  ai_pct_sub:"% score per subject and overall",
  ai_peer_outlier_label:"Peer Outlier",
  ai_peer_outlier_sub:"Performing unusually above or below peer group",
  ai_percentile_label:"Percentile Calculation",
  ai_percentile_sub:"Where student stands within the class",
  ai_plateau_label:"Plateau Detection",
  ai_plateau_sub:"No improvement across 3+ consecutive tests",
  ai_prediction_label:"Next Test Prediction",
  ai_prediction_sub:"Projected score from trend (2+ tests)",
  ai_progress_narrative_label:"Progress Narrative",
  ai_progress_narrative_sub:"Story of the student's journey across all tests",
  ai_rank_label:"Class Ranking",
  ai_rank_sub:"Rank 1–N by overall average",
  ai_resilience_score_label:"Resilience Score",
  ai_resilience_score_sub:"Ability to recover after a drop — positive rebound",
  ai_sharp_drop_label:"Sharp Drop Alert",
  ai_sharp_drop_sub:"Sudden marks drop ≥ configurable % between tests",
  ai_strengths_letter_label:"Strengths Letter",
  ai_strengths_letter_sub:"Highlight what the student excels at",
  ai_stress_score_label:"Stress Indicator",
  ai_stress_score_sub:"Composite score from volatility, absences & trend",
  ai_study_plan_label:"Study Plan",
  ai_study_plan_sub:"Targeted recommendations for weak subjects",
  ai_subject_audit_label:"Subject Audit",
  ai_subject_audit_sub:"Which subjects need curriculum or teaching review",
  ai_subject_collapse_label:"Subject Collapse",
  ai_subject_collapse_sub:"Was strong, now suddenly failing in a subject",
  ai_subject_strength_label:"Subject Strength & Weakness",
  ai_subject_strength_sub:"Best and weakest subject per student",
  ai_teacher_remarks_ai_label:"AI Remark Sentiment",
  ai_teacher_remarks_ai_sub:"Classify teacher remarks as positive / neutral / concern",
  ai_test_difficulty_label:"Test Difficulty Analysis",
  ai_test_difficulty_sub:"Was the test too hard or too easy vs class history",
  ai_topper_gap_label:"Topper Gap Analysis",
  ai_topper_gap_sub:"How far each student is from class topper",
  ai_trend_label:"Performance Trend",
  ai_trend_sub:"Improving / Stable / Declining across tests",
  ai_volatile_label:"Volatile Performance",
  ai_volatile_sub:"High score variance — inconsistent pattern",
  ai_wellbeing_summary_label:"Wellbeing Summary",
  ai_wellbeing_summary_sub:"Class-level psychosocial overview for teacher",
  ai_year_projection_label:"Year-End Projection",
  ai_year_projection_sub:"Projected final scores based on current trajectory",
  back:"← Back",
  insights_nav_label:"Insights",
  export_section_title:"Generate &amp; Export Reports",
  shell_right_generate_zip:"Generate & Download ZIP",
  bucket_all_good:"All good — no concerns here right now.",
  bucket_back_to_dashboard:"← Insights",
  bucket_class_desc:"Overall average, trend, and class-wide patterns",
  bucket_class_label:"My Whole Class",
  bucket_clusters_desc:"Cohort patterns found across average, consistency, trend and attendance",
  bucket_clusters_label:"Performance Groups",
  bucket_compare_report_desc:"One management-level PDF ranking every section side by side",
  bucket_compare_report_label:"Section Comparison Report",
  bucket_count_badge_one:"({{count}} found)",
  bucket_count_badge_other:"({{count}} found)",
  bucket_export_desc:"One click — everything, no choices to make",
  bucket_export_label:"Export Reports",
  bucket_help_desc:"Students who may need extra support",
  bucket_help_label:"Who Needs Help",
  bucket_persection_desc:"Student/Teacher/Management PDFs for one section at a time",
  bucket_persection_label:"Per-Section Reports",
  bucket_smart_desc:"Ask anything about this class in plain language",
  bucket_smart_label:"Smart Search ✨",
  bucket_student_desc:"Look up any student by name",
  bucket_student_label:"One Student",
  bucket_subject_desc:"See how the whole class did in one subject",
  bucket_subject_label:"One Subject",
  bucket_top_desc:"Highest scorers and most improved",
  bucket_top_label:"Top Performers",
  faq_audience_finance:"For the Admin / Office",
  faq_audience_formulas:"Exact Formulas & Calculation Logic",
  faq_audience_it:"From the IT-in-charge",
  faq_audience_nitpicky:"The Nitpicky (But Real) Ones",
  faq_audience_parent:"Parent-Facing Concerns",
  faq_audience_principal:"From the Principal",
  faq_audience_teacher:"From a Regular Teacher",
  faq_audience_terms:"Terms & Abbreviations Used in the App",
  faq_audience_vp:"From the VP / Academic Coordinator",
  faq_cnt_finance:"Budget & paperwork",
  faq_cnt_formulas:"For maths/statistics/analytics reviewers — every number, in writing",
  faq_cnt_it:"Hosting & data location",
  faq_cnt_nitpicky:"You'll actually hear these",
  faq_cnt_parent:"What the principal anticipates",
  faq_cnt_principal:"Money, liability, reputation",
  faq_cnt_teacher:"The actual daily user",
  faq_cnt_terms:"What every label actually means",
  faq_cnt_vp:"Process & control",
  faq_empty:"No questions match your search. Try a different word.",
  faq_hero_eyebrow:"Frequently Asked Questions",
  faq_hero_sub:"These are the actual questions principals, coordinators, IT staff and teachers ask when this tool is proposed to them — from serious procurement concerns down to the nitpicky ones. Every answer below reflects exactly what the app does today. Where something isn't built yet, that's stated plainly rather than glossed over.",
  faq_hero_title:"You have students' marks. Here's exactly how the StudIn analytic tool <span style=\"color:#2ec4b6\">turns them into insight —</span> answered honestly, not persuasively.",
  faq_jump_formulas:"Jump straight to Exact Formulas & Calculation Logic (for maths/stats reviewers)",
  faq_search_placeholder:"Search questions — e.g. 'data', 'offline', 'cost', 'save'...",
  faq_tag_admin:"Admin",
  faq_tag_appdefined:"App-defined",
  faq_tag_core:"Core",
  faq_tag_practical:"Practical",
  faq_tag_serious:"Serious",
  faq_tag_silly:"Silly",
  faq_tag_statistics:"Statistics",
  faq_tag_technical:"Technical",
  finding_top_rank:"{{student}} is ranked #{{rank}} in the class.",
  home_hero_sub:"Upload a filled Excel workbook and Student Insight identifies learning gaps, flags at-risk students, tracks progress over time, and generates ready-to-share reports — computed instantly, entirely in your browser, with your data never uploaded anywhere.",
  home_hero_title:"Turn your students' marks into actionable insight",
  home_upload_sub:"Drop your class's filled Excel file below. Managing more than one section or batch? Drop 2 or more files at once — matching ones are compared automatically, and any that don't match still get their own individual analysis.",
  home_upload_title:"Upload Your Filled Sheet",
  individual_bucket_plan_desc:"What to focus on at home this week",
  individual_bucket_plan_label:"Recommendations",
  individual_bucket_report_desc:"Overall summary, trend and where things stand",
  individual_bucket_report_label:"Progress Report",
  individual_bucket_subjects_desc:"Test-by-test marks and subject breakdown",
  individual_bucket_subjects_label:"Subjects & Marks",
  individual_bucket_wellbeing_desc:"Stress and engagement signals",
  individual_bucket_wellbeing_label:"Wellbeing",
  setup_absent_alert_label:"Absent Alert",
  setup_btn_back:"Back",
  setup_btn_done_upload:"Done — Upload on Home",
  setup_btn_download_template:"Download Template",
  setup_btn_load_different:"Load a Different Sheet",
  setup_btn_load_existing:"Load Existing Filled Sheet",
  setup_btn_next:"Next",
  setup_card_new_desc:"Start fresh — set up institution, class, subjects and tests, then download a blank workbook to fill offline.",
  setup_card_new_title:"Create New Template",
  setup_card_update_desc:"Already filled Test 1? Load your workbook, add Test 2 / Test 3, then re-download — existing marks are kept, only new blank columns are added.",
  setup_card_update_title:"Update Existing Template",
  setup_class_name_error:"Class / Batch is required",
  setup_class_name_label:"Class / Batch",
  setup_class_name_placeholder:"e.g. Class 9",
  setup_class_section_label:"Section",
  setup_class_section_placeholder:"e.g. B",
  setup_class_teacher_label:"Teacher Name",
  setup_class_title:"Class / Batch",
  setup_class_year_error:"Academic year is required",
  setup_class_year_label:"Academic Year",
  setup_class_year_placeholder:"e.g. 2026",
  setup_compare_banner_btn:"Home · Upload",
  setup_compare_banner_desc:"Optional — if every section's teacher already has a filled sheet, skip straight to <button class=\"btn btn-secondary btn-sm\" onclick=\"goStep(&#39;home&#39;)\" style=\"display:inline-flex;padding:3px 8px;font-size:12px;vertical-align:middle\">Home · Upload</button> and the Subjects/Tests/Max Marks from the first file you upload become the shared schema automatically. Only fill this in if you need to <b>generate a blank template</b> to hand out first — in that case, Subjects, Tests & Max Marks entered below will be shared across every section you compare.",
  setup_compare_banner_title:"Compare Sections / Batches — Institution mode",
  setup_drop_alert_label:"Drop Alert %",
  setup_howstart_title:"How would you like to start?",
  setup_indiv_multichild_hint:"Tracking more than one child? Just add another row in the downloaded template's STUDENTS sheet with a different Student ID — each child gets their own switcher entry on Insights, never compared to each other.",
  setup_inst_contact_label:"Contact",
  setup_inst_contact_placeholder:"phone / email",
  setup_inst_location_label:"Location",
  setup_inst_location_placeholder:"City, State",
  setup_inst_name_error:"Institution name is required",
  setup_inst_name_label:"Institution Name",
  setup_inst_name_placeholder:"e.g. Springfield International School",
  setup_inst_title:"Institution",
  setup_inst_type_label:"Type",
  setup_inst_type_select:"Select...",
  setup_merge_cancel:"Cancel — start a fresh template instead",
  setup_mode_indiv_desc:"A parent tracking one or more children, or an aspirant tracking their own prep — no class comparison, just personal progress over time.",
  setup_mode_indiv_title:"Individual (Parent / Self-Prep)",
  setup_mode_inst_desc:"A teacher or coaching centre tracking a whole class or batch of students — with rank, class average, and at-risk flags.",
  setup_mode_inst_title:"Institution / Coaching Batch",
  setup_pass_threshold_label:"Pass %",
  setup_scoring_grade:"Grade",
  setup_scoring_marks:"Marks",
  setup_scoring_passfail:"Pass/Fail",
  setup_scoring_pct:"Percentage",
  setup_scoring_title:"Scoring",
  setup_step1_title:"Step 1 · Setup",
  setup_subjects_addbtn:"Add Subject",
  setup_subjects_title:"Subjects",
  setup_subtitle:"Configure your institution, academic year, class, subjects and assessment details before importing student data.",
  setup_tests_addbtn:"Add Test",
  setup_tests_title:"Tests / Exams",
  setup_whofor_title:"Who is this for?",
  shell_home_left_pitch_1:"Instant PDF report cards",
  shell_home_left_pitch_2:"No data ever uploaded",
  shell_home_left_pitch_3:"Auto-detects subjects & tests",
  shell_home_left_pitch_4:"Works for one class or many",
  shell_home_left_pitch_5:"13 languages, full RTL support",
  shell_home_left_pitch_6:"Ask questions in plain language",
  shell_home_left_pitch_7:"Turns raw marks into rank, trend & risk flags",
  shell_home_right_pitch_1:"Class-wide KPIs — averages, pass rate, and trends across tests",
  shell_home_right_pitch_2:"A performance heatmap across every subject and test",
  shell_home_right_pitch_3:"An automatic list of students who may need extra help",
  shell_home_right_pitch_4:"Top performers and instant two-student comparisons",
  shell_home_right_pitch_5:"Patterns pulled out of teacher remarks and wellbeing notes",
  shell_home_right_pitch_6:"Performance groups, once the class is large enough",
  shell_hint_features_peek:"Tap for page info & help",
  shell_hint_properties_peek:"Tap for tools & actions",
  shell_left_file_details_title:"File details",
  shell_left_file_label:"Uploaded file",
  shell_left_multi_file:"Multiple files",
  shell_left_no_file:"No file uploaded yet",
  shell_left_org_label:"Institution / Individual",
  shell_left_records_label:"Records",
  shell_left_single_file:"Single file",
  shell_rail_features_title:"Features",
  shell_rail_properties_title:"Properties",
  shell_right_build_template:"Build Your Own Template",
  shell_right_exports_ready:"Exports ready",
  shell_right_link_sample_files:"Sample Files",
  shell_right_selected_features:"Selected features",
  shell_right_try_sample:"Try Sample Data",
  smart_search_ai_tooltip:"AI feature — development in progress",
  smart_search_back:"Back to Insights",
  smart_search_coming_soon:"Coming soon",
  smart_search_empty_sub:"This section needs a bit more data before questions become available here.",
  smart_search_empty_title:"Nothing to ask yet",
  smart_search_load_error:"Couldn't load Smart Search. Check your connection and try again.",
  smart_search_pro_notice:"Smart Search feature is coming in StudIn Pro.",
  smart_search_select_first:"Select a student first.",
  smart_search_select_student:"Select a student…",
  smart_search_student_label:"Student",
  smart_search_subtitle:"Tap a question for a plain-language answer, computed from this class's data. Nothing here is sent anywhere — calculated on your device, same as the rest of the app.",
  smart_search_title:"Smart Search",
  smart_v2_compare_link:"Compare two students",
  smart_v2_deflection_hint:"Try one of the suggestions below",
  smart_v2_input_placeholder:"Ask about this class or a student…",
  smart_v2_legacy_link:"Prefer tap-to-ask? Open Classic Smart Search",
  student_picker_prompt:"Type a student's name to see their full report.",
  subject_picker_prompt:"Pick a subject to see how the class did.",
};
// v3.9 — Phase 3 i18n. SR_STRINGS_EN above stays inline in this file as
// the EMERGENCY FALLBACK (per explicit direction: "English sits in html
// [/JS] only for any emergencies") — if i18n/en.json fails to fetch (bad
// connection, file missing, whatever), the app still runs correctly in
// English using this inline copy, never a blank/broken string.
// Hindi/Kannada (and any future language) are no longer hardcoded here —
// they load on demand from i18n/<code>.json only when the user actually
// picks that language (see loadLanguage() below), protecting low-end/
// slow-connection devices from downloading language data nobody asked
// for. This replaces the old SR_STRINGS_HI/SR_STRINGS_KN consts and the
// static SR_LANG_TABLES object that used to live here.
window.I18N_TABLES = { en: SR_STRINGS_EN };
window.SR_LANG = "en"; // default — see COUNTRY_LANGUAGES/applyCountryDefault() in js/state-nav.js for how India+English became the default
window.I18N_LOADING = false;

function loadLanguage(code){
  // BUG FIX (vs-shell-plan-v2 Task 1): English used to short-circuit here
  // ("already... it's English, always present inline") and never fetch
  // i18n/en.json, while SR_STRINGS_EN above was a hand-maintained subset
  // that had silently drifted out of sync with en.json (missing keys like
  // smart_search_back/title/subtitle) — that drift, not a race condition,
  // is why raw key names showed on screen. English now goes through the
  // exact same fetch path as every other language: one code path for all
  // 14 cases. SR_STRINGS_EN stays inline purely as the emergency fallback
  // (per the original "English sits in html/JS only for emergencies"
  // direction, see comment above) — it's still used below if the fetch
  // fails, and it still pre-populates I18N_TABLES.en so the very first
  // synchronous render (before this fetch resolves) isn't blank.
  if(window.I18N_TABLES[code] && code!=="en"){ // already fetched (non-English only — English always refetches once, below)
    window.SR_LANG = code;
    reapplyI18nStrings();
    return Promise.resolve();
  }
  window.I18N_LOADING = true;
  return fetch(`i18n/${code}.json`)
    .then(r=>{ if(!r.ok) throw new Error("i18n fetch failed ("+r.status+")"); return r.json(); })
    .then(json=>{
      window.I18N_TABLES[code] = json;
      window.SR_LANG = code;
      window.I18N_LOADING = false;
      reapplyI18nStrings();
    })
    .catch(err=>{
      window.I18N_LOADING = false;
      console.error("loadLanguage failed for", code, err);
      if(code==="en"){
        // Emergency fallback: keep the inline SR_STRINGS_EN copy already
        // sitting in window.I18N_TABLES.en so English still renders correctly
        // even though i18n/en.json couldn't be fetched.
        window.SR_LANG = "en";
        reapplyI18nStrings();
        return;
      }
      toast("Couldn't load that language — staying on "+(SR_LANG_TABLES_LABEL(window.SR_LANG))+".","warn");
    });
}
function SR_LANG_TABLES_LABEL(code){
  const t = window.I18N_TABLES[code];
  return (t&&t._meta&&t._meta.label) || code;
}
// BUG 1 FIX (studin-ui-bugs-prompt v1.0): a global data-i18n sweep did NOT
// exist before this — reapplyI18nStrings() only ever re-rendered the
// bucket/Smart Search screens via JS (srT() calls inside their own render
// functions). This adds the missing static-HTML half: any element with a
// data-i18n="<key>" attribute anywhere in the document gets its innerHTML
// replaced from the current language table. Uses .html() not .text()
// because some tagged elements (e.g. about_hero_title) contain nested
// markup (a colored <span>) that must be preserved — these are trusted,
// app-authored translation strings, not user input, so this is the same
// trust model already used for srT()-driven bucket/Smart Search content
// elsewhere in the app, not a new XSS surface.
function applyDataI18nSweep(){
  const table = window.I18N_TABLES[window.SR_LANG] || SR_STRINGS_EN;
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    const key = el.getAttribute("data-i18n");
    const val = table[key] || SR_STRINGS_EN[key];
    if(val!==undefined) el.innerHTML = val;
  });
  // v3.9: placeholder text on inputs can't be set via innerHTML — needs its
  // own attribute + pass.
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el=>{
    const key = el.getAttribute("data-i18n-placeholder");
    const val = table[key] || SR_STRINGS_EN[key];
    if(val!==undefined) el.setAttribute("placeholder",val);
  });
  // i18n-gap-analysis: loader previously had no handling for title= or
  // aria-label= attributes at all — every data-i18n-title/data-i18n-aria-label
  // in the HTML was inert until these two passes were added.
  document.querySelectorAll("[data-i18n-title]").forEach(el=>{
    const key = el.getAttribute("data-i18n-title");
    const val = table[key] || SR_STRINGS_EN[key];
    if(val!==undefined) el.setAttribute("title",val);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach(el=>{
    const key = el.getAttribute("data-i18n-aria-label");
    const val = table[key] || SR_STRINGS_EN[key];
    if(val!==undefined) el.setAttribute("aria-label",val);
  });
  // i18n-gap-analysis #80: <title> is outside the querySelectorAll sweep
  // (it's not swept by "[data-i18n]") — set it explicitly instead.
  const titleVal = table["doc_title"] || SR_STRINGS_EN["doc_title"];
  if(titleVal!==undefined) document.title = titleVal;
}
// v3.9 — small helper so the handful of buttons that get their innerHTML
// rewritten from JS (Download Template / Load Existing / Load a Different
// Sheet — see project-setup.js and template-upload.js) look up the current
// language instead of hardcoding English every time they re-render.
function i18nLabel(key, fallback){
  const table = window.I18N_TABLES[window.SR_LANG] || SR_STRINGS_EN;
  return table[key] || SR_STRINGS_EN[key] || fallback;
}
// Re-render whichever screen is currently visible so a language switch
// takes effect immediately without a full page reload. Scoped to the
// screens that actually use srT() today (buckets, Smart Search) — see
// TRANSLATION_REFERENCE.md for the current scope limitation (most of the
// app outside these ~40 keys is still hardcoded English).
function reapplyI18nStrings(){
  applyDataI18nSweep();
  // RTL support: only Urdu (ur.json) is flagged rtl:true in its _meta
  // today. This flips the DIRECTION of the screens that actually
  // localize (buckets, Smart Search, AI feature panel — v4.2 adds the
  // latter) — NOT the whole page, since the rest of the app (Setup, FAQ,
  // Export, etc.) is still English-only layout and flipping it would look
  // broken, not better. A real full-page RTL pass is separate future
  // work — this is a scoped, honest fix for the screens that currently
  // show translated text at all.
  const table = window.I18N_TABLES[window.SR_LANG];
  const isRtl = !!(table && table._meta && table._meta.rtl);
  $("#bucket-screen,#bucket-list-screen,#bucket-answer-screen,#smart-search-screen,#panel-ai")
    .attr("dir", isRtl ? "rtl" : "ltr")
    .toggleClass("rtl-screen", isRtl);
  // vs-shell-plan-v2 Task 3: #app-shell-body gets dir only (no .rtl-screen
  // class, which sets text-align:right) so the shell grid's own columns
  // mirror without forcing text-align on the still-English-layout panels
  // nested inside it. A full content-level RTL audit is Task 8's job.
  $("#app-shell-body").attr("dir", isRtl ? "rtl" : "ltr");
  // v4.21-individual-mode-shell-parity §6/OQ2: this used to check
  // #bucket-screen's visibility, which was already stale for Institution
  // mode (migrated to the rail-driven #bucket-answer-screen/
  // #legacy-dashboard-body pattern earlier — #bucket-screen is never
  // shown for it) and is now stale for Individual mode too after this
  // migration. Re-render whichever mode's actual current view is showing.
  if(APP.compareMode){
    if($("#legacy-dashboard-body").is(":visible") && typeof renderDashboard==="function") renderDashboard();
    else if($("#bucket-answer-screen").is(":visible") && typeof renderCompareOverview==="function") renderCompareOverview();
  } else if(APP.setup && APP.setup.mode==="individual"){
    if($("#bucket-answer-screen").is(":visible") && typeof openIndividualBucket==="function") openIndividualBucket(window._individualBucketCurrent||"report");
  } else {
    if(($("#legacy-dashboard-body").is(":visible")||$("#bucket-answer-screen").is(":visible")) && typeof openBucket==="function") openBucket(APP._currentBucketId||"class");
  }
  if($("#smart-search-screen").is(":visible") && typeof renderSmartSearchScreen==="function"){
    renderSmartSearchScreen();
  }
  // v4.2: AI feature checkboxes are JS-injected innerHTML (data-driven from
  // AI_FEATURES), not static data-i18n markup, so the sweep above can't
  // reach them — re-render explicitly, same pattern as buckets/Smart
  // Search above, only when that panel is actually on screen.
  if($("#panel-ai").is(":visible") && typeof renderAICheckboxes==="function"){
    renderAICheckboxes();
  }
  // vs-shell-plan-v2 Task 4/5: left-rail and right-rail content are
  // JS-injected innerHTML too (same reason as the AI checkboxes above) —
  // the data-i18n sweep can't reach them, re-render explicitly for
  // whichever panel is current. Wrapped: see goStep()'s identical guard
  // in js/state-nav.js for why.
  try{
    if(typeof renderShellLeftRail==="function" && APP.currentStep){
      renderShellLeftRail(APP.currentStep);
    }
    if(typeof renderShellRightRail==="function" && APP.currentStep){
      renderShellRightRail(APP.currentStep);
    }
  }catch(err){
    console.error("Shell rail refresh failed on language switch:",err);
  }
}
function srT(key,params,count){
  const table = window.I18N_TABLES[window.SR_LANG] || SR_STRINGS_EN;
  let k=key;
  if(count!==undefined&&(table[key+"_one"]||table[key+"_other"]))k=(count===1)?key+"_one":key+"_other";
  let s=table[k]||SR_STRINGS_EN[k]||key;
  if(params)Object.keys(params).forEach(p=>{s=s.split("{{"+p+"}}").join(params[p]);});
  return s;
}

// Findings that mean "this child may need attention" — Data Error is
// deliberately excluded: it's a data-quality problem surfaced via the
// EXPORT_GATE banner, not a performance finding, and listing it here
// would misleadingly read as "this student is struggling."
const BUCKET_HELP_FLAG_TYPES=["at-risk","first-below-pass","declining","sharp-drop","absent","volatile","burnout","data-gap","plateau","peer-outlier-low"];
const BUCKET_TOP_FLAG_TYPES=["improving","resilient","peer-outlier-high"];

function bucketIsHelp(st){
  if((st.flags||[]).some(f=>BUCKET_HELP_FLAG_TYPES.includes(f.type)))return true;
  if(st.analysis&&st.analysis.wellbeingFlag&&st.analysis.wellbeingFlag!=="low")return true;
  if(st.analysis&&st.analysis.rankMovement<0)return true;
  return false;
}
function bucketIsTop(st){
  if(st.analysis&&st.analysis.rank<=3)return true;
  if((st.flags||[]).some(f=>BUCKET_TOP_FLAG_TYPES.includes(f.type)))return true;
  if(st.analysis&&st.analysis.competitiveReadiness==="High")return true;
  if(st.analysis&&st.analysis.rankMovement>0)return true;
  return false;
}

function renderBuckets(){
  updateExportGate(); // EXPORT_GATE invariant: re-derive every time the Dashboard step is entered, same as renderDashboard() does — buckets is now an alternate entry point, not a replacement for the gate check.
  $("#individual-student-switcher").css("display", APP.setup.mode==="individual" ? "flex" : "none");
  if(APP.compareMode){
    $("#bucket-screen,#bucket-list-screen").hide();
    $("#panel-export").hide();
    // v4.22-compare-mode-shell-parity §2/§3/§4: restore whichever
    // section/group was last active (re-entry — e.g. leaving to Setup and
    // coming back), or default to the first valid section on fresh entry
    // ("BUILD spec §3: default landing is the first uploaded file's own
    // result, never the Compare overview" — same rule as before, just
    // driven from here instead of goStep()). Both helpers handle their
    // own show/hide + rail refresh, mirroring openBucket()/openIndividualBucket().
    if(APP._activeCompareGroupId && APP.sectionComparison && APP.sectionComparison.length){
      selectCompareGroup(APP._activeCompareGroupId);
    } else {
      const validSecs=(APP.sections||[]).filter(s=>s.valid&&s.students);
      const stillValid=APP._activeCompareSectionId && validSecs.some(s=>s.id===APP._activeCompareSectionId);
      const targetId=stillValid ? APP._activeCompareSectionId : (validSecs[0]&&validSecs[0].id);
      if(targetId) selectCompareSection(targetId);
    }
    return;
  }
  // FEEDBACK #6 (UI bugs, item 6): the old KPI/cards/heatmap/wellbeing
  // dashboard is still fully implemented (renderDashboard() and friends) —
  // Compare Mode and Individual mode still use it directly (branches
  // above). The former "Classic Dashboard" manual toggle for Institution+
  // non-Compare mode is retired — prompt-v4.20 §1ii/§1iv removed its only
  // trigger (#btn-classic-dashboard), so there is exactly one view for
  // that combination now: the rail-driven bucket screen below.
  // v4.21-individual-mode-shell-parity §3: Individual mode now migrates
  // onto the same persistent-center pattern Institution mode already
  // uses — #bucket-answer-screen stays up, openIndividualBucket() just
  // re-populates it in place, instead of the old #bucket-screen (full
  // tile grid) → #bucket-answer-screen two-level swap. "report" (Progress
  // Report) is the default landing bucket — the closest analog to
  // Institution's "class" default (richest, most-summary view).
  if(APP.setup.mode==="individual"){
    populateIndividualSwitcher();
    $("#bucket-screen,#bucket-list-screen").hide();
    $("#legacy-dashboard-body").hide();
    $("#panel-export").hide();
    $("#bucket-answer-screen").show();
    if(typeof setShellRailsOpen==="function") setShellRailsOpen(true);
    openIndividualBucket(window._individualBucketCurrent||"report");
    return;
  }
  // ui-prompt-template.md item 7: rail-driven, in-place Dashboard for
  // Institution + non-Compare mode (per PIB §9 smart-reveal-scope — Compare
  // mode keeps its own separate branch above, unchanged. Individual mode
  // used to be a second unchanged early-return here too, but is now
  // migrated onto this identical pattern by its own branch above —
  // v4.21-individual-mode-shell-parity — just with a different bucket set
  // via buildIndividualDashboardControlsHtml() instead of
  // buildDashboardControlsHtml()). #bucket-screen and #bucket-list-screen
  // are retired for both modes now — left empty/hidden —
  // #bucket-answer-screen is now the single, persistent, always-visible
  // center content area; the old full-screen bucket-grid moved to the left
  // rail (buildDashboardControlsHtml(), called from renderShellLeftRail()),
  // and the student/subject/help/Smart-Search pickers moved to the right
  // rail (renderDashboardPropertiesRail(), called from renderShellRightRail()).
  $("#bucket-screen,#bucket-list-screen").hide();
  $("#legacy-dashboard-body").hide();
  $("#bucket-answer-screen").show();
  // ui-prompt-batch2.md item 1: Smart (bucket) Dashboard, general — rails
  // open. Also covers "reopen automatically when switching back from
  // Classic to Smart," since this is the same code path either way.
  if(typeof setShellRailsOpen==="function") setShellRailsOpen(true);
  openBucket(APP._currentBucketId || "class");
}

// Icon set + control list shared by the left rail (buildDashboardControlsHtml,
// js/vs-shell.js calls this) and, historically, the old #bucket-screen card
// grid this replaced. badge counts (helpCount/topCount/cluster count) are
// computed fresh every call — same values renderBuckets() always used, not a
// new computation.
const DASHBOARD_CONTROL_ICONS={
  class:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>',
  student:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 21a8 8 0 1 0-16 0"/><circle cx="12" cy="8" r="4"/></svg>',
  subject:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  help:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.71 3.86a2 2 0 0 0-3.42 0z"/></svg>',
  top:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4a2 2 0 0 0 2 2"/><path d="M17 6h3a2 2 0 0 1-2 2"/></svg>',
  compare:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 3v18"/><path d="M16 3v18"/><path d="M3 8h5"/><path d="M16 8h5"/><path d="M3 16h5"/><path d="M16 16h5"/></svg>',
  clusters:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/></svg>',
  smart:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>',
  export:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3.3 8.5l8.7 4.5 8.7-4.5"/><path d="M12 22V13"/></svg>'
};
// item 7g/h (OPEN QUESTION, confirmed by user: one merged list): "Smart
// Search" is listed here as an ordinary control alongside the others.
// v4.23-smart-query-chat: its center-panel answer is now a real chat
// window wired to SmartQueryV2.ask() (renderDashboardSmartSearch()/
// smartChatSubmit()/smartChatRunQuery() below), and its canned-question
// list moved into the LEFT rail (buildSmartQueryCannedQuestionsHtml(),
// appended by renderShellLeftRail() when this bucket is active) — not the
// right rail, which now closes for this bucket like the other
// no-per-item-picker buckets.
function buildDashboardControlsHtml(){
  const students=APP.students||[];
  const helpCount=students.filter(bucketIsHelp).length;
  const topCount=students.filter(bucketIsTop).length;
  const buckets=[
    {id:"class",label:srT("bucket_class_label"),desc:srT("bucket_class_desc"),badge:null},
    {id:"student",label:srT("bucket_student_label"),desc:srT("bucket_student_desc"),badge:null},
    {id:"subject",label:srT("bucket_subject_label"),desc:srT("bucket_subject_desc"),badge:null},
    {id:"help",label:srT("bucket_help_label"),desc:srT("bucket_help_desc"),badge:helpCount},
    {id:"top",label:srT("bucket_top_label"),desc:srT("bucket_top_desc"),badge:topCount},
    {id:"compare",label:"Compare Two Students",desc:"Side-by-side stats for any two students in this class",badge:null}
  ];
  if(APP.cohortClusters&&APP.cohortClusters.groups&&APP.cohortClusters.groups.length){
    buckets.push({id:"clusters",label:srT("bucket_clusters_label"),desc:srT("bucket_clusters_desc"),badge:APP.cohortClusters.groups.length});
  }
  buckets.push({id:"smart",label:srT("bucket_smart_label"),desc:srT("bucket_smart_desc"),badge:null});
  buckets.push({id:"export",label:srT("bucket_export_label"),desc:srT("bucket_export_desc"),badge:null});
  const active=APP._currentBucketId||"class";
  const rows=buckets.map(b=>{
    const badgeHtml=(b.badge!==null)?`<span class="bucket-badge">${esc(srT("bucket_count_badge",{count:b.badge},b.badge))}</span>`:"";
    const activeClass=(!APP._forceLegacyView && b.id===active)?" bucket-row-active":"";
    return `<div class="bucket-row${activeClass}" role="button" tabindex="0" onclick="openBucket('${b.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openBucket('${b.id}');}">
      <span class="bucket-icon" aria-hidden="true">${DASHBOARD_CONTROL_ICONS[b.id]}</span>
      <span class="bucket-text"><span class="bucket-label">${esc(b.label)}</span><span class="bucket-desc">${esc(b.desc)}</span></span>
      ${badgeHtml}
    </div>`;
  }).join("");
  return `<div class="bucket-list">${rows}</div>`;
}
const COMPARE_ROW_ICONS={
  section:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21V15h6v6"/><path d="M9 7h1M9 11h1M14 7h1M14 11h1"/></svg>',
  group:'<svg class="ic" width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/></svg>'
};
// v4.22-compare-mode-shell-parity §1: replaces #compare-section-picker's
// inline dropdown — same data populateCompareSectionPicker() used to
// assemble (every valid section, plus one row per computeCompareGroups()
// match of 2+ sections), same .bucket-list/.bucket-row markup as every
// other rail list in the app. Active row keyed off APP._activeCompareSectionId
// (a section) or a null value while APP.sectionComparison is populated
// (viewing the "Compare Sections" group view instead).
function buildCompareSectionListHtml(){
  const secs=(APP.sections||[]).filter(s=>s.valid&&s.students);
  const groups=(APP.compareGroups||[]).filter(g=>g.sections.length>=2);
  const activeSectionId=APP._activeCompareSectionId||null;
  const viewingGroup=!activeSectionId && APP.sectionComparison && APP.sectionComparison.length;
  const groupRows=groups.map(g=>{
    const activeClass=(viewingGroup && APP._activeCompareGroupId===g.id)?" bucket-row-active":"";
    const label="Compare: "+g.sections.map(s=>s.label).join(", ");
    return `<div class="bucket-row${activeClass}" role="button" tabindex="0" onclick="selectCompareGroup('${esc(g.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectCompareGroup('${esc(g.id)}');}">
      <span class="bucket-icon" aria-hidden="true">${COMPARE_ROW_ICONS.group}</span>
      <span class="bucket-text"><span class="bucket-label">${esc(label)}</span><span class="bucket-desc">${g.sections.length} sections, side-by-side ranking</span></span>
    </div>`;
  }).join("");
  const sectionRows=secs.map(s=>{
    const activeClass=(activeSectionId===s.id)?" bucket-row-active":"";
    return `<div class="bucket-row${activeClass}" role="button" tabindex="0" onclick="selectCompareSection('${esc(s.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectCompareSection('${esc(s.id)}');}">
      <span class="bucket-icon" aria-hidden="true">${COMPARE_ROW_ICONS.section}</span>
      <span class="bucket-text"><span class="bucket-label">${esc(s.label)}</span><span class="bucket-desc">${s.students.length} students — full dashboard</span></span>
    </div>`;
  }).join("");
  return `<div class="bucket-list">${groupRows}${sectionRows}</div>`;
}
// Classic/Smart toggle retired (prompt-v4.20 §1ii/§1iv) — showLegacyDashboard()/
// showSmartBucketView() no longer have any caller (both used APP._forceLegacyView,
// which is now permanently false). Left undefined rather than kept-as-dead-code:
// nothing else in the app reads or calls them.

/* ── INDIVIDUAL/PARENT MODE BUCKETS ──
   Extends the same progressive-disclosure pattern used for Institution
   mode to Individual/Parent mode, instead of falling through to the older
   tile/tab body — per explicit design direction ("dashboard to smart
   search vice versa should be same theme and flawless... you decide").
   Reuses the SAME .bucket-list/.bucket-row/.bucket-answer-title CSS
   classes (visual consistency, zero new styles) and the SAME real
   narrative generators already used elsewhere (generateParentMessage,
   generateHomePlan, generateTrendFacts) — no fabricated content, this is
   the same data the old Individual-mode legacy body showed, just entered
   through one tap instead of shown all at once. generateSchoolPlan is
   intentionally NOT used here — it's teacher-facing guidance, not
   appropriate for a parent/individual-aspirant audience (see its own
   comment in generateSchoolPlan()). Two-level flow (list -> answer),
   simpler than Institution's three-level flow, since there's no
   "which student" picker step — the child-switcher above already
   selects that. ── */
function currentIndividualStudent(){
  const sts=APP.students||[];
  if(!sts.length) return null;
  if(!APP.individualSelectedId||!sts.find(s=>s.id===APP.individualSelectedId)) APP.individualSelectedId=sts[0].id;
  return sts.find(s=>s.id===APP.individualSelectedId)||sts[0];
}
const INDIVIDUAL_BUCKET_ICONS={
  report:'<svg class="ic" width="1.4em" height="1.4em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
  subjects:'<svg class="ic" width="1.4em" height="1.4em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  plan:'<svg class="ic" width="1.4em" height="1.4em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  wellbeing:'<svg class="ic" width="1.4em" height="1.4em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  smart:'<svg class="ic" width="1.4em" height="1.4em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>'
};
// Pure — returns Individual mode's bucket definitions for the given
// (already-resolved) current child, no DOM access. Single source of
// truth for both the rail builder below and anything else that needs
// to know what buckets exist for this child (e.g. picking a default id).
function individualBucketDefs(st){
  const buckets=[
    {id:"report",label:i18nLabel("individual_bucket_report_label","Progress Report"),desc:i18nLabel("individual_bucket_report_desc","Overall summary, trend and where things stand")},
    {id:"subjects",label:i18nLabel("individual_bucket_subjects_label","Subjects & Marks"),desc:i18nLabel("individual_bucket_subjects_desc","Test-by-test marks and subject breakdown")},
    {id:"plan",label:i18nLabel("individual_bucket_plan_label","Recommendations"),desc:i18nLabel("individual_bucket_plan_desc","What to focus on at home this week")}
  ];
  if(st && st.analysis && st.analysis.wellbeingFlag){
    buckets.push({id:"wellbeing",label:i18nLabel("individual_bucket_wellbeing_label","Wellbeing"),desc:i18nLabel("individual_bucket_wellbeing_desc","Stress and engagement signals")});
  }
  buckets.push({id:"smart",label:i18nLabel("bucket_smart_label","Smart Search ✨"),desc:i18nLabel("bucket_smart_desc","Ask anything about this student")});
  return buckets;
}
// v4.21-individual-mode-shell-parity §1: left-rail builder for Individual
// mode, mirroring buildDashboardControlsHtml() exactly (same .bucket-list/
// .bucket-row/icon/badge/active-highlight markup) — Institution mode and
// Individual mode's bucket lists now look and behave identically, just
// built from a different bucket set and a different "current id" tracker
// (window._individualBucketCurrent instead of APP._currentBucketId).
function buildIndividualDashboardControlsHtml(){
  const st=currentIndividualStudent();
  if(!st) return `<div class="bucket-list"><div class="bucket-row" style="cursor:default"><span class="bucket-text"><span class="bucket-label">No student data yet</span></span></div></div>`;
  const buckets=individualBucketDefs(st);
  const active=window._individualBucketCurrent||"report";
  const rows=buckets.map(b=>{
    const activeClass=(b.id===active)?" bucket-row-active":"";
    return `<div class="bucket-row${activeClass}" role="button" tabindex="0" onclick="openIndividualBucket('${b.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openIndividualBucket('${b.id}');}">
      <span class="bucket-icon" aria-hidden="true">${INDIVIDUAL_BUCKET_ICONS[b.id]}</span>
      <span class="bucket-text"><span class="bucket-label">${esc(b.label)}</span><span class="bucket-desc">${esc(b.desc)}</span></span>
    </div>`;
  }).join("");
  return `<div class="bucket-list">${rows}</div>`;
}
function openIndividualBucket(id){
  const st=currentIndividualStudent();
  if(!st) return;
  window._individualBucketCurrent=id;
  // v4.21 §5: same active-row refresh pattern Institution's openBucket()
  // already has, so the left-rail bucket list (now where the picker
  // actually lives, §1/§2) highlights whichever bucket is open.
  try{
    if(typeof renderShellLeftRail==="function") renderShellLeftRail("dashboard");
  }catch(err){
    console.error("Shell left-rail refresh failed in openIndividualBucket:",id,err);
  }
  // v4.21 §4: none of Individual mode's four buckets have a per-item
  // picker (the child switcher above already narrows to one student, so
  // there's nothing left to pick inside a bucket) — close the right rail
  // for all four, same "no properties" pattern Institution's picker-less
  // buckets (Compare/Clusters/Top) already use.
  if(typeof setRightRail==="function") setRightRail("");
  if(typeof setShellRailOpen==="function") setShellRailOpen("end", false);
  if(id==="report") return renderIndividualReportAnswer(st);
  if(id==="subjects") return renderIndividualSubjectsAnswer(st);
  if(id==="plan") return renderIndividualPlanAnswer(st);
  if(id==="wellbeing") return renderIndividualWellbeingAnswer(st);
  if(id==="smart") return renderDashboardSmartSearch();
}
function backToIndividualBuckets(){
  // v4.21: retired along with #bucket-screen/#bucket-list-screen for
  // Individual mode — the bucket list lives permanently in the left rail
  // now, so there's no separate "back to list" screen to return to. Kept
  // as a no-op (not deleted) in case anything still references it from
  // old inline onclick markup that wasn't caught by this migration.
}
function renderIndividualReportAnswer(st){
  const a=st.analysis||{};
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">Progress Report — ${esc(st.name)}</div>
    <div class="bucket-answer-sub">Overall: ${esc(String(a.overallAvg))}% · Grade ${esc(a.grade||"-")} · Trend: ${esc(a.trend||"-")}</div>
    <div class="bucket-answer-body">
      <p>${esc(generateParentMessage(st))}</p>
      <p>${esc(generateWhatChangedSummary(st))}</p>
      <p>${esc(generateTrendFacts(st))}</p>
    </div>
    <div class="chart-container" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="card-title">Progress Trend</div>
        <button class="btn btn-secondary btn-sm" onclick="shareInsightAsImage('${esc(st.id)}')"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M12 15V3'/><path d='M7 8l5-5 5 5'/><path d='M4 21h16'/></svg> Share as Image</button>
      </div>
      <canvas id="bucket-chart-student-trend"></canvas>
    </div>
    <div class="card" id="target-score-card" style="padding:14px 16px;margin-top:14px"></div>
  `).addClass("screen-fade-in").show();
  renderBucketStudentTrendChart("bucket-chart-student-trend",st);
  renderTargetScoreCard(st.id);
}
// TASK (Project Bible v2 §5, "target-score tracker"): "Let a parent type
// a target % for the next test; show gap vs. predictedNext. Pure UI
// state (in-memory only, resets on reload per NO_PERSISTENCE) — no
// schema change." _targetScoreInputs deliberately lives only as a plain
// module-level variable — never written to APP.setup, st.analysis, or
// anything else that gets read/exported anywhere — so it satisfies
// NO_PERSISTENCE by construction: a page reload (or even just re-running
// analysis) wipes it, same as any other unsaved browser state.
let _targetScoreInputs={};
function renderTargetScoreCard(studentId){
  const st=APP.students.find(s=>s.id===studentId);if(!st)return;
  const a=st.analysis||{};
  const savedTarget=_targetScoreInputs[studentId];
  const html=`<div class="card-title" style="margin-bottom:8px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><circle cx='12' cy='12' r='10'/><circle cx='12' cy='12' r='6'/><circle cx='12' cy='12' r='2'/></svg> Target for Next Test</div>
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <label style="font-size:12.5px;color:var(--c-text2)">Target %</label>
      <input type="number" id="target-score-input" min="0" max="100" step="1" value="${savedTarget!=null?savedTarget:""}" placeholder="e.g. 85" style="width:80px;text-align:center;padding:6px 8px;border:1px solid var(--c-border);border-radius:var(--r-sm);font-size:13px" oninput="setTargetScore('${esc(studentId)}',this.value)"/>
    </div>
    <div id="target-score-gap" style="margin-top:10px"></div>
    <div style="font-size:11px;color:var(--c-text3);margin-top:8px">This target is just for you to plan around — it isn't saved anywhere and resets if you reload or re-analyse.</div>`;
  $("#target-score-card").html(html);
  renderTargetScoreGap(studentId);
}
function setTargetScore(studentId,val){
  const n=parseFloat(val);
  if(val===""||isNaN(n)){delete _targetScoreInputs[studentId];}
  else{_targetScoreInputs[studentId]=Math.max(0,Math.min(100,n));}
  renderTargetScoreGap(studentId);
}
function renderTargetScoreGap(studentId){
  const st=APP.students.find(s=>s.id===studentId);if(!st)return;
  const a=st.analysis||{};
  const target=_targetScoreInputs[studentId];
  const el=$("#target-score-gap");
  if(target==null){el.html("");return;}
  if(a.predictedNext==null){
    el.html(`<div style="font-size:12.5px;color:var(--c-text3)">Not enough test history yet to project a next-test score (need at least 2 tests) — so there's nothing to compare your target against yet.</div>`);
    return;
  }
  const gap=Math.round((target-a.predictedNext)*10)/10;
  if(gap<=0){
    el.html(`<div style="padding:10px 12px;background:var(--c-success)18;border-radius:var(--r-sm);font-size:12.5px;color:var(--c-success);font-weight:600">On track — the current trend projects ${a.predictedNext}%, already at or above your ${target}% target.</div>`);
  }else{
    const severity=gap>15?"var(--c-danger)":"var(--c-warn)";
    el.html(`<div style="padding:10px 12px;background:${severity}18;border-radius:var(--r-sm);font-size:12.5px;color:${severity};font-weight:600">The current trend projects ${a.predictedNext}% — ${gap} point${gap===1?"":"s"} short of your ${target}% target.</div>`);
  }
}
function renderIndividualSubjectsAnswer(st){
  const avgs=(st.analysis&&st.analysis.subjectAvgs)||{};
  const rows=Object.entries(avgs).sort((a,b)=>a[1]-b[1]).map(([subj,val])=>`<div class="subject-row"><span>${esc(subj)}</span><span>${esc(String(val))}%</span></div>`).join("");
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">Subjects & Marks — ${esc(st.name)}</div>
    <div class="bucket-answer-body">
      <div class="subject-row-list">${rows||"<p>No subject data available yet.</p>"}</div>
    </div>
    <div class="chart-container" style="margin-top:14px"><div class="card-title">Progress Trend</div><canvas id="bucket-chart-student-trend2"></canvas></div>
  `).addClass("screen-fade-in").show();
  renderBucketStudentTrendChart("bucket-chart-student-trend2",st);
}
function renderIndividualPlanAnswer(st){
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">Recommendations — ${esc(st.name)}</div>
    <div class="bucket-answer-body"><p>${esc(generateHomePlan(st))}</p></div>
  `).addClass("screen-fade-in").show();
}
function renderIndividualWellbeingAnswer(st){
  const a=st.analysis||{};
  const note = a.wellbeingFlag==="high" ? "Worth a supportive conversation soon — academics aside." :
               a.wellbeingFlag==="moderate" ? "Keep an eye on this — not urgent, but worth noting." :
               "No particular concern at this time.";
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">Wellbeing — ${esc(st.name)}</div>
    <div class="bucket-answer-body"><p>Wellbeing flag: ${esc(a.wellbeingFlag)} (stress score ${esc(String(a.stressScore))}/100). ${esc(note)}</p></div>
  `).addClass("screen-fade-in").show();
}

// item f: sample-data banner, text only — no "Set Up My Own Class" button
// (that button called startNewSession(), which had an undiagnosed bug that
// could break the app from this context; removing the button made root-
// causing it moot — the same action is always reachable from Home anyway).
function renderDashboardSampleBanner(){
  const el=$("#dashboard-sample-banner");
  if(!APP._isSampleData){ el.html(""); return; }
  el.html(`<div class="card dashboard-sample-banner-card" style="padding:10px 14px;margin-bottom:14px;border-color:var(--c-warn,#f9a826);background:#fff8ec;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <div style="font-size:12.5px;color:#8a5a00"><strong>You're viewing sample data.</strong> This is a demo — head to Home whenever you're ready to import your own class's marks.</div>
    <button type="button" class="btn btn-secondary btn-sm" onclick="APP._isSampleData=false;renderDashboardSampleBanner();" aria-label="Dismiss">✕</button>
  </div>`);
}

// v4.23-smart-query-chat §1: canned questions now live in the LEFT rail
// (below the bucket list), replacing the old right-rail question list —
// called from renderShellLeftRail() only while the Smart Search bucket is
// the active one. Tapping a question feeds the same chat flow (§4) a
// typed question would, via smartChatAskCanned() below — it does NOT
// answer separately in the rail the way the old right-rail list did.
// v4.29: Smart Search is now reachable from both Institution mode
// (APP._currentBucketId) and Individual mode (window._individualBucketCurrent)
// — each mode tracks its own active bucket separately, so call-sites that
// need to know "is the smart bucket showing right now" must check
// whichever tracker the current mode actually uses.
function isSmartBucketActive(){
  return APP.setup.mode==="individual"
    ? window._individualBucketCurrent==="smart"
    : APP._currentBucketId==="smart";
}
function buildSmartQueryCannedQuestionsHtml(){
  return ""; // Smart Search is gated behind a StudIn Pro notice; no canned-question list to show.
}
// Loader guard shared with the old rail implementation's naming, kept
// separate from vs-shell.js's own copy (different module scope) — same
// one-shot "don't double-load" behavior.
let _smartChatLoadAttempted=false;
function ensureSmartQueryLoaded(cb){
  if(!window.SmartQueryV2) return;
  if(SmartQueryV2.isReady()){ if(cb) cb(); return; }
  if(_smartChatLoadAttempted) return;
  _smartChatLoadAttempted=true;
  SmartQueryV2.load().then(function(){ if(cb) cb(); }).catch(function(){});
}

// v4.23-smart-query-chat §3: transcript lives only as a plain in-memory
// array, same pattern as _targetScoreInputs above — NO_PERSISTENCE, reset
// on reload or on leaving the bucket (see renderDashboardSmartSearch()).
let _smartChatTranscript=[];

// item g/h retired the old right-rail search+list UI (superseded by
// v4.23-smart-query-chat) — Smart Search is now a real chat window in the
// center panel, wired to SmartQueryV2.ask()/match() instead of a substring
// filter. Canned questions moved to the left rail (buildSmartQueryCannedQuestionsHtml()
// above); this just builds the thread+composer skeleton and clears the
// right rail (§2 — no per-item properties for this bucket, same "no
// properties" pattern as renderComparePicker()/renderClusterGroups()).
function renderDashboardSmartSearch(){
  if(typeof setRightRail==="function") setRightRail("");
  if(typeof setShellRailOpen==="function") setShellRailOpen("end", false);
  _smartChatTranscript=[];
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">${esc(srT("bucket_smart_label"))}</div>
    <div class="shell-empty-state" style="padding:48px 20px;text-align:center;font-size:14px" data-i18n="smart_search_pro_notice">${esc(srT("smart_search_pro_notice"))}</div>
  `);
}
function smartChatScrollToBottom(){
  const el=document.getElementById("chat-thread");
  if(el) el.scrollTop=el.scrollHeight;
}
function smartChatClearEmptyHint(){
  const el=document.getElementById("chat-thread");
  if(el && el.children.length===1 && el.children[0].className==="chat-empty-hint") el.innerHTML="";
}
function smartChatAppendUserBubble(text){
  smartChatClearEmptyHint();
  _smartChatTranscript.push({role:"user",text:text});
  const thread=document.getElementById("chat-thread");
  if(!thread) return;
  const bubble=document.createElement("div");
  bubble.className="chat-bubble chat-bubble-user";
  bubble.textContent=text;
  thread.appendChild(bubble);
  smartChatScrollToBottom();
}
// v4.23 §4.2/§5: brief, honest, generic thinking indicator — dots only,
// never fabricated "analyzing marks…" step text. The real answer is
// already computed synchronously by SmartQueryV2 before this ever shows;
// the delay is a pure reveal-timing affordance, capped low.
function smartChatAppendThinkingBubble(){
  const thread=document.getElementById("chat-thread");
  if(!thread) return null;
  const bubble=document.createElement("div");
  bubble.className="chat-bubble chat-bubble-thinking";
  bubble.innerHTML='<span class="chat-thinking-dot"></span><span class="chat-thinking-dot"></span><span class="chat-thinking-dot"></span>';
  thread.appendChild(bubble);
  smartChatScrollToBottom();
  return bubble;
}
function smartChatReplaceWithAnswerBubble(thinkingEl,text){
  _smartChatTranscript.push({role:"answer",text:text});
  if(!thinkingEl) return;
  thinkingEl.className="chat-bubble chat-bubble-answer";
  const reduced=window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(reduced){
    thinkingEl.textContent=text;
    smartChatScrollToBottom();
    return;
  }
  // v4.28 §3: word-by-word reveal — answer is already fully computed
  // above, this is timing-only (no fabricated intermediate content).
  const words=text.split(" ");
  let i=0;
  thinkingEl.textContent="";
  (function tick(){
    thinkingEl.textContent += (i>0?" ":"") + words[i];
    i++;
    smartChatScrollToBottom();
    if(i<words.length) setTimeout(tick,30);
  })();
}
function smartChatReplaceWithSuggestionsBubble(thinkingEl,results,deflectionText){
  _smartChatTranscript.push({role:"answer",text:deflectionText});
  if(!thinkingEl) return;
  thinkingEl.className="chat-suggestions";
  const chips=results.map(function(r){
    const idJs=String(r.id).replace(/'/g,"\\'");
    const labelJs=String(r.label).replace(/'/g,"\\'");
    return `<button type="button" class="chat-suggestion-chip" onclick="smartChatAskCanned('${idJs}','${labelJs}')">${esc(r.label)}</button>`;
  }).join("");
  thinkingEl.innerHTML=`<div class="chat-bubble chat-bubble-answer">${esc(deflectionText)}</div>${chips}`;
  smartChatScrollToBottom();
}
// v4.23 §0/§4: submit flow, ported verbatim from vs-shell.js's dead
// smartQueryRailAsk_run() (ask() first, fall back to match() candidates
// as tappable chips on no confident hit, deflection message otherwise) —
// same control flow, retargeted at the chat thread instead of the rail.
function smartChatRunQuery(text){
  const userThinkingBubble=smartChatAppendThinkingBubble();
  const delay=280+Math.random()*220; // same rhythm as the AI-loader's sleep() elsewhere in this codebase
  setTimeout(function(){
    // v4.28 Cause A fix: call match() exactly once and derive both
    // outcomes (auto-answer vs. suggestion chips) from that single
    // result, instead of a doomed second call with identical input.
    const AUTO_ANSWER_THRESHOLD=6; // top.score>=6 auto-answers; lower-but-scored results become chips
    const m=SmartQueryV2.match(text,5);
    if(m.ok && m.results.length){
      const top=m.results[0];
      if(top.score>=AUTO_ANSWER_THRESHOLD){
        const answer=SmartQueryV2.answerQuestion(top.id);
        smartChatReplaceWithAnswerBubble(userThinkingBubble,answer.text);
      } else {
        smartChatReplaceWithSuggestionsBubble(userThinkingBubble,m.results,srT("smart_v2_deflection_hint"));
      }
    } else {
      smartChatReplaceWithAnswerBubble(userThinkingBubble,m.text||"I couldn't find a matching question.");
    }
  },delay);
}
function smartChatSubmit(){
  const input=document.getElementById("chat-composer-input");
  const text=input?input.value.trim():"";
  if(!text) return;
  if(input) input.value="";
  smartChatAppendUserBubble(text);
  if(!window.SmartQueryV2) return;
  if(!SmartQueryV2.isReady()){
    ensureSmartQueryLoaded(function(){ smartChatRunQuery(text); });
    return;
  }
  smartChatRunQuery(text);
}
// Tapping a canned question (left rail, §1, or a suggestion chip in the
// thread, §4.3) — answerQuestion(id) is already known-good for this
// exact id, so it always resolves to a real answer bubble, no fallback
// branch needed here (mirrors smartQueryRailAnswer()'s simplicity).
function smartChatAskCanned(questionId,label){
  smartChatAppendUserBubble(label);
  const thinkingBubble=smartChatAppendThinkingBubble();
  const delay=280+Math.random()*220;
  setTimeout(function(){
    if(!window.SmartQueryV2||!SmartQueryV2.isReady()){
      smartChatReplaceWithAnswerBubble(thinkingBubble,"Smart Search isn't available right now.");
      return;
    }
    const res=SmartQueryV2.answerQuestion(questionId);
    smartChatReplaceWithAnswerBubble(thinkingBubble,res.text);
  },delay);
}

function emptyStateHtml(text){
  return `<div class="bucket-empty">${esc(text)}</div>`;
}

function buildCompareExportControlsHtml(){
  const rows=[
    {label:srT("bucket_compare_report_label"),desc:srT("bucket_compare_report_desc")},
    {label:srT("bucket_persection_label"),desc:srT("bucket_persection_desc")}
  ].map(b=>`<div class="bucket-row" role="button" tabindex="0" onclick="openBucket('export')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openBucket('export');}">
    <span class="bucket-text"><span class="bucket-label">${esc(b.label)}</span><span class="bucket-desc">${esc(b.desc)}</span></span>
  </div>`).join("");
  return `<div class="bucket-list">${rows}</div>`;
}

function openBucket(id){
  // prompt-v4.20 §1xii follow-up fix: Export used to be a special-cased
  // early-return (scroll the always-rendered #panel-export into view) —
  // that's what caused its content to visually stack underneath whatever
  // bucket was previously open instead of replacing it, and it never set
  // APP._currentBucketId so the rail never highlighted it either. It's
  // handled as a normal bucket switch below now (see id==="export").
  window._bucketCurrent=id;
  APP._currentBucketId=id;
  APP._forceLegacyView=false; // selecting any control leaves Classic Dashboard view, per item 8/f
  try{
    if(typeof renderShellLeftRail==="function") renderShellLeftRail("dashboard"); // refresh active-row highlight
  }catch(err){
    console.error("Shell left-rail refresh failed in openBucket:",id,err);
  }
  // v4.20-bugfixes §2b/§2c: My Whole Class/Top Performers/Compare Two
  // Students/Performance Groups have no per-item right-rail content, so
  // collapse #shell-rail-end (animated, same transition as Setup/About/
  // FAQ's both-rails collapse); One Student/One Subject/Who Needs Help/
  // Smart Search/Export Reports DO populate real right-rail content, so
  // make sure it's re-opened in case a previous bucket had closed it.
  // #shell-rail-start (left rail) is untouched either way.
  if(typeof setShellRailOpen==="function"){
    const RAIL_END_CLOSED_FOR = {class:1,top:1,compare:1,clusters:1,smart:1};
    setShellRailOpen("end", !RAIL_END_CLOSED_FOR[id]);
  }
  // prompt-v4.20 §1iii: "My Whole Class" IS the rich KPI/tabs/student-card
  // dashboard (renderDashboard() into #legacy-dashboard-body) — not a
  // separate "Classic" toggle (that manual toggle is retired, see §1ii/iv
  // above), just what this one bucket renders. Every other bucket below
  // still uses the lighter #bucket-answer-screen content.
  if(id==="class"){
    $("#bucket-answer-screen,#panel-export").hide();
    $("#legacy-dashboard-body").show();
    renderDashboardSampleBanner();
    if(typeof setRightRail==="function") setRightRail("");
    renderDashboard();
    return;
  }
  // prompt-v4.20 §1xii follow-up fix: Export is a normal bucket switch too
  // now (was a special-cased scroll-to before — that's what caused its
  // content to stack underneath whatever bucket was previously open,
  // instead of replacing it). Center shows only #panel-export's "What
  // Gets Generated" cards; the student/report-type picker + Generate
  // button live in the right rail via renderExportPropertiesRail().
  if(id==="export"){
    $("#legacy-dashboard-body,#bucket-answer-screen").hide();
    $("#panel-export").show();
    renderDashboardSampleBanner();
    $("#exp-count").text((APP.students||[]).length);
    if(APP.compareMode && typeof populateExportSectionPicker==="function") populateExportSectionPicker();
    if(typeof renderExportPropertiesRail==="function") renderExportPropertiesRail();
    return;
  }
  $("#legacy-dashboard-body,#panel-export").hide();
  $("#bucket-answer-screen").show();
  renderDashboardSampleBanner();
  if(id==="student")return renderStudentPicker();
  if(id==="subject")return renderSubjectPicker();
  if(id==="help")return renderFilteredList("help");
  if(id==="top")return renderFilteredList("top");
  if(id==="clusters"){
    return renderClusterGroups();
  }
  if(id==="compare")return renderComparePicker();
  if(id==="smart")return renderDashboardSmartSearch();
}
// TASK (Project Bible v2 §5a, "Student-vs-student comparison — scoped
// correctly, Classic view"). Scope guard is implicit, not a separate
// check: both dropdowns are populated only from APP.students (the one
// currently-loaded roster), so a cross-file/cross-class comparison is
// structurally impossible here — there is no second roster to pick from.
// Smart Query v2's two-student question variant is not built here; that
// depends on js/smart-query-v2.js, which does not exist yet.
function renderComparePicker(){
  if(typeof setRightRail==="function") setRightRail(""); // item e: no properties for this control
  const students=APP.students||[];
  const opts=students.map(st=>`<option value="${esc(st.id)}">${esc(st.name)}</option>`).join("");
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">Compare Two Students</div>
    <div class="bucket-picker-hint">Pick any two students from this class — comparison only ever uses this same roster, so it's always apples-to-apples.</div>
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:10px">
      <select id="compare-pick-a" style="flex:1;min-width:180px;padding:8px 10px;border:1px solid var(--c-border);border-radius:var(--r-sm);font-size:13px" onchange="renderCompareResult()"><option value="">Select student A…</option>${opts}</select>
      <span style="color:var(--c-text3);font-weight:700">vs</span>
      <select id="compare-pick-b" style="flex:1;min-width:180px;padding:8px 10px;border:1px solid var(--c-border);border-radius:var(--r-sm);font-size:13px" onchange="renderCompareResult()"><option value="">Select student B…</option>${opts}</select>
    </div>
    <div id="compare-result" style="margin-top:16px"></div>
  `);
}
function renderCompareResult(){
  const idA=$("#compare-pick-a").val(),idB=$("#compare-pick-b").val();
  const el=$("#compare-result");
  if(!idA||!idB){el.html("");return;}
  if(idA===idB){el.html(`<div style="color:var(--c-text3);padding:10px">Pick two different students.</div>`);return;}
  const stA=(APP.students||[]).find(s=>s.id===idA),stB=(APP.students||[]).find(s=>s.id===idB);
  if(!stA||!stB)return;
  const a=stA.analysis||{},b=stB.analysis||{};
  const subjects=APP.setup.subjects||[];
  function rowsFor(label,valA,valB,unit,lowerIsBetter){
    let better=null;
    if(valA!==valB&&typeof valA==="number"&&typeof valB==="number"){
      better=(lowerIsBetter?valA<valB:valA>valB)?"A":"B";
    }
    return `<tr><td style="font-weight:600;color:var(--c-text2)">${esc(label)}</td>
      <td style="text-align:center;${better==="A"?"font-weight:700;color:var(--c-success)":""}">${valA!==null&&valA!==undefined?esc(String(valA))+(unit||""):"—"}</td>
      <td style="text-align:center;${better==="B"?"font-weight:700;color:var(--c-success)":""}">${valB!==null&&valB!==undefined?esc(String(valB))+(unit||""):"—"}</td></tr>`;
  }
  let rows="";
  rows+=rowsFor("Overall Average",a.overallAvg,b.overallAvg,"%");
  rows+=rowsFor("Grade",a.grade,b.grade,"");
  rows+=rowsFor("Rank",a.rank,b.rank,"",true);
  rows+=rowsFor("Trend",a.trend,b.trend,"");
  rows+=rowsFor("Consistency",a.consistencyScore,b.consistencyScore,"");
  rows+=rowsFor("Total Absences",a.totalAbsent,b.totalAbsent,typeof a.totalAbsent==="number"||typeof b.totalAbsent==="number"?" days":"",true);
  subjects.forEach(s=>{
    const va=(a.subjectAvgs||{})[s],vb=(b.subjectAvgs||{})[s];
    rows+=rowsFor(s,va!==undefined?va:null,vb!==undefined?vb:null,"%");
  });
  el.html(`<div style="overflow-x:auto"><table class="data-table"><thead><tr><th></th><th style="text-align:center">${esc(stA.name)}</th><th style="text-align:center">${esc(stB.name)}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="font-size:11px;color:var(--c-text3);margin-top:10px">Same class, same subjects, same tests, same max marks — this comparison is always apples-to-apples. Highlighted cell = better on that row.</div>`);
}
function backToBuckets(){
  $("#bucket-list-screen,#bucket-answer-screen").hide();
  $("#bucket-screen").show();
}
// Screen C → Screen B, same bucket, per spec (never back to A from here).
function backToBucketList(){
  $("#bucket-answer-screen").hide();
  showScreen("#bucket-list-screen");
}

// TASK 1c (studin-features-prompt v1.0): flags in this app are trend/class
// level, not tied to one specific test, so there's no direct flag→test
// link to key off. The Chapter field is only meaningful as "what was being
// taught", so when a flag's reason plausibly relates to a particular
// test's content, the most recent test that has a Chapter filled in is
// used. Purely additive — blank Chapter means zero change to the string.
const CHAPTER_RELEVANT_FLAG_TYPES=["at-risk","first-below-pass","sharp-drop","declining","burnout","plateau","volatile"];
function flagChapterSuffix(st,flagType){
  if(!CHAPTER_RELEVANT_FLAG_TYPES.includes(flagType))return "";
  const tests=(APP.setup&&APP.setup.tests)||[];
  for(let i=tests.length-1;i>=0;i--){
    const ch=(st.testData[tests[i].name]||{}).chapter;
    if(ch)return " · Chapter: "+ch;
  }
  return "";
}

// FEEDBACK #7 (UI bugs, item 7): the two separate stacked "← Dashboard" /
// "← Back" buttons looked like two competing back-actions on the same
// screen. Replaced with one single-line breadcrumb: "Dashboard › Back",
// same two destinations, one visual control.
function breadcrumbHtml(){
  return `<div class="bucket-breadcrumb">
    <a href="javascript:void(0)" onclick="backToBuckets()">${esc(srT("bucket_back_to_dashboard").replace("← ",""))}</a>
    <span class="crumb-sep">›</span>
    <a href="javascript:void(0)" onclick="backToBucketList()">${esc(srT("back").replace("← ",""))}</a>
  </div>`;
}

function bucketFindingReason(kind,st){
  const ew=(st.analysis&&st.analysis.explainedWarnings)||[];
  const types=kind==="help"?BUCKET_HELP_FLAG_TYPES:BUCKET_TOP_FLAG_TYPES;
  const hit=ew.find(f=>types.includes(f.type));
  if(hit)return hit.reason+flagChapterSuffix(st,hit.type);
  const first=(st.name||"").split(" ")[0]||st.name;
  if(kind==="help"){
    if(st.analysis&&st.analysis.wellbeingFlag&&st.analysis.wellbeingFlag!=="low")return `${first}'s stress/wellbeing indicators are ${st.analysis.wellbeingFlag} right now — worth a check-in.`;
    if(st.analysis&&st.analysis.rankMovement<0)return `${first} has slipped in class rank since the last test.`;
  }else{
    if(st.analysis&&st.analysis.rank<=3)return srT("finding_top_rank",{student:st.name,rank:st.analysis.rank});
    if(st.analysis&&st.analysis.competitiveReadiness==="High")return `${first} is showing high competitive readiness at ${st.analysis.overallAvg}%.`;
    if(st.analysis&&st.analysis.rankMovement>0)return `${first} has moved up in class rank since the last test.`;
  }
  return null;
}

// Same reason-collection logic openFinding() already used inline — factored
// out so the new "Who Needs Help" inline accordion (Bug 6b) can show the
// identical full detail without recomputing/duplicating the derivation.
function collectFindingReasons(kind,st){
  const a=st.analysis||{};
  const ew=(a.explainedWarnings||[]);
  const types=kind==="help"?BUCKET_HELP_FLAG_TYPES:BUCKET_TOP_FLAG_TYPES;
  const reasons=ew.filter(f=>types.includes(f.type)).map(f=>f.reason+flagChapterSuffix(st,f.type));
  if(kind==="top"&&a.rank<=3)reasons.push(`Ranked #${a.rank} in the class.`);
  if(kind==="top"&&a.competitiveReadiness==="High")reasons.push("Competitive readiness: High.");
  if(kind==="help"&&a.wellbeingFlag&&a.wellbeingFlag!=="low")reasons.push(`Wellbeing check: ${a.wellbeingFlag} stress indicators.`);
  return reasons.length?reasons:[srT("bucket_all_good")];
}

// BUG 6b FIX (studin-ui-bugs-prompt v1.0): "Who Needs Help" module-level
// expand state — session-only, one row open at a time, matching the
// Smart Search / FAQ accordion pattern used elsewhere.
let _helpOpenId=null;
function toggleHelpRow(studentId){
  const allBodies=document.querySelectorAll(".help-row-body");
  const allRows=document.querySelectorAll(".help-row");
  const thisBody=document.getElementById("help-body-"+studentId);
  const wasOpen=_helpOpenId===studentId;
  allBodies.forEach(b=>b.style.display="none");
  allRows.forEach(r=>r.classList.remove("bucket-row-open"));
  if(wasOpen){ _helpOpenId=null; return; }
  _helpOpenId=studentId;
  if(thisBody){
    if(thisBody.getAttribute("data-rendered")!=="true"){
      const st=(APP.students||[]).find(s=>s.id===studentId);
      const reasons=st?collectFindingReasons("help",st):[];
      thisBody.innerHTML=reasons.map(r=>`<p>${esc(r)}</p>`).join("")+
        `<button class="bucket-back-btn" style="padding:6px 0;min-height:auto" onclick="openFinding('help','${esc(studentId)}')">Open full profile →</button>`;
      thisBody.setAttribute("data-rendered","true");
    }
    thisBody.style.display="block";
    document.getElementById("help-row-"+studentId)?.classList.add("bucket-row-open");
  }
}

function renderFilteredList(kind){
  const students=APP.students||[];
  const filterFn=kind==="help"?bucketIsHelp:bucketIsTop;
  const items=students.filter(filterFn).map(st=>({st,reason:bucketFindingReason(kind,st)})).filter(x=>x.reason);
  if(kind==="top"){
    // item e: Top Performers keeps its existing rich list rendered
    // directly in the center panel, unchanged — right rail stays empty
    // (no per-item properties for this control).
    if(typeof setRightRail==="function") setRightRail("");
    const title=srT("bucket_top_label");
    let body;
    if(!items.length){
      body=`<div class="bucket-empty">${esc(srT("bucket_all_good"))}</div>`;
    }else{
      // Bug 6c: richer, consistent card for Top Performers — rank badge +
      // avg + best subject + trend, using only values already computed in
      // st.analysis (overallAvg, subjectAvgs, trend, rank) — no new
      // calculation, just a friendlier display of existing numbers.
      const trendLabel={improving:"↑ Improving",declining:"↓ Declining",stable:"→ Stable"};
      body=`<div class="finding-list">${items.map(x=>{
        const a=x.st.analysis||{};
        const subjectAvgs=a.subjectAvgs||{};
        const bestSubjectEntry=Object.entries(subjectAvgs).sort((p,q)=>q[1]-p[1])[0];
        const rankClass=a.rank===1?"rank-gold":a.rank===2?"rank-silver":a.rank===3?"rank-bronze":"rank-other";
        return `<div class="finding-row">
          <span class="rank-badge ${rankClass}" aria-hidden="true">#${esc(String(a.rank||"-"))}</span>
          <span class="bucket-text">
            <span class="bucket-student-name">${esc(x.st.name)}</span>
            <span class="bucket-meta-row">
              <span>Avg: ${esc(String(a.overallAvg))}%</span>
              ${bestSubjectEntry?`<span>Top subject: ${esc(bestSubjectEntry[0])}</span>`:""}
              <span>Trend: ${esc(trendLabel[a.trend]||a.trend||"-")}</span>
            </span>
          </span>
        </div>`;
      }).join("")}</div>`;
    }
    $("#bucket-answer-screen").html(`<div class="bucket-answer-title">${esc(title)}</div>${body}`);
    return;
  }
  // kind==="help" — item d: right rail = search + scrollable list of this
  // bucket's own filtered students (bucketIsHelp() matches), same pattern
  // as (c)'s student picker; first match pre-selected and shown by default.
  const rows=items.map(x=>`<div class="bucket-picker-row" onclick="openFinding('help','${esc(x.st.id)}')">${esc(x.st.name)}</div>`).join("");
  const railHtml=`
    <div style="display:flex;gap:8px;align-items:center">
      <input type="text" class="bucket-picker-input" placeholder="Search by name…" oninput="filterPickerList('bucket-help-results',this.value)" autocomplete="off" id="bucket-help-input" style="flex:1">
      <button type="button" onclick="document.getElementById('bucket-help-input').value='';filterPickerList('bucket-help-results','');" aria-label="Clear" title="Clear" style="flex-shrink:0;width:36px;height:36px;border:1px solid var(--c-border);border-radius:var(--r-sm);background:var(--c-surface);color:var(--c-text2);cursor:pointer;font-size:16px;line-height:1">×</button>
    </div>
    <div id="bucket-help-results" class="bucket-picker-list">${rows||emptyStateHtml(srT("bucket_all_good"))}</div>`;
  if(typeof setRightRail==="function") setRightRail(railHtml);
  if(items.length) openFinding("help",items[0].st.id);
  else $("#bucket-answer-screen").html(`<div class="bucket-answer-body">${esc(srT("bucket_all_good"))}</div>`);
}

function openFinding(kind,studentId){
  const st=(APP.students||[]).find(s=>s.id===studentId);
  if(!st)return;
  const a=st.analysis||{};
  const ew=(a.explainedWarnings||[]);
  const types=kind==="help"?BUCKET_HELP_FLAG_TYPES:BUCKET_TOP_FLAG_TYPES;
  const reasons=ew.filter(f=>types.includes(f.type)).map(f=>f.reason+flagChapterSuffix(st,f.type));
  if(kind==="top"&&a.rank<=3)reasons.push(`Ranked #${a.rank} in the class.`);
  if(kind==="top"&&a.competitiveReadiness==="High")reasons.push("Competitive readiness: High.");
  if(kind==="help"&&a.wellbeingFlag&&a.wellbeingFlag!=="low")reasons.push(`Wellbeing check: ${a.wellbeingFlag} stress indicators.`);
  const body=(reasons.length?reasons:[srT("bucket_all_good")]).map(r=>`<p>${esc(r)}</p>`).join("");
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">${esc(st.name)}</div>
    <div class="bucket-answer-sub">Overall: ${esc(String(a.overallAvg))}% · Rank #${esc(String(a.rank))} · Trend: ${esc(a.trend||"-")}</div>
    <div class="bucket-answer-body">${body}</div>
    <div class="chart-container" style="margin-top:14px"><div class="card-title">Progress Trend</div><canvas id="bucket-chart-finding-trend"></canvas></div>
  `);
  renderBucketStudentTrendChart("bucket-chart-finding-trend",st);
}

// ── COHORT CLUSTERS bucket (k-means, see computeCohortClusters()) ──
// Same Screen B / Screen C pattern as every other bucket: a list of the
// groups k-means found, then drill into one group to see its members and
// what actually distinguishes it (in the students' own real numbers, not
// standardized/z-scored — those are an internal computation detail, not
// something a teacher should have to read).
// prompt-v4.20 §1xi: Performance Groups is now 3 independent accordion
// cards rendered inline (native <details>, same pattern the shell rail's
// "File details" already uses) instead of a list-then-drill-in screen —
// first group open by default, the other two closed, each toggleable on
// its own, each member list scrolling internally instead of growing the
// page. openClusterGroup() (Screen-C drill-in) is no longer called from
// here but is left defined in case anything else still uses it.
function renderClusterGroups(){
  if(typeof setRightRail==="function") setRightRail(""); // item e: no properties for this control
  const cc=APP.cohortClusters;
  if(!cc||!cc.groups||!cc.groups.length){ $("#bucket-answer-screen").html(`<div class="bucket-empty">${esc(srT("bucket_all_good"))}</div>`); return; }
  const cards=cc.groups.map((g,i)=>{
    const c=g.centroid;
    const names=g.students.map(st=>`<div class="subject-row"><span>${esc(st.name)}</span><span>${esc(String(st.analysis.overallAvg))}% · Rank #${esc(String(st.analysis.rank))}</span></div>`).join("");
    return `<details class="shell-details cluster-group-card" name="cluster-group-accordion"${i===0?" open":""}>
      <summary class="shell-panel-title" style="cursor:pointer"><b>${esc(g.label)}</b> — ${g.students.length} student${g.students.length===1?"":"s"} · ${c.overallAvg}% avg · ${c.consistency} consistency</summary>
      <p style="font-size:12px;color:var(--c-text2);margin:8px 0">Group averages: ${c.overallAvg}% overall, trend ${c.slope>=0?"+":""}${c.slope} pts/test, ${c.absenceRate.toFixed(2)} absence days per test.</p>
      <div class="subject-row-list cluster-group-scroll">${names}</div>
    </details>`;
  }).join("");
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">${esc(srT("bucket_clusters_label"))}</div>
    <div class="bucket-picker-hint">Found by grouping students on average, consistency, trend and attendance together — not a single-number ranking. Groups only appear once a class is large enough (30+) for the pattern to be meaningful.</div>
    ${cards}
  `);
}
function openClusterGroup(clusterIndex){
  const cc=APP.cohortClusters;
  const g=cc&&cc.groups&&cc.groups.find(x=>x.clusterIndex===clusterIndex);
  if(!g)return;
  const names=g.students.map(st=>`<div class="subject-row"><span>${esc(st.name)}</span><span>${esc(String(st.analysis.overallAvg))}% · Rank #${esc(String(st.analysis.rank))}</span></div>`).join("");
  const c=g.centroid;
  const summary=`<p>${esc(g.label)} — ${g.students.length} of ${(APP.students||[]).length} students. Group averages: ${c.overallAvg}% overall, consistency score ${c.consistency}, trend ${c.slope>=0?"+":""}${c.slope} pts/test, ${c.absenceRate.toFixed(2)} absence days per test.</p>`;
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">${esc(g.label)}</div>
    <div class="bucket-answer-body">${summary}
      <div class="subject-row-list" style="margin-top:14px">${names}</div>
    </div>
  `).addClass("screen-fade-in").show();
}

// FEEDBACK #7 (UI bugs, item 7): the student/subject picker used to be a
// free-text input backed by a <datalist> — browsers render that as a
// generic autocomplete suggestion popup, not an actual visible list, and
// there was no clean way to "clear and see everything again". This is a
// real filterable list: every row is visible below the search box, typing
// narrows it, clicking a row selects it directly (no guessing at an exact
// string match), and Clear resets the search back to the full list.
function filterPickerList(listId,query){
  const q=String(query||"").trim().toLowerCase();
  document.querySelectorAll("#"+listId+" .bucket-picker-row").forEach(row=>{
    row.style.display=(!q||row.textContent.toLowerCase().includes(q))?"":"none";
  });
}

function renderStudentPicker(){
  const students=APP.students||[];
  const rows=students.map(st=>`<div class="bucket-picker-row" onclick="onBucketStudentPick('${esc(st.name)}')">${esc(st.name)}</div>`).join("");
  const railHtml=`
    <div class="bucket-picker-hint">${esc(srT("student_picker_prompt"))}</div>
    <div style="display:flex;gap:8px;align-items:center">
      <input type="text" class="bucket-picker-input" placeholder="Search by name…" oninput="filterPickerList('bucket-student-results',this.value)" autocomplete="off" id="bucket-student-input" style="flex:1">
      <button type="button" onclick="document.getElementById('bucket-student-input').value='';filterPickerList('bucket-student-results','');" aria-label="Clear" title="Clear" style="flex-shrink:0;width:36px;height:36px;border:1px solid var(--c-border);border-radius:var(--r-sm);background:var(--c-surface);color:var(--c-text2);cursor:pointer;font-size:16px;line-height:1">×</button>
    </div>
    <div id="bucket-student-results" class="bucket-picker-list">${rows||emptyStateHtml(srT("bucket_all_good"))}</div>`;
  if(typeof setRightRail==="function") setRightRail(railHtml);
  // item c: first student pre-selected and shown as soon as the control
  // opens — no click required to see something.
  if(students.length) onBucketStudentPick(students[0].name);
  else if(typeof setLeftRail==="function") $("#bucket-answer-screen").html(`<div class="bucket-answer-body">${esc(srT("bucket_all_good"))}</div>`);
}
function onBucketStudentPick(name){
  const st=(APP.students||[]).find(s=>(s.name||"").trim().toLowerCase()===String(name).trim().toLowerCase());
  if(!st)return;
  $("#bucket-answer-screen").html(`<div class="bucket-answer-body">${buildStudentDetailHtml(st)}</div>`);
}

function renderSubjectPicker(){
  const subjects=(APP.setup&&APP.setup.subjects)||[];
  const rows=subjects.map(s=>`<div class="bucket-picker-row" onclick="onBucketSubjectPick('${esc(s)}')">${esc(s)}</div>`).join("");
  const railHtml=`
    <div class="bucket-picker-hint">${esc(srT("subject_picker_prompt"))}</div>
    <div style="display:flex;gap:8px;align-items:center">
      <input type="text" class="bucket-picker-input" placeholder="Search by subject…" oninput="filterPickerList('bucket-subject-results',this.value)" autocomplete="off" id="bucket-subject-input" style="flex:1">
      <button type="button" onclick="document.getElementById('bucket-subject-input').value='';filterPickerList('bucket-subject-results','');" aria-label="Clear" title="Clear" style="flex-shrink:0;width:36px;height:36px;border:1px solid var(--c-border);border-radius:var(--r-sm);background:var(--c-surface);color:var(--c-text2);cursor:pointer;font-size:16px;line-height:1">×</button>
    </div>
    <div id="bucket-subject-results" class="bucket-picker-list">${rows||emptyStateHtml(srT("bucket_all_good"))}</div>`;
  if(typeof setRightRail==="function") setRightRail(railHtml);
  // item c: first subject pre-selected and shown by default, same rule as students.
  if(subjects.length) onBucketSubjectPick(subjects[0]);
  else $("#bucket-answer-screen").html(`<div class="bucket-answer-body">${esc(srT("bucket_all_good"))}</div>`);
}
function onBucketSubjectPick(name){
  const subjects=(APP.setup&&APP.setup.subjects)||[];
  const subject=subjects.find(s=>s.trim().toLowerCase()===String(name).trim().toLowerCase());
  if(!subject)return;
  const students=APP.students||[];
  const cs=APP.classStats||{};
  const sw=(cs.subjectWeakness||[]).find(x=>x.subject===subject);
  const summary=sw?`<p>Class average in ${esc(subject)}: ${esc(String(sw.avgClass))}%. ${esc(String(sw.pctBelow))}% of students are below the pass mark.</p>`:`<p>No data yet for ${esc(subject)}.</p>`;
  const rows=students.map(st=>({name:st.name,avg:(st.analysis&&st.analysis.subjectAvgs&&st.analysis.subjectAvgs[subject])||0})).sort((a,b)=>a.avg-b.avg);
  const rowsHtml=rows.map(r=>`<div class="subject-row"><span>${esc(r.name)}</span><span>${esc(String(r.avg))}%</span></div>`).join("");
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">${esc(subject)}</div>
    <div class="bucket-answer-body">${summary}
      <div class="chart-container" style="margin-top:14px"><div class="card-title">${esc(subject)} — Distribution</div><canvas id="bucket-chart-subjectdist"></canvas></div>
      <div class="subject-row-list" style="margin-top:14px">${rowsHtml}</div>
    </div>
  `);
  renderBucketSubjectDistChart("bucket-chart-subjectdist",rows);
}

function renderClassAnswer(){
  if(typeof setRightRail==="function") setRightRail(""); // item 7a: no properties for this control
  const cs=APP.classStats||{};
  const parts=[];
  if(cs.mean!==undefined&&cs.mean!==null)parts.push(`<p>Class average: ${esc(String(cs.mean))}% (median ${esc(String(cs.median))}%). Range: ${esc(String(cs.min))}%–${esc(String(cs.max))}%.</p>`);
  if(cs.subjectWeakness&&cs.subjectWeakness.length){
    const worst=cs.subjectWeakness[0];
    parts.push(`<p>Weakest subject class-wide: ${esc(worst.subject)} — class average ${esc(String(worst.avgClass))}%, ${esc(String(worst.pctBelow))}% of students below the pass mark.</p>`);
  }
  if(cs.attendanceCorrelation){
    const ac=cs.attendanceCorrelation;
    parts.push(`<p>Students with no absences average ${esc(String(ac.noAbsence.avg))}% vs ${esc(String(ac.someAbsence.avg))}% for those with some absence.</p>`);
  }
  if(APP.genderAnalysis){
    parts.push(`<p>A gender comparison is available in the full dashboard's Class Insights tab.</p>`);
  }
  if(!parts.length)parts.push(`<p>${esc(srT("bucket_all_good"))}</p>`);
  const sts=APP.students||[];
  const chartsHtml=sts.length?`
    <div class="chart-container" style="margin-top:14px"><div class="card-title">Subject Averages</div><canvas id="bucket-chart-classsubj"></canvas></div>
    <div class="chart-container" style="margin-top:14px"><div class="card-title">Class Trend Over Tests</div><canvas id="bucket-chart-classtrend"></canvas></div>
    <div class="card" style="margin-top:14px">
      <div class="card-title" style="margin-bottom:8px">Performance Heatmap — Student × Subject</div>
      <div class="heatmap-wrap" id="bucket-heatmap-wrap"></div>
    </div>`:"";
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">${esc(srT("bucket_class_label"))}</div>
    <div class="bucket-answer-body">${parts.join("")}</div>
    ${chartsHtml}
  `);
  if(sts.length)renderBucketClassCharts();
}

function renderDashboard(){
  const s=APP.setup;$("#db-class-label").text([s.instName,s.className,s.section,s.year,s.teacher].filter(Boolean).join(" · "));
  renderDataIssueBanner();
  updateExportGate();
  const isIndividual=s.mode==="individual";
  // Chrome that only makes sense when comparing many students against
  // each other gets hidden entirely in Individual mode, rather than shown
  // with misleading/empty cohort numbers.
  $("#individual-student-switcher").css("display",isIndividual?"flex":"none");
  $("#db-filter-bar").toggle(!isIndividual);
  $("#dbtab-insights").toggle(!isIndividual);
  $("#cohort-charts-row").toggle(!isIndividual);
  $("#individual-charts-note").toggle(isIndividual);
  if(isIndividual){
    populateIndividualSwitcher();
    // Insights tab is cohort-only (attendance correlation, subject weakness
    // averaged across a class) — if it was left active from Institution
    // mode, fall back to Students so nothing hidden stays "selected".
    if($("#dbtab-insights").hasClass("active")||$("#tab-insights").hasClass("active")){switchDbTab("students",$("#dbtab-students")[0]);}
  }
  renderKPIs();renderStudentCards();renderHeatmap();renderCharts();renderWellbeingPanel();renderFlagsTable();
  if(!isIndividual)renderClassInsights();
}
function populateIndividualSwitcher(){
  const sel=$("#individual-student-select");
  const sts=APP.students;
  if(!sts.length){sel.html("");return;}
  if(!APP.individualSelectedId||!sts.find(s=>s.id===APP.individualSelectedId))APP.individualSelectedId=sts[0].id;
  sel.html(sts.map(s=>`<option value="${esc(s.id)}" ${s.id===APP.individualSelectedId?"selected":""}>${esc(s.name)} (${esc(s.id)})</option>`).join(""));
}
function selectIndividualStudent(id){
  APP.individualSelectedId=id;
  if($("#bucket-answer-screen").is(":visible")){
    // Individual bucket view active: refresh the left-rail bucket list for
    // the new child (wellbeing tile appears/disappears per-child), and
    // re-open whatever bucket answer was showing rather than dropping
    // back to a list screen — there is no separate list screen anymore.
    const reopenId=window._individualBucketCurrent;
    if(typeof renderShellLeftRail==="function") renderShellLeftRail("dashboard");
    if(reopenId){ openIndividualBucket(reopenId); }
    return;
  }
  renderKPIs();renderStudentCards();renderHeatmap();renderCharts();renderWellbeingPanel();renderFlagsTable();
}
// Export must never be reachable while APP.dataIssues has entries — those are
// mark cells that exceed a subject's max marks and silently inflate that
// student's percentage. Re-checked on every dashboard render and right after
// analysis, since dataIssues is only known once computeAnalysis() has run.
function updateExportGate(){
  const hasIssues=(APP.dataIssues||[]).length>0;
  const reason="Fix the data quality issues shown on the Dashboard, then re-import, before exporting.";
  $("#btn-generate-pdfs").prop("disabled",hasIssues).css({opacity:hasIssues?.45:1,cursor:hasIssues?"not-allowed":"pointer"}).attr("title",hasIssues?reason:"");
  $("#btn-goto-export-dash").prop("disabled",hasIssues).css({opacity:hasIssues?.45:1,cursor:hasIssues?"not-allowed":"pointer"}).attr("title",hasIssues?reason:"");
  const exportTab=document.querySelector('[data-step="export"]');
  if(exportTab){
    if(hasIssues){exportTab.classList.add("locked");exportTab.setAttribute("title",reason);}
    else{exportTab.classList.remove("locked");exportTab.removeAttribute("title");}
  }
  // vs-shell-plan-v2 Task 5: right-rail export-ready status, re-derived
  // every time this function runs — same EXPORT_GATE invariant as the
  // rest of this function, not cached separately.
  if(typeof renderShellRightRail==="function" && APP.currentStep==="export") renderShellRightRail("export");
}
function renderKPIs(){
  const isIndividual=APP.setup.mode==="individual";
  const sts=APP.students,n=sts.length;if(!n)return;
  const s=APP.setup;
  $("#db-class-label").text([s.instName,s.className+(s.section?" "+s.section:"")].filter(Boolean).join(" — ")||(isIndividual?"Progress Dashboard":"Class Dashboard"));
  $("#db-mode-badge").html(isIndividual?"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M20 21a8 8 0 1 0-16 0'/><circle cx='12' cy='8' r='4'/></svg> Individual":"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><rect x='4' y='3' width='16' height='18' rx='1'/><path d='M9 21V15h6v6'/><path d='M9 7h1M9 11h1M14 7h1M14 11h1'/></svg> Institution"); // U1: persistent mode indicator visible on Dashboard
  $("#db-meta-label").text([s.year?s.year+" Academic Year":"",s.teacher?(isIndividual?"Mentor: "+s.teacher:"Teacher: "+s.teacher):""].filter(Boolean).join(" · "));
  // Alert badge
  const alertCount=APP.students.filter(st=>st.flags&&st.flags.length>0).length;
  $("#alert-badge").text(alertCount||"").toggle(alertCount>0);

  if(isIndividual){
    // Single-student KPIs — every number here is the selected student
    // against their own history / the target %, never against anyone else.
    const st=sts.find(s=>s.id===APP.individualSelectedId)||sts[0];
    const a=st.analysis;
    const metTarget=a.overallAvg>=APP.setup.passThreshold;
    const kpiCards=[
      {label:"Average",val:a.overallAvg+"%",sub:"",accent:a.overallAvg>=60?"#2ec4b6":"#f25454"},
      {label:"Grade",val:a.grade,sub:"",accent:"#4361ee"},
      {label:"Trend",val:a.trend.charAt(0).toUpperCase()+a.trend.slice(1),sub:"",accent:a.trend==="improving"?"#2ec4b6":a.trend==="declining"?"#f25454":"#4361ee"},
      {label:"Met Target",val:metTarget?"Yes":"Not Yet",sub:"Target "+APP.setup.passThreshold+"%",accent:metTarget?"#2ec4b6":"#f9a825"},
      {label:"Health Score",val:a.healthScore!=null?a.healthScore:"—",sub:a.healthBand||"",accent:"#2ec4b6"},
    ];
    $("#kpi-row").html(kpiCards.map(k=>`<div class="kpi-card" style="--kpi-accent:${k.accent}"><div class="kpi-label">${k.label}</div><div class="kpi-val" style="color:${k.accent=="#4361ee"?"var(--c-text)":k.accent}">${esc(String(k.val))}</div>${k.sub?`<div class="kpi-sub">${esc(k.sub)}</div>`:""}</div>`).join(""));
    $("#db-stats-bar").hide(); // median/SD/quartiles are cohort statistics, meaningless at n=1
    return;
  }

  const avgs=sts.map(s=>s.analysis.overallAvg),classAvg=Math.round(avgs.reduce((a,b)=>a+b,0)/n);
  const passing=sts.filter(s=>s.analysis.overallAvg>=APP.setup.passThreshold).length;
  const atRisk=sts.filter(s=>s.flags.find(f=>f.type==="at-risk")).length;
  const improving=sts.filter(s=>s.analysis.trend==="improving").length;
  const top=sts[0];
  // KPI strip with accent colours
  const passRate=Math.round(passing/n*100);
  const kpiCards=[
    {label:"Total Students",val:n,sub:"",accent:"#4361ee"},
    {label:"Class Avg",val:classAvg+"%",sub:"",accent:classAvg>=60?"#2ec4b6":"#f25454"},
    {label:"Pass Rate",val:passRate+"%",sub:passing+" of "+n,accent:passRate>=60?"#2ec4b6":"#f25454"},
    {label:"At Risk",val:atRisk,sub:"",accent:atRisk>0?"#f25454":"#2ec4b6"},
    {label:"Improving",val:improving,sub:"",accent:"#2ec4b6"},
    {label:"Class Topper",val:top?top.name.split(" ")[0]:"—",sub:top?top.analysis.overallAvg+"%":"",accent:"#f9a825"},
  ];
  $("#kpi-row").html(kpiCards.map(k=>`<div class="kpi-card" style="--kpi-accent:${k.accent}"><div class="kpi-label">${k.label}</div><div class="kpi-val" style="color:${k.accent=="#4361ee"?"var(--c-text)":k.accent}">${esc(String(k.val))}</div>${k.sub?`<div class="kpi-sub">${esc(k.sub)}</div>`:""}</div>`).join(""));
  // Stats bar
  const _cs=APP.classStats||computeClassStats();
  if(_cs&&_cs.median!=null){
    const _el=document.getElementById("db-stats-bar");
    if(_el){_el.innerHTML=`Median <b>${_cs.median}%</b> &nbsp;·&nbsp; SD <b>±${_cs.sd}</b> &nbsp;·&nbsp; Q1 <b>${_cs.q1}%</b> &nbsp;·&nbsp; Q3 <b>${_cs.q3}%</b> &nbsp;·&nbsp; ♥ Health <b>${_cs.healthAvg}</b>`;_el.style.display="block";}
  }
}
function renderStudentCards(){
  const isIndividual=APP.setup.mode==="individual";
  const filtered=getFilteredStudents();
  if(!filtered.length){$("#student-grid").html("<div style='color:var(--c-text3);padding:20px'>No students match the filter.</div>");return;}
  $("#student-grid").html(filtered.map(st=>{
    const a=st.analysis,color=a.overallAvg>=85?"var(--c-success)":a.overallAvg>=60?"var(--c-primary)":a.overallAvg>=APP.setup.passThreshold?"var(--c-warn)":"var(--c-danger)";
    const sparkData=a.testAvgs.filter(v=>v!==null);const sparkSvg=buildSparkPath(sparkData);
    const flagBadges=st.flags.slice(0,3).map(f=>`<span class="badge" style="background:${f.color}22;color:${f.color};border:1px solid ${f.color}44">${f.label}</span>`).join("");
    // Rank movement (v1.2, §new-feature): compares standing after the last
    // two tests specifically, not the final vs. first test — a purely
    // additive indicator alongside the existing final Rank #N. Rank itself
    // only means something when there's a cohort to rank within, so both
    // are dropped in Individual mode.
    const rm=a.rankMovement;
    const rmBadge=rm==null?"":rm>0?` <span style="color:var(--c-success);font-weight:700" title="Moved up ${rm} place(s) since the previous test">▲${rm}</span>`:rm<0?` <span style="color:var(--c-danger);font-weight:700" title="Moved down ${-rm} place(s) since the previous test">▼${-rm}</span>`:` <span style="color:var(--c-text3)" title="No change in rank since the previous test">—</span>`;
    const idLine=isIndividual?esc(st.id):`${esc(st.id)} · Rank #${a.rank}${rmBadge}`;
    return `<div class="student-card" data-student-id="${esc(st.id)}"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;gap:8px"><div style="min-width:0;flex:1" title="${esc(st.name)}"><div class="sc-name">${esc(st.name)}</div><div class="sc-id">${idLine}</div></div><div style="text-align:right;flex-shrink:0"><div class="sc-avg" style="color:${color}">${a.overallAvg}%</div><div style="display:flex;align-items:center;gap:4px;justify-content:flex-end"><span style="font-size:11px;color:var(--c-text3)">${a.grade}</span>${a.healthScore!=null?`<span style="font-size:9px;padding:1px 5px;border-radius:99px;font-weight:700;background:${a.healthScore>=80?'#e6f9f7':a.healthScore>=65?'#eef0fd':a.healthScore>=50?'#fff4e0':'#fdecea'};color:${a.healthScore>=80?'#1a5c50':a.healthScore>=65?'#2d3ab1':a.healthScore>=50?'#9a6200':'#8b1a1a'}">♥${a.healthScore}</span>`:''}</div></div></div><div class="sc-bar"><div class="sc-bar-fill" style="width:${a.overallAvg}%;background:${color}"></div></div>${sparkData.length>1?`<div style="margin:6px 0">${sparkSvg}</div>`:""}<div class="sc-flags">${flagBadges}</div></div>`;
  }).join(""));
}
function buildSparkPath(data){
  if(data.length<2)return "";const w=180,h=32,pad=4;const min=Math.min(...data),max=Math.max(...data),rng=max-min||1;
  const pts=data.map((v,i)=>[(i/(data.length-1))*(w-pad*2)+pad,h-pad-((v-min)/rng)*(h-pad*2)]);
  const d="M"+pts.map(p=>p.join(",")).join("L");const color=data[data.length-1]>=data[0]?"var(--c-success)":"var(--c-danger)";
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="display:block"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}
function renderHeatmap(){
  const isIndividual=APP.setup.mode==="individual";
  const sts=getFilteredStudents().slice(0,30),{subjects}=APP.setup;
  $("#heatmap-card-title").text(isIndividual?"Subject Performance":"Performance Heatmap — Student × Subject");
  if(!sts.length||!subjects.length){$("#heatmap-wrap").html("<div style='color:var(--c-text3);padding:10px'>No data.</div>");return;}
  function hmClass(p){return p>=85?"hm-ex":p>=70?"hm-good":p>=50?"hm-avg":p>=APP.setup.passThreshold?"hm-below":"hm-risk";}
  // U5: with exactly one row (Individual mode), a "Student" column just
  // repeats the same name in every row and adds no information — drop it
  // and let the subject columns stand on their own.
  const hdr=(isIndividual?"":"<th>Student</th>")+subjects.map(s=>`<th>${esc(s)}</th>`).join("")+"<th>Avg</th>";
  const rows=sts.map(st=>`<tr>${isIndividual?"":`<td style="font-weight:600;white-space:nowrap">${esc(st.name)}</td>`}${subjects.map(s=>`<td class="${hmClass(st.analysis.subjectAvgs[s]||0)}">${st.analysis.subjectAvgs[s]||0}%</td>`).join("")}<td style="font-weight:700">${st.analysis.overallAvg}%</td></tr>`).join("");
  $("#heatmap-wrap").html(`<table class="heatmap-table"><thead><tr>${hdr}</tr></thead><tbody>${rows}</tbody></table>`);
}
// Shared by renderCharts() and the bucket-screen charts added in BUILD spec
// §4/Phase 5 — same "read real colors from computed style, tune touch
// interaction" logic, now called from both places instead of duplicated.
function configureChartDefaults(){
  const cs=getComputedStyle(document.documentElement);
  const primaryColor=cs.getPropertyValue('--c-primary').trim()||'#4361ee';
  const gridColor=cs.getPropertyValue('--c-border').trim()||'#e2e5f1';
  const tickColor=cs.getPropertyValue('--c-text2').trim()||'#5a607a';
  Chart.defaults.color=tickColor;
  Chart.defaults.borderColor=gridColor;
  Chart.defaults.font.family=cs.getPropertyValue('--font').trim()||'Inter, sans-serif';
  Chart.defaults.interaction={mode:'nearest',intersect:false};
  Chart.defaults.events=['mousemove','mouseout','click','touchstart','touchmove'];
  Chart.defaults.elements.point.hitRadius=8;
  Chart.defaults.elements.point.radius=4;
  return {primaryColor,gridColor,tickColor};
}
let _bucketCharts={};
function destroyBucketCharts(){Object.values(_bucketCharts).forEach(c=>c&&c.destroy());_bucketCharts={};}
function bucketHeatmapHtml(students,subjects){
  if(!students.length||!subjects.length)return "<div style='color:var(--c-text3);padding:10px'>No data.</div>";
  const hmClass=p=>p>=85?"hm-ex":p>=70?"hm-good":p>=50?"hm-avg":p>=APP.setup.passThreshold?"hm-below":"hm-risk";
  const hdr="<th>Student</th>"+subjects.map(s=>`<th>${esc(s)}</th>`).join("")+"<th>Avg</th>";
  const rows=students.slice(0,30).map(st=>`<tr><td style="font-weight:600;white-space:nowrap">${esc(st.name)}</td>${subjects.map(s=>`<td class="${hmClass(st.analysis.subjectAvgs[s]||0)}">${st.analysis.subjectAvgs[s]||0}%</td>`).join("")}<td style="font-weight:700">${st.analysis.overallAvg}%</td></tr>`).join("");
  return `<table class="heatmap-table"><thead><tr>${hdr}</tr></thead><tbody>${rows}</tbody></table>`;
}
function renderBucketClassCharts(){
  destroyBucketCharts();
  const {subjects,tests}=APP.setup;const sts=APP.students||[];
  if(!sts.length||!$("#bucket-chart-classsubj").length)return;
  const {primaryColor}=configureChartDefaults();
  const subjAvgs=subjects.map(s=>{const avgs=sts.map(st=>st.analysis.subjectAvgs[s]||0);return avgs.length?Math.round(avgs.reduce((a,b)=>a+b,0)/avgs.length):0;});
  _bucketCharts.classSubj=new Chart($("#bucket-chart-classsubj")[0],{type:"bar",data:{labels:subjects,datasets:[{label:"Class Avg %",data:subjAvgs,backgroundColor:"rgba(67,97,238,.7)",borderRadius:4}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100}}}});
  // Class trend-over-tests (§5 teacher/management): aggregates each
  // student's existing cumAvgByTest (computed per-student in
  // computeAnalysis(), compute-engine.js) into a class-level average per
  // test index. Presentation only — no new per-student computation.
  if($("#bucket-chart-classtrend").length){
    const classTrend=tests.map((_,ti)=>{
      const vals=sts.map(st=>st.analysis.cumAvgByTest&&st.analysis.cumAvgByTest[ti]).filter(v=>v!==null&&v!==undefined);
      return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
    });
    _bucketCharts.classTrend=new Chart($("#bucket-chart-classtrend")[0],{type:"line",data:{labels:tests.map(t=>t.name),datasets:[{label:"Class Cumulative Avg %",data:classTrend,borderColor:primaryColor,backgroundColor:"rgba(67,97,238,.1)",tension:.3,fill:true}]},options:{responsive:true,scales:{y:{beginAtZero:true,max:100}}}});
  }
  $("#bucket-heatmap-wrap").html(bucketHeatmapHtml(sts,subjects));
}
function renderBucketStudentTrendChart(canvasId,student){
  destroyBucketCharts();
  const {tests}=APP.setup;
  if(!student||!$("#"+canvasId).length)return;
  const {primaryColor}=configureChartDefaults();
  const trend=tests.map((_,ti)=>student.analysis.testAvgs?student.analysis.testAvgs[ti]:null);
  _bucketCharts.studentTrend=new Chart($("#"+canvasId)[0],{type:"line",data:{labels:tests.map(t=>t.name),datasets:[{label:student.name+" — Overall %",data:trend,borderColor:primaryColor,backgroundColor:"rgba(67,97,238,.1)",tension:.3,fill:true}]},options:{responsive:true,scales:{y:{beginAtZero:true,max:100}}}});
}
function renderBucketSubjectDistChart(canvasId,rows){
  destroyBucketCharts();
  if(!rows.length||!$("#"+canvasId).length)return;
  configureChartDefaults();
  _bucketCharts.subjectDist=new Chart($("#"+canvasId)[0],{type:"bar",data:{labels:rows.map(r=>r.name.split(" ")[0]),datasets:[{label:"Score %",data:rows.map(r=>r.avg),backgroundColor:rows.map(r=>r.avg>=80?"rgba(46,196,182,.7)":r.avg>=APP.setup.passThreshold?"rgba(67,97,238,.7)":"rgba(242,92,84,.7)"),borderRadius:4}]},options:{responsive:true,indexAxis:"y",plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,max:100}}}});
}
function renderCharts(){
  destroyCharts();const {subjects,tests}=APP.setup;const isIndividual=APP.setup.mode==="individual";
  const sts=isIndividual?getFilteredStudents():APP.students;
  if(!sts.length)return;
  const {primaryColor}=configureChartDefaults();
  $("#chart-subject-avg-title").text(isIndividual?"Subject Averages":"Subject Averages");
  $("#chart-trend-title").text(isIndividual?"Progress Trend":"Class Trend");
  const seriesLabel=isIndividual?"Average %":"Class Avg %";
  // In Individual mode `sts` is just the one selected student (see above),
  // so these are already "their own" averages, not a cohort blend —
  // no code branch needed here beyond the label change.
  const subjAvgs=subjects.map(s=>{const avgs=sts.map(st=>st.analysis.subjectAvgs[s]||0);return Math.round(avgs.reduce((a,b)=>a+b,0)/avgs.length);});
  _charts.subjectAvg=new Chart($("#chart-subject-avg")[0],{type:"bar",data:{labels:subjects,datasets:[{label:seriesLabel,data:subjAvgs,backgroundColor:"rgba(67,97,238,.7)",borderRadius:4}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100}}}});
  const trendAvgs=tests.map((_,ti)=>{const avgs=sts.map(st=>st.analysis.testAvgs[ti]).filter(v=>v!==null);return avgs.length?Math.round(avgs.reduce((a,b)=>a+b,0)/avgs.length):null;});
  _charts.trend=new Chart($("#chart-trend")[0],{type:"line",data:{labels:tests.map(t=>t.name),datasets:[{label:seriesLabel,data:trendAvgs,borderColor:primaryColor,backgroundColor:"rgba(67,97,238,.1)",tension:.3,fill:true}]},options:{responsive:true,scales:{y:{beginAtZero:true,max:100}}}});
  // Cross-student comparison charts (attendance-vs-marks scatter, Top
  // Performers ranking) only render in Institution mode — the canvases
  // are hidden in Individual mode via #cohort-charts-row, but skip the
  // (wasted) Chart.js calls entirely too.
  if(isIndividual)return;
  _charts.scatter=new Chart($("#chart-scatter")[0],{type:"scatter",data:{datasets:[{label:"Students",data:sts.map(st=>({x:st.analysis.totalAbsent||0,y:st.analysis.overallAvg})),backgroundColor:"rgba(67,97,238,.6)",pointRadius:5}]},options:{responsive:true,scales:{x:{title:{display:true,text:"Total Absences"}},y:{title:{display:true,text:"Avg %"},min:0,max:100}}}});
}
function destroyCharts(){Object.values(_charts).forEach(c=>c&&c.destroy());_charts={};}
function renderWellbeingPanel(){
  const isIndividual=APP.setup.mode==="individual";
  const sts=isIndividual?getFilteredStudents():APP.students,n=sts.length||1;
  const high=sts.filter(s=>s.analysis.wellbeingFlag==="high").length,mod=sts.filter(s=>s.analysis.wellbeingFlag==="moderate").length,avgStress=Math.round(sts.reduce((a,s)=>a+s.analysis.stressScore,0)/n);
  if(isIndividual){
    const st=sts[0];
    if(!st){$("#wellbeing-panel").html("");return;}
    const label=st.analysis.wellbeingFlag==="high"?"High":st.analysis.wellbeingFlag==="moderate"?"Moderate":"Low";
    const color=st.analysis.wellbeingFlag==="high"?"var(--c-danger)":st.analysis.wellbeingFlag==="moderate"?"var(--c-warn)":"var(--c-success)";
    const emoji=st.analysis.wellbeingFlag==="high"?"😰":st.analysis.wellbeingFlag==="moderate"?"😐":"😊";
    $("#wellbeing-panel").html(`<div class="wb-grid"><div class="wb-card"><div style="font-size:22px">${emoji}</div><div style="font-size:12px;font-weight:600;margin:4px 0">Stress Level</div><div class="wb-val" style="color:${color}">${label}</div></div><div class="wb-card" data-tip="Built from absence frequency and performance trend only — not a certified wellbeing assessment"><div style="font-size:22px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><line x1='6' y1='20' x2='6' y2='10'/><line x1='12' y1='20' x2='12' y2='4'/><line x1='18' y1='20' x2='18' y2='14'/></svg></div><div style="font-size:12px;font-weight:600;margin:4px 0">Stress Score</div><div class="wb-val">${st.analysis.stressScore}/100</div></div><div class="wb-card"><div style="font-size:22px">📅</div><div style="font-size:12px;font-weight:600;margin:4px 0">Absences</div><div class="wb-val">${st.analysis.totalAbsent||0}</div></div></div>`);
    return;
  }
  $("#wellbeing-panel").html(`<div class="wb-grid"><div class="wb-card"><div style="font-size:22px">😰</div><div style="font-size:12px;font-weight:600;margin:4px 0">High Stress</div><div class="wb-val" style="color:var(--c-danger)">${high}</div></div><div class="wb-card"><div style="font-size:22px">😐</div><div style="font-size:12px;font-weight:600;margin:4px 0">Moderate</div><div class="wb-val" style="color:var(--c-warn)">${mod}</div></div><div class="wb-card"><div style="font-size:22px">😊</div><div style="font-size:12px;font-weight:600;margin:4px 0">Low Stress</div><div class="wb-val" style="color:var(--c-success)">${n-high-mod}</div></div><div class="wb-card" data-tip="Built from absence frequency and performance trend only — not a certified wellbeing assessment"><div style="font-size:22px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><line x1='6' y1='20' x2='6' y2='10'/><line x1='12' y1='20' x2='12' y2='4'/><line x1='18' y1='20' x2='18' y2='14'/></svg></div><div style="font-size:12px;font-weight:600;margin:4px 0">Avg Stress Score</div><div class="wb-val">${avgStress}/100</div></div></div>`);
}
function renderFlagsTable(){
  const isIndividual=APP.setup.mode==="individual";
  const pool=isIndividual?getFilteredStudents():APP.students;
  const flagged=pool.filter(s=>s.flags.length);
  if(!flagged.length){$("#flags-table-wrap").html("<div style='color:var(--c-text3);padding:10px'>No flags detected.</div>");return;}
  $("#flags-table-wrap").html(`<table class="data-table"><thead><tr><th>Student</th><th>Avg</th><th>Grade</th><th>Flags</th></tr></thead><tbody>${flagged.map(st=>`<tr><td style="font-weight:600">${esc(st.name)}</td><td>${st.analysis.overallAvg}%</td><td>${st.analysis.grade}</td><td>${st.flags.map(f=>`<span class="badge" style="background:${f.color}22;color:${f.color}">${f.label}</span>`).join(" ")}</td></tr>`).join("")}</tbody></table>`);
}
// Class-level Insights tab (attendance correlation + subject weakness) —
// inherently cohort statistics (averaged across many students), so this
// is only ever called in Institution mode; see renderDashboard().
// Reuses the existing .wb-grid/.wb-card and .data-table CSS classes for
// visual consistency with the Wellbeing/Alerts tabs — no new CSS added.
function renderClassInsights(){
  const cs=APP.classStats||{};
  const ac=cs.attendanceCorrelation;
  if(!ac){
    $("#attendance-correlation-panel").html("<div style='color:var(--c-text3);padding:10px'>Not enough data to compare — needs at least 2 students with no absences and 2 with at least one absence.</div>");
  }else{
    const gap=ac.noAbsence.avg-ac.someAbsence.avg;
    $("#attendance-correlation-panel").html(`<div class="wb-grid"><div class="wb-card"><div style="font-size:22px">🟢</div><div style="font-size:12px;font-weight:600;margin:4px 0">No Absences (n=${ac.noAbsence.n})</div><div class="wb-val" style="color:var(--c-success)">${ac.noAbsence.avg}%</div></div><div class="wb-card"><div style="font-size:22px">🟠</div><div style="font-size:12px;font-weight:600;margin:4px 0">1+ Absences (n=${ac.someAbsence.n})</div><div class="wb-val" style="color:var(--c-warn)">${ac.someAbsence.avg}%</div></div><div class="wb-card"><div style="font-size:22px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><polyline points='3 7 9 13 13 9 21 18'/><polyline points='15 18 21 18 21 12'/></svg></div><div style="font-size:12px;font-weight:600;margin:4px 0">Gap</div><div class="wb-val">${gap>=0?"+":""}${gap}%</div></div></div><div style="font-size:11px;color:var(--c-text3);margin-top:8px">Correlation only — this doesn't prove absences *cause* the difference, just that the two groups scored differently this term.</div>`);
  }
  const sw=cs.subjectWeakness||[];
  if(!sw.length){$("#subject-weakness-wrap").html("<div style='color:var(--c-text3);padding:10px'>No subject data.</div>");}
  else{$("#subject-weakness-wrap").html(`<table class="data-table"><thead><tr><th>Subject</th><th>Class Average</th><th>% Below Pass Threshold</th></tr></thead><tbody>${sw.map(r=>`<tr><td style="font-weight:600">${esc(r.subject)}</td><td>${r.avgClass}%</td><td style="color:${r.pctBelow>=40?'var(--c-danger)':r.pctBelow>=20?'var(--c-warn)':'var(--c-success)'}">${r.pctBelow}%</td></tr>`).join("")}</tbody></table>`);}
  renderSubjectCorrelation();
}
// Heatmap + top-pairs summary for cs.subjectCorrelation (see computeClassStats
// for the n>=10, subjects.length>=2 gate and why it sits between the
// attendanceCorrelation and k-means clustering thresholds).
function renderSubjectCorrelation(){
  const sc=(APP.classStats||{}).subjectCorrelation;
  const el=$("#subject-correlation-panel");
  if(!sc){
    const subjCount=(APP.setup.subjects||[]).length;
    const reason=subjCount<2?"needs at least 2 subjects to compare.":`needs at least 10 students (this class has ${APP.classStats&&APP.classStats.n||0}) — with fewer, a single student's result can swing the number misleadingly.`;
    el.html(`<div style='color:var(--c-text3);padding:10px'>Not enough data to compare — ${reason}</div>`);
    return;
  }
  function cellColor(r){
    if(r===null)return "background:var(--c-surface2);color:var(--c-text3)";
    if(r===1)return "background:var(--c-surface2);color:var(--c-text2);font-weight:700";
    const strength=Math.min(Math.abs(r),1);
    const varName=r>=0?"--c-success":"--c-danger";
    return `background:color-mix(in srgb, var(${varName}) ${Math.round(15+strength*55)}%, transparent);font-weight:${strength>=0.4?700:400}`;
  }
  const head=`<th></th>${sc.subjects.map(s=>`<th style="writing-mode:vertical-rl;text-orientation:mixed;font-size:10.5px;padding:6px 2px;max-width:34px">${esc(s)}</th>`).join("")}`;
  const rows=sc.subjects.map((rowSubj,i)=>`<tr><td style="font-weight:600;font-size:11px;white-space:nowrap">${esc(rowSubj)}</td>${sc.matrix[i].map(r=>`<td style="text-align:center;font-size:11px;padding:6px 4px;${cellColor(r)}">${r===null?"—":r.toFixed(2)}</td>`).join("")}</tr>`).join("");
  const top=sc.pairs.slice(0,3).map(p=>{
    const strength=Math.abs(p.r)>=0.7?"strongly":Math.abs(p.r)>=0.4?"moderately":"weakly";
    const direction=p.r>=0?"together":"in opposite directions";
    return `<div style="font-size:12px;padding:4px 0">${esc(p.a)} and ${esc(p.b)} move <b>${strength} ${direction}</b> (r = ${p.r>=0?"+":""}${p.r.toFixed(2)})</div>`;
  }).join("")||"<div style='font-size:12px;color:var(--c-text3)'>No pairs with a computable correlation (a subject with identical marks across every student can't be correlated).</div>";
  el.html(`<div style="overflow-x:auto"><table class="data-table" style="width:auto"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <div style="margin-top:12px">${top}</div>
    <div style="font-size:11px;color:var(--c-text3);margin-top:8px">Based on ${sc.n} students. Correlation only — a strong link between two subjects doesn't mean one causes the other, just that students who do well in one tend to do well (or poorly) in the other too.</div>`);
}
// E2: getFilteredStudents is the ONE sanctioned accessor for on-screen student
// data. In Individual mode it returns only the selected child/aspirant; in
// Institution mode it returns the filtered cohort. Any new dashboard widget
// MUST call this (or its alias getScopedStudents) instead of reading
// APP.students directly, or it will silently reintroduce cross-child
// comparison in Individual mode. (PDF export and data-import/parsing code
// are the only code paths permitted to touch APP.students directly.)
function getScopedStudents(){return getFilteredStudents();}
function getFilteredStudents(){
  // Individual mode: the switcher, not the filter/search bar, decides
  // which single student is shown — each child/aspirant is a fully
  // separate report, never a filtered *view onto* a shared cohort list.
  if(APP.setup.mode==="individual"){
    const sts=APP.students;
    if(!sts.length)return[];
    const found=sts.find(s=>s.id===APP.individualSelectedId);
    return found?[found]:[sts[0]];
  }
  const q=$("#search-student").val().toLowerCase();
  let sts=APP.students.filter(s=>!q||s.name.toLowerCase().includes(q)||s.id.toLowerCase().includes(q));
  if(APP.filter==="at-risk")sts=sts.filter(s=>s.flags.find(f=>f.type==="at-risk"));
  else if(APP.filter==="improving")sts=sts.filter(s=>s.analysis.trend==="improving");
  else if(APP.filter==="declining")sts=sts.filter(s=>s.analysis.trend==="declining");
  else if(APP.filter==="flagged")sts=sts.filter(s=>s.flags.length);
  if(APP.sort==="name")sts.sort((a,b)=>a.name.localeCompare(b.name));
  else if(APP.sort==="risk")sts.sort((a,b)=>b.analysis.stressScore-a.analysis.stressScore);
  return sts;
}
function filterStudents(){renderStudentCards();renderHeatmap();}
function setFilter(f,el){APP.filter=f;$(".filter-btn").removeClass("active");$(el).addClass("active");filterStudents();}
function sortStudents(s){APP.sort=s;renderStudentCards();}

/* ════ STUDENT MODAL ════
   Delegated on #student-grid (stable container, survives re-renders)
   rather than an inline onclick="...('${esc(st.id)}')" — string-
   interpolating any value into a quoted HTML attribute is fragile
   because esc() only encodes & < > " and NOT a single quote, so a
   Student ID containing one (a plausible real name like "O'Brien-01",
   or a deliberately crafted one) could break out of the attribute and
   inject arbitrary onclick JS. Reading the ID back off the DOM's
   data-student-id attribute sidesteps that whole class of bug: the
   browser HTML parser decodes entities into the attribute value safely,
   and nothing gets re-concatenated into executable JS. */
/* prompt-v4.20 §1v: .student-card click-to-modal removed — cards are now
   purely informational everywhere they're rendered. openStudentModal()
   itself is kept (not deleted) since #modal-overlay/#modal-box are still
   used elsewhere (Sample Files preview — see showSampleFiles()), but this
   is the only caller that opened it for student detail, and it's gone. */
function buildStudentDetailHtml(st){
  const a=st.analysis,{subjects,tests}=APP.setup;
  const isIndividual=APP.setup.mode==="individual";
  // v1.5: Total column = scored/max across subjects opted for that test
  // (some may be "-" i.e. not taken), so a parent sees the real total, not
  // just a percentage — same fix as the PDF's "All Test Scores" table.
  const testRows=tests.map((t,ti)=>{
    const td=st.testData[t.name]||{marks:{},absents:0,remark:""};
    let sumScored=0,sumMax=0,opted=0;
    const cells=subjects.map(s=>{
      const v=td.marks[s];
      if(v===undefined||v===null||v===""){return `<td style="color:var(--c-text3)">-</td>`;}
      const mx=(t.maxMarks&&t.maxMarks[s])||100;
      opted++;sumScored+=parseFloat(v)||0;sumMax+=mx;
      return `<td>${esc(String(v))}/${mx}</td>`;
    }).join("");
    const totalCell=opted>0?`${sumScored}/${sumMax}<div style="font-size:10px;color:var(--c-text3)">${opted}/${subjects.length} opted</div>`:`<span style="color:var(--c-text3)">-</span>`;
    return `<tr><td style="font-weight:600">${esc(t.name)}</td>${cells}<td>${totalCell}</td><td style="font-weight:700">${a.testAvgs[ti]!==null?a.testAvgs[ti]+"%":"-"}</td><td>${td.absents||0}</td><td style="font-size:11px">${esc(td.remark||"")}${remarkToneBadgeHtml(td.remarkTone)}</td></tr>`;
  }).join("");
  // Class Avg row directly under the marks table (Institution mode only —
  // there's no "class" to compare against in Individual mode) so "where does
  // this child stand" is answered right next to the table, not only via the
  // separate "vs. Class Average, by Subject" badges further down.
  const classAvgRow=(!isIndividual&&APP.students&&APP.students.length>1)?(()=>{
    const perSubjAvgs=subjects.map(s=>{
      const vals=[];
      tests.forEach(t=>{APP.students.forEach(s2=>{const d=s2.testData&&s2.testData[t.name];const v=d&&d.marks?d.marks[s]:undefined;const mx=(t.maxMarks&&t.maxMarks[s])||100;if(v!==undefined&&v!==null&&v!=="")vals.push(Math.min(100,(parseFloat(v)||0)/mx*100));});});
      return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
    });
    const classOverallAvgs=APP.students.map(s2=>s2.analysis&&s2.analysis.overallAvg).filter(v=>v!==undefined&&v!==null);
    const classOverall=classOverallAvgs.length?Math.round(classOverallAvgs.reduce((a,b)=>a+b,0)/classOverallAvgs.length):null;
    return `<tr style="font-style:italic;background:var(--c-primary-soft)"><td>Class Avg</td>${perSubjAvgs.map(v=>`<td>${v!==null?v+"%":"-"}</td>`).join("")}<td>-</td><td>${classOverall!==null?classOverall+"%":"-"}</td><td>-</td><td></td></tr>`;
  })():"";
  // Percentile is a ranking, not a percentage score — clarified inline
  // right where a parent actually reads it. Below 12 students a percentile
  // implies false precision, so show rank + a plain point-difference from
  // the class average instead.
  const classAvgAll=(!isIndividual&&APP.students&&APP.students.length>1)?(()=>{const vals=APP.students.map(s2=>s2.analysis&&s2.analysis.overallAvg).filter(v=>v!==undefined&&v!==null);return vals.length?Math.round(vals.reduce((x,y)=>x+y,0)/vals.length):null;})():null;
  const standingBit=isIndividual?"":(APP.students.length>=12
    ?` · Rank #${a.rank} of ${APP.students.length} · ${a.percentile}th percentile (better than ${a.percentile}% of classmates — not a % score)`
    :` · Rank #${a.rank} of ${APP.students.length}${classAvgAll!==null?` · ${Math.abs(a.overallAvg-classAvgAll)} points ${a.overallAvg>=classAvgAll?"above":"below"} the class average of ${classAvgAll}%`:""}`);
  const idLine=isIndividual?`ID: ${esc(st.id)} · Grade: ${a.grade}`:`ID: ${esc(st.id)}${standingBit} · Grade: ${a.grade}`;
  return `<h3 style="font-family:var(--font-display);font-size:18px;margin-bottom:4px">${esc(st.name)}</h3><div style="font-size:12px;color:var(--c-text3);margin-bottom:16px">${idLine}</div><div class="grid-4" style="margin-bottom:16px"><div class="kpi-card"><div class="kpi-label">Overall Avg</div><div class="kpi-val">${a.overallAvg}%</div></div><div class="kpi-card"><div class="kpi-label">Trend</div><div class="kpi-val" style="font-size:16px">${a.trend==="improving"?"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><polyline points='3 17 9 11 13 15 21 6'/><polyline points='15 6 21 6 21 12'/></svg>":a.trend==="declining"?"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><polyline points='3 7 9 13 13 9 21 18'/><polyline points='15 18 21 18 21 12'/></svg>":"➡"} ${a.trend}</div></div><div class="kpi-card"><div class="kpi-label">Absences</div><div class="kpi-val">${a.totalAbsent}</div></div><div class="kpi-card" data-tip="Estimated from absences + score trend only — not a certified wellbeing or psychological assessment"><div class="kpi-label">Stress ⓘ</div><div class="kpi-val" style="font-size:16px">${a.wellbeingFlag}</div></div></div><div class="tbl-wrap" style="margin-bottom:4px"><table class="data-table"><thead><tr><th>Test</th>${subjects.map(s=>`<th>${esc(s)}</th>`).join("")}<th>Total</th><th>Avg</th><th>Absent</th><th>Remark</th></tr></thead><tbody>${testRows}${classAvgRow}</tbody></table></div><div style="font-size:10.5px;color:var(--c-text3);margin-bottom:16px">Total = scored/max marks across subjects opted for that test.</div>${a.healthScore!=null?`<div style="margin-bottom:10px;padding:8px 12px;border-radius:var(--r-sm);display:flex;align-items:center;gap:10px;background:${a.healthScore>=80?'#e6f9f7':a.healthScore>=65?'#eef0fd':a.healthScore>=50?'#fff4e0':'#fdecea'}" data-tip="App-defined 0–100 blend: 40% Academic + 20% Consistency + 20% Trend + 20% Engagement — not a published or clinical formula"><div style="font-size:22px;font-weight:700;font-family:var(--font-display);color:${a.healthScore>=80?'#1a5c50':a.healthScore>=65?'#2d3ab1':a.healthScore>=50?'#9a6200':'#8b1a1a'}">♥ ${a.healthScore}</div><div><div style="font-weight:700;font-size:12px">Health Score — ${a.healthBand||''}</div><div style="font-size:11px;color:var(--c-text2)">Academics 40% · Consistency 20% · Trend 20% · Engagement 20%</div></div></div>`:""}
${a.explainedWarnings&&a.explainedWarnings.length?`<div style="margin-bottom:12px"><div style="font-weight:600;font-size:11px;margin-bottom:6px">⚠ Alerts &amp; Explanations</div>${a.explainedWarnings.map(f=>`<div style="margin-bottom:5px;padding:6px 10px;border-radius:var(--r-sm);background:${f.color}18;border-left:3px solid ${f.color}"><div style="font-weight:700;font-size:11px;color:${f.color}">${f.label}</div><div style="font-size:11px;color:var(--c-text2);margin-top:2px">${(f.reason||'')+flagChapterSuffix(st,f.type)}</div></div>`).join('')}</div>`:st.flags.length?`<div style="margin-bottom:14px"><div style="font-weight:600;margin-bottom:6px">Flags</div>${st.flags.map(f=>`<span class="badge" style="background:${f.color}22;color:${f.color};margin-right:6px">${f.label}</span>`).join("")}</div>`:""}
<div class="grid-4" style="margin-bottom:14px">
  <div class="kpi-card"><div class="kpi-label">Consistency</div><div class="kpi-val" style="font-size:18px">${a.consistencyScore||"—"}%</div></div>
  <div class="kpi-card"><div class="kpi-label">Growth Rate</div><div class="kpi-val" style="font-size:18px;color:${(a.growthRate||0)>=0?"var(--c-success)":"var(--c-danger)"}">${(a.growthRate||0)>=0?"+":""}${a.growthRate||0}%</div></div>
  <div class="kpi-card" data-tip="Estimated from attendance + score trend only — the app cannot directly measure classroom participation"><div class="kpi-label">Engagement ⓘ</div><div class="kpi-val" style="font-size:18px">${a.engagementIndex||"—"}</div></div>
  <div class="kpi-card"><div class="kpi-label">EW Score</div><div class="kpi-val" style="font-size:18px;color:${(a.earlyWarningScore||0)>=50?"var(--c-danger)":(a.earlyWarningScore||0)>=25?"var(--c-warn)":"var(--c-success)"}">${a.earlyWarningScore||0}</div></div>
  ${isIndividual?"":`<div class="kpi-card"><div class="kpi-label">Competitive</div><div class="kpi-val" style="font-size:13px">${a.competitiveReadiness||"—"}</div></div>
  <div class="kpi-card"><div class="kpi-label">Topper Gap</div><div class="kpi-val" style="font-size:18px">${a.topperGap||0}%</div></div>`}
</div>
<div class="grid-4" style="margin-bottom:14px">
  <div class="kpi-card"><div class="kpi-label">Best Test</div><div class="kpi-val" style="font-size:14px">${a.bestTest?esc(a.bestTest.name)+" ("+a.bestTest.pct+"%)":"—"}</div></div>
  <div class="kpi-card"><div class="kpi-label">Weakest Test</div><div class="kpi-val" style="font-size:14px">${a.worstTest?esc(a.worstTest.name)+" ("+a.worstTest.pct+"%)":"—"}</div></div>
</div>
${!isIndividual&&a.subjectDeltas&&Object.keys(a.subjectDeltas).length?`<div class="card" style="padding:12px;margin-bottom:14px"><div class="card-title" style="margin-bottom:6px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><line x1='6' y1='20' x2='6' y2='10'/><line x1='12' y1='20' x2='12' y2='4'/><line x1='18' y1='20' x2='18' y2='14'/></svg> vs. Class Average, by Subject</div><div style="display:flex;flex-wrap:wrap;gap:6px">${Object.entries(a.subjectDeltas).map(([s,d])=>`<span class="badge" style="background:${d>=0?'var(--c-success)':'var(--c-danger)'}18;color:${d>=0?'var(--c-success)':'var(--c-danger)'}" title="${esc(s)}: ${d>=0?'above':'below'} the class average by ${Math.abs(d)} points">${esc(s)} ${d>=0?"+":""}${d}</span>`).join("")}</div></div>`:""}
${/* STUDIN-PRO: "At School" narrative card commented out per request.
   Original call preserved below for easy restore; narrativeCard() and
   saveNarrativeField() are left untouched since other fields still use them.
${!isIndividual&&a.schoolPlan?narrativeCard("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><rect x='4' y='3' width='16' height='18' rx='1'/><path d='M9 21V15h6v6'/><path d='M9 7h1M9 11h1M14 7h1M14 11h1'/></svg>","At School","schoolPlan",a.schoolPlan,st.id):""}
*/ ""}`;
}
function openStudentModal(id){
  const st=APP.students.find(s=>s.id===id);if(!st)return;
  $("#modal-content").html(buildStudentDetailHtml(st));
  $("#modal-overlay").addClass("open");
  _modalLastFocus=document.activeElement;
  setTimeout(()=>{const f=document.querySelector('#modal-overlay.open .modal-close');if(f)f.focus();},0);
}
let _modalLastFocus=null;
// One shared builder for every editable narrative box (Report Card Comment,
// For Parents, Strengths, Motivation, Study Plan, Intervention Note) instead
// of hand-duplicating the textarea+Save markup six times — each edit still
// only ever touches its own field on st.analysis, in-memory, same stateless
// model as everything else.
function narrativeCard(icon,title,field,value,studentId){
  return `<div class="card" style="padding:12px"><div class="card-title" style="margin-bottom:6px">${icon} ${title} <span style="font-weight:400;color:var(--c-text3);font-size:11px">(editable — used in the exported PDF)</span></div><textarea class="narrative-edit" data-field="${field}" style="width:100%;min-height:56px;font-size:13px;font-family:inherit;padding:8px;border:1px solid var(--c-border);border-radius:var(--r-sm);resize:vertical" oninput="$(this).next('.narrative-save-row').find('button').prop('disabled',false)">${esc(value||"")}</textarea><div class="narrative-save-row" style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn btn-secondary" style="padding:5px 14px;font-size:12px" disabled onclick="saveNarrativeField('${esc(studentId)}','${field}',this)">Save</button></div></div>`;
}
function saveNarrativeField(id,field,btnEl){
  const st=APP.students.find(s=>s.id===id);if(!st)return;
  const $ta=$(btnEl).closest(".card").find("textarea.narrative-edit");
  st.analysis[field]=$ta.val();
  $(btnEl).prop("disabled",true);
  const labels={parentMessage:"The Bottom Line",strengthsLetter:"Strengths note",homePlan:"Home plan",schoolPlan:"School plan"};
  toast((labels[field]||"Field")+" saved for "+st.name.split(" ")[0]+".","success");
}
// Small badge for a computed remark tone (see classifyRemarkTone in
// compute-engine.js) — same .badge + "color+22-suffix-opacity" convention
// already used for flags and subject-delta badges above.
function remarkToneBadgeHtml(tone){
  if(!tone)return "";
  const map={positive:{c:"var(--c-success)",l:"Positive"},neutral:{c:"var(--c-text3)",l:"Neutral"},concern:{c:"var(--c-warn)",l:"Needs attention"}};
  const m=map[tone];if(!m)return "";
  return `<span class="badge" style="background:${m.c}22;color:${m.c};margin-left:6px" title="Tone auto-detected from remark keywords — a light heuristic, not a guarantee">${m.l}</span>`;
}
// TASK 3a (studin-features-prompt v1.0): editable per-test remark cards,
// reusing the narrativeCard() textarea+Save markup pattern — remarks live
// at st.testData[testName].remark (nested per test), not a flat
// st.analysis field, so they get their own small save handler rather than
// forcing that shape through saveNarrativeField().
function remarkCardsHtml(st){
  const tests=(APP.setup&&APP.setup.tests)||[];
  if(!tests.length)return "";
  return `<div class="card" style="padding:12px"><div class="card-title" style="margin-bottom:8px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z'/></svg> Teacher Remarks <span style="font-weight:400;color:var(--c-text3);font-size:11px">(editable — download the updated sheet to keep changes)</span></div><div style="display:flex;flex-direction:column;gap:10px">${tests.map(t=>{
    const remark=(st.testData[t.name]||{}).remark||"";
    const remarkTone=(st.testData[t.name]||{}).remarkTone;
    const remarkId="remark-"+esc(st.id)+"-"+esc(t.name).replace(/[^\w]/g,"_");
    const rlen=remark.length;
    const rcountText=rlen+" characters"+(rlen>300?" — long remarks may push other sections to extra pages in the PDF":"");
    const rcountColor=rlen>300?"var(--c-warn,#f9a826)":"var(--c-text3)";
    return `<div><div style="font-size:11.5px;font-weight:700;color:var(--c-text2);margin-bottom:4px">${esc(t.name)}${remarkToneBadgeHtml(remarkTone)}</div><textarea class="narrative-edit remark-edit" data-test="${esc(t.name)}" id="${remarkId}" style="width:100%;min-height:44px;font-size:13px;font-family:inherit;padding:8px;border:1px solid var(--c-border);border-radius:var(--r-sm);resize:vertical" oninput="$(this).next('.narrative-save-row').find('button').prop('disabled',false);updateRemarkCharCount(this)">${esc(remark)}</textarea><div class="narrative-save-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:4px"><span class="remark-char-count" data-for="${remarkId}" style="font-size:11px;color:${rcountColor}">${rcountText}</span><button class="btn btn-secondary" style="padding:5px 14px;font-size:12px" disabled onclick="saveRemarkField('${esc(st.id)}','${esc(t.name)}',this)">Save</button></div></div>`;
  }).join("")}</div></div>`;
}
// STRESS-TEST FIX (BUG-4, STRESS_TEST_REPORT.md): a very long remark (400+
// chars) wraps safely in the PDF (splitTextToSize confirmed no crash risk)
// but can push 8-10 lines into a single student's report, crowding out
// the Chapters/Parent-message sections below it. Soft warning only — no
// hard cap, so nothing a teacher types is ever silently truncated.
function updateRemarkCharCount(textareaEl){
  const len=(textareaEl.value||"").length;
  const countEl=document.querySelector('.remark-char-count[data-for="'+textareaEl.id+'"]');
  if(!countEl)return;
  countEl.textContent=len+" characters"+(len>300?" — long remarks may push other sections to extra pages in the PDF":"");
  countEl.style.color=len>300?"var(--c-warn,#f9a826)":"var(--c-text3)";
}
function saveRemarkField(id,testName,btnEl){
  const st=APP.students.find(s=>s.id===id);if(!st)return;
  const $ta=$(btnEl).closest("div").find("textarea.remark-edit");
  if(!st.testData[testName])st.testData[testName]={marks:{},absents:0,remark:"",chapter:""};
  st.testData[testName].remark=$ta.val();
  // Re-run the same classifier computeAnalysis() used at import time, so
  // editing a remark updates its tone badge immediately instead of only
  // on the next full analysis re-run.
  st.testData[testName].remarkTone=classifyRemarkTone(st.testData[testName].remark);
  const cardTitle=$ta.closest("div").find("> div").first();
  if(cardTitle.length)cardTitle.find(".badge").remove();
  if(cardTitle.length&&st.testData[testName].remarkTone)cardTitle.append(remarkToneBadgeHtml(st.testData[testName].remarkTone));
  $(btnEl).prop("disabled",true);
  APP._remarksDirty=true;
  showRemarksDirtyBanner();
  toast("Remark saved for "+st.name.split(" ")[0]+" — "+testName+".","success");
}
// TASK 3a: persistent banner (reusing #merge-banner's visual style) telling
// the teacher a NEW file needs to be downloaded to keep their edits —
// nothing is written back to the originally-uploaded file.
function showRemarksDirtyBanner(){
  if($("#remarks-dirty-banner").length)return; // already showing
  const banner=$(`<div id="remarks-dirty-banner" style="position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:1200;padding:10px 16px;background:#e6f7ee;border:1px solid #1a7a4c33;border-radius:var(--r-sm);font-size:12.5px;color:#1a7a4c;box-shadow:0 4px 18px rgba(0,0,0,.15);display:flex;align-items:center;gap:10px">
    <span>Remarks updated — download a fresh copy to keep them.</span>
    <button class="btn btn-success btn-sm" style="padding:4px 12px;font-size:12px" onclick="downloadUpdatedSheet()">Download Updated Sheet</button>
  </div>`);
  $("body").append(banner);
}
// TASK 3b: writes a brand-new .xlsx from the raw rows already in memory —
// the originally uploaded file is never touched or re-read from disk.
/* ════════════════════════════════════════════════════════════════════
   OLD SINGLE-SHEET SCHEMA — downloadUpdatedSheet()
   Kept commented out for reference/safety per explicit request. Delete
   once the new multi-tab version below has been confirmed working.
   ════════════════════════════════════════════════════════════════════
function downloadUpdatedSheet_OLD(){
  if(!APP.rawData||!APP.students.length){toast("No data loaded.","warn");return;}
  const markKey=Object.keys(APP.rawData).find(k=>k.includes("MARK")&&k.includes("CONTEXT"))
                 ||Object.keys(APP.rawData).find(k=>k.includes("MARK"));
  if(!markKey){toast("Cannot find marks sheet in loaded data.","error");return;}
  const rows=APP.rawData["_arr_"+markKey];
  if(!rows){toast("Raw data not available.","error");return;}
  const header=rows[0].map(h=>h==null?"":String(h).trim());
  const studentMap={};
  APP.students.forEach(st=>{ studentMap[String(st.id).trim().toUpperCase()]=st; });
  const idIdx=header.indexOf("Student ID");
  const updatedRows=rows.map((row,ri)=>{
    if(ri===0)return row;
    const id=String(row[idIdx]||"").trim().toUpperCase();
    const st=studentMap[id];
    if(!st)return row;
    const newRow=[...row];
    (APP.setup.tests||[]).forEach(t=>{
      const rmIdx=header.indexOf(t.name+" - Remark");
      if(rmIdx!==-1){ newRow[rmIdx]=st.testData[t.name]?.remark||""; }
    });
    return newRow;
  });
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet(updatedRows);
  XLSX.utils.book_append_sheet(wb,ws,"MARKS+CONTEXT");
  const ts=new Date();
  const tag=ts.getFullYear()+String(ts.getMonth()+1).padStart(2,"0")+String(ts.getDate()).padStart(2,"0")
            +"_"+String(ts.getHours()).padStart(2,"0")+String(ts.getMinutes()).padStart(2,"0");
  const fname=(APP.setup.instName||"sheet")+"_remarks_"+tag+".xlsx";
  XLSX.writeFile(wb,fname);
  toast("Updated sheet downloaded: "+fname,"success");
  APP._remarksDirty=false;
  $("#remarks-dirty-banner").remove();
}
════════════════════════════════════════════════════════════════════ */

// NEW SCHEMA (multi-tab redesign): writes a full workbook back out —
// SETUP is regenerated fresh from current settings, STUDENTS is copied
// through byte-for-byte, and every test tab is copied through with only
// its Remark column values refreshed from what's currently in memory
// (edited via the student modal). Reuses buildSetupSheet()/safeSheetName()
// from template-upload.js, same as the template generator and merge flow.
function downloadUpdatedSheet(){
  if(!APP.rawData||!APP.students.length){toast("No data loaded.","warn");return;}
  const studentsArr=APP.rawData["_arr_STUDENTS"];
  if(!studentsArr){toast("Cannot find the STUDENTS tab in the loaded data.","error");return;}
  const wb=XLSX.utils.book_new();
  const usedNames=new Set();
  if(typeof buildSetupSheet==="function"){
    XLSX.utils.book_append_sheet(wb,buildSetupSheet(),"SETUP");
    usedNames.add("SETUP");
  }
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(studentsArr),typeof safeSheetName==="function"?safeSheetName("STUDENTS",usedNames):"STUDENTS");

  const studentMap={};
  APP.students.forEach(st=>{ studentMap[String(st.id).trim().toUpperCase()]=st; });

  (APP.setup.tests||[]).forEach(t=>{
    const rows=APP.rawData["_arr_"+t.name];
    if(!rows){return;} // this test has no tab in the source file — nothing to write back for it
    const header=rows[0].map(h=>h==null?"":String(h).trim());
    const idIdx=header.indexOf("Student ID");
    const rmIdx=header.indexOf("Remark");
    const updatedRows=rows.map((row,ri)=>{
      if(ri===0||idIdx===-1||rmIdx===-1)return row;
      const id=String(row[idIdx]||"").trim().toUpperCase();
      const st=studentMap[id];
      if(!st)return row;
      const newRow=[...row];
      newRow[rmIdx]=(st.testData[t.name]&&st.testData[t.name].remark)||"";
      return newRow;
    });
    const sheetName=typeof safeSheetName==="function"?safeSheetName(t.name,usedNames):t.name;
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(updatedRows),sheetName);
  });

  if(typeof buildReadmeSheet==="function"){
    usedNames.add("README");
    XLSX.utils.book_append_sheet(wb,buildReadmeSheet(),"README");
  }

  const ts=new Date();
  const tag=ts.getFullYear()+String(ts.getMonth()+1).padStart(2,"0")+String(ts.getDate()).padStart(2,"0")
            +"_"+String(ts.getHours()).padStart(2,"0")+String(ts.getMinutes()).padStart(2,"0");
  const fname=(APP.setup.instName||"sheet")+"_remarks_"+tag+".xlsx";
  XLSX.writeFile(wb,fname);
  toast("Updated sheet downloaded: "+fname,"success");
  APP._remarksDirty=false;
  $("#remarks-dirty-banner").remove();
}
function showSampleFiles(){
  // v4.1 (bug #1/#2 fix): shares the same rule as Setup/About/FAQ in
  // goStep() now — open from anywhere except Dashboard/Export. See
  // updateNavHomeOnlyState() for the matching visual/tooltip state.
  if(APP.currentStep==="dashboard"||APP.currentStep==="export"){toast("Available only from the Home screen.","warn");return;}
  const base=(window.APP_CONFIG&&APP_CONFIG.assetBase!==undefined)?APP_CONFIG.assetBase:"https://studin.in/";
  const files=[
    {name:"Sample 1 — UPSC/IAS Coaching.xlsx",file:"Sample_1_For_UPSC_IAS_Coaching.xlsx",desc:"Coaching centre example — multiple tests for a competitive-exam batch.",mode:"Institution"},
    {name:"Sample 2 — MBBS College Lecturer.xlsx",file:"Sample_2_For_MBBS_College_Lecturer.xlsx",desc:"College example — subject-wise marks for a lecturer's class.",mode:"Institution"},
    {name:"Sample 3 — International Masters College.xlsx",file:"Sample_3_For_International_Masters_College.xlsx",desc:"Higher-ed example — multi-subject, multi-test data for a masters cohort.",mode:"Institution"},
    {name:"Sample 4 — School Class Teacher.xlsx",file:"Sample_4_For_School_Class_Teacher.xlsx",desc:"School example — a full class's marks as filled by a class teacher.",mode:"Institution"},
    {name:"Sample 5 — Parent, Two Children (Different Grades).xlsx",file:"Sample_5_For_Individual_Two_Children.xlsx",desc:"Individual mode example — a Class 5 and a Class 9 child in one workbook, switcher shows both by name.",mode:"Individual"},
    {name:"Sample 6 — Competitive Exam Aspirant (UPSC).xlsx",file:"Sample_6_For_Individual_UPSC_Aspirant.xlsx",desc:"Individual mode example — one aspirant's own UPSC CSE prep, marks on a 200-point scale.",mode:"Individual"},
    {name:"Sample 7 — Management: Class 7 Section A.xlsx",file:"Sample_7_For_School_Management_Section_A_Class7.xlsx",desc:"Compare Sections example (1 of 3) — or use \"Try All 3 Together\" below to see a management-style side-by-side comparison across sections instantly.",mode:"Compare"},
    {name:"Sample 8 — Management: Class 7 Section B.xlsx",file:"Sample_8_For_School_Management_Section_B_Class7.xlsx",desc:"Compare Sections example (2 of 3) — same Class 7, same Subjects/Tests/Max Marks as Sample 7 & 9, different section.",mode:"Compare"},
    {name:"Sample 9 — Management: Class 7 Section C.xlsx",file:"Sample_9_For_School_Management_Section_C_Class7.xlsx",desc:"Compare Sections example (3 of 3) — same Class 7, same Subjects/Tests/Max Marks as Sample 7 & 8, different section.",mode:"Compare"},
    {name:"Sample 10 — Large Scale (100 Students × 10 Tests).xlsx",file:"Sample_10_For_Large_Scale_100_Students.xlsx",desc:"See how Student Insight holds up at real institutional scale — a full academic year (10 monthly exams) for a 100-student class, not a small demo class.",mode:"Scale"}
  ];
  const badge={Institution:{bg:"#eafaf1",fg:"#1e8a5f"},Individual:{bg:"#e8edfb",fg:"var(--c-primary)"},Compare:{bg:"#fdf1e3",fg:"#b5690a"},Scale:{bg:"#f1ecf9",fg:"#7b5ea7"}};
  const compareFiles=files.filter(f=>f.mode==="Compare").map(f=>f.file);
  const rows=files.map(f=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid var(--c-border);border-radius:var(--r-sm);margin-bottom:10px"><div><div style="font-weight:700;font-size:13px">${esc(f.name)} <span style="font-weight:600;font-size:10px;padding:1px 7px;border-radius:9px;background:${badge[f.mode].bg};color:${badge[f.mode].fg}">${f.mode==="Compare"?"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><rect x='4' y='3' width='16' height='18' rx='1'/><path d='M9 21V15h6v6'/><path d='M9 7h1M9 11h1M14 7h1M14 11h1'/></svg> Compare Set":f.mode}</span></div><div style="font-size:11.5px;color:var(--c-text3);margin-top:2px">${esc(f.desc)}</div></div><div style="display:flex;gap:6px;flex-shrink:0"><button type="button" class="btn btn-primary btn-sm" onclick="runSampleFile(['${f.file}'])"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M13 2 3 14h9l-1 8 10-12h-9l1-8z'/></svg> Try Now</button><a class="btn btn-secondary btn-sm" href="${base}${f.file}" download title="Download to your device instead"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M12 3v12'/><polyline points='7 10 12 15 17 10'/><path d='M4 21h16'/></svg></a></div></div>`).join("");
  const compareFilesArgLiteral="["+compareFiles.map(f=>"'"+f+"'").join(",")+"]";
  const compareCta=`<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px dashed var(--c-primary);border-radius:var(--r-sm);margin:-2px 0 14px;background:var(--c-primary-soft)"><div style="font-size:12.5px;color:var(--c-primary)"><strong>Want the full Compare demo?</strong> Run Samples 7, 8 &amp; 9 together as one side-by-side section comparison.</div><button type="button" class="btn btn-primary btn-sm" style="flex-shrink:0" onclick="runSampleFile(${compareFilesArgLiteral})"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M13 2 3 14h9l-1 8 10-12h-9l1-8z'/></svg> Try All 3 Together</button></div>`;
  $("#modal-content").html(`<h3 style="font-family:var(--font-display);font-size:18px;margin-bottom:4px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6'/><path d='M8 13h8M8 17h8M8 9h2'/></svg> Sample Files</h3><div style="font-size:12px;color:var(--c-text3);margin-bottom:16px">Try Now runs a sample straight through analysis — nothing downloads to your device. Prefer a local copy to inspect the formatting? Use the download icon instead.</div>${rows}${compareCta}`);
  $("#modal-overlay").addClass("open");
  _modalLastFocus=document.activeElement;
  setTimeout(()=>{const f=document.querySelector('#modal-overlay.open .modal-close');if(f)f.focus();},0);
}
// "Try Now" — fetches the sample workbook(s) straight from the CDN into
// memory and feeds them through the exact same handleHomeImportFiles()
// pipeline a real drag-and-drop would use (wrapped as real File objects,
// so no upload-path logic needs duplicating), skipping the download-then-
// re-upload round trip entirely. Falls back to pointing at the Download
// button if the fetch itself fails (offline, blocked, etc).
async function runSampleFile(fileNames){
  closeModal();
  goStep("home");
  const statusEl=document.getElementById("home-import-status");
  statusEl.innerHTML=`<div class="card" style="padding:14px;border-color:var(--c-primary)"><div style="font-size:12.5px">⏳ Fetching sample data…</div></div>`;
  statusEl.style.display="block";
  scrollToEl(statusEl);
  try{
    const base=(window.APP_CONFIG&&APP_CONFIG.assetBase!==undefined)?APP_CONFIG.assetBase:"https://studin.in/";
    const files=await Promise.all(fileNames.map(async fn=>{
      const res=await fetch(base+fn);
      if(!res.ok)throw new Error("Couldn't fetch "+fn+" (server said "+res.status+")");
      const blob=await res.blob();
      return new File([blob],fn,{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    }));
    statusEl.style.display="none";statusEl.innerHTML="";
    handleHomeImportFiles(files);
    APP._isSampleData=true; // set AFTER — handleHomeImportFiles() itself resets this to false for real uploads
  }catch(err){
    statusEl.innerHTML=`<div class="card" style="border-color:var(--c-warn)">
      <b style="color:var(--c-warn)">Couldn't load the sample directly</b>
      <div style="font-size:12.5px;color:var(--c-text2);margin-top:6px">${esc(err.message)} — try again, or use <button type="button" onclick="showSampleFiles()" style="background:none;border:none;padding:0;font:inherit;cursor:pointer;color:var(--c-primary);text-decoration:underline">Sample Files</button> and the download icon instead.</div>
    </div>`;
    statusEl.style.display="block";
  }
}
function closeModal(){
  $("#modal-overlay").removeClass("open");
  if(_modalLastFocus&&_modalLastFocus.focus){try{_modalLastFocus.focus();}catch(e){}}
  _modalLastFocus=null;
}
function _modalFocusTrap(e){
  if(!$("#modal-overlay").hasClass("open"))return;
  if(e.key!=="Tab")return;
  const box=document.getElementById("modal-box");
  const focusables=box.querySelectorAll('a[href],button,textarea,input,select,[tabindex]:not([tabindex="-1"])');
  if(!focusables.length)return;
  const first=focusables[0],last=focusables[focusables.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
}
document.addEventListener("keydown",_modalFocusTrap);
function dbTabKeyNav(e,el){
  const tabs=Array.from(document.querySelectorAll('#db-tabs .db-tab'));
  const i=tabs.indexOf(el);
  let next=null;
  if(e.key==="ArrowRight")next=tabs[(i+1)%tabs.length];
  else if(e.key==="ArrowLeft")next=tabs[(i-1+tabs.length)%tabs.length];
  else if(e.key==="Home")next=tabs[0];
  else if(e.key==="End")next=tabs[tabs.length-1];
  if(next){e.preventDefault();tabs.forEach(t=>t.tabIndex=-1);next.tabIndex=0;next.focus();next.click();}
}

