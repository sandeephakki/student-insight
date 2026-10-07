// bal/smart-plan/response-parser.js  (Smart Planner task 03)
// Pure logic, no DOM. Parses the LLM result file, verifies it against what was actually sent.
//
// Control flow (the order matters - do not reorder):
//   1. normalise text (cosmetic only)  2. TOKEN GATE (hard reject, nothing below runs)
//   3. per-block parse, each in its own try/catch  4. ID reconciliation  5. evidence containment
import { OUTPUT_LABELS } from './prompt-builder.js';

const FIELD_KEYS = { 'Summary:': 'summary', 'SubjectNotes:': 'subjectNotes', 'FocusAreas:': 'focusAreas', 'NextSteps:': 'nextSteps', 'ParentNote:': 'parentNote' };
const TOKEN_RE = /SP-[0-9A-F]{16}/;

// ---------- step 1: cosmetic normalisation ----------
// Some LLM file exports write non-ASCII characters as literal \uXXXX text (seen in a real result) - decode them.
function decodeEscapes(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}
function normalise(raw) {
  let t = String(raw == null ? '' : raw).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/\\u[0-9a-fA-F]{4}/.test(t)) t = decodeEscapes(t);
  t = t.split('\n').filter(l => !/^\s*```[\w-]*\s*$/.test(l)).join('\n');   // markdown code fences
  return t;
}
const stripMd = l => l.replace(/[`*_>"'\u201C\u201D\u2018\u2019]/g, '').trim();

// ---------- step 2: token gate ----------
function checkToken(text, expectedToken) {
  const firstBlock = text.search(/\[\[STUDENT:/);
  const head = (firstBlock >= 0 ? text.slice(0, firstBlock) : text).split('\n').map(stripMd).filter(Boolean);
  if (head.includes(expectedToken)) return { ok: true };
  const seen = (head.join('\n').match(TOKEN_RE) || [])[0] || (text.match(TOKEN_RE) || [])[0];
  if (seen) return { ok: false, code: 'token_mismatch', reason: 'This result belongs to a different Smart Planner session (its validation token does not match the prompt you generated). Upload the result for the prompt generated in this session.' };
  return { ok: false, code: 'token_missing', reason: 'No Smart Planner validation token found at the top of this file. It does not look like a Smart Planner result for this session.' };
}

// ---------- step 3: block parsing ----------
function splitFields(body) {
  const labelRe = new RegExp('^[ \\t]*[*_`#>\\-]*\\s*(' + OUTPUT_LABELS.map(l => l.replace(':', '')).join('|') + ')\\s*:[*_`]*[ \\t]*', 'gm');
  const hits = [];
  let m;
  while ((m = labelRe.exec(body))) hits.push({ label: m[1] + ':', start: m.index, valStart: m.index + m[0].length });
  const out = {};
  hits.forEach((h, i) => {
    const key = FIELD_KEYS[h.label];
    const end = i + 1 < hits.length ? hits[i + 1].start : body.length;
    if (out[key] === undefined) out[key] = body.slice(h.valStart, end).trim();
  });
  return out;
}
// "- a\n- b", "1. a\n2. b" or inline "1. a 2. b" -> ["a","b"]; plain paragraph -> [paragraph]
function toList(text) {
  let t = String(text || '').trim();
  if (!t) return [];
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  const bullet = /^([-*\u2022]|\d+[.)])\s+/;
  if (lines.length > 1 && lines.filter(l => bullet.test(l)).length >= 2) {
    const items = []; lines.forEach(l => { if (bullet.test(l)) items.push(l.replace(bullet, '')); else if (items.length) items[items.length - 1] += ' ' + l; else items.push(l); });
    return items;
  }
  if (/^1[.)]\s/.test(t)) {              // inline "1. a 2. b": split ONLY at the next sequential number (so "up to 20) x" is safe)
    const cuts = []; let next = 2;
    const re = /\s(\d{1,2})[.)]\s/g; let m;
    while ((m = re.exec(t))) { if (+m[1] === next) { cuts.push({ at: m.index, len: m[0].length }); next++; } }
    if (cuts.length) {
      const out = []; let pos = 0;
      cuts.forEach(c => { out.push(t.slice(pos, c.at)); pos = c.at + c.len; }); out.push(t.slice(pos));
      return out.map(x => x.replace(/^\d{1,2}[.)]\s*/, '').trim()).filter(Boolean);
    }
  }
  return lines.length > 1 ? lines.map(l => l.replace(bullet, '')) : [t.replace(bullet, '')];
}
function parseBlocks(text) {
  const startRe = /\[\[STUDENT:\s*([^\]\s]+?)\s*\]\]/g;
  const starts = []; let m;
  while ((m = startRe.exec(text))) starts.push({ id: m[1], at: m.index, bodyStart: m.index + m[0].length });
  const blocks = []; const failures = []; const dupes = [];
  starts.forEach((s, i) => {
    try {
      const limit = i + 1 < starts.length ? starts[i + 1].at : text.length;
      const slice = text.slice(s.bodyStart, limit);
      const close = slice.indexOf('[[/STUDENT]]');
      if (close < 0) { failures.push({ id: s.id, reason: 'Block is cut off (missing [[/STUDENT]]).' }); return; }
      const f = splitFields(slice.slice(0, close));
      const missing = Object.values(FIELD_KEYS).filter(k => !f[k]);
      if (missing.length) { failures.push({ id: s.id, reason: 'Missing field(s): ' + missing.join(', ') + '.' }); return; }
      if (blocks.some(b => b.id === s.id)) { dupes.push(s.id); return; }
      blocks.push({ id: s.id, summary: f.summary, subjectNotesRaw: f.subjectNotes, focusAreas: toList(f.focusAreas), focusAreasRaw: f.focusAreas, nextSteps: toList(f.nextSteps), parentNote: f.parentNote });
    } catch (e) {
      failures.push({ id: s.id, reason: 'Could not be parsed (' + (e && e.message ? e.message : 'error') + ').' });
    }
  });
  return { blocks, failures, dupes, found: starts.map(s => s.id) };
}

// ---------- step 5: evidence containment ----------
const LANG_RE = /kannada|hindi|marathi|tamil|telugu|malayalam|sanskrit|urdu|bengali|gujarati|punjabi|odia|assamese/i;
const CAT_SUBJECT = { math: /math|arithmetic|algebra/i, science: /science|physics|chemistry|biology/i, english: /english/i, social: /social|history|geograph|civics/i, language: LANG_RE };
const LEX = {
  math: [['fraction', 2], ['decimal', 2], ['equation', 2], ['algebra', 2], ['angle', 2], ['geometry', 2], ['triangle', 2], ['perimeter', 2], ['area', 1], ['ratio', 2], ['proportion', 2], ['integer', 2], ['percent', 2], ['mensuration', 2], ['arithmetic', 2], ['exponent', 2], ['symmetry', 2], ['probability', 2], ['statistics', 2], ['multiplication', 2], ['division', 1], ['factor', 1], ['number', 1], ['lines', 1]],
  science: [['nutrition', 2], ['plant', 2], ['animal', 2], ['weather', 2], ['climate', 1], ['motion', 2], ['force', 2], ['acid', 2], ['bases', 1], ['salts', 1], ['heat', 2], ['light', 1], ['sound', 2], ['electric', 2], ['magnet', 2], ['cell', 1], ['respiration', 2], ['photosynthesis', 2], ['matter', 1], ['atom', 2], ['chemical', 2], ['reaction', 1], ['ecosystem', 2], ['digestion', 2], ['organ', 1], ['soil', 1]],
  english: [['tense', 2], ['grammar', 2], ['letter writing', 2], ['reading comprehension', 2], ['comprehension', 2], ['poem', 2], ['essay', 2], ['noun', 2], ['verb', 2], ['adjective', 2], ['vocabulary', 2], ['punctuation', 2], ['paragraph', 1]],
  social: [['history', 2], ['geography', 2], ['civics', 2], ['democracy', 2], ['government', 2], ['constitution', 2], ['mughal', 2], ['medieval', 2], ['ancient', 1], ['empire', 2], ['resources', 1], ['agriculture', 2], ['trade', 1]],
  language: [['vyakarana', 3], ['vyakaran', 3], ['padya', 3], ['pathya', 3], ['gadya', 3], ['kavya', 3], ['sandhi', 3], ['samasa', 3], ['varnamale', 3], ['sahitya', 3]],
};
// Mechanical owner lookup: returns the ONE class subject that owns the chapter, or null when unknown/ambiguous.
function chapterOwner(chapter, subjects) {
  const c = String(chapter || '').toLowerCase();
  let best = null, bestScore = 0, tie = false;
  for (const cat of Object.keys(LEX)) {
    const score = LEX[cat].reduce((a, [k, w]) => a + (c.includes(k) ? w : 0), 0);
    if (score > bestScore) { best = cat; bestScore = score; tie = false; } else if (score === bestScore && score > 0) tie = true;
  }
  if (!best || tie) return null;
  let cands = (subjects || []).filter(s => CAT_SUBJECT[best].test(s));
  if (best === 'language' && cands.length > 1) { const named = cands.filter(s => c.includes(s.toLowerCase())); cands = named.length === 1 ? named : []; }
  if (best === 'english') cands = cands.filter(s => !LANG_RE.test(s));
  return cands.length === 1 ? cands[0] : null;
}
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function splitSubjectNotes(raw, subjects) {
  const subs = [...subjects].sort((a, b) => b.length - a.length);
  if (!subs.length) return {};
  const re = new RegExp('(^|[\\s.;\\n])(' + subs.map(reEsc).join('|') + ')\\s*:', 'g');
  const marks = []; let m;
  while ((m = re.exec(raw))) marks.push({ subject: subs.find(s => s.toLowerCase() === m[2].toLowerCase()) || m[2], at: m.index + m[1].length, valStart: m.index + m[0].length });
  const out = {};
  marks.forEach((mk, i) => { const end = i + 1 < marks.length ? marks[i + 1].at : raw.length; if (out[mk.subject] === undefined) out[mk.subject] = raw.slice(mk.valStart, end).trim(); });
  return out;
}
const sentences = t => t.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
const QUOTED_RE = /["\u201C]([^"\u201D\n]{3,70})["\u201D]|(?:chapter|lesson|topic)s?\s+['\u2018]([^'\u2019\n]{3,70})['\u2019]/gi;

// flags: [{kind:'wrong_subject'|'fabricated', subject, chapter, owner?, sentence}]
function verifyEvidence(subjectSegments, evidence, subjects, testNames, vocabulary) {
  const evidenceChapters = (evidence && evidence.chapters) || [];
  const owners = (evidence && evidence.chapterSubjects) || {};            // exact: chapter -> subjects that logged it (sent in <marks chapter=...>)
  const flags = [];
  // Chapters that exist in the class data but were NOT sent for this student (e.g. their test was not selected,
  // or it belongs to another student). Citing one - quoted or not - is an unsupported claim.
  const sentLc = new Set((evidenceChapters || []).map(c => String(c).toLowerCase()));
  const notSent = [...new Set((vocabulary || []).map(c => String(c).trim()).filter(c => c.length >= 4 && !sentLc.has(c.toLowerCase())))];
  const known = (evidenceChapters || []).map(c => ({ name: c, lc: c.toLowerCase() }));
  const tests = (testNames || []).map(t => t.toLowerCase());
  for (const subject of Object.keys(subjectSegments)) {
    const seg = subjectSegments[subject]; const segLc = seg.toLowerCase();
    for (const ch of known) {
      if (!segLc.includes(ch.lc)) continue;
      // Subject-wise data tells us EXACTLY which subject(s) logged this chapter; only a legacy chapter (no subject
      // recorded) falls back to the keyword lexicon.
      const exact = owners[ch.name];
      let owner = null, wrong = false;
      if (exact && exact.length) { wrong = !exact.some(o => o.toLowerCase() === subject.toLowerCase()); owner = exact.join(' / '); }
      else { const lex = chapterOwner(ch.name, subjects); if (lex && lex.toLowerCase() !== subject.toLowerCase()) { wrong = true; owner = lex; } }
      if (wrong) {
        const sent = sentences(seg).find(s => s.toLowerCase().includes(ch.lc)) || seg;
        flags.push({ kind: 'wrong_subject', subject, chapter: ch.name, owner, sentence: sent });
      }
    }
    for (const ch of notSent) {
      if (!new RegExp('(^|[^\\p{L}\\p{N}])' + reEsc(ch) + '(?![\\p{L}\\p{N}])', 'iu').test(seg)) continue;
      const sent = sentences(seg).find(x => x.toLowerCase().includes(ch.toLowerCase())) || seg;
      flags.push({ kind: 'fabricated', subject, chapter: ch, sentence: sent });
    }
    let q; QUOTED_RE.lastIndex = 0;
    while ((q = QUOTED_RE.exec(seg))) {
      const cited = (q[1] || q[2] || '').trim(); const lc = cited.toLowerCase();
      if (!cited || known.some(k => k.lc === lc) || tests.includes(lc) || subjects.some(s => s.toLowerCase() === lc)) continue;
      if (/^\d+%?$/.test(cited) || !/[a-z]/i.test(cited)) continue;
      if (q[2] || /^[A-Z]/.test(cited)) {
        const sent = sentences(seg).find(s => s.includes(cited)) || seg;
        flags.push({ kind: 'fabricated', subject, chapter: cited, sentence: sent });
      }
    }
  }
  return flags;
}

const dedupeFlags = fl => { const seen = new Set(); return fl.filter(f => { const k = f.kind + '|' + f.subject + '|' + String(f.chapter).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };

// ---------- public API ----------
// ctx: { token, expectedIds:[...], evidence:{[id]:{chapters:[...]}}, subjects:[...], testNames:[...],
//        chapterVocabulary?:[every chapter name in the class data - lets us catch real chapters that were NOT sent for this student] }
function parseResponse(rawText, ctx) {
  const text = normalise(rawText);
  const gate = checkToken(text, ctx.token);
  if (!gate.ok) return { ok: false, code: gate.code, reason: gate.reason };          // nothing below runs
  const { blocks, failures, dupes, found } = parseBlocks(text);
  const expected = [...new Set(ctx.expectedIds || [])];
  const parsed = new Set(blocks.map(b => b.id)); const failed = new Set(failures.map(f => f.id)); const seen = new Set(found);
  const matched = expected.filter(id => parsed.has(id));
  const parseFailed = failures.filter(f => expected.includes(f.id));
  const missing = expected.filter(id => !seen.has(id));
  const unexpected = [...new Set(found.filter(id => !expected.includes(id)))];
  const subjects = ctx.subjects || [];
  const students = {};
  for (const b of blocks) {
    if (!expected.includes(b.id)) continue;
    const subjectNotes = splitSubjectNotes(b.subjectNotesRaw, subjects);
    const flags = dedupeFlags(verifyEvidence(subjectNotes, (ctx.evidence || {})[b.id] || {}, subjects, ctx.testNames, ctx.chapterVocabulary));
    students[b.id] = { id: b.id, summary: b.summary, subjectNotes, subjectNotesRaw: b.subjectNotesRaw, focusAreas: b.focusAreas, nextSteps: b.nextSteps, parentNote: b.parentNote, flags };
  }
  const needRegenerate = [...new Set([...missing, ...parseFailed.map(f => f.id)])];
  return { ok: true, matched, missing, parseFailed, unexpected, duplicates: dupes, needRegenerate, students, complete: needRegenerate.length === 0 && unexpected.length === 0 };
}

export { parseResponse, chapterOwner, splitSubjectNotes, toList, normalise, verifyEvidence };
