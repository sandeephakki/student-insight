# Sample Files

These 10 workbooks power the "Sample Files" screen (Home → Sample Files) and are
fetched live from https://studin.in/<filename> by `runSampleFile()` in
`js/render-dashboard.js` — this local folder is the source copy to upload there.

All 10 use the current multi-tab schema: SETUP / STUDENTS / one tab per test / README.

| # | File | Mode | Students | Tests |
|---|---|---|---|---|
| 1 | Sample_1_For_UPSC_IAS_Coaching.xlsx | Institution | 30 | 4 (Prelims x2, Mains x2 @200) |
| 2 | Sample_2_For_MBBS_College_Lecturer.xlsx | Institution | 30 | 4 (Internals/Practical/Sendup, mixed scale) |
| 3 | Sample_3_For_International_Masters_College.xlsx | Institution | 30 | 4 Module Assessments @100 |
| 4 | Sample_4_For_School_Class_Teacher.xlsx | Institution | 30 | 4 (Unit Tests @50, Mid-Term/Final @100) |
| 5 | Sample_5_For_Individual_Two_Children.xlsx | Individual | 2 (deliberate — not scaled up) | 4 Terms @100 |
| 6 | Sample_6_For_Individual_UPSC_Aspirant.xlsx | Individual | 1 (deliberate — not scaled up) | 4 (Prelims/Mains @200) |
| 7-9 | Sample_7/8/9_..._Section_A/B/C_Class7.xlsx | Compare | 30 each | identical schema (required for Compare Sections) |
| 10 | Sample_10_For_Large_Scale_100_Students.xlsx | Institution | **100** | **10** monthly exams @100 — scale showcase, no deliberate errors |

Sample 10 is intentionally clean (0 hard errors, 0 warnings when run through
validateData()) — it's meant to show the app performing well at real
institutional scale, not to test error-handling. For a deliberately
edge-case-loaded stress file instead, see STRESS_TEST_REPORT.md from an earlier
session (not included here).

Every mark cell across all 10 files is clamped within its configured max marks
(verified programmatically, 0 violations) and every file has been run through
the real `parseWorkbookSheets → validateData → parseStudents` pipeline in Node
to confirm they import cleanly.
