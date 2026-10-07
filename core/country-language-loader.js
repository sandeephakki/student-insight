// Lazy loader for the country → language dropdown, backed by the
// per-country skeleton under /i18n-countries/ (index.json + one
// manifest.json per country folder — i18n-India/, i18n-China/, etc.).
//
// SCOPE: this module drives dropdown UI ONLY — which countries and
// languages are offered as options. It does NOT load translation
// content. Actual translated strings still come from the existing
// i18n/<shard>/<lang>.json system via loadLanguage() in render-i18n.js,
// completely untouched by this file. The per-language folders inside
// each i18n-countries/i18n-<Country>/ are empty placeholders reserved
// for a future content migration — see their .gitkeep files.
//
// LAZY-LOAD CONTRACT:
//   - loadCountryIndex() fetches i18n-countries/index.json ONCE (cached
//     after first call) — the lightweight list of which countries exist
//     and which folder each lives in. This is the only network request
//     made before the country dropdown can render.
//   - loadCountryManifest(folder) fetches a single country's
//     manifest.json ONLY when that country is actually selected (or for
//     the default country, once, on first load) — NOT all countries'
//     manifests up front. Each manifest is cached after its first fetch
//     so re-selecting a country already visited this session is instant.
const _countryIndexCache = { promise: null };
const _manifestCache = {};

function fetchJson(url){
  return fetch(url).then(r=>{
    if(!r.ok) throw new Error(`i18n-countries fetch failed (${r.status}): ${url}`);
    return r.json();
  });
}

function loadCountryIndex(){
  if(!_countryIndexCache.promise){
    _countryIndexCache.promise = fetchJson("i18n-countries/index.json");
  }
  return _countryIndexCache.promise;
}

function loadCountryManifest(folder){
  if(!_manifestCache[folder]){
    _manifestCache[folder] = fetchJson(`i18n-countries/${folder}/manifest.json`);
  }
  return _manifestCache[folder];
}

// --- ES module exports ---
export { loadCountryIndex, loadCountryManifest };

// Legacy-global compatibility shim, matching the pattern every other
// core/ module uses (see state-nav.js) so any remaining inline
// on*="" attribute or non-module script can still reach these.
if(typeof window!=='undefined'){
  window.loadCountryIndex=loadCountryIndex;
  window.loadCountryManifest=loadCountryManifest;
}
