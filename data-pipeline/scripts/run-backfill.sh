#!/usr/bin/env bash
#
# Backfill cron entry point: disk-space guard → Fetcher (full range) → Backfill Orchestrator.
# Exits non-zero on failure so cron records it; the next interval will try again.

set -euo pipefail

MIN_FREE_GB=50
HDD_MOUNT="/mnt/hdd"
BACKFILL_START_DATE="2025-05-22"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DATA_PIPELINE_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd -- "${DATA_PIPELINE_ROOT}/.." && pwd)"

# Load per-machine env (Cassandra contact points, GHARCHIVE_DIR, etc.) if present.
if [ -f "${DATA_PIPELINE_ROOT}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${DATA_PIPELINE_ROOT}/.env"
  set +a
fi

# Mount + disk-space guard. Checking the mountpoint first surfaces "/mnt/hdd missing" as a real cause
# rather than letting df fall back to the root filesystem and silently mislead the threshold check.
if ! mountpoint -q "${HDD_MOUNT}"; then
  printf 'FATAL: %s is not a mount point — see data-pipeline/SETUP.md\n' "${HDD_MOUNT}" >&2
  exit 1
fi
AVAILABLE_GB_HDD="$(df --output=avail -BG "${HDD_MOUNT}" | tail -1 | tr -dc '0-9')"
if [ "${AVAILABLE_GB_HDD:-0}" -lt "${MIN_FREE_GB}" ]; then
  printf 'FATAL: less than %s GB free on %s (have %s GB)\n' "${MIN_FREE_GB}" "${HDD_MOUNT}" "${AVAILABLE_GB_HDD:-0}" >&2
  exit 1
fi

cd "${REPO_ROOT}"

END_DATE="$(date -u -d 'yesterday' +%Y-%m-%d)"

node data-pipeline/fetcher/fetcher.js --range "${BACKFILL_START_DATE}" "${END_DATE}"
node data-pipeline/orchestrators/backfill.js
