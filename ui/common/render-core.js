import { esc, switchDbTab, toast } from '../../core/app-utils-init.js';
import { classifyRemarkTone, computeAnalysis, computeClassStats, scrollToEl } from '../../bal/common/compute-stats.js';
import { openIndividualBucket } from './render-buckets.js';
import { flagChapterSuffix } from './render-findings.js';
import { renderDataIssueBanner, showSampleNamesNotice, srT } from '../../core/render-i18n.js';
import { APP, DEFAULT_COUNTRY, goStep, isNavLockedForSetupTabs, refreshLangLockUI, setLangLockUI, updateNavHomeOnlyState } from '../../core/state-nav.js';
import { handleHomeImportFiles, resolveSheetName } from '../../core/template-upload.js';
import { renderShellLeftRail, renderShellRightRail } from '../../core/vs-shell.js';

// FIX (module-system conversion, HANDOVER #4): _charts used to be declared
// in state-nav.js purely as a shared-global convenience (never actually
// used there) — moved here since this file is the real owner (declares,
// reads, and reassigns it via destroyCharts()). See the matching note in
// state-nav.js.
let _charts = {};

/* ════════════════════════════════════════════════════════════════════
   RENDER-CORE — main dashboard render loop, KPIs, student cards,
   heatmap, all Chart.js chart rendering, filter/sort, student detail
   modal, remark/narrative field editing, sheet download, sample-file
   loading, modal focus trap.
   Split out of the former render-dashboard.js (review #5) — pure move,
   no logic changed.
   ════════════════════════════════════════════════════════════════════ */
function renderDashboard(){
  const s=APP.setup;$("#db-class-label").text([s.instName,s.className,s.section,s.year,s.teacher].filter(Boolean).join(" · "));
  renderDataIssueBanner();
  updateExportGate();
  const isIndividual=s.mode==="individual";
  // Chrome that only makes sense when comparing many students against
  // each other gets hidden entirely in Individual mode, rather than shown
  // with misleading/empty cohort numbers.
  // Individual mode is one child per workbook (enforced at import), so the
  // switcher only has a reason to appear for an older file saved before
  // that rule existed and never re-exported since.
  $("#individual-student-switcher").css("display",(isIndividual&&APP.students.length>1)?"flex":"none");
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
  const reason=srT("val_fix_data_quality_before_export");
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
  $("#db-class-label").text([s.instName,s.className+(s.section?" "+s.section:"")].filter(Boolean).join(" — ")||(isIndividual?srT("db_progress_dashboard"):srT("db_class_dashboard")));
  $("#db-mode-badge").html((isIndividual?"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-18'/></svg> ":"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-14'/></svg> ")+esc(isIndividual?srT("val_mode_individual"):srT("val_mode_institution"))); // U1: persistent mode indicator visible on Dashboard
  $("#db-meta-label").text([s.year?srT("db_academic_year_suffix",{year:s.year}):"",s.teacher?(isIndividual?srT("db_mentor_prefix",{name:s.teacher}):srT("db_teacher_prefix",{name:s.teacher})):""].filter(Boolean).join(" · "));
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
      {label:srT("kpi_average"),val:a.overallAvg+"%",sub:"",accent:a.overallAvg>=60?"#2ec4b6":"#f25454"},
      {label:srT("kpi_grade"),val:a.grade,sub:"",accent:"#2b3a67"},
      {label:srT("kpi_trend"),val:srT("val_trend_"+a.trend),sub:"",accent:a.trend==="improving"?"#2ec4b6":a.trend==="declining"?"#f25454":"#2b3a67"},
      {label:srT("kpi_met_target"),val:metTarget?srT("val_yes"):srT("val_not_yet"),sub:srT("kpi_target_suffix",{pct:APP.setup.passThreshold}),accent:metTarget?"#2ec4b6":"#f9a825"},
      {label:srT("kpi_health_score"),val:a.healthScore!=null?a.healthScore:"—",sub:a.healthBand?srT("val_healthband_"+a.healthBand.toLowerCase().replace(/ /g,"_")):"",accent:"#2ec4b6"},
    ];
    $("#kpi-row").html(kpiCards.map(k=>`<div class="kpi-card" style="--kpi-accent:${k.accent}"><div class="kpi-label">${k.label}</div><div class="kpi-val" style="color:${k.accent=="#2b3a67"?"var(--c-text)":k.accent}">${esc(String(k.val))}</div>${k.sub?`<div class="kpi-sub">${esc(k.sub)}</div>`:""}</div>`).join(""));
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
    {label:srT("kpi_total_students"),val:n,sub:"",accent:"#2b3a67"},
    {label:srT("kpi_class_avg"),val:classAvg+"%",sub:"",accent:classAvg>=60?"#2ec4b6":"#f25454"},
    {label:srT("kpi_pass_rate"),val:passRate+"%",sub:srT("kpi_x_of_y",{x:passing,y:n}),accent:passRate>=60?"#2ec4b6":"#f25454"},
    {label:srT("flag_badge_at_risk"),val:atRisk,sub:"",accent:atRisk>0?"#f25454":"#2ec4b6"},
    {label:srT("flag_badge_improving"),val:improving,sub:"",accent:"#2ec4b6"},
    {label:srT("kpi_class_topper"),val:top?top.name.split(" ")[0]:"—",sub:top?top.analysis.overallAvg+"%":"",accent:"#f9a825"},
  ];
  $("#kpi-row").html(kpiCards.map(k=>`<div class="kpi-card" style="--kpi-accent:${k.accent}"><div class="kpi-label">${k.label}</div><div class="kpi-val" style="color:${k.accent=="#2b3a67"?"var(--c-text)":k.accent}">${esc(String(k.val))}</div>${k.sub?`<div class="kpi-sub">${esc(k.sub)}</div>`:""}</div>`).join(""));
  // Stats bar
  // computeClassStats() is now async (step 3, dal/common/data-access.js) —
  // this render function stays sync. In the real flow APP.classStats is
  // always already populated here (computeAnalysis() awaits
  // computeClassStats() before any render call runs), so this fallback is
  // never actually exercised; kept as an inert `{}` rather than calling
  // the async function from sync code (which would silently assign a
  // Promise instead of the stats object).
  const _cs=APP.classStats||{};
  if(_cs&&_cs.median!=null){
    const _el=document.getElementById("db-stats-bar");
    if(_el){_el.innerHTML=`Median <b>${_cs.median}%</b> &nbsp;·&nbsp; SD <b>±${_cs.sd}</b> &nbsp;·&nbsp; Q1 <b>${_cs.q1}%</b> &nbsp;·&nbsp; Q3 <b>${_cs.q3}%</b> &nbsp;·&nbsp; ♥ Health <b>${_cs.healthAvg}</b>`;_el.style.display="block";}
  }
}
function renderStudentCards(){
  const isIndividual=APP.setup.mode==="individual";
  const filtered=getFilteredStudents();
  if(!filtered.length){$("#student-grid").html(`<div style='color:var(--c-text3);padding:20px'>${esc(srT("val_no_students_match_filter"))}</div>`);return;}
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
    const rmBadge=rm==null?"":rm>0?` <span style="color:var(--c-success);font-weight:700" title="${esc(srT("rank_movement_up_tip",{n:rm}))}">▲${rm}</span>`:rm<0?` <span style="color:var(--c-danger);font-weight:700" title="${esc(srT("rank_movement_down_tip",{n:-rm}))}">▼${-rm}</span>`:` <span style="color:var(--c-text3)" title="${esc(srT("rank_movement_none_tip"))}">—</span>`;
    const idLine=isIndividual?esc(st.id):`${esc(st.id)} · ${esc(srT("rank_hash_only",{rank:a.rank}))}${rmBadge}`;
    return `<div class="student-card" data-student-id="${esc(st.id)}"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;gap:8px"><div style="min-width:0;flex:1" title="${esc(st.name)}"><div class="sc-name">${esc(st.name)}</div><div class="sc-id">${idLine}</div></div><div style="text-align:right;flex-shrink:0"><div class="sc-avg" style="color:${color}">${a.overallAvg}%</div><div style="display:flex;align-items:center;gap:4px;justify-content:flex-end"><span style="font-size:11px;color:var(--c-text3)">${a.grade}</span>${a.healthScore!=null?`<span style="font-size:11px;padding:1px 5px;border-radius:99px;font-weight:700;background:${a.healthScore>=80?'#e6f9f7':a.healthScore>=65?'#eef0fd':a.healthScore>=50?'#fff4e0':'#fdecea'};color:${a.healthScore>=80?'#1a5c50':a.healthScore>=65?'#2d3ab1':a.healthScore>=50?'#9a6200':'#8b1a1a'}">♥${a.healthScore}</span>`:''}</div></div></div><div class="sc-bar"><div class="sc-bar-fill" style="transform:scaleX(${(a.overallAvg/100).toFixed(4)});background:${color}"></div></div>${sparkData.length>1?`<div style="margin:6px 0">${sparkSvg}</div>`:""}<div class="sc-flags">${flagBadges}</div></div>`;
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
  $("#heatmap-card-title").text(isIndividual?srT("card_subject_performance"):srT("card_performance_heatmap"));
  if(!sts.length||!subjects.length){$("#heatmap-wrap").html(`<div style='color:var(--c-text3);padding:10px'>${esc(srT("val_no_data_short"))}</div>`);return;}
  function hmClass(p){return p>=85?"hm-ex":p>=70?"hm-good":p>=50?"hm-avg":p>=APP.setup.passThreshold?"hm-below":"hm-risk";}
  // U5: with exactly one row (Individual mode), a "Student" column just
  // repeats the same name in every row and adds no information — drop it
  // and let the subject columns stand on their own.
  const hdr=(isIndividual?"":"<th>Student</th>")+subjects.map(s=>`<th>${esc(s)}</th>`).join("")+"<th>Avg</th>";
  const rows=sts.map(st=>`<tr>${isIndividual?"":`<td style="font-weight:600;white-space:nowrap">${esc(st.name)}</td>`}${subjects.map(s=>`<td class="${hmClass(st.analysis.subjectAvgs[s]||0)}">${st.analysis.subjectAvgs[s]||0}%</td>`).join("")}<td style="font-weight:700">${st.analysis.overallAvg}%</td></tr>`).join("");
  $("#heatmap-wrap").html(`<table class="heatmap-table"><thead><tr>${hdr}</tr></thead><tbody>${rows}</tbody></table>`);
}
// Small hex(+alpha) helper so chart fills/bars follow whatever
// --c-primary currently is instead of a hardcoded color that goes stale
// the moment the palette changes (was "rgba(43,58,103,...)" — the old
// navy — baked into 6 chart calls below, unrelated to the CSS variable
// every chart LINE color already correctly read via primaryColor).
function hexToRgba(hex,alpha){
  const h=String(hex||"").replace("#","");
  const full=h.length===3?h.split("").map(c=>c+c).join(""):h;
  const r=parseInt(full.slice(0,2),16),g=parseInt(full.slice(2,4),16),b=parseInt(full.slice(4,6),16);
  if([r,g,b].some(Number.isNaN))return `rgba(43,58,103,${alpha})`; // safe fallback, old navy
  return `rgba(${r},${g},${b},${alpha})`;
}
// Shared by renderCharts() and the bucket-screen charts added in BUILD spec
// §4/Phase 5 — same "read real colors from computed style, tune touch
// interaction" logic, now called from both places instead of duplicated.
function configureChartDefaults(){
  const cs=getComputedStyle(document.documentElement);
  const primaryColor=cs.getPropertyValue('--c-primary').trim()||'#2b3a67';
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
  if(!students.length||!subjects.length)return `<div style='color:var(--c-text3);padding:10px'>${esc(srT("val_no_data_short"))}</div>`;
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
  _bucketCharts.classSubj=new Chart($("#bucket-chart-classsubj")[0],{type:"bar",data:{labels:subjects,datasets:[{label:"Class Avg %",data:subjAvgs,backgroundColor:hexToRgba(primaryColor,.7),borderRadius:4}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100}}}});
  // Class trend-over-tests (§5 teacher/management): aggregates each
  // student's existing cumAvgByTest (computed per-student in
  // computeAnalysis(), compute-engine.js) into a class-level average per
  // test index. Presentation only — no new per-student computation.
  if($("#bucket-chart-classtrend").length){
    const classTrend=tests.map((_,ti)=>{
      const vals=sts.map(st=>st.analysis.cumAvgByTest&&st.analysis.cumAvgByTest[ti]).filter(v=>v!==null&&v!==undefined);
      return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
    });
    _bucketCharts.classTrend=new Chart($("#bucket-chart-classtrend")[0],{type:"line",data:{labels:tests.map(t=>t.name),datasets:[{label:"Class Cumulative Avg %",data:classTrend,borderColor:primaryColor,backgroundColor:hexToRgba(primaryColor,.1),tension:.3,fill:true}]},options:{responsive:true,scales:{y:{beginAtZero:true,max:100}}}});
  }
  $("#bucket-heatmap-wrap").html(bucketHeatmapHtml(sts,subjects));
}
function renderBucketStudentTrendChart(canvasId,student){
  destroyBucketCharts();
  const {tests}=APP.setup;
  if(!student||!$("#"+canvasId).length)return;
  const {primaryColor}=configureChartDefaults();
  const trend=tests.map((_,ti)=>student.analysis.testAvgs?student.analysis.testAvgs[ti]:null);
  _bucketCharts.studentTrend=new Chart($("#"+canvasId)[0],{type:"line",data:{labels:tests.map(t=>t.name),datasets:[{label:student.name+" — Overall %",data:trend,borderColor:primaryColor,backgroundColor:hexToRgba(primaryColor,.1),tension:.3,fill:true}]},options:{responsive:true,scales:{y:{beginAtZero:true,max:100}}}});
}
function renderBucketSubjectDistChart(canvasId,rows){
  destroyBucketCharts();
  if(!rows.length||!$("#"+canvasId).length)return;
  const {primaryColor}=configureChartDefaults();
  _bucketCharts.subjectDist=new Chart($("#"+canvasId)[0],{type:"bar",data:{labels:rows.map(r=>r.name.split(" ")[0]),datasets:[{label:"Score %",data:rows.map(r=>r.avg),backgroundColor:rows.map(r=>r.avg>=80?"rgba(46,196,182,.7)":r.avg>=APP.setup.passThreshold?hexToRgba(primaryColor,.7):"rgba(242,92,84,.7)"),borderRadius:4}]},options:{responsive:true,indexAxis:"y",plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,max:100}}}});
}
// P1 #14: fills the sr-only <table> that sits next to a Chart.js canvas
// (see index.html) so screen-reader users get the same data the chart
// shows. One header row + one row per data point; two-column tables
// (subject/trend charts) render as label+value pairs in a single body
// row, matching the markup already in index.html.
function chartDataTable(tableId, headers, rows){
  const table=document.getElementById(tableId);
  if(!table)return;
  const headRow=table.querySelector("thead tr");
  if(headRow)headRow.innerHTML=headers.map(h=>`<th scope="col">${esc(h)}</th>`).join("");
  const tbody=table.querySelector("tbody");
  if(!tbody)return;
  if(rows.length&&Array.isArray(rows[0])&&rows[0].length===2&&tbody.querySelector("tr")&&tbody.children.length===1&&headers.length===2){
    // Two-column data (subject averages / trend): one label + value per
    // point, laid out as a single label row + single value row so it
    // reads left-to-right the same order as the chart's x-axis.
    tbody.innerHTML=`<tr>${rows.map(r=>`<th scope="row">${esc(r[0])}</th>`).join("")}</tr><tr>${rows.map(r=>`<td>${esc(String(r[1]))}</td>`).join("")}</tr>`;
  }else{
    tbody.innerHTML=rows.map(r=>`<tr>${r.map((c,i)=>i===0?`<th scope="row">${esc(c)}</th>`:`<td>${esc(String(c))}</td>`).join("")}</tr>`).join("");
  }
}
function renderCharts(){
  destroyCharts();const {subjects,tests}=APP.setup;const isIndividual=APP.setup.mode==="individual";
  const sts=isIndividual?getFilteredStudents():APP.students;
  if(!sts.length)return;
  const {primaryColor}=configureChartDefaults();
  $("#chart-subject-avg-title").text(srT("card_subject_averages"));
  $("#chart-trend-title").text(isIndividual?srT("finding_progress_trend_title"):srT("card_class_trend"));
  const seriesLabel=isIndividual?srT("card_average_pct"):srT("card_class_avg_pct");
  // In Individual mode `sts` is just the one selected student (see above),
  // so these are already "their own" averages, not a cohort blend —
  // no code branch needed here beyond the label change.
  const subjAvgs=subjects.map(s=>{const avgs=sts.map(st=>st.analysis.subjectAvgs[s]||0);return Math.round(avgs.reduce((a,b)=>a+b,0)/avgs.length);});
  _charts.subjectAvg=new Chart($("#chart-subject-avg")[0],{type:"bar",data:{labels:subjects,datasets:[{label:seriesLabel,data:subjAvgs,backgroundColor:hexToRgba(primaryColor,.7),borderRadius:4}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100}}}});
  chartDataTable("chart-subject-avg-table",["Subject",seriesLabel],subjects.map((s,i)=>[s,subjAvgs[i]+"%"]));
  const trendAvgs=tests.map((_,ti)=>{const avgs=sts.map(st=>st.analysis.testAvgs[ti]).filter(v=>v!==null);return avgs.length?Math.round(avgs.reduce((a,b)=>a+b,0)/avgs.length):null;});
  const validTrendPoints=trendAvgs.filter(v=>v!==null).length;
  // Individual mode, single test on record: a line chart with exactly one
  // point reads as broken, not "waiting for more data" — hide the canvas
  // and say plainly what unlocks once a second test is added, instead of
  // rendering a chart with nothing to show a trend across.
  if(isIndividual&&validTrendPoints<2){
    $("#chart-trend").hide();
    $("#chart-trend-table").hide();
    $("#chart-trend-note").show().text("Only one test on record — add the next test's marks to see a progress trend here.");
  }else{
    $("#chart-trend").show();
    $("#chart-trend-table").show();
    $("#chart-trend-note").hide().text("");
    _charts.trend=new Chart($("#chart-trend")[0],{type:"line",data:{labels:tests.map(t=>t.name),datasets:[{label:seriesLabel,data:trendAvgs,borderColor:primaryColor,backgroundColor:hexToRgba(primaryColor,.1),tension:.3,fill:true}]},options:{responsive:true,scales:{y:{beginAtZero:true,max:100}}}});
    chartDataTable("chart-trend-table",["Test",seriesLabel],tests.map((t,i)=>[t.name,trendAvgs[i]===null?"—":trendAvgs[i]+"%"]));
  }
  // Cross-student comparison charts (attendance-vs-marks scatter, Top
  // Performers ranking) only render in Institution mode — the canvases
  // are hidden in Individual mode via #cohort-charts-row, but skip the
  // (wasted) Chart.js calls entirely too.
  if(isIndividual)return;
  _charts.scatter=new Chart($("#chart-scatter")[0],{type:"scatter",data:{datasets:[{label:"Students",data:sts.map(st=>({x:st.analysis.totalAbsent||0,y:st.analysis.overallAvg})),backgroundColor:hexToRgba(primaryColor,.6),pointRadius:5}]},options:{responsive:true,scales:{x:{title:{display:true,text:srT("card_total_absences")}},y:{title:{display:true,text:"Avg %"},min:0,max:100}}}});
  chartDataTable("chart-scatter-table",[srT("th_student")||"Student",srT("card_total_absences"),"Avg %"],sts.map(st=>[st.name,st.analysis.totalAbsent||0,st.analysis.overallAvg+"%"]));
}
function destroyCharts(){Object.values(_charts).forEach(c=>c&&c.destroy());_charts={};}
function renderWellbeingPanel(){
  const isIndividual=APP.setup.mode==="individual";
  const sts=isIndividual?getFilteredStudents():APP.students,n=sts.length||1;
  const high=sts.filter(s=>s.analysis.wellbeingFlag==="high").length,mod=sts.filter(s=>s.analysis.wellbeingFlag==="moderate").length,avgStress=Math.round(sts.reduce((a,s)=>a+s.analysis.stressScore,0)/n);
  if(isIndividual){
    const st=sts[0];
    if(!st){$("#wellbeing-panel").html("");return;}
    const label=st.analysis.wellbeingFlag==="high"?srT("val_level_high"):st.analysis.wellbeingFlag==="moderate"?srT("val_level_moderate"):srT("val_level_low");
    const color=st.analysis.wellbeingFlag==="high"?"var(--c-danger)":st.analysis.wellbeingFlag==="moderate"?"var(--c-warn)":"var(--c-success)";
    const emoji=st.analysis.wellbeingFlag==="high"?"😰":st.analysis.wellbeingFlag==="moderate"?"😐":"😊";
    $("#wellbeing-panel").html(`<div class="wb-grid"><div class="wb-card"><div style="font-size:22px">${emoji}</div><div style="font-size:12px;font-weight:600;margin:4px 0">${esc(srT("wb_stress_level"))}</div><div class="wb-val" style="color:${color}">${label}</div></div><div class="wb-card" data-tip="${esc(srT("wb_disclaimer"))}"><div style="font-size:22px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-28'/></svg></div><div style="font-size:12px;font-weight:600;margin:4px 0">${esc(srT("wb_stress_score"))}</div><div class="wb-val">${st.analysis.stressScore}/100</div></div><div class="wb-card"><div style="font-size:22px">📅</div><div style="font-size:12px;font-weight:600;margin:4px 0">${esc(srT("wb_absences"))}</div><div class="wb-val">${st.analysis.totalAbsent||0}</div></div></div>`);
    return;
  }
  $("#wellbeing-panel").html(`<div class="wb-grid"><div class="wb-card"><div style="font-size:22px">😰</div><div style="font-size:12px;font-weight:600;margin:4px 0">${esc(srT("wb_high_stress"))}</div><div class="wb-val" style="color:var(--c-danger)">${high}</div></div><div class="wb-card"><div style="font-size:22px">😐</div><div style="font-size:12px;font-weight:600;margin:4px 0">${esc(srT("val_level_moderate"))}</div><div class="wb-val" style="color:var(--c-warn)">${mod}</div></div><div class="wb-card"><div style="font-size:22px">😊</div><div style="font-size:12px;font-weight:600;margin:4px 0">${esc(srT("wb_low_stress"))}</div><div class="wb-val" style="color:var(--c-success)">${n-high-mod}</div></div><div class="wb-card" data-tip="${esc(srT("wb_disclaimer"))}"><div style="font-size:22px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-28'/></svg></div><div style="font-size:12px;font-weight:600;margin:4px 0">${esc(srT("wb_avg_stress_score"))}</div><div class="wb-val">${avgStress}/100</div></div></div>`);
}
function renderFlagsTable(){
  const isIndividual=APP.setup.mode==="individual";
  const pool=isIndividual?getFilteredStudents():APP.students;
  const flagged=pool.filter(s=>s.flags.length);
  if(!flagged.length){$("#flags-table-wrap").html(`<div style='color:var(--c-text3);padding:10px'>${esc(srT("val_no_flags_detected"))}</div>`);return;}
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
    $("#attendance-correlation-panel").html(`<div class="wb-grid"><div class="wb-card"><div style="font-size:22px">🟢</div><div style="font-size:12px;font-weight:600;margin:4px 0">No Absences (n=${ac.noAbsence.n})</div><div class="wb-val" style="color:var(--c-success)">${ac.noAbsence.avg}%</div></div><div class="wb-card"><div style="font-size:22px">🟠</div><div style="font-size:12px;font-weight:600;margin:4px 0">1+ Absences (n=${ac.someAbsence.n})</div><div class="wb-val" style="color:var(--c-warn)">${ac.someAbsence.avg}%</div></div><div class="wb-card"><div style="font-size:22px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-75'/></svg></div><div style="font-size:12px;font-weight:600;margin:4px 0">Gap</div><div class="wb-val">${gap>=0?"+":""}${gap}%</div></div></div><div style="font-size:11px;color:var(--c-text3);margin-top:8px">Correlation only — this doesn't prove absences *cause* the difference, just that the two groups scored differently this term.</div>`);
  }
  const sw=cs.subjectWeakness||[];
  if(!sw.length){$("#subject-weakness-wrap").html(`<div style='color:var(--c-text3);padding:10px'>${esc(srT("val_no_subject_data"))}</div>`);}
  else{$("#subject-weakness-wrap").html(`<table class="data-table"><thead><tr><th>${esc(srT("th_subject"))}</th><th>${esc(srT("th_class_average"))}</th><th>${esc(srT("th_pct_below_pass"))}</th></tr></thead><tbody>${sw.map(r=>`<tr><td style="font-weight:600">${esc(r.subject)}</td><td>${r.avgClass}%</td><td style="color:${r.pctBelow>=40?'var(--c-danger)':r.pctBelow>=20?'var(--c-warn)':'var(--c-success)'}">${r.pctBelow}%</td></tr>`).join("")}</tbody></table>`);}
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
    const reason=subjCount<2?srT("val_needs_2_subjects"):srT("val_needs_10_students",{n:APP.classStats&&APP.classStats.n||0});
    el.html(`<div style='color:var(--c-text3);padding:10px'>${esc(srT("val_not_enough_data_compare",{reason:reason}))}</div>`);
    return;
  }
  function cellColor(r){
    if(r===null)return "background:var(--c-surface2);color:var(--c-text3)";
    if(r===1)return "background:var(--c-surface2);color:var(--c-text2);font-weight:700";
    const strength=Math.min(Math.abs(r),1);
    const varName=r>=0?"--c-success":"--c-danger";
    return `background:color-mix(in srgb, var(${varName}) ${Math.round(15+strength*55)}%, transparent);font-weight:${strength>=0.4?700:400}`;
  }
  const head=`<th></th>${sc.subjects.map(s=>`<th style="writing-mode:vertical-rl;text-orientation:mixed;font-size:11px;padding:6px 2px;max-width:34px">${esc(s)}</th>`).join("")}`;
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
// Extracted out of buildStudentDetailHtml() so the same KPI-card visuals
// (overall avg / trend / absences / stress, health score, consistency /
// growth / engagement / early-warning) can also be dropped into the
// Progress Report bucket screen (render-buckets.js) — that screen used to
// be just two paragraphs and a chart, with none of the numbers this strip
// already computes and displays elsewhere. Pure extraction: markup and
// values are unchanged from what buildStudentDetailHtml rendered before.
// Split into three pieces (top KPI grid / health score / bottom KPI grid)
// so Individual mode's Progress Report can sandwich the score table between
// the two grids (per the requested Individual-mode layout) while Institution
// mode keeps using the single combined buildStudentKpiStripHtml() below,
// unchanged, exactly as before.
function buildStudentKpiTopGridHtml(st){
  const a=st.analysis;
  return `<div class="grid-4" style="margin-bottom:16px"><div class="kpi-card"><div class="kpi-label">${esc(srT("detail_overall_avg"))}</div><div class="kpi-val">${a.overallAvg}%</div></div><div class="kpi-card"><div class="kpi-label">${esc(srT("kpi_trend"))}</div><div class="kpi-val" style="font-size:16px">${a.trend==="improving"?"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-23'/></svg>":a.trend==="declining"?"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-75'/></svg>":"➡"} ${esc(srT("val_trend_"+a.trend))}</div></div><div class="kpi-card"><div class="kpi-label">${esc(srT("card_total_absences"))}</div><div class="kpi-val">${a.totalAbsent}</div></div><div class="kpi-card" data-tip="${esc(srT("detail_stress_tip"))}"><div class="kpi-label">${esc(srT("detail_stress_label"))}</div><div class="kpi-val" style="font-size:16px">${a.wellbeingFlag}</div></div></div>`;
}
function buildStudentHealthScoreHtml(st){
  const a=st.analysis;
  return a.healthScore!=null?`<div style="margin-bottom:10px;padding:8px 12px;border-radius:var(--r-sm);display:flex;align-items:center;gap:10px;background:${a.healthScore>=80?'#e6f9f7':a.healthScore>=65?'#eef0fd':a.healthScore>=50?'#fff4e0':'#fdecea'}" data-tip="${esc(srT("detail_health_score_tip"))}"><div style="font-size:22px;font-weight:700;font-family:var(--font-display);color:${a.healthScore>=80?'#1a5c50':a.healthScore>=65?'#2d3ab1':a.healthScore>=50?'#9a6200':'#8b1a1a'}">♥ ${a.healthScore}</div><div><div style="font-weight:700;font-size:12px">${esc(srT("kpi_health_score"))} — ${a.healthBand?esc(srT("val_healthband_"+a.healthBand.toLowerCase().replace(/ /g,"_"))):''}</div><div style="font-size:11px;color:var(--c-text2)">${esc(srT("detail_health_score_breakdown"))}</div></div></div>`:"";
}
function buildStudentKpiBottomGridHtml(st){
  const a=st.analysis;const isIndividual=APP.setup.mode==="individual";
  return `<div class="grid-4" style="margin-bottom:14px">
  <div class="kpi-card"><div class="kpi-label">${esc(srT("detail_consistency"))}</div><div class="kpi-val" style="font-size:18px">${a.consistencyScore||"—"}%</div></div>
  <div class="kpi-card"><div class="kpi-label">${esc(srT("detail_growth_rate"))}</div><div class="kpi-val" style="font-size:18px;color:${(a.growthRate||0)>=0?"var(--c-success)":"var(--c-danger)"}">${(a.growthRate||0)>=0?"+":""}${a.growthRate||0}%</div></div>
  <div class="kpi-card" data-tip="${esc(srT("detail_engagement_tip"))}"><div class="kpi-label">${esc(srT("detail_engagement_label"))}</div><div class="kpi-val" style="font-size:18px">${a.engagementIndex||"—"}</div></div>
  <div class="kpi-card"><div class="kpi-label">${esc(srT("detail_ew_score"))}</div><div class="kpi-val" style="font-size:18px;color:${(a.earlyWarningScore||0)>=50?"var(--c-danger)":(a.earlyWarningScore||0)>=25?"var(--c-warn)":"var(--c-success)"}">${a.earlyWarningScore||0}</div></div>
  ${isIndividual?"":`<div class="kpi-card"><div class="kpi-label">${esc(srT("detail_competitive"))}</div><div class="kpi-val" style="font-size:13px">${a.competitiveReadiness?esc(srT("val_competitive_"+a.competitiveReadiness.toLowerCase().replace(/ /g,"_"))):"—"}</div></div>
  <div class="kpi-card"><div class="kpi-label">${esc(srT("detail_topper_gap"))}</div><div class="kpi-val" style="font-size:18px">${a.topperGap||0}%</div></div>`}
</div>`;
}
function buildStudentKpiStripHtml(st){
  return buildStudentKpiTopGridHtml(st)+buildStudentHealthScoreHtml(st)+buildStudentKpiBottomGridHtml(st);
}
// Extracted out of buildStudentDetailHtml() so the same test-by-subject
// marks table (with Total/Avg/Absent/Remark columns and, in Institution
// mode, the Class Avg row) can also appear in Individual mode's Progress
// Report bucket (render-buckets.js) — that screen used to only show a
// chart and narrative paragraphs, with no actual score table, even though
// this is the one place a parent expects to see every test's marks per
// subject. Pure extraction: markup and values unchanged from what
// buildStudentDetailHtml rendered before.
function buildStudentScoreTableHtml(st){
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
    const totalCell=opted>0?`${sumScored}/${sumMax}<div style="font-size:11px;color:var(--c-text3)">${opted}/${subjects.length} opted</div>`:`<span style="color:var(--c-text3)">-</span>`;
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
    return `<tr style="font-style:italic;background:var(--c-primary-soft)"><td>${esc(srT("card_class_avg"))}</td>${perSubjAvgs.map(v=>`<td>${v!==null?v+"%":"-"}</td>`).join("")}<td>-</td><td>${classOverall!==null?classOverall+"%":"-"}</td><td>-</td><td></td></tr>`;
  })():"";
  return `<div class="tbl-wrap" style="margin-bottom:4px"><table class="data-table"><thead><tr><th>${esc(srT("th_test"))}</th>${subjects.map(s=>`<th>${esc(s)}</th>`).join("")}<th>${esc(srT("th_total"))}</th><th>${esc(srT("th_avg"))}</th><th>${esc(srT("th_absent"))}</th><th>${esc(srT("th_remark"))}</th></tr></thead><tbody>${testRows}${classAvgRow}</tbody></table></div><div style="font-size:11px;color:var(--c-text3);margin-bottom:16px">${esc(srT("detail_total_formula_note"))}</div>`;
}
function buildStudentDetailHtml(st){
  const a=st.analysis;
  const isIndividual=APP.setup.mode==="individual";
  // Percentile is a ranking, not a percentage score — clarified inline
  // right where a parent actually reads it. Below 12 students a percentile
  // implies false precision, so show rank + a plain point-difference from
  // the class average instead.
  const classAvgAll=(!isIndividual&&APP.students&&APP.students.length>1)?(()=>{const vals=APP.students.map(s2=>s2.analysis&&s2.analysis.overallAvg).filter(v=>v!==undefined&&v!==null);return vals.length?Math.round(vals.reduce((x,y)=>x+y,0)/vals.length):null;})():null;
  const standingBit=isIndividual?"":(APP.students.length>=12
    ?srT("detail_rank_percentile",{rank:a.rank,total:APP.students.length,pct:a.percentile})
    :srT("detail_rank_only",{rank:a.rank,total:APP.students.length})+(classAvgAll!==null?srT("detail_rank_points_diff",{points:Math.abs(a.overallAvg-classAvgAll),dir:a.overallAvg>=classAvgAll?srT("val_above"):srT("val_below"),avg:classAvgAll}):""));
  const idLine=isIndividual?srT("detail_id_grade",{id:esc(st.id),grade:a.grade}):srT("detail_id_standing_grade",{id:esc(st.id),standing:standingBit,grade:a.grade});
  // Layout brought in line with Individual mode's Progress Report screen
  // (render-buckets.js renderIndividualReportAnswer): top KPI grid, score
  // table, health score, bottom KPI grid, then the Progress Trend chart —
  // same order, same chart, just reused here for Institution mode's One
  // Student screen so both look consistent. Nothing here is removed, the
  // Institution-only pieces (Best/Weakest Test, flags, subject-vs-class
  // deltas) just move to after the chart instead of sitting before the
  // score table.
  const validTestCount=(a.testAvgs||[]).filter(v=>v!==null&&v!==undefined).length;
  const hasTrend=validTestCount>=2;
  const trendChartHtml=hasTrend?`<div class="chart-container" style="margin-top:14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="card-title">${esc(srT("card_progress_trend"))}</div>
        <button class="btn btn-secondary btn-sm" data-action="shareInsightAsImage" data-arg="${esc(st.id)}"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-73'/></svg> Share as Image</button>
      </div>
      <canvas id="bucket-chart-student-trend"></canvas>
    </div>`:"";
  return `<h3 style="font-family:var(--font-display);font-size:18px;margin-bottom:4px">${esc(st.name)}</h3><div style="font-size:12px;color:var(--c-text3);margin-bottom:16px">${idLine}</div>
${buildStudentKpiTopGridHtml(st)}
${buildStudentScoreTableHtml(st)}
${buildStudentHealthScoreHtml(st)}
${buildStudentKpiBottomGridHtml(st)}
${trendChartHtml}
<div class="grid-4" style="margin-bottom:14px">
  <div class="kpi-card"><div class="kpi-label">${esc(srT("kpi_best_test"))}</div><div class="kpi-val" style="font-size:14px">${a.bestTest?esc(a.bestTest.name)+" ("+a.bestTest.pct+"%)":"—"}</div></div>
  <div class="kpi-card"><div class="kpi-label">${esc(srT("kpi_weakest_test"))}</div><div class="kpi-val" style="font-size:14px">${a.worstTest?esc(a.worstTest.name)+" ("+a.worstTest.pct+"%)":"—"}</div></div>
</div>
${a.explainedWarnings&&a.explainedWarnings.length?`<div style="margin-bottom:12px"><div style="font-weight:600;font-size:11px;margin-bottom:6px">⚠ ${esc(srT("detail_alerts_explanations"))}</div>${a.explainedWarnings.map(f=>`<div style="margin-bottom:5px;padding:6px 10px;border-radius:var(--r-sm);background:${f.color}18;border-left:3px solid ${f.color}"><div style="font-weight:700;font-size:11px;color:${f.color}">${f.label}</div><div style="font-size:11px;color:var(--c-text2);margin-top:2px">${(f.reason||'')+flagChapterSuffix(st,f.type)}</div></div>`).join('')}</div>`:st.flags.length?`<div style="margin-bottom:14px"><div style="font-weight:600;margin-bottom:6px">${esc(srT("detail_flags_label"))}</div>${st.flags.map(f=>`<span class="badge" style="background:${f.color}22;color:${f.color};margin-right:6px">${f.label}</span>`).join("")}</div>`:""}
${!isIndividual&&a.subjectDeltas&&Object.keys(a.subjectDeltas).length?`<div class="card" style="padding:12px;margin-bottom:14px"><div class="card-title" style="margin-bottom:6px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-28'/></svg> vs. Class Average, by Subject</div><div style="display:flex;flex-wrap:wrap;gap:6px">${Object.entries(a.subjectDeltas).map(([s,d])=>`<span class="badge" style="background:${d>=0?'var(--c-success)':'var(--c-danger)'}18;color:${d>=0?'var(--c-success)':'var(--c-danger)'}" title="${esc(s)}: ${d>=0?'above':'below'} the class average by ${Math.abs(d)} points">${esc(s)} ${d>=0?"+":""}${d}</span>`).join("")}</div></div>`:""}
${/* STUDIN-PRO: "At School" narrative card commented out per request.
   Original call preserved below for easy restore; narrativeCard() and
   saveNarrativeField() are left untouched since other fields still use them.
${!isIndividual&&a.schoolPlan?narrativeCard("<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-14'/></svg>","At School","schoolPlan",a.schoolPlan,st.id):""}
*/ ""}`;
}
function openStudentModal(id){
  const st=APP.students.find(s=>s.id===id);if(!st)return;
  $("#modal-content").html(buildStudentDetailHtml(st));
  // buildStudentDetailHtml only emits the Progress Trend canvas when the
  // student has 2+ tests (see hasTrend there) — mirror Individual mode's
  // renderIndividualReportAnswer by only initializing the chart when that
  // canvas actually exists.
  if($("#bucket-chart-student-trend").length) renderBucketStudentTrendChart("bucket-chart-student-trend",st);
  gsapModalEntrance();
  _modalLastFocus=document.activeElement;
  setTimeout(()=>{const f=document.querySelector('#modal-overlay.open .modal-close');if(f)f.focus();},0);
}
let _modalLastFocus=null;
// BUG FIX: language selector needs locking while the Sample Files modal
// is open (switching language mid-browse re-renders the sample list/
// descriptions out from under the user) but closeModal() is shared by 3
// other modal types that shouldn't touch the lock at all. This flag lets
// closeModal() know whether IT was the one that locked, so it only
// restores the lock state (via refreshLangLockUI, not a blind unlock —
// the underlying step, e.g. Setup, may already lock it independently)
// when Sample Files specifically is what's closing.
let _sampleFilesModalLockedLang=false;
// One shared builder for every editable narrative box (Report Card Comment,
// For Parents, Strengths, Motivation, Study Plan, Intervention Note) instead
// of hand-duplicating the textarea+Save markup six times — each edit still
// only ever touches its own field on st.analysis, in-memory, same stateless
// model as everything else.
function narrativeCard(icon,title,field,value,studentId){
  return `<div class="card" style="padding:12px"><div class="card-title" style="margin-bottom:6px">${icon} ${title} <span style="font-weight:400;color:var(--c-text3);font-size:11px">(editable — used in the exported PDF)</span></div><textarea class="narrative-edit" data-field="${field}" style="width:100%;min-height:56px;font-size:13px;font-family:inherit;padding:8px;border:1px solid var(--c-border);border-radius:var(--r-sm);resize:vertical" data-input-action="narrativeEdit">${esc(value||"")}</textarea><div class="narrative-save-row" style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn btn-secondary" style="padding:5px 14px;font-size:12px" disabled data-action="saveNarrativeField" data-arg="${esc(studentId)}" data-arg2="${field}">${esc(srT("btn_save"))}</button></div></div>`;
}
function saveNarrativeField(id,field,btnEl){
  const st=APP.students.find(s=>s.id===id);if(!st)return;
  const $ta=$(btnEl).closest(".card").find("textarea.narrative-edit");
  st.analysis[field]=$ta.val();
  $(btnEl).prop("disabled",true);
  const labels={parentMessage:srT("narrative_bottom_line"),strengthsLetter:srT("narrative_strengths_note"),homePlan:srT("narrative_home_plan"),schoolPlan:srT("narrative_school_plan")};
  toast(srT("toast_field_saved_for",{field:labels[field]||srT("narrative_field_default"),name:st.name.split(" ")[0]}),"success");
}
// Small badge for a computed remark tone (see classifyRemarkTone in
// compute-engine.js) — same .badge + "color+22-suffix-opacity" convention
// already used for flags and subject-delta badges above.
function remarkToneBadgeHtml(tone){
  if(!tone)return "";
  const map={positive:{c:"var(--c-success)",l:srT("val_tone_positive")},neutral:{c:"var(--c-text3)",l:srT("val_tone_neutral")},concern:{c:"var(--c-warn)",l:srT("val_tone_concern")}};
  const m=map[tone];if(!m)return "";
  return `<span class="badge" style="background:${m.c}22;color:${m.c};margin-left:6px" title="${esc(srT("remark_tone_tip"))}">${m.l}</span>`;
}
// TASK 3a (studin-features-prompt v1.0): editable per-test remark cards,
// reusing the narrativeCard() textarea+Save markup pattern — remarks live
// at st.testData[testName].remark (nested per test), not a flat
// st.analysis field, so they get their own small save handler rather than
// forcing that shape through saveNarrativeField().
function remarkCardsHtml(st){
  const tests=(APP.setup&&APP.setup.tests)||[];
  if(!tests.length)return "";
  return `<div class="card" style="padding:12px"><div class="card-title" style="margin-bottom:8px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-76'/></svg> Teacher Remarks <span style="font-weight:400;color:var(--c-text3);font-size:11px">(editable — download the updated sheet to keep changes)</span></div><div style="display:flex;flex-direction:column;gap:10px">${tests.map(t=>{
    const remark=(st.testData[t.name]||{}).remark||"";
    const remarkTone=(st.testData[t.name]||{}).remarkTone;
    const remarkId="remark-"+esc(st.id)+"-"+esc(t.name).replace(/[^\w]/g,"_");
    const rlen=remark.length;
    const rcountText=rlen+" characters"+(rlen>300?" — long remarks may push other sections to extra pages in the PDF":"");
    const rcountColor=rlen>300?"var(--c-warn,#f9a826)":"var(--c-text3)";
    return `<div><div style="font-size:11.5px;font-weight:700;color:var(--c-text2);margin-bottom:4px">${esc(t.name)}${remarkToneBadgeHtml(remarkTone)}</div><textarea class="narrative-edit remark-edit" data-test="${esc(t.name)}" id="${remarkId}" style="width:100%;min-height:44px;font-size:13px;font-family:inherit;padding:8px;border:1px solid var(--c-border);border-radius:var(--r-sm);resize:vertical" data-input-action="remarkEdit">${esc(remark)}</textarea><div class="narrative-save-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:4px"><span class="remark-char-count" data-for="${remarkId}" style="font-size:11px;color:${rcountColor}">${rcountText}</span><button class="btn btn-secondary" style="padding:5px 14px;font-size:12px" disabled data-action="saveRemarkField" data-arg="${esc(st.id)}" data-arg2="${esc(t.name)}">${esc(srT("btn_save"))}</button></div></div>`;
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
  toast(srT("toast_remark_saved_for",{name:st.name.split(" ")[0],test:testName}),"success");
}
// TASK 3a: persistent banner (reusing #merge-banner's visual style) telling
// the teacher a NEW file needs to be downloaded to keep their edits —
// nothing is written back to the originally-uploaded file.
function showRemarksDirtyBanner(){
  if($("#remarks-dirty-banner").length)return; // already showing
  const banner=$(`<div id="remarks-dirty-banner" style="position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:1200;padding:10px 16px;background:#e6f7ee;border:1px solid #1a7a4c33;border-radius:var(--r-sm);font-size:12.5px;color:#1a7a4c;box-shadow:0 4px 18px rgba(0,0,0,.15);display:flex;align-items:center;gap:10px">
    <span>Remarks updated — download a fresh copy to keep them.</span>
    <button class="btn btn-success btn-sm" style="padding:4px 12px;font-size:12px" data-action="downloadUpdatedSheet">${esc(srT("btn_download_updated_sheet"))}</button>
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
  if(!APP.rawData||!APP.students.length){toast(srT("val_no_data_loaded"),"warn");return;}
  const markKey=Object.keys(APP.rawData).find(k=>k.includes("MARK")&&k.includes("CONTEXT"))
                 ||Object.keys(APP.rawData).find(k=>k.includes("MARK"));
  if(!markKey){toast(srT("val_cannot_find_marks_sheet"),"error");return;}
  const rows=APP.rawData["_arr_"+markKey];
  if(!rows){toast(srT("val_raw_data_not_available"),"error");return;}
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
  toast(srT("toast_updated_sheet_downloaded",{fname:fname}),"success");
  APP._remarksDirty=false;
  $("#remarks-dirty-banner").remove();
}
════════════════════════════════════════════════════════════════════ */

// PRESERVATION POLICY (EXCEL_DATA_MATH_AUDIT_PROMPT.md item 7): clones the
// ORIGINAL imported workbook object (kept in APP.rawWorkbook by
// parseWorkbookSheets()) and patches only the Remark cell of each row in
// each known test sheet, in place, rather than rebuilding a new workbook
// from plain arrays. This preserves formulas, sheet order, cell
// formatting/styles, validation rules, comments, hidden sheets, defined
// names, column widths, filters, and every unrelated (non-test) sheet
// exactly as imported — none of that survives an aoa_to_sheet() rebuild.
// SETUP and STUDENTS are left completely untouched, not regenerated.
// This is NOT a byte-for-byte copy (SheetJS still re-serializes the
// .xlsx container on write), but every worksheet's content/structure is
// preserved; only the specific Remark cells this app owns are modified.
function downloadUpdatedSheet(){
  if(!APP.rawData||!APP.students.length){toast(srT("toast_no_data_loaded"),"warn");return;}
  if(!APP.rawWorkbook){
    toast(srT("toast_workbook_not_found_reimport"),"error");
    return;
  }
  let wb;
  try{
    wb=structuredClone(APP.rawWorkbook);
  }catch(err){
    toast(srT("toast_workbook_copy_failed"),"error");
    return;
  }

  const studentMap={};
  APP.students.forEach(st=>{ studentMap[String(st.id).trim().toUpperCase()]=st; });

  const patchedSheets=[],skippedSheets=[];
  (APP.setup.tests||[]).forEach(t=>{
    // Resolve to the worksheet's actual key (trim + case-fold), same
    // canonical lookup parseStudents()/validateData() use — see item 5.
    const resolvedKey=typeof resolveSheetName==="function"?resolveSheetName(APP.rawData,t.name):t.name;
    const ws=resolvedKey?wb.Sheets[resolvedKey]:undefined;
    if(!ws){skippedSheets.push(t.name);return;}
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});
    if(!rows.length){skippedSheets.push(t.name);return;}
    const header=rows[0].map(h=>h==null?"":String(h).trim());
    const idIdx=header.indexOf("Student ID");
    const rmIdx=header.indexOf("Remark");
    if(idIdx===-1||rmIdx===-1){skippedSheets.push(t.name);return;}
    for(let r=1;r<rows.length;r++){
      const row=rows[r];if(!row)continue;
      const id=String(row[idIdx]||"").trim().toUpperCase();
      if(!id)continue;
      const st=studentMap[id];
      if(!st)continue;
      const newVal=(st.testData[t.name]&&st.testData[t.name].remark)||"";
      const addr=XLSX.utils.encode_cell({r,c:rmIdx});
      // Preserve the existing cell's style/format where one exists —
      // only the value (and its type) is replaced. Drop any cached
      // formatted-text ('w') so readers recompute it from the new value.
      const existing=ws[addr];
      const patched=existing?Object.assign({},existing,{t:"s",v:newVal}):{t:"s",v:newVal};
      delete patched.w;
      ws[addr]=patched;
    }
    patchedSheets.push(t.name);
  });

  const ts=new Date();
  const tag=ts.getFullYear()+String(ts.getMonth()+1).padStart(2,"0")+String(ts.getDate()).padStart(2,"0")
            +"_"+String(ts.getHours()).padStart(2,"0")+String(ts.getMinutes()).padStart(2,"0");
  const fname=(APP.setup.instName||"sheet")+"_remarks_"+tag+".xlsx";
  XLSX.writeFile(wb,fname);
  if(skippedSheets.length){
    toast(`Downloaded — the original workbook was preserved unchanged, but remarks couldn't be updated in: ${skippedSheets.map(esc).join(", ")} (tab not found, or missing a Student ID/Remark column).`,"warn");
  } else {
    toast(srT("toast_updated_sheet_downloaded",{fname:fname}),"success");
  }
  APP._remarksDirty=false;
  $("#remarks-dirty-banner").remove();
}
function showSampleFiles(){
  // v4.1 (bug #1/#2 fix): shares the same rule as Setup/About/FAQ in
  // goStep() now — open from anywhere except Dashboard/Export. See
  // updateNavHomeOnlyState() for the matching visual/tooltip state.
  // BUG FIX (3-scenario spec): extended to the Scholarship screen too,
  // same as goStep()'s own scholarshipLocked check (state-nav.js) —
  // gated on the scheme actually being enabled so this doesn't block the
  // brief moment scholarship-nav.js's enableScholarshipAndOpenGrid() is
  // routing an as-yet-unconfigured scheme into Setup.
  // BUG FIX (universal nav lock): now backed by the single isNavLockedForSetupTabs()
  // (state-nav.js) instead of its own copy of the dashboard/export/
  // scholarshipLocked check — that copy was missing the "ai" (Run
  // Analysis actively computing) case, so Sample Files stayed clickable
  // mid-run even though Setup/About/FAQ were already blocked there.
  // BUG FIX: dropped the "locked" toast here too (see state-nav.js goStep()
  // same-date fix) — the Sample Files nav item is already visually disabled
  // via updateNavHomeOnlyState() with its own tooltip; silent no-op instead.
  if(isNavLockedForSetupTabs()){return;}
  const base=(window.APP_CONFIG&&window.APP_CONFIG.assetBase!==undefined)?window.APP_CONFIG.assetBase:"https://studin.in/";
  const files=[
    {name:"Sample 1 — Management: Class 7 Section A.xlsx",file:"Sample_01_For_School_Management_Section_A_Class7.xlsx",desc:srT("sample_7_desc"),mode:"Compare"},
    {name:"Sample 2 — Management: Class 7 Section B.xlsx",file:"Sample_02_For_School_Management_Section_B_Class7.xlsx",desc:srT("sample_8_desc"),mode:"Compare"},
    {name:"Sample 3 — Management: Class 7 Section C.xlsx",file:"Sample_03_For_School_Management_Section_C_Class7.xlsx",desc:srT("sample_9_desc"),mode:"Compare"},
    {name:"Sample 4 — PUC / Junior College (II PUC Science).xlsx",file:"Sample_04_For_PUC_Junior_College.xlsx",desc:srT("sample_13_desc"),mode:"Institution"},
    {name:"Sample 5 — Large Scale (100 Students × 10 Tests).xlsx",file:"Sample_05_For_Large_Scale_100_Students.xlsx",desc:srT("sample_10_desc"),mode:"Scale"},
    {name:"Sample 6 — MBBS College Lecturer.xlsx",file:"Sample_06_For_MBBS_College_Lecturer.xlsx",desc:srT("sample_2_desc"),mode:"Institution"},
    {name:"Sample 7 — Engineering College, Semester 1-5 (Continuity).xlsx",file:"Sample_07_For_Engineering_College_Sem1to5_CONTINUITY.xlsx",desc:srT("sample_15_desc"),mode:"Continuity"},
    {name:"Sample 8 — International Masters College.xlsx",file:"Sample_08_For_International_Masters_College.xlsx",desc:srT("sample_3_desc"),mode:"Institution"},
    {name:"Sample 9 — UPSC/IAS Coaching.xlsx",file:"Sample_09_For_UPSC_IAS_Coaching.xlsx",desc:srT("sample_1_desc"),mode:"Institution"},
    {name:"Sample 10 — Parent, One Child (Individual Mode).xlsx",file:"Sample_10_For_Individual_School_Going_Child.xlsx",desc:srT("sample_5_desc"),mode:"Individual"},
    {name:"Sample 11 — School with Scholarship Eligibility Data.xlsx",file:"Sample_11_For_School_Scholarship_Eligibility.xlsx",desc:srT("sample_16_desc"),mode:"Institution"}
  ];
  const badge={Institution:{bg:"#eafaf1",fg:"#1e8a5f"},Individual:{bg:"#e8edfb",fg:"var(--c-primary)"},Compare:{bg:"#fdf1e3",fg:"#b5690a"},Scale:{bg:"#f1ecf9",fg:"#7b5ea7"},Continuity:{bg:"#e6f7f5",fg:"#0f7a6e"}};
  const compareFiles=files.filter(f=>f.mode==="Compare").map(f=>f.file);
  const rows=files.map(f=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid var(--c-border);border-radius:var(--r-sm);margin-bottom:10px"><div><div style="font-weight:700;font-size:13px">${esc(f.name)} <span style="font-weight:600;font-size:11px;padding:1px 7px;border-radius:9px;background:${badge[f.mode].bg};color:${badge[f.mode].fg}">${f.mode==="Compare"?"<svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-14'/></svg> "+esc(srT("badge_compare_set")):esc(srT("val_mode_"+f.mode.toLowerCase()))}</span></div><div style="font-size:11.5px;color:var(--c-text3);margin-top:2px">${esc(f.desc)}</div></div><div style="display:flex;gap:6px;flex-shrink:0"><button type="button" class="btn btn-primary btn-sm" data-action="runSampleFile" data-arg="${f.file}"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-09'/></svg> ${esc(srT("btn_try_now"))}</button><a class="btn btn-secondary btn-sm" href="${base}${f.file}" download title="${esc(srT("title_download_to_device"))}"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-22'/></svg></a></div></div>`).join("");
  const compareFilesArgLiteral="["+compareFiles.map(f=>"'"+f+"'").join(",")+"]";
  const compareCta=`<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px dashed var(--c-primary);border-radius:var(--r-sm);margin:-2px 0 14px;background:var(--c-primary-soft)"><div style="font-size:12.5px;color:var(--c-primary)"><strong>${esc(srT("compare_demo_want_full"))}</strong> ${esc(srT("compare_demo_run_together"))}</div><button type="button" class="btn btn-primary btn-sm" style="flex-shrink:0" data-action="runSampleFileCompareDemo" data-arg="${compareFiles.join(',')}"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-09'/></svg> ${esc(srT("btn_try_all_3"))}</button></div>`;
  $("#modal-content").html(`<h3 style="font-family:var(--font-display);font-size:18px;margin-bottom:4px"><svg class='ic' width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><use href='#icon-04'/></svg> ${esc(srT("modal_sample_files_title"))}</h3><div style="font-size:12px;color:var(--c-text3);margin-bottom:16px">${esc(srT("modal_sample_files_desc"))}</div>${rows}${compareCta}`);
  gsapModalEntrance();
  _sampleFilesModalLockedLang=true;
  setLangLockUI(true);
  _modalLastFocus=document.activeElement;
  setTimeout(()=>{const f=document.querySelector('#modal-overlay.open .modal-close');if(f)f.focus();},0);
}
// "Try Now" — fetches the sample workbook(s) straight from the CDN into
// memory and feeds them through the exact same handleHomeImportFiles()
// pipeline a real drag-and-drop would use (wrapped as real File objects,
// so no upload-path logic needs duplicating), skipping the download-then-
// re-upload round trip entirely. Falls back to pointing at the Download
// button if the fetch itself fails (offline, blocked, etc).
// BUG FIX (moved from onCountryChange in core/state-nav.js): the
// sample-names disclosure used to fire on every plain Country-dropdown
// switch, including for people who never go near Sample Files — pure
// noise for regular use. It now only fires here, the moment someone
// actually tries to run a sample file while a non-India country is
// selected, which is the one point the disclosure is actually relevant.
// Shown once per non-India country selection (APP._sampleNamesAckCountry
// tracks which country was last acknowledged) — re-clicking "Try Now"
// again for the same country selection doesn't re-show it, but switching
// back to India and away again does (see onCountryChange's reset).
function runSampleFile(fileNames){
  if(APP.country && APP.country!==DEFAULT_COUNTRY && APP._sampleNamesAckCountry!==APP.country){
    showSampleNamesNotice(()=>{
      APP._sampleNamesAckCountry=APP.country;
      runSampleFileNow(fileNames);
    });
    return;
  }
  runSampleFileNow(fileNames);
}
async function runSampleFileNow(fileNames){
  closeModal();
  goStep("home");
  const statusEl=document.getElementById("home-import-status");
  statusEl.innerHTML=`<div class="card" style="padding:14px;border-color:var(--c-primary)"><div style="font-size:12.5px">⏳ ${esc(srT("val_fetching_sample_data"))}</div></div>`;
  statusEl.style.display="block";
  scrollToEl(statusEl);
  try{
    const base=(window.APP_CONFIG&&window.APP_CONFIG.assetBase!==undefined)?window.APP_CONFIG.assetBase:"https://studin.in/";
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
      <b style="color:var(--c-warn)">${esc(srT("val_couldnt_load_sample_directly"))}</b>
      <div style="font-size:12.5px;color:var(--c-text2);margin-top:6px">${esc(err.message)} — ${esc(srT("val_try_again_or_use"))} <button type="button" data-action="showSampleFiles" style="background:none;border:none;padding:0;font:inherit;cursor:pointer;color:var(--c-primary);text-decoration:underline">${esc(srT("modal_sample_files_title"))}</button> ${esc(srT("val_and_download_icon_instead"))}</div>
    </div>`;
    statusEl.style.display="block";
  }
}
function closeModal(){
  const box=document.getElementById("modal-box");
  const finish=()=>{
    // Dismissed some other way (Esc, backdrop, X icon) while a confirmModal()
    // promise was pending — treat that as cancel, same as clicking Cancel.
    if(_confirmModalResolve){const r=_confirmModalResolve;_confirmModalResolve=null;r(false);}
    // The scholarship-setup-saved modal (template-upload.js) has no plain
    // "just dismiss" path — closing it any way (this button, the X icon,
    // backdrop click, Esc) should refresh the tool back to Home instead of
    // leaving the admin on the stale Setup screen after the workbook was
    // just regenerated and downloaded.
    if(APP._scholarshipSetupSavedModalOpen){
      APP._scholarshipSetupSavedModalOpen=false;
      location.reload();
      return;
    }
    $("#modal-overlay").removeClass("open");
    if(_modalLastFocus&&_modalLastFocus.focus){try{_modalLastFocus.focus();}catch(e){}}
    _modalLastFocus=null;
    if(_sampleFilesModalLockedLang){
      _sampleFilesModalLockedLang=false;
      // Not a blind unlock — the step underneath (e.g. Setup/Scholarship)
      // may lock language independently of the modal; re-derive from
      // APP.currentStep so closing the modal never wrongly re-enables it.
      refreshLangLockUI();
    }
  };
  // GSAP polish (optional): if the library failed to load — offline,
  // blocked CDN, slow school connection — this silently falls through to
  // the plain CSS-driven open/close that already existed, so the modal
  // never breaks over a purely cosmetic flourish.
  if(box&&typeof gsap!=="undefined"){
    gsap.to(box,{opacity:0,y:8,scale:.98,duration:.15,ease:"power1.in",onComplete:finish});
  }else{
    finish();
  }
}
// Shared modal-open entrance used by every "$('#modal-overlay').addClass('open')"
// call site (there are 4, each building different modal content first) —
// same graceful-degradation rule as closeModal() above: GSAP is a bonus,
// never a requirement.
// P3 #19: accessible replacement for native confirm() — same shared modal
// used everywhere else, so screen readers, focus trap, and themeing all
// come for free. Resolves false if dismissed any other way (Esc, backdrop,
// X icon) via the _confirmModalResolve hook in closeModal() below.
let _confirmModalResolve=null;
function confirmModal(message){
  return new Promise(resolve=>{
    _confirmModalResolve=resolve;
    $("#modal-content").html(`
      <div style="font-size:13px;margin-bottom:16px">${esc(message)}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="btn btn-secondary btn-sm" data-action="resolveConfirmModal" data-arg="false">${esc(srT("btn_cancel"))}</button>
        <button type="button" class="btn btn-primary btn-sm" data-action="resolveConfirmModal" data-arg="true">${esc(srT("btn_continue_anyway"))}</button>
      </div>`);
    gsapModalEntrance();
    setTimeout(()=>{const f=document.querySelector('#modal-overlay.open button');if(f)f.focus();},0);
  });
}
function resolveConfirmModal(val){
  if(_confirmModalResolve){const r=_confirmModalResolve;_confirmModalResolve=null;r(val==="true"||val===true);}
  closeModal();
}
function gsapModalEntrance(){
  $("#modal-overlay").addClass("open");
  const box=document.getElementById("modal-box");
  if(box&&typeof gsap!=="undefined"){
    gsap.fromTo(box,{opacity:0,y:8,scale:.98},{opacity:1,y:0,scale:1,duration:.2,ease:"power2.out"});
  }
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


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { _bucketCharts, _charts, _modalFocusTrap, _modalLastFocus, bucketHeatmapHtml, buildSparkPath, buildStudentDetailHtml, buildStudentHealthScoreHtml, buildStudentKpiBottomGridHtml, buildStudentKpiStripHtml, buildStudentKpiTopGridHtml, buildStudentScoreTableHtml, closeModal, confirmModal, configureChartDefaults, dbTabKeyNav, destroyBucketCharts, destroyCharts, downloadUpdatedSheet, filterStudents, getFilteredStudents, getScopedStudents, gsapModalEntrance, narrativeCard, openStudentModal, populateIndividualSwitcher, remarkCardsHtml, remarkToneBadgeHtml, renderBucketClassCharts, renderBucketStudentTrendChart, renderBucketSubjectDistChart, renderCharts, renderClassInsights, renderDashboard, renderFlagsTable, renderHeatmap, renderKPIs, renderStudentCards, resolveConfirmModal, renderSubjectCorrelation, renderWellbeingPanel, runSampleFile, saveNarrativeField, saveRemarkField, selectIndividualStudent, setFilter, showRemarksDirtyBanner, showSampleFiles, sortStudents, updateExportGate, updateRemarkCharCount };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window._bucketCharts=_bucketCharts;window._charts=_charts;window._modalFocusTrap=_modalFocusTrap;window._modalLastFocus=_modalLastFocus;window.bucketHeatmapHtml=bucketHeatmapHtml;window.buildSparkPath=buildSparkPath;window.buildStudentDetailHtml=buildStudentDetailHtml;window.buildStudentHealthScoreHtml=buildStudentHealthScoreHtml;window.buildStudentKpiBottomGridHtml=buildStudentKpiBottomGridHtml;window.buildStudentKpiStripHtml=buildStudentKpiStripHtml;window.buildStudentKpiTopGridHtml=buildStudentKpiTopGridHtml;window.closeModal=closeModal;window.configureChartDefaults=configureChartDefaults;window.dbTabKeyNav=dbTabKeyNav;window.destroyBucketCharts=destroyBucketCharts;window.destroyCharts=destroyCharts;window.downloadUpdatedSheet=downloadUpdatedSheet;window.filterStudents=filterStudents;window.getFilteredStudents=getFilteredStudents;window.getScopedStudents=getScopedStudents;window.narrativeCard=narrativeCard;window.openStudentModal=openStudentModal;window.populateIndividualSwitcher=populateIndividualSwitcher;window.remarkCardsHtml=remarkCardsHtml;window.remarkToneBadgeHtml=remarkToneBadgeHtml;window.renderBucketClassCharts=renderBucketClassCharts;window.renderBucketStudentTrendChart=renderBucketStudentTrendChart;window.renderBucketSubjectDistChart=renderBucketSubjectDistChart;window.renderCharts=renderCharts;window.renderClassInsights=renderClassInsights;window.renderDashboard=renderDashboard;window.renderFlagsTable=renderFlagsTable;window.renderHeatmap=renderHeatmap;window.renderKPIs=renderKPIs;window.renderStudentCards=renderStudentCards;window.renderSubjectCorrelation=renderSubjectCorrelation;window.renderWellbeingPanel=renderWellbeingPanel;window.runSampleFile=runSampleFile;window.saveNarrativeField=saveNarrativeField;window.saveRemarkField=saveRemarkField;window.selectIndividualStudent=selectIndividualStudent;window.setFilter=setFilter;window.showRemarksDirtyBanner=showRemarksDirtyBanner;window.showSampleFiles=showSampleFiles;window.sortStudents=sortStudents;window.updateExportGate=updateExportGate;window.updateRemarkCharCount=updateRemarkCharCount;}
