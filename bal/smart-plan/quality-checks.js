// bal/smart-plan/quality-checks.js  (Smart Planner task 15, amendment A5) - pure logic, no DOM.
// Every LLM reply is treated as untrusted: each parsed student gets quality flags, so the teacher can re-ask ONLY those students.
//   quality item = { code, params }          (codes: see REDO_CODES in quality-config.js, plus info code 'id_sanitised')
// Chapter-claim flags (wrong_subject / fabricated) stay in student.flags exactly as before; they are listed together with
// the quality items by redoPlan() so one "re-ask" prompt covers both.
import { FOCUS_MIN, FOCUS_MAX, NEXTSTEPS_MIN, NEXTSTEPS_MAX, MIN_NOTE_CHARS, NOTES_WITH_NUMBERS_MIN_SHARE, REUSE_MIN_STUDENTS, REUSE_MIN_CHARS, REUSE_FLAG_MIN_SENTENCES, ID_REPLACEMENT_PARENT, ID_REPLACEMENT_OTHER, DECLINE_WORDS, IMPROVE_WORDS, REDO_CODES, LANGUAGE_SCRIPTS, LANGUAGE_MIN_SHARE, LATIN_SCRIPT_LANGUAGES, ENGLISH_FUNCTION_WORDS, ENGLISH_SHARE_MAX } from './quality-config.js';
import { isDecline, isImprove } from './trend.js';

const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = words => new RegExp('\\b(?:' + words.map(reEsc).join('|') + ')[a-z]*', 'i');
const DECLINE_RE = wordRe(DECLINE_WORDS), IMPROVE_RE = wordRe(IMPROVE_WORDS);

// ---- ID sanitising: the LLM must never print a student id in prose (it is printed on the PDF) ----
function sanitiseIds(student, allIds) {
  const ids = [...new Set((allIds || []).concat(student.id).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!ids.length) return { student, changed: false };
  const re = new RegExp('(^|[^A-Za-z0-9])(' + ids.map(reEsc).join('|') + ')(?![A-Za-z0-9])', 'gi');
  let changed = false;
  const fix = (txt, rep) => String(txt == null ? '' : txt).replace(re, (m, pre) => { changed = true; return pre + rep; });
  const out = { ...student };
  out.parentNote = fix(student.parentNote, ID_REPLACEMENT_PARENT);
  out.summary = fix(student.summary, ID_REPLACEMENT_OTHER);
  out.focusAreas = (student.focusAreas || []).map(x => fix(x, ID_REPLACEMENT_OTHER));
  out.nextSteps = (student.nextSteps || []).map(x => fix(x, ID_REPLACEMENT_OTHER));
  out.subjectNotes = {}; for (const k of Object.keys(student.subjectNotes || {})) out.subjectNotes[k] = fix(student.subjectNotes[k], ID_REPLACEMENT_OTHER);
  return { student: out, changed };
}

// ---- output language: share of the student's letters written in the requested script (null = not checkable) ----
const ENGLISH_WORDS = new Set(ENGLISH_FUNCTION_WORDS);
function languageShare(st, language) {
  const lang = String(language || '').trim().toLowerCase();
  const text = [st.summary, st.parentNote].concat(Object.values(st.subjectNotes || {}), st.focusAreas || [], st.nextSteps || []).join(' ');
  if (LATIN_SCRIPT_LANGUAGES.includes(lang)) {              // German/French: share of NON-English words (English function words = it answered in English)
    const words = (text.toLowerCase().match(/\p{L}+/gu) || []).filter(w => w.length > 1);
    if (!words.length) return null;
    const en = words.filter(w => ENGLISH_WORDS.has(w)).length / words.length;
    return en >= ENGLISH_SHARE_MAX ? Math.min(LANGUAGE_MIN_SHARE - 0.01, 1 - en) : 1;
  }
  const range = LANGUAGE_SCRIPTS[lang];
  if (!range) return null;
  const letters = text.match(/[\p{L}\p{M}]/gu) || [];     // Indic vowel signs and viramas are marks, not letters: count both or the share exceeds 100%
  if (!letters.length) return null;
  const inScript = text.match(new RegExp('[' + range + ']', 'g')) || [];
  return inScript.length / letters.length;
}

// ---- per-student checks ----
function checkStudent(st, ev, subjects, language) {
  const q = [];
  const expected = (ev && ev.subjects && ev.subjects.length ? ev.subjects : subjects) || [];
  const notes = st.subjectNotes || {};
  const lcNotes = {}; Object.keys(notes).forEach(k => { lcNotes[k.toLowerCase()] = notes[k]; });
  const missing = expected.filter(s => String(lcNotes[s.toLowerCase()] || '').trim().length < MIN_NOTE_CHARS);
  if (missing.length) q.push({ code: 'missing_subject_notes', params: { n: expected.length - missing.length, total: expected.length, subjects: missing.join(', ') } });
  const nf = (st.focusAreas || []).length, ns = (st.nextSteps || []).length;
  if (!nf) q.push({ code: 'empty_field', params: { field: 'FocusAreas' } });
  else if (nf < FOCUS_MIN) q.push({ code: 'too_few_focus', params: { n: nf } });
  else if (nf > FOCUS_MAX) q.push({ code: 'too_many_focus', params: { n: nf } });
  if (!ns) q.push({ code: 'empty_field', params: { field: 'NextSteps' } });
  else if (ns < NEXTSTEPS_MIN) q.push({ code: 'too_few_steps', params: { n: ns } });
  else if (ns > NEXTSTEPS_MAX) q.push({ code: 'too_many_steps', params: { n: ns } });
  const present = expected.filter(s => !missing.includes(s));
  if (present.length) {
    const withNum = present.filter(s => /\d/.test(lcNotes[s.toLowerCase()] || '')).length;
    if (withNum / present.length < NOTES_WITH_NUMBERS_MIN_SHARE) q.push({ code: 'no_scores_cited', params: { n: withNum, total: present.length } });
  }
  const share = languageShare(st, language);
  if (share !== null && share < LANGUAGE_MIN_SHARE) q.push({ code: 'wrong_language', params: { language, pct: Math.round(share * 100) } });
  const tr = ev && ev.trend;
  if (tr && st.summary) {
    const dec = DECLINE_RE.test(st.summary), imp = IMPROVE_RE.test(st.summary);
    if ((isDecline(tr.direction) && imp && !dec) || (isImprove(tr.direction) && dec && !imp)) q.push({ code: 'trend_contradiction', params: { direction: tr.direction, series: (tr.series || []).join('>') } });
  }
  return q;
}

// ---- cross-student reuse (templating) ----
const sentenceList = st => {
  const parts = [st.summary, st.parentNote].concat(Object.values(st.subjectNotes || {}), st.focusAreas || [], st.nextSteps || []);
  const out = [];
  for (const p of parts) for (const s of String(p || '').split(/(?<=[.!?])\s+|\n+/)) { const n = s.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} %'-]/gu, '').trim(); if (n.length >= REUSE_MIN_CHARS) out.push(n); }
  return [...new Set(out)];
};
function reuseCounts(students) {
  const by = new Map();
  for (const id of Object.keys(students)) for (const s of sentenceList(students[id])) { if (!by.has(s)) by.set(s, new Set()); by.get(s).add(id); }
  const out = {};
  for (const id of Object.keys(students)) out[id] = sentenceList(students[id]).filter(s => by.get(s).size >= REUSE_MIN_STUDENTS).length;
  return out;
}

// students: { id: {id, summary, subjectNotes, ...} } - returns a NEW map with sanitised text and .quality filled in.
// ctx: { expectedIds, evidence, subjects }
function applyQuality(students, ctx) {
  const out = {}; const allIds = (ctx && ctx.expectedIds) || Object.keys(students);
  for (const id of Object.keys(students)) {
    const { student, changed } = sanitiseIds(students[id], allIds);
    const q = checkStudent(student, ((ctx && ctx.evidence) || {})[id], (ctx && ctx.subjects) || [], ctx && ctx.language);
    if (changed) q.push({ code: 'id_sanitised', params: {} });
    out[id] = { ...student, quality: q };
  }
  const reuse = reuseCounts(out);
  for (const id of Object.keys(out)) if (reuse[id] >= REUSE_FLAG_MIN_SENTENCES) out[id].quality.push({ code: 'reused_sentences', params: { n: reuse[id] } });
  return out;
}

// English text for the re-ask prompt (the prompt itself is always English; the UI shows its own translated wording).
function redoText(item) {
  const p = item.params || {};
  switch (item.code) {
    case 'missing_subject_notes': return `SubjectNotes had only ${p.n} of ${p.total} subjects; write exactly one SubjectNotes line for EACH subject (missing: ${p.subjects}).`;
    case 'too_few_focus': return `FocusAreas had ${p.n} line(s); write 1-3.`;
    case 'too_many_focus': return `FocusAreas had ${p.n} lines; write at most 3.`;
    case 'too_few_steps': return `NextSteps had ${p.n} line(s); write 3-5, one per line.`;
    case 'too_many_steps': return `NextSteps had ${p.n} lines; write at most 5.`;
    case 'empty_field': return `${p.field} was empty.`;
    case 'no_scores_cited': return `SubjectNotes quoted scores for only ${p.n} of ${p.total} subjects; quote each subject's percentage for every test, in order.`;
    case 'trend_contradiction': return `The Summary contradicted the computed trend (${p.series}, ${p.direction}); the trend is fact.`;
    case 'wrong_language': return `The reply was NOT written in ${p.language} (only ${p.pct}% of the text was). Write every line's content in ${p.language}; only the token, markers, labels, subject names and chapter names stay in English.`;
    case 'reused_sentences': return `${p.n} sentences were identical to other students' text; write this student individually, using their own scores and chapters.`;
    case 'chapter_claim': return `A chapter was attributed to the wrong subject or was not in this student's evidence (${p.chapter || ''}); use only chapters from this student's own <marks> tags, under the subject that logged them.`;
    case 'not_in_result': return 'No usable block was returned for this student; write the full block.';
    default: return '';
  }
}

// Which students are worth re-asking, and why. result = parseResponse()/mergeResults() output.
function redoPlan(result) {
  const reasons = {};
  const add = (id, item) => { (reasons[id] = reasons[id] || []).push(item); };
  for (const id of (result.needRegenerate || [])) add(id, { code: 'not_in_result', params: {} });
  for (const id of Object.keys(result.students || {})) {
    const st = result.students[id];
    for (const it of st.quality || []) if (REDO_CODES.includes(it.code)) add(id, it);
    const ch = (st.flags || []).filter(f => f.chapter);
    if (ch.length) add(id, { code: 'chapter_claim', params: { chapter: [...new Set(ch.map(f => f.chapter))].join(', ') } });
  }
  const ids = Object.keys(reasons);
  const texts = {}; ids.forEach(id => { texts[id] = reasons[id].map(redoText).filter(Boolean); });
  return { ids, reasons, texts };
}

export { applyQuality, checkStudent, sanitiseIds, reuseCounts, redoPlan, redoText };
