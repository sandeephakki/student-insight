/* ════ SMART SEARCH UI (Phase 2, v2) ════
   Full-screen replace pattern, matching #bucket-answer-screen (Screen C)
   exactly — same back-button style, same title style, same row style
   (.bucket-back-btn/.bucket-list-title/.bucket-row classes reused, not
   duplicated) — so Dashboard <-> Smart Search feels like one consistent
   surface, not two different UIs bolted together (per explicit design
   direction: "same theme, flawless, smooth transition").

   Entry point: persistent "Smart Search" button, visible in every
   Dashboard mode (bucket view, legacy/tile view, compare view) — see
   index.html #btn-open-smart-search, placed above the mode branching so
   it's never hidden behind either view.

   All data/logic still lives in js/smart-engine.js — this file is DOM
   only. Chip disabling: AI-feature-gated questions show as visibly
   disabled with a hover tooltip ("AI feature — coming soon") rather than
   being tappable and explaining after the fact, or hidden entirely —
   per explicit direction. ════ */

let _smartEngineLoaded = false;
let _smartCategory = "class_management";
let _smartReturnTo = "bucket"; // "bucket" | "legacy" — which screen to restore on close

function openSmartSearchScreen(){
  _smartReturnTo = $("#legacy-dashboard-body").is(":visible") ? "legacy" : "bucket";
  $("#bucket-screen,#bucket-list-screen,#bucket-answer-screen,#legacy-dashboard-body").hide();
  showScreen("#smart-search-screen");
  renderSmartSearchScreen();
}

function closeSmartSearchScreen(){
  $("#smart-search-screen").hide();
  if(_smartReturnTo==="legacy"){ showScreen("#legacy-dashboard-body"); }
  else { showScreen("#bucket-screen"); }
}

function renderSmartSearchScreen(){
  const shell = $("#smart-search-screen");
  shell.html(`
    <button class="bucket-back-btn" onclick="closeSmartSearchScreen()" aria-label="${esc(srT('smart_search_back'))}">
      <svg class="ic" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="margin-right:6px"><path d="m15 18-6-6 6-6"/></svg>
      ${esc(srT('smart_search_back'))}
    </button>
    <div class="bucket-list-title">${esc(srT('smart_search_title'))}</div>
    <div class="shell-empty-state" style="padding:48px 20px;text-align:center;font-size:14px" data-i18n="smart_search_pro_notice">${esc(srT('smart_search_pro_notice'))}</div>
  `);
}

function renderSmartCategorySwitch(){
  const cats = SmartEngine.availableCategories();
  const wrap = $("#smart-category-switch").empty();
  if(cats.length<=1){ wrap.hide(); return; }
  wrap.show();
  cats.forEach(cat=>{
    const btn = $(`<button class="btn btn-sm ${cat.id===_smartCategory?'btn-primary':'btn-secondary'}">${esc(cat.label)}</button>`);
    btn.on("click", ()=>{ _smartCategory = cat.id; renderSmartCategorySwitch(); renderSmartChips(); });
    wrap.append(btn);
  });
}

function renderSmartStudentPicker(){
  const picker = $("#smart-student-picker").empty();
  if(_smartCategory!=="per_student"){ picker.hide(); return; }
  picker.show();
  const students = APP.students||[];
  if(APP.setup.mode==="individual" && students.length===1){
    APP._smartSelectedStudentId = students[0].id;
    picker.hide();
    return;
  }
  const select = $(`<select class="input" style="max-width:280px"><option value="">${esc(srT('smart_search_select_student'))}</option></select>`);
  students.forEach(st=> select.append(`<option value="${esc(st.id)}">${esc(st.name)}</option>`));
  select.val(APP._smartSelectedStudentId||"");
  select.on("change", function(){ APP._smartSelectedStudentId = $(this).val(); renderSmartChips(); });
  picker.append(`<label style="font-size:12.5px;color:var(--c-text2);display:block;margin-bottom:4px">${esc(srT('smart_search_student_label'))}</label>`).append(select);
}

function currentSmartStudent(){
  const id = APP._smartSelectedStudentId;
  if(!id) return (APP.setup.mode==="individual" && APP.students.length===1) ? APP.students[0] : null;
  return (APP.students||[]).find(st=>st.id===id) || null;
}

function isQuestionDisabled(q){
  if(!q.requiresAIFeature) return false;
  return !APP.aiFeatures.has(q.requiresAIFeature);
}

function renderSmartChips(){
  renderSmartStudentPicker();
  const kn = SmartEngine.getKnowledgeSync();
  const cat = kn.categories.find(c=>c.id===_smartCategory);
  const chipsWrap = $("#smart-question-chips").empty();
  if(!cat) return;
  const student = currentSmartStudent();
  let rendered = 0;
  cat.questions.forEach(q=>{
    if(q.minStudents && APP.students.length < q.minStudents) return;
    rendered++;
    const disabled = isQuestionDisabled(q);
    const row = $(`<div id="smart-chip-${esc(q.id)}" class="bucket-row smart-chip-row" role="button" tabindex="${disabled?-1:0}" aria-disabled="${disabled}" title="${disabled?esc(srT('smart_search_ai_tooltip')):''}" style="${disabled?'opacity:.5;cursor:not-allowed':''}">
      <span class="bucket-text"><span class="bucket-label">${esc(q.label)}</span></span>
      ${disabled?`<span class="bucket-badge" style="background:var(--c-surface2);color:var(--c-text2)">${esc(srT('smart_search_coming_soon'))}</span>`:''}
    </div>`);
    const body = $(`<div id="smart-ans-${esc(q.id)}" class="smart-ans-body" style="display:none"></div>`);
    if(!disabled){
      row.on("click", ()=>{
        if(_smartCategory==="per_student" && !student){ toast(srT('smart_search_select_first'),"warn"); return; }
        const result = SmartEngine.ask(q.id, {student});
        toggleSmartAnswer(q.id, q.label, result);
      });
      row.on("keydown", e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); row.click(); } });
    }
    chipsWrap.append(row).append(body);
  });
  if(!rendered){
    chipsWrap.html(emptyStateHtml(srT('smart_search_empty_title'), srT('smart_search_empty_sub')));
  }
}

// BUG 5 FIX (studin-ui-bugs-prompt v1.0): answers now expand inline directly
// below the clicked chip instead of appending to a bottom wrap the user had
// to scroll to find. Only one answer open at a time, matching the FAQ
// <details> UX. Reuses the same open/close toggle pattern used elsewhere
// for accordions (close all, then open the clicked one if it wasn't already
// open).
function toggleSmartAnswer(qId, questionLabel, result){
  const allBodies = document.querySelectorAll(".smart-ans-body");
  const allChips  = document.querySelectorAll(".smart-chip-row");
  const thisBody  = document.getElementById("smart-ans-" + qId);
  const isOpen    = thisBody && thisBody.style.display !== "none";
  allBodies.forEach(b => b.style.display = "none");
  allChips.forEach(c => c.classList.remove("smart-chip-open"));
  if(!isOpen && thisBody){
    thisBody.innerHTML = `<div class="smart-ans-content">${esc(result.text)}</div>`;
    thisBody.style.display = "block";
    document.getElementById("smart-chip-" + qId)?.classList.add("smart-chip-open");
  }
}
