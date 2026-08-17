import { esc } from './app-utils-init.js';
import { deriveContinuityTerminology, deriveRosterStatus, matchSubjectsAcrossPeriods } from './compute-continuity.js';
import { buildDashboardControlsHtml, openBucket } from './render-buckets.js';
import { configureChartDefaults } from './render-core.js';
import { srT } from './render-i18n.js';
import { APP } from './state-nav.js';

/* ════════════════════════════════════════════════════════════════════
   CONTINUITY — Cohort Dashboard UI (prompt-03-cohort-dashboard-ui.md)
              + Student Trajectory/Forecast (prompt-04-student-
                trajectory-forecast.md)
   ════════════════════════════════════════════════════════════════════
   Ports continuity-dashboard-prototype.jsx's structure/interactions
   (period strip / roster panel / cohort view / student trajectory +
   trend projection) into this app's real stack — vanilla JS +
   jQuery-ish $() + Chart.js + css/vs-shell.css tokens — instead of
   React/recharts, per the app's actual architecture.

   PROMPT-04 DESIGN CHOICE, flagged per that prompt's own instruction:
   the prototype defaults "Show projection" ON; this build defaults it
   OFF (opt-in). The prompt explicitly allows either and just asks it be
   flagged — off-by-default felt like the more conservative choice for
   a trend line whose whole point is "not a guarantee." See PIB §12.

   PROMPT-04 RULE NOT SPELLED OUT VERBATIM IN THE PROMPT, inferred from
   its own test cases (S011 gets no projection past their last present
   period; S012, whose last present period IS the dataset's last period,
   does): projection only renders when the student's LAST PRESENT PERIOD
   IS THE DATASET'S LAST PERIOD — i.e. they're presently enrolled and
   we're extrapolating into genuinely unknown future, never into a
   period we already know they were absent from. A leaver whose last
   present period is earlier never gets one, regardless of history
   length.

   DATA IT EXPECTS — APP.continuity, shape:
     {
       periods: [{label, year}, ...],       // ordered, index = periodIdx
       subjectsByPeriod: [[subjectName,...], ...],  // one array per period
       students: [{id, name, pctByPeriod:[pct|null, ...]}, ...]
     }
   THIS SHAPE IS NOT PRODUCED BY ANYTHING YET. Prompt 01/02's actual
   SETUP/STUDENTS/MARKS N-period parsing was intentionally not built —
   see PIB §9 continuity-schema-not-built-yet / nperiod-fork-not-built-
   yet. buildDashboardControlsHtml() only adds the "continuity" bucket
   when APP.setup.periodCount>1, which nothing currently sets, so in
   real usage this bucket is correctly gated OFF right now — the code
   is written against the shape the real parser will eventually
   produce, not against a fake trigger.

   For screenshot/manual-testing purposes only (ship gate needs a demo
   against real interactions, and there's no real file to load yet),
   previewContinuityDashboard('school'|'engineering') below points
   APP.continuity at fixture data ported verbatim from the prototype's
   embedded DATASETS and force-opens the bucket. This is a dev/console
   affordance, not part of the shipped user flow — it does not change
   what gates the rail item for real users.
   ════════════════════════════════════════════════════════════════════ */

/* ---- fixture data, ported verbatim from continuity-dashboard-prototype.jsx's DATASETS ---- */
const CONTINUITY_FIXTURES = {
  school: {
    periods: [
      {label:"Class 4", year:"2022-23"}, {label:"Class 5", year:"2023-24"},
      {label:"Class 6", year:"2024-25"}, {label:"Class 7", year:"2025-26"}
    ],
    subjectsByPeriod: [
      ["Mathematics","EVS","English","Kannada"],
      ["Mathematics","EVS","English","Kannada","Hindi"],
      ["Mathematics","Science","Social Science","English","Kannada","Hindi"],
      ["Mathematics","Science","Social Science","English","Kannada","Hindi","Computer Science"]
    ],
    students: [
      {id:"S001",name:"Aarav Kulkarni",pctByPeriod:[58,64,70,78]},
      {id:"S002",name:"Diya Reddy",pctByPeriod:[82,84,83,86]},
      {id:"S003",name:"Vihaan Nair",pctByPeriod:[70,62,55,48]},
      {id:"S004",name:"Ananya Joshi",pctByPeriod:[60,61,59,62]},
      {id:"S005",name:"Ishaan Rao",pctByPeriod:[45,50,58,66]},
      {id:"S006",name:"Saanvi Pillai",pctByPeriod:[75,78,60,58]},
      {id:"S007",name:"Arjun Menon",pctByPeriod:[55,53,56,54]},
      {id:"S008",name:"Myra Desai",pctByPeriod:[88,90,91,93]},
      {id:"S009",name:"Kabir Shetty",pctByPeriod:[40,38,35,33]},
      {id:"S010",name:"Anika Bhat",pctByPeriod:[65,70,68,74]},
      {id:"S011",name:"Reyansh Gowda",pctByPeriod:[72,68,null,null]},
      {id:"S012",name:"Kiara Fernandes",pctByPeriod:[null,null,62,68]}
    ]
  },
  engineering: {
    periods: [
      {label:"Semester 1", year:"2023-24 Odd"}, {label:"Semester 2", year:"2023-24 Even"},
      {label:"Semester 3", year:"2024-25 Odd"}, {label:"Semester 4", year:"2024-25 Even"}
    ],
    subjectsByPeriod: [
      ["Engineering Mathematics 1","Engineering Physics","Basic Electrical Engg","Programming for Problem Solving"],
      ["Engineering Mathematics 2","Engineering Chemistry","Basic Electronics","Engineering Graphics"],
      ["Data Structures","Digital Logic Design","Computer Organization","Discrete Mathematics"],
      ["Database Management Systems","Operating Systems","Design & Analysis of Algorithms","Object Oriented Programming"]
    ],
    students: [
      {id:"E001",name:"Rohan Patil",pctByPeriod:[72,74,76,79]},
      {id:"E002",name:"Sneha Kulkarni",pctByPeriod:[85,86,84,87]},
      {id:"E003",name:"Aditya Verma",pctByPeriod:[66,58,50,44]},
      {id:"E004",name:"Pooja Iyer",pctByPeriod:[60,62,61,63]},
      {id:"E005",name:"Karthik Reddy",pctByPeriod:[48,55,60,68]},
      {id:"E006",name:"Neha Gowda",pctByPeriod:[80,76,62,55]},
      {id:"E007",name:"Siddharth Rao",pctByPeriod:[58,56,59,57]},
      {id:"E008",name:"Trisha Menon",pctByPeriod:[90,91,92,94]},
      {id:"E009",name:"Varun Shetty",pctByPeriod:[42,39,34,29]},
      {id:"E010",name:"Meera Bhatt",pctByPeriod:[63,68,65,71]},
      {id:"E011",name:"Aman Chauhan",pctByPeriod:[55,48,null,null]},
      {id:"E012",name:"Ritika Shah",pctByPeriod:[null,null,58,64]}
    ]
  }
};

// Dev/console-only, NOT wired to any button — see file header.
function previewContinuityDashboard(datasetKey){
  const fx=CONTINUITY_FIXTURES[datasetKey||"school"];
  if(!fx){console.error("No such continuity fixture:",datasetKey);return;}
  APP.continuity=fx;
  APP._continuityActivePeriodIdx=fx.periods.length-1;
  APP._continuitySelectedId=null;
  openBucket("continuity");
}
window.previewContinuityDashboard=previewContinuityDashboard;

/* ---- helpers over APP.continuity ---- */
function continuityPeriodsPresence(){
  const c=APP.continuity;
  if(!c)return [];
  return c.periods.map((_,i)=>new Set(c.students.filter(s=>s.pctByPeriod[i]!=null).map(s=>s.id)));
}

// "last known %" and trend arrow are period-invariant — computed off each
// student's own history up to their last present value, same as the
// prototype's roster panel (not tied to the active period strip
// selection; only the status badge below is).
function continuityLastKnown(student){
  for(let i=student.pctByPeriod.length-1;i>=0;i--){if(student.pctByPeriod[i]!=null)return student.pctByPeriod[i];}
  return null;
}
function continuityTrend(student){
  const present=student.pctByPeriod.map((v,i)=>({i,v})).filter(d=>d.v!=null);
  if(present.length<2)return "flat";
  const delta=present[present.length-1].v-present[present.length-2].v;
  if(delta>=4)return "up";
  if(delta<=-4)return "down";
  return "flat";
}
const CONTINUITY_TREND_GLYPH={up:"▲",down:"▼",flat:"▬"};
// prompt-05-institution-rollup-narrative.md: "Left" reads as the
// institution-appropriate word (school "Left" vs college "Detained")
// via deriveContinuityTerminology (compute-engine.js) — never hardcoded
// either way. continuityTerms() falls back to the neutral "generic" set
// if compute-engine.js's function isn't loaded for some reason, so this
// file never hard-crashes on a missing dependency.
function continuityTerms(){
  const c=APP.continuity;
  if(c&&typeof deriveContinuityTerminology==="function")return deriveContinuityTerminology(c.periods,c.institutionType);
  return {unitLabel:"Period",altUnitLabel:"Period",lossTerm:"roster change",lossTermVerb:"left",shortLossWord:"Left"};
}
function continuityBadgeLabels(){
  const terms=continuityTerms();
  return {continuing:"Continuing",joined:"Joined",left:terms.shortLossWord,not_present:"—"};
}
const CONTINUITY_BADGE_CLASS={continuing:"continuity-badge-continuing",joined:"continuity-badge-joined",left:"continuity-badge-left",not_present:"continuity-badge-none"};

function renderContinuityBucket(){
  const c=APP.continuity;
  if(!c||!c.periods||!c.periods.length){
    $("#bucket-answer-screen").html("<div style='color:var(--c-text3);padding:16px'>No multi-period data loaded.</div>");
    return;
  }
  if(APP._continuityActivePeriodIdx==null)APP._continuityActivePeriodIdx=c.periods.length-1;
  const html=`
    <div class="continuity-view">
      <div class="continuity-period-strip" id="continuity-period-strip"></div>
      <div class="continuity-body">
        <div class="continuity-roster-col">
          <div class="continuity-panel-title">Roster (${c.students.length})</div>
          <div class="continuity-roster-list" id="continuity-roster-list"></div>
        </div>
        <div class="continuity-cohort-col">
          <div id="continuity-cohort-view">
            <div class="continuity-card">
              <div class="continuity-panel-title">Cohort average % across periods</div>
              <canvas id="continuity-cohort-chart" height="160"></canvas>
            </div>
            <div class="continuity-card">
              <div class="continuity-panel-title" id="continuity-diff-title">${esc(srT("continuity_roster_change"))}</div>
              <div class="continuity-diff-stats" id="continuity-diff-stats"></div>
            </div>
            <div class="continuity-card">
              <div class="continuity-panel-title" id="continuity-subjects-title">Subjects</div>
              <div id="continuity-subject-chips"></div>
            </div>
          </div>
          <div id="continuity-detail-view" style="display:none"></div>
        </div>
      </div>
    </div>`;
  $("#bucket-answer-screen").html(html);
  renderContinuityPeriodStrip();
  renderContinuityPanels();
}

function renderContinuityPeriodStrip(){
  const c=APP.continuity,currentIdx=c.periods.length-1,active=APP._continuityActivePeriodIdx;
  const chips=c.periods.map((p,i)=>{
    const isCurrent=i===currentIdx,isActive=i===active;
    return `<button type="button" class="continuity-period-chip${isCurrent?" continuity-period-current":""}${isActive?" continuity-period-active":""}"
      data-action="selectContinuityPeriod" data-arg="${i}">
      <span class="continuity-period-label">${esc(p.label)}</span>
      <span class="continuity-period-year">${esc(p.year||"")}</span>
      ${isCurrent?'<span class="continuity-period-current-tag">Current</span>':""}
    </button>`;
  }).join("");
  $("#continuity-period-strip").html(chips);
}

function selectContinuityPeriod(idx){
  APP._continuityActivePeriodIdx=idx;
  renderContinuityPeriodStrip();
  renderContinuityPanels();
}
window.selectContinuityPeriod=selectContinuityPeriod;

// Toggle: clicking the already-selected row deselects, same as the prototype.
function selectContinuityStudent(id){
  APP._continuitySelectedId=(APP._continuitySelectedId===id)?null:id;
  renderContinuityPanels(); // also repaints the roster list's active-row highlight
}
window.selectContinuityStudent=selectContinuityStudent;

function toggleContinuityProjection(checked){
  APP._continuityShowProjection=!!checked;
  const c=APP.continuity,student=c&&c.students.find(s=>s.id===APP._continuitySelectedId);
  if(student)renderContinuityStudentDetail(student);
}
window.toggleContinuityProjection=toggleContinuityProjection;

/* ---- Prompt 04: student trajectory + trend projection ---- */
function renderContinuityStudentDetail(student){
  const c=APP.continuity,activeIdx=APP._continuityActivePeriodIdx;
  if(APP._continuityShowProjection==null)APP._continuityShowProjection=false; // opt-in default OFF — see file-header note on this choice
  const showProjection=APP._continuityShowProjection;
  const status=deriveRosterStatus(student.id,c.periods.length-1,continuityPeriodsPresence());

  const present=student.pctByPeriod.map((v,i)=>({i,v})).filter(d=>d.v!=null);
  const lastPresentIdx=present.length?present[present.length-1].i:-1;
  // Projection only when the student's last present period IS the
  // dataset's last period — see file-header note for why (never project
  // into a period we already know they were absent from).
  const canProject=showProjection&&present.length>=2&&lastPresentIdx===c.periods.length-1;
  const lowConfidence=canProject&&present.length===2;

  const chartLabels=c.periods.map(p=>p.label);
  const chartData=student.pctByPeriod.slice(); // gaps stay null -> Chart.js skips them, doesn't zero-fill
  let projData=c.periods.map(()=>null);
  if(canProject){
    const a=present[present.length-2].v,b=present[present.length-1].v;
    const next=Math.max(0,Math.min(100,b+(b-a)));
    chartLabels.push("Projected");
    chartData.push(null);
    projData.push(next);
    projData[lastPresentIdx]=chartData[lastPresentIdx]; // connect the dashed segment to the real last point
  }

  const html=`
    <div class="continuity-card">
      <div class="continuity-detail-head">
        <div>
          <div class="continuity-detail-name">${esc(student.name)}</div>
          <div class="continuity-roster-sub">
            <span class="continuity-roster-id">${esc(student.id)}</span>
            <span class="continuity-badge ${CONTINUITY_BADGE_CLASS[status]}">${continuityBadgeLabels()[status]}</span>
          </div>
        </div>
        <label class="continuity-projection-toggle">
          <input type="checkbox" ${showProjection?"checked":""} onchange="toggleContinuityProjection(this.checked)"/>
          Show projection
        </label>
      </div>
      <canvas id="continuity-student-chart" height="180"></canvas>
      ${showProjection?`<div class="continuity-disclaimer${lowConfidence?" continuity-disclaimer-low":""}">
        <span>Dashed = trend-based estimate off this student's own history — not a guarantee.</span>
        ${!canProject&&present.length<2?`<span class="continuity-disclaimer-note">${esc(srT("continuity_needs_2_periods"))}</span>`:""}
        ${!canProject&&present.length>=2&&lastPresentIdx!==c.periods.length-1?"<span class=\"continuity-disclaimer-note\">No projection past this student's last present period.</span>":""}
        ${lowConfidence?`<span class="continuity-lowconf-badge">${esc(srT("continuity_low_confidence"))}</span>`:""}
      </div>`:""}
    </div>
    <div class="continuity-card">
      <div class="continuity-panel-title">Subjects trending for ${esc(student.name)} — ${esc(c.periods[activeIdx].label)}</div>
      <div id="continuity-student-subject-chips"></div>
    </div>`;
  $("#continuity-detail-view").html(html);

  if(_continuityStudentChart)_continuityStudentChart.destroy();
  const canvas=$("#continuity-student-chart")[0];
  if(canvas){
    const {primaryColor}=configureChartDefaults();
    const cs=getComputedStyle(document.documentElement);
    const purple=cs.getPropertyValue("--c-purple").trim()||"#7b5ea7";
    const datasets=[{label:"Overall %",data:chartData,borderColor:primaryColor,backgroundColor:"rgba(43,58,103,.1)",tension:.3,fill:false,spanGaps:false}];
    if(canProject)datasets.push({label:"Projected",data:projData,borderColor:purple,borderDash:[5,4],backgroundColor:"transparent",tension:0,fill:false,spanGaps:true});
    _continuityStudentChart=new Chart(canvas,{type:"line",data:{labels:chartLabels,datasets},
      options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100}}}});
  }

  // --- subject chips: cohort-period-level data (matchSubjectsAcrossPeriods
  // for the ACTIVE period), reused as-is per the prompt — not recomputed
  // per-student. "Trend available" = name carried from prior period,
  // "No trend yet" = new subject this period, no prior data to trend from. ---
  const prevIdx=activeIdx-1;
  const prevSubjects=prevIdx>=0?c.subjectsByPeriod[prevIdx]:[];
  const diff=matchSubjectsAcrossPeriods(prevSubjects,c.subjectsByPeriod[activeIdx]);
  const chipRow=(label,chips,cls)=>chips.length?
    `<div class="continuity-chip-row"><div class="continuity-chip-row-label">${esc(label)}</div>
     <div class="continuity-chips">${chips.map(x=>`<span class="continuity-chip ${cls}">${esc(x)}</span>`).join("")}</div></div>`:"";
  const chipsHtml=chipRow(srT("continuity_trend_available"),diff.carried,"continuity-chip-carried")
    +chipRow("No trend yet (new subject)",diff.added,"continuity-chip-added");
  // Ship-gate item 5 (engineering's near-total turnover should degrade
  // gracefully, not break layout): when a period has no carried subjects
  // at all (diff.carried empty) there's nothing to show a trend for —
  // show an explicit empty state instead of a blank card.
  $("#continuity-student-subject-chips").html(chipsHtml||
    "<div class='continuity-empty-state'>No subjects carried a name over from the prior period — no trend to show yet.</div>");
}
let _continuityStudentChart=null;

function renderContinuityPanels(){
  const c=APP.continuity,activeIdx=APP._continuityActivePeriodIdx;
  const periodsPresence=continuityPeriodsPresence();

  // --- roster list: badge is period-relative (deriveRosterStatus at
  // activeIdx) per this prompt's own test spec ("click Class 6 -> roster
  // panel updates"); last-%/trend stay period-invariant, same as the
  // reference prototype. ---
  const selectedId=APP._continuitySelectedId;
  const rosterHtml=c.students.map(s=>{
    const status=deriveRosterStatus(s.id,activeIdx,periodsPresence);
    const lastVal=continuityLastKnown(s);
    const dir=continuityTrend(s);
    const activeCls=s.id===selectedId?" continuity-roster-row-active":"";
    return `<div class="continuity-roster-row${activeCls}" role="button" tabindex="0"
        data-action="selectContinuityStudent" data-arg="${esc(s.id)}"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectContinuityStudent('${esc(s.id)}');}">
      <div>
        <div class="continuity-roster-name">${esc(s.name)}</div>
        <div class="continuity-roster-sub">
          <span class="continuity-badge ${CONTINUITY_BADGE_CLASS[status]}">${continuityBadgeLabels()[status]}</span>
          <span class="continuity-roster-id">${esc(s.id)}</span>
        </div>
      </div>
      <div class="continuity-roster-trend">
        <span>${lastVal!=null?lastVal+"%":"—"}</span>
        <span class="continuity-trend-${dir}">${CONTINUITY_TREND_GLYPH[dir]}</span>
      </div>
    </div>`;
  }).join("");
  $("#continuity-roster-list").html(rosterHtml);

  // --- Prompt 04: a selected student swaps the right column from the
  // cohort view to their trajectory/forecast detail view. ---
  if(selectedId){
    $("#continuity-cohort-view").hide();
    $("#continuity-detail-view").show();
    const student=c.students.find(s=>s.id===selectedId);
    if(student)renderContinuityStudentDetail(student);
    return;
  }
  $("#continuity-cohort-view").show();
  $("#continuity-detail-view").hide();

  // --- cohort average line chart: average only over students present
  // that period, never zero-filled. ---
  const cohortAvg=c.periods.map((_,i)=>{
    const vals=c.students.map(s=>s.pctByPeriod[i]).filter(v=>v!=null);
    return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
  });
  if(_continuityChart)_continuityChart.destroy();
  const canvas=$("#continuity-cohort-chart")[0];
  if(canvas){
    const {primaryColor}=configureChartDefaults();
    _continuityChart=new Chart(canvas,{type:"line",data:{labels:c.periods.map(p=>p.label),
      datasets:[{label:srT("continuity_cohort_avg_pct"),data:cohortAvg,borderColor:primaryColor,backgroundColor:"rgba(43,58,103,.1)",tension:.3,fill:true,spanGaps:true}]},
      options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100}}}});
  }

  // --- roster-diff stat row for the active transition (prevIdx -> activeIdx) ---
  const prevIdx=activeIdx-1;
  $("#continuity-diff-title").text(prevIdx>=0
    ? srT("continuity_roster_change_from_to",{from:c.periods[prevIdx].label,to:c.periods[activeIdx].label})
    : srT("continuity_roster_change_first"));
  if(prevIdx>=0){
    let joined=0,left=0,continuing=0;
    c.students.forEach(s=>{
      const st=deriveRosterStatus(s.id,activeIdx,periodsPresence);
      if(st==="continuing")continuing++;else if(st==="joined")joined++;else if(st==="left")left++;
    });
    $("#continuity-diff-stats").html(
      `<div class="continuity-stat"><div class="continuity-stat-num">${continuing}</div><div class="continuity-stat-label">Continuing</div></div>`+
      `<div class="continuity-stat"><div class="continuity-stat-num" style="color:var(--c-success)">${joined}</div><div class="continuity-stat-label">Joined</div></div>`+
      `<div class="continuity-stat"><div class="continuity-stat-num" style="color:var(--c-danger)">${left}</div><div class="continuity-stat-label">${continuityBadgeLabels().left}</div></div>`
    );
  } else {
    $("#continuity-diff-stats").html("<div style='color:var(--c-text3);font-size:12.5px'>No prior period to compare against.</div>");
  }

  // --- subject chips for the active transition, via matchSubjectsAcrossPeriods ---
  $("#continuity-subjects-title").text(srT("continuity_subjects_in",{period:c.periods[activeIdx].label}));
  const prevSubjects=prevIdx>=0?c.subjectsByPeriod[prevIdx]:[];
  const curSubjects=c.subjectsByPeriod[activeIdx];
  const diff=matchSubjectsAcrossPeriods(prevSubjects,curSubjects);
  const chipRow=(label,chips,cls)=>chips.length?
    `<div class="continuity-chip-row"><div class="continuity-chip-row-label">${esc(label)}</div>
     <div class="continuity-chips">${chips.map(c=>`<span class="continuity-chip ${cls}">${esc(c)}</span>`).join("")}</div></div>`:"";
  $("#continuity-subject-chips").html(
    chipRow(srT("continuity_carried_over"),diff.carried,"continuity-chip-carried")+
    chipRow(srT("continuity_new_this_period"),diff.added,"continuity-chip-added")+
    chipRow(srT("continuity_discontinued"),diff.dropped,"continuity-chip-dropped")
  );
}
let _continuityChart=null;


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { CONTINUITY_BADGE_CLASS, CONTINUITY_FIXTURES, CONTINUITY_TREND_GLYPH, _continuityChart, _continuityStudentChart, continuityBadgeLabels, continuityLastKnown, continuityPeriodsPresence, continuityTerms, continuityTrend, previewContinuityDashboard, renderContinuityBucket, renderContinuityPanels, renderContinuityPeriodStrip, renderContinuityStudentDetail, selectContinuityPeriod, selectContinuityStudent, toggleContinuityProjection };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window.CONTINUITY_BADGE_CLASS=CONTINUITY_BADGE_CLASS;window.CONTINUITY_FIXTURES=CONTINUITY_FIXTURES;window.CONTINUITY_TREND_GLYPH=CONTINUITY_TREND_GLYPH;window._continuityChart=_continuityChart;window._continuityStudentChart=_continuityStudentChart;window.continuityBadgeLabels=continuityBadgeLabels;window.continuityLastKnown=continuityLastKnown;window.continuityPeriodsPresence=continuityPeriodsPresence;window.continuityTerms=continuityTerms;window.continuityTrend=continuityTrend;window.previewContinuityDashboard=previewContinuityDashboard;window.renderContinuityBucket=renderContinuityBucket;window.renderContinuityPanels=renderContinuityPanels;window.renderContinuityPeriodStrip=renderContinuityPeriodStrip;window.renderContinuityStudentDetail=renderContinuityStudentDetail;window.selectContinuityPeriod=selectContinuityPeriod;window.selectContinuityStudent=selectContinuityStudent;window.toggleContinuityProjection=toggleContinuityProjection;}
