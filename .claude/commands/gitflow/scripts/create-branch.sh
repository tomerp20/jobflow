#!/usr/bin/env bash
# Creates a new branch from latest origin/main.
# Usage: create-branch.sh <branch-name>
#
# Branches directly off origin/main without touching local main, so any
# uncommitted work or unpushed commits on local main are never destroyed.

set -euo pipefail

BRANCH="${1:?ERROR: branch-name required}"

# 1. Refuse reserved / dangerous names
case "$BRANCH" in
  main|master|HEAD|"")
    echo "ERROR: refusing to create reserved branch name: '$BRANCH'" >&2
    exit 1 ;;
esac

# 2. Enforce JobFlow naming convention (see CLAUDE.md)
if ! [[ "$BRANCH" =~ ^(feat|fix|refactor|experiment|chore|docs|test|style)/[a-z0-9][a-z0-9-]*$ ]]; then
  echo "ERROR: branch must match '<type>/<kebab-case>' (got: '$BRANCH')" >&2
  echo "       valid types: feat, fix, refactor, experiment, chore, docs, test, style" >&2
  exit 1
fi

# 3. Fail fast if the branch already exists locally — never silently reuse it
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "ERROR: branch '$BRANCH' already exists locally" >&2
  exit 1
fi

# 4. Fetch the latest main from origin (no destructive reset on local main)
git fetch origin main --quiet

# 5. Branch off the remote ref directly — avoids touching local main
git checkout -b "$BRANCH" origin/main

echo "Branch created: $BRANCH (from origin/main)"
