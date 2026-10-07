#!/usr/bin/env bash
# Blocks commits that touch core/ui/bal/dal/js files without also
# updating planner.md's index table.
CHANGED=$(git diff --cached --name-only)
TOUCHES_CODE=$(echo "$CHANGED" | grep -E '^(core|ui|bal|dal|js)/' )
TOUCHES_PLANNER=$(echo "$CHANGED" | grep -E '^planner\.md$')

if [ -n "$TOUCHES_CODE" ] && [ -z "$TOUCHES_PLANNER" ]; then
  echo "BLOCKED: code files changed but planner.md index table was not updated."
  echo "Add a row to planner.md's Index table for this change, then retry."
  exit 1
fi
exit 0
