#!/usr/bin/env python3
"""
i18n gap check — the "bible" for translation completeness across every
locale-bearing area of the app.

Walks every locale group (currently: the main `i18n/*.json` strings table
and `i18n/onboarding/*.json`), diffs each of the 12 regional-language files
against its group's `en.json` baseline, and reports:

  - MISSING   keys present in en.json but absent from the locale file
              (srT()/i18nLabel() silently falls back to English for these —
              not a crash, but an untranslated string a native speaker sees)
  - EXTRA     keys present in the locale file but not in en.json (usually
              stale — the English key was renamed/removed and the locale
              file was never cleaned up)
  - EMPTY     keys present with an empty/whitespace-only string value
  - UNTRANSLATED_SAME_AS_EN  keys whose value is byte-identical to the
              English value — a strong signal the string was copied as a
              placeholder and never actually translated (best-effort
              heuristic: short/numeric/symbol-only strings are excluded
              since those are often legitimately identical, e.g. "PDF",
              "%", punctuation-only strings)
  - PLACEHOLDER_MISMATCH  keys where the {{param}} tokens in the locale
              value don't match the set of tokens in the English value
              (a dropped or renamed {{param}} means srT()'s substitution
              silently leaves the raw "{{param}}" in the rendered string)
  - PLURAL_GAP  keys following the `_one`/`_other` convention (see srT()
              in js/render-i18n.js) where en.json defines both forms but
              the locale only defines one

Run:
    python3 scripts/i18n-gap-check.py            # human-readable report
    python3 scripts/i18n-gap-check.py --json      # machine-readable, for CI
    python3 scripts/i18n-gap-check.py --locale hi # single locale, all groups
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

LOCALES = ["hi", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa", "ur", "as", "or"]
LOCALE_NAMES = {
    "hi": "Hindi", "bn": "Bengali", "ta": "Tamil", "te": "Telugu",
    "mr": "Marathi", "gu": "Gujarati", "kn": "Kannada", "ml": "Malayalam",
    "pa": "Punjabi", "ur": "Urdu", "as": "Assamese", "or": "Odia",
}

# Each group = one baseline en.json + a directory/pattern for the 12
# locale files. Add new groups here if a new locale-bearing area is added
# to the app (e.g. a future per-locale onboarding-slider-2 deck).
GROUPS = [
    {"name": "main (i18n/*.json)", "dir": ROOT / "i18n", "pattern": "{lc}.json"},
    {"name": "onboarding (i18n/onboarding/*.json)", "dir": ROOT / "i18n" / "onboarding", "pattern": "{lc}.json"},
]

PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")
PLURAL_SUFFIX_RE = re.compile(r"^(.*)_(one|other)$")


def load_json(path):
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def flat_keys(d):
    """Top-level string keys only, skipping _meta/_comment/etc metadata."""
    return {k: v for k, v in d.items() if not k.startswith("_") and isinstance(v, str)}


def is_translatable_heuristic(en_value):
    """Skip flagging UNTRANSLATED_SAME_AS_EN for strings unlikely to ever
    differ across languages: pure numbers/symbols, placeholder-only
    strings (e.g. "{{count}}"), very short strings once placeholders are
    stripped out, and pure ALLCAPS acronyms (PDF, MIT, PWA, ERP, SD, Q1)."""
    literal = PLACEHOLDER_RE.sub("", en_value).strip()
    if len(literal) < 3:
        return False
    if not re.search(r"[A-Za-z]", literal):
        return False
    # A >=3-char literal with no lowercase letter is almost always an
    # acronym/jargon term or a glossary label kept in English on purpose
    # (MIT, PWA, ERP, CBSE / ICSE, SD, Q1, Q3) rather than an untranslated
    # sentence.
    if literal.isupper():
        return False
    return True


def analyze_group(group):
    en_path = group["dir"] / group["pattern"].format(lc="en")
    en_data = load_json(en_path)
    if en_data is None:
        return {"name": group["name"], "error": f"baseline not found: {en_path}"}
    en_flat = flat_keys(en_data)
    en_keys = set(en_flat.keys())

    plural_bases = set()
    for k in en_keys:
        m = PLURAL_SUFFIX_RE.match(k)
        if m:
            plural_bases.add(m.group(1))
    plural_complete_bases = {
        b for b in plural_bases if f"{b}_one" in en_keys and f"{b}_other" in en_keys
    }

    result = {"name": group["name"], "dir": group["dir"], "pattern": group["pattern"], "baseline_key_count": len(en_keys), "locales": {}}

    for lc in LOCALES:
        loc_path = group["dir"] / group["pattern"].format(lc=lc)
        loc_data = load_json(loc_path)
        if loc_data is None:
            result["locales"][lc] = {"error": f"file not found: {loc_path}"}
            continue
        loc_flat = flat_keys(loc_data)
        loc_keys = set(loc_flat.keys())

        missing = sorted(en_keys - loc_keys)
        extra = sorted(loc_keys - en_keys)
        empty = sorted(k for k in (en_keys & loc_keys) if not loc_flat[k].strip())
        same_as_en = sorted(
            k for k in (en_keys & loc_keys)
            if k not in empty
            and loc_flat[k] == en_flat[k]
            and is_translatable_heuristic(en_flat[k])
        )

        placeholder_mismatch = []
        for k in en_keys & loc_keys:
            if k in empty:
                continue
            en_tokens = set(PLACEHOLDER_RE.findall(en_flat[k]))
            if not en_tokens:
                continue
            loc_tokens = set(PLACEHOLDER_RE.findall(loc_flat[k]))
            if en_tokens != loc_tokens:
                placeholder_mismatch.append(
                    {"key": k, "expected": sorted(en_tokens), "found": sorted(loc_tokens)}
                )

        plural_gap = []
        for b in plural_complete_bases:
            has_one = f"{b}_one" in loc_keys
            has_other = f"{b}_other" in loc_keys
            if has_one != has_other:
                plural_gap.append({"base": b, "has_one": has_one, "has_other": has_other})

        result["locales"][lc] = {
            "key_count": len(loc_keys),
            "missing": missing,
            "extra": extra,
            "empty": empty,
            "untranslated_same_as_en": same_as_en,
            "placeholder_mismatch": placeholder_mismatch,
            "plural_gap": plural_gap,
        }

    return result


def group_by_prefix(keys):
    """Rough 'area' bucketing for a translator-facing report — groups keys
    by their first underscore-delimited segment (setup_, merge_, smart_,
    toast_, val_, etc.) so a translator can tackle one feature area at a
    time instead of an alphabetical wall of keys."""
    buckets = {}
    for k in keys:
        prefix = k.split("_")[0]
        buckets.setdefault(prefix, []).append(k)
    return dict(sorted(buckets.items(), key=lambda kv: -len(kv[1])))


def print_human_report(groups_result):
    total_missing_by_locale = {lc: 0 for lc in LOCALES}
    print("=" * 78)
    print("i18n GAP CHECK — full report")
    print("=" * 78)

    for group in groups_result:
        print(f"\n### GROUP: {group['name']}")
        if "error" in group:
            print(f"  !! {group['error']}")
            continue
        print(f"  Baseline (en): {group['baseline_key_count']} keys")

        any_missing = any(
            v.get("missing") for v in group["locales"].values() if "error" not in v
        )
        for lc in LOCALES:
            v = group["locales"][lc]
            name = LOCALE_NAMES[lc]
            if "error" in v:
                print(f"  {lc} ({name}): !! {v['error']}")
                continue
            total_missing_by_locale[lc] += len(v["missing"])
            flags = []
            if v["missing"]:
                flags.append(f"{len(v['missing'])} missing")
            if v["extra"]:
                flags.append(f"{len(v['extra'])} extra")
            if v["empty"]:
                flags.append(f"{len(v['empty'])} empty")
            if v["untranslated_same_as_en"]:
                flags.append(f"{len(v['untranslated_same_as_en'])} same-as-EN")
            if v["placeholder_mismatch"]:
                flags.append(f"{len(v['placeholder_mismatch'])} placeholder-mismatch")
            if v["plural_gap"]:
                flags.append(f"{len(v['plural_gap'])} plural-gap")
            status = ", ".join(flags) if flags else "clean"
            print(f"  {lc} ({name}): {v['key_count']} keys — {status}")

        if not any_missing:
            print("\n  ✓ No missing keys in this group.")
        else:
            # Since every locale in this repo is generated/maintained in
            # lockstep, missing-key sets are typically identical across all
            # 12 locales — print the union once, bucketed by feature-area
            # prefix, rather than repeating an identical 15-line list 12
            # times.
            union_missing = sorted(set().union(*(
                set(v.get("missing", [])) for v in group["locales"].values() if "error" not in v
            )))
            if union_missing:
                print(f"\n  --- Missing keys (union across all locales, {len(union_missing)} total) ---")
                en_flat_for_group = flat_keys(load_json(group['dir'] / group['pattern'].format(lc='en')))
                for prefix, keys in group_by_prefix(union_missing).items():
                    print(f"  [{prefix}] ({len(keys)}):")
                    for k in keys:
                        en_val = en_flat_for_group[k]
                        preview = en_val if len(en_val) <= 70 else en_val[:67] + "..."
                        print(f"      {k}: \"{preview}\"")

            same_locale_sets = len({
                tuple(v["missing"]) for v in group["locales"].values() if "error" not in v
            }) == 1
            if same_locale_sets:
                print("\n  ✓ All 12 locales are missing the exact same key set — no locale has "
                      "drifted further behind the others.")
            else:
                print("\n  ⚠ Locales differ in WHICH keys are missing — see per-locale JSON output "
                      "for exact per-language lists (run with --json).")

        def report_field(field, label, item_formatter=None, max_items=None):
            """Print a group-level field (same-as-EN, placeholder mismatches,
            extra keys, plural gaps) once if identical across all 12
            locales, else per-locale. Keeps the report readable instead of
            repeating an identical list 12 times over."""
            non_error = {lc: group["locales"][lc] for lc in LOCALES if "error" not in group["locales"][lc]}
            populated = {lc: v[field] for lc, v in non_error.items() if v[field]}
            if not populated:
                return
            as_tuples = {lc: tuple(sorted(map(repr, v))) for lc, v in populated.items()}
            all_same = len(set(as_tuples.values())) == 1 and len(populated) == len(non_error)
            fmt = item_formatter or (lambda x: f"      {x}")
            if all_same:
                items = list(populated.values())[0]
                print(f"\n  --- {label} (identical across all 12 locales, {len(items)} total) ---")
                shown = items[:max_items] if max_items else items
                for item in shown:
                    print(fmt(item))
                if max_items and len(items) > max_items:
                    print(f"      ...and {len(items)-max_items} more")
            else:
                for lc in LOCALES:
                    items = populated.get(lc)
                    if not items:
                        continue
                    print(f"\n  --- {lc} ({LOCALE_NAMES[lc]}): {label} ---")
                    shown = items[:max_items] if max_items else items
                    for item in shown:
                        print(fmt(item))
                    if max_items and len(items) > max_items:
                        print(f"      ...and {len(items)-max_items} more")

        report_field("untranslated_same_as_en", "possibly-untranslated (identical to English)")
        report_field(
            "placeholder_mismatch", "{param} placeholder mismatches",
            item_formatter=lambda pm: f"      {pm['key']}: expected {pm['expected']}, found {pm['found']}",
        )
        report_field("extra", "extra/orphaned keys (not in en.json)")
        report_field(
            "plural_gap", "incomplete plural pairs (_one/_other)",
            item_formatter=lambda pg: f"      {pg['base']}: has_one={pg['has_one']}, has_other={pg['has_other']}",
        )

    print("\n" + "=" * 78)
    print("SUMMARY — missing-key count by locale (summed across all groups)")
    print("=" * 78)
    for lc in LOCALES:
        print(f"  {lc:4s} ({LOCALE_NAMES[lc]:10s}): {total_missing_by_locale[lc]} missing")
    print()


def main():
    args = sys.argv[1:]
    as_json = "--json" in args
    only_locale = None
    if "--locale" in args:
        only_locale = args[args.index("--locale") + 1]

    global LOCALES
    if only_locale:
        LOCALES = [only_locale]

    groups_result = [analyze_group(g) for g in GROUPS]

    if as_json:
        def stringify_path(o):
            if isinstance(o, Path):
                return str(o)
            raise TypeError
        # strip Path objects before dumping
        for g in groups_result:
            g.pop("dir", None)
        print(json.dumps(groups_result, ensure_ascii=False, indent=2, default=stringify_path))
    else:
        print_human_report(groups_result)


if __name__ == "__main__":
    main()
