#!/usr/bin/env bash
# Pushes a branch to origin and sets the upstream tracking ref.
# Usage: push.sh [-C <git-root>] <branch-name>

set -euo pipefail

GIT_ROOT=""
BRANCH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -C) GIT_ROOT="$2"; shift 2 ;;
    *)  BRANCH="$1"; shift ;;
  esac
done

[ -z "$BRANCH" ] && { echo "ERROR: branch-name required" >&2; exit 1; }

# Defense in depth: never push protected base branches through gitflow.
case "$BRANCH" in
  main|master)
    echo "ERROR: refusing to push protected branch '$BRANCH' from gitflow" >&2
    exit 1 ;;
esac

if [ -n "$GIT_ROOT" ]; then
  git -C "$GIT_ROOT" push -u origin "$BRANCH"
else
  git push -u origin "$BRANCH"
fi
