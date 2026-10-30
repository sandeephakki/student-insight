// Adds a "scroll sideways" cue to any .tbl-wrap that overflows horizontally.
import { srT } from '../../core/render-i18n.js';
const msg = () => { const t = srT('tw_scroll_hint'); return '\u21C6 ' + (t === 'tw_scroll_hint' ? 'Swipe / scroll sideways to see all columns' : t); };
function sync(w) {
  const over = w.scrollWidth > w.clientWidth + 4;
  const atEnd = w.scrollLeft + w.clientWidth >= w.scrollWidth - 4;
  let hint = w.previousElementSibling && w.previousElementSibling.classList.contains('tbl-hint') ? w.previousElementSibling : null;
  w.classList.toggle('tbl-more-right', over && !atEnd);
  w.classList.toggle('tbl-more-left', over && w.scrollLeft > 4);
  if (over && !hint) {
    hint = document.createElement('div'); hint.className = 'tbl-hint'; hint.textContent = msg();
    w.parentNode.insertBefore(hint, w);
  }
  if (hint) hint.style.display = (over && !atEnd) ? '' : 'none';
}
function scan(root) {
  (root || document).querySelectorAll('.tbl-wrap').forEach(w => {
    if (!w._tblHint) { w._tblHint = 1; w.addEventListener('scroll', () => sync(w), { passive: true }); }
    sync(w);
  });
}
let t = null;
const queue = () => { clearTimeout(t); t = setTimeout(() => scan(), 120); };
if (typeof document !== 'undefined') {
  new MutationObserver(queue).observe(document.body || document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', queue);
  queue();
}
export {};
