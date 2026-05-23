#!/usr/bin/env bash
#
# Hourly cron entry point: disk-space guard → Fetcher (--catchup) → Hourly Orchestrator.
# Exits non-zero on failure so cron records it; the next interval will try again.

set -euo pipefail

MIN_FREE_GB=10
HDD_MOUNT="/mnt/hdd"

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

# Disk-space guard.
AVAILABLE_GB_HDD="$(df --output=avail -BG "${HDD_MOUNT}" | tail -1 | tr -dc '0-9')"
if [ "${AVAILABLE_GB_HDD:-0}" -lt "${MIN_FREE_GB}" ]; then
  printf 'FATAL: less than %s GB free on %s (have %s GB)\n' "${MIN_FREE_GB}" "${HDD_MOUNT}" "${AVAILABLE_GB_HDD:-0}" >&2
  exit 1
fi

cd "${REPO_ROOT}"

node data-pipeline/fetcher/fetcher.js --catchup
node data-pipeline/orchestrators/hourly.js
