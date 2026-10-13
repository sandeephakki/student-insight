// Applies the user's saved Light/Dark choice (a UI preference only —
// no student data — so localStorage is fine here) before the page
// paints, avoiding a flash of the wrong theme. If no choice has been
// saved yet, fall back to the OS-level light/dark preference so the
// first paint still matches the device, then remember it explicitly.
// Extracted from an inline <script> block (was in <head>) as part of
// the onclick->addEventListener conversion (HANDOVER item #3): this was
// the one remaining inline script blocking removal of 'unsafe-inline'
// from the CSP script-src directive. Must stay loaded synchronously,
// before first paint, at the exact same position in <head> — do not
// move to end of body or add defer/async.
try{
  var t=localStorage.getItem('si-theme-choice');
  if(t!=='light'&&t!=='dark'){
    t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';
  }
  document.documentElement.setAttribute('data-theme',t);
}catch(e){}
