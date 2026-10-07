// bal/smart-plan/prompt-builder.js  (Smart Planner task 02)
// Pure logic, no DOM. Produces the XML prompt the teacher pastes into any web LLM.
//
// PRIVACY MODEL: only the Student ID ever appears. Student names and the institution name are
// NEVER emitted - any occurrence inside free text (remarks, chapter, test names) is scrubbed too.
import { hasValidMark, isEnteredMark } from './eligibility.js';

const PROMPT_FILE_SUFFIX = '_smart-planner-prompt.xml';
const OUTPUT_LABELS = ['Summary:', 'SubjectNotes:', 'FocusAreas:', 'NextSteps:', 'ParentNote:'];

// One place for the file-name convention (same sanitisation as generateTemplate()/safeFileName()).
function promptFileName(uploadedBasename) {
  const base = String(uploadedBasename || 'StudIn').replace(/\.[^.\\/]+$/, '').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_') || 'StudIn';
  return base + PROMPT_FILE_SUFFIX;
}

function newToken() {
  let hex;
  if (typeof crypto !== 'undefined' && crypto.randomUUID) hex = crypto.randomUUID().replace(/-/g, '');
  else if (typeof crypto !== 'undefined' && crypto.getRandomValues) hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  else hex = Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10).padEnd(8, '0')).join('');
  return 'SP-' + hex.slice(0, 16).toUpperCase();
}

const xe = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Words to scrub from any free text sent to the LLM: the student's own name (full + each part) and the institution.
function scrubber(student, instName) {
  const terms = new Set();
  const add = t => { t = String(t || '').trim(); if (t.length >= 2) terms.add(t); };
  add(student && student.name); String((student && student.name) || '').split(/\s+/).forEach(add);
  add(instName); String(instName || '').split(/\s+/).filter(w => w.length >= 4).forEach(add);
  const list = [...terms].sort((a, b) => b.length - a.length);
  if (!list.length) return s => s;
  const re = new RegExp('(^|[^\\p{L}\\p{N}])(' + list.map(reEsc).join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
  return s => String(s || '').replace(re, (m, pre) => pre + '[removed]');
}

const WRONG_RIGHT = "WRONG: 'Mathematics dipped during the Grammar - Tenses lesson' (Grammar - Tenses is an English chapter, never attribute it to Mathematics). RIGHT: state Mathematics' score trend with no chapter claim if no Mathematics chapter was logged for that test.";

function instructionsBlock(token, lang, count) {
  return `<instructions>
<validation_token>${token}</validation_token>
You are an expert, encouraging teacher and learning coach. Below is evidence for ${count} student${count === 1 ? '' : 's'}: raw marks per subject per test, the chapter each subject's paper covered (where logged), the teacher's own remark (where given) and absence days. Only the tests listed are included - the ones the teacher selected. No conclusions are pre-computed.
For EACH student work out, for yourself: where they stand overall and subject by subject; which named chapters line up with weaker or stronger scores; whether a pattern is isolated to one subject or broad. Write every student on their own terms - a real turnaround, a consistently strong student and a student in genuine difficulty must not share the same structure of praise, concern or phrasing. Keep the tone hopeful and practical, but if a remark already flags urgency ("at risk of failing", "please involve parents") treat it seriously and do not soften it.
Ground every sentence in the evidence. Never invent scores, chapters, remarks, causes or names.

OUTPUT FORMAT (strict):
1. The very first line: the validation token above, copied exactly, alone on the line.
2. Then ALL students in ONE response, one block each, nothing outside the blocks:
[[STUDENT:<id>]]
Summary: one or two sentences on where this student stands right now, overall
SubjectNotes: one short line per subject - "<Subject>: trend + the specific chapter by name, only where the chapter rule allows"
FocusAreas: 1-3 things to work on (or, for a strong student, to extend), naming real chapters/topics from the evidence
NextSteps: 3-5 concrete, doable actions before the next test, referencing the chapters above where relevant
ParentNote: one specific paragraph a parent could read as-is; match the tone to the real situation
[[/STUDENT]]
3. Copy each <student id> EXACTLY as given - never a name (none is provided). Every student gets exactly one block.
4. The labels (Summary:, SubjectNotes:, FocusAreas:, NextSteps:, ParentNote:) and ids stay in English. Write all other text in ${xe(lang)}.

CHAPTER RULE (read twice): a chapter belongs to a SUBJECT on a TEST - the whole class sat the same paper. It appears ONLY as the chapter="..." attribute of that subject's <marks> tag (never on a student's other subjects). Use a chapter only for the subject whose <marks> tag carries it, and only for the test it is inside. If a <marks> tag has no chapter attribute, no chapter was logged for that subject on that test: say nothing chapter-specific there - score and trend only. (Older files may instead carry one bare <chapter> element per test, with no subject; for those, work out the owning subject from the chapter's own name and never cite it under another subject.)
${WRONG_RIGHT}
A shared score dip across subjects on one test is NOT evidence that they share a chapter. Most subjects on most tests may have NO chapter evidence, and that is expected.
If a subject is persistently weak across tests and that student has NO chapter evidence for it anywhere, do not invent a chapter. You may infer a likely foundational gap from standard grade-level teaching (for example persistently near-zero Mathematics: multiplication/division fluency; persistently weak Science: core vocabulary and concept recall) and must say in the same sentence that it is a general inference from the score pattern, never a logged fact.
A score of 0 is a real entered mark (not a missing one): treat it as meaningful and address it directly and kindly.

FINAL STEP: offer your complete result as a downloadable plain-text file (.txt) in exactly this format, validation token on the first line, so the teacher can upload it. Do not reply only in chat.
</instructions>`;
}

// eligible: [{id, tests:[testName]}]  (from computeEligibility)
// students: roster with testData;  setup: {instName,className,section,year,passThreshold,subjects,tests:[{name,maxMarks}]}
// opts: {outputLanguage}
// returns { xmlString, validationToken, evidence, studentIds }
//   evidence[id] = { chapters:[sentChapterName,...], chapterSubjects:{chapter:[subjects that logged it]}, subjects:[...] }
//     - exactly what was serialised (the parser checks claims against it; [] subjects = legacy chapter of unknown subject)
//   testNames = test names as sent (prefix-stripped); subjects = class subject list
function buildPrompt(eligible, students, setup, opts) {
  setup = setup || {};
  const lang = (opts && opts.outputLanguage) || 'English';
  const token = newToken();
  const byId = new Map((students || []).map(s => [s.id, s]));
  const maxByTest = new Map((setup.tests || []).map(t => [t.name, t.maxMarks || {}]));
  const evidence = {};
  const studentIds = [];
  const testNames = [];
  // sheet names look like "Class7A-Unit Test 1": drop the class/section prefix (same rule as Compare mode)
  const clsPrefix = (String(setup.className || '') + String(setup.section || '')).replace(/[^a-zA-Z0-9]/g, '').slice(0, 18).toLowerCase();
  const shortTest = n => (clsPrefix && String(n).toLowerCase().startsWith(clsPrefix + '-')) ? String(n).slice(clsPrefix.length + 1) : String(n);
  const nameScrub = scrubber(null, setup.instName);
  const parts = [];
  for (const e of eligible || []) {
    const st = byId.get(e.id);
    if (!st) continue;
    const scrub = scrubber(st, setup.instName);
    const ev = { chapters: [], chapterSubjects: {}, subjects: [] };
    const subjSeen = new Set();
    const testXml = [];
    for (const tn of e.tests || []) {
      const td = (st.testData || {})[tn];
      if (!td || !hasValidMark(td)) continue;           // trimmed per-student evidence
      const max = maxByTest.get(tn) || {};
      const short = shortTest(tn);                      // computed once per test
      const chs = td.chapters || {};                    // SUBJECT-wise: the chapter this subject's paper covered (same for the whole class)
      const marks = Object.keys(td.marks || {}).filter(sub => isEnteredMark(td.marks[sub]))   // a real 0 IS sent (see eligibility.js)
        .map(sub => {
          subjSeen.add(sub);
          const ch = chs[sub] ? scrub(String(chs[sub]).trim()) : '';
          if (ch) { ev.chapters.push(ch); (ev.chapterSubjects[ch] = ev.chapterSubjects[ch] || []).includes(sub) || ev.chapterSubjects[ch].push(sub); }
          return `<marks subject="${xe(scrub(sub))}" score="${td.marks[sub]}" max="${(max[sub] || 100)}"${ch ? ` chapter="${xe(ch)}"` : ''}/>`;
        });
      let inner = marks.join('');
      if (!Object.keys(chs).length && td.chapter) {      // LEGACY workbook: one student-wise chapter, subject unknown
        const lc = scrub(String(td.chapter).trim());
        if (lc) { inner += `<chapter>${xe(lc)}</chapter>`; ev.chapters.push(lc); if (!ev.chapterSubjects[lc]) ev.chapterSubjects[lc] = []; }
      }
      const rk = td.remark ? scrub(String(td.remark).trim()) : '';
      if (rk) inner += `<remark>${xe(rk)}</remark>`;
      if (td.absents > 0) inner += `<absentDays>${td.absents}</absentDays>`;
      testXml.push(`<test name="${xe(nameScrub(scrub(short)))}">${inner}</test>`);
      if (!testNames.includes(short)) testNames.push(short);
    }
    if (!testXml.length) continue;
    ev.subjects = [...subjSeen];
    evidence[st.id] = ev; studentIds.push(st.id);
    parts.push(`<student id="${xe(st.id)}">${testXml.join('')}</student>`);
  }
  const subs = (setup.subjects || []).map(s => nameScrub(s));
  const cls = `<class section="${xe(setup.section || '')}" className="${xe(setup.className || '')}" academicYear="${xe(setup.year || '')}" passThresholdPct="${xe(setup.passThreshold != null ? setup.passThreshold : '')}">\n  <subjects>${xe(subs.join(', '))}</subjects>\n</class>`;
  const xmlString = `<smart_planner_prompt>\n${instructionsBlock(token, lang, studentIds.length)}\n${cls}\n<students>\n${parts.join('\n')}\n</students>\n</smart_planner_prompt>\n`;
  return { xmlString, validationToken: token, evidence, studentIds, testNames, subjects: subs };
}

export { buildPrompt, promptFileName, PROMPT_FILE_SUFFIX, OUTPUT_LABELS, WRONG_RIGHT };
