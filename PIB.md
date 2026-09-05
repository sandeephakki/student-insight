# StudIn PIB (Project Intelligence Block)

AI-reference index for this repo, extracted from index.html (P3 #17 —
was inline as a ~1300-line HTML comment). Same append-only rules apply:
after every fix/feature/schema change, update only the lines that
changed; §9 Gotchas and §12 Changelog are append-only, new line, never
delete.

```
════════════════════════════════════════════════════════════════════════
 STUDENT INSIGHT — PIB (Project Intelligence Block)            v3.7
 AI-reference index, NOT human onboarding doc. Numbered sections for
 fast lookup (format borrowed from a sister project, Spend-na, which
 organizes this better than the old prose-block layout did).

 SELF-UPDATE RULE: after every fix/feature/schema change, update ONLY
 the lines that changed. Do not rewrite untouched sections. Gotchas
 (§9) and Changelog (§12) are append-only — new line, never delete.
════════════════════════════════════════════════════════════════════════

1. IDENTITY
   APP        Student Insight
   VERSION    v3.7
   FILE       index.html — single-file, no build step
   HOST       GitHub Pages (sandeephakki/student-insight)
   WHAT       Teacher/institution fills an Excel workbook -> app
              produces analytics dashboard + per-student narrative
              reports + exportable PDFs.

════════════════════════════════════════════════════════════════════════

2. HARD CONSTRAINTS
   Violation of any breaks the app's stated privacy/architecture promise.

   NO_PERSISTENCE   No localStorage/server storage of student data —
                     deliberate, not a gap (this is the opposite of a
                     typical app's storage layer; don't "fix" it by
                     adding one). APP object only, page-memory, session
                     lifetime. INIT wipes legacy keys ("sia_sessions",
                     "sia_auth","sia_gs_url") on every load. saveSession()
                     = Ctrl+S toast only ("your Excel file IS the save").
   SPLIT_STATIC     (v3.8, replaces old SINGLE_FILE rule) App is now split
                     into clean static files: index.html (shell/markup) +
                     css/core.css + 7 concern-based JS modules in js/
                     (state-nav, project-setup, template-upload,
                     compute-engine, render-dashboard, export-pdf,
                     app-utils-init — split at the code's own pre-existing
                     ════ section markers, load order preserved exactly),
                     plus i18n/ and knowledge/ folders added for Phase
                     3/Smart Engine. All 7 JS files share one global scope
                     (plain <script src>, not modules) — same as the old
                     single inline <script> block; only file organization
                     changed, not execution behavior. Original monolith
                     kept as js/_app.js.full.bak (NOT loaded by index.html)
                     as a reference/rollback copy — safe to delete once
                     the split version is verified working in-browser.
                     Still NO build step — GitHub Pages serves these as
                     plain static files; <link>/<script src>/fetch() only,
                     no bundler/transpiler. Core css/js load eagerly at
                     page start (same load-order guarantee as before).
                     i18n language files and Smart Engine's knowledge/
                     question bank are lazy-loaded on demand only, to
                     protect low-end/slow-connection devices.
   NO_BUILD         No webpack/vite/npm/node.
   EXPORT_GATE      Export fully blocked (button+step+generateAllPDFs()
                     self-guard) while APP.dataIssues.length>0. Re-
                     derived by updateExportGate() at top of every
                     renderDashboard() call — not cached. Any new data-
                     quality check must push into this SAME array to
                     inherit the gate + banner + flag for free.
   RANKING          Dense/competition rank (ties share rank, next skips
                     by tie count), never plain i+1.
   MARK_OVERFLOW    Entered value > subject max: kept verbatim in
                     dataIssues for transparency, but its contribution
                     to totals/averages is capped at max
                     (Math.min(mv,mx)) — averages must never read
                     >100% from this cause.
   GROWTH_CLAMP     growthRate ((last-first)/max(first,1)*100) clamped
                     to [-300,300] — guards near-zero `first` producing
                     e.g. +5000%.
   XSS              esc() (~3454) required for ANY user/workbook string
                     going into innerHTML/template strings. toast(msg)
                     does NOT escape internally — caller's job.
   FROZEN_KEYS      Never rename without updating every read site:
                     student.id · student.name · testData[test].marks
                     · testData[test].absents · testData[test].remark
                     · subjects[] · tests[].name · analysis.overallAvg
                     · analysis.rank
   CASE_INSENSITIVE Subject/test name dedup is case-insensitive
                     (subjectAvgs is keyed by name — "Maths"/"maths"
                     would silently collide otherwise).
   NAME_SEPARATORS  "Update Existing Sheet" test-name matching
                     tolerates both hyphen and em-dash separators
                     ("<Test> - " / "<Test> — ") in real-world files.
   BROAD_WEAKNESS   weakestSubjectsInfo() "broad" flag: when >=60% of
                     subjects tie for the class minimum (student
                     struggling evenly, not one weak spot), narrative
                     generators must say so honestly rather than naming
                     every subject as if it were a targeted shortlist
                     (see §7 NARRATIVES).

════════════════════════════════════════════════════════════════════════

3. TECH
   jQuery 3.7.1 (SRI-pinned) · xlsx-js-style 1.2.0 [xlsx.bundle.js —
   SheetJS 0.18.5 core + cell-style WRITE support, used in
   generateTemplate() header styling] · jsPDF 2.5.1 · JSZip 3.10.1 ·
   Chart.js 4.4.1. All CDN, no build step, no React/Vue. jQuery,
   xlsx-js-style, jsPDF and JSZip are SRI-pinned (hashes verified
   against each package's exact npm-published dist file — see PIB
   TECH note below). Chart.js is the one exception: cdnjs serves an
   independently-minified chart.umd.min.js with no byte-identical
   artifact in the npm package to verify a hash against safely, so
   pinning it here risked shipping a wrong hash (script silently
   fails to load) rather than actually fixing anything — left
   unpinned on purpose until someone can confirm the correct hash
   from cdnjs directly (e.g. https://cdnjs.com/libraries/Chart.js).
   Service worker path + manifest.json <link> are both env-aware (root
   vs "/student-insight/" subpath, via location.pathname), skipped
   entirely under file:// protocol.

════════════════════════════════════════════════════════════════════════

4. DATA SCHEMA

   APP = { setup:{instName,instType,location,contact,className,section,
             year,teacher, scoring:{marks,pct,grade,pf}, passThreshold,
             absentAlert,dropAlert, subjects:[str], tests:[{name,date,
             maxMarks?}]},
           rawData: null|{"MARKS+CONTEXT":[...], "_hdr_<SHEET>":[...] },
             // _hdr_ = raw header row verbatim incl. duplicate column
             // names — Object.keys() can't show dupes, needed for
             // grouped-header (per-test subject columns) disambiguation
             // by column POSITION, see parseStudents() isGrouped/posMap.
           students:[], classStats:null (always {} not null when 0
             valid students — never a stale prior-run value),
           genderAnalysis:null (only computed if 'diversity_analysis'
             selected AND >=2 groups meet MIN_GENDER_GROUP_SIZE),
           filter:"all", sort:"rank", aiFeatures:Set,
           dataIssues:[] (see §2 EXPORT_GATE),
           compareMode:false, sections:[], sectionComparison:[],
           mergeMode:false, mergeSource:null, _pendingMerge:null }
   startNewSession()/goStep('home') reset both duplicate this literal
   shape — keep in sync if it changes; both also clear
   #session-name-badge.

   student = { id,name, gender?/dob?/contact?/address?(LEGACY-IMPORT
               ONLY, generateTemplate() no longer emits these columns),
     testData:{[test]:{marks:{[subj]:num},absents,remark}},
     analysis:{ overallAvg,testAvgs:[],grade,trend,percentile,rank,
       topperGap, subjectAvgs:{},strongSubject,weakSubject, stressScore,
       wellbeingFlag,healthScore,healthBand, consistencyScore,growthRate,
       cumulativeAvg, burnoutRisk,resilient,engagementIndex, plateau,
       earlyWarningScore,competitiveReadiness, predictedNext,
       missingSubjects,hasDataGaps, explainedWarnings:[{...flag,reason}],
       bestTest,worstTest:{name,pct}, subjectDeltas:{subj:signedPts},
       rankMovement, cumAvgByTest:[],
       parentMessage,trendFacts,homePlan,schoolPlan,strengthsLetter },
               // ^redesigned v1.9 — see §7 NARRATIVES
     flags:[{type,label,color}] }

   SAFE READ PATTERNS (use these exact forms — copy-paste, not prose):
     t.marks[subj]     -> (v!==undefined&&v!==null&&v!=="") ? v : null
     st.flags          -> st.flags || []
     a.subjectAvgs      -> Object.entries(a.subjectAvgs||{})
     a.percentile       -> only render if APP.students.length>=12
                            (see §2/marks-table note in §7)
     t.maxMarks[subj]   -> (t.maxMarks && t.maxMarks[subj]) || 100
     a.homePlan/schoolPlan/strengthsLetter -> may be null (intentional
                            omission, not a bug) — check truthy before
                            rendering a card for it.

════════════════════════════════════════════════════════════════════════

5. FEATURE FLAGS — AI_FEATURES catalogue (~2069)
   5 categories (perf/warn/narr/well/mgmt), declarative {id,label,sub}
   list — ASPIRATIONAL, not 1:1 implemented. Real gates: diversity_
   analysis only (gates computeGenderAnalysis()). computeAnalysis()
   does not currently read APP.aiFeatures for anything else — most
   metrics run unconditionally regardless of checkbox state. Before
   adding a new id, decide cosmetic-doc vs real-gate explicitly.

════════════════════════════════════════════════════════════════════════

6. SCREENS
   NAVIGATE: goStep(step) 2136 — nav/panel switch; calls
     collectSetupForm() on entering "data" EXCEPT when APP.compareMode
     (would wipe adopted schema — see §7 Compare Mode entry).

   PANEL ID            STEP LABEL     RENDER / NOTES
   panel-home           Home          renderHomePage() — also the only
                                        upload surface now (v3.1, Upload
                                        Data panel removed — see §9)
   panel-setup           Setup         collectSetupForm() on exit
   panel-ai              AI Analysis   runAnalysis() orchestrator
   panel-dashboard        Dashboard     renderBuckets() (v2.3 default entry,
                                        Institution+non-Compare only) or
                                        renderDashboard() (Compare/
                                        Individual mode, and reachable
                                        inside renderBuckets() as its
                                        fallback) — see §7 SMART REVEAL
   panel-export           Export        generateAllPDFs() entry point
   panel-about             About         toggleTrust() privacy accordion
   panel-faq               FAQ           static content

   unlockStep/lockStep(s) — mirror pair; lockStep re-locks Dashboard/
     Export when underlying data changes post-analysis.

════════════════════════════════════════════════════════════════════════

6a. APP SHELL (vs-shell-plan-v2.md — supersedes the v4.7 shell scrapped
    in Task 2; see §9 shell-scrapped-not-refactored)
   Files: css/vs-shell.css, js/vs-shell.js. #app-shell-body (persists
     across all 7 panels — never torn down on goStep()) is a 5-column
     grid: panel-start | 6px divider | core (#main) | 6px divider |
     panel-end, plus a full-width breadcrumb row (#shell-breadcrumb,
     currently unpopulated — no owner yet, see §10).
   Contract: setLeftRail(html) / setRightRail(html) (global fns,
     js/vs-shell.js) — same names/signatures the old app-shell.js used,
     write into #shell-rail-start / #shell-rail-end respectively. Call
     these from panel render functions to populate the side panels.
     Left panel (Task 4, done): renderShellLeftRail(step), hooked once
     inside goStep() (single choke point for all 7 panels, plus boot's
     goStep("home")) and again in reapplyI18nStrings() (JS-injected
     innerHTML, same reason renderAICheckboxes() needs re-firing on a
     language switch). Setup/AI/Dashboard/Export show file/org/records
     key-value rows (APP.setup.instName, APP.students.length,
     APP.homeSingleFile/APP.sections for single-vs-multi-file); Home/
     About/FAQ show the empty state; Dashboard adds the class/section
     row. Live two-way sync while typing in Setup's form is NOT wired —
     the rail only refreshes on navigation/language-switch, see §9.
     Right panel (Task 5, done — non-Dashboard phases): renderShellRightRail(step),
     hooked at the same choke points as the left rail, plus three extra
     ones for state that changes mid-panel: swGoto() (setup step),
     updateAICount() (AI feature count), updateExportGate() (export
     gate, re-derived not cached — same EXPORT_GATE rule as elsewhere).
     Home: Try Sample/Build Template/Sample Files links. Setup: step
     progress + Download Template. AI: selected-features count only —
     no Continue button, see §9. Export: ready/blocked status + ZIP
     button, gated on APP.dataIssues exactly like the core Export panel.
     About/FAQ: Sample Files + Home links. Dashboard (Task 6, done):
     renderShellDashboardRail() — input (voice/mic removed app-wide, see
     prompt-v4.19 §1g) + Ask button,
     suggestion chips from SmartQueryV2.availableQuestions(), answers
     appended as cards in a scrollable thread, legacy Smart Search link
     (openSmartSearchScreen()) and Compare-students link
     (openBucket('compare'), institution mode only). Built against
     SmartQueryV2's REAL shipped API (load/isReady/availableQuestions/
     answerQuestion/match/ask) — NOT composeVerdict()/suggest()/
     matchAndAnswer(), which both planning docs describe but which do
     not exist anywhere in this repo. See §9 GOTCHAS for the full
     deviation list (also: no fuse.min.js needed, and two of §4.3's six
     i18n keys deliberately not added).
   Resize: pointer-drag on #shell-divider-start/#shell-divider-end
     (also ArrowLeft/ArrowRight when focused, role="separator"), clamped
     160-420px, written to --panel-start-width/--panel-end-width custom
     properties on #app-shell-body. Backing state is APP.shellState
     (js/vs-shell.js — Task 7, in-memory only, NO_PERSISTENCE), survives
     Home->Setup->Dashboard navigation since #app-shell-body is never
     torn down.
   Collapse: chevron button per panel (vsShellToggle("start"|"end")),
     hides .shell-panel-content, shrinks that column to 28px.
   RTL: grid columns mirror via dir="rtl" on #app-shell-body itself
     (set in reapplyI18nStrings(), js/render-dashboard.js — attribute
     only, NOT the .rtl-screen class, which sets text-align:right and
     would wrongly flip the still-English-layout panel content nested
     inside). Content-level RTL is still scoped to the same elements as
     before (§9 note above this one) — Task 8 does the full audit.
   Mobile (<=768px, Task 8, done): #shell-panel-start becomes a fixed
     top strip under the header (36px collapsed, up to 70vh expanded,
     downward); #shell-panel-end becomes a fixed bottom sheet (36px
     collapsed pill, up to 70vh expanded, upward). Same DOM/JS as
     desktop — vsShellToggle()/data-collapsed — only the CSS meaning of
     "collapsed" changes (strip vs 28px column). Panels default
     collapsed on first load at this breakpoint (checked once at boot
     via window.innerWidth) so the sheet doesn't cover the screen;
     desktop's default (expanded) is unchanged. Dividers hidden (no
     resize on touch). Header (#topbar selects) not reworked for
     mobile — see §10.
   Viewport fit (>768px only): #main is the only scrolling region.
     header/#stepper stay position:fixed, unchanged; #app-shell-body's
     height now also subtracts a reserved --footer-h so header + shell +
     footer sum to exactly 100dvh — no page-level scrollbar. Below
     768px this is skipped; the mobile fallback keeps natural page scroll.

════════════════════════════════════════════════════════════════════════

6b. DASHBOARD IDE REDESIGN (ui-prompt-template.md §4 items 1-8 — Home
    rail content + Dashboard "Smart Reveal" redesign; supersedes the
    screen-based bucket UI §6a/Task 6 originally shipped it with)
   Home rail (items 1-6): rail toggle buttons now carry a visible
     "Features"/"Properties" label (shell_rail_features_title/
     shell_rail_properties_title) — confirmed not swapped: left =
     Features (below Home), right = Properties (below FAQ). Both rails
     get real content the moment vs-shell.js loads (item 2 fix — see
     §9). Home shows 6 pitch bullets each side instead of the old
     Try-Sample/Build-Template/Sample-Files buttons (removed — same
     actions already exist in #home-paths-grid, nothing lost). Setup/
     AI/Dashboard/Export's key-value rows are now wrapped in a
     collapsed-by-default <details>"File details" section (item 6).
   Dashboard (item 7): Institution + non-Compare mode only (PIB §9
     smart-reveal-scope, unchanged) is now fully rail-driven and
     in-place — no more screen-hopping. #bucket-screen/#bucket-list-
     screen are retired for this mode (left permanently empty/hidden,
     not deleted — Individual mode's renderIndividualBuckets() still
     uses #bucket-screen). #bucket-answer-screen is the single,
     always-visible center container.
     Left rail: buildDashboardControlsHtml() (render-dashboard.js) —
       same control list the old #bucket-screen card grid had (class/
       student/subject/help/top/compare/clusters), reusing the exact
       same .bucket-row/.bucket-list CSS (already a vertical stack,
       needed zero new CSS to fit the narrower rail), plus a new
       "Smart Search" control (item g) and an active-row highlight
       (.bucket-row-active) for whichever control is selected. Appended
       after File details in renderShellLeftRail() for this mode only.
     Right rail ("Properties" of the selected control): owned entirely
       by whichever function openBucket(id) dispatches to, NOT by
       js/vs-shell.js's renderShellRightRail() (which now no-ops for
       step==="dashboard" — see §9). class/top/compare/clusters clear
       it (item a/e — no properties); student/subject/help/smart set
       it to a live-filter search + scrollable list (item c/d/g),
       reusing the pre-existing filterPickerList()/.bucket-picker-*
       CSS unchanged. student/subject/help auto-select and show their
       first match with no click required (item c/d); "top" and
       "clusters" keep their existing list rendered directly in the
       center panel instead (item e — deliberately NOT a picker).
     Smart Search (item g/h, OPEN QUESTION confirmed: one merged
       list): renderDashboardSmartSearch()/onSmartQuestionPick(),
       built on SmartQueryV2's real API (load/isReady/
       availableQuestions/answerQuestion) — supersedes Task 6's
       chat-thread rail entirely, see §9.
     No back buttons/breadcrumbs anywhere in this flow (explicit DON'T
       in the spec) — backToBuckets()/backToBucketList()/breadcrumbHtml()/
       toggleHelpRow() are now dead code, left defined but uncalled.
     Classic Dashboard (item 8): #btn-classic-dashboard button in the
       actionbar calls the pre-existing showLegacyDashboard() — no new
       mechanism, reuses APP._forceLegacyView exactly as before.
       Selecting any rail control clears that flag again (openBucket()).
     Sample-data banner (item f): renderDashboardSampleBanner(), text
       only, no "Set Up My Own Class" button — populates a persistent
       #dashboard-sample-banner slot instead of being rebuilt inline
       inside the old #bucket-screen HTML.
     Bug fix (item b, found while implementing it): .phase-actionbar's
       sticky top:var(--content-top) predates #main becoming its own
       scroll container (Task 3) and left a stray ~96px gap before it
       stuck; changed to top:0. Affects Setup/Dashboard/Export alike
       (all three use .phase-actionbar).
   Export folding (ui-prompt-template.md §6, resolved via
     open-questions-resolved.md): the Export stepper item is display:none
     (not deleted) — goStep('export')/#panel-export are fully intact and
     still the mechanism underneath. Institution+non-Compare mode gets an
     "Export Reports" rail control (buildDashboardControlsHtml()) that
     calls goStep('export') directly, bypassing the "current control"
     state entirely (checked first in openBucket(), before
     APP._currentBucketId is touched — otherwise returning to Dashboard
     later would immediately re-trigger the navigation). Compare Mode
     gets its own two-item rail (buildCompareExportControlsHtml(),
     resolved: kept separate, not folded into one button) — both entries
     also just call goStep('export'), where the existing
     #compare-export-card/#compare-per-section-export-card are already
     shown via APP.compareMode (js/compute-engine.js, untouched). The
     4 export checkboxes stay in the DOM, checked, hidden — smallest-diff
     per the spec, so generateAllPDFs() needs zero changes.
     DELIBERATE DEVIATION from the literal spec (see §9
     dashboard-export-reuses-panel): the spec asked for the single-
     button experience to render inside #panel-dashboard itself; this
     instead reuses the existing #panel-export screen/panel wholesale.
     Documented tradeoff, not an oversight.

════════════════════════════════════════════════════════════════════════

6c. RAIL BEHAVIOR + EXPORT CHECKBOXES (ui-prompt-batch2.md items 1-2 —
    reverses parts of §6b/§6, see §9 for what specifically)
   Item 1 (shell open/close tied to dashboard mode, not step): both rails
     are a single "car-mirror" behavior keyed off APP._forceLegacyView,
     not step==="dashboard" (Classic and Smart share that step — see §9
     dashboard-mode-not-step). setShellRailsOpen(open) (js/vs-shell.js) —
     explicit set for both sides at once, reuses vsShellToggle()'s exact
     state/DOM/transition, doesn't replace it. Classic Dashboard
     (renderBuckets()'s APP._forceLegacyView branch): closes + clears
     both rails (setLeftRail("")/setRightRail("") — not just collapsed
     width, so stale content can't flash back on manual re-expand). Smart
     bucket dashboard (renderBuckets()'s Institution+non-Compare tail):
     opens both. Smart Search control specifically
     (renderDashboardSmartSearch()): re-opens too, even if manually
     collapsed while already in Smart mode — the "flagship" moment.
     Compare Mode and Individual mode: unaffected, unchanged from §6b/6c.
   Item 2 (Export Reports rail gets real checkboxes back): §6's "no
     choice" rule is superseded for the RIGHT RAIL only — the center-
     panel button and left-rail placement are unchanged. renderShellRightRail()'s
     step==="export" branch now renders a "Students" <details> (checkbox
     per student, class="exp-student-cb", Select All/Unselect All,
     default all checked) and a "Report Types" <details> (reuses
     #exp-teacher/#exp-mgmt/#exp-zip — MOVED here from the now-empty
     hidden card in #panel-export, not duplicated: duplicate IDs would
     have broken generateAllPDFs()'s $("#exp-teacher") lookups). #exp-student
     stays in the hidden card as the master "any student PDFs" gate,
     unchanged. Report Types omits Teacher/Management for Individual mode
     (baked into the rail HTML generation directly, since setRightRail()
     rebuilds it fresh every render — a jQuery .toggle() call, which is
     how project-setup.js used to do this against the old hidden card,
     wouldn't survive that rebuild).
     Per-student filtering in generateAllPDFs() (js/export-pdf.js) is
     genuinely NEW logic (confirmed via the spec's own open question,
     not a restoration) — selectedStudents reads .exp-student-cb:checked
     from the DOM, falls back to ALL students only if no such checkboxes
     exist at all (vs. found-but-none-checked, a real "export nobody"
     choice). "Compare" (mentioned in the spec's checklist alongside
     Teacher/Management/Zip) was NOT added — no existing wiring connects
     a comparison PDF to generateAllPDFs()'s ZIP output, and the spec
     doesn't specify what including it should actually generate; see §9.

════════════════════════════════════════════════════════════════════════

6d. STUDIN-PRO TIER GATE (§8 of ui-prompt-template.md + ui-prompt-
    batch2.md item 3 amendments) — IMPLEMENTED NOW, not "already done"
   §8 claimed this gate was already implemented directly (not staged as
     a request) — VERIFIED FALSE: grepped the repo for "STUDIN-PRO"
     before starting this work and got zero hits. Building it for real
     now, incorporating batch2's amendments directly into the first
     implementation rather than building the old version first — see §9
     studin-pro-was-never-built.
   Modal (openStudentModal(), js/render-dashboard.js): The Bottom Line,
     What's Changed, Strengths, At Home This Week, Teacher Remarks
     (per-test, remarkCardsHtml()) all wrapped in ${/* ... */ ""} —
     valid JS inside the template literal, evaluates to empty string,
     original code left inside the comment untouched. At School stays
     live (deliberate asymmetry, not an oversight).
   Student PDF (buildStudentPDF(), js/export-pdf.js): The Bottom Line,
     What's Changed, Strengths (batch2 reversal — §8 originally kept
     Strengths in the PDF only, now gated there too), At Home This Week,
     At School, and Chapters Covered (batch2 addition, never gated
     before) — all block-commented with STUDIN-PRO markers. Teacher
     Remarks (per-test) STAYS in the PDF — confirmed it's a real,
     separate section (~line 385) from the modal's version; §8's own
     table said "n/a, was never in the PDF" for this row, which batch2
     correctly flagged as a documentation error, now fixed here rather
     than left to repeat.
   PDF "Jump To" nav chips: "Messages" and "Plan" both commented out
     entirely (both chips' target sections are now fully gated — nothing
     left to link to). nav.messages/nav.studyPlan are simply never set
     now; the wire-up loop's `if(target)` guard already no-ops safely.

════════════════════════════════════════════════════════════════════════

7. FUNCTION INDEX (name — ~line — one-line purpose)
   generateTemplate() 2539 — fresh blank .xlsx (SETUP+MARKS+CONTEXT
     sheets) from current Setup form; branches to
     generateMergedTemplate() instead when APP.mergeMode.
   generateBulkSectionTemplates()/toggleBulkSectionsUI() (v4.37,
     js/template-upload.js) — "Generate/update multiple sections"
     checkbox (index.html Class/Batch step) branch of generateTemplate();
     one shared Setup form, one ZIP of N per-section .xlsx files. Fresh-
     creation only — see §10 NOT BUILT "BULK ACTIONS ON ALREADY-EXISTING
     FILES" for the separate, not-yet-built bulk-update counterpart.
   parseWorkbookSheets() 2791 / parseStudents() 3386 — import + per-
     student row parsing; isGrouped/posMap = grouped-header disambig
     (see §4 rawData._hdr_).
   autoInferSetup() 3141 — infers Setup from uploaded headers if unfilled.
   validateSetupData() 3013 (per-field errors/warnings used by Home import
     + runAnalysis()'s blocking-error check) / validateSetup() 5983 (a
     separate, stricter Setup-panel-only check — confirm which one a task
     means before editing, they are not interchangeable) / validateData()
     3347 — pre-analysis checks;
     validateSetup gates "Download Template" CTA + inline field errors;
     validateData gates runAnalysis() (blocking vs advisory).
   runAnalysis() 3277 — orchestrator: collect/infer setup -> default-
     select AI features -> validateData() -> perf-guard (>1500 rows =
     confirm(), >300 = toast; NOT actually chunked/async, just a
     warning) -> fake staged-progress UX -> parseStudents()+
     computeAnalysis() (real work, synchronous) -> unlock dashboard/
     export -> updateExportGate() -> goStep(dashboard).
   computeAnalysis() 3557 — per-student metric engine (grade/trend/
     sharp-drop/volatility/stress/consistency/burnout/resilience/
     engagement/health-score/plateau/early-warning/explainedWarnings).
   computeExtraInsights() 3728 / computeClassStats() 3766 — bestTest/
     worstTest, subjectDeltas, rankMovement (uses cumAvgByTest snapshot,
     NOT final overallAvg), attendanceCorrelation (needs >=2 students/
     group), subjectWeakness (class-wide, sorted worst-first).
   weakestSubjectsInfo(st) ~4600 — shared by generateTrendFacts()/
     generateHomePlan(); see §2 BROAD_WEAKNESS.
   generateParentMessage/generateTrendFacts/generateHomePlan/
     generateSchoolPlan/generateStrengthsLetter() — see NARRATIVES below.
   narrativeCard()/saveNarrativeField() — generic editable-textarea+Save
     builder used for all 5 narrative fields in the student modal;
     writes back to st.analysis[field] in-memory (picked up by
     buildStudentPDF on next export — same object reference).
   MANUAL-RUN FLOW (v3.0, reverses v2.4's auto-run) — panel-ai/#ai-loader
     is shown, but runAnalysis() is never called automatically anymore.
     A valid upload just unlocks steps and reveals the Home "Run
     Analysis" button (showHomeRunAnalysisButton()) — the person must
     click it to actually trigger runAnalysis()/runCompareAnalysisCore().
     This applies uniformly: afterImportSuccess() (single Home file) and
     afterAllCompareFilesLoaded() (2+ Home files) both stopped auto-
     calling runAnalysis(). v3.1: Setup's own Compare upload UI (and
     updateCompareContinueButton()) is gone entirely — Home is the only
     upload surface now (see HOME entry above).
   SMART REVEAL (v2.3) — presentation-layer only, no new analytics.
     renderBuckets() 4691 replaces renderDashboard() as the Dashboard
     step's default entry for Institution+non-Compare mode (falls
     through to renderDashboard() itself for Compare/Individual mode —
     see BUCKETS_SCOPE comment at the top of the module). Screen A
     (buckets, always visible) -> openBucket(id) -> Screen B
     (renderFilteredList()/renderStudentPicker()/renderSubjectPicker(),
     #bucket-list-screen) -> openFinding()/onBucketStudentPick()/
     onBucketSubjectPick() (Screen C, full-screen replace,
     #bucket-answer-screen, NOT a modal — see §9 gotcha). backToBuckets()
     always returns to Screen A; backToBucketList() (Screen C only)
     always returns to Screen B, never skips to A. bucketIsHelp()/
     bucketIsTop()/BUCKET_HELP_FLAG_TYPES/BUCKET_TOP_FLAG_TYPES define
     "non-trivial" per finding — reused verbatim from st.flags/
     st.analysis.explainedWarnings/APP.classStats, nothing recomputed.
     Data Error is deliberately excluded from Who Needs Help (stays in
     the existing EXPORT_GATE banner only — see §9). Top Performers
     cutoff = rank<=3 OR flags improving/resilient OR
     competitiveReadiness "High" OR rankMovement>0 (decided for the end
     user: a flat top-3 or percentile cutoff either breaks or feels
     arbitrary across the wide class-size range this app supports).
     srT(key,params,count)/SR_STRINGS_EN — i18n-discipline stub (Phase 5 of
     the BUILD spec done up-front, not retrofitted): every user-facing
     string in this module is a tag-key lookup already, only an English
     table is populated. The pre-existing #legacy-dashboard-body wrapper
     (renderDashboard() + all its sub-renders, compare/individual
     switchers) is untouched code, just hidden/shown as one block.
   renderDashboard() 4884 + renderKPIs/renderStudentCards/renderHeatmap/
     renderFlagsTable/renderWellbeingPanel/renderClassInsights(2827) —
     all read APP.students+APP.classStats. switchDbTab() controls tab
     visibility AND filter-bar visibility (Students/Heatmap tabs only).
   openStudentModal(id) — per-student detail view incl. marks table
     (Total=scored/max+opted count, Class Avg row if !isIndividual),
     percentile suppressed <12 students (false precision on a tiny
     class — shows rank + plain point-diff from class average instead).
   buildStudentPDF() 5364 / buildTeacherPDF() 5681 / buildMgmtPDF() 5795
     / exportComparisonReportPDF() 4391 — jsPDF builders; all share
     fitText()/addPDFHeader()/stampFooterAllPages() (footer+pagination,
     one place to change branding/link). All assume analysis already
     ran; none re-run it. generateAllPDFs() 5288 = entry point, guards
     0-students + dataIssues (defense in depth over the gate).
   loadMergeSourceFromArrayBuffer()/generateMergedTemplate()/
     confirmMergedDownload()/cancelMergeMode() — "Update Existing Sheet"
     additive-merge flow (add Test 2 without discarding Test 1 marks).
     Integrity self-check (row count, row length, byte-identical old
     cells) runs BEFORE any write; aborts with toast if it fails.
     KNOWN LIMITATION: can't add a new SUBJECT + new TEST in the same
     merge (columns would misalign) — needs its own path if ever asked.
   startCompareMode()/processCompareFile()/addCompareSection()/
     invalidateStaleComparison()/fingerprintRawData() — multi-file
     analysis path; called from Home's own drop zone (handleHome-
     ImportFiles) when 2+ files are dropped at once — no separate mode
     screen, Upload Data panel is gone (v3.1, BUILD spec §10.1/10.3).
     First valid file's own SETUP tab becomes the shared schema
     automatically; duplicate-file upload rejected by filename AND
     content fingerprint. startCompareMode() itself no longer navigates
     anywhere — it just resets state in the background while the person
     stays on Home. APP.compareMode is still used internally as a state
     flag distinguishing "1 file, APP.students direct" from "N files,
     APP.sections[] + dropdown" — NOT fully eliminated as BUILD spec
     §10.3 asked; see §9 gotcha on this.
   parseClassSection()/computeManagementGrid()/renderManagementGrid()
     ~4040 — auto-activates only when 2+ distinct classes detected
     among Compare sections (parses free-text labels like "Class 7-C").
   toggleTrust(id) 3506 — About panel's 6-pill privacy accordion.
   HOME (v3.1) — single centered upload zone (BUILD spec §2.2/rev2 §10.1).
     handleHomeImportFiles(files) is the only entry point: 1 file falls
     through to handleHomeImport(file) (APP.rawData-direct path); 2+
     files goes through startCompareMode()+processCompareFile() per file
     (APP.sections[]-based path) — see startCompareMode() entry above.
     Neither auto-runs; both just call afterImportSuccess()/
     afterAllCompareFilesLoaded(), which reveal the Home "Run Analysis"
     button (showHomeRunAnalysisButton()). The "Want to try it first?"
     link now opens showSampleFiles() directly (v3.1 — see 10.4 fix
     below) instead of a separate single-file auto-download function
     (tryOneClickSample(), removed). Old Upload Data panel (panel-data)
     and everything that only ever targeted its DOM — triggerFileUpload/
     handleFileSelect/handleFileDrop/processFile/parseWorkbook,
     triggerCompareFileUpload/handleCompareFileSelect/
     handleCompareFileDrop, renderCompareSectionsList/
     renameCompareSection/removeCompareSection/updateCompareContinue-
     Button — deleted (v3.1, BUILD spec §10.1/10.3/10.5). CSV upload
     support went with it (Home's zone is .xlsx/.xls only).
   showSampleFiles() 5239 — 9 sample downloads (6 single-sheet + a
     matched 3-section Compare trio, badged separately). v3.1: confirmed
     working correctly in isolation (opens, populates all 9 links) — the
     "broken" report in BUILD spec §10.4 traced to Home's sample link
     pointing at a different, now-removed function instead of this one,
     not a bug in showSampleFiles() itself. Now Home's only sample-data
     entry point.
   initEnvBadge() 6037 — cosmetic LOCAL/QA pill, no behavioral effect.

   NARRATIVES (v1.9 redesign — was 6 overlapping cards, now 5, honest-
     by-default): generateParentMessage() = ONE message, tone genuinely
     scaled by severity (atRisk+declining / declining / >=80% / improving
     / steady — 5 distinct branches, not one flat "good effort!"
     register). generateTrendFacts() = concrete numbers (test names +
     point delta), not a vague "declining" label; computed, NOT user-
     editable (shown read-only in modal). generateStrengthsLetter()
     returns null (section omitted) when no subject genuinely >=70% —
     no fabricated "working hard to build strengths" filler.
     generateHomePlan()/generateSchoolPlan() split by WHO acts;
     schoolPlan (Institution only) returns null (omitted) when no risk
     flags exist. All 5 ARE editable in-app (narrativeCard()/
     saveNarrativeField()). Bug fixed same pass: "needs urgent
     attention" band is a verb phrase, not an adjective like the other
     bands — sentence template branches on isPhrase.

   MARKS TABLE (student modal + PDF, v1.9): Total column = scored/max
     across subjects actually opted + "N/M opted" note. Class Avg row
     under each test row (Institution only). Percentile suppressed
     below 12 students — shows rank + plain point-diff from class
     average instead.

   PEOPLE PHOTO (v2.1): the About panel's "Who built this" avatar is
     now the founder's real photo (background removed, 84px circle),
     replacing what used to be a second copy of the app logo. This is
     a permanent, standalone image — NOT copied from the header logo,
     no JS wiring needed. The old logo-dedup JS (which copied the
     header logo's src into this slot) was dead code after this change
     and has been removed (v2.1).

   setLeftRail(html)/setRightRail(html) (js/vs-shell.js) — write into
     #shell-rail-start/#shell-rail-end, the VS-shell side panels; see
     §6a. Empty callers only as of Task 3.
   vsShellToggle(side) (js/vs-shell.js) — collapse/expand a side panel
     ("start"|"end"); see §6a.
   renderShellLeftRail(step) (js/vs-shell.js) — Task 4, builds the left
     panel's key/value rows from APP.setup/APP.students; see §6a.
   renderShellRightRail(step) (js/vs-shell.js) — Task 5, builds the
     right panel's actions/status for the 6 non-Dashboard phases; see §6a.
   renderShellDashboardRail()/smartQueryRailAsk()/smartQueryRailAnswer(id)
     (js/vs-shell.js) — Task 6, Dashboard right panel Smart Query v2
     wiring against the real SmartQueryV2 API; see §6a and §9.
   CONTINUITY (prompt-01-schema-foundation-2period.md, bottom of
     js/compute-engine.js) — deriveRosterStatus(studentId,periodIdx,
     periodsPresence) / matchSubjectsAcrossPeriods(periodASubjects,
     periodBSubjects) / checkDuplicateStudentIds(students): pure
     functions only, no APP.* reads, no UI wiring. periodsPresence
     (array of Set<id>, one per period) is not populated by anything
     yet — see §9 continuity-schema-not-built-yet for what that would
     require and why it wasn't done this pass.
   deriveRosterTimeline(studentId,periodsPresence) / splitPeriodsForAnalysis
     (periodCount) (prompt-02-nperiod-import-fork.md, js/compute-engine.js,
     right after the Prompt-01 continuity block) — N-period generalization:
     full present/absent timeline, and which period index is "current"
     (always last) vs "historical." Still pure, still no fork UI in
     template-upload.js, still no SETUP/STUDENTS/MARKS N-period parsing —
     see §9 continuity-schema-not-built-yet.
   CONTINUITY DASHBOARD UI (prompt-03-cohort-dashboard-ui.md +
     prompt-04-student-trajectory-forecast.md, js/continuity-dashboard.js)
     — real "continuity" bucket wired into the existing bucket-list rail
     (buildDashboardControlsHtml/openBucket, js/render-dashboard.js),
     gated on APP.setup.periodCount>1. Ports continuity-dashboard-
     prototype.jsx's period strip / roster panel / cohort view AND its
     student trajectory + trend-projection detail view (clicking a
     roster row) into this app's real vanilla-JS+Chart.js stack, using
     css/vs-shell.css's var(--c-*) tokens instead of the prototype's
     hardcoded hex. Reads APP.continuity ({periods, subjectsByPeriod,
     students[{id,name,pctByPeriod}]}) — nothing produces this shape yet
     (see §9 continuity-schema-not-built-yet), so the bucket is
     correctly gated off for real users until N-period parsing lands.
     renderContinuityStudentDetail(student) — trajectory line (gaps for
     absent periods, never zero-filled), opt-in trend projection
     (default OFF — deviates from the prototype's default-on, flagged
     per prompt-04's own instruction), mandatory disclaimer text,
     low-confidence badge for exactly-2-period students, subject
     trend/no-trend chips reusing matchSubjectsAcrossPeriods. Projection
     eligibility rule (last present period must equal the dataset's
     last period) is inferred from the prompt's own test cases, not
     stated verbatim there — see the file's own header comment for the
     reasoning.
     previewContinuityDashboard('school'|'engineering') — console-only
     dev affordance, points APP.continuity at fixture data ported
     verbatim from the prototype's embedded DATASETS and force-opens the
     bucket; not part of the shipped flow, does not affect the real gate.
   CONTINUITY TERMINOLOGY + NARRATIVE + PDF (prompt-05-institution-
     rollup-narrative.md, final file in the arc) —
     deriveContinuityTerminology(periods,institutionTypeField) /
     computeLongitudinalTrend(presentValuesChronological) /
     getStudentContinuityContext(studentId) /
     computeCohortAttritionRollup(sections) (compute-engine.js, bottom).
     All 5 narrative generators (generateParentMessage/generateTrendFacts/
     generateHomePlan/generateSchoolPlan/generateWhatChangedSummary,
     render-dashboard.js) take an optional 2nd `longitudinal` arg now,
     via continuityNarrativeClause()/getStudentContinuityContext() —
     null/no-op for every real call site today. buildStudentPDF(doc,st,
     continuityData) (export-pdf.js) gained an optional 3rd param and a
     "Journey" section reusing the file's real existing vector-drawing
     chart pattern (see §9 pdf-journey-no-existing-pattern-to-reuse).
     computeCohortAttritionRollup() is NOT wired into
     computeManagementGrid — see §9
     institution-rollup-no-multi-section-data-shape for why.
   parseContinuityPeriods(kv) (v4.36, js/template-upload.js, called from
     autoInferSetup() when SETUP's "Period Count">1) — the real
     N-period SETUP/STUDENTS/MARKS parser prompt-01/02 designed but
     never built. Reads the repeated "Period N Label/Subject i/Test t
     Name/Max Marks..." blocks, builds real APP.continuity (same shape
     js/continuity-dashboard.js already reads), sets
     APP.setup.periodCount, and ALIASES the current (last) period's keys
     onto kv's flat "Subject i"/"Test t Name" keys so every line of
     autoInferSetup()/parseStudents() below/after it runs completely
     unchanged. A companion filter right after the main parseStudents()
     call (compute-engine.js) drops roster members not enrolled in the
     current period before computeAnalysis() runs, so a multi-period
     roster's past leavers don't show up as broken 0%-every-subject
     students in the current period's detailed dashboard. See §9
     continuity-schema-now-built-v4.36.

════════════════════════════════════════════════════════════════════════

8. CONSTANTS
   Grade/severity bands, flag colors, and threshold cutoffs live inline
   at each computation site (e.g. generateParentMessage()'s 5 severity
   branches, computeAnalysis()'s stress/health bands) rather than a
   central constants block — unlike Spend-na's BUCKETS/SRCS tables,
   Student Insight has no small fixed enum set worth centralizing here;
   subjects/tests are user-defined per class, not app constants.

════════════════════════════════════════════════════════════════════════

9. GOTCHAS — append-only, one line each, never remove
   continuity-schema-not-built-yet  prompt-01-schema-foundation-2period.md
     assumes SETUP is "today...one flat config" and STUDENTS "NEW" —
     both are false against this repo's actual state: SETUP+STUDENTS+
     per-test tabs (§4 DATA SCHEMA) already exist as a multi-tab format,
     just without a repeatable PERIOD block or period-prefixed
     <PeriodLabel>-Test<N> tab naming. Only the two pure functions the
     prompt scoped as "no UI wiring yet" were built this pass
     (deriveRosterStatus/matchSubjectsAcrossPeriods, plus a
     checkDuplicateStudentIds helper for the STUDENTS-tab uniqueness
     rule) — the actual SETUP Period-Count/repeated-block parsing,
     STUDENTS-tab-as-shared-roster wiring, and <PeriodLabel>-Test<N> tab
     naming were NOT touched, since that's real surgery on the existing
     parseWorkbookSheets()/parseStudents()/autoInferSetup() pipeline
     (template-upload.js) and risks the "byte-for-byte same numbers"
     legacy-regression requirement without a much larger, separately-
     scoped pass. Needs an explicit follow-up decision, not a "just do
     it" continuation.
   no-jsdom-harness-exists  prompt-01-schema-foundation-2period.md's
     "Run existing jsdom test harness (per PIB §11)" and the two sample
     continuity workbooks it references (sample_continuity_school.xlsx,
     sample_continuity_engineering.xlsx) do not exist anywhere in this
     repo — confirmed via find/grep before starting. §12's v2.6 entry
     already says the one jsdom suite that was ever built was explicitly
     "not shipped as part of the app itself." The new pure functions
     were instead verified against the prompt's own worked examples via
     a throwaway node script, run and then deleted (not committed).
   nperiod-fork-not-built-yet  prompt-02-nperiod-import-fork.md's actual
     feature — the "Add a test / Start a new class-semester" fork
     prompt in template-upload.js's merge flow, plus genuine N-period
     SETUP/STUDENTS/MARKS parsing — was NOT built, same reason as
     continuity-schema-not-built-yet above (no foundation to build it on
     yet, no sample files to test it against). Only the pure generalization
     (deriveRosterTimeline, splitPeriodsForAnalysis) was added this pass.
   continuity-dashboard-ungated-in-practice  prompt-03-cohort-dashboard-
     ui.md's "continuity" bucket (js/continuity-dashboard.js) is real UI,
     wired into the real bucket rail — but since nothing sets
     APP.setup.periodCount or populates APP.continuity yet (see
     continuity-schema-not-built-yet above), no real file can currently
     make it appear. It was built and verified against the prompt's own
     worked examples (Class5->Class6 diff, subject turnover, cohort avg)
     via a throwaway node script on the fixture data, not a live browser
     screenshot — no headless-browser tooling available in this
     environment. Also: the prototype's roster badge is period-INvariant
     (computed once off full history); this build makes it period-
     RELATIVE (recomputed per active period via deriveRosterStatus)
     because the prompt's own test spec ("click Class 6 -> roster panel
     updates") requires that, even though it diverges from the reference
     prototype's actual behavior — flagging since "port its structure,
     don't reinvent it" and this is a deliberate, spec-driven deviation.
     Student-detail-with-projection was out of scope for THIS bucket's
     initial build (Prompt 03) — since built by prompt-04-student-
     trajectory-forecast.md, see continuity-projection-design-choices
     below.
   continuity-projection-design-choices  prompt-04-student-trajectory-
     forecast.md, js/continuity-dashboard.js's renderContinuityStudentDetail() —
     two decisions worth flagging: (1) "Show projection" defaults OFF,
     not ON like the reference prototype — the prompt explicitly allows
     either choice and asks it be flagged, this felt safer for a line
     whose own disclaimer says "not a guarantee." (2) the rule for WHEN
     a projection renders at all (last present period must equal the
     dataset's last period, so a leaver never gets one no matter how
     long their history) is inferred from the prompt's own S011/S012
     test cases, not written out as an explicit rule in the prompt text
     — see the file's header comment for the derivation. Verified against
     the prompt's worked cases (S003 declining projection value, S011 no
     projection, S012 low-confidence projection, engineering's zero-
     carried-subjects empty state every period) via a throwaway node
     script, not a live screenshot — same no-headless-browser limitation
     as continuity-dashboard-ungated-in-practice above.
   pdf-journey-no-existing-pattern-to-reuse  prompt-05-institution-
     rollup-narrative.md said to reuse "the same approach already used
     for Indic-script rendering" for embedding the Journey trajectory
     chart into PDFs — grepped export-pdf.js and the whole PIB history
     for "Indic" and for any canvas/addImage chart-embedding pattern:
     neither exists anywhere in this repo. The REAL existing pattern for
     charts in PDFs here is native jsPDF vector drawing (doc.line/
     doc.circle — see the Test Trend sparkline in buildStudentPDF()), so
     the new Journey section reuses THAT instead, which is what "reuse
     an existing pattern" actually cashes out to for this codebase.
   institution-rollup-no-multi-section-data-shape  prompt-05-institution-
     rollup-narrative.md's per-class/section attrition rollup needs an
     array of per-section continuity data — but nothing in this arc (or
     in computeManagementGrid's existing Compare-Mode-based data model)
     has a notion of "multiple sections, each with their own multi-
     period roster." Prompts 01-04's whole continuity model is ONE
     roster's journey across periods. computeCohortAttritionRollup()
     (compute-engine.js) was built as a pure function taking that array
     shape, reusing computeLongitudinalTrend and the cohort-average
     logic, verified against both sample fixtures treated as two
     sections — but it isn't wired into computeManagementGrid/
     renderManagementGrid, since there's no real or fixture data source
     of that shape to wire it to without fabricating a second, deeper
     layer of demo data on top of everything else in this arc.
   continuity-schema-now-built-v4.36  UPDATE to continuity-schema-not-
     built-yet above (kept per append-only, not edited/removed): the
     real N-period SETUP/STUDENTS/MARKS parsing this repeatedly flagged
     as missing was built in v4.36 — parseContinuityPeriods()
     (template-upload.js), called from autoInferSetup() when SETUP's
     "Period Count">1. Sample_15_..._CONTINUITY.xlsx (samples/) now
     actually loads and renders the Continuity tab for real — verified
     against the real .xlsx file's bytes (openpyxl-dumped raw sheet data
     fed through the real, unmodified parseContinuityPeriods()/
     parseStudents(), not a fixture): 5 periods, correct leaver (ENG011,
     gaps from Sem3 on) / joiner (ENG013, gaps before Sem3) pattern, 18
     roster -> 16 correctly enrolled in the current period (Semester 5),
     0 data issues. nperiod-fork-not-built-yet below is UNCHANGED — the
     "Add a test / Start a new class-semester" import-fork UI still
     doesn't exist; a multi-period file can be freshly uploaded and read,
     but not built up incrementally through the normal re-upload/merge
     flow yet.
   KNOWN GAP, FIXED v4.3: markDirty() (fired on any Setup-form edit)
     turned on #unsaved-dot; markClean() existed but was never called,
     so the dot stayed lit for the rest of the session regardless of
     later actions. Product decision made: a completed analysis (both
     the single-file path in runAnalysis() and the Compare Mode path in
     runCompareAnalysisCore(), which has its own separate success point)
     is the moment the current Setup form values get captured into
     something the user can see — markClean() now fires there.
   percentile-precision  below 12 students, percentile math implies
     false precision (e.g. "14th percentile" out of 8 kids) — suppress
     it, show rank + plain point-diff instead (see §7 MARKS TABLE).
   band-grammar  severity band labels must all be the same part of
     speech as the sentence template expects, or plug-in produces
     broken grammar (fixed once already for "needs urgent attention").
   weakest-subjects  naming "the weakest subjects" only makes sense as
     a genuine minority of the list — a tie-for-lowest can cover every
     subject if a student is weak evenly; check §2 BROAD_WEAKNESS
     before trusting a "weakest subject" list is actually targeted.
   logo-dedup  if a new logo/brand-image usage is ever added anywhere,
     reuse the header logo's element rather than re-embedding the
     base64 a second time — this exact bug cost 368KB/31% of file size
     once already.
   autorun-goStep-ai  runAnalysis()/runCompareAnalysisCore() both call
     goStep('ai') internally now (v2.4), purely to bring the loader
     on-screen — panel-ai and its checkbox cards still exist and are
     still fully functional, they're just not a stop the normal flow
     visits deliberately anymore. Don't delete panel-ai or its
     checkboxes assuming they're dead code.
   home-compare-silent  Home's 2+-file drop (handleHomeImportFiles) waits
     for every file's FileReader to finish (remaining-counter in
     afterAllCompareFilesLoaded()) before deciding whether to auto-run —
     it does NOT act on a partial subset. The real pre-existing quirk
     this inherits from processCompareFile(): which file's SETUP tab
     becomes the shared comparison schema is whichever FileReader
     resolves FIRST, not necessarily files[0] in array/drop order, since
     all readers start in parallel. Rarely matters (most real comparison
     sets share one schema anyway) but don't assume drop order = schema
     source.
   smart-reveal-scope  renderBuckets() only rail-drives Institution+
     non-Compare mode (ui-prompt-template.md item 7, supersedes the old
     Screens A/B/C description below); Compare Mode and Individual mode
     still go straight to the old full renderDashboard() body — don't
     assume #bucket-answer-screen is populated/relevant in those two
     modes, and don't assume #bucket-screen/#bucket-list-screen are
     populated in Institution mode anymore either (retired, see §6b).
   smart-reveal-modal  #bucket-answer-screen is a persistent in-place
     panel, NOT the #modal-overlay dialog used by openStudentModal()
     elsewhere — this was an explicit, locked design decision (modals
     rejected for this feature), don't "simplify" it back to a modal.
   dashboard-rail-superseded-task6  ui-prompt-template.md item 7g/h
     superseded vs-shell-plan-v2 Task 6's chat-thread Smart Query rail
     (renderShellDashboardRail()/smartQueryRailAsk()/
     smartQueryRailAnswer(), js/vs-shell.js) with a picker-list pattern
     (renderDashboardSmartSearch()/onSmartQuestionPick(),
     render-dashboard.js) matching items c/d's student/subject/help
     UI. The Task 6 functions are left defined but are no longer called
     from anywhere — don't assume they're live, and don't "fix" them,
     fix the item-7 versions instead. js/vs-shell.js's
     renderShellRightRail() now explicitly no-ops for step==="dashboard"
     — render-dashboard.js's openBucket()-dispatched functions own that
     rail directly via setRightRail() calls.
   dashboard-no-back-navigation  ui-prompt-template.md item 7's core
     rule ("no navigating away, no back button, no screen-hopping")
     removed backToBuckets()/backToBucketList()/breadcrumbHtml()/
     toggleHelpRow() from every call site — all four functions are
     still defined (harmless dead code) but nothing calls them anymore.
     The left rail's control list is the only way to switch views now;
     re-clicking the same control just re-renders it.
   emptyStateHtml-was-undefined  emptyStateHtml() was called in
     renderStudentPicker()/renderSubjectPicker() (empty-list edge case)
     but never defined anywhere in the codebase — a pre-existing
     ReferenceError waiting to happen, not introduced by item 7. Defined
     now (render-dashboard.js, right before openBucket()) since item
     7's rewrite added two more call sites (help/Smart Search pickers)
     using the same pattern.
   dashboard-export-reuses-panel  ui-prompt-template.md §6 literally asked
     for the single-button export experience to render inside
     #panel-dashboard (in place, like every other rail control). Instead,
     openBucket("export") and both compare-mode rail entries navigate via
     goStep("export") to the pre-existing #panel-export screen — a
     deliberate choice: that screen's loader/progress-bar/EXPORT_GATE
     gating/compare-card logic already works correctly, and relocating
     the DOM elements those functions reference by ID
     (#export-loader/#export-prog/etc.) into a JS-rebuilt rail target
     without breaking generateAllPDFs()/updateExportGate() was assessed
     as high-risk with no way to visually verify the result in this
     environment. If a truly in-place experience is wanted later, that's
     a separate, scoped follow-up — not a bug in what's here.
   dashboard-mode-not-step  Classic Dashboard and Smart (bucket) Dashboard
     are BOTH step==="dashboard" — they're distinguished by
     APP._forceLegacyView, not the step name. Any future rail/panel
     behavior that needs to differ between the two (like ui-prompt-
     batch2.md item 1's open/close) must check that flag, not step —
     confirmed this the hard way once already, don't re-derive it.
   export-rail-compare-checkbox-not-built  ui-prompt-batch2.md item 2's
     Report Types checklist mentions a "Compare (only if Compare Mode/
     session exists)" item alongside Teacher/Management/Zip. NOT built —
     there's no existing code path connecting a comparison PDF
     (exportComparisonReportPDF(), a separate function entirely) to
     generateAllPDFs()'s ZIP output, and the spec doesn't say what
     "including" it should actually produce. Building it would mean
     inventing that behavior, not restoring or relocating existing logic
     — flagged rather than guessed at. Ask before building this one.
   studin-pro-was-never-built  ui-prompt-template.md §8 claimed the
     StudIn-Pro gate was "already implemented directly" — verified false
     (zero "STUDIN-PRO" hits in the repo before this work). Built for
     real now (§6d), folding in ui-prompt-batch2.md item 3's amendments
     directly rather than building the stale version first. If any other
     document claims something is "already done," verify against the
     actual code before trusting it — this is the second time that's
     turned out to be false in this project (see also the smart-query-v2
     API-mismatch gotcha above).
   data-error-exclusion  "Data Error" flags are deliberately never
     surfaced in the Who Needs Help bucket — they're a data-quality
     problem (already shown via the EXPORT_GATE banner), not a student-
     performance finding; mixing the two would misleadingly read as
     "this child is struggling."
   pib-line-drift  §7's line numbers for pre-v2.3 functions (e.g.
     computeAnalysis, computeClassStats) were not re-verified against
     the current file after the v2.2 dark-mode pass shifted every line
     number by several hundred — grep the function name rather than
     trusting the cited line number until someone does a full re-pass.
   pib-line-drift-fixed  the above was fixed in v2.5 — every citation in
     §7 was re-verified by grep against the actual file at that point in
     time. This will drift again the next time a large edit shifts line
     numbers; treat citations as "accurate as of v2.5," not permanent.
   no-upload-data-panel  panel-data ("Upload Data" / old Step 2) was
     deleted entirely in v3.1 (BUILD spec §10.1) — Home is the ONLY
     upload surface now, for 1 file or many. Don't reintroduce a
     separate upload step, and don't assume #drop-zone/#file-input/
     #btn-data-continue/#compare-drop-zone/#compare-file-input/
     #compare-sections-list/#btn-compare-continue exist — they're gone.
   compareMode-flag-not-eliminated  BUILD spec §10.3 (rev2) asked for
     APP.compareMode to be deleted entirely, unifying every upload (1
     file or many) into one code path. That was NOT done — the flag
     still exists and still branches goStep()/runAnalysis()/dashboard/
     export rendering, same shape as v3.0. What WAS done: every dead
     function/DOM-target that only existed to support the old separate
     Upload Data panel's Compare UI (renderCompareSectionsList,
     updateCompareContinueButton, rename/removeCompareSection,
     triggerCompareFileUpload, handleCompareFileSelect/Drop) was
     deleted, and startCompareMode() no longer navigates anywhere. A
     genuine full unification (1-file uploads always going through
     APP.sections[] too, dropping APP.rawData-direct entirely) would
     also need processCompareFile()'s validation to gain the fuller
     validateSetupData() required-field checks (institution/class/year)
     that handleHomeImport() has and processCompareFile() doesn't — this
     is real, scoped-out follow-up work, not an oversight to "just fix."
   sample-popup-was-a-wiring-bug  BUILD spec §10.4 reported the sample-
     data popup as broken. showSampleFiles()/closeModal() themselves
     tested clean in isolation (opens, 9 links populate correctly) — the
     actual bug was Home's "Want to try it first?" link calling a
     different function (tryOneClickSample(), a single-file auto-
     download) instead of this modal. Fixed in v3.1 by pointing that
     link at showSampleFiles() directly and deleting
     tryOneClickSample(). If sample data still looks "broken" after
     this, look for a live-hosting issue (file actually present at
     studin.in) before assuming the JS is at fault again.
   en-i18n-was-never-fetched  loadLanguage() special-cased code==="en" to
     never fetch i18n/en.json, treating the inline SR_STRINGS_EN as
     always-sufficient — but SR_STRINGS_EN had silently drifted out of
     sync with en.json (missing smart_search_back/title/subtitle and
     ~100 other keys), so raw key names rendered on the Smart Search
     screen. Deterministic, not a race condition. Fixed in vs-shell-
     plan-v2 Task 1: English now fetches i18n/en.json like every other
     language; SR_STRINGS_EN remains only as the emergency fallback if
     that fetch itself fails.
   shell-scrapped-not-refactored  css/shell.css and js/app-shell.js
     (v4.7) were a literal wireframe trace shipped as real UI — box
     captions like "Just plan data in bullet points" as live text,
     hardcoded English with no srT(), a duplicate escapeHtml() instead
     of esc(). Deleted outright in vs-shell-plan-v2 Task 2, not
     repaired — the VS-style shell (css/vs-shell.css, js/vs-shell.js)
     is a clean rebuild, see shell-redesign-plan.md / vs-shell-plan-v2.md.
   story-deck-fabricated-citation  js/story-deck.js's header cited
     "Project Bible v2 §8.8" — this section has never existed (this PIB
     stops at §12, never had an §8.8) and the story-deck feature was
     never requested or designed. Disabled (script tag commented out,
     header annotated) in vs-shell-plan-v2 Task 2 rather than silently
     kept or silently deleted. Do not re-enable without an explicit
     decision and a real spec entry here.
   shell-left-rail-not-live  renderShellLeftRail() (Task 4) only
     re-renders on goStep() navigation and on a language switch — NOT
     on every Setup-form keystroke (instName, class name, etc.). If the
     left rail ever needs to mirror the Setup form live while the user
     is still typing on it, that's new wiring, not a bug in what's here.
   shell-right-ai-no-continue  shell-redesign-plan.md §4.2's
     shell_right_continue key assumed AI Features was still an
     interactive picker; v3.2 converted it to a passive progress screen
     (analysis always runs from Home's Run Analysis button instead) —
     so Task 5 does not add that key or a Continue button, only the
     real "Selected features" count. Not an oversight if it's ever
     asked about again.
   smart-query-v2-api-mismatch  Both vs-shell-plan-v2.md Task 6 and
     shell-redesign-plan.md §4.3/Phase 3 describe js/smart-query-v2.js
     as exposing composeVerdict()/suggest()/matchAndAnswer(), a
     hardcoded "verdict" string to migrate into i18n, and a js/vendor/
     fuse.min.js dependency to add before this phase. None of that
     exists in the actual shipped file (grepped, zero hits) — its real
     API is load()/isReady()/availableQuestions()/answerQuestion(id)/
     match(text,limit)/ask(text), and its own header explicitly says it
     does NOT use fuse.js (lightweight token-overlap scorer instead).
     Task 6 was built against the real API, not the stale plan
     language — do not "fix" js/vs-shell.js to call the planned-but-
     nonexistent names, and do not add a fuse.min.js script tag, it
     isn't needed and the file doesn't exist in this repo.
     shell_v2_verdict_no_data and smart_v2_export_log from §4.3 were
     deliberately NOT added to i18n: the first has no composeVerdict()
     to pair with; the second (prompt.md §8.5's session-log export) has
     no existing implementation anywhere and prompt.md itself was never
     supplied, so there is nothing safe to wire without inventing new
     business logic outside this task's scope.
   shell-mobile-default-collapsed  Task 8's mobile strip/sheet panels
     default to collapsed on first load (checked once via
     window.innerWidth<=768 at boot, stored in APP.shellState same as
     everything else) so they don't cover the screen — this is a new
     default that only applies at that breakpoint; desktop's default
     (expanded) from Task 3 is untouched. If mobile ever needs to
     remember a per-visit choice instead of always defaulting collapsed,
     that's new work, not a bug in what's here.
   flag-reason-narrative-not-retranslated  computeAnalysis() (compute-
     stats.js) calls srT() once at analysis time and bakes the result
     (flag_reason_*, findings text) into APP.students as plain strings —
     the data-i18n DOM sweep that runs on a later language switch only
     touches static template markup, not this baked text, so switching
     language mid-Dashboard/Export used to leave analysis narrative
     stuck in whichever language was active when "Run Analysis" was
     clicked (mixed-language screen, reported via screenshot showing
     Kannada UI chrome around raw English flag_reason_first_below_pass
     text). Fixed by locking #language-select (disabled, via goStep() in
     state-nav.js) for the "ai"/"dashboard"/"export" steps and unlocking
     it on "home"/"setup" — the two steps a fresh analysis can start
     from. Language must now be picked before running analysis; a
     proper fix that re-translates baked narrative on switch (re-running
     computeAnalysis() or storing raw {key,params} instead of rendered
     strings) is a larger, separately-scoped change, not done here.
   i18n-17-keys-were-missing-all-12-locales  scripts/i18n-gap-check.py
     found the same 17 keys missing from all 12 regional i18n/*.json
     files (smart_v2_*, btn_go_home/stay_here, merge_will_save_as_*,
     post_download_*, toast_analysis_complete_one/other, val_*,
     sample_5_desc) — none of the 12 had drifted further behind the
     others, all missing the identical set, meaning srT() was silently
     falling back to hardcoded English for these regardless of selected
     language. Translated and added to all 12 locale files this pass
     (plus the new lang_locked_during_analysis key above); gap-check now
     reports 0 missing across all locales. Remaining "identical to
     English" flags (about_bio_*, faq_q_terms_*, onboard_*_erp/qr/
     founder_link_*, pdf_kpi_percentile) are proper nouns/brand terms,
     left as-is.
   home-recent-files-is-metadata-only-not-a-real-reopen  "Recent Files"
     (Home left rail — see renderShellLeftRail() step==="home" branch,
     js/vs-shell.js) stores only {fileName, instName, className,
     section, ts} in localStorage (studin_recent_files, capped at 15,
     recordRecentFile() in js/template-upload.js) — never file content,
     never a file-system handle. Clicking an entry does NOT reopen the
     file directly; it just triggers the same triggerHomeImport action
     as the "Import" button, opening a generic native file picker the
     admin still has to navigate manually. This is deliberate — a real
     reopen needs the File System Access API (Chromium-only, permission
     re-prompts every session, stale handles if the file moves), which
     was left out to keep this working identically in every browser and
     to keep the zero-persisted-content story intact. If someone reports
     "clicking recent file didn't open it," that's expected behavior,
     not a bug — the hint text under the list (shell_left_recent_files_
     hint) already says "opens the picker," not "opens the file."

════════════════════════════════════════════════════════════════════════

10. NOT BUILT — never assume these exist; check here before answering
    a question or writing code that assumes one of them
    localStorage/server persistence of student data (deliberate — see
      §2 NO_PERSISTENCE, not a gap)
    User accounts / login / multi-teacher sharing
    Real AI-generated narrative text (all 5 narrative fields are rule-
      based templates — see §7 NARRATIVES; confirmed explicitly with
      the person, not a placeholder awaiting a real API)
    Student/teacher photos anywhere in the data model (the founder's
      own photo on the About panel is the ONLY photo in the app —
      don't assume a photo field exists on `student`)
    Automatic subject+test addition in "Update Existing Sheet" (see §7
      merge KNOWN LIMITATION — subject+test together isn't supported)
    BULK ACTIONS ON ALREADY-EXISTING FILES ("Update Existing Sheet" bulk
      mode — e.g. a school re-uploading last year's 7A/7B/7C.xlsx at once
      to do "Add a test" or "Start a new class/semester" on all three
      together). Deliberately NOT built — bulk template CREATION for
      fresh files (the "Generate/update multiple sections" checkbox,
      generateBulkSectionTemplates(), js/template-upload.js) WAS built
      and is unrelated; this is the other half the person confirmed they
      want built later, with the full plan captured here so it's not
      re-scoped from scratch:
        - Needs multi-file upload on the "Update Existing Sheet" screen
          (currently single-file only — handleUpdateUpload()/
          loadMergeSourceFromArrayBuffer() assume one file).
        - The ONE fork question (chooseMergeFork) still applies, but
          asked ONCE for the whole batch, not per file — same "Add a
          test" vs "Start a new class/semester" choice, applied
          identically to every uploaded file.
        - Each file needs its OWN independent origPeriodSnapshot/
          origTestSheetNames/dupeIds — do NOT let one file's state leak
          into another's (this is the same double-mutation risk
          generateBulkSectionTemplates() had to guard against for fresh
          creation — deep-clone per file, never share objects across
          iterations).
        - "Add a test": each file gets whatever NEW test(s) the shared
          Setup form defines, appended onto that file's own existing
          tabs — old tabs/marks in EVERY file stay untouched (same
          copy-the-worksheet-object safety generateMergedTemplate()
          already guarantees for one file).
        - "Start a new class/semester": same Class/Batch-must-differ
          validation (case-insensitive) applies per file, checked
          against THAT file's own previous period label — a file
          already on "Class 6" and one still on "Class 5" can't both be
          validated against one shared "new" label.
        - A real product question that needs answering when this is
          built (not yet asked): do all N files share the exact same
          Section list order as the "Generate multiple sections" bulk-
          create checkbox did, or does each upload just carry its own
          existing Section value forward unchanged? (Most likely the
          latter — Section shouldn't need re-entering if it's already
          correct in each file's own SETUP — but confirm before coding.)
        - Output: one ZIP, one file per input file, same
          "<InstName>_<Class><Section>_TEMPLATES_<timestamp>.zip"
          convention as the bulk-create path.
    Any shipped automated test harness for the merge feature (removed;
      verify manually against a real file before trusting a code read)
    Dark mode toggle — SHIPPED v2.2, not missing; see the theme-preload
    Story-deck-run mode as a real feature — js/story-deck.js exists but
      is disabled (script tag commented out, vs-shell-plan-v2 Task 2),
      its header cited a spec section that never existed. Don't assume
      this feature is live just because the file is present.
    Floating-bubble Smart Search UI — js/smart-query-v2-ui.js exists but
      is disabled (Task 2), superseded by the Dashboard right-panel
      wiring (Task 6). Its logic was reused there, its own DOM/CSS
      wasn't.
    Mobile info-strip preview text — the Task 8 mobile strip/pill shows
      only the collapse-toggle chevron, not a one-line content summary
      inside the collapsed bar itself (shell-redesign-plan.md Phase 4
      implied a preview). Building that needs new markup + a re-render
      hook every time rail content changes; out of scope for this pass.
    Hamburger consolidation of the mobile header (country/language
      selects) — Task 8 only reworked the two side panels into a strip/
      sheet; the header itself (#topbar selects) was left as-is,
      unreviewed for narrow widths. Flagged, not fixed.
      <script> at the top of <head> and CSS vars in §3 TECH.
    Multi-language / i18n — SHIPPED as scaffolding only (v2.3): srT()/
      SR_STRINGS_EN in the SMART REVEAL module (§7) is a real tag-key
      lookup function, but only an English string table is populated.
      Hindi/Kannada/etc are not implemented — don't assume any
      language switcher or second string table exists anywhere.
    A hit-counter, GitHub-repo traffic API integration, or any
      analytics beyond what GitHub's own Insights tab already provides

════════════════════════════════════════════════════════════════════════

11. AI AGENT RULES
    BEFORE TOUCHING CODE:
      grep the exact function/field name -> read the surrounding ~20
      lines -> check §9 GOTCHAS and §10 NOT BUILT before assuming
      anything about current behavior.
    MAKING A CHANGE:
      Smallest possible edit, str_replace-style with unique anchor
      text; verify with `node --check` on the extracted <script> block
      after every edit, not just at the end of a session.
    NEW ANALYSIS FIELD ON student.analysis:
      Add it to §4 DATA SCHEMA. Decide null-vs-computed default and
      add the safe-read pattern to §4 if a caller needs to check it.
    NEW AI_FEATURES ID:
      Decide cosmetic-doc vs real-gated (§5) before adding.
    BUG FIXED:
      Add exactly one line to §9 — never remove existing lines, never
      rewrite an old one to sound better.
    NEW FUNCTION/MODULE:
      Add one line to §7 with an approximate line number.
    AFTER EVERY SESSION:
      Update only the values/lines that changed in this PIB — leave
      everything else untouched (see SELF-UPDATE RULE at the top).
    NEVER:
      Add localStorage/server persistence of student data without an
      explicit, deliberate decision to reverse the stated privacy
      model. Claim a narrative field is "AI-generated" — it's rule-
      based; say so if asked. Assume a photo/account/login system
      exists anywhere except the one founder photo on the About panel.

════════════════════════════════════════════════════════════════════════

12. CHANGELOG — terse, append-only; full reasoning for pre-v2.0 items (each entry compressed to one line; full multi-paragraph
    reasoning for these lived here pre-v4.38 — see git history if needed)
    - v4.41 — StudInPro promo added (Sandy-directed, see planner.md 2026-09-04 entry for full detail): footer ticker (core/studinpro-items.js content, ui/common/studinpro-ticker.js logic) + About-page card, both opening a shared-modal Google Form. Old static footer text/link removed. Two real bugs found via live-browser testing and fixed: css/vs-shell.css's #footer{justify-content:center} was silently collapsing the ticker's text area to 0px width (fixed with width:100% on #studinpro-ticker); gsapModalEntrance (render-core.js export, never window-attached) was being called via a typeof-guarded bare reference that was always false, so the modal never got its .open class (fixed with a real import). CSP gained frame-src 'self' https://docs.google.com — was missing entirely (fell back to default-src 'self', blocking the form iframe). One new localStorage key (studinProFormSubmitted, boolean only) — first localStorage write in this project, reviewed against §2 NO_PERSISTENCE (that constraint covers student data, not this).
    - v4.40 — Home left rail rebuilt: the old 7-row pitch strip is now fully replaced (not conditionally hidden) by "Current File Details" (open, shared row() pattern) + "Recent Files" (scrollable list, up to 15 entries, deduped by fileName+institution+class+section — see recordRecentFile()/getRecentFiles(), js/template-upload.js); rail goes fully empty when no file has ever been imported, matching the localStorage-only/no-content-persisted design (a browser history/site-data clear removes it same as any other site data). Clicking a recent entry reuses the existing triggerHomeImport action to open the native file picker — no auto-reopen (would need the Chromium-only File System Access API, deliberately not used). Home-only: Setup/AI/Dashboard/Export keep the pre-existing shared file-details block untouched.
    - v4.39 — language-lock + full i18n gap fix: #language-select now disabled (state-nav.js goStep()) for ai/dashboard/export steps so mid-analysis language switches can't leave narrative half-translated (see flag-reason-narrative-not-retranslated §9); translated and added the 17 keys missing from all 12 regional i18n/*.json files, gap-check now 0 missing everywhere (see i18n-17-keys-were-missing-all-12-locales §9).
    - v4.39 — code-review backlog pass: extracted PIB itself from index.html into PIB.md (P3 #17); confirmModal() replaces native confirm() in compute-stats.js large-file check, screen-reader-accessible (P3 #19); inline-actions.js's 3 switch(action) dispatchers converted to per-action object maps, no behavior changed (P3 #18); sr-only data-table fallback added next to each Analytics-tab Chart.js canvas (P1 #14); aria-describedby + sr-only text added for the two data-tip hover tooltips (Home drop-zone icon, Setup Academic Year label); setup wizard's two mode-select `<label role="button">` cards converted to native `<button>`.
    - v4.38 — PIB maintenance pass: §12 CHANGELOG entries v2.4-v4.37 compressed from multi-paragraph dev-diary prose to one terse line each (this section alone was ~56KB of the ~90KB PIB); removed the dead backToIndividualBuckets() no-op (render-buckets.js) after confirming via grep + a full dom-smoke run that nothing calls it anymore, now that all inline onclick markup is gone.
    - v4.37 note: several real fixes landed between v4.36 and this entry without individual PIB updates (sample-file tab prefix, "Start a new class/semester" leaving stale tabs, a literal `<b>` in the fork modal). v4.37 itself: bulk section template creation (generateBulkSectionTemplates()/toggleBulkSectionsUI(), js/template-upload.js).
    - v4.30-v4.35 note: this repo's changelog top entry was v4.19 when the continuity feature arc (prompt-01 through prompt-05, plus this samples/docs merge pass) started, but the actual code had…
    - v4.36 — built the real N-period SETUP/STUDENTS/MARKS parser (parseContinuityPeriods(), js/template-upload.js) — the single gap flagged repeatedly across v4.30-v4.35 as the reason the whole continuity arc wasn't usable end-to-end.
    - v4.35 — samples/ revisit: fixed a real bug found while doing this — deriveContinuityTerminology()'s institutionTypeField matching checked for bare "school"/"college"/"university", which…
    - v4.34 — prompt-05-institution-rollup-narrative.md, PARTIAL, final file in the 5-prompt continuity arc: deriveContinuityTerminology() (school "Class"/"Left"/"attrition" vs college…
    - v4.33 — prompt-04-student-trajectory-forecast.md, PARTIAL: extended js/continuity-dashboard.js — clicking a roster row now opens a student trajectory detail view (line chart with real gaps…
    - v4.32 — prompt-03-cohort-dashboard-ui.md, PARTIAL: added js/continuity-dashboard.js, a real "continuity" bucket wired into the bucket-list rail (render-dashboard.js…
    - v4.31 — prompt-02-nperiod-import-fork.md, PARTIAL: added deriveRosterTimeline() and splitPeriodsForAnalysis() (js/compute-engine.js) — pure N-period generalization of Prompt 01's functions,…
    - v4.30 — prompt-01-schema-foundation-2period.md, PARTIAL: added the two pure/no-UI functions it scoped as safe to build ahead of the real schema work (deriveRosterStatus,…
    - v4.19 — ui-prompt-batch2.md items 1-3.
    - v4.18 — Bug report: "most Shell-left/right headers not rendering." Couldn't reproduce/pin the exact root cause via code reading alone (no browser in this environment) — two things fixed…
    - v4.17 — ui-prompt-template.md §6 (Export folds into Dashboard), resolved via open-questions-resolved.md.
    - v4.16 — ui-prompt-template.md §4 items 1-8 (Home rail + Dashboard IDE redesign, in progress — items 1-8 done, §5/§6/§7 of the wider ui-prompt-template-2.md not started, open questions pending).
    - v4.15 — vs-shell-plan-v2.md Task 8 (mobile fallback + regression review) — LAST task, vs-shell-plan-v2.md now fully implemented.
    - v4.14 — vs-shell-plan-v2.md Task 6 (Dashboard right panel, Smart Query v2 — last of the content tasks).
    - v4.13 — vs-shell-plan-v2.md Task 5 (right panel, non-Dashboard phases), using shell-redesign-plan.md §4.2's key list minus shell_right_continue (stale — AI panel has no Continue action since v3.2, see §9).
    - v4.12 — vs-shell-plan-v2.md Task 4 (left panel content), using the key list from shell-redesign-plan.md §4.1.
    - v4.11 — vs-shell-plan-v2.md Task 7 (session-persistent panel state).
    - v4.10 — Correction to Task 3 (user-requested, not in vs-shell-plan-v2.md): whole app now fits the viewport on desktop (>768px) with no page-level scroll — only #main scrolls internally.
    - v4.9 — vs-shell-plan-v2.md Task 3: VS-shell skeleton.
    - v4.8 — vs-shell-plan-v2.md Tasks 1-2.
    - v4.7 — App shell (Phases 1-3, shell-redesign-plan.md), Smart Query v2 core + UI (js/smart-query-v2.js, js/smart-query-v2-ui.js), Story-Deck-Run mode (js/story-deck.js), §5a…
    - v4.6 — 2 remaining §5 parent features.
    - v4.5 — i18n gap-fill (Project Bible v2 §4 review follow-up).
    - v4.4 — Target-score tracker (Project Bible v2 §5, "For parents").
    - v4.3 — 3 items from Project Bible v2 §4 (small/confirmed items): (1) markDirty()/markClean() gap fixed — markClean() existed but was never called; now fires at both analysis-success points…
    - v4.2 — AI feature panel (42 features × label+sub = 84 keys) localized across all 13 languages, sourced from a re-uploaded old reference file's en/hi/kn — cross-verified id-for-id against…
    - v4.1 — 4 bug fixes: (1/2) Setup/Sample Files/About/FAQ nav-lock rule unified — previously Sample/About/FAQ used a stricter "Home only" check that also blocked them mid-Setup (the actual…
    - v4.0 — Full localization of Setup + About + FAQ-chrome across all 13 languages (English + 12 Indian languages), ~142 new keys ×13 = ~1,846 translated strings, on top of the existing ~40-key bucket/ Smart Search coverage.
    - v3.9 — 4 mobile bug fixes from iPhone 13 Pro Max QA screenshots: (1) Setup Step 4's Back/Done/Download buttons all read as one confusing block on narrow screens — Back is now a quiet ghost…
    - v3.8 — "0 rows detected" bug fixed: resolveMarksRows() was looking for a sheet named MARKS+CONTEXT (an old single-sheet template); current templates split marks across one sheet PER TEST…
    - v3.7 — env-config.js added: single runtime settings file (js/env-config.js, loaded first) auto-detects QA/Prod/local from location.hostname and exposes window.APP_CONFIG {assetBase, projectPageUrl}.
    - v3.6 — Bible §5/§8 "Student clustering / k-means": built for real, gated to n>=30 students exactly as the bible specifies (below that, the bucket simply doesn't appear — no fake/noisy clustering shown on small demo classes).
    - v3.5 — Bible gap-fill (Project Bible §5 "Outlier detection, z-score, both directions"): the "Peer Outlier" checkbox has existed in AI_FEATURES since early versions but nothing ever computed it — toggling it did nothing.
    - v3.4 — Analysis loader paced up slightly.
    - v3.3 — Two fixes. (1) toast() was double-printing its status icon — the CSS (.toast.success/.error/.warn::before) already injects ✓/✕/⚠, but the JS toast() function was ALSO prepending its…
    - v3.2 — Three bug fixes. (1) renderHomePage() reset every piece of import state EXCEPT the "Run Analysis" button itself, so removing the only uploaded file (resetHomeImport ->…
    - v3.1 — Revision 2 overrides (§10.1-10.5 of the BUILD spec): Upload Data panel (panel-data) deleted entirely, along with every function that only ever targeted its DOM…
    - v3.0 — Home-first redesign + multi-file/dashboard/chart/copy pass, per the "STUDENT INSIGHT — HOME-FIRST REDESIGN + THEME — BUILD SPEC": (1) Home rebuilt as a single centered focal action —…
    - v2.6 — Bug fixes found via full end-to-end testing against a real sample workbook (Sample_04, Class 7 Section B, 10 students, 5 subjects, 4 tests): afterAllCompareFilesLoaded(),…
    - v2.4 — Auto-run flow: the Analyse/checkbox screen is no longer a manual stop.
    - v2.3 — Smart Reveal: Dashboard step (Institution+non-Compare mode) now opens on a 5-bucket screen (My Whole Class / One Student / One Subject / Who Needs Help / Top Performers) instead of…
    - v2.2 — UI/UX pass (design tokens, dark-mode variables, WCAG-AA color/contrast fixes, full button/form/table/modal state coverage, 44px touch targets, keyboard-activation fix on…
    - v2.1 — PIB restructured into numbered sections (format adapted from Spend-na's PIB); added §10 NOT BUILT and §11 AI AGENT RULES (both new — Spend-na had them, Student Insight's PIB didn't);…
    - v2.0 — logo dedup (~368KB/31% size cut), removed 2 dead functions, PIB compressed from prose->index format.
    - v1.9 — narrative fields redesigned (5 honest/severity-scaled fields replacing 6 overlapping ones), marks-table Total/opted column + Class Avg row, percentile suppressed <12 students, "needs…
    - v1.8 — Management View for Compare Mode (multi-class grid/KPIs/ weak-subjects/flagged-sections, auto-activates at 2+ classes) + 8 bug fixes (dead Save button removed, stale validation-error…
    - v1.7 — sample-file link filenames fixed (repo renamed with "_For_").
    - v1.6 — custom domain move to studin.in; 3 hardcoded URLs updated; service worker/manifest already env-aware, needed no changes.
    - v1.5 — Compare Sections routing fix: goes straight to upload step instead of forcing Setup re-entry; first file's own SETUP tab becomes the shared schema automatically.
    - v1.4 — first-load Institution/Individual mode prompt; New Project preserves last-used mode instead of forcing Institution; Compare Sections card hides in Individual mode.
    - v1.3 — "Update Existing Sheet" merge feature (add Test 2/3 without losing Test 1 data); removed always-blank "Parent: --" PDF line.
    - v1.2 — 7 generic analytics add-ons on existing data columns: best/ worst test, subject-vs-class delta, rank movement, "first time below pass" flag, report-card-comment field, attendance-vs-…
    - v1.1 — mark-overflow cap, Export gate, scrollable data-issue banner, session-name-badge clearing, growth-rate clamp (all in §2 now, not repeated here).
    - v1.0 — baseline: grouped-header detection, formula-injection stripping, competition ranking, gender-gap privacy floor.
════════════════════════════════════════════════════════════════════════
```
