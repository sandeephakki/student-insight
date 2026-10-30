# Smart Search — Handover / Merge Prompt

**This file is kept up to date every session.** Append a new dated section per
round of changes — never edit or delete a past section, so it stays a real
history a reviewer or another AI agent can merge from top to bottom.

Give this whole file to whoever (human or AI) is merging these changes into
the main branch. It tells them exactly what changed, why, and what's still
open.

---

## 2026-08-28 — Round 2: broaden question coverage to match dashboard tabs

### Ask
"All the left panel tabs and their respective main screens' visible topics
are potential questions — do all at once, don't make me paste them one by
one."

### What actually got covered
Every dashboard tab that has real text/analytical content behind it (not a
chart-only view), using data **already computed** — no new computation added
anywhere (SmartQueryV2's own design rule, kept intact):

| Bucket / Tab | New question(s) |
|---|---|
| "Who Needs Help" | `who_needs_help` — lists every student currently flagged (at-risk, declining, sharp-drop, absent, volatile, burnout, data-gap, plateau, low peer-outlier), with their specific flag reasons |
| "Top Performers" | `who_is_excelling` — same mechanism, flipped to the positive flag set (improving, resilient, high peer-outlier) |
| "One Subject" | `subject_breakdown_all` — full per-subject class-average list in one answer, not just weakest/strongest |
| "Recommendations" (individual mode) | `home_plan_student`, `school_plan_student` — surfaces the already-generated home/school plan text per student |
| "Progress Report" (individual mode) | `parent_message_student`, `trend_facts_student` — surfaces the already-generated parent note and progress narrative |
| (carried over from Round 1, listed again for completeness) | `growth_leaders`, `class_topper`, `growth_rate_student`, `grade_student`, `overall_avg_student`, `attendance_student`, `best_worst_test_student` |

Total question bank: **16 → 31 questions.**

### Explicitly NOT covered this round (and why)
Being upfront instead of silently skipping these:

- **"Analytics" / "Heatmap" tabs (legacy dashboard)** — pure chart/visual
  views, no underlying text summary exists to answer from. Would need new
  narrative-generation logic first (out of scope for "answer from existing
  data").
- **Compare (Compare Two Students)** — separate data shape (diff of two
  files/students), its own render path (`compute-compare.js`). Needs its own
  question category, not a bolt-on to this one.
- **Continuity** — per `compute-continuity.js`'s own comment,
  `continuity-schema-not-built-yet`: the data this tab would answer from
  isn't reliably populated for real uploads yet. Answering from it now would
  mean confidently answering from empty/undefined data.
- **Scholarship** — its own eligibility engine (`scholarship-eligibility-engine.js`)
  with a materially different domain vocabulary (criteria, documents,
  shortlists). Deserves its own question category + `domainVocabulary`
  additions, not folded into this one.
- **Export** — an action screen, not a data screen. Nothing to "ask" about.

**Suggested next round, in priority order:** Compare, then Scholarship. Both
are self-contained enough to add as a third category in
`knowledge/smart-questions.json` (`"id": "compare"` / `"id": "scholarship"`)
following the exact same pattern as `class_management`/`per_student` below.

### Files changed this round
- `knowledge/smart-questions.json` — +7 questions (see table above), removed
  3 overlapping keywords from `peer_outliers` ("who needs help", "struggling
  students", "at risk" — moved to the new `who_needs_help`, since that
  phrase should hit the bucket literally named "Who Needs Help", not the
  statistical z-score outlier check)
- `bal/smart-search/smart-query-v2.js` — added answer-shaping for the 7 new
  computeKey shapes (flag-list filter, generated-text passthrough,
  full-subject-list)

---

## 2026-08-28 — Round 1: bug fixes + first coverage pass

### Ask
1. Smart Search screen: cursor should auto-focus the input; Enter should
   submit.
2. Smart Search only recognizes a handful of question patterns — broaden it.

### What changed

**Bug fix — autofocus.** Enter-to-submit was already correctly wired
(`ui/common/inline-actions.js`, delegated `keydown` listener, line ~380 —
CSP blocks inline `onkeydown=` so it has to be delegated). The actual bug was
a missing `.focus()` call when the Smart Search chat screen renders.

**Coverage pass.** Added 7 questions using already-computed fields that had
zero coverage — most notably `growthRate` (already computed in
`compute-stats.js`, never wired to any question, which is exactly why "who's
growth rate is high" failed in the reported screenshot):
`growth_leaders`, `class_topper` (class-level); `growth_rate_student`,
`grade_student`, `overall_avg_student`, `attendance_student`,
`best_worst_test_student` (per-student).

Scoped down from "answer every subject/student combination" — that needs a
subject-name detector mirroring the existing student-name detector
(`findStudentCandidates` in `smart-query-v2.js`) and was flagged as a
separate follow-up, not attempted half-built.

### Files changed this round
- `ui/common/render-buckets.js` — `renderDashboardSmartSearch()`: added
  `composer.focus()` after render
- `knowledge/smart-questions.json` — +7 questions, +domain vocabulary
- `bal/smart-search/smart-query-v2.js` — answer-shaping branches for the
  7 new computeKey shapes (2 class-wide array branches, 5 per-student switch
  cases)

---

## How to merge / verify

1. All changes are additive to `knowledge/smart-questions.json` (data only)
   and additive `if`/`case` branches in `smart-query-v2.js` (no existing
   branch was rewritten, except the one keyword move noted in Round 2) — low
   merge-conflict risk against any parallel work on the same files.
2. `SmartQueryV2` is the single engine behind all three Smart Search
   surfaces (`ui/common/render-buckets.js` chat, `ui/smart-search/smart-query-v2-ui.js`
   floating panel, `core/vs-shell.js` right rail) — every question added
   here is live in all three automatically, nothing to duplicate.
3. Sanity check after merge: open the app with any sample file from
   `samples/`, open Smart Search, and tap through the new chips (they auto-
   render from the JSON, no extra wiring needed) — confirm no `{placeholder}`
   tokens are left unfilled in any answer.
4. `knowledge/smart-questions.json` is parsed at runtime — a syntax error
   there fails Smart Search silently (empty question list) rather than
   throwing loudly, so validate it's parseable JSON before shipping
   (`python3 -m json.tool knowledge/smart-questions.json` or equivalent).

---

## 2026-08-28 — Round 3: i18n/translation scoping (correction, no code changed)

### Correction to Round 1/2 text above
Round 2's file-changes note is imprecise about translation status — it never
claimed the new questions were translated, but it also never flagged that
**none of Smart Search, old or new, is localized at all**. Stating that
plainly now, because this file is being used as a translation brief for
another agent.

### Ground truth, verified by inspection (2026-08-28)
- `knowledge/smart-questions.json` is the **only** file `SmartQueryV2.load()`
  actually fetches (`bal/smart-search/smart-query-v2.js`, `load()`). Every
  `label`, `answerTemplate`, `keywords`, `emptyMessage`, `unavailableMessage`,
  and `spreadNoteWide`/`spreadNoteNarrow` in it is plain hardcoded English —
  not routed through `srT()`, not language-switched, regardless of the
  user's selected app language.
- `i18n/smart-questions.json` is a **dead orphan file** — byte-identical in
  shape to an older version of `knowledge/smart-questions.json` (still has
  the original 17 questions, missing all 14 new ones), and is not imported
  or read by any `.js` or `.py` file in the repo (`grep -rn
  "i18n/smart-questions.json"` returns nothing). Do not use it as a
  translation target — it does nothing at runtime. Flag it for deletion or
  leave it alone; either way it's not part of this task.
- The 12 regional locale files in `/i18n/` (`as.json`, `bn.json`, `gu.json`,
  `hi.json`, `kn.json`, `ml.json`, `mr.json`, `or.json`, `pa.json`,
  `ta.json`, `te.json`, `ur.json`) are flat `srT()`-key → translated-string
  maps for the *rest* of the app. They contain **no keys at all** for the
  Smart Search question bank — not for the 17 original questions, not for
  the 14 new ones. There is nothing to "extend" there; this would be new
  territory for these files.
- Separately, a handful of **notes I added directly in JS** (Round 1/2, in
  `bal/smart-search/smart-query-v2.js`'s per-student `switch`) are plain
  string literals, not even in `knowledge/smart-questions.json` — e.g. the
  ternaries producing `"That's a strong upward trend."` / `"Perfect
  attendance so far."` / `"Fairly steady, no big swing either way."` for
  `growth_rate_student` and `attendance_student`. These can't be translated
  by editing JSON alone; they need to move into
  `knowledge/smart-questions.json` (or `srT()` keys) first.

### What "translate the new questions" concretely means
Two real options — pick one, don't half-do both:

**Option A — extend the untranslated-JSON approach (bigger, but matches
what "translate this question bank" sounds like):**
1. Add a `lang` param to `SmartQueryV2.load()` (`bal/smart-search/smart-query-v2.js`)
   and either fetch `knowledge/smart-questions.<lang>.json` or fetch the
   English file once and look up per-question translations from a parallel
   locale map — needs a design decision, not just string-filling.
2. Create 12 translated copies of `knowledge/smart-questions.json` (or one
   file per locale under a new `knowledge/` subfolder), each translating
   every `label`/`answerTemplate`/`keywords`/`emptyMessage`/
   `unavailableMessage` for **all 31 questions** (not just the 14 new
   ones — the original 17 were never translated either, so this is a
   from-scratch translation pass, not an incremental one).
3. Move the JS-literal notes listed above into the JSON files as proper
   templated fields so they translate too.

**Option B — convert to the existing `srT()` pattern (matches how the rest
of the app is localized, smaller footprint per question):**
1. For each of the 31 questions, move `label`/`answerTemplate`/notes into
   `srT()` keys in `i18n/smart-search/en.json` (which already holds the note
   strings like `smart_keep_reinforcing`, `smart_close_to_top` for the
   *original* 17 — so this file already has the right shape, just
   incomplete coverage), then reference those keys from
   `knowledge/smart-questions.json` instead of inline text.
2. Add the equivalent keys + translated values to all 12 locale files in
   `/i18n/`.
3. `keywords` arrays (used for free-text matching, not display) probably
   stay English-only or need a separate per-locale matching strategy — an
   open design question, not just a translation task.

### Exact new question IDs needing translation (14 total)
File: `/knowledge/smart-questions.json` — folder `knowledge/` at repo root.

**Class-level (5) — inside `categories[0]` (`"id": "class_management"`):**
| # | id | fields to translate |
|---|---|---|
| 1 | `growth_leaders` | `label`, `answerTemplate`, `emptyMessage`, `keywords` (7) |
| 2 | `class_topper` | `label`, `answerTemplate`, `emptyMessage`, `keywords` (7) |
| 3 | `who_needs_help` | `label`, `answerTemplate`, `emptyMessage`, `keywords` (8) |
| 4 | `who_is_excelling` | `label`, `answerTemplate`, `emptyMessage`, `keywords` (7) |
| 5 | `subject_breakdown_all` | `label`, `answerTemplate`, `keywords` (7) |

**Per-student (9) — inside `categories[1]` (`"id": "per_student"`):**
| # | id | fields to translate |
|---|---|---|
| 6 | `growth_rate_student` | `label`, `answerTemplate`, `unavailableMessage`, `keywords` (5) — plus the JS-literal `growthNote` ternary noted above |
| 7 | `grade_student` | `label`, `answerTemplate`, `keywords` (3) |
| 8 | `overall_avg_student` | `label`, `answerTemplate`, `keywords` (6) |
| 9 | `attendance_student` | `label`, `answerTemplate`, `keywords` (5) — plus the JS-literal `attendanceNote` ternary |
| 10 | `best_worst_test_student` | `label`, `answerTemplate`, `unavailableMessage`, `keywords` (5) |
| 11 | `home_plan_student` | `label`, `answerTemplate`, `keywords` (5) |
| 12 | `school_plan_student` | `label`, `answerTemplate`, `unavailableMessage`, `keywords` (5) |
| 13 | `parent_message_student` | `label`, `answerTemplate`, `keywords` (5) |
| 14 | `trend_facts_student` | `label`, `answerTemplate`, `keywords` (5) |

**Also new in `domainVocabulary` (top of the same file, flat array):**
`growth`, `growing`, `flagged`, `excelling`, `plan`, `recommendation` — 6
words, used by `isOutOfDomain()` in `smart-query-v2.js` as a last-resort
gate, so these need translated equivalents too if Option A is chosen (moot
under Option B, since matching stays keyword-based either way — see the
open question above).

### Not yet translated either (pre-existing, not part of my rounds)
The original 17 question ids in the same file/categories are equally
untranslated. If the other agent is doing a real localization pass, scoping
it to "just the 14 new ones" leaves the bank half-English-only either way —
worth deciding up front whether this round covers all 31 or just the 14.

---

## 2026-08-28 — Round 4: "class-" / "student-" explicit-scope prefix

### Ask
Let the user type a `class-` or `student-` prefix to explicitly scope a
query, cutting matching work and improving precision — and nudge users
toward using it.

### What changed
`match()` in `bal/smart-search/smart-query-v2.js` now strips a leading
`class-` / `student-` prefix (case-insensitive, whitespace-tolerant —
`"Class -  weakest subject"` also works) before any other processing:

- **`class-` prefix** — skips `findStudentCandidates()` entirely (the
  per-student fuzzy-name scan over every student, the most expensive part of
  a query on a large roster) and scores only against `class_management`
  questions.
- **`student-` prefix** — still resolves the student name from the
  remaining text (that part's unavoidable — it's *which* student, not
  *whether* one), but scores only against `per_student` questions, so a
  class-wide question can never accidentally outrank the per-student answer
  that was actually asked for.
- Either prefix also bypasses the `isOutOfDomain()` gate — explicit scope is
  itself a strong enough on-topic signal, so a scoped query with no exact
  keyword hit still surfaces that category's suggestion chips instead of
  the flat "outside what I can help with" deflection.
- No prefix → byte-identical behavior to before (this was an additive
  fast-path, not a rewrite of the existing scoring loop).

### UI nudge
Added a persistent small tip line under the input in all three Smart Search
surfaces (single new `srT()` key, `smart_v2_prefix_tip`, so translators only
need to handle it once):
- `ui/common/render-buckets.js` — main chat screen composer
- `core/vs-shell.js` — right-rail widget
- `ui/smart-search/smart-query-v2-ui.js` — floating panel

### Files changed this round
- `bal/smart-search/smart-query-v2.js` — prefix parsing + scoped
  candidate/skip logic in `match()`
- `ui/common/render-buckets.js` — tip line under composer
- `core/vs-shell.js` — tip line under rail composer
- `ui/smart-search/smart-query-v2-ui.js` — tip line under floating panel input
- `core/render-i18n.js` + `i18n/common/en.json` — new key
  `smart_v2_prefix_tip` (added to **both** — see Round 3 notes on why: the
  JS file's `SR_STRINGS_EN` is the hardcoded fallback, `i18n/common/en.json`
  is what actually loads into `I18N_TABLES.en` at runtime; both need to
  match or the fallback silently masks a missing runtime key)

### i18n note (ties into Round 3)
`smart_v2_prefix_tip` is a **new, English-only** key, same as everything
else flagged in Round 3 — it needs the same translation pass into the 12
locale files in `/i18n/`, not a separate one. Rolling it into whatever
`class-`/`student-` scope decision comes out of Round 3 rather than
treating it as its own translation task.
