#!/usr/bin/env bash
set -euo pipefail

# Download one or more hourly GH Archive files to the HDD storage path.
# Usage: ./download-archive.sh 2026-05-01-15   (single hour)
#        ./download-archive.sh 2026-05-01-{0..23} (full day, via brace expansion)

DEST_DIR="/mnt/hdd/gh-archive"   # adjust to actual HDD mount point
BASE_URL="https://data.gharchive.org"

mkdir -p "$DEST_DIR"

for HOUR in "$@"; do
  FILE="${HOUR}.json.gz"
  DEST="${DEST_DIR}/${FILE}"
  if [[ -f "$DEST" ]]; then
    echo "Already exists, skipping: $FILE"
    continue
  fi
  echo "Downloading $FILE..."
  curl -fL --retry 3 --retry-delay 5 -o "$DEST" "${BASE_URL}/${FILE}"
  echo "Saved to $DEST"
done
