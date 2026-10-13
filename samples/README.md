# Sample Files

These workbooks power the "Sample Files" screen (Home → Sample Files) and are
fetched live from https://studin.in/<filename> by `runSampleFile()` in
`js/render-dashboard.js` — this local folder is the source copy to upload there.

Samples 1-6 and 8-11 use the current, real, live-parseable multi-tab schema:
SETUP / STUDENTS / one tab per test / README. Sample 7 is different — see its
own section below.

## Tab naming convention

Every per-test tab is named `<Class/Batch prefix>-<Test Name>` (e.g.
`Class7A-Unit Test 1`, `Batch2026-Prelims Mock 1`), and SETUP's `Test N Name`
cell is kept in exact sync with the tab name — the real parser
(`APP.rawData[t.name]` in compute-engine.js) matches a test to its sheet by
exact string equality, not by position, so these two must always match. This
prefix convention loosely previews the `<PeriodLabel>-Test<N>` MARKS-tab
naming the continuity feature (prompt-01 onward) designed for real multi-period
files — applied here to ordinary single-period files just for readability, not
because these files carry multiple periods.

| # | File | Mode | Type | Students | Tests |
|---|---|---|---|---|---|
| 1-3 | Sample_01/02/03_..._Section_A/B/C_Class7.xlsx | Compare | Primary School | 30 each | identical schema (required for Compare Sections) |
| 4 | Sample_04_For_PUC_Junior_College.xlsx | Institution | College / University (II PUC Science PCMB) | 32 | 3 (Unit Test @50, 2 Preparatory Exams @100) |
| 5 | Sample_05_For_Large_Scale_100_Students.xlsx | Institution | Coaching Centre (PUC II PCM batch) | **100** | **10** monthly exams @100 — scale showcase, no deliberate errors |
| 6 | Sample_06_For_MBBS_College_Lecturer.xlsx | Institution | College / University | 30 | 4 (Internals/Practical/Sendup, mixed scale) |
| 8 | Sample_08_For_International_Masters_College.xlsx | Institution | College / University | 30 | 4 Module Assessments @100 |
| 9 | Sample_09_For_UPSC_IAS_Coaching.xlsx | Institution | Coaching Centre | 30 | 4 (Prelims x2, Mains x2 @200) |
| 10 | Sample_10_For_Individual_School_Going_Child.xlsx | Individual | — | 1 (deliberate — not scaled up), Class 6 | 4 Terms @100 |
| 11 | Sample_11_For_School_Scholarship_Eligibility.xlsx | Institution | Primary School (Class 7, Scholarship module) | 31 | 4 (2 Unit Tests @50, Mid-Term/Final @100) |

(7 is the Continuity file — see its own section below, out of numeric order in this table since it uses a different schema.)

Sample 5 is intentionally clean (0 hard errors, 0 warnings when run through
validateData()) — it's meant to show the app performing well at real
institutional scale, not to test error-handling. For a deliberately
edge-case-loaded stress file instead, see STRESS_TEST_REPORT.md from an earlier
session (not included here).

Every mark cell across samples 1-6 and 8-11 is clamped within its configured max marks
and every file has been checked against the real `Test N Name` ↔ sheet-name
matching rule the live parser depends on (`parseWorkbookSheets` →
`autoInferSetup` → the `APP.rawData[t.name]` lookup in compute-engine.js).

## Sample 11 — School with Scholarship Eligibility Data

`Sample_11_For_School_Scholarship_Eligibility.xlsx` is Institution mode, Class 7,
31 students, 4 tests (2 Unit Tests @50, Mid-Term & Final @100), with the
Scholarship module turned on (`Enable Scholarship Module: Yes`, Merit-cum-Need
scheme) and the STUDENTS tab extended with the columns that module needs:
Category, Annual Family Income, Guardian Occupation, Prior Scholarship Status,
Persistent Student ID, and Special Category Flag. Use it to try the
Scholarship Eligibility engine and completeness grid rather than the plain
academic dashboard.

## Sample 7 — Engineering College, Semester 1-5 (CONTINUITY — now live, v4.36)

`Sample_07_For_Engineering_College_Sem1to5_CONTINUITY.xlsx` is **not** built on
the schema above — it uses the multi-period schema the continuity feature arc
(prompt-01 through prompt-05) designed on paper: SETUP's repeated `Period N
...` block, one shared STUDENTS roster across all periods, and MARKS tabs
literally named `<PeriodLabel>-Test<N>`. As of v4.36 the app can actually read
this: `parseContinuityPeriods()` (`js/template-upload.js`) parses SETUP's
"Period Count" and every `Period N ...` block, builds the real Continuity tab
data from it, and aliases the current (last) period's Subjects/Tests onto the
normal single-period parsing path so the rest of the app (KPIs, heatmap,
flags, PDF export) analyses Semester 5 exactly like any other file. Upload it
through the normal Import flow — it now behaves like the other samples, plus a
live Continuity tab, instead of being fixture-only.

Verified (v4.36) against the real `.xlsx` bytes, not a fixture: all 5
semesters parsed, ENG011/ENG012's leaver gaps and ENG013/ENG014's joiner gaps
both read correctly, the 18-student roster correctly narrows to the 16
actually enrolled in Semester 5 for the detailed dashboard, 0 data issues.

Listed in the in-app "Sample Files" quick-try picker as Sample 7 — that list
fetches from `https://studin.in/<filename>`, so it only works live once this
file is uploaded there. Until then, use "Import Filled Excel" / drag-and-drop
with your own downloaded copy of this file instead of the one-click picker.

Shape: 1 CSE cohort (Hakki Institute of Engineering, "College / University"),
18 students tracked across 5 semesters. Two students (ENG011/ENG012) leave
after Semester 2 — their rows simply stop appearing in later MARKS tabs, which
IS the roster-diff signal, no separate diff table. Two more (ENG013/ENG014)
join starting Semester 3 — no rows in Semester 1-2 tabs. Each semester's
subject list is almost entirely different from the one before it (real
engineering curriculum progression), matching the "near-total turnover"
contrast case the dashboard/PDF Journey work was built and tested against.
