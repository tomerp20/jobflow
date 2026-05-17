#!/usr/bin/env bash
# Creates a GitHub PR. Reads the body from stdin. Prints the PR URL.
# Usage: create-pr.sh <branch-name> <title> <<'BODY'
#          ## Summary
#          ...
#        BODY

set -euo pipefail

BRANCH="${1:?ERROR: branch-name required}"
TITLE="${2:?ERROR: PR title required}"

# Preflight: gh must be installed
if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI is not installed or not on PATH" >&2
  exit 1
fi

# Refuse to open a PR from a protected base branch
case "$BRANCH" in
  main|master)
    echo "ERROR: refusing to open PR from base branch '$BRANCH'" >&2
    exit 1 ;;
esac

# Refuse to read from a terminal — body must be piped via heredoc
if [ -t 0 ]; then
  echo "ERROR: PR body must be piped via stdin (heredoc)" >&2
  exit 1
fi

BODY=$(cat)
if [ -z "${BODY//[[:space:]]/}" ]; then
  echo "ERROR: PR body (stdin) is empty" >&2
  exit 1
fi

# Create the PR (suppress stdout — gh may emit warnings alongside the URL).
gh pr create \
  --base main \
  --head "$BRANCH" \
  --title "$TITLE" \
  --body "$BODY" >/dev/null

# Fetch the URL deterministically via JSON so warnings can't pollute it.
URL=$(gh pr view "$BRANCH" --json url --jq .url)
echo "$URL"
