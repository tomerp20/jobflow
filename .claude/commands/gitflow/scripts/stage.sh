#!/usr/bin/env bash
# Stages explicit files only — never git add -A or git add .
# Usage: stage.sh [-C <git-root>] <file1> [file2 ...]
#
# -C <git-root>   run git from this directory (use for worktree paths)

set -euo pipefail

GIT_ROOT=""
FILES=()

# Defense-in-depth deny-list. The skill caller is expected to filter these out,
# but we refuse them here too so a slip can never stage a secret.
DENY_REGEX='(^|/)(\.env(\..*)?|CLAUDE\.md|.*\.pem|.*\.key|.*\.p12|id_rsa(\..*)?|secrets?)$'

while [[ $# -gt 0 ]]; do
  case "$1" in
    -C) GIT_ROOT="$2"; shift 2 ;;
    .|-A|--all)
      echo "ERROR: refusing wildcard staging ('$1') — pass explicit file paths" >&2
      exit 1 ;;
    *)
      if [[ "$1" =~ $DENY_REGEX ]]; then
        echo "ERROR: refusing to stage sensitive path: '$1'" >&2
        exit 1
      fi
      FILES+=("$1")
      shift ;;
  esac
done

if [ ${#FILES[@]} -eq 0 ]; then
  echo "ERROR: at least one file path required" >&2
  exit 1
fi

if [ -n "$GIT_ROOT" ]; then
  git -C "$GIT_ROOT" add -- "${FILES[@]}"
else
  git add -- "${FILES[@]}"
fi

echo "Staged ${#FILES[@]} file(s):"
for f in "${FILES[@]}"; do
  echo "  + $f"
done
