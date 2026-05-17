#!/usr/bin/env bash
# Detects where uncommitted changes live: main repo or a worktree.
# Outputs key=value pairs followed by the dirty file list.
#
# Output keys:
#   GIT_ROOT   — absolute path to work from (main repo or worktree)
#   BRANCH     — current branch at that location
#   STATUS     — changes_here | changes_in_worktree | clean
#   (followed by git status --short lines for the dirty location)

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)

# 1. Check the current working directory first
CURRENT_CHANGES=$(git status --short 2>/dev/null | grep -c '' || true)

if [ "$CURRENT_CHANGES" -gt 0 ]; then
  echo "GIT_ROOT=$REPO_ROOT"
  echo "BRANCH=$(git branch --show-current)"
  echo "STATUS=changes_here"
  git status --short
  exit 0
fi

# 2. Walk all registered worktrees looking for dirty state
while IFS= read -r line; do
  if [[ "$line" == worktree\ * ]]; then
    WT_PATH="${line#worktree }"
    [ "$WT_PATH" = "$REPO_ROOT" ] && continue   # skip main, already checked

    WT_CHANGES=$(git -C "$WT_PATH" status --short 2>/dev/null | grep -c '' || true)
    if [ "$WT_CHANGES" -gt 0 ]; then
      echo "GIT_ROOT=$WT_PATH"
      echo "BRANCH=$(git -C "$WT_PATH" branch --show-current)"
      echo "STATUS=changes_in_worktree"
      git -C "$WT_PATH" status --short
      exit 0
    fi
  fi
done < <(git worktree list --porcelain)

# 3. Nothing dirty anywhere
echo "GIT_ROOT=$REPO_ROOT"
echo "BRANCH=$(git branch --show-current)"
echo "STATUS=clean"
