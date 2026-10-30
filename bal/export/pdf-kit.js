// bal/export/pdf-kit.js — ONE visual system for every Student Insight PDF report (student, teacher, management).
// Same frame, colours, tables, charts, spacing and footer everywhere. No DOM; jsPDF `doc` is passed in.
// Palette rule: green = growth, blue = steady, amber = room to grow. Never red, never alarm.
import { pdfT } from './export-pdf.js';
import { APP } from '../../core/app-state.js';
import { bcp47TagFor } from '../../core/render-i18n.js';

export const C = {
  ink: [31, 42, 68], teal: [15, 122, 106], tealD: [11, 99, 84], tealS: [227, 243, 239], tealLine: [207, 229, 223],
  blue: [59, 130, 196], blueT: [47, 111, 174], amber: [226, 160, 58], amberT: [184, 115, 15], green: [46, 139, 87],
  muted: [91, 107, 120], line: [214, 228, 224], trk: [232, 238, 236], card: [247, 251, 250], white: [255, 255, 255],
  n1: { bg: [233, 246, 238], bd: [191, 227, 205] }, n2: { bg: [255, 246, 229], bd: [241, 217, 166] }, n3: { bg: [234, 242, 251], bd: [197, 217, 238] },
  s1: { bg: [223, 241, 230], fg: [31, 107, 65] }, s2: { bg: [223, 234, 247], fg: [36, 90, 147] }, s3: { bg: [251, 234, 208], fg: [138, 86, 10] }, s0: { bg: [241, 243, 243], fg: [138, 150, 160] },
};
export const toneOf = p => p === null || p === undefined ? 'n' : p >= 75 ? 'g' : p >= 50 ? 'b' : 'a';
export const toneFg = t => t === 'g' ? C.green : t === 'b' ? C.blueT : t === 'a' ? C.amberT : C.muted;
export const toneBar = t => t === 'g' ? C.green : t === 'b' ? C.blue : C.amber;
export const heat = p => p === null || p === undefined ? C.s0 : p >= 75 ? C.s1 : p >= 50 ? C.s2 : C.s3;

const W = 210, H = 297, M = 14, CW = W - 2 * M, BOTTOM = H - 20;
const nonLatin = s => /[^\x00-\xFF]/.test(String(s));
// truncate with plain "..." (stays inside Latin-1 so it never needs the canvas fallback)
function fitText(doc, text, maxW) {
  text = String(text == null ? '' : text);
  if (doc.getTextWidth(text) <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (doc.getTextWidth(text.slice(0, mid) + '...') <= maxW) lo = mid; else hi = mid - 1; }
  return lo > 0 ? text.slice(0, lo).trimEnd() + '...' : '...';
}

export function makeKit(doc, subLine) {
  const k = { doc, W, H, M, CW, y: M, page: 1, sub: subLine };
  const font = (size, bold, color) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...(color || C.ink)); };
  const fill = c => doc.setFillColor(...c), stroke = (c, w) => { doc.setDrawColor(...c); doc.setLineWidth(w || 0.3); };
  const box = (x, y, w, h, bg, bd, r) => { fill(bg); stroke(bd || bg, 0.3); doc.roundedRect(x, y, w, h, r === undefined ? 2.5 : r, r === undefined ? 2.5 : r, bd ? 'FD' : 'F'); };
  const wrap = (text, w, size) => { font(size || 8.5); return doc.splitTextToSize(String(text), nonLatin(text) ? w * 0.86 : w); };
  k.font = font; k.box = box; k.wrap = wrap;

  // text with optional truncation / alignment
  k.text = (s, x, y, o = {}) => {
    font(o.size || 8.5, o.bold, o.color);
    let t = String(s == null ? '' : s);
    if (o.max) t = fitText(doc, t, nonLatin(t) ? o.max * 0.86 : o.max);
    doc.text(t, x, y, o.align ? { align: o.align } : undefined);
    return doc.getTextWidth(t);
  };
  k.need = h => { if (k.y + h > BOTTOM) k.newPage(); };
  k.gap = h => { k.y += h; };

  k.logoBlock = (compact) => {
    k.text('Student Insight', M, k.y + 4.5, { size: compact ? 11 : 15, bold: true, color: C.teal });
    k.text(k.sub, M, k.y + (compact ? 9 : 10), { size: 7.5, color: C.muted, max: 120 });
  };
  k.header = (chip, sub) => {
    k.y = M; if (sub) k.sub = sub;
    k.logoBlock(false);
    font(7.5, true); const cw = doc.getTextWidth(chip) + 7;
    box(W - M - cw, k.y + 1, cw, 6, C.tealS, null, 3);
    k.text(chip, W - M - cw / 2, k.y + 5.1, { size: 7.5, bold: true, color: C.tealD, align: 'center' });
    k.text(pdfT('pdf_generated_label', 'Generated: {{date}}', { date: new Date().toLocaleDateString(bcp47TagFor ? bcp47TagFor(window.SR_LANG || 'en') : undefined) }), W - M, k.y + 11.5, { size: 7, color: C.muted, align: 'right' });
    stroke(C.teal, 0.8); doc.line(M, k.y + 14, W - M, k.y + 14);
    k.y += 17;
  };
  k.pageWithHeader = (chip, sub) => { doc.addPage(); k.page++; k.header(chip, sub); };
  k.newPage = () => {
    doc.addPage(); k.page++; k.y = M;
    k.logoBlock(true);
    stroke(C.tealLine, 0.5); doc.line(M, k.y + 11, W - M, k.y + 11);
    k.y += 16;
  };

  k.idCard = ({ name, sub, chip, big, cap }) => {
    const h = chip ? 27 : 21;
    box(M, k.y, CW, h, [238, 248, 246], C.tealLine, 3.5);
    k.text(name, M + 5, k.y + 9, { size: 16, bold: true, max: 115 });
    if (sub) k.text(sub, M + 5, k.y + 14.5, { size: 7.5, color: C.muted, max: 115 });
    if (chip) {
      font(7, true); const cw = Math.min(doc.getTextWidth(chip) + 7, 118);
      box(M + 5, k.y + 18.5, cw, 6, C.white, C.tealLine, 3);
      k.text(chip, M + 8.5, k.y + 22.6, { size: 7, bold: true, color: C.tealD, max: 112 });
    }
    k.text(big, W - M - 5, k.y + 12.5, { size: 25, bold: true, color: C.teal, align: 'right' });
    k.text(cap, W - M - 5, k.y + 18, { size: 7, color: C.muted, align: 'right', max: 60 });
    k.y += h + 5;
  };

  k.tiles = items => {
    const n = items.length, g = 3, w = (CW - g * (n - 1)) / n, h = 17;
    items.forEach((it, i) => {
      const x = M + i * (w + g);
      box(x, k.y, w, h, C.card, C.line, 2.5);
      k.text(String(it.label).toUpperCase(), x + 3, k.y + 5, { size: 6, color: C.muted, max: w - 5 });
      k.text(it.value, x + 3, k.y + 11.2, { size: 11.5, bold: true, color: toneFg(it.tone), max: w - 5 });
      if (it.cap) k.text(it.cap, x + 3, k.y + 15.6, { size: 6, color: C.muted, max: w - 5 });
    });
    k.y += h + 4;
  };

  k.section = (title, x, w) => {
    k.need(14);
    const xx = x === undefined ? M : x, ww = w === undefined ? CW : w;
    k.text(String(title).toUpperCase(), xx, k.y + 4, { size: 8, bold: true, color: C.tealD, max: ww });
    stroke(C.tealLine, 0.5); doc.line(xx, k.y + 5.6, xx + ww, k.y + 5.6);
    k.y += 8.5;
  };
  // draws a section title at an explicit y (for side-by-side columns)
  k.sectionAt = (title, x, w, y) => {
    k.text(String(title).toUpperCase(), x, y + 4, { size: 8, bold: true, color: C.tealD, max: w });
    stroke(C.tealLine, 0.5); doc.line(x, y + 5.6, x + w, y + 5.6);
    return y + 8.5;
  };

  k.bars = (items, x, y, w, o = {}) => {
    const lw = o.labelW || 30, rh = o.rowH || 6.4;
    items.forEach((it, i) => {
      const yy = y + i * rh, tone = toneOf(it.pct);
      k.text(it.name, x, yy + 3.2, { size: 8, max: lw - 2 });
      const bx = x + lw, bw = w - lw - 12;
      box(bx, yy + 0.9, bw, 2.6, C.trk, null, 1.3);
      if (it.pct) box(bx, yy + 0.9, Math.max(2.6, bw * Math.min(100, it.pct) / 100), 2.6, toneBar(tone), null, 1.3);
      k.text(it.pct === null || it.pct === undefined ? 'AB' : Math.round(it.pct) + '%', x + w, yy + 3.3, { size: 8, bold: true, color: toneFg(tone), align: 'right' });
    });
    return y + items.length * rh;
  };

  k.line = (vals, labels, x, y, w, h) => {
    const n = vals.length, top = y + 5, bot = y + h - 7, sx = i => n === 1 ? x + w / 2 : x + 8 + i * (w - 16) / (n - 1), sy = v => bot - v / 100 * (bot - top);
    [0, 50, 100].forEach(t => { stroke(C.line, 0.25); doc.line(x + 2, sy(t), x + w, sy(t)); k.text(String(t), x - 1, sy(t) + 1, { size: 5.5, color: C.muted, align: 'right' }); });
    stroke(C.teal, 0.8);
    for (let i = 1; i < n; i++) doc.line(sx(i - 1), sy(vals[i - 1]), sx(i), sy(vals[i]));
    vals.forEach((v, i) => {
      fill(C.white); stroke(C.teal, 0.7); doc.circle(sx(i), sy(v), 1.3, 'FD');
      k.text(Math.round(v) + '%', sx(i), sy(v) - 2.3, { size: 7, bold: true, color: C.tealD, align: 'center' });
      k.text(labels[i], sx(i), y + h - 1.5, { size: 6, color: C.muted, align: 'center', max: Math.max(18, w / n - 2) });
    });
    return y + h;
  };

  // arrow glyph (drawn, not a font character, so it never needs the canvas fallback)
  const arrow = (dir, x, y) => {
    if (dir === 'up') { fill(C.green); doc.triangle(x, y + 1.6, x + 2, y + 1.6, x + 1, y - 0.2, 'F'); }
    else if (dir === 'down') { fill(C.amber); doc.triangle(x, y - 0.2, x + 2, y - 0.2, x + 1, y + 1.6, 'F'); }
    else { fill(C.blue); doc.circle(x + 1, y + 0.7, 0.8, 'F'); }
  };
  k.arrow = arrow;

  // cell = string | { t, fg, bold, bg, arrow:'up'|'down'|'flat' }
  k.table = ({ cols, rows, rowH = 6, size = 7.5, x = M, head = true, zebra = false }) => {
    const tw = cols.reduce((a, c) => a + c.w, 0);
    const drawHead = () => {
      cols.reduce((cx, c) => { const al = c.align || 'left'; k.text(String(c.h).toUpperCase(), al === 'right' ? cx + c.w - 1.5 : al === 'center' ? cx + c.w / 2 : cx + 1.5, k.y + 4, { size: 6, bold: true, color: C.muted, align: al === 'left' ? undefined : al, max: c.w - 2 }); return cx + c.w; }, x);
      stroke(C.ink, 0.5); doc.line(x, k.y + 5.6, x + tw, k.y + 5.6); k.y += 7.2;
    };
    k.need(head ? rowH * 2 + 8 : rowH + 2);
    if (head) drawHead();
    rows.forEach((r, ri) => {
      if (k.y + rowH > BOTTOM) { k.newPage(); if (head) drawHead(); }
      if (zebra && ri % 2) { fill([249, 252, 251]); doc.rect(x, k.y - 0.6, tw, rowH, 'F'); }
      cols.reduce((cx, c, ci) => {
        let cell = r[ci]; if (cell === null || cell === undefined) cell = '';
        if (typeof cell !== 'object') cell = { t: String(cell) };
        const al = c.align || 'left', cxm = al === 'center' ? cx + c.w / 2 : al === 'right' ? cx + c.w - 1.5 : cx + 1.5;
        if (cell.bg) { box(cx + 0.6, k.y - 0.4, c.w - 1.2, rowH - 1, cell.bg, null, 1.2); }
        let tx = cxm;
        if (cell.arrow) { const aw = 3; if (al === 'center') { font(size, true); const w0 = doc.getTextWidth(cell.t); arrow(cell.arrow, cx + c.w / 2 - w0 / 2 - aw, k.y + rowH / 2 - 2); } else arrow(cell.arrow, cx + 1.5, k.y + rowH / 2 - 2); if (al !== 'center') tx = cx + 1.5 + aw; }
        k.text(cell.t, tx, k.y + rowH / 2 + 1.1, { size, bold: cell.bold || c.bold, color: cell.fg || C.ink, align: al === 'left' || cell.arrow && al !== 'center' ? undefined : al, max: c.w - 3 });
        return cx + c.w;
      }, x);
      stroke(C.line, 0.2); doc.line(x, k.y + rowH - 0.8, x + tw, k.y + rowH - 0.8);
      k.y += rowH;
    });
    k.y += 2;
  };

  // two note boxes side by side (title + body each). tone: 'n1' good news, 'n3' next step, 'n2' warm note
  k.notes = (a, b) => {
    const g = 4, w = (CW - g) / 2, pad = 4;
    const la = wrap(a.body, w - 2 * pad, 8), lb = wrap(b.body, w - 2 * pad, 8);
    const h = 11 + Math.max(la.length, lb.length) * 4;
    k.need(h + 2);
    [[a, M, la], [b, M + w + g, lb]].forEach(([n, x, lines]) => {
      const t = C[n.tone || 'n1'];
      box(x, k.y, w, h, t.bg, t.bd, 3);
      k.text(n.title, x + pad, k.y + 5.6, { size: 8.5, bold: true, color: C.ink, max: w - 2 * pad });
      font(8); lines.forEach((l, i) => doc.text(l, x + pad, k.y + 10.2 + i * 4));
    });
    k.y += h + 4;
  };
  k.note = (n, w, x) => {
    const ww = w || CW, xx = x === undefined ? M : x, pad = 4, lines = wrap(n.body, ww - 2 * pad, 8), h = 11 + lines.length * 4 + (n.extra || 0);
    k.need(h + 2);
    const t = C[n.tone || 'n1']; box(xx, k.y, ww, h, t.bg, t.bd, 3);
    k.text(n.title, xx + pad, k.y + 5.6, { size: 8.5, bold: true, max: ww - 2 * pad });
    font(8); lines.forEach((l, i) => doc.text(l, xx + pad, k.y + 10.2 + i * 4));
    k.y += h + 4; return h;
  };

  // footer on every page: tagline + audience + page x of y
  k.finish = audience => {
    const total = doc.internal.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      stroke(C.line, 0.3); doc.line(M, H - 13, W - M, H - 13);
      font(6.5, false, C.muted);
      doc.textWithLink('Student Insight', M, H - 8.5, { url: (window.APP_CONFIG && window.APP_CONFIG.projectPageUrl) || 'https://studin.in/' });
      const lw = doc.getTextWidth('Student Insight');
      doc.text(pdfT('pdf_footer_tagline', ' — Open Source  |  Privacy-First  |  Built by Sandeep Hakki'), M + lw, H - 8.5);
      doc.text(pdfT('pdf_page_of', 'Page {{p}} of {{total}}', { p, total }), W / 2 + 28, H - 8.5, { align: 'center' });
      doc.text(audience, W - M, H - 8.5, { align: 'right' });
    }
    doc.setPage(total);
  };
  return k;
}
export const LAYOUT = { W, H, M, CW, BOTTOM };
