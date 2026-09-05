import { srT, weakestSubjectsInfo } from '../../core/render-i18n.js';
import { APP } from '../../core/state-nav.js';

/* ════ SMART ENGINE (Phase 2) ════
   "AC room vs general table": same computed data as Dashboard, delivered
   one question at a time, in plain sentences, no charts/graphics.
   Tap-to-ask only — no free-text NLP (13-language support made free-text
   intent-matching unreliable on low-end hardware; see handoff doc).

   PRIVACY_DEFAULT: this file's default provider (SmartEngineLocalProvider)
   never sends data anywhere — 100% local computation over APP, same as
   the rest of the app. Never persisted (NO_PERSISTENCE applies here too).

   PROVIDER INTERFACE (for future paid/commercial tier — NOT built now):
   Any provider must implement: answer(questionId, context) -> {text, ok}.
   SmartEngine.setProvider(provider) swaps the active provider. Today only
   SmartEngineLocalProvider exists. A future cloud-API provider (e.g. for
   "evaluate this uploaded answer sheet") would implement the same
   interface and require its own explicit per-action consent UI before
   ever being set as active — never silent, never default. Building that
   provider is future scope; this file only leaves the seam open.

   Knowledge (question bank) lives in knowledge/smart-questions.json,
   loaded lazily (only when Smart Engine is opened) — see loadKnowledge().
   Kept as pure data (no logic) so it can be translated per Phase 3
   without touching this file.
   ════ */

const SmartEngine = (function(){
  let _knowledge = null;
  let _provider = null;
  let _loadPromise = null;

  /* ── Lazy-load the question bank. Only called when user opens Smart
     Engine — protects low-end/slow-connection devices from an unwanted
     extra fetch on every page load, same principle as i18n language
     files (see PIB SPLIT_STATIC note). ── */
  function loadKnowledge(){
    if(_knowledge) return Promise.resolve(_knowledge);
    if(_loadPromise) return _loadPromise;
    _loadPromise = fetch("knowledge/smart-questions.json")
      .then(r=>{ if(!r.ok) throw new Error("Smart Engine question bank failed to load ("+r.status+")"); return r.json(); })
      .then(json=>{ _knowledge = json; return json; })
      .catch(err=>{
        _loadPromise = null;
        console.error("SmartEngine.loadKnowledge failed:", err);
        throw err;
      });
    return _loadPromise;
  }

  function getKnowledgeSync(){ return _knowledge; }

  function setProvider(p){
    if(!p || typeof p.answer!=="function") throw new Error("SmartEngine provider must implement answer(questionId, context)");
    _provider = p;
  }

  function getProvider(){ return _provider; }

  /* ── Which question categories apply right now (mode + data-availability
     aware), so the UI never shows a chip that can't be answered. ── */
  function availableCategories(){
    if(!_knowledge) return [];
    const mode = APP.setup.mode; // "institution" | "individual"
    const hasStudents = (APP.students||[]).length>0;
    return _knowledge.categories.filter(cat=>{
      if(cat.scope.indexOf(mode)===-1) return false;
      if(cat.id==="class_management" && !hasStudents) return false;
      if(cat.id==="per_student" && !hasStudents) return false;
      return true;
    });
  }

  /* ── Domain-relevance deflection heuristic (no LLM). Used only if/when
     a free-text box is ever added on top of the chip UI — chips
     themselves can never produce an irrelevant question, since the user
     can only tap what's offered. Kept here so the seam exists without
     committing to building free-text input now. ── */
  function isOnTopic(text){
    if(!_knowledge) return false;
    const words = String(text||"").toLowerCase().match(/[a-z]+/g) || [];
    if(!words.length) return false;
    const vocab = new Set(_knowledge.domainVocabulary);
    const hits = words.filter(w=>vocab.has(w)).length;
    return hits>0;
  }

  function ask(questionId, context){
    if(!_provider) throw new Error("SmartEngine: no provider set. Call SmartEngine.setProvider() first.");
    if(!_knowledge) throw new Error("SmartEngine: knowledge not loaded. Call loadKnowledge() first.");
    return _provider.answer(questionId, context||{});
  }

  return { loadKnowledge, getKnowledgeSync, setProvider, getProvider, availableCategories, isOnTopic, ask };
})();

/* ════ LOCAL DETERMINISTIC PROVIDER (today's only provider) ════
   Reads existing APP analytics only. Zero AI/LLM. Zero hallucination
   risk by construction — every number comes straight from the same
   compute-engine.js functions Dashboard already uses. ════ */
const SmartEngineLocalProvider = (function(){

  function findQuestion(questionId){
    const kn = SmartEngine.getKnowledgeSync();
    for(const cat of kn.categories){
      const q = cat.questions.find(q=>q.id===questionId);
      if(q) return q;
    }
    return null;
  }

  function fmt(template, vals){
    return template.replace(/\{(\w+)\}/g, (m,k)=> (k in vals) ? vals[k] : m);
  }

  function answerWeakestSubject(){
    const sw = (APP.classStats||{}).subjectWeakness||[];
    if(!sw.length) return {ok:false,text:"No subject data available yet."};
    const top = sw[0];
    const broad = top.pctBelow>=50;
    const note = broad
      ? findQuestion("weakest_subject").spreadNoteWide.replace(/\{topSubject\}/g, top.subject)
      : findQuestion("weakest_subject").spreadNoteNarrow;
    const text = fmt(findQuestion("weakest_subject").answerTemplate, {
      topSubject: top.subject, topPctBelow: top.pctBelow, topAvg: top.avgClass, spreadNote: note
    });
    return {ok:true, text};
  }

  function answerStrongestSubject(){
    const sw = (APP.classStats||{}).subjectWeakness||[];
    if(!sw.length) return {ok:false,text:"No subject data available yet."};
    const bottom = sw[sw.length-1];
    const text = fmt(findQuestion("strongest_subject").answerTemplate, {
      bottomSubject: bottom.subject, bottomAvg: bottom.avgClass, bottomPctBelow: bottom.pctBelow
    });
    return {ok:true, text};
  }

  function answerClassDistribution(){
    const d = (APP.classStats||{}).distribution;
    if(!d) return {ok:false,text:srT("smart_no_distribution_data")};
    const n = APP.classStats.n;
    let note = "";
    if(d.below>0 && d.below/n>=0.2) note = srT("smart_note_below_threshold_high");
    else if(d.excellent/n>=0.5) note = srT("smart_note_excelling_high");
    const text = fmt(findQuestion("class_distribution").answerTemplate, {
      n, excellent:d.excellent, good:d.good, average:d.average, below:d.below, distributionNote: note
    });
    return {ok:true, text};
  }

  function answerAttendanceCorrelation(){
    const ac = (APP.classStats||{}).attendanceCorrelation;
    const q = findQuestion("attendance_correlation");
    if(!ac) return {ok:false, text:q.unavailableMessage};
    const gap = ac.noAbsence.avg - ac.someAbsence.avg;
    const note = gap>=10 ? "That's a meaningful gap — attendance policy or early-absence follow-up may be worth prioritising." : "That's a modest gap — attendance alone likely isn't the main driver here.";
    const text = fmt(q.answerTemplate, {
      noAbsenceAvg: ac.noAbsence.avg, noAbsenceN: ac.noAbsence.n,
      someAbsenceAvg: ac.someAbsence.avg, someAbsenceN: ac.someAbsence.n,
      gapPoints: Math.abs(gap), attendanceNote: note
    });
    return {ok:true, text};
  }

  function answerGenderGap(){
    const q = findQuestion("gender_gap");
    if(!APP.aiFeatures.has("diversity_analysis")) return {ok:false, text:srT("smart_enable_diversity_feature")};
    const ga = APP.genderAnalysis;
    if(!ga || !ga.available) return {ok:false, text:(ga&&ga.reason)||q.unavailableMessage};
    if(!ga.leadGroup) return {ok:true, text:q.noGapMessage};
    const text = fmt(q.answerTemplate, {
      leadGroup: ga.leadGroup, overallGap: ga.overallGap,
      maxGapSubject: ga.maxGapSubject, maxGapValue: ga.maxGapValue, maxGapLead: ga.maxGapLead
    });
    return {ok:true, text};
  }

  function answerPeerOutliers(){
    const q = findQuestion("peer_outliers");
    const outliers = (APP.students||[]).filter(st=>st.analysis.peerOutlier);
    if(!outliers.length) return {ok:true, text:q.emptyMessage};
    const list = outliers.map(st=>`${st.name} (${st.analysis.peerOutlier==="high"?"unusually high":"unusually low"}, z=${st.analysis.zScore})`).join("; ");
    const text = fmt(q.answerTemplate, {count: outliers.length, list});
    return {ok:true, text};
  }

  function answerCohortClusters(){
    const q = findQuestion("cohort_clusters");
    const cc = APP.cohortClusters;
    if(!cc) return {ok:false, text:q.unavailableMessage};
    const groupList = cc.groups.map(g=>`${g.label} (${g.students.length} students)`).join(", ");
    const text = fmt(q.answerTemplate, {k: cc.k, groupList});
    return {ok:true, text};
  }

  function answerRankMovement(){
    const q = findQuestion("rank_movement");
    const withMove = (APP.students||[]).filter(st=>st.analysis.rankMovement!=null && st.analysis.rankMovement!==0);
    if(!withMove.length) return {ok:false, text:q.unavailableMessage};
    const up = withMove.filter(st=>st.analysis.rankMovement>0);
    const down = withMove.filter(st=>st.analysis.rankMovement<0);
    const notable = withMove.slice().sort((a,b)=>Math.abs(b.analysis.rankMovement)-Math.abs(a.analysis.rankMovement)).slice(0,3)
      .map(st=>`${st.name} (${st.analysis.rankMovement>0?"+":""}${st.analysis.rankMovement})`).join(", ");
    const text = fmt(q.answerTemplate, {upCount: up.length, downCount: down.length, notableList: notable});
    return {ok:true, text};
  }

  // ── Per-student answers ──
  function answerRankGap(student){
    const q = findQuestion("rank_gap");
    const a = student.analysis;
    const note = a.topperGap<=5 ? srT("smart_close_to_top") :
                 a.topperGap<=20 ? "A moderate gap — steady improvement in weaker subjects should narrow this." :
                 "A significant gap — worth a focused improvement plan rather than broad effort.";
    const text = fmt(q.answerTemplate, {name: student.name, rank: a.rank, n: APP.students.length, topperGap: Math.round(a.topperGap), gapNote: note});
    return {ok:true, text};
  }

  function answerTrend(student){
    const q = findQuestion("trend");
    const a = student.analysis;
    const note = a.trend==="improving" ? srT("smart_keep_reinforcing") :
                 a.trend==="declining" ? "Worth a check-in before this becomes a pattern." :
                 srT("smart_performance_stable");
    const text = fmt(q.answerTemplate, {name: student.name, trend: a.trend, trendNote: note});
    return {ok:true, text};
  }

  function answerPredictedNext(student){
    const q = findQuestion("predicted_next");
    const a = student.analysis;
    if(a.predictedNext==null) return {ok:false, text: q.unavailableMessage};
    const note = a.predictedNext < APP.setup.passThreshold ? srT("smart_projection_below_threshold") : "";
    const text = fmt(q.answerTemplate, {name: student.name, predictedNext: a.predictedNext, predictionNote: note});
    return {ok:true, text};
  }

  function answerConsistency(student){
    const q = findQuestion("consistency");
    const a = student.analysis;
    const note = a.consistencyScore>=80 ? srT("smart_very_steady") :
                 a.consistencyScore>=50 ? srT("smart_reasonably_steady") :
                 srT("smart_quite_volatile");
    const text = fmt(q.answerTemplate, {name: student.name, consistencyScore: a.consistencyScore, consistencyNote: note});
    return {ok:true, text};
  }

  function answerWeakestSubjectStudent(student){
    const q = findQuestion("weakest_subject_student");
    const info = weakestSubjectsInfo(student); // existing function, render-dashboard.js — returns {entries,minVal,weakest,broad}
    if(!info || !info.weakest || !info.weakest.length) return {ok:false, text:srT("smart_not_enough_subject_data")};
    const multi = info.weakest.length>1;
    const text = fmt(q.answerTemplate, {
      name: student.name,
      subjectOrSubjects: multi?"subjects are":"subject is",
      isAre: "",
      subjectList: info.weakest.join(", "),
      broadNote: info.broad ? srT("smart_spread_evenly") : ""
    });
    return {ok:true, text};
  }

  function answerWellbeing(student){
    const q = findQuestion("wellbeing");
    const a = student.analysis;
    const note = a.wellbeingFlag==="high" ? "Worth a supportive conversation soon — academics aside." :
                 a.wellbeingFlag==="moderate" ? srT("smart_keep_an_eye") :
                 "No particular concern at this time.";
    const text = fmt(q.answerTemplate, {name: student.name, wellbeingFlag: a.wellbeingFlag, stressScore: a.stressScore, wellbeingNote: note});
    return {ok:true, text};
  }

  function answerHealthScore(student){
    const q = findQuestion("health_score");
    const a = student.analysis;
    const text = fmt(q.answerTemplate, {name: student.name, healthScore: a.healthScore, healthBand: a.healthBand});
    return {ok:true, text};
  }

  function answerSubjectDeltas(student){
    const q = findQuestion("subject_deltas");
    const deltas = student.analysis.subjectDeltas||{};
    const parts = Object.entries(deltas).map(([subj,d])=> `${subj} (${d>=0?"+":""}${d})`);
    if(!parts.length) return {ok:false, text:"No subject comparison data available yet."};
    const text = fmt(q.answerTemplate, {deltaSummary: parts.join(", ")});
    return {ok:true, text};
  }

  function answerRankMovementStudent(student){
    const q = findQuestion("rank_movement_student");
    const rm = student.analysis.rankMovement;
    if(rm==null) return {ok:false, text:q.unavailableMessage};
    const text = fmt(q.answerTemplate, {name: student.name, direction: rm>0?"moved up":rm<0?"moved down":"not changed", absMovement: Math.abs(rm)});
    return {ok:true, text};
  }

  const HANDLERS = {
    weakest_subject: ()=>answerWeakestSubject(),
    strongest_subject: ()=>answerStrongestSubject(),
    class_distribution: ()=>answerClassDistribution(),
    attendance_correlation: ()=>answerAttendanceCorrelation(),
    gender_gap: ()=>answerGenderGap(),
    peer_outliers: ()=>answerPeerOutliers(),
    cohort_clusters: ()=>answerCohortClusters(),
    rank_movement: ()=>answerRankMovement(),
    rank_gap: (ctx)=>answerRankGap(ctx.student),
    trend: (ctx)=>answerTrend(ctx.student),
    predicted_next: (ctx)=>answerPredictedNext(ctx.student),
    consistency: (ctx)=>answerConsistency(ctx.student),
    weakest_subject_student: (ctx)=>answerWeakestSubjectStudent(ctx.student),
    wellbeing: (ctx)=>answerWellbeing(ctx.student),
    health_score: (ctx)=>answerHealthScore(ctx.student),
    subject_deltas: (ctx)=>answerSubjectDeltas(ctx.student),
    rank_movement_student: (ctx)=>answerRankMovementStudent(ctx.student)
  };

  function answer(questionId, context){
    const handler = HANDLERS[questionId];
    if(!handler) return {ok:false, text:srT("smart_question_not_available")};
    if(["rank_gap","trend","predicted_next","consistency","weakest_subject_student","wellbeing","health_score","subject_deltas","rank_movement_student"].includes(questionId) && !context.student){
      return {ok:false, text:"Select a student first."};
    }
    try{
      const result = handler(context);
      window.SIA_DEBUG_LOG("SmartEngine:"+questionId, context.student ? {student:context.student.name, analysis:context.student.analysis} : {}, result);
      return result;
    }catch(err){
      console.error("SmartEngineLocalProvider.answer error for", questionId, err);
      return {ok:false, text:"Couldn't compute an answer for this — the underlying data may be incomplete."};
    }
  }

  return { answer };
})();

/* Wire the local provider as default the moment this file loads — the
   ONLY provider today. A future paid provider would call
   SmartEngine.setProvider(newProvider) after explicit user consent,
   never automatically. */
SmartEngine.setProvider(SmartEngineLocalProvider);


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { SmartEngine, SmartEngineLocalProvider };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window.SmartEngine=SmartEngine;window.SmartEngineLocalProvider=SmartEngineLocalProvider;}
