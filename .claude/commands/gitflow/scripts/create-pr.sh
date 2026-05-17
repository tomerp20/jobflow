#!/usr/bin/env bash
# Creates a GitHub PR. Reads the body from stdin. Prints the PR URL.
# Usage: create-pr.sh <branch-name> <title> <<'BODY'
#          ## Summary
#          ...
#        BODY

set -euo pipefail

BRANCH="${1:?ERROR: branch-name required}"
TITLE="${2:?ERROR: PR title required}"

BODY=$(cat)   # read PR body from stdin

URL=$(gh pr create \
  --base main \
  --head "$BRANCH" \
  --title "$TITLE" \
  --body "$BODY")

echo "$URL"
