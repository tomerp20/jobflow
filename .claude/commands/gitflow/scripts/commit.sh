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
      else
        echo "ERROR: unexpected extra argument: '$1'" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

[ -z "$TYPE" ]    && { echo "ERROR: type required"    >&2; exit 1; }
[ -z "$SUMMARY" ] && { echo "ERROR: summary required" >&2; exit 1; }

# Validate type against the allowed set
case "$TYPE" in
  feat|fix|refactor|style|docs|test|chore) ;;
  *)
    echo "ERROR: invalid type '$TYPE' — must be one of: feat fix refactor style docs test chore" >&2
    exit 1 ;;
esac

# Enforce ≤72 char summary
if [ ${#SUMMARY} -gt 72 ]; then
  echo "ERROR: summary too long (${#SUMMARY} > 72 chars)" >&2
  exit 1
fi

# Refuse to read from a terminal — body must be piped via heredoc
if [ -t 0 ]; then
  echo "ERROR: commit body must be piped via stdin (heredoc)" >&2
  echo "       example:" >&2
  echo "         commit.sh feat 'summary' <<'BODY'" >&2
  echo "         - bullet 1" >&2
  echo "         BODY" >&2
  exit 1
fi

BODY=$(cat)

if [ -z "${BODY//[[:space:]]/}" ]; then
  echo "ERROR: commit body (stdin) is empty" >&2
  exit 1
fi

MSG="$(printf '%s: %s\n\n%s\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>' \
  "$TYPE" "$SUMMARY" "$BODY")"

if [ -n "$GIT_ROOT" ]; then
  git -C "$GIT_ROOT" commit -m "$MSG"
else
  git commit -m "$MSG"
fi
