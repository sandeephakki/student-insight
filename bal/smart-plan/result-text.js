// bal/smart-plan/result-text.js  (Smart Planner task 12) - pure logic, no DOM, no app imports.
// Turns whatever the teacher uploads/pastes into plain text the parser can read:
//   BOM, CRLF, literal \uXXXX escapes, code fences, copy-button debris, and RTF (Mac TextEdit saves a pasted chat as .rtf).
// detectKind() says whether the input is readable at all ('text' | 'rtf' | 'binary' | 'empty').
import { BINARY_MAGIC, BINARY_CTRL_CHAR_SHARE, RTF_MAX_DEPTH_SKIP, UNREADABLE_EXTENSIONS } from './quality-config.js';

const CP1252 = { 0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E', 0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6', 0x89: '\u2030', 0x8A: '\u0160', 0x8B: '\u2039', 0x8C: '\u0152', 0x8E: '\u017D', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014', 0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A', 0x9C: '\u0153', 0x9E: '\u017E', 0x9F: '\u0178' };
const RTF_SYMBOLS = { emdash: '\u2014', endash: '\u2013', lquote: '\u2018', rquote: '\u2019', ldblquote: '\u201C', rdblquote: '\u201D', bullet: '\u2022', emspace: ' ', enspace: ' ', tab: '\t' };
const RTF_BREAK = new Set(['par', 'line', 'sect', 'page']);

const stripBom = s => String(s == null ? '' : s).replace(/^\uFEFF/, '');
const looksRtf = s => /^\s*\{\\rtf/i.test(stripBom(s));

// 'empty' | 'binary' | 'rtf' | 'text'
function detectKind(raw) {
  const s = stripBom(raw);
  if (!s.trim()) return 'empty';
  for (const m of BINARY_MAGIC) if (s.startsWith(m)) return 'binary';
  if (looksRtf(s)) return 'rtf';
  const sample = s.slice(0, 4000);
  let ctrl = 0;
  for (let i = 0; i < sample.length; i++) { const c = sample.charCodeAt(i); if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 0xFFFD) ctrl++; }
  return ctrl / sample.length > BINARY_CTRL_CHAR_SHARE ? 'binary' : 'text';
}
// Extension check for the UI, before reading the file at all.
function isUnreadableName(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(String(fileName || ''));
  return !!m && UNREADABLE_EXTENSIONS.includes(m[1].toLowerCase());
}

function rtfToText(rtf) {
  const s = String(rtf || ''); const n = s.length;
  let out = '', i = 0, skipChars = 0;
  const stack = []; let cur = { skip: false, uc: 1 };
  while (i < n) {
    const ch = s[i];
    if (ch === '{') { stack.push(cur); cur = { skip: cur.skip, uc: cur.uc }; if (s.startsWith('\\*', i + 1)) cur.skip = true; i++; continue; }
    if (ch === '}') { cur = stack.pop() || cur; i++; continue; }
    if (ch === '\\') {
      i++; const c = s[i];
      if (c === undefined) break;
      if (/[a-zA-Z]/.test(c)) {
        let j = i; while (j < n && /[a-zA-Z]/.test(s[j])) j++;
        const word = s.slice(i, j);
        let k = j; if (s[k] === '-') k++; while (k < n && /\d/.test(s[k])) k++;
        const param = k > j ? parseInt(s.slice(j, k), 10) : null;
        if (s[k] === ' ') k++;                       // the single space after a control word is a delimiter, not text
        i = k;
        if (RTF_MAX_DEPTH_SKIP.includes(word)) { cur.skip = true; continue; }
        if (word === 'uc') { cur.uc = param == null ? 1 : param; continue; }
        if (word === 'u') { if (!cur.skip && param != null) out += String.fromCharCode(param < 0 ? param + 65536 : param); skipChars = cur.uc; continue; }
        if (cur.skip) continue;
        if (RTF_BREAK.has(word)) { out += '\n'; continue; }
        if (RTF_SYMBOLS[word]) out += RTF_SYMBOLS[word];
        continue;                                    // every other control word (fonts, colours, margins...) carries no text
      }
      if (c === "'") {
        const code = parseInt(s.slice(i + 1, i + 3), 16); i += 3;
        if (skipChars > 0) { skipChars--; continue; }
        if (!cur.skip && !isNaN(code)) out += CP1252[code] || String.fromCharCode(code);
        continue;
      }
      i++;
      if (c === '\n' || c === '\r') { if (!cur.skip) out += '\n'; continue; }   // backslash-newline = paragraph break
      if (c === '~') { if (!cur.skip) out += ' '; continue; }
      if (c === '-' || c === '_') { if (!cur.skip) out += '-'; continue; }
      if ((c === '\\' || c === '{' || c === '}') && !cur.skip) out += c;
      continue;
    }
    i++;
    if (ch === '\n' || ch === '\r') continue;        // raw newlines in RTF source are not content
    if (skipChars > 0) { skipChars--; continue; }
    if (!cur.skip) out += ch;
  }
  return out.replace(/[ \t]+\n/g, '\n');
}

// Chat UIs that read an attached file append citation markers to the text (Gemini: "[cite: 2]", ChatGPT: "citeturn0file0" between
// private-use characters, "[oaicite:0]", ":contentReference[...]"). They are never content and would print in every PDF.
const CITATION_JUNK = [/\s*:contentReference\[[^\]]*\](?:\{[^}]*\})?/g, /\s*\[cite:?[^\]]*\]/gi, /\s*\[oaicite:[^\]]*\]/gi, /\s*\uE200[^\uE201]*\uE201/g, /\s*\u3010[^\u3011]{0,80}\u3011/g, /\s*\[source:?[^\]]*\]/gi];
const stripCitations = t => CITATION_JUNK.reduce((x, re) => x.replace(re, ''), t);

function decodeEscapes(s) {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

// Lines a chat "Copy" button leaves in front of the real content.
// NOTE: ZWNJ (U+200C) and ZWJ (U+200D) are NOT removed: in Kannada/Hindi/Malayalam... they decide how letters join (e.g. ಇಂಗ್ಲಿಷ್\u200Cನಲ್ಲಿ).
const COPY_DEBRIS = /^\s*(text|plaintext|plain text|txt|copy|copy code|copied!?)\s*$/i;

function normalise(raw) {
  let t = stripBom(raw);
  if (looksRtf(t)) t = rtfToText(t);
  t = t.replace(/\r\n?/g, '\n').replace(/[\u200B\u2060\uFEFF]/g, '').replace(/\u00A0/g, ' ').replace(/[\u2028\u2029]/g, '\n');
  if (/\\u[0-9a-fA-F]{4}/.test(t)) t = decodeEscapes(t);   // some exports write non-ASCII as literal \uXXXX text
  t = t.split('\n').filter(l => !/^\s*```[\w-]*\s*$/.test(l)).join('\n');   // markdown code fences
  t = stripCitations(t);
  const first = t.search(/\[\[STUDENT:/);
  const head = first >= 0 ? t.slice(0, first) : '';
  if (head) t = head.split('\n').filter(l => !COPY_DEBRIS.test(l)).join('\n') + t.slice(first);
  return t;
}

export { detectKind, isUnreadableName, rtfToText, normalise, decodeEscapes, stripCitations };
