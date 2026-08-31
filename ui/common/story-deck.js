import { getStudentContinuityContext } from '../../bal/common/compute-continuity.js';
import { generateHomePlan, generateSchoolPlan, srT } from '../../core/render-i18n.js';
import { APP } from '../../core/state-nav.js';

/* ============================================================
   DISABLED PENDING REVIEW (vs-shell-plan-v2 Task 2) — this file's
   original header below cited a non-existent spec section
   ("Project Bible v2 §8.8"); the story-deck feature itself was never
   actually requested or designed. Its <script> tag in index.html is
   commented out, not removed. Re-enable only after an explicit
   decision, not by default.
   ============================================================

   Student Insight — Story-Deck-Run mode (Project Bible v2 §8.8)
   Classic-mode-only, presentation-layer walkthrough. First entry into
   a bucket this session shows a phase-wise slide deck built from
   fields already in student.analysis / APP.classStats; "Skip to full
   dashboard" is visible on every slide. Once skipped or completed, that
   bucket stays full-view for the rest of the session.

   Per-bucket, in-memory-only flag: APP.bucketSeen[bucketId] = true.
   Resets on reload — NO_PERSISTENCE, not a new schema field.

   This file does not change what any bucket eventually renders — it
   only decides whether to show slides first. The real render function
   for a bucket is always passed in and called either immediately
   (bucket already seen, or user hits Skip) or after the last slide.
============================================================ */

const StoryDeck = (function(){

  if(typeof window !== "undefined" && !window.APP) window.APP = {};
  if(typeof window !== "undefined" && !APP.bucketSeen) APP.bucketSeen = {};

  const STYLE = `
#sdeck-overlay{position:fixed;inset:0;z-index:1300;background:rgba(15,20,45,.55);display:flex;align-items:center;justify-content:center;padding:20px}
#sdeck-card{background:#fff;border-radius:16px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(10,15,40,.35);overflow:hidden;font-family:"SF Pro Text","Inter",system-ui,-apple-system,sans-serif}
#sdeck-progress{display:flex;gap:5px;padding:14px 18px 0}
.sdeck-dot{flex:1;height:4px;border-radius:99px;background:#e2e5f1}
.sdeck-dot.sdeck-dot-done{background:#2b3a67}
#sdeck-body{padding:20px 22px}
#sdeck-title{font-family:'Source Serif 4',serif;font-weight:800;font-size:16px;color:#1a1d2e;margin-bottom:10px}
#sdeck-content{font-size:14px;color:#1a1d2e;line-height:1.65}
#sdeck-content .sdeck-stat{font-size:26px;font-weight:800;color:#2b3a67}
#sdeck-footer{display:flex;justify-content:space-between;align-items:center;padding:14px 22px 18px;border-top:1px solid #f0f2fa}
.sdeck-btn{border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
.sdeck-btn-primary{background:#2b3a67;color:#fff}
.sdeck-btn-primary:hover{background:#3451d1}
.sdeck-btn-ghost{background:none;color:#9ba4c0}
.sdeck-btn-ghost:hover{color:#5a607a}
`;

  function injectStyle(){
    if(document.getElementById("sdeck-style")) return;
    const s=document.createElement("style");
    s.id="sdeck-style";s.textContent=STYLE;
    document.head.appendChild(s);
  }

  function escapeHtml(v){
    return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  let _state=null; // { slides, idx, onFinish }

  function render(){
    const s=_state;if(!s)return;
    const slide=s.slides[s.idx];
    document.getElementById("sdeck-progress").innerHTML=
      s.slides.map((_,i)=>'<div class="sdeck-dot'+(i<=s.idx?" sdeck-dot-done":"")+'"></div>').join("");
    document.getElementById("sdeck-title").textContent=slide.title;
    document.getElementById("sdeck-content").innerHTML=slide.html;
    const isLast=s.idx===s.slides.length-1;
    document.getElementById("sdeck-next").textContent=isLast?srT("sdeck_show_full_dashboard"):srT("sdeck_next");
  }

  function next(){
    const s=_state;if(!s)return;
    if(s.idx>=s.slides.length-1){ finish(); return; }
    s.idx++;
    render();
  }

  function finish(){
    const s=_state;if(!s)return;
    close();
    s.onFinish();
  }

  function close(){
    const el=document.getElementById("sdeck-overlay");
    if(el) el.remove();
    _state=null;
  }

  /* ── Public entry point ────────────────────────────────────────────
     bucketId    : string key into APP.bucketSeen (e.g. "class","student")
     slides      : array of {title, html} — caller builds these from
                   already-computed fields, no new computation here
     onFinish    : the bucket's real render function (called on Skip or
                   after the last slide) ── */
  function show(bucketId, slides, onFinish){
    if(APP.bucketSeen[bucketId] || !slides || !slides.length){
      onFinish();
      return;
    }
    injectStyle();
    APP.bucketSeen[bucketId]=true;

    const overlay=document.createElement("div");
    overlay.id="sdeck-overlay";
    overlay.innerHTML=
      '<div id="sdeck-card">'+
        '<div id="sdeck-progress"></div>'+
        '<div id="sdeck-body"><div id="sdeck-title"></div><div id="sdeck-content"></div></div>'+
        '<div id="sdeck-footer">'+
          '<button class="sdeck-btn sdeck-btn-ghost" id="sdeck-skip" type="button">'+escapeHtml(srT("sdeck_skip_full_dashboard"))+'</button>'+
          '<button class="sdeck-btn sdeck-btn-primary" id="sdeck-next" type="button">'+escapeHtml(srT("sdeck_next"))+'</button>'+
        '</div>'+
      '</div>';
    document.body.appendChild(overlay);

    _state={slides:slides,idx:0,onFinish:onFinish};
    document.getElementById("sdeck-skip").addEventListener("click", finish);
    document.getElementById("sdeck-next").addEventListener("click", next);
    render();
  }

  /* ── Slide builders — one per bucket, presentation-only, reading
     fields that already exist on student.analysis / APP.classStats.
     Exposed individually so a caller can pass a custom slide set too;
     these are just the default per-bucket sequences. ── */

  function studentSlides(st){
    const a=st.analysis||{};
    const name=(st.name||"").split(" ")[0];
    return [
      { title:"Overview", html:
        '<div class="sdeck-stat">'+escapeHtml(a.overallAvg)+'%</div>'+
        '<div>Grade <b>'+escapeHtml(a.grade||"-")+'</b> · '+escapeHtml(name)+' is currently trending <b>'+escapeHtml(a.trend||"steady")+'</b>.</div>' },
      { title:srT("sdeck_story_so_far"), html:
        (a.bestTest?(escapeHtml(srT('sdeck_best_result_so_far'))+' <b>'+escapeHtml(a.bestTest.name)+'</b> ('+escapeHtml(a.bestTest.pct)+'%).<br>'):'')+
        (a.worstTest?(escapeHtml(srT('sdeck_toughest_test'))+' <b>'+escapeHtml(a.worstTest.name)+'</b> ('+escapeHtml(a.worstTest.pct)+'%).'):escapeHtml(srT('sdeck_no_test_comparison'))) },
      { title:"Strengths & gaps", html:
        (function(){
          const subs=a.subjectAvgs||{};
          const keys=Object.keys(subs);
          if(!keys.length) return srT("sdeck_no_subject_breakdown");
          const sorted=keys.slice().sort((x,y)=>subs[y]-subs[x]);
          const best=sorted[0],worst=sorted[sorted.length-1];
          return escapeHtml(srT('sdeck_strongest'))+' <b>'+escapeHtml(best)+'</b> ('+escapeHtml(subs[best])+'%)<br>'+escapeHtml(srT('sdeck_needs_most_attention'))+' <b>'+escapeHtml(worst)+'</b> ('+escapeHtml(subs[worst])+'%)';
        })() },
      { title:srT("sdeck_what_to_do_next"), html:
        (typeof generateHomePlan==="function"?escapeHtml(generateHomePlan(st,typeof getStudentContinuityContext==="function"?getStudentContinuityContext(st.id):null)):"") +
        ((APP.setup&&APP.setup.mode!=="individual"&&typeof generateSchoolPlan==="function")?('<br><br>'+escapeHtml(generateSchoolPlan(st,typeof getStudentContinuityContext==="function"?getStudentContinuityContext(st.id):null))):"") }
    ];
  }

  function classSlides(){
    const cs=APP.classStats||{};
    return [
      { title:"Overview", html:
        '<div class="sdeck-stat">'+escapeHtml(cs.mean)+'%</div>'+
        '<div>'+escapeHtml(srT('sdeck_class_average_across',{n:cs.n||0}))+' '+escapeHtml(srT('sdeck_median_pct',{median:cs.median}))+'</div>' },
      { title:"Spread", html:
        'Highest: <b>'+escapeHtml(cs.max)+'%</b> · Lowest: <b>'+escapeHtml(cs.min)+'%</b><br>'+
        escapeHtml(srT('sdeck_standard_deviation'))+' '+escapeHtml(cs.sd)+' — '+((cs.sd>15)?escapeHtml(srT('sdeck_wide_spread')):escapeHtml(srT('sdeck_tight_spread'))) },
      { title:srT("sdeck_where_gaps_are"), html:
        (function(){
          const sw=(cs.subjectWeakness||[])[0];
          if(!sw) return srT("sdeck_no_subject_level_data");
          return escapeHtml(srT('sdeck_needs_most_attention'))+' <b>'+escapeHtml(sw.subject)+'</b> — '+escapeHtml(srT('sdeck_pct_below_pass',{pct:sw.pctBelow}));
        })() }
    ];
  }

  function helpSlides(students){
    const list=students||[];
    return [
      { title:srT("sdeck_who_needs_help"), html:
        list.length
          ? escapeHtml(srT('sdeck_students_flagged',{n:list.length}))+' — '+list.slice(0,5).map(s=>escapeHtml(s.name)).join(", ")+(list.length>5?", …":"")
          : escapeHtml(srT('sdeck_no_one_flagged')) },
      { title:srT("sdeck_why_flagged"), html:
        escapeHtml(srT("sdeck_flags_explanation")) }
    ];
  }

  function topSlides(students){
    const list=students||[];
    return [
      { title:srT("sdeck_top_performers"), html:
        list.length
          ? (list.slice(0,5).map(s=>escapeHtml(s.name)+' ('+escapeHtml(s.analysis&&s.analysis.overallAvg)+'%)').join("<br>"))
          : escapeHtml(srT("sdeck_no_standout_performers")) }
    ];
  }

  function genericSlides(label){
    return [ { title:label, html:"Here's a closer look — tap through to the full view whenever you're ready." } ];
  }

  return {
    show: show,
    studentSlides: studentSlides,
    classSlides: classSlides,
    helpSlides: helpSlides,
    topSlides: topSlides,
    genericSlides: genericSlides
  };

})();

if(typeof window !== "undefined") window.StoryDeck = StoryDeck;


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { StoryDeck };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window.StoryDeck=StoryDeck;}
