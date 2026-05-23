#!/usr/bin/env bash
#
# JobFlow data-pipeline bootstrap.
#
# Idempotent one-time setup for a fresh Xubuntu box. Safe to re-run.
# See data-pipeline/SETUP.md for the prerequisite checklist this script does NOT cover.

set -euo pipefail

# Resolve repo paths from this script's location.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DATA_PIPELINE_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd -- "${DATA_PIPELINE_ROOT}/.." && pwd)"

HDD_MOUNT="/mnt/hdd"
GHARCHIVE_DIR="${HDD_MOUNT}/gharchive"
LOG_DIR="${HOME}/jobflow-logs"
CRON_DEST="/etc/cron.d/jobflow"
CRON_TEMPLATE="${DATA_PIPELINE_ROOT}/cron/jobflow.cron.template"
COMPOSE_FILE="${DATA_PIPELINE_ROOT}/docker-compose.yml"
SCHEMA_DIR="${DATA_PIPELINE_ROOT}/schema"

OPERATOR_USER="$(whoami)"

log()  { printf '[bootstrap] %s\n' "$*"; }
fail() { printf '[bootstrap] FATAL: %s\n' "$*" >&2; exit 1; }

# ── 1. Prerequisite checks ───────────────────────────────────────────────────
log "Step 1: checking prerequisites"

command -v node >/dev/null 2>&1 || fail "node is not on PATH (need >= 20.6). See data-pipeline/SETUP.md"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if [ "${NODE_MAJOR}" -lt 20 ] || { [ "${NODE_MAJOR}" -eq 20 ] && [ "${NODE_MINOR}" -lt 6 ]; }; then
  fail "node $(node -v) is too old (need >= 20.6). See data-pipeline/SETUP.md"
fi

docker compose version >/dev/null 2>&1 || fail "'docker compose' plugin is missing. See data-pipeline/SETUP.md"
command -v cqlsh >/dev/null 2>&1 || fail "cqlsh is not on PATH. See data-pipeline/SETUP.md"
command -v sudo  >/dev/null 2>&1 || fail "sudo is not on PATH (needed for cron install)"

# ── 2. Mount-point check ─────────────────────────────────────────────────────
log "Step 2: verifying ${HDD_MOUNT} is a real mount point"
mountpoint -q "${HDD_MOUNT}" || fail "${HDD_MOUNT} is not a mount point. See data-pipeline/SETUP.md"

# ── 3. Directory creation ────────────────────────────────────────────────────
log "Step 3: creating runtime directories"
mkdir -p "${GHARCHIVE_DIR}"
mkdir -p "${LOG_DIR}"
# Keep logs private to the operator; Node binaries log Cassandra context at LOG_LEVEL=info.
chmod 700 "${LOG_DIR}"

# ── 4. Cassandra container ───────────────────────────────────────────────────
log "Step 4: bringing up Cassandra via docker compose"
if docker ps --filter "name=jf-cassandra" --filter "status=running" --format '{{.Names}}' | grep -q '^jf-cassandra$'; then
  log "  jf-cassandra container already running; skipping 'docker compose up'"
else
  docker compose -f "${COMPOSE_FILE}" up -d cassandra
fi

log "  waiting for Cassandra to accept CQL connections..."
DELAY=2
MAX_DELAY=30
DEADLINE=$(( $(date +%s) + 300 ))  # 5 minutes
until cqlsh -e "SELECT release_version FROM system.local" >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "${DEADLINE}" ]; then
    fail "Cassandra did not become reachable on 127.0.0.1:9042 within 5 minutes"
  fi
  sleep "${DELAY}"
  if [ "${DELAY}" -lt "${MAX_DELAY}" ]; then
    DELAY=$(( DELAY * 2 ))
    [ "${DELAY}" -gt "${MAX_DELAY}" ] && DELAY="${MAX_DELAY}"
  fi
done
log "  Cassandra is reachable"

# ── 5. Schema migrations ─────────────────────────────────────────────────────
log "Step 5: applying schema migrations in numeric order"
# mapfile (not `for f in $(find ...)`) keeps word-splitting safe even with quirky filenames.
mapfile -t schema_files < <(find "${SCHEMA_DIR}" -maxdepth 1 -name '*.cql' | sort)
for schema_file in "${schema_files[@]}"; do
  schema_name="$(basename "${schema_file}")"
  log "  applying ${schema_name}"
  # ALTER TABLE ADD raises InvalidRequest("conflicts with an existing column") when re-run.
  # Treat as benign only when *every* error-bearing line matches a known-idempotent pattern.
  # Without that "every line" check, a real failure mixed into a multi-statement file would be masked.
  if ! out="$(cqlsh -f "${schema_file}" 2>&1)"; then
    error_lines="$(printf '%s' "${out}" | grep -E 'InvalidRequest|Error|Exception' || true)"
    non_benign="$(printf '%s' "${error_lines}" | grep -vE 'conflicts with an existing column|already exists' || true)"
    if [ -n "${error_lines}" ] && [ -z "${non_benign}" ]; then
      log "    (already applied, skipping)"
    else
      printf '%s\n' "${out}" >&2
      fail "schema ${schema_name} failed"
    fi
  fi
done

# ── 6. Cron install ──────────────────────────────────────────────────────────
log "Step 6: installing cron file to ${CRON_DEST}"
[ -f "${CRON_TEMPLATE}" ] || fail "cron template not found at ${CRON_TEMPLATE}"

TMP_CRON="$(mktemp -t jobflow.cron.XXXXXX)"
trap 'rm -f "${TMP_CRON}"' EXIT
# Resolve node's directory so the cron PATH points at the actual node install (e.g. nvm) rather than guessing.
NODE_BIN_DIR="$(dirname "$(command -v node)")"
# Use | as sed delimiter — JOBFLOW_ROOT, HOME, and NODE_BIN_DIR contain slashes.
sed -e "s|@JOBFLOW_ROOT@|${REPO_ROOT}|g" \
    -e "s|@USER@|${OPERATOR_USER}|g" \
    -e "s|@HOME@|${HOME}|g" \
    -e "s|@NODE_BIN_DIR@|${NODE_BIN_DIR}|g" \
    "${CRON_TEMPLATE}" > "${TMP_CRON}"

sudo cp "${TMP_CRON}" "${CRON_DEST}"
sudo chown root:root "${CRON_DEST}"
sudo chmod 0644 "${CRON_DEST}"

# ── 7. Summary ───────────────────────────────────────────────────────────────
log ""
log "─────────────────────────────────────────────────────────────────"
log "Bootstrap complete."
log ""
log "What was set up:"
log "  • Cassandra container running (jf-cassandra)"
log "  • Keyspace 'jobflow' schemas applied from ${SCHEMA_DIR}"
log "  • Directories: ${GHARCHIVE_DIR}, ${LOG_DIR}"
log "  • Cron schedule installed at ${CRON_DEST}"
log "    user=${OPERATOR_USER}, JOBFLOW_ROOT=${REPO_ROOT}"
log ""
log "Verify with:"
log "  cqlsh -e \"DESCRIBE KEYSPACE jobflow\""
log "  cat ${CRON_DEST}"
log "  mountpoint ${HDD_MOUNT}"
log "  ls ${LOG_DIR}"
log "  sudo systemctl status cron"
log "─────────────────────────────────────────────────────────────────"
