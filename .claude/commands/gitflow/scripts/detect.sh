#!/usr/bin/env bash
# Detects where uncommitted changes live: main repo or a worktree.
# Outputs key=value pairs followed by the dirty file list.
#
# Output keys:
#   GIT_ROOT   — absolute path to work from (main repo or worktree)
#   BRANCH     — current branch at that location (or DETACHED)
#   STATUS     — changes_here | changes_in_worktree | multiple_dirty | clean
#   (followed by git status --short lines, or DIRTY=<path> lines when multiple)

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)

# Collect every location with a non-empty git status, then decide what to report.
DIRTY_LOCATIONS=()

count_changes() {
  # Print the number of changed paths at the given dir. Always echoes a number.
  local dir="$1"
  git -C "$dir" status --short 2>/dev/null | wc -l | tr -d ' '
}

# 1. Check the main repo
if [ "$(count_changes "$REPO_ROOT")" -gt 0 ]; then
  DIRTY_LOCATIONS+=("$REPO_ROOT")
fi

# 2. Walk all registered worktrees (skip the main repo — already checked)
while IFS= read -r line; do
  if [[ "$line" == worktree\ * ]]; then
    WT_PATH="${line#worktree }"
    [ "$WT_PATH" = "$REPO_ROOT" ] && continue
    if [ "$(count_changes "$WT_PATH")" -gt 0 ]; then
      DIRTY_LOCATIONS+=("$WT_PATH")
    fi
  fi
done < <(git worktree list --porcelain)

# 3a. Nothing dirty
if [ "${#DIRTY_LOCATIONS[@]}" -eq 0 ]; then
  echo "GIT_ROOT=$REPO_ROOT"
  BR=$(git -C "$REPO_ROOT" branch --show-current)
  echo "BRANCH=${BR:-DETACHED}"
  echo "STATUS=clean"
  exit 0
fi

# 3b. More than one dirty location — surface the ambiguity instead of silently
# picking the first one. The caller decides how to proceed.
if [ "${#DIRTY_LOCATIONS[@]}" -gt 1 ]; then
  echo "STATUS=multiple_dirty"
  for loc in "${DIRTY_LOCATIONS[@]}"; do
    echo "DIRTY=$loc"
  done
  exit 0
fi

# 3c. Exactly one dirty location
LOC="${DIRTY_LOCATIONS[0]}"
echo "GIT_ROOT=$LOC"
BR=$(git -C "$LOC" branch --show-current)
echo "BRANCH=${BR:-DETACHED}"
if [ "$LOC" = "$REPO_ROOT" ]; then
  echo "STATUS=changes_here"
else
  echo "STATUS=changes_in_worktree"
fi
git -C "$LOC" status --short
