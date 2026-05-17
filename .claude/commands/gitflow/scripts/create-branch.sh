#!/usr/bin/env bash
# Creates a new branch from latest main.
# Usage: create-branch.sh <branch-name>
#
# Always branches off origin/main (not local main) to avoid stale state.

set -euo pipefail

BRANCH="${1:?ERROR: branch-name required}"

git fetch origin main --quiet
git checkout main
git reset --hard origin/main
git checkout -b "$BRANCH"

echo "Branch created: $BRANCH"
