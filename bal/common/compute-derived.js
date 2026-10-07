import { APP } from '../../core/app-state.js';

// Moved from bal/compare/compute-compare.js so compute-stats.js no longer
// statically imports the Compare feature (planner.md lazy-load rule).

// Only returns a Strengths note when a genuine strength exists (a subject
// at/above 70%). Previously this fell back to "is working hard to build
// strengths" even when nothing was — that reads as filler to a parent, not
// as a strength, and actually undermines trust in a report that's honest
// everywhere else. Returning null lets the caller omit the section.
function generateStrengthsLetter(st){
  const a=st.analysis,name=st.name.split(" ")[0];
  const topSubjs=Object.entries(a.subjectAvgs||{}).filter(([,v])=>v>=70).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([s])=>s);
  if(!topSubjs.length)return null;
  return `${name} shows genuine strength in ${topSubjs.join(" and ")}${a.overallAvg>=80?" — performing at an excellent level and ready for greater challenges":a.trend==="improving"?" — and the trajectory is very encouraging":""}.${a.resilient?" "+name+" has also shown great resilience, bouncing back after difficult periods.":""}`;
}
// Midrank percentile policy: students sharing an overallAvg score share
// the same percentile, computed from the midpoint of the 0-based rank
// positions their tied group occupies in the ascending sort. This keeps
// equal scores mapped to equal percentiles (unlike plain array-index
// percentiles) while a single-score/single-student class still resolves
// to 100. See EXCEL_DATA_MATH_AUDIT_PROMPT.md item 1.
function computePercentiles(){
  const n=APP.students.length;
  if(!n)return;
  const sorted=[...APP.students].sort((a,b)=>a.analysis.overallAvg-b.analysis.overallAvg);
  let i=0;
  while(i<n){
    let j=i;
    while(j+1<n && sorted[j+1].analysis.overallAvg===sorted[i].analysis.overallAvg)j++;
    // i..j (inclusive, 0-based) are tied; use the midpoint rank position.
    const mid=(i+j)/2;
    const pct=n>1?Math.round((mid/(n-1))*100):100;
    for(let k=i;k<=j;k++)sorted[k].analysis.percentile=pct;
    i=j+1;
  }
}

export { computePercentiles, generateStrengthsLetter };
