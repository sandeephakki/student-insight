import { APP } from '../../core/state-nav.js';
import { autoInferSetup } from '../../core/template-upload.js';

/* ════════════════════════════════════════════════════════════════════
   COMPUTE-CONTINUITY — N-period roster status, subject-continuity
   diffing, longitudinal trend, institution terminology, cohort
   attrition rollup. Backs js/continuity-dashboard.js.
   Split out of the former compute-engine.js (review #5) — pure move,
   no logic changed.
   ════════════════════════════════════════════════════════════════════ */
function deriveRosterStatus(studentId,periodIdx,periodsPresence){
  if(!Array.isArray(periodsPresence)||periodIdx==null||periodIdx<0||periodIdx>=periodsPresence.length)return "not_present";
  const presentIn=(i)=>{const set=periodsPresence[i];return !!(set&&typeof set.has==="function"&&set.has(studentId));};
  if(presentIn(periodIdx)){
    for(let i=0;i<periodIdx;i++){if(presentIn(i))return "continuing";}
    return periodIdx===0?"continuing":"joined"; // period 0 is the baseline — nothing earlier to have "joined" relative to
  }
  for(let i=0;i<periodIdx;i++){if(presentIn(i))return "left";} // seen before, absent now
  return "not_present"; // never seen up to/including this period — not yet enrolled in this slice, or absent throughout
}

// matchSubjectsAcrossPeriods(periodASubjects, periodBSubjects)
//   Exact subject-name string match only (no fuzzy matching, no manual
//   mapping UI — explicitly out of scope for this phase per the
//   prompt). Returns {carried, added, dropped}, each an array preserving
//   the order of the source list it came from.
function matchSubjectsAcrossPeriods(periodASubjects,periodBSubjects){
  const a=Array.isArray(periodASubjects)?periodASubjects:[];
  const b=Array.isArray(periodBSubjects)?periodBSubjects:[];
  const bSet=new Set(b),aSet=new Set(a);
  return {
    carried:a.filter(s=>bSet.has(s)),
    added:b.filter(s=>!aSet.has(s)),
    dropped:a.filter(s=>!bSet.has(s))
  };
}

// checkDuplicateStudentIds(students)
//   Roster join-key uniqueness check for the (not-yet-built) STUDENTS
//   tab — Student ID must be unique across the shared roster, hard error
//   on duplicate per spec. Pure helper so the actual parse step (when
//   built) just calls this rather than re-implementing the scan.
//   `students`: array of {id,...} — matches the shape STUDENTS-tab rows
//   are expected to parse into. Returns array of duplicate IDs (empty =
//   no duplicates).
function checkDuplicateStudentIds(students){
  const seen=new Set(),dupes=new Set();
  (Array.isArray(students)?students:[]).forEach(s=>{
    const id=s&&s.id!=null?String(s.id).trim():"";
    if(!id)return;
    if(seen.has(id))dupes.add(id);else seen.add(id);
  });
  return [...dupes];
}

/* ---- N-PERIOD GENERALIZATION (prompt-02-nperiod-import-fork.md) ----
   deriveRosterStatus/matchSubjectsAcrossPeriods above already work for
   any N (deriveRosterStatus takes periodIdx+full periodsPresence array;
   matchSubjectsAcrossPeriods just diffs two arrays) — nothing to change
   there. Two additions below: the full-timeline variant, and the
   current-vs-historical period split rule. Still pure, still no UI
   wiring, still no SETUP/STUDENTS/MARKS N-period parsing underneath —
   see PIB §9 continuity-schema-not-built-yet. */

// deriveRosterTimeline(studentId, periodsPresence)
//   ordered array of "present"|"absent", one entry per period (0..N-1),
//   purely from periodsPresence (same shape as deriveRosterStatus takes).
function deriveRosterTimeline(studentId,periodsPresence){
  return (Array.isArray(periodsPresence)?periodsPresence:[])
    .map(set=>(set&&typeof set.has==="function"&&set.has(studentId))?"present":"absent");
}

// splitPeriodsForAnalysis(periodCount)
//   "Current period" = last period in file, always, no override this
//   phase. Only the current period gets full detailed analysis; earlier
//   periods get overall-% + rank only (caller's job to actually compute
//   that lighter view — this just returns which index is which).
function splitPeriodsForAnalysis(periodCount){
  const n=Number.isInteger(periodCount)&&periodCount>0?periodCount:0;
  if(!n)return {currentIdx:-1,historicalIdxs:[]};
  const historicalIdxs=[];
  for(let i=0;i<n-1;i++)historicalIdxs.push(i);
  return {currentIdx:n-1,historicalIdxs};
}

/* ---- INSTITUTION ROLLUP + NARRATIVE + TERMINOLOGY (prompt-05-institution-
   rollup-narrative.md) ---- */

// deriveContinuityTerminology(periods, institutionTypeField)
//   institutionTypeField: the explicit "Institution Type" SETUP field, if
//   present (e.g. "School"/"College") — takes priority over inference.
//   Falls back to inferring from Period Label pattern ("Class N" vs
//   "Semester N"/"Sem N"). Neither present/matching -> neutral fallback
//   labels, so ambiguous data never gets silently forced into one
//   institution's vocabulary. Pure, no APP.* reads.
const CONTINUITY_TERMINOLOGY_SETS={
  school:{unitLabel:"Class",altUnitLabel:"Grade",lossTerm:"attrition",lossTermVerb:"dropped out",shortLossWord:"Left"},
  college:{unitLabel:"Semester",altUnitLabel:"Term",lossTerm:"backlog",lossTermVerb:"got detained",shortLossWord:"Detained"},
  generic:{unitLabel:"Period",altUnitLabel:"Period",lossTerm:"roster change",lossTermVerb:"left",shortLossWord:"Left"}
};
function deriveContinuityTerminology(periods,institutionTypeField){
  // Matches against #inst-type's REAL dropdown values (index.html) — e.g.
  // "Primary School", "High School", "College / University", "Coaching
  // Centre" — not bare "school"/"college", which never appear in an
  // actual APP.setup.instType (kv["Type"] in autoInferSetup(),
  // template-upload.js). Substring match on "school"/"college"/
  // "university" catches every real school/college option including
  // "Pre-primary / Playschool"; "Coaching Centre"/"Corporate Training"/
  // "Other" fall through to label inference or the neutral fallback,
  // since neither has an obvious class/semester vocabulary of its own.
  const t=(institutionTypeField||"").trim().toLowerCase();
  if(t.includes("school"))return CONTINUITY_TERMINOLOGY_SETS.school;
  if(t.includes("college")||t.includes("university"))return CONTINUITY_TERMINOLOGY_SETS.college;
  const labels=(Array.isArray(periods)?periods:[]).map(p=>String((p&&p.label)||""));
  if(labels.some(l=>/^\s*(class|grade)\s*\d/i.test(l)))return CONTINUITY_TERMINOLOGY_SETS.school;
  if(labels.some(l=>/^\s*sem(ester)?\s*\d/i.test(l)))return CONTINUITY_TERMINOLOGY_SETS.college;
  return CONTINUITY_TERMINOLOGY_SETS.generic;
}

// computeLongitudinalTrend(presentValuesChronological)
//   presentValuesChronological: numbers only (already filtered non-null),
//   oldest first. Direction = the most recent step's sign; streakLength =
//   how many consecutive trailing steps agree with that direction (so a
//   flat step, or a reversal, breaks the streak). Returns null when there
//   aren't at least 2 points to compare — callers use that as "no
//   longitudinal narrative to add," never a crash or a fabricated trend.
function computeLongitudinalTrend(presentValuesChronological){
  const v=Array.isArray(presentValuesChronological)?presentValuesChronological:[];
  if(v.length<2)return null;
  const i=v.length-1;
  const dir=v[i]>v[i-1]?"improving":v[i]<v[i-1]?"declining":"flat";
  if(dir==="flat")return {periodCount:v.length,direction:"flat",streakLength:1};
  let streak=1;
  for(let j=i;j>0;j--){
    const d=v[j]-v[j-1];
    const stepDir=d>0?"improving":d<0?"declining":"flat";
    if(stepDir===dir)streak++;else break;
  }
  return {periodCount:v.length,direction:dir,streakLength:streak};
}

// getStudentContinuityContext(studentId)
//   Bridges APP.continuity (the shape js/continuity-dashboard.js already
//   reads — see its file header) into a {periodCount,direction,
//   streakLength,unitLabel} object the narrative generators in
//   render-dashboard.js can optionally take as a second argument. Returns
//   null whenever APP.continuity isn't populated (true for every real
//   file today — see PIB §9 continuity-schema-not-built-yet) or the
//   student has <2 present periods, so every narrative-generator call
//   site that passes this in stays byte-for-byte unchanged for legacy/
//   single-period files without needing its own separate guard.
function getStudentContinuityContext(studentId){
  const c=APP.continuity;
  if(!c||!Array.isArray(c.students))return null;
  const student=c.students.find(s=>s.id===studentId);
  if(!student||!Array.isArray(student.pctByPeriod))return null;
  const present=student.pctByPeriod.filter(v=>v!=null);
  const trend=computeLongitudinalTrend(present);
  if(!trend)return null;
  const terms=deriveContinuityTerminology(c.periods,c.institutionType);
  return Object.assign({unitLabel:terms.unitLabel},trend);
}

// computeCohortAttritionRollup(sections)
//   sections: [{sectionLabel, continuityData}, ...] — continuityData is
//   the SAME shape js/continuity-dashboard.js reads (APP.continuity's
//   {periods, students[{id,pctByPeriod}]}), one such object PER class/
//   section. Note this is a genuinely different, higher-level data shape
//   than anything Prompts 01-04 built: their whole model is a single
//   roster's journey across periods (one class/section over years), with
//   no notion of multiple sections side by side at all. Rolling that up
//   to "per class/section, institution-wide" needs an array of those,
//   which nothing produces — this function exists so the shape is ready
//   whenever something does, same pattern as everywhere else in this
//   arc, but there is currently no real OR fixture caller for it (see
//   PIB §9 institution-rollup-no-multi-section-data-shape).
//   Reuses computeLongitudinalTrend (this file) for the trend direction —
//   the same "average only over students present that period, never
//   zero-filled" rule js/continuity-dashboard.js's cohort chart uses,
//   aggregated up one level. Returns null for an empty/invalid input,
//   never a crash on missing per-section data.
function computeCohortAttritionRollup(sections){
  const list=Array.isArray(sections)?sections:[];
  if(!list.length)return null;
  return list.map(({sectionLabel,continuityData:cd})=>{
    if(!cd||!Array.isArray(cd.periods)||!Array.isArray(cd.students)){
      return {sectionLabel,periods:[],cohortAvgByPeriod:[],netChange:null,trend:null};
    }
    const cohortAvgByPeriod=cd.periods.map((_,i)=>{
      const vals=cd.students.map(s=>(s.pctByPeriod||[])[i]).filter(v=>v!=null);
      return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
    });
    const firstIdx=cd.periods.length-cd.periods.length; // 0, kept explicit for readability
    const lastIdx=cd.periods.length-1;
    const startCount=cd.students.filter(s=>(s.pctByPeriod||[])[firstIdx]!=null).length;
    const endCount=cd.students.filter(s=>(s.pctByPeriod||[])[lastIdx]!=null).length;
    const trend=computeLongitudinalTrend(cohortAvgByPeriod.filter(v=>v!=null));
    return {
      sectionLabel,
      periods:cd.periods.map(p=>p.label),
      cohortAvgByPeriod,
      netChange:endCount-startCount, // lost/gained across the tracked periods, roster-count based
      trend:trend?trend.direction:null
    };
  });
}


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { CONTINUITY_TERMINOLOGY_SETS, checkDuplicateStudentIds, computeCohortAttritionRollup, computeLongitudinalTrend, deriveContinuityTerminology, deriveRosterStatus, deriveRosterTimeline, getStudentContinuityContext, matchSubjectsAcrossPeriods, splitPeriodsForAnalysis };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window.CONTINUITY_TERMINOLOGY_SETS=CONTINUITY_TERMINOLOGY_SETS;window.checkDuplicateStudentIds=checkDuplicateStudentIds;window.computeCohortAttritionRollup=computeCohortAttritionRollup;window.computeLongitudinalTrend=computeLongitudinalTrend;window.deriveContinuityTerminology=deriveContinuityTerminology;window.deriveRosterStatus=deriveRosterStatus;window.deriveRosterTimeline=deriveRosterTimeline;window.getStudentContinuityContext=getStudentContinuityContext;window.matchSubjectsAcrossPeriods=matchSubjectsAcrossPeriods;window.splitPeriodsForAnalysis=splitPeriodsForAnalysis;}
