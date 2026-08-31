import { emptyStateHtml, esc } from '../../core/app-utils-init.js';
import { computeCohortClusters } from '../../bal/common/compute-stats.js';
import { BUCKET_HELP_FLAG_TYPES, BUCKET_TOP_FLAG_TYPES, backToBucketList, backToBuckets, bucketIsHelp, bucketIsTop } from './render-buckets.js';
import { buildStudentDetailHtml, renderBucketClassCharts, renderBucketStudentTrendChart, renderBucketSubjectDistChart } from './render-core.js';
import { srT } from '../../core/render-i18n.js';
import { APP } from '../../core/state-nav.js';
import { setLeftRail, setRightRail } from '../../core/vs-shell.js';

/* ════════════════════════════════════════════════════════════════════
   RENDER-FINDINGS — chapter/breadcrumb navigation, individual
   finding detail rows, cluster group drilldown, student/subject
   pickers, class-level answer rendering.
   Split out of the former render-dashboard.js (review #5) — pure move,
   no logic changed.
   ════════════════════════════════════════════════════════════════════ */
const CHAPTER_RELEVANT_FLAG_TYPES=["at-risk","first-below-pass","sharp-drop","declining","burnout","plateau","volatile"];
function flagChapterSuffix(st,flagType){
  if(!CHAPTER_RELEVANT_FLAG_TYPES.includes(flagType))return "";
  const tests=(APP.setup&&APP.setup.tests)||[];
  for(let i=tests.length-1;i>=0;i--){
    const ch=(st.testData[tests[i].name]||{}).chapter;
    if(ch)return srT("flag_chapter_suffix",{chapter:ch});
  }
  return "";
}

// FEEDBACK #7 (UI bugs, item 7): the two separate stacked "← Dashboard" /
// "← Back" buttons looked like two competing back-actions on the same
// screen. Replaced with one single-line breadcrumb: "Dashboard › Back",
// same two destinations, one visual control.
function breadcrumbHtml(){
  return `<div class="bucket-breadcrumb">
    <a href="javascript:void(0)" data-action="backToBuckets">${esc(srT("bucket_back_to_dashboard").replace("← ",""))}</a>
    <span class="crumb-sep">›</span>
    <a href="javascript:void(0)" data-action="backToBucketList">${esc(srT("back").replace("← ",""))}</a>
  </div>`;
}

function bucketFindingReason(kind,st){
  const ew=(st.analysis&&st.analysis.explainedWarnings)||[];
  const types=kind==="help"?BUCKET_HELP_FLAG_TYPES:BUCKET_TOP_FLAG_TYPES;
  const hit=ew.find(f=>types.includes(f.type));
  if(hit)return hit.reason+flagChapterSuffix(st,hit.type);
  const first=(st.name||"").split(" ")[0]||st.name;
  if(kind==="help"){
    if(st.analysis&&st.analysis.wellbeingFlag&&st.analysis.wellbeingFlag!=="low")return srT("finding_wellbeing_checkin",{name:first,level:srT("val_level_"+st.analysis.wellbeingFlag)});
    if(st.analysis&&st.analysis.rankMovement<0)return srT("finding_rank_slipped",{name:first});
  }else{
    if(st.analysis&&st.analysis.rank<=3)return srT("finding_top_rank",{student:st.name,rank:st.analysis.rank});
    if(st.analysis&&st.analysis.competitiveReadiness==="High")return srT("finding_competitive_readiness",{name:first,pct:st.analysis.overallAvg});
    if(st.analysis&&st.analysis.rankMovement>0)return srT("finding_rank_moved_up",{name:first});
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
  if(kind==="top"&&a.rank<=3)reasons.push(srT("finding_ranked_num",{rank:a.rank}));
  if(kind==="top"&&a.competitiveReadiness==="High")reasons.push(srT("finding_competitive_high"));
  if(kind==="help"&&a.wellbeingFlag&&a.wellbeingFlag!=="low")reasons.push(srT("finding_wellbeing_check",{level:srT("val_level_"+a.wellbeingFlag)}));
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
        `<button class="bucket-back-btn" style="padding:6px 0;min-height:auto" data-action="openFinding" data-arg="help" data-arg2="${esc(studentId)}">Open full profile →</button>`;
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
              <span>${esc(srT("val_avg_colon"))} ${esc(String(a.overallAvg))}%</span>
              ${bestSubjectEntry?`<span>${esc(srT("val_top_subject_colon"))} ${esc(bestSubjectEntry[0])}</span>`:""}
              <span>${esc(srT("kpi_trend"))}: ${esc(trendLabel[a.trend]||a.trend||"-")}</span>
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
  const rows=items.map(x=>`<div class="bucket-picker-row" data-action="openFinding" data-arg="help" data-arg2="${esc(x.st.id)}">${esc(x.st.name)}</div>`).join("");
  const railHtml=`
    <div style="display:flex;gap:8px;align-items:center">
      <input type="text" class="bucket-picker-input" placeholder="Search by name…" autocomplete="off" id="bucket-help-input" style="flex:1">
      <button type="button" data-action="clearPickerInput" data-arg="bucket-help-input" data-arg2="bucket-help-results" aria-label="Clear" title="Clear" style="flex-shrink:0;width:36px;height:36px;border:1px solid var(--c-border);border-radius:var(--r-sm);background:var(--c-surface);color:var(--c-text2);cursor:pointer;font-size:16px;line-height:1">×</button>
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
  if(kind==="top"&&a.rank<=3)reasons.push(srT("finding_ranked_num",{rank:a.rank}));
  if(kind==="top"&&a.competitiveReadiness==="High")reasons.push(srT("finding_competitive_high"));
  if(kind==="help"&&a.wellbeingFlag&&a.wellbeingFlag!=="low")reasons.push(srT("finding_wellbeing_check",{level:srT("val_level_"+a.wellbeingFlag)}));
  const body=(reasons.length?reasons:[srT("bucket_all_good")]).map(r=>`<p>${esc(r)}</p>`).join("");
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">${esc(st.name)}</div>
    <div class="bucket-answer-sub">${esc(srT("finding_summary_line",{avg:String(a.overallAvg),rank:String(a.rank),trend:a.trend?srT("val_trend_"+a.trend):"-"}))}</div>
    <div class="bucket-answer-body">${body}</div>
    <div class="chart-container" style="margin-top:14px"><div class="card-title">${esc(srT("finding_progress_trend_title"))}</div><canvas id="bucket-chart-finding-trend"></canvas></div>
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
      <summary class="shell-panel-title shell-panel-title-summary" style="cursor:pointer"><b>${esc(g.label)}</b> — ${g.students.length} student${g.students.length===1?"":"s"} · ${c.overallAvg}% avg · ${c.consistency} consistency</summary>
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
  const rows=students.map(st=>`<div class="bucket-picker-row" data-action="onBucketStudentPick" data-arg="${esc(st.name)}">${esc(st.name)}</div>`).join("");
  const railHtml=`
    <div class="bucket-picker-hint">${esc(srT("student_picker_prompt"))}</div>
    <div style="display:flex;gap:8px;align-items:center">
      <input type="text" class="bucket-picker-input" placeholder="Search by name…" autocomplete="off" id="bucket-student-input" style="flex:1">
      <button type="button" data-action="clearPickerInput" data-arg="bucket-student-input" data-arg2="bucket-student-results" aria-label="Clear" title="Clear" style="flex-shrink:0;width:36px;height:36px;border:1px solid var(--c-border);border-radius:var(--r-sm);background:var(--c-surface);color:var(--c-text2);cursor:pointer;font-size:16px;line-height:1">×</button>
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
  // buildStudentDetailHtml only emits the Progress Trend canvas when the
  // student has 2+ tests (see hasTrend there) — mirror Individual mode's
  // renderIndividualReportAnswer by only initializing the chart when that
  // canvas actually exists.
  if($("#bucket-chart-student-trend").length) renderBucketStudentTrendChart("bucket-chart-student-trend",st);
}

function renderSubjectPicker(){
  const subjects=(APP.setup&&APP.setup.subjects)||[];
  const rows=subjects.map(s=>`<div class="bucket-picker-row" data-action="onBucketSubjectPick" data-arg="${esc(s)}">${esc(s)}</div>`).join("");
  const railHtml=`
    <div class="bucket-picker-hint">${esc(srT("subject_picker_prompt"))}</div>
    <div style="display:flex;gap:8px;align-items:center">
      <input type="text" class="bucket-picker-input" placeholder="Search by subject…" autocomplete="off" id="bucket-subject-input" style="flex:1">
      <button type="button" data-action="clearPickerInput" data-arg="bucket-subject-input" data-arg2="bucket-subject-results" aria-label="Clear" title="Clear" style="flex-shrink:0;width:36px;height:36px;border:1px solid var(--c-border);border-radius:var(--r-sm);background:var(--c-surface);color:var(--c-text2);cursor:pointer;font-size:16px;line-height:1">×</button>
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
  const summary=sw?`<p>${esc(srT("bucket_class_avg_in_subject",{subject:subject,avg:String(sw.avgClass),pct:String(sw.pctBelow)}))}</p>`:`<p>${esc(srT("val_no_data_yet_for",{subject:subject}))}</p>`;
  const rows=students.map(st=>({name:st.name,avg:(st.analysis&&st.analysis.subjectAvgs&&st.analysis.subjectAvgs[subject])||0})).sort((a,b)=>a.avg-b.avg);
  const rowsHtml=rows.map(r=>`<div class="subject-row"><span>${esc(r.name)}</span><span>${esc(String(r.avg))}%</span></div>`).join("");
  $("#bucket-answer-screen").html(`
    <div class="bucket-answer-title">${esc(subject)}</div>
    <div class="bucket-answer-body">${summary}
      <div class="chart-container" style="margin-top:14px"><div class="card-title">${esc(srT("bucket_subject_distribution",{subject:subject}))}</div><canvas id="bucket-chart-subjectdist"></canvas></div>
      <div class="subject-row-list" style="margin-top:14px">${rowsHtml}</div>
    </div>
  `);
  renderBucketSubjectDistChart("bucket-chart-subjectdist",rows);
}

function renderClassAnswer(){
  if(typeof setRightRail==="function") setRightRail(""); // item 7a: no properties for this control
  const cs=APP.classStats||{};
  const parts=[];
  if(cs.mean!==undefined&&cs.mean!==null)parts.push(`<p>${esc(srT("bucket_class_avg_median_range",{mean:String(cs.mean),median:String(cs.median),min:String(cs.min),max:String(cs.max)}))}</p>`);
  if(cs.subjectWeakness&&cs.subjectWeakness.length){
    const worst=cs.subjectWeakness[0];
    parts.push(`<p>${esc(srT("bucket_weakest_subject_classwide",{subject:worst.subject,avg:String(worst.avgClass),pct:String(worst.pctBelow)}))}</p>`);
  }
  if(cs.attendanceCorrelation){
    const ac=cs.attendanceCorrelation;
    parts.push(`<p>${esc(srT("bucket_attendance_correlation",{a:String(ac.noAbsence.avg),b:String(ac.someAbsence.avg)}))}</p>`);
  }
  if(APP.genderAnalysis){
    parts.push(`<p>${esc(srT("bucket_gender_comparison_available"))}</p>`);
    if(APP.genderAnalysis.unrecognizedCount>0){
      parts.push(`<p>${esc(srT("bucket_gender_unrecognized_count",{n:APP.genderAnalysis.unrecognizedCount}))}</p>`);
    }
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


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { CHAPTER_RELEVANT_FLAG_TYPES, _helpOpenId, breadcrumbHtml, bucketFindingReason, collectFindingReasons, filterPickerList, flagChapterSuffix, onBucketStudentPick, onBucketSubjectPick, openClusterGroup, openFinding, renderClassAnswer, renderClusterGroups, renderFilteredList, renderStudentPicker, renderSubjectPicker, toggleHelpRow };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window.CHAPTER_RELEVANT_FLAG_TYPES=CHAPTER_RELEVANT_FLAG_TYPES;window._helpOpenId=_helpOpenId;window.breadcrumbHtml=breadcrumbHtml;window.bucketFindingReason=bucketFindingReason;window.collectFindingReasons=collectFindingReasons;window.filterPickerList=filterPickerList;window.flagChapterSuffix=flagChapterSuffix;window.onBucketStudentPick=onBucketStudentPick;window.onBucketSubjectPick=onBucketSubjectPick;window.openClusterGroup=openClusterGroup;window.openFinding=openFinding;window.renderClassAnswer=renderClassAnswer;window.renderClusterGroups=renderClusterGroups;window.renderFilteredList=renderFilteredList;window.renderStudentPicker=renderStudentPicker;window.renderSubjectPicker=renderSubjectPicker;window.toggleHelpRow=toggleHelpRow;}
