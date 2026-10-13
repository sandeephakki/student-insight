/* 
   COMPUTE-COMPARE (BAL) — pure multi-file comparison logic: schema matching,
   management grid, weak-subject / flagged-section rollups, ranking. No DOM, no
   toast, no UI imports. The UI half (file list, pickers, renderers, exports)
   lives in ui/compare/compare-ui.js (split 2026-10-03; planner.md layer rule).
*/
import { srT } from '../../core/render-i18n.js';
import { APP } from '../../core/app-state.js';
import { computePercentiles, generateStrengthsLetter } from '../common/compute-derived.js';

function safeFileName(n){return String(n||"").replace(/[^\w\s-]/g,"").replace(/\s+/g,"_");}

/* ── Upload handlers ── */
// v3.0 rev2: triggerCompareFileUpload()/handleCompareFileSelect()/
// handleCompareFileDrop() removed — targeted #compare-drop-zone/
// #compare-file-input, both deleted with the old Upload Data panel.
// processCompareFile() itself is kept — Home's own multi-file drop calls
// it directly (see handleHomeImportFiles).
// Shared by fingerprintRawData()/addCompareSection() (Compare mode) and the
// single-file Home upload path alike — one place that knows how to find the
// MARKS+CONTEXT sheet regardless of minor naming variants.
// BUG FIX (v3.8): current templates split marks across one sheet PER TEST
// ("Prelims Mock 1", "Unit Test 1", etc.) with the roster in its own
// STUDENTS sheet — there is no single "MARKS+CONTEXT" sheet in any current
// sample/template. Looking for a sheet name containing "MARK" therefore
// always came back empty, showing "0 rows detected" on every real upload
// (cosmetic on the Home single-file card, but also made Compare Mode wrongly
// flag every valid file with "No student rows found"). STUDENTS is the
// reliable roster regardless of how the per-test sheets are named; the old
// MARKS+CONTEXT lookup is kept as a fallback for any legacy single-sheet file.
function resolveMarksRows(rawData){
  if(rawData["STUDENTS"]&&rawData["STUDENTS"].length)return rawData["STUDENTS"];
  const markKey=Object.keys(rawData).find(k=>k.includes("MARK")&&k.includes("CONTEXT"))||Object.keys(rawData).find(k=>k.includes("MARK"))||"";
  return rawData["MARKS+CONTEXT"]||rawData["MARKS_CONTEXT"]||rawData[markKey]||[];
}

// Structural template check ONLY — "does this look like a Student Insight
// file at all" (recognizable Subjects/Tests in its own SETUP tab, and at
// least one student row) — NOT "does it match any other uploaded file".
// Whether two files' schemas match each other is a separate question,
// answered later per-group in computeCompareGroups(); a file failing THIS
// check is unrecoverable (we have no schema to analyse it with at all), but
// a file that passes is always analysed on its own, whether or not any
// other uploaded file shares its subjects/tests.
function validateTemplateStructure(peek,rowCount){
  const errors=[];
  if(!peek.subjects||!peek.subjects.length)errors.push(srT("val_couldnt_detect_subjects_setup"));
  if(!peek.tests||!peek.tests.length)errors.push(srT("val_couldnt_detect_tests_setup"));
  if(!rowCount)errors.push(srT("val_no_student_rows_setup"));
  // Invalid max marks (item 4) and duplicate subject/test names (item 6)
  // are always blocking, same as the single-file import path — a compare
  // section with either of these would corrupt its own per-student totals
  // and the cross-section comparison built on top of them.
  (peek.maxMarkErrors||[]).forEach(e=>{
    errors.push(`Invalid maximum mark for "${e.label}": entered "${e.raw}" — ${e.reason}.`);
  });
  (peek.duplicateErrors||[]).forEach(m=>errors.push(m));
  return errors;
}

// Cheap content fingerprint for a section's marks data — used to catch a
// duplicate upload even when the file was renamed (the filename check in
// processCompareFile only catches an exact name match).
function fingerprintRawData(rawData){
  return JSON.stringify(resolveMarksRows(rawData));
}

// A schema "signature" used purely to silently GROUP sections that share
// the same subjects/tests/max-marks (same class, different section/batch)
// — normalized so upload order and subject/test ORDER don't matter, only
// the actual content does. Two sections landing in the same group is what
// triggers a silent side-by-side comparison; sections with no match in the
// batch just stay standalone (still fully analysed, still in the dropdown).
// Every generated template names its test tabs "<Class><Section>-<Test
// Name>" (applyTabPrefix() in template-upload.js — e.g. "Class7A-Final
// Exam"), so two otherwise-identical sections (same subjects/tests/max
// marks, different section) NEVER had equal t.name strings — the whole
// point of Compare Mode (silently grouping "same class, different
// section" files) could never fire. Strip each file's OWN class+section
// prefix (reconstructed the same way applyTabPrefix built it, from that
// file's own peeked SETUP tab — schema.className/section) before hashing
// test names, so the comparison is on the test's real name, not on which
// section it came from. Falls back to the untouched name if the test
// wasn't actually prefixed (e.g. an older/manually-edited file).
function stripSectionTestPrefix(name,schema){
  const prefix=(String((schema&&schema.className)||"")+String((schema&&schema.section)||"")).replace(/[^a-zA-Z0-9]/g,"").slice(0,18);
  if(prefix&&name.toLowerCase().startsWith(prefix.toLowerCase()+"-"))return name.slice(prefix.length+1);
  return name;
}

function schemaSignature(schema){
  const subjectsLc=(schema.subjects||[]).map(s=>s.trim().toLowerCase()).sort();
  const maxMarksLookup=Object.create(null);
  (schema.subjects||[]).forEach(s=>{maxMarksLookup[s.trim().toLowerCase()]=s;});
  const testsSig=(schema.tests||[]).map(t=>{
    const mm=(schema.subjects||[]).slice().sort((a,b)=>a.trim().toLowerCase().localeCompare(b.trim().toLowerCase()))
      .map(s=>s.trim().toLowerCase()+":"+((t.maxMarks&&t.maxMarks[s])||100)).join(",");
    const bareName=stripSectionTestPrefix(t.name.trim(),schema);
    return bareName.toLowerCase()+"["+mm+"]";
  }).sort();
  return JSON.stringify({subjectsLc,testsSig});
}

// Groups every analysed valid section by matching schema signature. Groups
// of 2+ get a silent comparison computed (computeSectionComparisonFor) —
// this is the "two files match the class but section/batch differ" case.
// Singleton groups (a file that matches nothing else in the batch, e.g. an
// individual aspirant's sheet dropped alongside a school class) are left
// as standalone entries — still fully analysed, just not compared against
// anything, since there's nothing compatible to compare them to.
function computeCompareGroups(){
  const analysed=APP.sections.filter(s=>s.valid&&s.schema&&s.students&&s.students.length);
  const bySig={};
  analysed.forEach(s=>{
    const sig=schemaSignature(s.schema);
    (bySig[sig]=bySig[sig]||{schema:s.schema,sections:[]}).sections.push(s);
  });
  APP.compareGroups=Object.values(bySig).map((g,i)=>({
    id:"grp"+(i+1),
    subjects:g.schema.subjects,
    sections:g.sections,
    comparison:g.sections.length>=2?computeSectionComparisonFor(g.sections,g.schema.subjects):null
  }));
}

/* ── Management View: Class × Section aggregation for a school director ──
   Compare Mode already lets you upload arbitrary "sections" with free-text
   labels (e.g. "Class 7 - C"). Rather than rebuild Setup/Upload to support
   a formal multi-class model, this parses the labels already in use to
   detect a Class × Section structure, and degrades gracefully (falls back
   to the existing flat section-ranking view) whenever it can't confidently
   find one — e.g. a normal single-class comparison of Section A/B/C. */
function parseClassSection(label){
  const s=(label||"").trim();
  // "Class 7 - C", "Class 7 – Section C", "Grade 6 Section B"
  let m=s.match(/^(.*?)[\s\-–—:,]*\bsec(?:tion)?\.?\s*([A-Za-z0-9]+)\s*$/i);
  if(m&&m[1].trim())return{cls:m[1].trim(),sec:m[2].trim().toUpperCase()};
  // "Class 7 - C", "7th Grade-B", "Class 7C" trailing " - X" / "X" token
  m=s.match(/^(.*?)[\s]*[-–—][\s]*([A-Za-z0-9]{1,3})\s*$/);
  if(m&&m[1].trim())return{cls:m[1].trim(),sec:m[2].trim().toUpperCase()};
  // "6A", "10B" — class number directly followed by a section letter
  m=s.match(/^(.*\d)\s*([A-Za-z])$/);
  if(m&&m[1].trim())return{cls:m[1].trim(),sec:m[2].trim().toUpperCase()};
  return {cls:s,sec:""}; // couldn't confidently split — whole label is the "class"
}

function computeManagementGrid(){
  const rows=APP.sectionComparison||[];
  if(!rows.length)return null;
  const parsed=rows.map(r=>({...r,...parseClassSection(r.label)}));
  const classKeys=[...new Set(parsed.map(r=>r.cls))];
  // Only worth showing as a grid if we found more than one class AND at
  // least some rows actually carried a distinct section token — otherwise
  // this is just the normal single-class section comparison, and the
  // existing flat Section Ranking table below is the right view for that.
  const hasSections=parsed.some(r=>r.sec);
  if(classKeys.length<2||!hasSections)return null;
  const sectionKeys=[...new Set(parsed.map(r=>r.sec).filter(Boolean))].sort();
  const classes=classKeys.map(cls=>{
    const secs=parsed.filter(r=>r.cls===cls).sort((a,b)=>a.sec.localeCompare(b.sec));
    const n=secs.reduce((a,r)=>a+r.n,0);
    const avg=n?Math.round(secs.reduce((a,r)=>a+r.avg*r.n,0)/n):0;
    const passRate=n?Math.round(secs.reduce((a,r)=>a+r.passRate*r.n,0)/n):0;
    const atRisk=secs.reduce((a,r)=>a+r.atRisk,0);
    return {cls,secs,n,avg,passRate,atRisk};
  }).sort((a,b)=>b.avg-a.avg);
  const totalStudents=rows.reduce((a,r)=>a+r.n,0);
  const schoolAvg=totalStudents?Math.round(rows.reduce((a,r)=>a+r.avg*r.n,0)/totalStudents):0;
  const schoolPassRate=totalStudents?Math.round(rows.reduce((a,r)=>a+r.passRate*r.n,0)/totalStudents):0;
  const totalAtRisk=rows.reduce((a,r)=>a+r.atRisk,0);
  const subjects=APP.setup.subjects||[];
  const subjSchoolAvg=subjects.map(sub=>{
    const w=rows.reduce((a,r)=>a+(r.subjectAvgs[sub]||0)*r.n,0);
    return {subject:sub,avg:totalStudents?Math.round(w/totalStudents):0};
  }).sort((a,b)=>a.avg-b.avg); // weakest first
  return {classes,sectionKeys,parsed,totalStudents,schoolAvg,schoolPassRate,totalAtRisk,subjSchoolAvg};
}

// Computes ranked comparison rows for an explicit set of (already-matching-
// schema) sections against an explicit subjects list — used per-group by
// computeCompareGroups() rather than reading a single global shared schema,
// since different groups in the same batch can have entirely different
// subjects (e.g. a school class group vs. a UPSC-aspirant group).
function computeSectionComparisonFor(sections,subjects){
  const passThreshold=APP.setup.passThreshold||35;
  const rows=sections.map(sec=>{
    const n=sec.students.length;
    const avg=n?Math.round(sec.students.reduce((a,st)=>a+(st.analysis.overallAvg||0),0)/n):0;
    const passCount=sec.students.filter(st=>(st.analysis.overallAvg||0)>=passThreshold).length;
    const passRate=n?Math.round(passCount/n*100):0;
    const atRisk=sec.students.filter(st=>st.flags&&st.flags.some(f=>f.type==="at-risk")).length;
    const topper=sec.students.slice().sort((a,b)=>(b.analysis.overallAvg||0)-(a.analysis.overallAvg||0))[0];
    const subjectAvgs={};
    (subjects||[]).forEach(sub=>{
      const vals=sec.students.map(st=>st.analysis.subjectAvgs&&st.analysis.subjectAvgs[sub]).filter(v=>v!=null&&!isNaN(v));
      subjectAvgs[sub]=vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):0;
    });
    return {id:sec.id,label:sec.label,n,avg,passRate,atRisk,topperName:topper?topper.name:"—",topperAvg:topper?(topper.analysis.overallAvg||0):0,subjectAvgs};
  }).sort((a,b)=>b.avg-a.avg);
  rows.forEach((r,i)=>r.rank=i+1);
  return rows;
}

// General-purpose, ALWAYS-available versions of the two most useful bits of
// the Management grid — weakest subjects and flagged sections — that don't
// require multi-class detection. computeManagementGrid() still gates the
// actual Class×Section GRID TABLE on 2+ classes (that visualisation only
// makes sense with real classes), but a director comparing sections of a
// SINGLE class needs "which subject is weakest" and "which sections need
// attention" just as much — these used to only appear when the class grid
// did, which was backwards.
function computeWeakSubjects(rows){
  const subjects=APP.setup.subjects||[];
  const totalN=rows.reduce((a,r)=>a+r.n,0);
  if(!totalN)return [];
  return subjects.map(sub=>{
    const w=rows.reduce((a,r)=>a+(r.subjectAvgs[sub]||0)*r.n,0);
    return {subject:sub,avg:Math.round(w/totalN)};
  }).sort((a,b)=>a.avg-b.avg);
}

function computeFlaggedSections(rows){
  return rows.filter(r=>r.avg<(APP.setup.passThreshold||35)||r.atRisk>=Math.max(3,Math.round(r.n*0.2)));
}

// Issue 4 fix: shared helper for "does the CURRENT comparison/group
// contain any section with data-quality issues" — used to gate both the
// comparison PDF export and the UI path that leads to it. Deliberately
// looks at every section actually represented in `rows` (the comparison
// currently on screen), not just APP.dataIssues (which only ever reflects
// whichever single section was analysed/opened last — see the §5-style
// bug this mirrors).
function sectionsWithDataIssues(rows){
  return (rows||[])
    .map(r=>APP.sections.find(s=>s.id===r.id))
    .filter(sec=>sec&&Array.isArray(sec.dataIssues)&&sec.dataIssues.length);
}

// Cross-Section "All Students" ranking — every student across every
// section in this comparison group, pooled into one class-wide ranking.
// This is the answer to "who's the topper of Class 7 overall" — the
// per-section Rank each student already carries (computeAnalysis(),
// compute-stats.js) only ranks them within their OWN section's roster, so
// it can't answer that on its own. classRank here is the high-precedence
// column; sectionRank is carried alongside for context, not instead of it.
function computeAllStudentsRanking(group){
  const flat=[];
  (group.sections||[]).forEach(sec=>{
    (sec.students||[]).forEach(st=>{
      const a=st.analysis||{};
      flat.push({
        name:st.name,
        sectionLabel:sec.label,
        sectionRank:a.rank||null,
        avg:a.overallAvg||0,
        scoreText:a.totalMarksMax?(a.totalMarksScored+"/"+a.totalMarksMax):"—",
        trend:a.trend||"stable"
      });
    });
  });
  flat.sort((x,y)=>y.avg-x.avg);
  // Same standard-competition tie rule as computeAnalysis()'s own rank
  // (tied students share a rank; the next distinct score resumes at its
  // true position, not the next integer) — consistent with every other
  // rank shown elsewhere in the app.
  flat.forEach((r,i)=>{r.classRank=(i>0&&r.avg===flat[i-1].avg)?flat[i-1].classRank:i+1;});
  return flat;
}

export { resolveMarksRows, computeAllStudentsRanking, computeCompareGroups, computeFlaggedSections, computeManagementGrid, computePercentiles, computeSectionComparisonFor, computeWeakSubjects, fingerprintRawData, generateStrengthsLetter, parseClassSection, safeFileName, schemaSignature, sectionsWithDataIssues, stripSectionTestPrefix, validateTemplateStructure };
if(typeof window!=='undefined'){window.resolveMarksRows=resolveMarksRows;window.computeAllStudentsRanking=computeAllStudentsRanking;window.computeCompareGroups=computeCompareGroups;window.computeFlaggedSections=computeFlaggedSections;window.computeManagementGrid=computeManagementGrid;window.computePercentiles=computePercentiles;window.computeSectionComparisonFor=computeSectionComparisonFor;window.computeWeakSubjects=computeWeakSubjects;window.fingerprintRawData=fingerprintRawData;window.generateStrengthsLetter=generateStrengthsLetter;window.parseClassSection=parseClassSection;window.safeFileName=safeFileName;window.schemaSignature=schemaSignature;window.sectionsWithDataIssues=sectionsWithDataIssues;window.stripSectionTestPrefix=stripSectionTestPrefix;window.validateTemplateStructure=validateTemplateStructure;}
