# Regional i18n Translation Runbook — StudIn

**Give this whole file to whoever (human or AI) is doing the next locale
pass.** It's written to be followed by a fresh Claude/AI session with no
prior context on this conversation — everything it needs is below.

**Core rule, and the entire reason this file exists: every pass is a FRESH
translation, not a patch.** Don't diff against the locale's existing value
and leave it alone if a key already exists. Read the *current* English
value, translate it from scratch, and overwrite whatever was there —
even if the old value looked fine. This is the only way to catch drift
like the real bug found in this repo: `hi.json` had 5 scholarship-reason
keys with old, pre-update phrasing (missing `{{actual}}`/`{{threshold}}`
numbers that the English source gained later) while all 11 other locales
had already picked up the newer text. Patch-style translation lets exactly
this kind of silent staleness accumulate, one skipped key at a time,
forever. Regenerating from scratch every pass makes that structurally
impossible.

---

## 1. Reference material — every English source file

English (`en.json` in each folder below) is the single source of truth.
Never translate from another locale's file, only from English.

| Shard folder | Path | Keys (as of 2026-08-30) |
|---|---|---|
| common | `i18n/common/en.json` | 432 |
| about | `i18n/about/en.json` | 88 |
| ai | `i18n/ai/en.json` | 84 |
| compare | `i18n/compare/en.json` | 40 |
| faq | `i18n/faq/en.json` | 228 |
| onboarding | `i18n/onboarding/en.json` | 99 |
| pdf | `i18n/pdf/en.json` | 102 |
| scholarship | `i18n/scholarship/en.json` | 100 |
| setup | `i18n/setup/en.json` | 99 |
| shell | `i18n/shell/en.json` | 69 |
| smart-search | `i18n/smart-search/en.json` | 54 |
| validation | `i18n/validation/en.json` | 132 |
| **Total** | | **1527** |

Re-run this count at the start of every session — these numbers drift as
the product changes:

```python
import json
shards = ['common','about','ai','compare','faq','onboarding','pdf','scholarship','setup','shell','smart-search','validation']
for s in shards:
    en = json.load(open(f'i18n/{s}/en.json'))
    print(s, len([k for k in en if not k.startswith('_')]))
```

`onboarding` is fetched independently by `core/onboarding-slider.js` (its
own separate i18n namespace, never merged into `SR_STRINGS_EN`) — still
needs translating like every other shard, just noting it's architecturally
separate so you don't go looking for it in `core/render-i18n.js`'s
`I18N_FEATURES` array and conclude it's missing.

## 2. Target locales

`as` (Assamese), `bn` (Bengali), `gu` (Gujarati), `hi` (Hindi), `kn`
(Kannada), `ml` (Malayalam), `mr` (Marathi), `or` (Odia), `pa` (Punjabi),
`ta` (Tamil), `te` (Telugu), `ur` (Urdu).

## 3. Lock the glossary FIRST — before translating anything

Do this once, not per-locale. If left undecided, every locale pass makes
independent, inconsistent calls on the same terms — exactly what already
happened (13 FAQ glossary terms — `Health Score`, `Engagement Index`,
`Plateau Detection`, `Burnout Risk`, `Resilience Score`, `Consistency
Score`, `Growth Rate`, `Volatility`, `Stress Score`, `Median`,
`Percentile` — sitting untranslated in all 12 locales with no recorded
decision on whether that's intentional).

**Ask the user (Sandy) these before starting locale 1, record the answer
here, and apply it identically to every subsequent locale:**

- [ ] Do proprietary product metric names (`Health Score`, `Engagement
      Index`, `Plateau Detection`, `Early Warning Score`, `Burnout Risk`,
      `Resilience Score`, `Volatility`, `Stress Score / Wellbeing Flag`,
      `Consistency Score`, `Growth Rate`) stay in English everywhere, or
      get translated? — **Check first whether the dashboard UI itself
      shows these labels in English regardless of locale** (search
      `bal/common/compute-stats.js` and wherever these strings originate
      as literal labels, not just the FAQ glossary) — if the dashboard
      is English-only for these, the FAQ glossary should match it, not
      the other way around.
- [ ] Standard statistical terms (`Median`, `Percentile`) — translate or
      keep as commonly-used English loanwords? (Common in Indian
      academic contexts to keep these in English — but Sandy's call.)
- [ ] Confirmed always-English, no need to re-ask per locale: brand/product
      names (`StudIn`, `Fedena`, `Entab (CampusCare)`, `Teachmint`),
      domains (`hakki.in`, `spendna.in`), board names (`CBSE`, `ICSE`),
      raw numbers/currency (`58,000+`, `$7.2B`), the founder's name and
      email.
- [ ] `onboard_thankyou_sub` ("धन्यवाद — Namaste 🙏") — confirm this stays
      identical in every locale (a deliberate bilingual greeting), not a
      translation gap.
- [ ] `onboard_s2_r4_erp` ("Budget all-in-ones") — this one's a real
      English phrase, not a proper noun, and it's currently untranslated
      in all 12 locales. Translate it as part of whichever locale you do
      first, and backfill the others once decided.

Write the final decision inline in this file (edit this section) once
Sandy answers, so the next locale pass doesn't have to ask again.

## 4. Per-locale process

**Step 0 — ask which locale.** Don't assume an order. Offer the 12 codes
from §2, let the user pick.

**Step 1 — for the chosen locale, go shard by shard (§1's table, in that
order).** For each shard:

1. Load the current `i18n/<shard>/en.json` (never the locale file, except
   to know which keys exist).
2. For every key, write a fresh translation into
   `i18n/<shard>/<locale>.json`, regardless of what value (if any) is
   currently there. Preserve:
   - Every `{{placeholder}}` exactly, same spelling, same count.
   - Every HTML tag exactly (`<b>`, `<br>`, etc.), same tags, same count.
   - Terms locked in §3 — apply consistently, don't re-decide per key.
   - Tone: match the English source's register (the product is generally
     plain, warm, direct — not overly formal/bureaucratic translation-ese).
3. Write the file back with the same JSON structure/key order as English
   (helps future diffs stay readable).

**Step 2 — automated verification, every shard, before moving to the
next one.** This is the part that actually catches problems — do it in
code, not by eye:

```python
import json, re

def placeholders(s): return set(re.findall(r'\{\{[^}]+\}\}', s)) if isinstance(s,str) else set()
def tags(s): return set(re.findall(r'</?[a-zA-Z][^>]*>', s)) if isinstance(s,str) else set()

en = json.load(open(f'i18n/{shard}/en.json'))
tr = json.load(open(f'i18n/{shard}/{locale}.json'))

missing = [k for k in en if not k.startswith('_') and k not in tr]
extra = [k for k in tr if not k.startswith('_') and k not in en]
mismatches = []
for k, v in en.items():
    if k.startswith('_'): continue
    tv = tr.get(k)
    if isinstance(v, str) and isinstance(tv, str):
        if placeholders(v) != placeholders(tv) or tags(v) != tags(tv):
            mismatches.append(k)

print('missing:', missing)
print('extra:', extra)
print('placeholder/tag mismatches:', mismatches)
```

Every list must be empty before moving on. `missing`/`extra` catch key
drift; `mismatches` catches broken placeholders/tags (the exact class of
bug worth automating, since it's invisible without running the string).

**Step 3 — after all 12 shards for this locale are done, run the
identical-to-English check** to catch anything accidentally left as a
literal copy of the English text instead of translated:

```python
def is_safe(v):  # things that SHOULD legitimately match English — extend as needed from §3's locked list
    vs = v.strip()
    if re.fullmatch(r'\{\{[^}]+\}\}', vs): return True
    if '@' in vs or re.match(r'^https?://', vs): return True
    if vs in LOCKED_SAFE_LIST:  # from §3
        return True
    return False

for shard in shards:
    en = json.load(open(f'i18n/{shard}/en.json'))
    tr = json.load(open(f'i18n/{shard}/{locale}.json'))
    for k, v in en.items():
        if k.startswith('_'): continue
        tv = tr.get(k)
        if isinstance(v,str) and isinstance(tv,str) and tv.strip()==v.strip() and len(v.strip())>3 and not is_safe(v):
            print(shard, k, repr(v))
```

Anything printed here needs a real look — either translate it, or add it
to `LOCKED_SAFE_LIST` in §3 if it's a legitimate exception you're
confirming, not skipping.

**Step 4 — regenerate `SR_STRINGS_EN`.** Not affected by locale work
directly (it's English-only), but if you touched any `en.json` shard
while locking §3 decisions, re-run:
```
python3 scripts/sync-sr-strings-en.py
```

**Step 5 — log it.** Add one row to `planner.md`'s index table (locale
code, files touched = the 12 shard files for that locale, what was
verified, what wasn't — this environment can't speak the language fluently
enough to catch subtle grammatical errors, only structural correctness,
so say that explicitly rather than imply full native-speaker-quality
verification happened). Bump `sw.js`'s `CACHE_VERSION`.

**Step 6 — ask if the user wants the next locale now, or to stop here.**
Don't assume "do all 12 in one sitting" — that's exactly the kind of long
uninterrupted run the user asked to avoid. One locale, fully verified and
logged, is a complete unit of work on its own.

## 5. Definition of done, per locale

- [ ] All 12 shards have every English key present, zero missing/extra
- [ ] Zero placeholder/HTML-tag mismatches (Step 2's script, all shards)
- [ ] Zero un-flagged identical-to-English values (Step 3's script —
      everything printed either got translated or added to the locked
      safe-list with a reason)
- [ ] `planner.md` row added
- [ ] `sw.js` cache bumped
- [ ] Explicitly noted: structural correctness verified programmatically;
      native-speaker fluency/grammar was **not** independently verified —
      say this plainly, don't imply more confidence than the process
      actually earned.
