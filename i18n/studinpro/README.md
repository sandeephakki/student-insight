# i18n/studinpro

StudInPro promo copy (footer ticker + About page card).

**Phase 1 (current):** only `en.json` has real, reviewed content. Every
other language file in this folder is an English-content placeholder with
correct `_meta` (label/rtl) copied from `i18n/common/<lang>.json`, and
`_meta.reviewed: false` — same convention already used elsewhere in this
i18n system for un-translated content. This lets the loader
(`loadSplitOrLegacyLanguage` in core/render-i18n.js) work identically for
every language from day one — no special-casing "studinpro isn't
translated yet" anywhere in app code — while being honest that the text
itself isn't translated until Phase 2.

**Phase 2 (after English content + wiring is tested and confirmed):**
translate each `<lang>.json`'s `studinpro.*` keys properly, flip
`_meta.reviewed` to `true`. Content to add/change lives ONLY in these
JSON files plus `core/studinpro-items.js` (the item list itself) — no
other file should need touching for a translation pass or a content
update.
