#!/usr/bin/env bash
# Creates a structured commit. Reads the body from stdin.
# Usage: commit.sh [-C <git-root>] <type> <summary> <<'BODY'
#          - bullet 1
#          - bullet 2
#        BODY
#
# type     — feat | fix | refactor | style | docs | test | chore
# summary  — imperative mood, ≤72 chars (no type prefix)
# stdin    — bullet-point body (2–4 lines)

set -euo pipefail

GIT_ROOT=""
TYPE=""
SUMMARY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -C) GIT_ROOT="$2"; shift 2 ;;
    *)
      if   [ -z "$TYPE" ];    then TYPE="$1"
      elif [ -z "$SUMMARY" ]; then SUMMARY="$1"
      fi
      shift
      ;;
  esac
done

[ -z "$TYPE" ]    && { echo "ERROR: type required"    >&2; exit 1; }
[ -z "$SUMMARY" ] && { echo "ERROR: summary required" >&2; exit 1; }

BODY=$(cat)   # read bullet points from stdin

MSG="$(printf '%s: %s\n\n%s\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>' \
  "$TYPE" "$SUMMARY" "$BODY")"

if [ -n "$GIT_ROOT" ]; then
  git -C "$GIT_ROOT" commit -m "$MSG"
else
  git commit -m "$MSG"
fi
