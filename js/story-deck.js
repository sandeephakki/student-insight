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
#sdeck-card{background:#fff;border-radius:16px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(10,15,40,.35);overflow:hidden;font-family:Inter,sans-serif}
#sdeck-progress{display:flex;gap:5px;padding:14px 18px 0}
.sdeck-dot{flex:1;height:4px;border-radius:99px;background:#e2e5f1}
.sdeck-dot.sdeck-dot-done{background:#4361ee}
#sdeck-body{padding:20px 22px}
#sdeck-title{font-family:'DM Sans',sans-serif;font-weight:800;font-size:16px;color:#1a1d2e;margin-bottom:10px}
#sdeck-content{font-size:14px;color:#1a1d2e;line-height:1.65}
#sdeck-content .sdeck-stat{font-size:26px;font-weight:800;color:#4361ee}
#sdeck-footer{display:flex;justify-content:space-between;align-items:center;padding:14px 22px 18px;border-top:1px solid #f0f2fa}
.sdeck-btn{border:none;border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
.sdeck-btn-primary{background:#4361ee;color:#fff}
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
    document.getElementById("sdeck-next").textContent=isLast?"Show full dashboard":"Next";
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
          '<button class="sdeck-btn sdeck-btn-ghost" id="sdeck-skip" type="button">Skip to full dashboard</button>'+
          '<button class="sdeck-btn sdeck-btn-primary" id="sdeck-next" type="button">Next</button>'+
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
      { title:"The story so far", html:
        (a.bestTest?('Best result so far: <b>'+escapeHtml(a.bestTest.name)+'</b> ('+escapeHtml(a.bestTest.pct)+'%).<br>'):'')+
        (a.worstTest?('Toughest test: <b>'+escapeHtml(a.worstTest.name)+'</b> ('+escapeHtml(a.worstTest.pct)+'%).'):'No test-to-test comparison available yet.') },
      { title:"Strengths & gaps", html:
        (function(){
          const subs=a.subjectAvgs||{};
          const keys=Object.keys(subs);
          if(!keys.length) return "No subject breakdown available yet.";
          const sorted=keys.slice().sort((x,y)=>subs[y]-subs[x]);
          const best=sorted[0],worst=sorted[sorted.length-1];
          return 'Strongest: <b>'+escapeHtml(best)+'</b> ('+escapeHtml(subs[best])+'%)<br>Needs the most attention: <b>'+escapeHtml(worst)+'</b> ('+escapeHtml(subs[worst])+'%)';
        })() },
      { title:"What to do next", html:
        (typeof generateHomePlan==="function"?escapeHtml(generateHomePlan(st)):"") +
        ((APP.setup&&APP.setup.mode!=="individual"&&typeof generateSchoolPlan==="function")?('<br><br>'+escapeHtml(generateSchoolPlan(st))):"") }
    ];
  }

  function classSlides(){
    const cs=APP.classStats||{};
    return [
      { title:"Overview", html:
        '<div class="sdeck-stat">'+escapeHtml(cs.mean)+'%</div>'+
        '<div>Class average across '+escapeHtml(cs.n||0)+' students. Median '+escapeHtml(cs.median)+'%.</div>' },
      { title:"Spread", html:
        'Highest: <b>'+escapeHtml(cs.max)+'%</b> · Lowest: <b>'+escapeHtml(cs.min)+'%</b><br>'+
        'Standard deviation: '+escapeHtml(cs.sd)+' — '+((cs.sd>15)?"a fairly wide spread across the class.":"a fairly tight spread across the class.") },
      { title:"Where the gaps are", html:
        (function(){
          const sw=(cs.subjectWeakness||[])[0];
          if(!sw) return "No subject-level data yet.";
          return 'Needs the most attention: <b>'+escapeHtml(sw.subject)+'</b> — '+escapeHtml(sw.pctBelow)+'% of the class is below the pass threshold.';
        })() }
    ];
  }

  function helpSlides(students){
    const list=students||[];
    return [
      { title:"Who needs help", html:
        list.length
          ? (list.length+' student'+(list.length===1?"":"s")+' currently flagged — '+list.slice(0,5).map(s=>escapeHtml(s.name)).join(", ")+(list.length>5?", …":""))
          : "No one is currently flagged — nothing urgent to review right now." },
      { title:"Why they're flagged", html:
        "Flags come from a mix of signals — low averages, sharp drops between tests, or repeated near-fails in a specific subject. Open a student below for their individual detail." }
    ];
  }

  function topSlides(students){
    const list=students||[];
    return [
      { title:"Top performers", html:
        list.length
          ? (list.slice(0,5).map(s=>escapeHtml(s.name)+' ('+escapeHtml(s.analysis&&s.analysis.overallAvg)+'%)').join("<br>"))
          : "No standout performers to show yet." }
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
