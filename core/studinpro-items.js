// StudInPro promo content — SINGLE SOURCE OF TRUTH.
//
// This is the ONLY file that should need editing to add, update, or remove
// a StudInPro ticker/card item. Nothing else in the app hardcodes item text
// or the item list itself — ticker.js and the About card both just read
// STUDINPRO_ITEMS at render time.
//
// Fields per item:
//   id       - stable identifier, never reused/reordered-sensitive. Also
//              used to build the i18n key: "studinpro.item." + id
//   context  - array of APP.currentStep / bucket ids this item should be
//              PRIORITIZED for (see ticker.js pickContextItem()). Use
//              ["global"] for items with no specific screen tie.
//   priority - optional integer, higher shows first among ties. Default 0.
//
// The actual displayed text lives in i18n/studinpro/<lang>.json under the
// key "studinpro.item.<id>" — NOT here — so this file's shape never has to
// change for translation work. English-only for now, per current phase;
// other language files exist as English-copied placeholders until content
// is finalized and confirmed (see i18n/studinpro/README.md).
//
// STATUS: placeholder content while the StudInPro conversation with
// Sandeep is ongoing — only 2-3 real items below. Add more by copying the
// pattern of an existing entry; nothing else needs to change.
const STUDINPRO_ITEMS = [
  { id: "pro_intro", context: ["global"], priority: 10 },
  { id: "contact_query", context: ["global"], priority: 5 }
];

if (typeof module !== "undefined" && module.exports) module.exports = { STUDINPRO_ITEMS };
export { STUDINPRO_ITEMS };
