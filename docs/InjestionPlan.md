# JobFlow Ingestion Pipeline — Consolidated Plan

**Status:** Final design, ready for implementation
**Scope:** The data acquisition + ingestion subsystem of JobFlow Analytics
**Supersedes:** §5–§6 of the main RFC

---

## 1. Goals and constraints

**Goals**
- Ingest GH Archive hourly event files into Cassandra, filtered to JobFlow's tracked company list (~43+ companies, growing).
- Stay current: process new files within ~1 hour of GH Archive publishing them.
- Backfill efficiently: when new companies are added, scan the local archive against them in a single pass over the data.
- Survive crashes without losing work: resumable per-date for backfill, replayable per-file for hourly.
- Achieve all of the above on a single i9-9900K box with 16 GB RAM and a 2 TB HDD.

**Hard constraints**
- The hourly job and the backfill job must never run simultaneously.
- Files are kept on disk indefinitely (no retention policy in v1; revisit when needed).
- Backfill resumes per-date, not per-company.

**Measured facts (not estimates)**
- ~470 GB compressed per year of GH Archive (from sampling 26 days across 12 months).
- File sizes range from ~0.5 GB/day recently to ~2 GB/day mid-2025; data is shrinking, not growing.
- One year fits comfortably on the 2 TB HDD with room for 3+ years of headroom.

---

## 2. Architecture

```
                    ┌──────────────────────────────┐
                    │   GH Archive (HTTPS, hourly) │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │   Fetcher (Node.js)          │
                    │   - downloads .json.gz files │
                    │   - atomic write to HDD      │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │   HDD: /mnt/hdd/gharchive/   │
                    │     YYYY/MM/DD/HH.json.gz    │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │   Ingester (Node.js)         │
                    │   - main thread reads file   │
                    │   - workers parse + filter   │
                    │   - main writes to Cassandra │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │   Cassandra (single node)    │
                    │   company_events             │
                    │   processed_files            │
                    │   backfill_progress          │
                    │   companies                  │
                    └──────────────────────────────┘
```

**Two cron-driven workflows on top of this architecture:**

| Workflow | Schedule | Targets | Companies filter |
|---|---|---|---|
| `hourly-ingest` | Every hour at :15 | Newly-published GH Archive files | All `initialized = true` companies |
| `backfill` | Daily at 00:00 | The full local archive | All `initialized = false` companies |

Both workflows share the same Fetcher + Ingester code. They differ in:
- **Date range** they target.
- **Company set** they filter against.
- **Throughput strategy** (hourly = low-latency individual writes; backfill = high-throughput batched writes).

---

## 3. Schema additions

The main RFC schemas stay. Three additions:

### 3.1 `companies` — add lifecycle columns

```sql
ALTER TABLE jobflow.companies ADD initialized boolean;
ALTER TABLE jobflow.companies ADD initialized_at timestamp;
```

- JobFlow inserts new companies with `initialized = false`.
- Backfill sets `initialized = true, initialized_at = now()` once a company has been processed against the full local archive.
- Hourly-ingest reads `WHERE active = true AND initialized = true` (filtered application-side).
- Backfill reads `WHERE active = true AND initialized = false` (filtered application-side).

### 3.2 Backfill state — two tables: `backfill_runs` + `backfill_progress`

Backfill state lives in two tables, not one. The run-level metadata (who is the active run, what is its locked target set, what is its overall status) lives in `backfill_runs`. The per-date progress within a run lives in `backfill_progress`. This split avoids denormalising the target set across every date row and gives a Cassandra-idiomatic way to look up "the latest run" without `ALLOW FILTERING`.

```sql
-- Run-level metadata. One row per Backfill Run ever.
CREATE TABLE jobflow.backfill_runs (
    bucket          text,                                 -- always 'singleton'
    run_id          timeuuid,
    started_at      timestamp,
    completed_at    timestamp,
    status          text,                                 -- 'in_progress' | 'completed' | 'failed'
    target_rows     set<frozen<tuple<text, text>>>,       -- locked (company, org) pairs at start of run
    PRIMARY KEY ((bucket), run_id)
) WITH CLUSTERING ORDER BY (run_id DESC);

-- Per-date progress. One row per (run_id, date).
CREATE TABLE jobflow.backfill_progress (
    run_id          timeuuid,
    date            date,
    status          text,                                 -- 'in_progress' | 'completed' | 'failed'
    started_at      timestamp,
    completed_at    timestamp,
    events_written  int,
    PRIMARY KEY ((run_id), date)
) WITH CLUSTERING ORDER BY (date ASC);
```

**Why `bucket = 'singleton'`:** Cassandra has no efficient "find the most recent row globally" query. The fixed-bucket pattern collapses every Backfill Run row into a single partition, clustered by `run_id DESC`. `SELECT * FROM backfill_runs WHERE bucket = 'singleton' LIMIT 1` then returns the latest run efficiently. The partition holds one row per run ever — well under any partition-size limit for the lifetime of this system.

**On backfill startup:**
1. Query uninitialized (Company, Org) rows from `companies`. If empty, exit (nothing to do).
2. Read the latest row from `backfill_runs`. If its `status = 'in_progress'`, this is a resume — its `target_rows` is the locked target set.
3. Otherwise, create a new `run_id` (timeuuid), INSERT a row into `backfill_runs` with the current uninitialized set as `target_rows` and `status = 'in_progress'`. This is the new run.
4. Scan `backfill_progress` for this `run_id`, find `max(date) WHERE status = 'completed'`. Resume from the next date forward.
5. For each date processed successfully, write a `backfill_progress` row with `status = 'completed'`.
6. After all dates are completed, UPDATE every `(company, org)` row in the run's `target_rows` to `initialized = true, initialized_at = now()`, then UPDATE the `backfill_runs` row to `status = 'completed', completed_at = now()`.

**Companies added mid-backfill wait for the next night's run.** The current run's `target_rows` is locked at row insert in step 3 and never changes for the lifetime of that run.

### 3.3 `processed_files` — already in main RFC, hourly-only

No schema changes in PR1. The `file_name` column stores the canonical hour ID `YYYY-MM-DD-H` (hour unpadded — `2025-05-01-15`), matching GH Archive's URL convention. See main RFC §4.3 for full semantics.

**Only the Hourly Ingest reads or writes this table.** Backfill mode never touches `processed_files` — it uses `backfill_progress` (per-date) for crash recovery instead. See ADR 0005 for the design rationale; the short version is that a per-file "done" marker keyed only by file_name causes data loss for Companies added between Backfill Runs.

---

## 4. Fetcher

### 4.1 Responsibilities
- Download `.json.gz` files from `https://data.gharchive.org/`.
- Write atomically to `/mnt/hdd/gharchive/YYYY/MM/DD/HH.json.gz`.
- Idempotent: if file exists at destination, skip.
- Robust to partial downloads (no consumer ever sees a half-written file).

### 4.2 File layout

```
/mnt/hdd/gharchive/
├── 2025/
│   ├── 05/
│   │   ├── 22/
│   │   │   ├── 0.json.gz
│   │   │   ├── 1.json.gz
│   │   │   ├── ...
│   │   │   └── 23.json.gz
```

Hours are unpadded (`7.json.gz`, not `07.json.gz`) — matching GH Archive's URL convention. Months and days are zero-padded.

### 4.3 Atomic write pattern

```javascript
const tmpPath = `${finalPath}.partial`;
// stream download to tmpPath
await fs.promises.rename(tmpPath, finalPath);  // atomic on same filesystem
```

If the process crashes mid-download, `.partial` files are left behind. On next run, the fetcher cleans up **all** `.partial` files at startup — no age threshold. The fetcher is single-process for v1; any `.partial` file by definition belongs to a crashed prior invocation. When concurrent fetcher invocations become possible (cron + flock in a later PR), a file-locking strategy will replace this. Not before.

### 4.4 Failure handling

- HTTP 404 in `--hour` or `--range` modes: file doesn't exist (gap in archive). Log and skip; continue with the next file. Do not retry within the same run.
- HTTP 404 in `--catchup` mode: **end of available data — STOP walking forward.** Every later hour is also a 404 because GH Archive publishes monotonically; continuing past the first catchup-mode 404 wastes ~24 requests per run hitting future hours.
- HTTP 5xx, network errors: retry with exponential backoff, max 3 attempts.
- After failure exhaustion: log the failure as a structured pino entry to stdout, continue with the next file. Don't crash the whole run because one file failed.

### 4.5 Modes

```bash
node fetcher.js --hour 2026-05-22-15            # one specific file
node fetcher.js --range 2026-05-01 2026-05-22   # date range, inclusive on both ends
node fetcher.js --catchup                       # from latest-on-disk to now - 2h
```

`--hour` accepts the canonical hour ID `YYYY-MM-DD-H` (hour unpadded). Strict regex `^\d{4}-\d{2}-\d{2}-\d{1,2}$`; invalid input exits 1.

`--range` is **inclusive on both end dates** — `--range 2025-05-01 2025-05-05` downloads 120 hourly files (5 days × 24 hours). Documented in `--help`.

`--catchup` is what the (deferred) hourly cron will eventually use. It walks back to find the newest file on disk, then fetches forward to `now - 2h` (GH Archive publishes with ~1–2h delay). **Cold start (empty disk) refuses with a clear error and exits 1** — there's no anchor to walk forward from, and a silent fallback could trigger an unintended large download. The user must pass `--hour` or `--range` explicitly to bootstrap. No staleness cap on `--catchup` — if the latest-on-disk is 3 weeks old, all ~500 hours are fetched in this run.

All modes use `p-limit(3)` for download concurrency. v1 needs nothing more — the cron-driven `--catchup` will only fetch 1 file per run in steady state. A `--concurrency N` override can be added later if hours-long manual catchups ever happen.

---

## 5. Ingester

### 5.1 Responsibilities
- Read one or more `.json.gz` files from disk (range determined by CLI args).
- Filter events by company against the in-memory company-org map **built from the `--target-companies` CLI argument** (per ADR 0004, the Ingester is companies-agnostic; it never reads the `companies` Cassandra table).
- Extract tech tags and AI signal.
- Write to `company_events`.
- In `--mode hourly`: mark each file as processed in `processed_files`.
- In `--mode backfill`: write a `backfill_progress` row per completed date (using the `--run-id` arg); do not touch `processed_files`.

The Ingester is a pure stateless worker. All per-job parameters arrive as CLI args; service-level configuration arrives as env vars. See ADR 0004 for the discipline; see ADR 0005 for why `processed_files` is hourly-only.

### 5.2 The fast filter (load-bearing optimization)

For each line in the file, **before parsing JSON**, run a substring check for any tracked org name. If no match, skip immediately. Only parse JSON for lines that pass the fast filter.

```javascript
// Build at startup from the --target-companies CLI argument:
//   "wix/" | "honeybook/" | "upwind/" | ...
// The "/" suffix anchors to repo.name's "org/repo" format,
// reducing false positives from arbitrary text matching org names.
const orgRegex = new RegExp(orgNames.map(o => o + '/').join('|'));

for await (const line of lineReader) {
  if (!orgRegex.test(line)) continue;        // 99.9% of lines exit here
  const event = JSON.parse(line);            // expensive, only for hits
  // ... real processing
}
```

False positives (org name appears in a non-`repo.name` field) are corrected by the proper `repo.name.split('/')[0] in companyMap` check after parsing. False negatives are impossible if `repo.name` contains the org.

**Performance impact**: turns the JSON parse cost from "3M parses per file" to "~500 parses per file." Backfill goes from days to hours.

### 5.3 Worker thread layout

```
Main thread:
  - Opens the file with createReadStream + gunzip + readline
  - Reads lines, distributes batches of 1000 lines to workers via Worker.postMessage
  - Receives parsed+filtered events back
  - Writes to Cassandra via p-limit(50) pool (hourly) or batched (backfill)

Worker threads (4 workers):
  - Receive raw line batches
  - Apply fast filter
  - JSON.parse the hits
  - Apply company filter, tech tag extraction, AI detection
  - Return parsed events to main thread
```

Why 4 workers (not 6 or 8): the i9-9900K has 8 physical cores. Cassandra in Docker uses ~2 cores under sustained load. The OS, Docker, Node.js main thread together use ~1 core. That leaves ~4–5 for workers; 4 is the safe default.

### 5.4 Write strategy

| Job | Strategy | Reason |
|---|---|---|
| `hourly-ingest` | Individual prepared inserts via `p-limit(50)` | Low file volume, latency over throughput |
| `backfill` | `UNLOGGED` batches of ~50 rows per partition | High file volume, throughput over latency |

Cassandra batches are tricky — only batch rows in the same partition (`(company, year_month)`), never mix partitions in one batch. The batch size sweet spot is ~50–100 rows or ~5 KB total, whichever comes first.

### 5.5 Modes

```bash
node ingester.js --hour 2026-05-22-15 --mode hourly \
  --target-companies wix:wix,microsoft:azure
node ingester.js --range 2026-05-01 2026-05-22 --mode backfill \
  --target-companies wix:wix,microsoft:azure \
  --run-id <timeuuid>
node ingester.js --catchup --mode hourly \
  --target-companies wix:wix,microsoft:azure
```

`--mode` switches the write strategy (individual prepared inserts via p-limit(50) for hourly; UNLOGGED per-partition batches for backfill) and toggles the per-mode side effects:
- `--mode hourly` reads and writes `processed_files`; does not touch `backfill_progress` or `backfill_runs`.
- `--mode backfill` writes `backfill_progress` rows per completed date (requires `--run-id`); never touches `processed_files`.

`--target-companies` is required in both modes and is the sole source of truth for the in-memory company-org filter. The Orchestrator (PR3) is responsible for reading `companies` from Cassandra and passing the appropriate filtered list. See ADR 0004 for the args-vs-env-vars contract.

### 5.6 Idempotency

Re-ingesting the same file is safe in both modes:
- `company_events` upserts on the full primary key — re-writes produce identical rows.
- `--mode hourly`: `processed_files` row already exists → Ingester logs "already processed, skipping" and exits.
- `--mode backfill`: the Ingester walks dates from the `--range` start. On startup, the Backfill Orchestrator has already adjusted `--range` to begin at the first non-completed date from `backfill_progress`, so the Ingester re-processes at most one in-progress date's files from scratch. Crash recovery cost: ~30 min to 2 hours of re-reads per crash; the writes are idempotent.

### 5.7 SSD scratch optimization (backfill only)

Reading large `.json.gz` files from a 7200 RPM HDD is ~100–150 MB/s sustained. The SATA SSD is ~5× faster.

For backfill, copy the next file from HDD to a scratch directory on the SSD before processing, then delete after. One file at a time, ~2 GB max, no disk pressure on the SSD. This roughly halves backfill wall-clock time.

For hourly, the file is one per hour and small enough that copying is negligible — but unnecessary. Process directly from HDD.

---

## 6. Cron coordination

### 6.1 The two jobs

```cron
# /etc/cron.d/jobflow

# Backfill: every night at midnight, holds a lock until done
0 0 * * * tomer flock -n /var/lock/jobflow-backfill.lock /home/tomer/jobflow/run-backfill.sh

# Hourly ingest: every hour at :15, skips if backfill is running
15 * * * * tomer flock -n /var/lock/jobflow-hourly.lock -c '\
  flock -n /var/lock/jobflow-backfill.lock true && \
  /home/tomer/jobflow/run-hourly.sh || \
  echo "skipping: backfill in progress" >> /home/tomer/jobflow/logs/hourly-skips.log'
```

### 6.2 Lock semantics

- `jobflow-backfill.lock`: held for the entire backfill run (hours).
- `jobflow-hourly.lock`: held only during a single hourly run (~minutes).
- Hourly checks for backfill's lock with `flock -n /var/lock/jobflow-backfill.lock true` — this acquires and immediately releases. If it succeeds, no backfill is running and hourly proceeds. If it fails, hourly logs the skip and exits.

### 6.3 Why "skip on conflict" not "wait"

If backfill takes 10 hours, "wait" creates 10 stacked-up hourly jobs. "Skip" lets the next scheduled hour try fresh. The hourly catchup logic (process all unprocessed files in `processed_files`) handles the accumulated gap naturally — when the next hourly job finally runs after backfill completes, it sees 10 unprocessed files and works through them all.

### 6.4 What `run-backfill.sh` does

```bash
#!/bin/bash
set -e
cd /home/tomer/jobflow

# 1. Check if there are uninitialized companies. If not, exit cleanly.
node scripts/check-pending-backfill.js || exit 0

# 2. Run backfill (fetcher + ingester)
node fetcher.js --range 2025-05-22 $(date -d 'yesterday' +%Y-%m-%d)
node ingester.js --range 2025-05-22 $(date -d 'yesterday' +%Y-%m-%d) --mode backfill

# 3. Mark companies as initialized (handled inside ingester on success)
```

The fetcher call is mostly a no-op after the first backfill — files already on disk are skipped.

### 6.5 What `run-hourly.sh` does

```bash
#!/bin/bash
set -e
cd /home/tomer/jobflow

node fetcher.js --catchup
node ingester.js --catchup --mode hourly
```

---

## 7. Failure modes and recovery

| Failure | Detection | Recovery |
|---|---|---|
| Fetcher crashes mid-download | `.partial` files left on disk | Next run cleans `.partial` files older than 1h, retries |
| Network blip during fetch | HTTP error caught | Exponential backoff, max 3 retries, log and skip if exhausted |
| Ingester crashes mid-file | File not in `processed_files` | Next run reprocesses the file from scratch (idempotent) |
| Backfill crashes mid-date | Date row in `backfill_progress` is `in_progress`, not `completed` | Next backfill resumes from the earliest non-completed date |
| Backfill crashes mid-run | Run still has uncompleted dates | Same `run_id` resumes (matched by company set) |
| Cassandra unreachable | Driver throws on write | Ingester crashes loudly; cron retries on next schedule |
| HDD full | Write fails | Fetcher crashes; manual cleanup needed; **add a `df` check at start of run** |
| GH Archive 404 on a real hour | Missing file persists | Log, skip, move on; gap in coverage accepted |
| Lock file left after kill -9 | `flock` handles automatically | No action needed |

### 7.1 Disk space safety check

Add to both `run-hourly.sh` and `run-backfill.sh`:

```bash
AVAILABLE_GB=$(df --output=avail -BG /mnt/hdd | tail -1 | tr -dc '0-9')
if [ "$AVAILABLE_GB" -lt 50 ]; then
  echo "FATAL: less than 50 GB free on /mnt/hdd" >&2
  exit 1
fi
```

50 GB buffer protects against runaway downloads on a future bad day.

---

## 8. Performance targets

**Hourly ingest:**
- One file (~1 GB compressed, ~3M events) processed in **3–8 minutes**.
- Headroom: hourly cron triggers every 60 minutes; even with a slow run, no risk of overlap.

**Backfill:**
- One year of files (~470 GB, ~365 days, ~26M tracked-company events) processed in **6–10 hours**.
- Bottleneck: HDD read throughput, mitigated by SSD scratch.
- Fits comfortably in an overnight window.

**Steady state with no new companies:**
- Backfill cron exits immediately (no uninitialized companies).
- Only hourly runs.

---

## 9. Project structure update

```
jobflow/data-pipeline/
├── docker-compose.yml
├── schema/
│   ├── 001_keyspace.cql
│   ├── 002_companies.cql
│   ├── 003_company_events.cql
│   ├── 004_processed_files.cql
│   └── 005_backfill_progress.cql       # NEW
├── fetcher/
│   ├── package.json
│   ├── fetcher.js                       # main entry
│   └── lib/
│       ├── download.js
│       └── disk-layout.js
├── ingester/
│   ├── package.json
│   ├── ingester.js                      # main entry, main thread
│   ├── worker.js                        # worker thread code
│   └── lib/
│       ├── fast-filter.js
│       ├── tag-extractor.js
│       ├── ai-detector.js
│       └── cassandra-writer.js
├── scripts/
│   ├── run-hourly.sh
│   ├── run-backfill.sh
│   ├── check-pending-backfill.js
│   └── seed-companies-from-jobflow.js
├── cron/
│   └── jobflow.cron                     # to be placed in /etc/cron.d/
└── logs/
    ├── fetcher.log
    ├── ingester.log
    └── hourly-skips.log
```

---

## 10. Implementation order

Build in this order. Each step is verifiable in isolation before moving on.

**Step 1 — Schema additions**
Apply `005_backfill_progress.cql` and the two `ALTER`s on `companies`. Verify with `DESCRIBE TABLE`.

**Step 2 — Fetcher, single-file mode**
Build `fetcher.js --hour`. Test: download one file, verify it's at the right path, verify atomic rename works (kill mid-download, confirm no `.json.gz` artifact).

**Step 3 — Fetcher, range and catchup**
Add `--range` and `--catchup` modes. Test: backfill a week of files, verify idempotency (re-running is a no-op).

**Step 4 — Ingester, single-file, no workers, no fast filter**
Naive version first. Reads one file, filters in main thread, writes to Cassandra. Validates the schema and write path work end-to-end. Don't optimize yet.

**Step 5 — Add fast filter**
Measure: time to process one file before/after. Expect ~50× speedup.

**Step 6 — Add worker threads**
Measure again. Expect another 2–3× on top of step 5.

**Step 7 — Add batched writes for backfill mode**
Measure backfill throughput on a single day. Should be processing one day in 1–2 minutes.

**Step 8 — Backfill progress tracking**
Wire `backfill_progress` table. Test: kill mid-backfill, restart, verify resume from correct date.

**Step 9 — Cron + lock coordination**
Deploy cron files. Test: manually start a long backfill, trigger hourly via cron, verify hourly skips correctly.

**Step 10 — End-to-end dry run**
Add 3 test companies as `initialized = false`. Let backfill run overnight. Next morning: verify rows in `company_events`, verify all 3 companies are now `initialized = true`, verify counts look sane.

---

## 11. Open questions deferred to later

These are explicitly NOT solved in v1, by design:

- **Retention policy**: files kept forever for now. Revisit if HDD fills.
- **Secondary enrichment via GitHub REST API**: still in main RFC §6, not part of the ingestion pipeline. Runs as a separate post-process.
- **Streaming-style ingestion (sub-hourly)**: hourly is the goal. If GH Archive ever offers a websocket or push API, reconsider.
- **Multi-machine scaling**: single box only.
- **Monitoring dashboards**: Reaper for Cassandra is enough for v1. Add Prometheus/Grafana when there's a reason.

---

## 12. Definition of done

The ingestion pipeline is "done" when all of these are true:

1. `fetcher.js --catchup` correctly downloads new files from GH Archive to the HDD.
2. `ingester.js --catchup --mode hourly` processes new files into Cassandra, marking them in `processed_files`.
3. `run-backfill.sh` correctly identifies uninitialized companies, processes the local archive, marks them `initialized = true`.
4. Both cron jobs are deployed and the lock coordination works as designed (verified by manual conflict test).
5. Resumability is verified: kill backfill mid-run, restart, confirm it resumes from the correct date.
6. End-to-end test against 3 test companies passes (step 10 above).
7. Performance targets met: hourly < 10 min, backfill < 12 hours for 1 year of data.

End of plan.