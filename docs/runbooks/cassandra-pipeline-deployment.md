# Cassandra Pipeline Deployment Runbook

Graduated rollout procedure for deploying the JobFlow Analytics ingestion pipeline on a single-host Linux box. Companion to `data-pipeline/SETUP.md` — SETUP.md covers the one-time prerequisites and `bootstrap.sh`; this runbook covers the validation phases that follow.

Status: written 2026-05-23 after the first successful end-to-end deployment on a Xubuntu 24.04 LTS box (i9-9900K, 16 GB RAM, 480 GB SATA SSD, 2 TB HDD).

---

## Phase 0 — Host prerequisites

Covered in `data-pipeline/SETUP.md`. Quick reference of what must be true before this runbook begins:

- `node --version` is `≥ 20.6`
- `docker compose version` shows v2.x
- `cqlsh --version` shows 6.x
- `mountpoint /mnt/hdd` says "is a mountpoint" (the 2 TB HDD)
- The repo is cloned at a known path, e.g. `~/jobflow`
- `.env` at the repo root configures the per-binary env (Cassandra contact points, GHARCHIVE_DIR, log level)
- The operator has `sudo` access for the one-time cron file install

If any of these fail, fix them before continuing.

---

## Phase 1 — Bootstrap (one-time, automated by `bootstrap.sh`)

```bash
cd ~/jobflow
./data-pipeline/scripts/bootstrap.sh
```

The script's seven idempotent steps:
1. Prerequisite check (the items in Phase 0).
2. Verify `/mnt/hdd` is a real mount point (not just a directory).
3. Create `/mnt/hdd/gharchive/` and `~/jobflow-logs/`.
4. `docker compose up -d cassandra` and wait for healthcheck.
5. Apply schemas 001–008 in numeric order via `cqlsh`.
6. Install `/etc/cron.d/jobflow` with placeholders substituted (one `sudo` prompt here).
7. Print summary and verification commands.

**Pass criteria after Phase 1:**

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
# Expect: jf-cassandra Up X minutes (healthy)

docker exec jf-cassandra cqlsh -e "DESCRIBE KEYSPACE jobflow"
# Expect: backfill_progress, backfill_runs, companies, company_events, processed_files

sudo cat /etc/cron.d/jobflow
# Expect: both cron lines with @USER@, @HOME@, @JOBFLOW_ROOT@, @NODE_BIN_DIR@ all substituted

systemctl is-active cron
# Expect: active
```

If any of these fail, do not proceed.

---

## Phase 2 — Single-file smoke test (Fetcher + Ingester direct)

Goal: verify the Fetcher downloads cleanly and the Ingester writes events to Cassandra. Bypasses the orchestrator and the shell scripts — exercises the core binaries against real GH Archive data.

```bash
# 1. Seed one test company with initialized=true (so Ingester in hourly mode picks it up).
docker exec jf-cassandra cqlsh -e "
  INSERT INTO jobflow.companies (company, org_name, added_at, active, initialized)
  VALUES ('microsoft', 'microsoft', toTimestamp(now()), true, true);
"

# 2. Fetch one known-good hour file.
cd ~/jobflow/data-pipeline/fetcher
node --env-file=../../.env fetcher.js --hour 2025-05-22-15
ls /mnt/hdd/gharchive/2025/05/22/
# Expect: 15.json.gz, ~140 MB

# 3. Process it in hourly mode (no orchestrator needed).
cd ~/jobflow/data-pipeline/ingester
node --env-file=../../.env ingester.js \
  --hour 2025-05-22-15 \
  --mode hourly \
  --target-companies microsoft:microsoft

# 4. Verify.
docker exec jf-cassandra cqlsh -e "
  SELECT count(*) FROM jobflow.company_events
  WHERE company='microsoft' AND year_month='2025-05';
"
docker exec jf-cassandra cqlsh -e "
  SELECT file_name, event_count, filtered_count FROM jobflow.processed_files;
"
```

**Pass criteria:** event count > 0, one row in `processed_files` with `file_name='2025-05-22-15'`.

---

## Phase 3 — Single-day backfill via the orchestrator (no shell script)

Goal: verify the Backfill Orchestrator's full lifecycle — fresh-run detection, target_rows snapshot, Ingester subprocess spawn, LOGGED-BATCH flip of `initialized=true` at the end.

```bash
# 1. Reset the microsoft row back to initialized=false so the Backfill picks it up.
docker exec jf-cassandra cqlsh -e "
  UPDATE jobflow.companies SET initialized=false
  WHERE company='microsoft' AND org_name='microsoft';
"

# 2. Wipe the archive and fetch yesterday's full day only (so the orchestrator's auto-discovered range is exactly one day).
rm -rf /mnt/hdd/gharchive/*
YESTERDAY=$(date -u -d 'yesterday' +%Y-%m-%d)
cd ~/jobflow/data-pipeline/fetcher
node --env-file=../../.env fetcher.js --range "$YESTERDAY" "$YESTERDAY"
find /mnt/hdd/gharchive -name '*.json.gz' | wc -l
# Expect: 24

# 3. Run the Backfill Orchestrator.
cd ~/jobflow/data-pipeline/orchestrators
node --env-file=.env backfill.js

# 4. Verify the end state.
docker exec jf-cassandra cqlsh -e "
  SELECT company, org_name, initialized, initialized_at FROM jobflow.companies
  WHERE company='microsoft';
"
docker exec jf-cassandra cqlsh -e "
  SELECT bucket, run_id, status, started_at, completed_at FROM jobflow.backfill_runs;
"
docker exec jf-cassandra cqlsh -e "
  SELECT date, status, events_written FROM jobflow.backfill_progress;
"
```

**Pass criteria:**
- `companies.microsoft.initialized = true`, `initialized_at` matches `backfill_runs.completed_at`.
- One `backfill_runs` row with `status='completed'`.
- One `backfill_progress` row for yesterday, `status='completed'`, `events_written` matches `microsoft`'s actual activity that day.

---

## Phase 4 — Multi-day backfill at scale

Goal: verify the orchestrator handles a larger range without resource issues, and exercises the resume path if anything crashes.

Adapt the same pattern as Phase 3, but with a 7-day range:

```bash
START=$(date -u -d '7 days ago' +%Y-%m-%d)
END=$(date -u -d 'yesterday' +%Y-%m-%d)

rm -rf /mnt/hdd/gharchive/*
cd ~/jobflow/data-pipeline/fetcher
node --env-file=../../.env fetcher.js --range "$START" "$END"

# Reset companies and run backfill.
# (Seed your full set of companies here, all initialized=false.)
docker exec jf-cassandra cqlsh -e "TRUNCATE jobflow.backfill_runs;"
docker exec jf-cassandra cqlsh -e "TRUNCATE jobflow.backfill_progress;"

cd ~/jobflow/data-pipeline/orchestrators
node --env-file=.env backfill.js
```

**Pass criteria:**
- `backfill_progress` has 7 rows, one per date, all `status='completed'`.
- `backfill_runs` has one row, `status='completed'`.
- Every target Company is `initialized=true`.

**Optional resume test:** kill the orchestrator mid-run with Ctrl-C. Re-invoke `backfill.js`. Verify it logs `resuming run` and picks up at the next non-completed date.

---

## Phase 5 — Hourly orchestrator direct test

Goal: verify the Hourly Orchestrator reads initialised companies, spawns the Ingester with `--catchup`, and processes new files.

```bash
# After Phase 4, all companies are initialized=true.
cd ~/jobflow/data-pipeline/orchestrators
node --env-file=.env hourly.js
```

**Pass criteria:**
- Orchestrator logs `companies loaded — spawning ingester` with the right count.
- Ingester catchup walks GHARCHIVE_DIR, processes any file not in `processed_files`, writes events.
- `processed_files` count grows by however many new files were on disk.

If `processed_files` is already complete for everything on disk, the Ingester logs `nothing to do` and exits 0.

---

## Phase 6 — Lock-coordination test (the load-bearing cron behaviour)

Goal: verify `flock` actually skips an hourly run when a backfill is in progress.

```bash
# Terminal A: simulate a long-running backfill by holding the backfill lock.
flock /var/lock/jobflow-backfill.lock sleep 600

# Terminal B: invoke the hourly cron command verbatim (copy from /etc/cron.d/jobflow).
flock -n /var/lock/jobflow-hourly.lock -c 'if flock -n /var/lock/jobflow-backfill.lock true; then ~/jobflow/data-pipeline/scripts/run-hourly.sh; else echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) skipping: backfill in progress" >> ~/jobflow-logs/hourly-skips.log; fi'

# Verify the skip line was logged.
tail -3 ~/jobflow-logs/hourly-skips.log
# Expect: a line with "skipping: backfill in progress" and the current timestamp.

# Verify the hourly main log is unchanged.
ls -la ~/jobflow-logs/hourly.log
# Expect: empty or unchanged from before Terminal B's invocation.
```

**Pass criteria:** the skip is logged to `hourly-skips.log` and not to `hourly.log`. No Ingester subprocess was spawned. Exit code 0.

Then in Terminal A: `Ctrl-C` to release the lock.

---

## Phase 7 — Hand off to cron (the production cadence)

After Phases 1–6 pass, the pipeline is operationally ready. Cron is already running (`/etc/cron.d/jobflow` was installed in Phase 1).

**Validation:**

1. **Hourly cron at the next `:15`** — wait for the next quarter-hour, then check `tail -100 ~/jobflow-logs/hourly.log` for a successful run.
2. **Backfill cron at the next midnight** — if no Companies are uninitialised, expect a "nothing to do" log line. If a new Company was added recently, expect a full backfill cycle.

After the first successful cron-driven hourly run, the operator's job is done: the pipeline is self-driving.

---

## Phase 8 — Add a new Company and let nightly backfill pick it up

The realistic production cadence test:

```bash
# Insert a new Company with initialized=false.
docker exec jf-cassandra cqlsh -e "
  INSERT INTO jobflow.companies (company, org_name, added_at, active, initialized)
  VALUES ('honeybook', 'honeybook', toTimestamp(now()), true, false);
"

# Wait until midnight. Cron fires run-backfill.sh.
# Backfill Orchestrator detects honeybook is uninitialised, snapshots it as target_rows,
# spawns Ingester to walk the full archive for the row, flips honeybook to initialized=true.

# Next morning, verify:
docker exec jf-cassandra cqlsh -e "SELECT company, initialized FROM jobflow.companies;"
docker exec jf-cassandra cqlsh -e "
  SELECT bucket, run_id, status, completed_at FROM jobflow.backfill_runs;
"
```

**Pass criteria:** Honeybook is now `initialized=true`, a new `backfill_runs` row shows `status='completed'`, and `company_events` contains Honeybook events.

---

## Monitoring during the first week

Once cron is running unattended, a quick daily check (~30 seconds) protects against silent drift:

```bash
tail -50 ~/jobflow-logs/backfill.log         # last night's backfill (or "nothing to do")
tail -200 ~/jobflow-logs/hourly.log          # last 24 hours of hourly runs
tail -20 ~/jobflow-logs/hourly-skips.log     # any unexpected skips

docker exec jf-cassandra cqlsh -e "
  SELECT count(*) FROM jobflow.company_events;
"

df -h /mnt/hdd                                # disk-space sanity
```

If any `FATAL` lines appear in any log, intervene. If `hourly-skips.log` grows during a period when no backfill should be running, investigate (likely a stuck lock file in `/var/lock/`).

---

## Resetting from scratch

If state corruption requires a clean slate:

```bash
sudo systemctl stop cron

# Reset Cassandra data via a temp container (no host sudo needed for the bind mount).
docker compose -f ~/jobflow/data-pipeline/docker-compose.yml down
docker run --rm -v /home/tomer/cassandra-data:/data --entrypoint sh cassandra:4.1 -c 'rm -rf /data/* /data/.[!.]*'

# Wipe the archive.
rm -rf /mnt/hdd/gharchive/*

# Wipe logs.
rm -rf ~/jobflow-logs

# Remove cron file (will be reinstalled by bootstrap).
sudo rm -f /etc/cron.d/jobflow

# Remove stale lock files.
sudo rm -f /var/lock/jobflow-*.lock

# Restart with bootstrap.
cd ~/jobflow
./data-pipeline/scripts/bootstrap.sh

sudo systemctl start cron
```

Then resume from Phase 2.
