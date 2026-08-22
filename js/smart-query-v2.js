import { srT, weakestSubjectsInfo } from './render-i18n.js';
import { APP } from './state-nav.js';

/* ============================================================
   Student Insight — Smart Query v2
   Free-text-capable question matching + answer engine, layered on top
   of the same knowledge/smart-questions.json data file the original
   tap-only Smart Engine (js/smart-engine.js) uses. No new computation —
   every answer is read from existing APP analytics via computeKey paths
   already defined in that JSON. Everything runs on-device; nothing is
   sent anywhere.

   v2 adds:
   - Free-text matching (lightweight token-overlap scorer — no external
     fuzzy-match library; js/vendor/fuse.min.js does not exist in this
     repo, so this does not depend on it)
   - Ranked multi-result matching instead of single tap-to-answer
   - A stable API surface (window.SmartQueryV2) intended to be the data
     layer behind a future UI (e.g. the right-rail "ask a question"
     panel described in shell-redesign-plan.md — that UI is not part of
     this file)
============================================================ */

const SmartQueryV2 = (function(){
  window.SIA_DEBUG_LOG("%c[SmartQueryV2] file version: v4.29-debug-marker","background:#2b3a67;color:#fff;padding:2px 6px;border-radius:4px");


  let _bank = null;         // parsed knowledge/smart-questions.json
  let _loadPromise = null;
  // Set fresh by every match() call from the actual query text (institution
  // mode only — individual mode always resolves to APP.students[0] instead,
  // see answerQuestionImpl). Read by answerQuestionImpl() immediately after,
  // synchronously, within the same call — see match()'s comment below for
  // why this doesn't go stale between the two calls.
  let _lastMatchedStudent = null;

  /* ── Load & parse the question bank (same file smart-engine.js uses) ── */
  function load(){
    if(_loadPromise) return _loadPromise;
    _loadPromise = fetch("knowledge/smart-questions.json")
      .then(r => { if(!r.ok) throw new Error("smart-questions.json fetch failed: "+r.status); return r.json(); })
      .then(json => { _bank = json; return _bank; })
      .catch(err => { console.warn("[SmartQueryV2] failed to load question bank:", err); _bank = null; throw err; });
    return _loadPromise;
  }

  function isReady(){ return !!_bank; }

  /* ── Flatten categories → a single list of questions, each carrying
     its parent category's scope/requires down onto itself, so matching
     and answering don't need to re-walk the category tree every time. ── */
  function flatQuestions(){
    if(!_bank) return [];
    const out = [];
    (_bank.categories||[]).forEach(cat => {
      (cat.questions||[]).forEach(q => {
        out.push(Object.assign({}, q, {
          _categoryId: cat.id,
          _categoryLabel: cat.label,
          _scope: cat.scope||[],
          _requires: cat.requires||null
        }));
      });
    });
    return out;
  }

  /* ── Scope/requirement gating — same semantics as the tap-only engine:
     a question is only offered if it applies to the current mode
     (institution/individual) and its `requires` expression (a tiny,
     fixed vocabulary of guard conditions, evaluated against APP below)
     currently holds. ── */
  function currentMode(){
    return (window.APP && APP.setup && APP.setup.mode) || "institution";
  }

  function evalRequires(expr){
    if(!expr) return true;
    const students = (window.APP && APP.students) || [];
    const setup = (window.APP && APP.setup) || {};
    try{
      switch(expr){
        case "students.length>0": return students.length>0;
        case "students.length>=2": return students.length>=2;
        case "tests.length>=2": return (setup.tests||[]).length>=2;
        case "subjects.length>=2": return (setup.subjects||[]).length>=2;
        case "selectedStudent": return setup.mode==="individual" && students.length>=1;
        default:
          // Unknown guard string — fail open (question stays hidden)
          // rather than throwing, since this is data-driven and a typo
          // in the JSON shouldn't crash the whole engine.
          console.warn("[SmartQueryV2] unrecognized requires expression:", expr);
          return false;
      }
    }catch(e){
      console.warn("[SmartQueryV2] requires evaluation error:", expr, e);
      return false;
    }
  }

  function questionAiFeatureOk(q){
    if(!q.requiresAIFeature) return true;
    return !!(window.APP && APP.aiFeatures && APP.aiFeatures.has(q.requiresAIFeature));
  }

  function availableQuestions(){
    const mode = currentMode();
    return flatQuestions().filter(q =>
      (!q._scope.length || q._scope.indexOf(mode) !== -1) &&
      evalRequires(q._requires) &&
      questionAiFeatureOk(q)
    );
  }

  /* ── computeKey resolver ──────────────────────────────────────────
     Reads a dotted path off APP (e.g. "classStats.subjectWeakness"),
     with one extra convention: a "[]" segment maps the remaining path
     over an array (e.g. "students[].analysis.peerOutlier" → an array
     of {student, value} for every student that has a non-null value
     at that path). No new computation happens here — every value this
     touches was already computed elsewhere (compute-engine.js). ── */
  function getPath(obj, path){
    return path.split(".").reduce((o,k) => (o==null ? undefined : o[k]), obj);
  }

  function resolveComputeKey(key){
    if(!key) return undefined;
    const root = window.APP || {};
    const mapIdx = key.indexOf("[].");
    if(mapIdx === -1){
      return getPath(root, key);
    }
    const arrPath = key.slice(0, mapIdx);           // e.g. "students"
    const restPath = key.slice(mapIdx+3);           // e.g. "analysis.peerOutlier"
    const arr = getPath(root, arrPath);
    if(!Array.isArray(arr)) return undefined;
    return arr
      .map(item => ({ student: item, value: getPath(item, restPath) }))
      .filter(r => r.value !== undefined && r.value !== null);
  }

  /* ── Template filling — {placeholder} substitution against a flat
     vars object the caller builds per-question (answer-shaping logic
     necessarily differs per computeKey shape, same as the tap-only
     engine's design). ── */
  function fillTemplate(template, vars){
    if(!template) return "";
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) =>
      (vars && Object.prototype.hasOwnProperty.call(vars, k)) ? String(vars[k]) : m
    );
  }

  /* ── Per-question answer shaping. Each computeKey shape needs its own
     small mapping into template vars — this mirrors what the tap-only
     engine (js/smart-engine.js) already does per question, just
     centralized here so free-text matching and tap-answering share one
     answer path instead of diverging. Unrecognized/uncomputable
     questions fall back to unavailableMessage/emptyMessage from the
     JSON itself rather than a hardcoded string, so wording stays
     data-driven and translatable. ── */
  function answerQuestionImpl(questionId){
    const q = flatQuestions().find(x => x.id === questionId);
    if(!q) return { ok:false, text: srT("smart_question_not_in_bank") };
    if(!questionAiFeatureOk(q)){
      return { ok:false, text: q.unavailableMessage || srT("smart_needs_ai_feature") };
    }
    // FIX (report: chat only ever surfaces class-wide questions, never
    // student ones): q._requires for every per_student question is the
    // category-level "selectedStudent" guard, and evalRequires() only
    // ever returns true for that guard in individual mode (see its
    // switch case below) — it has no notion of "a student was named in
    // this chat message". That's fine for the canned/left-rail list
    // (which has no query text to read a name from and correctly stays
    // class-only there in institution mode), but it silently blocked
    // per_student questions from EVER being answered via free-text chat
    // in institution mode, even when a student was explicitly named
    // ("how is Priya doing"). Skipped here specifically for per_student —
    // student-presence is checked directly below via _lastMatchedStudent
    // instead, which match() sets from the actual query text.
    if(q._requires && !evalRequires(q._requires) && q._categoryId !== "per_student"){
      return { ok:false, text: q.unavailableMessage || srT("smart_not_enough_data") };
    }

    const student = currentMode()==="individual"
      ? ((window.APP && APP.students && APP.students[0]) || null)
      : (_lastMatchedStudent || null);
    const vars = { name: student ? student.name : "" };

    // "This Student" questions use a comma-joined computeKey (e.g.
    // "student.analysis.rank,topperGap") or a function-call string
    // (weakestSubjectsInfo(student)) — resolveComputeKey's generic dotted-path
    // walker can only follow a single "." chain, so it can never resolve these
    // and every per-student question fell through to emptyMessage regardless
    // of what was asked. Answered directly off student.analysis instead,
    // mirroring the per-question logic js/smart-engine.js already gets right
    // (same notes/thresholds), just filled into this engine's template/vars.
    if(q._categoryId === "per_student"){
      if(!student) return { ok:false, text: srT("smart_select_student_first") };
      const a = student.analysis || {};
      switch(q.id){
        case "rank_gap":
          vars.rank = a.rank; vars.n = (APP.students||[]).length; vars.topperGap = Math.round(a.topperGap);
          vars.gapNote = a.topperGap<=5 ? srT("smart_close_to_top") :
                         a.topperGap<=20 ? srT("smart_moderate_gap") :
                         srT("smart_significant_gap");
          return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
        case "trend":
          vars.trend = a.trend;
          vars.trendNote = a.trend==="improving" ? srT("smart_keep_reinforcing") :
                            a.trend==="declining" ? srT("smart_worth_checkin") :
                            srT("smart_performance_stable");
          return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
        case "predicted_next":
          if(a.predictedNext==null) return { ok:false, text: q.unavailableMessage || srT("smart_needs_2_tests_project") };
          vars.predictedNext = a.predictedNext;
          vars.predictionNote = a.predictedNext < ((APP.setup||{}).passThreshold) ? srT("smart_projection_below_threshold") : "";
          return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
        case "consistency":
          vars.consistencyScore = a.consistencyScore;
          vars.consistencyNote = a.consistencyScore>=80 ? srT("smart_very_steady") :
                                  a.consistencyScore>=50 ? srT("smart_reasonably_steady") :
                                  srT("smart_quite_volatile");
          return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
        case "weakest_subject_student": {
          const info = (typeof weakestSubjectsInfo==="function") ? weakestSubjectsInfo(student) : null;
          if(!info || !info.weakest || !info.weakest.length) return { ok:false, text: srT("smart_not_enough_subject_data") };
          vars.subjectOrSubjects = info.weakest.length>1 ? srT("smart_subjects_are") : srT("smart_subject_is");
          vars.isAre = ""; vars.subjectList = info.weakest.join(", ");
          vars.broadNote = info.broad ? srT("smart_spread_evenly") : "";
          return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
        }
        case "wellbeing":
          vars.wellbeingFlag = a.wellbeingFlag; vars.stressScore = a.stressScore;
          vars.wellbeingNote = a.wellbeingFlag==="high" ? srT("smart_worth_supportive_conv") :
                                a.wellbeingFlag==="moderate" ? srT("smart_keep_an_eye") :
                                srT("smart_no_particular_concern");
          return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
        case "health_score":
          vars.healthScore = a.healthScore; vars.healthBand = a.healthBand;
          return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
        case "subject_deltas": {
          const deltas = a.subjectDeltas || {};
          const parts = Object.entries(deltas).map(([subj,d]) => subj + " (" + (d>=0?"+":"") + d + ")");
          if(!parts.length) return { ok:false, text: srT("smart_no_subject_comparison_data") };
          vars.deltaSummary = parts.join(", ");
          return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
        }
        case "rank_movement_student":
          if(a.rankMovement==null) return { ok:false, text: q.unavailableMessage || srT("smart_needs_2_tests_rank") };
          vars.direction = a.rankMovement>0 ? srT("smart_moved_up") : a.rankMovement<0 ? srT("smart_moved_down") : srT("smart_not_changed");
          vars.absMovement = Math.abs(a.rankMovement);
          return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
      }
    }

    const value = resolveComputeKey(q.computeKey);

    if(value === undefined || value === null || (Array.isArray(value) && value.length===0)){
      return { ok:false, text: q.emptyMessage || q.unavailableMessage || srT("smart_nothing_to_report") };
    }

    // Shape-specific var extraction. Kept intentionally simple/explicit
    // rather than a generic deep-flattener, so each mapping is easy to
    // audit against its answerTemplate in knowledge/smart-questions.json.
    //
    // FIX (Smart Search "no value" report): every branch below was built
    // against the wrong variable names, or missing variables entirely, so
    // every answer left one or more literal {placeholder} tokens un-filled
    // in the text shown to the user — verified against a real sample file
    // (test/smart-search-probe.js) before this fix, where e.g. class
    // distribution rendered "Of {n} students: 8 are excelling... {distributionNote}"
    // instead of real numbers. Each fix below is checked directly against
    // its answerTemplate string in knowledge/smart-questions.json.
    if(q.computeKey === "classStats.subjectWeakness" && Array.isArray(value)){
      const sorted = [...value].sort((a,b)=> (q.id==="strongest_subject" ? a.pctBelow-b.pctBelow : b.pctBelow-a.pctBelow));
      const top = sorted[0];
      if(!top) return { ok:false, text: q.emptyMessage || "No subject data available." };
      if(q.id==="strongest_subject"){
        // strongest_subject's answerTemplate uses {bottomSubject}/{bottomAvg}/
        // {bottomPctBelow} (lowest-pctBelow end of the sort) — previously
        // written as topSubject/topPctBelow/topAvg regardless of which
        // question asked, so this branch never filled anything for
        // strongest_subject specifically.
        vars.bottomSubject = top.subject; vars.bottomPctBelow = top.pctBelow; vars.bottomAvg = top.avgClass;
      } else {
        vars.topSubject = top.subject; vars.topPctBelow = top.pctBelow; vars.topAvg = top.avgClass;
        const spreadWide = sorted.length>1 && (sorted[0].pctBelow - sorted[sorted.length-1].pctBelow) > 20;
        vars.spreadNote = spreadWide ? (q.spreadNoteWide||"") : (q.spreadNoteNarrow||"");
      }
      return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
    }

    if(q.computeKey === "classStats.distribution" && typeof value === "object"){
      // answerTemplate needs {n} and {distributionNote} in addition to the
      // 4 band counts already spread in — neither was ever set.
      Object.assign(vars, value);
      vars.n = (value.excellent||0)+(value.good||0)+(value.average||0)+(value.below||0);
      vars.distributionNote = value.below>0
        ? srT("smart_distribution_note_below",{count:value.below})
        : srT("smart_distribution_note_none_below");
      return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
    }

    if(q.computeKey === "classStats.attendanceCorrelation" && typeof value === "object"){
      // answerTemplate needs noAbsenceN/someAbsenceN/gapPoints/attendanceNote
      // on top of the two averages — only the averages were ever set.
      const noAbsAvg = value.noAbsence ? value.noAbsence.avg : 0;
      const someAbsAvg = value.someAbsence ? value.someAbsence.avg : 0;
      vars.noAbsenceAvg = noAbsAvg;
      vars.someAbsenceAvg = someAbsAvg;
      vars.noAbsenceN = value.noAbsence ? value.noAbsence.n : 0;
      vars.someAbsenceN = value.someAbsence ? value.someAbsence.n : 0;
      vars.gapPoints = Math.abs(noAbsAvg - someAbsAvg);
      vars.attendanceNote = noAbsAvg > someAbsAvg
        ? srT("smart_attendance_note_matters")
        : srT("smart_attendance_note_no_clear_link");
      return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
    }

    if(q.computeKey === "genderAnalysis" && typeof value === "object"){
      // Two bugs here previously: (1) the "is there a gap" check read
      // value.gapPct, a field that has never existed on this object (the
      // real fields are leadGroup/overallGap) — gapPct was always
      // undefined, so this ALWAYS returned noGapMessage regardless of the
      // real computed gap. (2) an unavailable (not-enough-data) result
      // fell into the same "no gap" branch instead of its own
      // unavailableMessage, misreporting missing data as "no gap found".
      if(value.available===false){
        return { ok:false, text: q.unavailableMessage || srT("smart_not_enough_data") };
      }
      if(!value.leadGroup || !value.overallGap){
        return { ok:true, text: q.noGapMessage || "No meaningful gap found." };
      }
      Object.assign(vars, value);
      return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
    }

    if(q.computeKey === "students[].analysis.peerOutlier" && Array.isArray(value)){
      // answerTemplate uses {list}; this built vars.names instead, so
      // {list} was always left as a literal unfilled token in the answer.
      if(!value.length) return { ok:false, text: q.emptyMessage || "No outliers detected." };
      vars.count = value.length;
      vars.list = value.slice(0,5).map(r=>r.student.name).join(", ");
      return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
    }

    if(q.computeKey === "cohortClusters" && typeof value === "object"){
      // {k} came through fine via the generic Object.assign fallback
      // below, but {groupList} was never built from the raw groups array
      // (a list of {label, students[]} objects, not directly templatable).
      vars.k = value.k;
      vars.groupList = (value.groups||[])
        .map(g => `${g.label} (${(g.students||[]).length})`)
        .join(", ");
      return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
    }

    if(q.computeKey === "students[].analysis.rankMovement" && Array.isArray(value)){
      // Class-wide rank movement had NO dedicated branch at all — it fell
      // through to the generic array fallback below, which just dumped the
      // whole raw array into vars.value and left every one of
      // {upCount}/{downCount}/{notableList} unfilled.
      const up = value.filter(r=>r.value>0);
      const down = value.filter(r=>r.value<0);
      if(!up.length && !down.length) return { ok:false, text: q.emptyMessage || "No rank movement to report." };
      vars.upCount = up.length;
      vars.downCount = down.length;
      const notable = [...value].sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,5);
      vars.notableList = notable.map(r => `${r.student.name} (${r.value>0?"+":""}${r.value})`).join(", ");
      return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
    }

    // Generic fallback: scalar or simple object value, spread directly
    // into template vars under its own key name plus a bare "value".
    if(typeof value === "object" && !Array.isArray(value)){
      Object.assign(vars, value);
    } else {
      vars.value = value;
    }
    return { ok:true, text: fillTemplate(q.answerTemplate, vars) };
  }

  /* ── Free-text matching ───────────────────────────────────────────
     Lightweight token-overlap scorer: tokenize the query, tokenize each
     available question's label (+ its category label), score by
     overlap count with a small bonus for domainVocabulary hits so
     on-topic phrasing ranks above incidental word matches. This is
     deliberately simple (no external library — see file header) rather
     than a full fuzzy-match; it's matching against a small (dozens,
     not thousands) fixed question set, not free-form documents. ── */
  function tokenize(s){
    return String(s||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(Boolean).map(stem);
  }
  // Minimal suffix-stripping stemmer — NOT a full Porter stemmer (overkill
  // and riskier for short domain words). Strips at most one suffix per
  // token, longest-first ("ers" tried before "s", so "teachers" -> "teach"
  // not "teacher"), and only if the remaining stem is >=4 chars.
  //
  // Two small guards on top of the length rule, both needed to keep short
  // domain words intact (spot-checked: "class"/"gender"/"rank"/"average"
  // must all come out unchanged):
  //  - doubled-letter guard: don't strip a single-char "s" suffix if the
  //    letter before it is also "s" ("class"/"glass"/"process" have a
  //    genuine double-s ending, not an added plural "s").
  //  - silent-e restore: stripping "ing"/"ed" from a word that dropped a
  //    silent e to take the suffix ("score"+"ing" -> "scoring") needs the
  //    "e" put back so "scoring" and "score" collapse to the same stem —
  //    classic single-syllable CVC (consonant-vowel-consonant, last
  //    consonant not w/x/y) heuristic, same one Porter's algorithm uses
  //    for this exact case.
  //  - DOMAIN_STEM_EXCEPTIONS: a short explicit list for the rare word
  //    that looks like suffix+root but isn't ("gender" ends in "er" but
  //    isn't a comparative of "gend") — cheaper and safer than a general
  //    rule that would risk under- or over-stemming everything else.
  const STEM_SUFFIXES = ["ing","ers","ness","est","er","ed","es","s"];
  const DOMAIN_STEM_EXCEPTIONS = new Set(["gender"]);
  function isVowel(c){ return c==="a"||c==="e"||c==="i"||c==="o"||c==="u"; }
  function looksLikeSilentEDrop(s){
    if(s.length<3) return false;
    const c1=s[s.length-1], c2=s[s.length-2], c3=s[s.length-3];
    return !isVowel(c1) && isVowel(c2) && !isVowel(c3) && c1!=="w" && c1!=="x" && c1!=="y";
  }
  function stem(t){
    if(DOMAIN_STEM_EXCEPTIONS.has(t)) return t;
    for(let i=0;i<STEM_SUFFIXES.length;i++){
      const suf = STEM_SUFFIXES[i];
      if(t.length > suf.length && t.slice(-suf.length) === suf){
        if(suf==="s" && t[t.length-2]===t[t.length-1]) continue; // doubled-letter guard, e.g. "class"
        let stripped = t.slice(0, -suf.length);
        if((suf==="ing"||suf==="ed") && looksLikeSilentEDrop(stripped)) stripped += "e";
        if(stripped.length >= 4) return stripped;
      }
    }
    return t;
  }

  function isOutOfDomain(queryTokens){
    if(!_bank || !Array.isArray(_bank.domainVocabulary) || !_bank.domainVocabulary.length) return false;
    // BUG FIX (report: "english topper"/"maths topper" hit the flat
    // deflection wall even though "topper" is literally in
    // domainVocabulary): queryTokens here are already stemmed (tokenize()
    // stems every token — "topper" -> "topp"), but this vocab set was
    // built straight off the raw domainVocabulary strings ("topper"
    // unstemmed), so "topp" never matched the literal "topper" entry and
    // every query containing a stem-strippable domain word (any word
    // ending in "er"/"ing"/"s"/etc — "toppers", "scoring", "students"...)
    // was wrongly treated as out-of-domain. Run each vocab word through
    // the same tokenize() pipeline the query already went through so both
    // sides of the comparison are in the same (stemmed) space. A prior fix
    // attempt (see the comment in match() above, near "topper got the
    // same flat wall as gibberish") added the soft-suggestion path but
    // missed that isOutOfDomain() itself was still the thing returning the
    // wrong answer, so it never got a chance to run.
    const vocab = new Set(_bank.domainVocabulary.flatMap(v => tokenize(v)));
    return !queryTokens.some(t => vocab.has(t));
  }

  // FIX (report: chat only ever surfaces class-wide questions, never
  // student ones — "should be all mix"): institution mode has many
  // students, so there's no single "the student" the way individual mode
  // has APP.students[0] — this scans the query text itself for a name.
  // Matches on any single name-token (first or last name) at least 3
  // chars long, so "Priya" or "Sharma" both work; picks the longest
  // matching token if more than one student's name appears, since a
  // longer/more specific name match is less likely to be a coincidence.
  function resolveStudentByName(queryTokens){
    if(!window.APP || !APP.students || !APP.students.length) return null;
    let best = null, bestLen = 0;
    APP.students.forEach(function(s){
      if(!s || !s.name) return;
      tokenize(s.name).forEach(function(nt){
        if(nt.length >= 3 && nt.length > bestLen && queryTokens.indexOf(nt) !== -1){
          best = s; bestLen = nt.length;
        }
      });
    });
    return best;
  }

  // Iterative Levenshtein edit distance (not recursive, no library) — used
  // only as a typo-tolerant fallback in match()'s scoring loop below, not
  // in isOutOfDomain() (that vocabulary list is long; fuzzy-matching it on
  // every query token would be needlessly expensive for little benefit).
  function levenshtein(a, b){
    const m = a.length, n = b.length;
    if(m===0) return n;
    if(n===0) return m;
    let prev = new Array(n+1);
    let curr = new Array(n+1);
    for(let j=0;j<=n;j++) prev[j] = j;
    for(let i=1;i<=m;i++){
      curr[0] = i;
      for(let j=1;j<=n;j++){
        const cost = a[i-1]===b[j-1] ? 0 : 1;
        curr[j] = Math.min(prev[j]+1, curr[j-1]+1, prev[j-1]+cost);
      }
      [prev,curr] = [curr,prev];
    }
    return prev[n];
  }
  // Typo-tolerant token match: only invoked once the exact indexOf() check
  // has already missed, and only for query tokens >=5 chars (short words
  // are cheap to typo into an unrelated real word, so fuzzy-matching them
  // would produce false positives — "of"/"the" etc must never fuzzy-hit).
  // Tighter distance-1 threshold under 7 chars, distance-2 at 7+ — a
  // 2-edit gap on a 5-char word is nearly a different word, but on a
  // longer word ("attandance" vs "attendance", 1 edit; "perfomance" vs
  // "performance", 1 edit) 2 edits still reads as clearly-the-same-word.
  function fuzzyIncludes(token, candidateTokens){
    if(token.length < 5) return false;
    const threshold = token.length < 7 ? 1 : 2;
    for(let i=0;i<candidateTokens.length;i++){
      const c = candidateTokens[i];
      if(Math.abs(c.length - token.length) > threshold) continue; // cheap pre-filter
      if(levenshtein(token, c) <= threshold) return true;
    }
    return false;
  }

  function match(queryText, limit){
    limit = limit || 5;
    if(!_bank) return { ok:false, results:[], deflected:false, text:srT("smart_question_bank_not_loaded") };
    const qTokens = tokenize(queryText);
    if(!qTokens.length) return { ok:false, results:[], deflected:false, text:"" };

    // FIX (report: chat only ever surfaces class-wide questions, never
    // student ones): availableQuestions() alone never includes per_student
    // questions in institution mode (its "selectedStudent" requires guard
    // only ever passes in individual mode — that's correct for the
    // canned/left-rail list, which has no query text to find a name in).
    // Here, where there IS query text, a named student widens the
    // candidate pool to include per_student questions too, so "how is
    // Priya doing" can actually match one instead of being invisible to
    // the scorer entirely. _lastMatchedStudent is read straight back by
    // answerQuestionImpl() right after this returns (same synchronous
    // call chain in smartChatRunQuery — see its module-state comment).
    const namedStudent = currentMode()==="institution" ? resolveStudentByName(qTokens) : null;
    _lastMatchedStudent = namedStudent;
    let candidates = availableQuestions();
    if(namedStudent){
      // Put per_student questions first — a query that named a student is
      // almost certainly about that student, so their questions should be
      // what gets suggested first, not buried after all the class-wide ones.
      candidates = flatQuestions().filter(q => q._categoryId==="per_student" && questionAiFeatureOk(q))
        .concat(candidates);
    }
    const scored = candidates.map(q => {
      const labelTokens = tokenize(q.label);
      const catTokens = tokenize(q._categoryLabel);
      const keywordTokens = tokenize((q.keywords||[]).join(" "));
      let score = 0;
      qTokens.forEach(t => {
        if(labelTokens.indexOf(t) !== -1) score += 3;
        else if(keywordTokens.indexOf(t) !== -1) score += 2;
        else if(catTokens.indexOf(t) !== -1) score += 1;
        // Typo fallback — only reached once every exact check above has
        // missed. Lower bonus than the exact-match tiers so a real match
        // always outranks a typo-match when both exist for the same
        // query (e.g. "attendance correlation" still beats "attandance
        // correlation" for the attendance_correlation question).
        else if(fuzzyIncludes(t, labelTokens)) score += 2;
        else if(fuzzyIncludes(t, keywordTokens)) score += 1;
      });
      // A named student is a strong signal the question is about THEM —
      // without this, a class-wide question that happens to share an
      // incidental keyword (e.g. "doing") can outscore the actual
      // per-student questions and auto-answer with something unrelated to
      // who was actually asked about. Only applied once real (non-zero)
      // topic overlap already exists, so this doesn't resurrect the
      // score:0 "no real overlap" case handled separately below.
      if(namedStudent && score>0 && q._categoryId==="per_student") score += 3;
      return { question: q, score };
    }).filter(r => r.score > 0);

    scored.sort((a,b) => b.score - a.score);
    const results = scored.slice(0, limit).map(r => ({
      id: r.question.id,
      label: r.question.label,
      category: r.question._categoryLabel,
      score: r.score
    }));

    // Only gate on domainVocabulary as a last resort, when scoring
    // (label + category + keywords) found literally nothing — a bare
    // vocabulary check ahead of scoring was blocking keyword-only
    // matches (e.g. "who is struggling" scores against wellbeing's
    // keywords but contains no literal domainVocabulary word) before
    // the scorer ever got to run.
    //
    // FIX (report: "topper" got the same flat wall as gibberish): this
    // comment already documented the intended behavior — isOutOfDomain()
    // exists below for exactly this — but the code here never actually
    // called it, so every zero-score query got the hard deflectionMessage
    // with no suggestions, even when the query used a real, recognized
    // word (like "topper", which is literally in domainVocabulary) that
    // just isn't in any single question's own keyword list. Now: a
    // recognized-but-unmatched word surfaces the current category's
    // question list as tappable suggestions (score:0, so the caller's
    // AUTO_ANSWER_THRESHOLD check naturally routes it to the suggestion
    // chips, not an auto-answer) instead of a dead end; true gibberish
    // (no domain word at all) still gets the flat deflection.
    if(!results.length){
      // A named student counts as "on-topic" even if isOutOfDomain()
      // wouldn't otherwise recognize the rest of the sentence (a name
      // isn't in domainVocabulary) — "how is Priya doing" should offer
      // Priya's questions as suggestions, not hit the flat gibberish wall.
      if((namedStudent || !isOutOfDomain(qTokens)) && candidates.length){
        return {
          ok:true,
          results: candidates.slice(0,limit).map(q => ({ id:q.id, label:q.label, category:q._categoryLabel, score:0 })),
          deflected:false,
          text:""
        };
      }
      return { ok:false, results:[], deflected:true, text: _bank.deflectionMessage || "That's outside what I can help with." };
    }
    return { ok:true, results, deflected:false, text:"" };
  }

  /* ── Combined ask(): match then answer the top hit. Callers that want
     to show a disambiguation list (multiple plausible matches) should
     use match() directly and call answerQuestion(id) once the user
     picks one, rather than always taking the top-1 result via ask(). ── */
  // Same confidence bar render-buckets.js's smartChatRunQuery() applies to
  // match() results before auto-answering — kept in sync manually since
  // the two call sites live in different modules; a score below this means
  // "worth surfacing as a suggestion", not "confident enough to answer".
  const AUTO_ANSWER_THRESHOLD = 6;
  function ask(queryText){
    const m = match(queryText, 1);
    // FIX: match() can now return ok:true with a score:0 "here are some
    // things you can ask" fallback list (recognized domain vocabulary,
    // no keyword hit — see match() above) instead of a real match. Before
    // this check, ask() took m.results[0] unconditionally whenever ok was
    // true, so a query like "topper" would silently auto-answer with
    // whatever question happened to be first in the list, mislabeled as
    // a confident match.
    if(!m.ok || !m.results.length || m.results[0].score < AUTO_ANSWER_THRESHOLD){
      return { ok:false, text: m.text || "I couldn't find a matching question — try rephrasing, or pick one from the list.", matched:null };
    }
    const top = m.results[0];
    const answer = answerQuestion(top.id);
    return { ok: answer.ok, text: answer.text, matched: top };
  }

  function answerQuestion(questionId){
    const q = flatQuestions().find(x => x.id === questionId);
    const r = answerQuestionImpl(questionId);
    window.SIA_DEBUG_LOG("SmartQueryV2:"+questionId, {computeKey: q&&q.computeKey, value: q&&resolveComputeKey(q.computeKey)}, r);
    return r;
  }

  return {
    load,
    isReady,
    availableQuestions,
    answerQuestion,
    match,
    ask,
    // exposed for debugging / future UI layers, not part of the stable
    // "ask a question" contract above
    _resolveComputeKey: resolveComputeKey,
    _flatQuestions: flatQuestions
  };

})();

if(typeof window !== "undefined") window.SmartQueryV2 = SmartQueryV2;


// --- ES module exports (added for module-system conversion, HANDOVER #4) ---
export { SmartQueryV2 };

// Legacy-global compatibility shim: modules don't leak top-level
// declarations onto window the way classic scripts did. The handful of
// inline onkeydown=/oninput=/onchange= attributes intentionally left as-is
// (out of scope for HANDOVER #3 — only onclick was converted) still need a
// bare global to resolve, so every exported name is also mirrored onto
// window here. Harmless duplication for anything already imported properly.
if(typeof window!=='undefined'){window.SmartQueryV2=SmartQueryV2;}
