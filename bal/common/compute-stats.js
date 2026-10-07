// BAL: validation, parsing, per-student analysis, class stats. runAnalysis() (UI orchestrator) lives in
// ui/common/run-analysis.js; parseStudents() queues notices -> flush with takeParseNotices().



import { computePercentiles, generateStrengthsLetter } from './compute-derived.js';



import { getStudentContinuityContext } from './compute-continuity.js';



import { generateHomePlan, generateParentMessage, generateSchoolPlan, generateTrendFacts, srT } from '../../core/render-i18n.js';



import { APP } from '../../core/app-state.js';




import { AI_FEATURES } from '../../core/shared-constants.js';



import { parseStrictAbsence, parseStrictMark } from './mark-parse.js';



import * as dataAccess from '../../dal/common/data-access.js';
import { port } from '../../core/ports.js';
import { provide } from '../../core/ports.js';
// Upward calls go through ports (see core/ports.js) — keeps the import graph acyclic.
const startCompareMode = port('startCompareMode');
const parseWorkbookSheets = port('parseWorkbookSheets');
const resolveSheetName = port('resolveSheetName');

/* ════════════════════════════════════════════════════════════════════
   COMPUTE-STATS — per-student/per-class analysis, k-means clustering,
   gender/remark-tone breakdowns, percentiles.
   Split out of the former compute-engine.js (review #5, 2013 lines was
   unmaintainable as one file) — pure move, no logic changed. See
   compute-compare.js (multi-file comparison / management grid) and
   compute-continuity.js (N-period continuity) for the other two pieces.
   Load order in index.html is unchanged relative to before: this file
   still loads before compute-compare.js and compute-continuity.js,
   same position the old single file held.
   ════════════════════════════════════════════════════════════════════ */
/* ════ ANALYSIS ════ */
/* ════════════════════════════════════════════════════════════════════
   OLD SINGLE-SHEET SCHEMA — validateData()
   Kept commented out for reference/safety per explicit request. Delete
   once the new multi-tab version below has been confirmed working.
   ════════════════════════════════════════════════════════════════════
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
async function validateData(){
  const w=[];
  const normId=v=>String(v||"").trim().toUpperCase();
  const studentsRows=APP.rawData["STUDENTS"];

  // Sheet-name collisions and invalid configured max marks are always
  // blocking, and are also checked here (not only in validateSetupData(),
  // which only runs on the Home quick-import path) so every route into
  // runAnalysis() — sample files, continuity merges, compare-mode sections —
  // gets the same guarantee. See EXCEL_DATA_MATH_AUDIT_PROMPT.md items 4/5.
  ((APP.rawData&&APP.rawData._sheetCollisions)||[]).forEach(c=>{
    w.push({e:1,m:srT("val_two_tabs_same_name",{a:c.names[0],b:c.names[1]})});
  });
  ((APP.setup&&APP.setup._maxMarkErrors)||[]).forEach(e=>{
    w.push({e:1,m:srT("val_invalid_max_mark",{label:e.label,raw:e.raw,reason:e.reason})});
  });
  const findDupeNames=list=>{const seen=new Set(),dupes=new Set();(list||[]).forEach(v=>{const k=String(v).trim().toLowerCase();if(seen.has(k))dupes.add(v);seen.add(k);});return[...dupes];};
  const dupeSubjects=findDupeNames(APP.setup&&APP.setup.subjects);
  const dupeTests=findDupeNames(((APP.setup&&APP.setup.tests)||[]).map(t=>t.name));
  if(dupeSubjects.length)w.push({e:1,m:srT("val_setup_dupe_subjects",{names:dupeSubjects.join(", ")})});
  if(dupeTests.length)w.push({e:1,m:srT("val_setup_dupe_tests",{names:dupeTests.join(", ")})});

  if(studentsRows===undefined){
    w.push({e:1,m:srT("val_no_students_tab_found")});
    return w; // nothing else is checkable without a roster
  }
  const ids=(studentsRows||[]).map(r=>normId(r["Student ID"])).filter(Boolean);
  const dups=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
  if(dups.length)w.push({e:1,m:srT("val_duplicate_ids_students_tab",{ids:dups.join(", ")})});
  if(!ids.length)w.push({e:1,m:srT("val_no_student_rows_students_tab")});

  // TEMPLATE-AUTHENTICITY CHECK (explicitly requested): every test's name
  // in Setup must exist as an actual tab name in the uploaded workbook —
  // confirms this is genuinely a Student Insight file, and catches a
  // renamed test/tab before it silently produces an empty test.
  // Resolved via the same canonical (trim + case-fold) sheet index that
  // parseStudents() below now uses for the actual lookup, so a tab that
  // validates here is guaranteed to also be found there — see
  // EXCEL_DATA_MATH_AUDIT_PROMPT.md item 5 (this was previously the bug:
  // this check normalized case, but parseStudents() indexed by exact
  // spelling, so a case-only-different tab validated here but then
  // produced empty marks/data-issues in parseStudents()).
  const missingTabs=(APP.setup.tests||[]).filter(t=>!resolveSheetName(APP.rawData,t.name)).map(t=>t.name);
  if(missingTabs.length)w.push({e:1,m:srT("val_no_tab_matching_test",{names:missingTabs.join('", "')})});

  // Gender is required by the template design (M/F) but only feeds the
  // optional gender-analysis feature — a warning, not a hard block.
  const noGender=(studentsRows||[]).filter(r=>normId(r["Student ID"])&&!String(r["Gender"]||"").trim()).length;
  if(noGender)w.push({e:0,m:srT("val_students_no_gender",{n:noGender})});

  // Orphan rows — marks entered for a Student ID that isn't on the
  // roster. parseStudents() already records the per-row detail; this is
  // the aggregate warning shown before analysis even runs, whenever
  // possible (parseStudents() itself hasn't necessarily run yet the first
  // time validateData() is called, so this re-derives the count directly).
  const rosterIds=new Set(ids);
  let orphanCount=0;
  (APP.setup.tests||[]).forEach(t=>{
    const resolvedKey=resolveSheetName(APP.rawData,t.name);
    const sheet=resolvedKey?APP.rawData[resolvedKey]:undefined;
    if(!sheet)return;
    sheet.forEach(row=>{
      const id=normId(row["Student ID"]);
      if(id&&!rosterIds.has(id))orphanCount++;
    });
  });
  if(orphanCount)w.push({e:0,m:srT("val_orphan_rows_across_tabs",{n:orphanCount})});

  return w;
}

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

/* ════════════════════════════════════════════════════════════════════
   OLD SINGLE-SHEET SCHEMA — parseStudents()
   Kept commented out for reference/safety per explicit request. Delete
   once the new multi-tab version below has been confirmed working.
   ════════════════════════════════════════════════════════════════════
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
        message:srT("val_name_truncated",{len:nm.length,max:NAME_MAX})});
      nm=nm.slice(0,NAME_MAX);
    }
    // Full Name is optional by design — falls back to the ID everywhere
    // `.name` is displayed (dashboard, PDFs, remarks, Smart Search…) since
    // they all already read this one field.
    studentData[key]={id:rawId,name:nm||rawId,hasName:!!nm,
      gender:String(row["Gender"]||"").trim(),
      // Phase 1 scholarship fields (studin-scholarship-discussion.md §24) —
      // all optional/nullable, same blank-to-"" convention as Gender above.
      // Missing column (old-format sheet) and present-but-blank cell both
      // resolve here identically, since row[h] is only ever set when the
      // header existed in parseWorkbookSheets().
      category:String(row["Category"]||"").trim(),
      annualFamilyIncome:String(row["Annual Family Income"]||"").trim(),
      guardianOccupation:String(row["Guardian Occupation"]||"").trim(),
      priorScholarshipStatus:String(row["Prior Scholarship Status"]||"").trim(),
      persistentStudentId:String(row["Persistent Student ID"]||"").trim(),
      specialCategoryFlag:String(row["Special Category Flag"]||"").trim(),
      testData:{}};
    rosterOrder.push(key);
    tests.forEach(t=>{studentData[key].testData[t.name]={marks:{},absents:0,remark:"",chapter:"",chapters:{}};});
  });

  function getRawVal(row,short){
    const keys=[short+" Marks",short];
    for(const k of keys){
      const v=row[k];
      if(v!==undefined&&v!==null&&v!=="")return v;
    }
    return null;
  }


  // ── MARKS — one sheet per test, joined back to the roster by Student ID ──
  let orphanCount=0;
  tests.forEach(t=>{
    // Resolve to the worksheet's actual key (trim + case-fold) instead of
    // indexing APP.rawData with the exact SETUP label — see item 5. Without
    // this, a tab that validateData() accepted case-insensitively could
    // still report "missing" here and produce empty marks.
    const resolvedKey=resolveSheetName(APP.rawData,t.name);
    const sheet=resolvedKey?APP.rawData[resolvedKey]:undefined;
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
        const studentLabel=studentData[key].name;
        // Strict parse (item 2): a malformed value is REJECTED, never
        // reinterpreted into a different number. No mark is stored for
        // invalid input — export stays blocked via the data issue below.
        const parsed=parseStrictMark(raw);
        if(parsed.status==="invalid"){
          APP.dataIssues.push({studentId:rawId,studentName:studentLabel,test:t.name,subject:s,
            message:`entered "${raw}" — ${parsed.reason}, mark ignored`});
          return;
        }
        const n=parsed.value;
        if(n<0){
          APP.dataIssues.push({studentId:rawId,studentName:studentLabel,test:t.name,subject:s,
            message:`entered ${n} — negative marks aren't valid, mark ignored`});
          return;
        }
        studentData[key].testData[t.name].marks[s]=n;
      });
      // Strict non-negative-integer parse (item 3): malformed/negative
      // absence counts are rejected with a visible data issue rather than
      // silently becoming 0 or staying negative — either of which would
      // otherwise inflate engagementIndex and could suppress a real
      // absence alert.
      const abRaw=getRawVal(row,"Absent Days");
      if(abRaw!==null&&abRaw!==""){
        const abParsed=parseStrictAbsence(abRaw);
        if(abParsed.status==="invalid"){
          APP.dataIssues.push({studentId:rawId,studentName:studentData[key].name,test:t.name,subject:"",
            message:`Absent Days: entered "${abRaw}" — ${abParsed.reason}, ignored (treated as 0 for now, but export is blocked until corrected)`});
        } else if(abParsed.status==="valid"){
          studentData[key].testData[t.name].absents=abParsed.value;
        }
        // "blank" leaves the default of 0 already set at roster-build time.
      }
      const rm=getRawVal(row,"Remark")||getRawVal(row,"Teacher Remark");
      if(rm!==null&&rm!==""){
        let remarkStr=String(rm);
        const REMARK_MAX=1000;
        if(remarkStr.length>REMARK_MAX){
          APP.dataIssues.push({studentId:rawId,studentName:studentData[key].name,test:t.name,subject:"",
            message:srT("val_remark_truncated",{len:remarkStr.length,max:REMARK_MAX})});
          remarkStr=remarkStr.slice(0,REMARK_MAX);
        }
        studentData[key].testData[t.name].remark=remarkStr;
      }
      // LEGACY (pre-2026-10 workbooks): a single student-wise "Chapter" column. Kept so old files still load;
      // new workbooks use the subject-wise "<Subject> Chapter" columns handled right below.
      const ch=getRawVal(row,"Chapter");
      if(ch!==null&&ch!=="")studentData[key].testData[t.name].chapter=String(ch).trim();
    });
    // SUBJECT-WISE CHAPTERS: a chapter belongs to a SUBJECT on a TEST (the whole class sat the same paper), not to
    // a student. Columns "<Subject> Chapter"; the teacher fills it once (or copies it down). The most frequent
    // non-blank value wins, and it applies to EVERY student of that test (including those absent or with blank marks).
    const _chapSubjects=(t._effSubjects&&t._effSubjects.length)?t._effSubjects:subjects;
    const _chapMap={};
    _chapSubjects.forEach(sj=>{
      const want=(sj+" Chapter").trim().toLowerCase();
      const counts=new Map();
      sheet.forEach(row=>{
        const k=Object.keys(row).find(h=>String(h).trim().toLowerCase()===want);
        if(k===undefined)return;
        const v=row[k]; if(v===undefined||v===null)return;
        const str=String(v).trim(); if(!str)return;
        counts.set(str,(counts.get(str)||0)+1);
      });
      let best=null,bn=0; counts.forEach((n,name)=>{if(n>bn){best=name;bn=n;}});
      if(best)_chapMap[sj]=best;
    });
    t.chapters=_chapMap;
    Object.keys(studentData).forEach(k=>{if(studentData[k].testData[t.name])studentData[k].testData[t.name].chapters=_chapMap;});
  });

  APP.students=rosterOrder.map(k=>studentData[k]);
  // Template-generator bug fix: buildStudentsSheet()/buildTestSheet()
  // (js/template-upload.js) pre-fill 5 reference rows ("SAMPLE-1".."SAMPLE-5",
  // was "STU001".."STU005") so the download isn't a blank, confusing grid.
  // A user who fills in their real marks but never notices/replaces those
  // rows got them silently counted as 5 real students with zero marks
  // everywhere — dragging the class average down and inflating headcount,
  // with no error shown. Auto-drop them here, but ONLY when they're
  // genuinely untouched (reserved ID AND zero marks in every test AND no
  // absents/remark/chapter) — a real student who happens to reuse one of
  // these IDs with actual data entered is never at risk of being dropped,
  // since real marks anywhere on the row disqualifies it from this check.
  const SAMPLE_STUDENT_IDS=new Set(["SAMPLE-1","SAMPLE-2","SAMPLE-3","SAMPLE-4","SAMPLE-5"]);
  let sampleRowsSkipped=0;
  APP.students=APP.students.filter(st=>{
    if(!SAMPLE_STUDENT_IDS.has(normId(st.id)))return true;
    const untouched=Object.values(st.testData).every(td=>
      Object.keys(td.marks).length===0&&!td.absents&&!td.remark&&!td.chapter);   // chapters are class-wide per test+subject, so they never make a row "real"
    if(untouched){sampleRowsSkipped++;return false;}
    return true; // has real data despite the reserved-looking ID — keep it, don't guess
  });
  // BAL must not touch the DOM: record notices as data; the UI caller toasts them
  // via takeParseNotices() right after parseStudents() returns.
  if(sampleRowsSkipped>0)_parseNotices.push({msg:srT("val_sample_rows_skipped",{n:sampleRowsSkipped}),type:"info"});
  if(orphanCount>0)_parseNotices.push({msg:srT("val_orphan_rows_skipped",{n:orphanCount}),type:"warn"});
}
const _parseNotices=[];
function takeParseNotices(){return _parseNotices.splice(0,_parseNotices.length);}

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

// Per-test subject list: a test only covers `t.subjectsIncluded` when the
// Setup UI explicitly recorded it. For tests created before that field
// existed (or imported from a legacy workbook), infer it: a subject counts
// as part of the test only if at least one student actually has a mark for
// it there. A subject blank for every student is treated as "not part of
// this test" rather than as a universal zero (this is the fix for the bug
// where a test missing one subject deflated/inflated overall % by dividing
// against the full global subject list). If inference finds nothing at all
// (e.g. a brand-new test with no marks entered yet), fall back to the full
// subject list so an empty test doesn't zero out its own max marks.
function effectiveTestSubjects(t,subjects){
  if(t.subjectsIncluded&&t.subjectsIncluded.length)return t.subjectsIncluded;
  const inferred=subjects.filter(s=>APP.students.some(st=>{
    const td=st.testData[t.name];const m=td&&td.marks&&td.marks[s];
    return m!==null&&m!==undefined&&m!=="";
  }));
  return inferred.length?inferred:subjects;
}

async function computeAnalysis(){
  const {subjects,tests,passThreshold,absentAlert,dropAlert}=await dataAccess.getSetup();
  // Resolve once per test (not per student) — cheap, and every student
  // shares the same effective subject list for a given test.
  tests.forEach(t=>{t._effSubjects=effectiveTestSubjects(t,subjects);});
  // Not reset here — parseStudents() (which always runs immediately before
  // this) already reset it at the true start of the analysis run, and owns
  // the invalid/negative-mark issues it detects. Resetting again here would
  // silently wipe those out before this loop even runs.
  APP.students.forEach(st=>{
    st.analysis={};const testAvgs=[];const cumAvgByTest=[];let cumMarks=0,cumMax=0;
    tests.forEach((t)=>{
      const td=st.testData[t.name]||{marks:{},absents:0,remark:"",chapter:"",chapters:{}};
      td.remarkTone=classifyRemarkTone(td.remark);
      let total=0,maxTotal=0,scored=0;
      // Only the subjects actually part of THIS test count toward its max
      // marks — a subject this test never included must not be divided
      // into the denominator (that's what silently treated "not tested" as
      // "scored zero" and deflated the overall %).
      t._effSubjects.forEach(s=>{const m=td.marks[s];const mx=(t.maxMarks&&t.maxMarks[s])||100;if(m!==null&&m!==undefined&&m!==""){const _pm=parseStrictMark(m);const mv=_pm.status==="valid"?_pm.value:0;if(mv>mx)APP.dataIssues.push({studentId:st.id,studentName:st.name,test:t.name,subject:s,message:`Entered ${mv}; maximum is ${mx}. The calculation is temporarily capped at ${mx}, and export remains blocked until the source workbook is corrected.`});total+=Math.min(mv,mx);maxTotal+=mx;scored++;}else maxTotal+=mx;});
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
    // Raw totals alongside the % — additive, nothing else reads these yet.
    // Needed by the cross-section ranking table (renderAllStudentsRanking()
    // in compute-compare.js) to show an actual "Score" (marks obtained/max)
    // distinct from the "Avg" percentage column.
    st.analysis.totalMarksScored=cumMarks;
    st.analysis.totalMarksMax=cumMax;
    st.analysis.testAvgs=testAvgs;
    st.analysis.cumAvgByTest=cumAvgByTest;
    const a=st.analysis.overallAvg;
    st.analysis.grade=a>=90?"A+":a>=80?"A":a>=70?"B":a>=60?"C":a>=passThreshold?"D":"F";
    let trend="stable";if(valid.length>=2){const diff=valid[valid.length-1]-valid[0];trend=diff>=5?"improving":diff<=-5?"declining":"stable";}
    st.analysis.trend=trend;
    st.flags=[];
    if(APP.dataIssues.some(di=>di.studentId===st.id))st.flags.push({type:"data-error",label:srT("flag_badge_data_error"),color:"#c0392b"});
    if(a<passThreshold)st.flags.push({type:"at-risk",label:srT("flag_badge_at_risk"),color:"var(--c-danger)"});
    // Distinct from At Risk (which looks at the cumulative overall average
    // and can't fire until several bad tests have already dragged it down).
    // This catches the exact moment a previously-passing student's *latest*
    // test dropped below the pass threshold for the first time — useful even
    // when their overall average is still comfortably above the line.
    if(valid.length>=2&&valid[valid.length-1]<passThreshold&&valid.slice(0,-1).every(v=>v>=passThreshold)){
      st.flags.push({type:"first-below-pass",label:srT("flag_badge_first_below_pass"),color:"#d35400"});
    }
    if(trend==="declining")st.flags.push({type:"declining",label:srT("flag_badge_declining"),color:"var(--c-warn)"});
    if(trend==="improving")st.flags.push({type:"improving",label:srT("flag_badge_improving"),color:"var(--c-success)"});
    if(valid.length>=2)for(let i=1;i<valid.length;i++){if(valid[i]!==null&&valid[i-1]!==null&&(valid[i-1]-valid[i])>=dropAlert){st.flags.push({type:"sharp-drop",label:srT("flag_badge_sharp_drop"),color:"var(--c-danger)"});break;}}
    let totalAbsent=0;tests.forEach(t=>{totalAbsent+=(st.testData[t.name]&&st.testData[t.name].absents)||0;});
    st.analysis.totalAbsent=totalAbsent;
    if(totalAbsent>=absentAlert)st.flags.push({type:"absent",label:srT("flag_badge_high_absence"),color:"var(--c-purple)"});
    if(valid.length>=2){const mean=valid.reduce((a,b)=>a+b,0)/valid.length;const variance=valid.reduce((a,b)=>a+(b-mean)**2,0)/valid.length;if(Math.sqrt(variance)>15)st.flags.push({type:"volatile",label:srT("flag_badge_volatile"),color:"#3bc9db"});}
    // Only give a subject an entry here if the student actually has a real
    // score for it in at least one test — a subject no test ever included
    // (or the student was never marked in) used to default to 0, which the
    // Subject Breakdown chart then rendered as a "0%, needs attention" bar
    // indistinguishable from a genuine zero score. Omitting the key instead
    // lets renderers show "Not yet assessed" rather than a misleading 0%.
    const subjectAvgs={};subjects.forEach(s=>{const vals=tests.map(t=>{const m=(st.testData[t.name]||{}).marks&&st.testData[t.name].marks[s];const mx=(t.maxMarks&&t.maxMarks[s])||100;return m!==null&&m!==undefined&&m!==""?Math.min(100,m/mx*100):null;}).filter(v=>v!==null);if(vals.length)subjectAvgs[s]=Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);});
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
    if(st.analysis.burnoutRisk)st.flags.push({type:"burnout",label:srT("flag_badge_burnout_risk"),color:"#e67e22"});
    // Resilience: recovered after drop
    let recovered=false;for(let i=2;i<valid.length;i++){if(valid[i-1]<valid[i-2]-10&&valid[i]>valid[i-1]+8)recovered=true;}st.analysis.resilient=recovered;
    if(recovered)st.flags.push({type:"resilient",label:srT("flag_badge_resilient"),color:"#27ae60"});
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
    if(valid.length>=3){const r=Math.max(...valid)-Math.min(...valid);st.analysis.plateau=r<=8;if(st.analysis.plateau&&st.analysis.overallAvg<70)st.flags.push({type:"plateau",label:srT("flag_badge_plateau"),color:"#8e44ad"});}
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
    // Only flag a subject as "missing" if some test actually included it —
    // a subject no test ever covered isn't a data gap, it's just not part
    // of this student's assessment plan.
    const everIncludedSubjects=subjects.filter(s=>tests.some(t=>t._effSubjects.includes(s)));
    const filledSubjects=subjects.filter(s=>tests.some(t=>st.testData[t.name]&&st.testData[t.name].marks[s]!=null&&st.testData[t.name].marks[s]!==""));
    st.analysis.missingSubjects=everIncludedSubjects.filter(s=>!filledSubjects.includes(s));
    st.analysis.hasDataGaps=st.analysis.missingSubjects.length>0||(valid.length<tests.length);
    // This was computed but never surfaced anywhere in the UI — a student
    // missing marks for an entire subject had no visible indicator at all.
    if(st.analysis.missingSubjects.length)st.flags.push({type:"data-gap",label:srT("flag_label_missing",{subjects:st.analysis.missingSubjects.join(", ")}),color:"#8e7cc3"});

    // Moved here (was previously called mid-way through flag computation, before
    // burnout/resilient/plateau/data-gap were pushed — those flags were silently
    // invisible to every narrative field below).
    // 2nd arg (prompt-05-institution-rollup-narrative.md): optional longitudinal
    // context from APP.continuity — getStudentContinuityContext() returns null
    // for every file today (nothing populates APP.continuity yet, see PIB §9
    // continuity-schema-not-built-yet), so this is a no-op in production and
    // every generator's legacy single-period output stays byte-for-byte the same.
    const _contCtx=getStudentContinuityContext(st.id);
    st.analysis.parentMessage=generateParentMessage(st,_contCtx);st.analysis.trendFacts=generateTrendFacts(st,_contCtx);st.analysis.homePlan=generateHomePlan(st,_contCtx);st.analysis.schoolPlan=generateSchoolPlan(st,_contCtx);

    // ── EXPLAINABLE WARNINGS ──
    st.analysis.explainedWarnings=st.flags.map(f=>{
      const fn=st.name.split(" ")[0];
      const reasons={
        "at-risk":srT("flag_reason_at_risk",{name:fn,pct:st.analysis.overallAvg,threshold:APP.setup.passThreshold}),
        "first-below-pass":srT("flag_reason_first_below_pass",{name:fn,threshold:APP.setup.passThreshold,pct:valid[valid.length-1]}),
        "sharp-drop":srT("flag_reason_sharp_drop"),
        "declining":srT("flag_reason_declining",{count:valid.length,start:valid[0],end:valid[valid.length-1]}),
        "absent":srT("flag_reason_absent",{days:st.analysis.totalAbsent}),
        "volatile":srT("flag_reason_volatile",{name:fn}),
        "burnout":srT("flag_reason_burnout",{name:fn,start:valid[0],drop:Math.round(valid[0]-valid[valid.length-1])}),
        "plateau":srT("flag_reason_plateau",{range:Math.round(Math.max(...valid)-Math.min(...valid)),count:valid.length}),
        "resilient":srT("flag_reason_resilient",{name:fn}),
        "data-gap":srT("flag_reason_data_gap",{subjects:st.analysis.missingSubjects.join(", "),name:fn}),
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
  await computeExtraInsights();
  computePercentiles();
  await computeClassStats();
  await computePeerOutliers();
  await computeCohortClusters();
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
async function computePeerOutliers(){
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
      const label=dir==="high"?srT("flag_badge_outlier_high"):srT("flag_badge_outlier_low");
      const color=dir==="high"?"#0ca678":"#e8590c";
      const reason=srT("val_outlier_reason",{name:fn,pct:st.analysis.overallAvg,z:st.analysis.zScore,mean:mean,sd:sd,dir:dir==="high"?srT("val_far_ahead"):srT("val_far_below")});
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
async function computeCohortClusters(){
  APP.cohortClusters=null;
  const setup=await dataAccess.getSetup();
  if(setup.mode==="individual")return; // one student — clustering is meaningless
  const students=await dataAccess.getStudents();
  const n=students.length;
  // Bible §5/§8 gate — see block comment above for why.
  if(n<30)return;
  const tests=setup.tests||[];
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
    if(rankIdx===0)label=c.consistency>=70?srT("val_cluster_high_steady"):srT("val_cluster_high_volatile");
    else if(rankIdx===order.length-1)label=c.slope<-1?srT("val_cluster_low_declining"):srT("val_healthband_needs_support");
    else label=c.consistency<60?srT("val_cluster_moderate_inconsistent"):srT("val_cluster_moderate_steady");
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
async function computeExtraInsights(){
  const {subjects,tests}=await dataAccess.getSetup();
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

async function computeClassStats(){
  const {subjects,passThreshold}=await dataAccess.getSetup();
  const students=await dataAccess.getStudents();
  const avgs=students.map(st=>st.analysis.overallAvg).filter(v=>!isNaN(v)).sort((a,b)=>a-b);
  if(!avgs.length){APP.classStats={};return APP.classStats;}
  const n=avgs.length;
  // Standard deviation must be computed from the unrounded mean — rounding
  // the mean first (then using that rounded value as the deviation origin)
  // is mathematically wrong, even though it happens not to move the
  // displayed SD for the audit sample. Only the final displayed mean/SD
  // are rounded, deviations themselves are not.
  const rawMean=avgs.reduce((a,b)=>a+b,0)/n;
  const mean=Math.round(rawMean);
  const median=n%2===0?(avgs[n/2-1]+avgs[n/2])/2:avgs[Math.floor(n/2)];
  const q1=avgs[Math.floor(n*0.25)];const q3=avgs[Math.floor(n*0.75)];
  const sd=Math.round(Math.sqrt(avgs.reduce((a,b)=>a+(b-rawMean)**2,0)/n));
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
  if(["m","male","boy","b","men"].includes(s))return "Male";
  if(["f","female","girl","g","women"].includes(s))return "Female";
  return null; // blank / "Other" / non-binary / typos — excluded from the
               // binary comparison rather than guessed at
}
async function computeGenderAnalysis(){
  APP.genderAnalysis=null;
  if(!APP.aiFeatures.has("diversity_analysis"))return null;
  const MIN_GENDER_GROUP=3;
  const {subjects,passThreshold}=await dataAccess.getSetup();
  const groups={Male:[],Female:[]};
  let unrecognizedCount=0;
  APP.students.forEach(st=>{
    const g=normGender(st.gender);
    if(g)groups[g].push(st);
    else if(String(st.gender||"").trim())unrecognizedCount++; // non-blank but didn't normalize — a typo/garbage value, not just "left blank"
  });
  const eligible=Object.entries(groups).filter(([,arr])=>arr.length>=MIN_GENDER_GROUP);
  if(eligible.length<2){
    APP.genderAnalysis={available:false,
      reason:!Object.values(groups).some(a=>a.length)?srT("val_no_gender_column"):
        srT("val_not_enough_gendered_students",{n:MIN_GENDER_GROUP}),
      unrecognizedCount};
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
  const result={available:true,groups:stats,unrecognizedCount};
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


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { takeParseNotices, REMARK_CONCERN_WORDS, REMARK_POSITIVE_WORDS, _kmEuclidSq, _kmPlusPlusInit, _kmRun, _kmSingleRun, classifyRemarkTone, computeAnalysis, computeClassStats, computeCohortClusters, computeExtraInsights, computeGenderAnalysis, computePeerOutliers, effectiveTestSubjects, normGender, parseStudents, validateData };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window.takeParseNotices=takeParseNotices;window.REMARK_CONCERN_WORDS=REMARK_CONCERN_WORDS;window.REMARK_POSITIVE_WORDS=REMARK_POSITIVE_WORDS;window._kmEuclidSq=_kmEuclidSq;window._kmPlusPlusInit=_kmPlusPlusInit;window._kmRun=_kmRun;window._kmSingleRun=_kmSingleRun;window.classifyRemarkTone=classifyRemarkTone;window.computeAnalysis=computeAnalysis;window.computeClassStats=computeClassStats;window.computeCohortClusters=computeCohortClusters;window.computeExtraInsights=computeExtraInsights;window.computeGenderAnalysis=computeGenderAnalysis;window.computePeerOutliers=computePeerOutliers;window.effectiveTestSubjects=effectiveTestSubjects;window.normGender=normGender;window.parseStudents=parseStudents;window.validateData=validateData;}

// Ports other modules call into (see core/ports.js).
provide({ computeAnalysis, computeExtraInsights });
