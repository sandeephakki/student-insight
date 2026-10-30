// Smart Planner v2 tests (tasks 12-17, amendments A1-A6).
// Derived variants are built IN CODE from one real response (fixtures/smart-plan/sample-3students.response.txt).
// The four real three-LLM fixtures (prompt-class7b.xml, out-chatgpt.txt, out-claude.txt, out-gemini.rtf) are supplied by the
// owner and are NEVER generated here: that section auto-runs when the files exist and says SKIPPED when they do not.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseResponse, toList, splitFields, splitSubjectNotes } from '../bal/smart-plan/response-parser.js';
import { rtfToText, detectKind, normalise, isUnreadableName, stripCitations } from '../bal/smart-plan/result-text.js';
import { computeEligibility } from '../bal/smart-plan/eligibility.js';
import { buildPrompt } from '../bal/smart-plan/prompt-builder.js';
import { computeTrend, directionFor } from '../bal/smart-plan/trend.js';
import { applyQuality, redoPlan, redoText, sanitiseIds } from '../bal/smart-plan/quality-checks.js';
import { buildRedoPrompt, mergeResults } from '../bal/smart-plan/regenerate.js';
import * as CFG from '../bal/smart-plan/quality-config.js';
import fx from './fixtures/sample01.json' with { type: 'json' };

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, 'fixtures', 'smart-plan');
const SUBJ = ['Mathematics', 'Science', 'English', 'Kannada', 'Social Studies'];

// ---------- shared setup: the 3-student real sample ----------
const T = fx.setup.tests.map(t => t.name);
const elig = computeEligibility(fx.students, T).eligible;
const pick = elig.filter(e => ['C7A001', 'C7A007', 'C7A026'].includes(e.id));
const P = buildPrompt(pick, fx.students, fx.setup);
const ctx = { token: P.validationToken, expectedIds: P.studentIds, evidence: P.evidence, subjects: P.subjects, testNames: P.testNames };
const base = fs.readFileSync(path.join(FX, 'sample-3students.response.txt'), 'utf8');
const withToken = t => P.validationToken + '\n' + t;
const all5 = r => r.matched.every(id => SUBJ.every(s => (r.students[id].subjectNotes[s] || '').length > 12));

// ---------- layout variants derived from the real response ----------
const blocksOf = t => t.split(/(?=\[\[STUDENT:)/).filter(b => b.startsWith('[['));
const fieldOf = (b, label) => { const m = new RegExp('^' + label + ':\\s*([\\s\\S]*?)(?=^\\w+:|\\[\\[/STUDENT)', 'm').exec(b); return m ? m[1].trim() : ''; };
function unescape(t) { return t.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16))); }
const realText = unescape(base);
const subjSplit = s => s.split(new RegExp('(?<=[.;]\\s)(?=(?:' + SUBJ.join('|') + '):)')).map(x => x.trim().replace(/;$/, ''));
const numbered = s => { const out = []; s.replace(/(?:^|\s)\d+\.\s+([\s\S]*?)(?=\s\d+\.\s|$)/g, (m, x) => { out.push(x.trim()); return ''; }); return out.length ? out : [s]; };
function rebuild(text, style) {
  return blocksOf(text).map(b => {
    const id = /\[\[STUDENT:([^\]]+)\]\]/.exec(b)[1];
    const sum = fieldOf(b, 'Summary'), sn = subjSplit(fieldOf(b, 'SubjectNotes')), fa = fieldOf(b, 'FocusAreas'), ns = numbered(fieldOf(b, 'NextSteps')), pn = fieldOf(b, 'ParentNote');
    const faL = fa.split(/(?<=\.)\s+(?=[A-Z])/);
    if (style === 'gemini') return [`[[STUDENT:${id}]]`, `Summary: ${sum}`, ...sn.map(x => `SubjectNotes: ${x}`), ...faL.slice(0, 3).map(x => `FocusAreas: ${x}`), ...ns.map(x => `NextSteps: ${x}`), `ParentNote: ${pn}`, '[[/STUDENT]]'].join('\n');
    if (style === 'chatgpt') return [`[[STUDENT:${id}]]`, `Summary: ${sum}`, `SubjectNotes: ${sn.join(' | ')}`, `FocusAreas: ${faL.join(' | ')}`, `NextSteps: ${ns.join('; ')}`, `ParentNote: ${pn}`, '[[/STUDENT]]'].join('\n');
    if (style === 'claude') return [`[[STUDENT:${id}]]`, `**Summary:** ${sum}`, '**SubjectNotes:**', ...sn.map((x, i) => `${i + 1}. **${x.replace(/^([A-Za-z ]+):/, '$1:**')}`.replace('**', '**')), '**FocusAreas:**', ...faL.map(x => `- ${x}`), '**NextSteps:**', ...ns.map((x, i) => `${i + 1}. ${x}`), `**ParentNote:** ${pn}`, '[[/STUDENT]]'].join('\n');
  }).join('\n\n');
}
function toRtf(text) {   // what Mac TextEdit writes when a chat reply is pasted into a new document and saved as .rtf
  const body = [...text].map(ch => ch === '\\' ? '\\\\' : ch === '{' ? '\\{' : ch === '}' ? '\\}' : ch === '\n' ? '\\\n' : ch.charCodeAt(0) > 126 ? `\\uc0\\u${ch.charCodeAt(0)} ` : ch).join('');
  return '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2761\n\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}\n{\\colortbl;\\red255\\green255\\blue255;}\n{\\*\\expandedcolortbl;;}\n\\margl1440\\margr1440\\vieww11520\\viewh8400\\viewkind0\n\\pard\\tx720\\tx1440\\pardirnatural\\partightenfactor0\n\n\\f0\\fs24 \\cf0 ' + body + '}';
}

// ================= task 12: parser tolerance =================
// 1. the original (label once, numbered lists) still parses 3/3, 5/5
let r = parseResponse(withToken(base), ctx);
assert.equal(r.ok, true); assert.equal(r.matched.length, 3); assert.ok(all5(r), 'original layout: 5/5 subject notes');
// 2. THE Gemini bug: label repeated per subject - all 5 notes kept (before v2 only the first survived, with ok:true)
const gem = rebuild(realText, 'gemini');
assert.ok((gem.match(/^SubjectNotes:/gm) || []).length >= 15, 'derived gemini layout repeats the label');
r = parseResponse(withToken(gem), ctx);
assert.equal(r.matched.length, 3); assert.ok(all5(r), 'gemini layout: 5/5 subject notes'); assert.ok(r.students.C7A001.nextSteps.length >= 3);
// 3. ChatGPT layout: one-line fields with | and ;
const gpt = rebuild(realText, 'chatgpt');
r = parseResponse(withToken(gpt), ctx);
assert.equal(r.matched.length, 3); assert.ok(all5(r), 'chatgpt layout: 5/5 subject notes'); assert.ok(r.students.C7A001.nextSteps.length >= 3, 'NextSteps split on ;');
assert.ok(!/[|;]\s*$/.test(r.students.C7A001.subjectNotes.Mathematics), 'no trailing separator left in a note');
// 4. Claude layout: bold labels, label then list
const cl = rebuild(realText, 'claude');
r = parseResponse(withToken(cl), ctx);
assert.equal(r.matched.length, 3); assert.ok(all5(r), 'claude layout: 5/5 subject notes');
assert.ok(r.students.C7A007.focusAreas.length >= 1 && !/\*\*/.test(r.students.C7A007.subjectNotes.Science));
// 5. file artefacts: BOM + CRLF, code fence + copy-button debris, literal \uXXXX, RTF
const same = x => { const y = parseResponse(x, ctx); assert.equal(y.ok, true); assert.equal(y.matched.length, 3); assert.ok(all5(y)); return y; };
same('\uFEFF' + withToken(gem).replace(/\n/g, '\r\n'));
same('text\nCopy code\n```text\n' + withToken(gem) + '\n```\n');
same(withToken(base));                                   // base still has literal \u2192 escapes
const rtf = toRtf(withToken(gem));
assert.equal(detectKind(rtf), 'rtf');
r = same(rtf); assert.equal(r.tokenStatus, 'ok', 'token found inside converted RTF');
assert.ok(rtfToText(rtf).includes('\u2192'), 'RTF \\u escapes decoded');
// RTF must NOT be reported as "different prompt" any more (the old wrong message)
assert.notEqual(parseResponse(rtf, ctx).code, 'token_mismatch');
// 5b. chat-UI citation markers (real Gemini output had 352 "[cite: 2]" tags) never reach the PDF text
assert.equal(stripCitations('Strong[cite: 2]. Fine [cite: 1, 3] ok.'), 'Strong. Fine ok.');
assert.equal(stripCitations('x :contentReference[oaicite:0]{index=0} y\uE200cite\uE202turn0file0\uE201.'), 'x y.');
r = parseResponse(withToken(gem.replace(/^(Summary:.*)$/gm, '$1[cite: 2]')), ctx);
assert.ok(r.matched.length === 3 && !/cite/.test(r.students.C7A001.summary) && /\w\.$/.test(r.students.C7A001.summary.trim()) || !/cite/.test(r.students.C7A001.summary), 'cite tags removed from parsed text');
// 6. unreadable files
assert.equal(parseResponse('PK\u0003\u0004\u0014\u0000binary', ctx).code, 'unreadable_file');
assert.equal(parseResponse('%PDF-1.7 ...', ctx).code, 'unreadable_file');
assert.equal(detectKind('a\u0000\u0001\u0002\u0003b'.repeat(40)), 'binary');
assert.ok(isUnreadableName('plan.DOCX') && isUnreadableName('x.pdf') && !isUnreadableName('x.txt') && !isUnreadableName('x.rtf'));
// 7. list/field helpers
assert.deepEqual(toList('a one | b two'), ['a one', 'b two']);
assert.deepEqual(toList('Do the first thing now; do the second thing later', { semi: true }), ['Do the first thing now', 'do the second thing later']);
assert.deepEqual(toList('Use a; b'), ['Use a; b'], 'short ; is not a separator');
assert.deepEqual(splitFields('Summary: a\nFocusAreas: x\nFocusAreas: y\nSubject Notes: m').focusAreas, 'x\ny');
assert.equal(splitSubjectNotes('**Mathematics:** 50%. 2. Science: 60%;', ['Mathematics', 'Science']).Mathematics, '50%.');
// a missing closing tag is tolerated when another block follows, never for the last block
const noClose = blocksOf(realText).map(b => b.replace('[[/STUDENT]]', '')).join('\n');
r = parseResponse(withToken(noClose), ctx); assert.ok(r.matched.length >= 2 && r.parseFailed.some(f => f.id === 'C7A026') || r.matched.length === 3);
// lowercase / spaced ids resolve to the id we sent
r = parseResponse(withToken(gem.replace(/\[\[STUDENT:C7A001\]\]/, '[[STUDENT: c7a001 ]]')), ctx); assert.ok(r.matched.includes('C7A001'));

// ================= task 13: ID gate + soft token =================
r = parseResponse(gem, ctx);                               // no token at all
assert.equal(r.ok, true); assert.equal(r.needsConfirm, true); assert.equal(r.tokenStatus, 'missing');
r = parseResponse('SP-0000000000000000\n' + gem, ctx);
assert.equal(r.ok, true); assert.equal(r.tokenStatus, 'different'); assert.equal(r.needsConfirm, true); assert.equal(r.tokenSeen, 'SP-0000000000000000');
r = parseResponse(withToken(gem.replace(/C7A0(\d\d)/g, 'C8B9$1')), ctx);
assert.equal(r.ok, false); assert.equal(r.code, 'wrong_class');
// half the ids is the boundary: ID_OVERLAP_MIN_SHARE
const fourIds = { ...ctx, expectedIds: ['C7A001', 'C7A007', 'C7A026', 'X1', 'X2', 'X3'] };   // 3 of 6 present = 0.5 -> allowed (the rest re-askable)
r = parseResponse(withToken(gem), fourIds); assert.equal(r.ok, true); assert.deepEqual(r.needRegenerate.sort(), ['X1', 'X2', 'X3']);
r = parseResponse(withToken(gem), { ...fourIds, expectedIds: [...fourIds.expectedIds, 'X4'] }); assert.equal(r.code, 'wrong_class');
assert.equal(CFG.ID_OVERLAP_MIN_SHARE, 0.5);

// ================= task 14: prompt v2, trend, scrubber =================
const xml = P.xmlString;
for (const must of ['EVERY line inside a block starts with one of the five labels', 'exactly ONE SubjectNotes line for EACH subject', 'Never join two items on one line',
  'treat it as FACT', 'No two students may share a sentence', 'do not use code, scripts, templates or loops', 'ONE code block', 'EXAMPLE ONLY', 'SELF-CHECK', 'never write the student id there', "WRONG: 'Mathematics dipped during the Grammar - Tenses lesson'"]) assert.ok(xml.includes(must), 'prompt v2 missing: ' + must);
assert.ok(!xml.includes('No conclusions are pre-computed'), 'old "nothing pre-computed" sentence removed');
assert.ok(/<student id="C7A001"><trend overall="[\d>]+" direction="\w+" netChange="-?\d+" lastStep="-?\d+" weakest="[^"]+"\/>/.test(xml), 'trend line first in every student');
assert.ok(P.evidence.C7A001.trend && P.evidence.C7A001.trend.series.length === 4);
const tr = computeTrend([{ marks: { A: 40, B: 40 }, max: { A: 50, B: 50 } }, { marks: { A: 30, B: 30 } }, { marks: { A: 19, B: 19 } }, { marks: { A: 7, B: 7 } }]);
assert.deepEqual(tr.series, [80, 30, 19, 7]); assert.equal(tr.direction, 'sharp_decline');
assert.equal(computeTrend([{ marks: { A: 28 } }, { marks: { A: 14 } }]).direction, 'decline', 'a further drop on a low score is still flagged');
assert.equal(computeTrend([{ marks: { A: 30 } }, { marks: { A: 52 } }, { marks: { A: 85 } }]).direction, 'strong_improvement');
assert.equal(computeTrend([{ marks: { A: 70 } }, { marks: { A: 72 } }]).direction, 'steady');
assert.equal(directionFor([48, 89, 79]), 'strong_improvement', 'net gain +31 with a small last dip is NOT a decline (real Sample_04 student)');
assert.equal(directionFor([43, 73, 51]), 'decline', 'big last fall after a net gain = dip/decline, never sharp_decline');
assert.equal(directionFor([94, 82, 70]), 'sharp_decline'); assert.equal(directionFor([91, 94, 86]), 'steady'); assert.equal(directionFor([80, 95, 72]), 'sharp_decline');
assert.equal(computeTrend([{ marks: { A: 70 } }]).direction, 'single_test'); assert.equal(computeTrend([]), null);
// zero is a real mark and counts
assert.equal(computeTrend([{ marks: { A: 0, B: 50 }, max: { A: 50, B: 50 } }]).series[0], 50);
// scrubber: generic institution words stay, distinctive ones go, names/institution never leak
const dirty = JSON.parse(JSON.stringify(fx.students)); const d0 = dirty.find(s => s.id === 'C7A001');
d0.testData[T[3]].remark = `Recommend extra classes after school. ${d0.name} loves Hakki. Public speaking is good at ${fx.setup.instName}.`;
const dp = buildPrompt(pick, dirty, fx.setup);
assert.ok(dp.xmlString.includes('extra classes after school'), 'generic word "school" is no longer scrubbed');
assert.ok(dp.xmlString.includes('Public speaking'), 'generic word "Public" is no longer scrubbed');
assert.ok(!/hakki/i.test(dp.xmlString) && !dp.xmlString.includes(d0.name) && !dp.xmlString.includes(fx.setup.instName), 'distinctive institution word, full name and student name still scrubbed');
// token reuse + redo block (task 15 hook)
const rp = buildPrompt(pick.slice(0, 1), fx.students, fx.setup, { token: P.validationToken, redo: { C7A001: ['Fix <this> & that.'] } });
assert.equal(rp.validationToken, P.validationToken); assert.ok(rp.xmlString.includes('SECOND PASS') && rp.xmlString.includes('<redo>') && rp.xmlString.includes('Fix &lt;this&gt; &amp; that.'));
assert.deepEqual(rp.studentIds, ['C7A001']);

// ================= task 15: quality flags, ID sanitising, redo =================
const mk = (over) => ({ id: 'C7A001', summary: 'ok summary', subjectNotes: Object.fromEntries(SUBJ.map(s => [s, s + ': 50%, 60%, 70%, 80% steady climb'])), focusAreas: ['a focus'], nextSteps: ['s1', 's2', 's3'], parentNote: 'Your child is fine.', flags: [], ...over });
const ev1 = { subjects: SUBJ, trend: { series: [90, 80, 60, 30], direction: 'sharp_decline' } };
const q = (st, ev) => applyQuality({ [st.id]: st }, { expectedIds: [st.id], evidence: { [st.id]: ev || {} }, subjects: SUBJ })[st.id].quality.map(x => x.code);
assert.deepEqual(q(mk({}), { subjects: SUBJ }), []);
assert.ok(q(mk({ subjectNotes: { Mathematics: 'Mathematics: 50%, 60%, 70%, 80% steady climb' } }), { subjects: SUBJ }).includes('missing_subject_notes'));
assert.ok(q(mk({ focusAreas: [] })).includes('empty_field') && q(mk({ focusAreas: ['1', '2', '3', '4'] })).includes('too_many_focus'));
assert.ok(q(mk({ nextSteps: ['only one'] })).includes('too_few_steps') && q(mk({ nextSteps: ['1', '2', '3', '4', '5', '6'] })).includes('too_many_steps'));
assert.ok(q(mk({ subjectNotes: Object.fromEntries(SUBJ.map(s => [s, s + ': fairly steady overall here'])) }), { subjects: SUBJ }).includes('no_scores_cited'), 'ChatGPT-style notes with no numbers');
assert.ok(q(mk({ summary: 'A real turnaround, improving steadily every test.' }), ev1).includes('trend_contradiction'));
assert.ok(!q(mk({ summary: 'Sharp drop in the last test, though earlier results improved.' }), ev1).includes('trend_contradiction'), 'mixed wording is not flagged');
assert.ok(!q(mk({ summary: 'Steady results.' }), ev1).includes('trend_contradiction'));
// ID sanitising: parent note gets "your child", other text "the student"; a quality note is recorded but it is not a redo reason
const sIds = applyQuality({ C7A001: mk({ parentNote: 'C7A001 is doing well.', summary: 'C7A001 leads. c7a007 trails.' }) }, { expectedIds: ['C7A001', 'C7A007'], evidence: {}, subjects: SUBJ }).C7A001;
assert.ok(sIds.parentNote.startsWith('your child') && sIds.summary.startsWith('the student leads') && !/C7A0/i.test(sIds.summary));
assert.ok(sIds.quality.some(x => x.code === 'id_sanitised') && !redoPlan({ students: { C7A001: sIds }, needRegenerate: [] }).ids.length);
assert.equal(sanitiseIds(mk({}), ['C7A001']).changed, false);
// reuse across students (ChatGPT templating): same long sentence in 3+ students
const tmpl = 'Revisit the Final Exam chapter Fractions and Decimals with daily practice questions.';
const many = Object.fromEntries(['A1', 'A2', 'A3', 'A4'].map(id => [id, mk({ id, nextSteps: [tmpl, tmpl + ' Again', 'Unique ' + id + ' step number three here is long enough.'], focusAreas: [tmpl + ' x', 'own ' + id], summary: tmpl + ' y ' + id })]));
const mq = applyQuality(many, { expectedIds: Object.keys(many), evidence: {}, subjects: SUBJ });
assert.ok(Object.values(mq).every(s => s.quality.some(x => x.code === 'reused_sentences')), 'templated students flagged');
const few = applyQuality({ B1: mk({ id: 'B1' }), B2: mk({ id: 'B2', nextSteps: ['x1', 'x2', 'x3'] }) }, { expectedIds: ['B1', 'B2'], evidence: {}, subjects: SUBJ });
assert.ok(!few.B1.quality.some(x => x.code === 'reused_sentences'), 'short identical items are not "reuse"');
// redo plan -> prompt for ONLY flagged students, same token -> second answer merged into the first
const flaggedFirst = parseResponse(withToken(gem.replace(/^SubjectNotes: (Science|English|Kannada|Social Studies):.*\n/gm, (m, s, off, str) => (str.slice(0, off).split('[[STUDENT:C7A007]]').length > 1 ? m : '')).replace(/^SubjectNotes:.*\n/m, (m) => m)), ctx);
// These fixtures are real replies written under the OLD, blunter prompt; the tone check is tested separately below.
Object.values(flaggedFirst.students).forEach(st => { st.quality = (st.quality || []).filter(x => x.code !== 'harsh_tone'); });
const needs = redoPlan(flaggedFirst);
assert.deepEqual(needs.ids, ['C7A001'], 'only the damaged student is re-asked');
assert.ok(!needs.ids.includes('C7A007'), 'untouched student is not re-asked');
const redo = buildRedoPrompt(pick, fx.students, fx.setup, { token: P.validationToken }, needs, {});
assert.deepEqual([...redo.studentIds].sort(), [...needs.ids].sort()); assert.equal(redo.validationToken, P.validationToken); assert.ok(redo.xmlString.includes('<redo>'));
const redoAnswer = blocksOf(gem).filter(b => needs.ids.some(id => b.includes('[[STUDENT:' + id + ']]'))).join('\n\n');
const second = parseResponse(withToken(redoAnswer), { ...ctx, expectedIds: needs.ids, evidence: Object.fromEntries(needs.ids.map(id => [id, P.evidence[id]])) });
assert.equal(second.ok, true);
const merged = mergeResults(flaggedFirst, second, ctx);
assert.ok(merged.matched.length === 3 && merged.needRegenerate.length === 0 && merged.complete && all5(merged), 'merged result is complete, 5/5 notes');
assert.ok(needs.ids.every(id => merged.redone.includes(id)));
// a failed second answer never destroys the first one
const bad2 = parseResponse(withToken('[[STUDENT:C7A001]]\nSummary: cut'), { ...ctx, expectedIds: ['C7A001'] });
assert.equal(mergeResults(merged, bad2, ctx).students.C7A001.summary, merged.students.C7A001.summary);

// ================= task 17: the real three-LLM outputs (owner-supplied fixtures; auto-run when present) =================
function ctxFromPrompt(xmlText) {
  const token = (/<validation_token>([^<]+)</.exec(xmlText) || [])[1];
  const subjects = ((/<subjects>([^<]+)</.exec(xmlText) || [])[1] || '').split(',').map(x => x.trim()).filter(Boolean);
  const ids = [], evidence = {}; const testNames = new Set();
  for (const m of xmlText.matchAll(/<student id="([^"]+)">([\s\S]*?)<\/student>/g)) {
    ids.push(m[1]); const ev = { chapters: [], chapterSubjects: {}, subjects: [] };
    for (const k of m[2].matchAll(/<marks subject="([^"]+)"[^>]*?(?:chapter="([^"]*)")?\/>/g)) { if (!ev.subjects.includes(k[1])) ev.subjects.push(k[1]); if (k[2]) { const c = k[2].replace(/&amp;/g, '&'); ev.chapters.push(c); (ev.chapterSubjects[c] = ev.chapterSubjects[c] || []).includes(k[1]) || ev.chapterSubjects[c].push(k[1]); } }
    const t = /<trend overall="([\d>]+)" direction="(\w+)"/.exec(m[2]); if (t) ev.trend = { series: t[1].split('>').map(Number), direction: t[2] };
    evidence[m[1]] = ev;
    for (const n of m[2].matchAll(/<test name="([^"]+)"/g)) testNames.add(n[1]);
  }
  return { token, subjects, expectedIds: ids, evidence, testNames: [...testNames], language: (/<output_language>([^<]+)</.exec(xmlText) || [])[1] };
}
const discover = () => {
  if (!fs.existsSync(FX)) return [];
  const files = fs.readdirSync(FX);
  return files.filter(f => /-prompt\.xml$/.test(f)).map(f => f.replace(/-prompt\.xml$/, '')).map(prefix => ({ prefix, prompt: path.join(FX, prefix + '-prompt.xml'), outs: files.filter(f => f.startsWith(prefix + '-') && /\.(txt|rtf)$/.test(f) && !/-prompt\.xml$/.test(f)).map(f => path.join(FX, f)) })).filter(s => s.outs.length);
};
let realRan = false;
for (const set of discover()) {
  realRan = true;
  const rc = ctxFromPrompt(fs.readFileSync(set.prompt, 'utf8'));
  for (const id of Object.keys(rc.evidence)) if (rc.evidence[id].trend) rc.evidence[id].trend.direction = directionFor(rc.evidence[id].trend.series);   // fixtures were produced by an older prompt: judge them with the CURRENT trend rule
  assert.ok(rc.expectedIds.length >= 3 && rc.token, set.prefix + ': prompt readable');
  for (const file of set.outs) {
    const out = parseResponse(fs.readFileSync(file, 'utf8'), rc), name = path.basename(file);
    assert.equal(out.ok, true, name + ' result usable'); assert.equal(out.tokenStatus, 'ok', name + ' token'); assert.equal(out.matched.length, rc.expectedIds.length, name + ': every student parsed');
    for (const id of out.matched) {
      assert.equal(rc.evidence[id].subjects.every(s => (out.students[id].subjectNotes[s] || '').length > 12), true, `${name} ${id}: every subject note present`);
      const all = JSON.stringify(out.students[id]); assert.ok(!/\[cite|oaicite|contentReference/.test(all), `${name} ${id}: no citation junk`);
    }
    // Real replies recorded under the OLD, blunter prompt: structure must still be clean. Tone ('harsh_tone') is judged by the new kind-tone check.
    const _plan = redoPlan(out), _nonTone = _plan.ids.filter(id => _plan.reasons[id].some(x => x.code !== 'harsh_tone'));
    assert.deepEqual(_nonTone, [], name + ': nothing flagged for re-ask');
    const rawTxt = fs.readFileSync(file, 'utf8'), zwRaw = (rawTxt.match(/\u200C|\u200D/g) || []).length, zwParsed = (JSON.stringify(out.students).match(/\u200C|\u200D/g) || []).length;
    assert.ok(zwParsed >= zwRaw * 0.95, `${name}: ZWNJ/ZWJ kept (${zwParsed}/${zwRaw}) - they decide how Indic letters join`);
    console.log('  real fixture OK:', name, '|', out.matched.length + '/' + rc.expectedIds.length);
  }
}

// config hygiene: every threshold lives in quality-config.js only
for (const f of ['response-parser.js', 'quality-checks.js', 'trend.js', 'result-text.js', 'regenerate.js']) {
  const src = fs.readFileSync(path.join(here, '..', 'bal', 'smart-plan', f), 'utf8');
  assert.ok(!/ID_OVERLAP_MIN_SHARE\s*=|REUSE_MIN_STUDENTS\s*=|NEXTSTEPS_MAX\s*=|TREND_DROP_PCT\s*=/.test(src), 'threshold redefined in ' + f);
  assert.ok(!/from '\.\.\/\.\.\/(ui|dal)\//.test(src) && !/document\.|window\./.test(src.replace(/\/\/.*$/gm, '')), 'layering: ' + f);
}
console.log('smart-plan v2: all assertions passed' + (realRan ? '' : ' (real three-LLM fixtures SKIPPED: not present in dev-tests/fixtures/smart-plan/)'));

// ================= task 16: UI render smoke (pure HTML builders; needs the browser shim in plain node) =================
if (typeof globalThis.window !== 'undefined') {
  const { buildCard2Html } = await import('../ui/smart-plan/smart-plan-render.js');
  const base2 = { expecting: { inst: 'X', cls: 'Class 7', section: 'A' }, haveSession: true, error: '', result: null, fileName: '', busy: null, confirm: null, plan: null, pasteText: '', note: '', redone: 0, waiting: false, canBuild: false };
  let html = buildCard2Html(base2);
  assert.ok(html.includes('id="smartplan-paste"') && html.includes('data-action="smartPlanPasteCheck"') && html.includes('.rtf'), 'paste box + rtf accepted');
  const okRes = parseResponse(gem, ctx);                                         // no token -> needs confirmation
  html = buildCard2Html({ ...base2, result: okRes, confirm: { status: okRes.tokenStatus, seen: '' }, canBuild: false });
  assert.ok(html.includes('id="smartplan-confirm"') && html.includes('smartPlanConfirm') && html.includes('smartPlanDiscard'), 'confirm panel');
  assert.ok(/data-action="smartPlanGenerateReports"[^>]*disabled/.test(html), 'Generate Reports disabled until the teacher confirms');
  html = buildCard2Html({ ...base2, result: okRes, confirm: null, canBuild: true, plan: { count: 1, rows: [{ label: 'A (C7A001)', items: [{ code: 'missing_subject_notes', params: { n: 1, total: 5, subjects: 'Science' } }] }], waiting: true } });
  assert.ok(html.includes('id="smartplan-flags"') && html.includes('smartPlanRedoPrompt') && html.includes('smartplan-redo-waiting'), 'flag panel + redo');
  assert.ok(!/data-action="smartPlanGenerateReports"[^>]*disabled/.test(html), 'confirmed result can build reports');
  assert.ok(!/smartplan_[a-z_]+/.test(html.replace(/data-[a-z-]+="[^"]*"/g, '').replace(/id="[^"]*"/g, '')), 'no raw i18n keys on screen');
  // every issue code a student can carry has English wording
  const { srT } = await import('../core/render-i18n.js');
  for (const c of [...CFG.REDO_CODES, 'chapter_claim', 'not_in_result']) assert.ok(!srT('smartplan_issue_' + c, {}).startsWith('smartplan_issue_'), 'missing i18n for issue code ' + c);
  for (const c of ['wrong_class', 'unreadable_file', 'no_blocks', 'empty']) assert.ok(srT({ wrong_class: 'smartplan_err_wrong_class', unreadable_file: 'smartplan_err_unreadable', no_blocks: 'smartplan_err_no_blocks', empty: 'smartplan_err_empty' }[c], { overlap: 0, expected: 3 }).length > 20);
  console.log('smart-plan v2 UI render: passed');
}

// output language (Kannada UI -> prompt): prominent, with names kept untranslated so the parser/chapter check still work
{
  const kn = buildPrompt(pick, fx.students, fx.setup, { outputLanguage: 'Kannada' }).xmlString;
  assert.ok(kn.includes('<output_language>Kannada</output_language>') && kn.includes('OUTPUT LANGUAGE - READ FIRST') && kn.includes('Do not answer in English'), 'non-English language is prominent');
  assert.ok(kn.includes('exactly as it appears in the <marks subject') && kn.includes('chapter names'), 'subject + chapter names stay untranslated');
  const en = buildPrompt(pick, fx.students, fx.setup, { outputLanguage: 'English' }).xmlString;
  assert.ok(!en.includes('OUTPUT LANGUAGE - READ FIRST') && !en.includes('<output_language>'), 'English prompt unchanged in weight');
}

// ================= Kannada / non-Latin PDF text: wrapping by real width =================
{
  const { wrapText } = await import('../bal/smart-plan/study-plan-pdf.js');
  const fake = (extra) => ({ splitTextToSize: (s, w) => ['LATIN:' + s], getFontSize: () => 9, ...extra });
  assert.deepEqual(wrapText(fake(), 'Plain English text', 50), ['LATIN:Plain English text'], 'Latin text still goes through jsPDF unchanged');
  const kn = 'ಈ ವಿದ್ಯಾರ್ಥಿಯು ಗಣಿತದಲ್ಲಿ ಉತ್ತಮ ಪ್ರಗತಿ ಸಾಧಿಸಿದ್ದಾರೆ ಮತ್ತು ವಿಜ್ಞಾನದಲ್ಲಿ ಇನ್ನಷ್ಟು ಅಭ್ಯಾಸ ಮಾಡಬೇಕು ಎಂದು ಶಿಕ್ಷಕರು ಹೇಳಿದ್ದಾರೆ';
  const est = wrapText(fake(), kn, 60);                                    // no browser measuring -> estimate path
  assert.ok(est.length >= 2, 'long Kannada paragraph is wrapped, not left as one overflowing line');
  assert.equal(est.join(' ').replace(/\s+/g, ' '), kn, 'no words lost or reordered by wrapping');
  assert.ok(est.every(l => l.replace(/[\u0CCD]/g, '').length * 0.55 * 9 * 0.352778 <= 60 + 0.01), 'every estimated line fits the column');
  const m = wrapText(fake({ measureTextMm: s => s.length * 2 }), kn, 40);   // browser path: real measured widths win
  assert.ok(m.every(l => l.length * 2 <= 40) && m.join(' ') === kn);
  const longWord = wrapText(fake({ measureTextMm: s => s.length * 2 }), 'ಅ'.repeat(60), 40);
  assert.ok(longWord.length >= 3 && longWord.every(l => l.length * 2 <= 40), 'one very long word is cut so it cannot leave the page');
  assert.deepEqual(wrapText(fake(), 'ಕನ್ನಡ\nಪಾಠ', 100), ['ಕನ್ನಡ', 'ಪಾಠ'], 'explicit newlines kept');
  console.log('smart-plan v2 Kannada wrap: passed');
}

// ================= output language: made sticky in the prompt, then VERIFIED on the reply =================
{
  const KN = buildPrompt(pick, fx.students, fx.setup, { outputLanguage: 'Kannada' });
  const x = KN.xmlString;
  assert.equal(KN.language, 'Kannada');
  assert.ok(x.indexOf('<final_reminder>') > x.indexOf('</students>'), 'rules are repeated AFTER the data (last thing the model reads)');
  assert.ok(/LANGUAGE: the content of every line is written in Kannada\. Not English\./.test(x), 'final reminder names the language');
  assert.ok(x.includes('FOLLOW LITERALLY') && x.includes('do not substitute your default language'), 'no-assumption rule');
  for (const f of ['Summary: <1-2 sentences in Kannada', 'what it means in Kannada', 'ParentNote: <one paragraph in Kannada']) assert.ok(x.includes(f), 'language named inside the field shape: ' + f);
  const EN = buildPrompt(pick, fx.students, fx.setup, { outputLanguage: 'English' }).xmlString;
  assert.ok(!EN.includes('LANGUAGE: the content') && !EN.includes('<output_language>') && EN.includes('Summary: <1-2 sentences on where') && EN.includes('<final_reminder>'), 'English prompt: no language noise, same shape');
  // verification: an English reply to a Kannada prompt is caught and only that student is re-asked
  const knText = 'ಈ ವಿದ್ಯಾರ್ಥಿಯು ಉತ್ತಮ ಪ್ರಗತಿ ಸಾಧಿಸಿದ್ದಾರೆ ಮತ್ತು ಇನ್ನಷ್ಟು ಅಭ್ಯಾಸ ಮಾಡಬೇಕು';
  const knStudent = id => mk({ id, summary: knText + ' ' + id, subjectNotes: Object.fromEntries(SUBJ.map(s => [s, `${s}: 50%, 60%, 70%, 80% ${knText}`])), focusAreas: [knText], nextSteps: [knText + '1', knText + '2', knText + '3'], parentNote: knText });
  const enStudent = id => mk({ id });
  const run = (st, language) => applyQuality({ [st.id]: st }, { expectedIds: [st.id], evidence: { [st.id]: { subjects: SUBJ } }, subjects: SUBJ, language })[st.id].quality.map(q => q.code);
  assert.ok(!run(knStudent('K1'), 'Kannada').includes('wrong_language'), 'Kannada reply passes (English subject/chapter names allowed)');
  assert.ok(run(enStudent('K2'), 'Kannada').includes('wrong_language'), 'English reply to a Kannada prompt is flagged');
  assert.ok(!run(enStudent('K3'), 'English').includes('wrong_language') && !run(enStudent('K3'), undefined).includes('wrong_language'), 'English / unknown language never flagged');
  assert.ok(!run(enStudent('K4'), 'Spanish').includes('wrong_language'), 'languages the app does not offer are never checked');
  assert.ok(run(enStudent('K5'), 'Hindi').includes('wrong_language'), 'works for other scripts');
  // through the real parser + redo plan
  const enReply = parseResponse(withToken(gem), { ...ctx, language: 'Kannada' });
  const plan = redoPlan(enReply);
  assert.deepEqual(plan.ids.sort(), ['C7A001', 'C7A007', 'C7A026'], 'all three English answers re-asked');
  assert.ok(plan.texts.C7A001.some(t => t.includes('NOT written in Kannada')));
  const redoXml = buildRedoPrompt(pick, fx.students, fx.setup, { token: P.validationToken }, plan, { outputLanguage: 'Kannada' }).xmlString;
  assert.ok(redoXml.includes('NOT written in Kannada') && redoXml.includes('<final_reminder>'), 're-ask prompt states the problem and repeats the rules');
  assert.equal(CFG.LANGUAGE_MIN_SHARE, 0.35);
  // without a language the old behaviour is untouched
  assert.ok(!(p0 => p0.ids.filter(id => p0.reasons[id].some(x => x.code !== 'harsh_tone')).length)(redoPlan(parseResponse(withToken(gem), ctx))));
}
console.log('smart-plan v2 language: passed');

// Kannada worked example: present for Kannada, absent otherwise, and itself passes the language check
{
  const kx = buildPrompt(pick, fx.students, fx.setup, { outputLanguage: 'Kannada' }).xmlString;
  assert.ok(kx.includes('shown in Kannada: your answer must read like this') && /Summary: ಸ್ಥಿರ/.test(kx) && kx.includes("SubjectNotes: Mathematics: 55%, 57%, 58%, 41%. ಸುಂದರ"), 'Kannada example block');
  assert.ok(!/ಮಧ್ಯಮ/.test(buildPrompt(pick, fx.students, fx.setup, { outputLanguage: 'Hindi' }).xmlString) && !/ಮಧ್ಯಮ/.test(xml), 'other languages keep the English example');
  const blk = /EXAMPLE ONLY[^\n]*\n([\s\S]*?\[\[\/STUDENT\]\])/.exec(kx)[1];
  const ex = parseResponse(P.validationToken + '\n' + blk.replace('EXAMPLE01', 'C7A001'), { ...ctx, expectedIds: ['C7A001'], language: 'Kannada' });
  assert.ok(ex.ok && ex.matched.length === 1, 'the Kannada example is itself a valid block');
  assert.ok(!ex.students.C7A001.quality.some(q => q.code === 'wrong_language'), 'and it passes the language check');
}
console.log('smart-plan v2 kannada example: passed');

// ================= every supported output language: worked example + reply check =================
{
  const { COUNTRY_LANGUAGES } = await import('../core/shared-constants.js');
  const { exampleBlockFor, languagesWithExamples } = await import('../bal/smart-plan/prompt-examples.js');
  const names = new Set();
  for (const c of Object.values(COUNTRY_LANGUAGES)) for (const l of c.languages) { if (l.code === 'en') continue; const m = /\(([^)]+)\)/.exec(l.label); names.add(m ? m[1] : l.label); }   // same rule as currentLanguageName()
  assert.ok(names.size >= 16, 'app offers 16 non-English languages, found ' + names.size);
  const realEnglish = { summary: 'This student is doing well in most subjects and needs to improve in the last test.', parentNote: 'Your child has been steady and the dip is easy to fix with a little practice at home.',
    subjectNotes: Object.fromEntries(SUBJ.map(s => [s, s + ': 50%, 60%, 70%, 80%. The score is steady and it is in line with the class.'])), focusAreas: ['Work on the chapter with the lowest score in the last test.'], nextSteps: ['Practice the chapter every day for a week.', 'Ask the teacher for help with this topic.', 'Take a short quiz on the chapter before the test.'] };
  for (const name of names) {
    assert.ok(languagesWithExamples().includes(name.toLowerCase()), 'worked example missing for ' + name);
    const xmlL = buildPrompt(pick, fx.students, fx.setup, { outputLanguage: name }).xmlString;
    assert.ok(xmlL.includes(`shown in ${name}: your answer must read like this`) && xmlL.includes(`<output_language>${name}</output_language>`) && xmlL.includes('<final_reminder>'), name + ': prompt carries the example, language tag and final reminder');
    const blk = exampleBlockFor(name);
    assert.equal(xmlL.includes(blk.split('\n')[1]), true, name + ': the example text is in the prompt');
    const got = parseResponse(P.validationToken + '\n' + blk.replace('EXAMPLE01', 'C7A001'), { ...ctx, expectedIds: ['C7A001'], language: name });
    assert.ok(got.ok && got.matched.length === 1, name + ': example is a valid block');
    assert.ok(!got.students.C7A001.quality.some(q => q.code === 'wrong_language'), name + ': its own example passes the language check');
    const asEnglish = applyQuality({ C7A001: { id: 'C7A001', ...realEnglish, flags: [] } }, { expectedIds: ['C7A001'], evidence: {}, subjects: SUBJ, language: name }).C7A001.quality.map(q => q.code);
    assert.ok(asEnglish.includes('wrong_language'), name + ': an English reply is flagged');
  }
  // English prompt/reply is untouched
  assert.ok(!applyQuality({ C7A001: { id: 'C7A001', ...realEnglish, flags: [] } }, { expectedIds: ['C7A001'], evidence: {}, subjects: SUBJ, language: 'English' }).C7A001.quality.some(q => q.code === 'wrong_language'));
  console.log('smart-plan v2 all-languages: passed (' + [...names].join(', ') + ')');
}

// Indic text keeps ZWNJ/ZWJ; language share never exceeds 100% (vowel signs/viramas are marks, counted with letters)
{
  assert.equal(normalise('ಇಂಗ್ಲಿಷ್\u200Cನಲ್ಲಿ').includes('\u200C'), true, 'ZWNJ survives normalise');
  assert.equal(normalise('a\u200Bb\u2060c'), 'abc', 'zero-width SPACE / word-joiner still removed');
  const kn = 'ಒಟ್ಟಾರೆ ಸಾಧನೆ ಬಹಳ ಉತ್ತಮವಾಗಿದೆ ಇಂಗ್ಲಿಷ್\u200Cನಲ್ಲಿ ಇಳಿಕೆ';
  const q = applyQuality({ Z1: mk({ id: 'Z1', summary: kn, parentNote: kn, subjectNotes: Object.fromEntries(SUBJ.map(s => [s, `${s}: 50%, 60%. ${kn}`])), focusAreas: [kn], nextSteps: [kn + '1', kn + '2', kn + '3'] }) }, { expectedIds: ['Z1'], evidence: {}, subjects: SUBJ, language: 'Kannada' }).Z1.quality;
  assert.ok(!q.some(x => x.code === 'wrong_language'));
}
console.log('smart-plan v2 indic joiners: passed');

// ================= Smart Planner i18n: every language the app offers ships a complete, placeholder-safe file =================
{
  const { COUNTRY_LANGUAGES } = await import('../core/shared-constants.js');
  const codes = new Set(); for (const c of Object.values(COUNTRY_LANGUAGES)) for (const l of c.languages) if (l.code !== 'en') codes.add(l.code);
  const read = f => JSON.parse(fs.readFileSync(path.join(here, '..', 'i18n', 'smart-plan', f), 'utf8'));
  const en = read('en.json'), ph = s => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort().join(',');
  assert.ok(codes.size >= 16);
  for (const code of codes) {
    const t = read(code + '.json');
    assert.equal(t._meta.lang, code); assert.equal(!!t._meta.rtl, code === 'ur', code + ': rtl flag');
    for (const k of Object.keys(en)) { assert.ok(t[k] && t[k].trim(), `${code}: missing ${k}`); assert.equal(ph(t[k]), ph(en[k]), `${code}: placeholders differ in ${k}`); if (en[k].includes('[[STUDENT:')) assert.ok(t[k].includes('[[STUDENT:...]]') && t[k].includes('[[/STUDENT]]'), code + ': markers kept'); }
    assert.deepEqual(Object.keys(t).filter(k => k !== '_meta' && !(k in en)), [], code + ': no stale keys');
  }
  console.log('smart-plan i18n: ' + codes.size + ' languages complete');
}

// ---- kind-tone checks (hopeful, strengths-first wording) ----
assert.ok(q(mk({ summary: 'A small dip that is easy to turn around; Mathematics can improve with a little happy practice.' }), ev1).every(c => c !== 'trend_contradiction'), 'hopeful future wording on a declining trend is not a contradiction');
assert.ok(q(mk({ summary: 'A gentle dip in the last test, and a lovely chance to regain confidence.' }), ev1).every(c => c !== 'trend_contradiction'));
assert.ok(q(mk({ summary: 'Mathematics is weak and the child is failing.' }), ev1).includes('harsh_tone'), 'harsh words are flagged for a kind re-ask');
assert.ok(!q(mk({ summary: 'Mathematics is the next place to build confidence; the child has real strengths.' }), ev1).includes('harsh_tone'));
assert.ok(!q(mk({ summary: 'A badge of honour and a lesson learned.' }), ev1).includes('harsh_tone'), 'whole-word match only');
assert.ok(redoText({ code: 'harsh_tone', params: { words: 'weak, failing' } }).includes('kind, hopeful'));
assert.ok(buildPrompt(pick, fx.students, fx.setup).xmlString.includes('TONE CHARTER'));
console.log('smart-plan kind-tone: passed');
