#!/usr/bin/env python3
"""
i18n hardcoded-string lint — catches a new un-translated string at PR time
instead of after a customer screenshots it in production.

Every gap fixed in the v4.1 i18n pass (~74 strings across ~9 files) existed
because a screen was never wired to srT()/pdfT() at all — there was no
automated check to catch that before it shipped, only manual QA. This
script is that check.

WHAT IT DOES
This is a heuristic regex scanner, not a JS parser — it cannot know for
certain whether a given string literal is user-facing UI copy or something
that's fine to leave in English (a CSS value, a data-action name, a
console.log). It flags PATTERNS that were the actual root cause of every
real gap found this session:

  1. title="..."         / aria-label="..." / placeholder="..."
     containing a capitalized multi-word English phrase, not wrapped in
     srT(...)/pdfT(...)/esc(srT(...)) on the same line.
  2. toast("...", ...) / alert("...") / confirm("...")
     with a literal English string as the first argument.
  3. >Some Words</tag>   text nodes inside common container/label tags
     (div, span, button, label, p, b, h1-h4) that look like real sentence
     or title-case UI copy, not a single technical token.

WHAT IT DELIBERATELY DOES NOT FLAG (to keep signal-to-noise usable)
  - Anything already passed through srT(...), pdfT(...), esc(srT(...)),
    i18nLabel(...), or escapeHtml(srT(...)) — even earlier on the same
    line.
  - Template-literal expressions (${...}) — too easy to false-positive on
    interpolated dynamic content.
  - Short (<4 char), numeric, symbol-only, or ALL-CAPS strings (icon
    glyphs, CSS classes, "PDF", "OK", punctuation).
  - Files/dirs on the ignore list below (see IGNORE_FILES / IGNORE_DIRS)
    — e.g. pitch-deck.js is documented English-only by design,
    render-i18n.js *is* the English string source of truth,
    scripts/i18n/dev-tests aren't shipped UI.
  - Lines ending in `// i18n-ignore` — an explicit, reviewable escape
    hatch for genuine exceptions (brand names, technical identifiers)
    so this script doesn't have to be perfect, just used with judgment.

USAGE
  python3 scripts/i18n-lint-hardcoded-strings.py            # human report
  python3 scripts/i18n-lint-hardcoded-strings.py --ci        # exit 1 on any finding, for CI gating

This is advisory, like i18n-gap-check.py: it doesn't auto-fix anything,
it tells you where to look. Every finding needs a human judgment call —
"is this real UI copy, or is it fine as-is" — same as the manual audit
that found the original ~30 gaps.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SCAN_DIRS = ["ui", "core", "bal", "dal"]

IGNORE_FILES = {
    "core/render-i18n.js",       # the English string source of truth itself
    "ui/common/pitch-deck.js",   # documented English-only by design
}
IGNORE_DIRS = {"node_modules", "i18n", "dev-tests", "scripts", "samples", "handover", "img", "css"}

# Already-safe call wrappers — if one of these appears anywhere earlier on
# the same line before the matched string, treat the line as covered.
SAFE_WRAPPERS = re.compile(r'\b(srT|pdfT|i18nLabel|escapeHtml\s*\(\s*srT)\s*\(')

ATTR_PATTERN = re.compile(
    r'\b(title|aria-label|placeholder)="([A-Z][A-Za-z0-9 ,.\'!?()%/&-]{6,})"'
)
TOAST_PATTERN = re.compile(
    r'\b(toast|alert|confirm)\(\s*"([A-Z][^"]{6,})"'
)
TEXT_NODE_PATTERN = re.compile(
    r'>([A-Z][A-Za-z0-9 ,.\'!?()%/&-]{5,60})</(div|span|button|label|p|b|h[1-4])>'
)

TRIVIAL = re.compile(r'^[A-Z0-9\s%.\-_/]{1,4}$')  # "OK", "PDF", "%", "—" etc.


def is_ignored(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    if str(rel) in IGNORE_FILES:
        return True
    return any(part in IGNORE_DIRS for part in rel.parts)


def line_is_covered(line: str, match_start: int) -> bool:
    """True if a srT()/pdfT()/etc wrapper appears before the match on this line."""
    return bool(SAFE_WRAPPERS.search(line[:match_start]))


def scan_file(path: Path):
    findings = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        return findings
    for lineno, line in enumerate(lines, start=1):
        if line.rstrip().endswith("// i18n-ignore"):
            continue
        if "${" in line:
            # Template-literal interpolation present — too noisy to trust
            # the attribute/text-node heuristics on this line specifically,
            # but toast/alert/confirm calls are still worth checking since
            # those take a plain string first-argument almost always.
            for pat in (TOAST_PATTERN,):
                for m in pat.finditer(line):
                    if TRIVIAL.match(m.group(2)):
                        continue
                    if line_is_covered(line, m.start()):
                        continue
                    findings.append((lineno, m.group(2), "toast/alert/confirm"))
            continue
        for pat, label, text_group in (
            (ATTR_PATTERN, "title/aria-label/placeholder", 2),
            (TOAST_PATTERN, "toast/alert/confirm", 2),
            (TEXT_NODE_PATTERN, "text node", 1),
        ):
            for m in pat.finditer(line):
                text = m.group(text_group)
                if TRIVIAL.match(text):
                    continue
                if line_is_covered(line, m.start()):
                    continue
                findings.append((lineno, text, label))
    return findings


def main():
    ci_mode = "--ci" in sys.argv
    total = 0
    by_file = {}
    for d in SCAN_DIRS:
        base = ROOT / d
        if not base.exists():
            continue
        for path in sorted(base.rglob("*.js")):
            if is_ignored(path):
                continue
            findings = scan_file(path)
            if findings:
                by_file[path.relative_to(ROOT)] = findings
                total += len(findings)

    if not by_file:
        print("i18n hardcoded-string lint: clean — no likely-untranslated strings found.")
        return 0

    print("=" * 78)
    print("i18n hardcoded-string lint — possible untranslated UI strings")
    print("=" * 78)
    print("Heuristic scan. Each finding needs a human call — see script docstring.")
    print("Wrap real UI copy in srT(\"key\") (add the key to the right i18n/*/en.json")
    print("shard + all 12 locale files), or append '// i18n-ignore' if intentional.\n")
    for path, findings in sorted(by_file.items()):
        print(f"{path}  ({len(findings)} finding(s))")
        for lineno, text, kind in findings:
            shown = text if len(text) <= 70 else text[:67] + "..."
            print(f"    L{lineno:<5} [{kind}] \"{shown}\"")
        print()
    print("-" * 78)
    print(f"TOTAL: {total} finding(s) across {len(by_file)} file(s)")
    print("-" * 78)

    if ci_mode:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
