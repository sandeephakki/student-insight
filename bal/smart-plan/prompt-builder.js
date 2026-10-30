// bal/smart-plan/prompt-builder.js  (Smart Planner task 02)
// Pure logic, no DOM. Produces the XML prompt the teacher pastes into any web LLM.
//
// PRIVACY MODEL: only the Student ID ever appears. Student names and the institution name are
// NEVER emitted - any occurrence inside free text (remarks, chapter, test names) is scrubbed too.
import { hasValidMark, isEnteredMark } from './eligibility.js';
import { computeTrend, trendXml } from './trend.js';
import { exampleBlockFor } from './prompt-examples.js';
import { GENERIC_INSTITUTION_WORDS } from './quality-config.js';

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

const GENERIC = new Set(GENERIC_INSTITUTION_WORDS);
const xe = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Words to scrub from any free text sent to the LLM: the student's own name (full + each part) and the institution.
function scrubber(student, instName) {
  const terms = new Set();
  const add = t => { t = String(t || '').trim(); if (t.length >= 2) terms.add(t); };
  add(student && student.name); String((student && student.name) || '').split(/\s+/).forEach(add);
  // The full institution name is always scrubbed; its individual words only when distinctive. Generic words
  // (school, public, college, academy...) are normal vocabulary in remarks ("extra classes after school") - keep them.
  add(instName); String(instName || '').split(/\s+/).filter(w => w.length >= 4 && !GENERIC.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))).forEach(add);
  const list = [...terms].sort((a, b) => b.length - a.length);
  if (!list.length) return s => s;
  const re = new RegExp('(^|[^\\p{L}\\p{N}])(' + list.map(reEsc).join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
  return s => String(s || '').replace(re, (m, pre) => pre + '[removed]');
}

const WRONG_RIGHT = "WRONG: 'Mathematics dipped during the Grammar - Tenses lesson' (Grammar - Tenses is an English chapter, never attribute it to Mathematics). RIGHT: state Mathematics' score trend with no chapter claim if no Mathematics chapter was logged for that test.";

// Kind-tone charter: a report card can lift a child up or weigh on them for years. Applies in every output language.
const TONE_CHARTER = `TONE CHARTER (applies to every line, in every language): your words may be read by a child and their parents, and a report can lift a child up or weigh on them for years. So:
(1) Write as a warm coach who believes this child can grow.
(2) Open each Summary and ParentNote with something genuinely good in the evidence (a strength, an improvement, a best subject, effort). Even for very low marks, honour the effort and say that every child grows at their own pace. Never invent achievements.
(3) Describe gaps as "the next step to grow" or "a good place to build". Give small, joyful, doable steps.
(4) Avoid harsh or labelling words such as fail, failing, weak, poor, bad, worst, lazy, behind, struggling, at risk, alarming, hopeless, collapse. Never rank the child or compare them with classmates, and never blame the child, the parent or the teacher.
(5) Mention a dip gently ("a small dip, which happens to every learner") but keep every number and the trend truthful.
(6) A score of 0 or close to it is a starting point, not a verdict: say so kindly, name the smallest first step, and end with hope.
(7) End each ParentNote with a hopeful, specific picture of what this child can become by following the steps.`;

const EXAMPLE_BLOCK = `[[STUDENT:EXAMPLE01]]
Summary: Steady, dependable results with real strengths, and one small dip in the last test that is easy to turn around.
SubjectNotes: Mathematics: 55%, 57%, 58%, 41%. A lovely steady start; the Final Exam chapter 'Ratio and Proportion' is the next place to build confidence.
SubjectNotes: Science: 62%, 60%, 63%, 61%. Wonderfully steady; no chapter logged for the later tests.
(...one SubjectNotes line for every other subject...)
FocusAreas: Building confidence in Ratio and Proportion in Mathematics, where a little happy practice will go a long way.
NextSteps: Enjoy three Ratio and Proportion questions each day and check each answer against the working.
NextSteps: Invite the child to explain one solved example aloud to a parent every weekend, and celebrate it together.
NextSteps: Try a short, friendly quiz on Ratio and Proportion before the next unit test.
ParentNote: Your child has been steady overall and has real strengths to be proud of; one topic, Ratio and Proportion, is the next step to grow, and with a few happy minutes of daily practice your child can bring it up to match the rest.
[[/STUDENT]]`;

function instructionsBlock(token, lang, count, redo) {
  const nonEn = !!lang && String(lang).trim().toLowerCase() !== 'english';
  const langTag = nonEn ? `\n<output_language>${xe(lang)}</output_language>` : '';
  const langTop = nonEn ? `\nOUTPUT LANGUAGE - READ FIRST: write the content of EVERY line (Summary, each SubjectNotes line, FocusAreas, NextSteps, ParentNote) in ${xe(lang)}, not English. Only these stay exactly as given, never translated: the validation token, the [[STUDENT:<id>]] and [[/STUDENT]] markers, the five labels, the subject name at the start of each SubjectNotes line (copy it exactly as it appears in the <marks subject="..."> tags, in English), and chapter names (quote them exactly as given inside the ${xe(lang)} sentence). Numbers and percentages stay as digits. The worked example below is in English only to show the layout.\n` : '';
  const langRule = nonEn ? `Write all other text in ${xe(lang)} (see OUTPUT LANGUAGE above). Do not answer in English.` : `Write all other text in ${xe(lang)}.`;
  const example = (nonEn && exampleBlockFor(lang)) || EXAMPLE_BLOCK;
  const exampleNote = example !== EXAMPLE_BLOCK ? ` (shown in ${xe(lang)}: your answer must read like this)` : '';
  const inLang = nonEn ? ` in ${xe(lang)}` : '';
  const langCheck = nonEn ? ` Also check that all prose is in ${xe(lang)}.` : '';
  const redoText = redo ? `\nSECOND PASS: this is a re-ask for only the students listed in <redo>. Your earlier answer for them had the problems named there. Write each of them again from the evidence below, fixing every listed problem, in exactly the same output format.\n` : '';
  return `<instructions>
<validation_token>${token}</validation_token>${langTag}
You are an expert, encouraging teacher and learning coach. Below is evidence for ${count} student${count === 1 ? '' : 's'}: raw marks per subject per test, the chapter each subject's paper covered (where logged), the teacher's own remark (where given), absence days and one computed <trend> line. Only the tests listed are included - the ones the teacher selected.
The <trend> line is computed by the app from the marks, so treat it as FACT and never contradict it (its "overall" values are the overall percentage per test, in test order; "direction" says whether the student is improving, steady or declining). Everything else - causes, patterns, what to do - you must work out yourself.${langTop}${redoText}
For EACH student work out, for yourself: where they stand overall and subject by subject; which named chapters line up with weaker or stronger scores; whether a pattern is isolated to one subject or broad. Write every student on their own terms - a real turnaround, a consistently strong student and a student in genuine difficulty must not share the same structure of praise, concern or phrasing. Keep the tone hopeful and practical, but if a remark already flags urgency ("at risk of failing", "please involve parents") treat it seriously and do not soften it.
Ground every sentence in the evidence. Never invent scores, chapters, remarks, causes or names.

${TONE_CHARTER}

FOLLOW LITERALLY: do not ask questions, do not add commentary, and do not substitute your default language, layout or length for anything written here. If an instruction seems unusual, follow it exactly anyway.

OUTPUT FORMAT (strict):
1. The very first line: the validation token above, copied exactly, alone on the line.
2. Then ALL students in ONE reply, in the same order as the input, one block each, nothing outside the blocks. EVERY line inside a block starts with one of the five labels below and holds exactly ONE item. Never join two items on one line with ';' or '|'. Never wrap a line onto the next one.
Block shape (this is the exact shape, using the example's wording only to show the layout):
[[STUDENT:<id>]]
Summary: <1-2 sentences${inLang} on where this student stands right now, overall>
SubjectNotes: <Subject>: <the percentage for each test in order, e.g. 78%, 60%, 38%, 13%>. <what it means${inLang}; chapter by name only where the chapter rule allows>
SubjectNotes: <next subject> ... (exactly ONE SubjectNotes line for EACH subject that has a <marks> tag for that student)
FocusAreas: <one thing to work on or, for a strong student, to extend${inLang}; name a chapter>   (1-3 lines)
NextSteps: <one concrete, doable action before the next test${inLang}; name a chapter>   (3-5 lines)
ParentNote: <one paragraph${inLang}, on ONE line, written to the parent>
[[/STUDENT]]
3. Copy each <student id> EXACTLY as given - never a name (none is provided). Every student gets exactly one block. In ParentNote speak to the parent and say "your child" - never write the student id there. Be honest and hopeful; if a remark says "at risk of failing" you may quote it, but never describe the child as a failure.
4. The labels (Summary:, SubjectNotes:, FocusAreas:, NextSteps:, ParentNote:) and ids stay in English. ${langRule}

EVIDENCE RULES: every SubjectNotes line quotes that subject's percentage for each test, in test order. Name a chapter (its exact text) whenever that subject's <marks> tag carries one. Every FocusAreas and NextSteps line names a chapter that appears in THIS student's own evidence for THEIR weakest subject-tests; if none exists, name the subject and the foundation skill and say it is an inference.
WRITE EACH STUDENT BY HAND: do not use code, scripts, templates or loops. No two students may share a sentence. Each student's text must contain at least one score or chapter that belongs only to them.

CHAPTER RULE (read twice): a chapter belongs to a SUBJECT on a TEST - the whole class sat the same paper. It appears ONLY as the chapter="..." attribute of that subject's <marks> tag (never on a student's other subjects). Use a chapter only for the subject whose <marks> tag carries it, and only for the test it is inside. If a <marks> tag has no chapter attribute, no chapter was logged for that subject on that test: say nothing chapter-specific there - score and trend only. (Older files may instead carry one bare <chapter> element per test, with no subject; for those, work out the owning subject from the chapter's own name and never cite it under another subject.)
${WRONG_RIGHT}
A shared score dip across subjects on one test is NOT evidence that they share a chapter. Most subjects on most tests may have NO chapter evidence, and that is expected.
If a subject is persistently weak across tests and that student has NO chapter evidence for it anywhere, do not invent a chapter. You may infer a likely foundational gap from standard grade-level teaching (for example persistently near-zero Mathematics: multiplication/division fluency; persistently weak Science: core vocabulary and concept recall) and must say in the same sentence that it is a general inference from the score pattern, never a logged fact.
A score of 0 is a real entered mark (not a missing one): treat it as meaningful and address it directly and kindly.

EXAMPLE ONLY - never reuse its wording or its id${exampleNote}:
${example}

SELF-CHECK before you answer: there is one block per <student> tag (count them); every block has exactly one SubjectNotes line per subject, 1-3 FocusAreas lines and 3-5 NextSteps lines.${langCheck} Fix any block that fails, then answer.

FINAL STEP: if you can create files, attach ONE plain-text file (.txt) containing exactly the reply described above. If you cannot attach a file, print the ENTIRE reply inside ONE code block (\`\`\`text ... \`\`\`) and nothing before or after it. The first line inside it is the validation token.
</instructions>`;
}

// The rules that get broken most, repeated AFTER the data: in a long prompt the last lines are the ones followed most reliably.
function finalReminder(token, lang) {
  const nonEn = !!lang && String(lang).trim().toLowerCase() !== 'english';
  return `<final_reminder>
Before you answer, re-read these. They override your defaults:
1. First line of your answer: ${token} (copied exactly, alone on the line).
2. One [[STUDENT:<id>]] ... [[/STUDENT]] block per <student>, in input order; every line inside starts with one of the five labels and holds ONE item.${nonEn ? `
3. LANGUAGE: the content of every line is written in ${xe(lang)}. Not English. English stays only for the token, markers, labels, subject names and chapter names.` : ''}
${nonEn ? '4' : '3'}. Use the <trend> line as fact. Use chapters only as the CHAPTER RULE allows. Never print a student id inside a sentence.
${nonEn ? '5' : '4'}. If you cannot attach a .txt file, print the whole answer in ONE \`\`\`text code block and nothing else.
TONE: kind, hopeful and strengths-first in every line. No words like fail, weak, poor, behind, at risk; no rankings or comparisons; even a zero is a starting point, not a verdict.
</final_reminder>`;
}

// eligible: [{id, tests:[testName]}]  (from computeEligibility)
// students: roster with testData;  setup: {instName,className,section,year,passThreshold,subjects,tests:[{name,maxMarks}]}
// opts: {outputLanguage, token?: reuse this validation token (re-ask for flagged students keeps the same session),
//        redo?: {studentId: [problem text,...]} -> marks this as a second pass for just those students}
// returns { xmlString, validationToken, evidence, studentIds }
//   evidence[id] = { chapters:[sentChapterName,...], chapterSubjects:{chapter:[subjects that logged it]}, subjects:[...] }
//     - exactly what was serialised (the parser checks claims against it; [] subjects = legacy chapter of unknown subject)
//   testNames = test names as sent (prefix-stripped); subjects = class subject list
function buildPrompt(eligible, students, setup, opts) {
  setup = setup || {};
  const lang = (opts && opts.outputLanguage) || 'English';
  const token = (opts && opts.token) || newToken();
  const redo = (opts && opts.redo) || null;
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
    const testXml = []; const trendRows = [];
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
      const entered = {}; Object.keys(td.marks || {}).forEach(sub => { if (isEnteredMark(td.marks[sub])) entered[sub] = td.marks[sub]; });
      trendRows.push({ marks: entered, max });
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
    const tr = computeTrend(trendRows);                 // facts only; same numbers the verifier later checks the Summary against
    if (tr) ev.trend = { series: tr.series, direction: tr.direction, netChange: tr.netChange, lastStep: tr.lastStep, weakest: tr.weakest };
    evidence[st.id] = ev; studentIds.push(st.id);
    parts.push(`<student id="${xe(st.id)}">${trendXml(tr, scrub, xe)}${testXml.join('')}</student>`);
  }
  const subs = (setup.subjects || []).map(s => nameScrub(s));
  const cls = `<class section="${xe(setup.section || '')}" className="${xe(setup.className || '')}" academicYear="${xe(setup.year || '')}" passThresholdPct="${xe(setup.passThreshold != null ? setup.passThreshold : '')}">\n  <subjects>${xe(subs.join(', '))}</subjects>\n</class>`;
  const redoXml = redo ? '<redo>\n' + studentIds.filter(id => redo[id] && redo[id].length).map(id => `<student id="${xe(id)}">${xe(redo[id].join(' '))}</student>`).join('\n') + '\n</redo>\n' : '';
  const xmlString = `<smart_planner_prompt>\n${instructionsBlock(token, lang, studentIds.length, !!redo)}\n${redoXml}${cls}\n<students>\n${parts.join('\n')}\n</students>\n${finalReminder(token, lang)}\n</smart_planner_prompt>\n`;
  return { xmlString, validationToken: token, evidence, studentIds, testNames, subjects: subs, language: lang };
}

export { buildPrompt, promptFileName, PROMPT_FILE_SUFFIX, OUTPUT_LABELS, WRONG_RIGHT };
