// bal/smart-plan/response-parser.js  (Smart Planner task 03, amended by tasks 12/13/15)
// Pure logic, no DOM. Parses the LLM result, verifies it against what was actually sent.
//
// Control flow (the order matters - do not reorder):
//   1. readable? (binary/empty -> code)   2. normalise text (RTF, BOM, CRLF, fences - cosmetic only)
//   3. per-block parse, each in its own try/catch (repeated labels are MERGED)
//   4. ID GATE (the hard gate: wrong class / no blocks -> blocked)   5. TOKEN = soft check (mismatch -> teacher confirms)
//   6. ID reconciliation   7. evidence containment   8. quality flags + ID sanitising
import { detectKind, normalise } from './result-text.js';
import { ID_OVERLAP_MIN_SHARE, TOKEN_HEAD_CHARS } from './quality-config.js';
import { applyQuality } from './quality-checks.js';

const LABEL_KEYS = { summary: 'summary', subjectnote: 'subjectNotes', focusarea: 'focusAreas', nextstep: 'nextSteps', parentnote: 'parentNote' };
const labelKey = raw => LABEL_KEYS[String(raw).toLowerCase().replace(/\s/g, '').replace(/s$/, '')];
const FIELD_KEYS_LIST = Object.values(LABEL_KEYS);
const TOKEN_ANY = /SP\s*[-\u2010-\u2015]\s*([0-9A-Fa-f]{16})/g;
const canonToken = hex => 'SP-' + hex.toUpperCase();

// ---------- step 5: token = SOFT check ----------
// 'ok' | 'different' | 'missing'. Case/dash/space tolerant. Looks in the head (before the first block) and the first
// TOKEN_HEAD_CHARS characters; an exact copy of OUR token anywhere in the text also counts.
function tokenStatus(text, expectedToken) {
  const want = String(expectedToken || '').toUpperCase();
  const first = text.search(/\[\[STUDENT:/);
  const head = (first >= 0 ? text.slice(0, first) : text.slice(0, TOKEN_HEAD_CHARS)) + '\n' + text.slice(0, TOKEN_HEAD_CHARS);
  const seen = [...head.matchAll(TOKEN_ANY)].map(m => canonToken(m[1]));
  if (seen.includes(want)) return { status: 'ok' };
  if (want && text.toUpperCase().includes(want)) return { status: 'ok' };
  if (seen.length) return { status: 'different', seen: seen[0] };
  return { status: 'missing' };
}

// ---------- step 3: block parsing ----------
// Every layout seen so far parses: label once then a list, label repeated on EVERY line, one-line fields with '|' or ';'.
const LABEL_RE_SRC = '^[ \\t]*[*_`#>\\-]*\\s*(Summary|Subject\\s?Notes?|Focus\\s?Areas?|Next\\s?Steps?|Parent\\s?Notes?)[*_`]*\\s*:[*_`]*[ \\t]*';
function splitFields(body) {
  const labelRe = new RegExp(LABEL_RE_SRC, 'gim');
  const hits = []; let m;
  while ((m = labelRe.exec(body))) hits.push({ key: labelKey(m[1]), start: m.index, valStart: m.index + m[0].length });
  const acc = {};
  hits.forEach((h, i) => {
    if (!h.key) return;
    const end = i + 1 < hits.length ? hits[i + 1].start : body.length;
    const val = body.slice(h.valStart, end).trim();
    if (val) (acc[h.key] = acc[h.key] || []).push(val);
  });
  const out = {};
  for (const k of Object.keys(acc)) out[k] = (k === 'summary' || k === 'parentNote') ? acc[k].join(' ') : acc[k].join('\n');   // repeated labels are merged, never dropped
  return out;
}
const SEP_TRIM = /^[\s|;,]+|[\s|;,]+$/g;
// "- a\n- b", "1. a\n2. b", "a | b", inline "1. a 2. b" -> ["a","b"]; plain paragraph -> [paragraph]
// opts.semi: a single line "a; b; c" of clearly separate sentences is split on ';' (focus/steps only)
function toList(text, opts) {
  let t = String(text || '').trim();
  if (!t) return [];
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  const bullet = /^([-*\u2022]|\d+[.)])\s+/;
  let items;
  if (lines.length > 1 && lines.filter(l => bullet.test(l)).length >= 2) {
    items = []; lines.forEach(l => { if (bullet.test(l)) items.push(l.replace(bullet, '')); else if (items.length) items[items.length - 1] += ' ' + l; else items.push(l); });
  } else if (/^1[.)]\s/.test(t)) {              // inline "1. a 2. b": split ONLY at the next sequential number (so "up to 20) x" is safe)
    const cuts = []; let next = 2;
    const re = /\s(\d{1,2})[.)]\s/g; let m;
    while ((m = re.exec(t))) { if (+m[1] === next) { cuts.push({ at: m.index, len: m[0].length }); next++; } }
    if (cuts.length) {
      const out = []; let pos = 0;
      cuts.forEach(c => { out.push(t.slice(pos, c.at)); pos = c.at + c.len; }); out.push(t.slice(pos));
      items = out.map(x => x.replace(/^\d{1,2}[.)]\s*/, '').trim()).filter(Boolean);
    }
  }
  if (!items) items = lines.length > 1 ? lines.map(l => l.replace(bullet, '')) : [t.replace(bullet, '')];
  const split = [];
  for (const it of items) {
    let parts = it.split(/\s+\|\s+/);
    if (parts.length === 1 && opts && opts.semi && items.length === 1) { const sp = it.split(/;\s+/); if (sp.length >= 2 && sp.every(x => x.length >= 15)) parts = sp; }
    parts.forEach(x => split.push(x));
  }
  return split.map(x => x.replace(SEP_TRIM, '').trim()).filter(Boolean);
}
function parseBlocks(text, canonId) {
  const startRe = /\[\[STUDENT:\s*([^\]\s]+?)\s*\]\]/g;
  const starts = []; let m;
  while ((m = startRe.exec(text))) starts.push({ id: canonId(m[1]), at: m.index, bodyStart: m.index + m[0].length });
  const blocks = []; const failures = []; const dupes = [];
  starts.forEach((s, i) => {
    try {
      const hasNext = i + 1 < starts.length;
      const limit = hasNext ? starts[i + 1].at : text.length;
      const slice = text.slice(s.bodyStart, limit);
      const close = slice.search(/\[\[\s*\/\s*STUDENT\s*\]\]/);
      // a missing closing tag is tolerated when another block follows (the next [[STUDENT:]] closes it); the LAST block must be closed
      if (close < 0 && !hasNext) { failures.push({ id: s.id, reason: 'Block is cut off (missing [[/STUDENT]]).' }); return; }
      const f = splitFields(close < 0 ? slice : slice.slice(0, close));
      const missing = FIELD_KEYS_LIST.filter(k => !f[k]);
      if (missing.length) { failures.push({ id: s.id, reason: 'Missing field(s): ' + missing.join(', ') + '.' }); return; }
      if (blocks.some(b => b.id === s.id)) { dupes.push(s.id); return; }
      blocks.push({ id: s.id, summary: f.summary, subjectNotesRaw: f.subjectNotes, focusAreas: toList(f.focusAreas, { semi: true }), focusAreasRaw: f.focusAreas, nextSteps: toList(f.nextSteps, { semi: true }), parentNote: f.parentNote });
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
const cleanNote = t => String(t || '').replace(/\s+/g, ' ').replace(/(^|\s)(?:[-*\u2022]|\d{1,2}[.)])\s*$/, '').replace(/[\s|;,]+$/g, '').replace(/^[\s|;,\-*\u2022]+/, '').trim();
function splitSubjectNotes(raw, subjects) {
  const subs = [...subjects].sort((a, b) => b.length - a.length);
  if (!subs.length) return {};
  raw = String(raw || '').replace(/\*\*|__|`/g, '');            // **Mathematics:** -> Mathematics:
  const re = new RegExp('(^|[\\s.;\\n|])(' + subs.map(reEsc).join('|') + ')\\s*:', 'g');
  const marks = []; let m;
  while ((m = re.exec(raw))) marks.push({ subject: subs.find(s => s.toLowerCase() === m[2].toLowerCase()) || m[2], at: m.index + m[1].length, valStart: m.index + m[0].length });
  const out = {};
  marks.forEach((mk, i) => { const end = i + 1 < marks.length ? marks[i + 1].at : raw.length; const v = cleanNote(raw.slice(mk.valStart, end)); if (out[mk.subject] === undefined && v) out[mk.subject] = v; });
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
// ctx: { token, expectedIds:[...], evidence:{[id]:{chapters:[...], subjects:[...], trend?}}, subjects:[...], testNames:[...],
//        language?: the output language the prompt asked for (checked by script, e.g. 'Kannada'),
//        chapterVocabulary?:[every chapter name in the class data - lets us catch real chapters that were NOT sent for this student] }
//
// Returns { ok:false, code } when the text cannot be used at all:
//   'empty' | 'unreadable_file' (binary) | 'no_blocks' (no [[STUDENT:..]] found) | 'wrong_class' (ids do not belong to this prompt)
// Otherwise { ok:true, code:'ok', tokenStatus:'ok'|'different'|'missing', needsConfirm, matched, missing, parseFailed, unexpected,
//             duplicates, needRegenerate, students, complete }.   needsConfirm = ids match but the validation token does not.
function parseResponse(rawText, ctx) {
  const kind = detectKind(rawText);
  if (kind === 'empty') return { ok: false, code: 'empty' };
  if (kind === 'binary') return { ok: false, code: 'unreadable_file' };
  const text = normalise(rawText);
  const expected = [...new Set(ctx.expectedIds || [])];
  const keyOf = x => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
  const expectedByKey = new Map(expected.map(id => [keyOf(id), id]));
  const canonId = id => expectedByKey.get(keyOf(id)) || id;          // "c7b001" / "C7B 001" -> the id we sent
  const { blocks, failures, dupes, found } = parseBlocks(text, canonId);
  if (!found.length) return { ok: false, code: 'no_blocks' };
  // ID GATE - the hard gate. Both models in every run copied the ids; a result for another class/prompt shares (almost) none.
  const foundSet = new Set(found);
  const overlap = expected.filter(id => foundSet.has(id)).length;
  if (expected.length && overlap / expected.length < ID_OVERLAP_MIN_SHARE) return { ok: false, code: 'wrong_class', expectedCount: expected.length, foundCount: foundSet.size, overlap };
  const tok = tokenStatus(text, ctx.token);                          // SOFT: a different/missing token with matching ids = teacher confirms
  const parsed = new Set(blocks.map(b => b.id)); const failed = new Set(failures.map(f => f.id)); const seen = foundSet;
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
  const checked = applyQuality(students, { expectedIds: expected, evidence: ctx.evidence, subjects, language: ctx.language });
  const needRegenerate = [...new Set([...missing, ...parseFailed.map(f => f.id)])];
  return { ok: true, code: 'ok', tokenStatus: tok.status, tokenSeen: tok.seen || '', needsConfirm: tok.status !== 'ok', matched, missing, parseFailed, unexpected, duplicates: dupes, needRegenerate, students: checked, complete: needRegenerate.length === 0 && unexpected.length === 0 };
}

export { parseResponse, chapterOwner, splitSubjectNotes, splitFields, toList, normalise, verifyEvidence, tokenStatus };
