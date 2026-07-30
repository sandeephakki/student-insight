# Student Insight — Translation Reference (English source)

This file is NOT loaded by the app. It exists purely as a clean copy for
translators. All 13 languages the app supports (English + 12 Indian
languages — see COUNTRY_LANGUAGES in js/state-nav.js) now ship with
/i18n/<code>.json; see the machine-readable versions for the current
values.

To add a new language:
1. Copy /i18n/en.json to /i18n/<code>.json (e.g. ta.json for Tamil).
2. Translate every value EXCEPT keys starting with `_` and anything
   inside `{{double braces}}` (those are placeholders filled in by the
   app at runtime — e.g. `{{student}}`, `{{rank}}`, `{{count}}`).
3. Set `"_meta": {"lang":"<code>", "label":"<Language name in its own
   script>", "reviewed": false}` until a native speaker has checked it,
   then flip to `true`.
4. Add the language to the country→language dropdown mapping in
   index.html (see COUNTRY_LANGUAGES in js/state-nav.js).

## IMPORTANT — current scope (updated v3.9)

As of v3.9, this system covers ~198 keys across all 13 languages:
- Smart Reveal bucket screens and Smart Search feature (~40 keys, from
  earlier phases)
- **Setup wizard** — all 4 steps: purpose selection, institution/mode,
  class & scoring, subjects/tests/download (v3.9, new)
- **About page** — hero, stats, all 8 accordion sections, philosophy
  quote, formulas callout, bio card (v3.9, new)
- **FAQ page chrome** — hero, search box, jump-link, all 9 section
  captions, all 8 answer-tag labels (Serious/Practical/Silly/Core/
  App-defined/Admin/Statistics/Technical) (v3.9, new)

Still NOT covered — remains English-only regardless of language selected:
- The individual FAQ questions and answers themselves (100+ Q&A pairs;
  translating the full text is a much larger follow-up task, intentionally
  out of scope here since these are dense technical/procurement answers
  best reviewed carefully rather than machine-translated in bulk)
- Export / PDF generation screens
- Most Dashboard labels, table headers, button text outside buckets
- Error messages, toasts, validation text
- The Institution "Type" dropdown (`#inst-type`) — intentionally left
  English-only. Its `<option>` text doubles as the stored value written
  into the exported Excel SETUP sheet (no separate `value=` attribute),
  so translating the display text would silently change what gets saved
  and could break re-import matching between sessions in different
  languages. Needs a code change (decouple label from stored value)
  before this one is safe to localize.

Every string in ur.json (Urdu) renders right-to-left automatically —
`dir="rtl"` is driven by `_meta.rtl:true` in that file, already wired in
js/render-dashboard.js's `reapplyI18nStrings()`.

All translations here are machine-assisted (AI-generated), same caveat
as the earlier phases: recommend native-speaker review before wide
distribution, particularly for a formal/procurement-facing context like
the FAQ's principal/IT-coordinator sections.

## Current English source — original ~40 keys (mirrors /i18n/en.json)

| Key | English |
|---|---|
| bucket_class_label | My Whole Class |
| bucket_class_desc | Overall average, trend, and class-wide patterns |
| bucket_student_label | One Student |
| bucket_student_desc | Look up any student by name |
| bucket_subject_label | One Subject |
| bucket_subject_desc | See how the whole class did in one subject |
| bucket_help_label | Who Needs Help |
| bucket_help_desc | Students who may need extra support |
| bucket_top_label | Top Performers |
| bucket_top_desc | Highest scorers and most improved |
| bucket_clusters_label | Performance Groups |
| bucket_clusters_desc | Cohort patterns found across average, consistency, trend and attendance |
| bucket_count_badge_one | ({{count}} found) |
| bucket_count_badge_other | ({{count}} found) |
| bucket_all_good | All good — no concerns here right now. |
| back | ← Back |
| finding_top_rank | {{student}} is ranked #{{rank}} in the class. |
| student_picker_prompt | Type a student's name to see their full report. |
| subject_picker_prompt | Pick a subject to see how the class did. |
| smart_search_title | Smart Search |
| smart_search_subtitle | Tap a question for a plain-language answer, computed from this class's data. Nothing here is sent anywhere — calculated on your device, same as the rest of the app. |
| smart_search_back | Back to Dashboard |
| smart_search_select_student | Select a student… |
| smart_search_student_label | Student |
| smart_search_ai_tooltip | AI feature — development in progress |
| smart_search_coming_soon | Coming soon |
| smart_search_select_first | Select a student first. |
| smart_search_load_error | Couldn't load Smart Search. Check your connection and try again. |
| smart_search_empty_title | Nothing to ask yet |
| smart_search_empty_sub | This section needs a bit more data before questions become available here. |
| individual_bucket_report_label | Progress Report |
| individual_bucket_report_desc | Overall summary, trend and where things stand |
| individual_bucket_subjects_label | Subjects & Marks |
| individual_bucket_subjects_desc | Test-by-test marks and subject breakdown |
| individual_bucket_plan_label | Recommendations |
| individual_bucket_plan_desc | What to focus on at home this week |
| individual_bucket_wellbeing_label | Wellbeing |
| individual_bucket_wellbeing_desc | Stress and engagement signals |

## v3.9 additions (Setup + About + FAQ-chrome, ~142 new keys)

See /i18n/en.json for the full current key set — too large to duplicate
here in full. Key prefixes: `setup_*` (Setup wizard, all 4 steps),
`about_*` (About page), `faq_hero_*`/`faq_search_*`/`faq_jump_*`/
`faq_empty`/`faq_cnt_*`/`faq_tag_*` (FAQ chrome).


| Key | English |
|---|---|
| bucket_class_label | My Whole Class |
| bucket_class_desc | Overall average, trend, and class-wide patterns |
| bucket_student_label | One Student |
| bucket_student_desc | Look up any student by name |
| bucket_subject_label | One Subject |
| bucket_subject_desc | See how the whole class did in one subject |
| bucket_help_label | Who Needs Help |
| bucket_help_desc | Students who may need extra support |
| bucket_top_label | Top Performers |
| bucket_top_desc | Highest scorers and most improved |
| bucket_clusters_label | Performance Groups |
| bucket_clusters_desc | Cohort patterns found across average, consistency, trend and attendance |
| bucket_count_badge_one | ({{count}} found) |
| bucket_count_badge_other | ({{count}} found) |
| bucket_all_good | All good — no concerns here right now. |
| back | ← Back |
| finding_top_rank | {{student}} is ranked #{{rank}} in the class. |
| student_picker_prompt | Type a student's name to see their full report. |
| subject_picker_prompt | Pick a subject to see how the class did. |
| smart_search_title | Smart Search |
| smart_search_subtitle | Tap a question for a plain-language answer, computed from this class's data. Nothing here is sent anywhere — calculated on your device, same as the rest of the app. |
| smart_search_back | Back to Dashboard |
| smart_search_select_student | Select a student… |
| smart_search_student_label | Student |
| smart_search_ai_tooltip | AI feature — development in progress |
| smart_search_coming_soon | Coming soon |
| smart_search_select_first | Select a student first. |
| smart_search_load_error | Couldn't load Smart Search. Check your connection and try again. |
| smart_search_empty_title | Nothing to ask yet |
| smart_search_empty_sub | This section needs a bit more data before questions become available here. |
| individual_bucket_report_label | Progress Report |
| individual_bucket_report_desc | Overall summary, trend and where things stand |
| individual_bucket_subjects_label | Subjects & Marks |
| individual_bucket_subjects_desc | Test-by-test marks and subject breakdown |
| individual_bucket_plan_label | Recommendations |
| individual_bucket_plan_desc | What to focus on at home this week |
| individual_bucket_wellbeing_label | Wellbeing |
| individual_bucket_wellbeing_desc | Stress and engagement signals |
