# Smart Planner v2 fixtures

- `sample-3students.response.txt` - real LLM response for 3 students (Class 7A); the v2 tests derive other layouts from it in code.
- Real three-LLM runs, owner-supplied (Sample_04, II PUC Science A, 32 students, English prompt):
  `puc2a-prompt.xml`, `puc2a-chatgpt.txt`, `puc2a-gemini.txt`, `puc2a-claude.txt`.
  Add a new set by naming files `<prefix>-prompt.xml` and `<prefix>-<anything>.txt|.rtf`; `test-smart-plan-v2.mjs` discovers every set and asserts:
  all students parsed, token ok, every subject note present, no citation junk, nothing flagged for re-ask.
  (Fixtures keep the evidence trend from the prompt's SERIES, judged with the current trend rule.)
- Still wanted: a real Gemini `.rtf` saved by Mac TextEdit (the RTF path is tested only with an RTF built in code).

Manual E2E in the real UI (browser): generate prompt -> upload each output (and paste it) -> confirm panel on a changed token ->
wrong-class block -> .docx rejection -> re-ask flagged students -> Generate Reports -> open 2 PDFs.
