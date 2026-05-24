---
title: Ingestion Pipeline (Fetcher → Ingester → Cassandra)
slug: ingestion-pipeline
type: system
tags: [pipeline, ingestion, gh-archive, cassandra]
sources:
  - docs/InjestionPlan.md
  - docs/CassandraPlan.md
  - data-pipeline/fetcher/
  - data-pipeline/ingester/
  - data-pipeline/orchestrators/
related: [[cassandra-analytics-pipeline]] [[backfill]] [[hourly-ingest]] [[gh-archive]] [[tracked-event]] [[adr-0003-backfill-hourly-relay-race]] [[adr-0004-microservices-shaped-cli-contract]] [[adr-0005-processed-files-hourly-only]] [[adr-0007-processed-files-single-partition]] [[adr-0008-ingester-worker-side-decompression]] [[infra-linux-deployment]]
updated: 2026-05-24
status: stable
---

# Ingestion Pipeline

The data-acquisition + ingestion subsystem of the [[cassandra-analytics-pipeline]]. Canonical design: `docs/InjestionPlan.md`. System context: `docs/CassandraPlan.md` (v2 — supersedes `/CassandraPlan.md` at repo root).

## Pieces

- **Fetcher** — Node.js. Downloads GH Archive `.json.gz` files, atomic-writes to `GHARCHIVE_DIR` on the HDD (`/mnt/hdd/gharchive/YYYY/MM/DD/HH.json.gz`).
- **Ingester** — Node.js. Persistent worker pool (one per `INGEST_WORKERS`, default `min(8, cores-2)`) — each worker opens its own `createReadStream → createGunzip → createInterface` for the dispatched file, applies the `target_companies` substring filter, parses JSON, extracts tags + AI flag, and posts extracted events back to the main thread in 500-event batches. Main thread is a thin coordinator: queues files chronologically, dispatches one file per idle worker, writes events to Cassandra, and writes `processed_files` (hourly) / `backfill_progress` (backfill) in chronological order. Branches on `--mode hourly | backfill` (see [[adr-0004-microservices-shaped-cli-contract]] and [[adr-0008-ingester-worker-side-decompression]]).
- **Orchestrators** — `data-pipeline/orchestrators/hourly.js` and `data-pipeline/orchestrators/backfill.js`. Spawn the Ingester with the appropriate `--mode` and per-job args.

## Operational constraints

- Hourly job and Backfill must **never** run simultaneously — enforced by a `flock`-based cron lock + the per-row `initialized` filter (see [[adr-0003-backfill-hourly-relay-race]]).
- ~1-hour ingest latency target relative to GH Archive publish time.
- ~470 GB/year compressed archive, kept indefinitely on the 2 TB HDD.

## Where idempotency lives

- **Hourly** uses `processed_files` (single-partition shape: `(bucket='singleton', hour_time timestamp)` PK, `CLUSTERING ORDER BY (hour_time DESC)`, `file_name` as regular column; `LIMIT 1` is a true O(1) key lookup because timestamps sort chronologically) → see [[adr-0007-processed-files-single-partition]] (supersedes schema section of [[adr-0005-processed-files-hourly-only]]).
- **Backfill** uses `backfill_progress` (per-date) → re-reads 24 files per resumed date.
- Both rely on Cassandra full-key upserts on `company_events` → no duplicate rows even on overlapping writes.

## Catchup path (`--verb catchup`)

The `--verb catchup` ingester verb is used by the hourly orchestrator after a gap (e.g. the service was down). It must resume without re-processing already-done hours.

**Old design (crashed production):** `Promise.all(allOnDisk.map(id => isFileProcessed(id)))` — N concurrent SELECTs. Crashed at 3,426 files (`BusyConnectionError: 2048 requests in-flight`).

**New design (O(1)):**
1. `getMaxProcessedFile()` → `SELECT file_name FROM processed_files WHERE bucket='singleton' LIMIT 1` — single key lookup on the `hour_time DESC` clustering column. Returns `null` if empty.
2. Filter: `pending = allOnDisk.filter(id => hourIdToMs(id) > hourIdToMs(max))` — chronological compare via `hourIdToMs()`. The canonical `file_name` format is `YYYY-MM-DD-H` (hour unpadded, 0–23), so a plain string compare would silently skip hours 10–23 of each day once hour 9 is processed.
3. The pre-filter means `processHour()` skips the per-file idempotency check for catchup (`cmd.verb !== 'catchup'` guard).

## Argument hygiene

Every per-job parameter is a CLI arg (URL-encoded for tokens with special chars — see `fix/hourly-target-companies-url-encoding`). Every service-level setting (Cassandra contact points, archive root, log level) is an env var. See [[adr-0004-microservices-shaped-cli-contract]].

## Worker architecture (post-#240)

- **Persistent pool, file-path queue.** Workers spawn once at ingester startup and terminate at shutdown — the previous per-hour `spawn → terminate` pattern is gone.
- **Worker owns decompression.** Each worker streams its own file from `GHARCHIVE_DIR`. Main thread no longer touches `createReadStream`/`createGunzip`/`createInterface`.
- **Chronological finalize.** Workers may complete files out of wall-clock order; main buffers `fileDone` events and writes `processed_files` / `backfill_progress` strictly in input order so the contiguous-prefix invariant from [[adr-0005-processed-files-hourly-only]] holds.
- **Backpressure.** Main holds off dispatching the next file when events-in-flight to Cassandra exceeds 10K. Mid-file workers keep producing; Cassandra is 99.4% idle today so the watermark rarely fires.
- **Failure semantics.** First worker error or Cassandra write error stops dispatch. Remaining in-flight writes are awaited so the pool terminates cleanly with `exitCode=1`.

## Surprises / gotchas

- `--target-companies` tokens must be URL-encoded by the orchestrator before being passed to the Ingester. Recent fixes (`727c6c9`, `ab64e1c`, `1fe9bb9`) hardened the operator-diagnostic path for `decodeURIComponent` failures.
- The repo root has a `CassandraPlan.md` that is **older** than `docs/CassandraPlan.md`. The `docs/` copy is v2 and the canonical one.
- "Catchup" is the **hourly fetcher's** mode (resumption after a gap). Don't confuse with [[backfill]] which is the nightly all-rows sweep.
- In backfill mode, per-partition batch buffers in `cassandra-writer.js` now contain events from multiple hours concurrently. Correctness is preserved (Cassandra dedups via the full primary key + `flushAllPartitionBuffers` runs at date boundary before `backfill_progress` is written), but reasoning about the buffer content requires this awareness.
- `UV_THREADPOOL_SIZE=16` is set by `run-{backfill,hourly}.sh` to give libuv headroom for 8 workers × 1 concurrent gunzip each. Operator overrides via the cron line still win.

## Source pointers

- Plan: `docs/InjestionPlan.md`
- System design: `docs/CassandraPlan.md` (§5–§6 of the main RFC superseded by `InjestionPlan.md`)
- Code: `data-pipeline/fetcher/`, `data-pipeline/ingester/`, `data-pipeline/orchestrators/{hourly,backfill}.js`
- Schema migrations: `data-pipeline/schema/` (`processed_files`, `backfill_progress`, `backfill_runs`, `companies`)
- Runtime host: see [[infra-linux-deployment]]
