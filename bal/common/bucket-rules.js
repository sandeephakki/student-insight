import { APP } from '../../core/app-state.js';
import { srT } from '../../core/render-i18n.js';

// (BAL) Pure bucket/flag rules extracted from render-buckets.js and render-findings.js
// (import-cycle fix: render-core/render-findings/vs-shell no longer import each
// other just for these).
const BUCKET_HELP_FLAG_TYPES=["at-risk","first-below-pass","declining","sharp-drop","absent","volatile","burnout","data-gap","plateau","peer-outlier-low"];
const BUCKET_TOP_FLAG_TYPES=["improving","resilient","peer-outlier-high"];
const CHAPTER_RELEVANT_FLAG_TYPES=["at-risk","first-below-pass","sharp-drop","declining","burnout","plateau","volatile"];

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

// Flags are student-level (not tied to a subject), and chapters are SUBJECT-wise. So the chapter named in a flag
// is the one of the student's WEAKEST subject (lowest % on the most recent test that logged chapters).
// Legacy single-"Chapter" workbooks (td.chapter, no subject) still work: that value is used as-is.
function weakestSubjectChapter(st,tests){
  tests=tests||(APP.setup&&APP.setup.tests)||[];
  for(let i=tests.length-1;i>=0;i--){
    const t=tests[i],td=(st.testData||{})[t.name]||{};
    const chs=td.chapters||{};
    const subs=Object.keys(chs).filter(s=>chs[s]);
    if(subs.length){
      let best=null,bestPct=Infinity;
      for(const s of subs){
        const m=(td.marks||{})[s],mx=(t.maxMarks||{})[s];
        if(typeof m==="number"&&isFinite(m)&&mx>0){const pct=m/mx*100;if(pct<bestPct){bestPct=pct;best=s;}}
      }
      if(best)return chs[best];
      if(td.chapter)return td.chapter;            // no usable marks for the chapter-bearing subjects: fall through to legacy value
      continue;
    }
    if(td.chapter)return td.chapter;
  }
  return "";
}
function flagChapterSuffix(st,flagType){
  if(!CHAPTER_RELEVANT_FLAG_TYPES.includes(flagType))return "";
  const ch=weakestSubjectChapter(st);
  return ch?srT("flag_chapter_suffix",{chapter:ch}):"";
}

export { CHAPTER_RELEVANT_FLAG_TYPES, BUCKET_HELP_FLAG_TYPES, BUCKET_TOP_FLAG_TYPES, bucketIsHelp, bucketIsTop, flagChapterSuffix, weakestSubjectChapter };
