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
related: [[cassandra-analytics-pipeline]] [[backfill]] [[hourly-ingest]] [[gh-archive]] [[tracked-event]] [[adr-0003-backfill-hourly-relay-race]] [[adr-0004-microservices-shaped-cli-contract]] [[adr-0005-processed-files-hourly-only]] [[adr-0007-processed-files-single-partition]] [[infra-linux-deployment]]
updated: 2026-05-24
status: stable
---

# Ingestion Pipeline

The data-acquisition + ingestion subsystem of the [[cassandra-analytics-pipeline]]. Canonical design: `docs/InjestionPlan.md`. System context: `docs/CassandraPlan.md` (v2 — supersedes `/CassandraPlan.md` at repo root).

## Pieces

- **Fetcher** — Node.js. Downloads GH Archive `.json.gz` files, atomic-writes to `GHARCHIVE_DIR` on the HDD (`/mnt/hdd/gharchive/YYYY/MM/DD/HH.json.gz`).
- **Ingester** — Node.js. Main thread reads a file; worker pool parses + filters by `target_companies`; main thread writes to Cassandra. Branches on `--mode hourly | backfill` (see [[adr-0004-microservices-shaped-cli-contract]]).
- **Orchestrators** — `data-pipeline/orchestrators/hourly.js` and `data-pipeline/orchestrators/backfill.js`. Spawn the Ingester with the appropriate `--mode` and per-job args.

## Operational constraints

- Hourly job and Backfill must **never** run simultaneously — enforced by a `flock`-based cron lock + the per-row `initialized` filter (see [[adr-0003-backfill-hourly-relay-race]]).
- ~1-hour ingest latency target relative to GH Archive publish time.
- ~470 GB/year compressed archive, kept indefinitely on the 2 TB HDD.

## Where idempotency lives

- **Hourly** uses `processed_files` (single-partition shape: `(bucket='singleton', file_name)` PK; chronological max computed in JS via `hourIdToMs` because `file_name`'s hour component is unpadded — see below) → see [[adr-0007-processed-files-single-partition]] (supersedes schema section of [[adr-0005-processed-files-hourly-only]]).
- **Backfill** uses `backfill_progress` (per-date) → re-reads 24 files per resumed date.
- Both rely on Cassandra full-key upserts on `company_events` → no duplicate rows even on overlapping writes.

## Catchup path (`--verb catchup`)

The `--verb catchup` ingester verb is used by the hourly orchestrator after a gap (e.g. the service was down). It must resume without re-processing already-done hours.

**Old design (crashed production):** `Promise.all(allOnDisk.map(id => isFileProcessed(id)))` — N concurrent SELECTs. Crashed at 3,426 files (`BusyConnectionError: 2048 requests in-flight`).

**New design (one round-trip):**
1. `getMaxProcessedFile()` → `SELECT file_name FROM processed_files WHERE bucket='singleton'` — single paged scan of the singleton partition; chronological max computed in JS via `hourIdToMs()`. Returns `null` if empty.
2. Filter: `pending = allOnDisk.filter(id => hourIdToMs(id) > hourIdToMs(max))` — must be chronological compare, not lexicographic. The canonical `file_name` format is `YYYY-MM-DD-H` (hour unpadded, 0–23), so string compare would silently skip hours 10–23 of each day once hour 9 is processed.
3. The pre-filter means `processHour()` skips the per-file idempotency check for catchup (`cmd.verb !== 'catchup'` guard).

## Argument hygiene

Every per-job parameter is a CLI arg (URL-encoded for tokens with special chars — see `fix/hourly-target-companies-url-encoding`). Every service-level setting (Cassandra contact points, archive root, log level) is an env var. See [[adr-0004-microservices-shaped-cli-contract]].

## Surprises / gotchas

- `--target-companies` tokens must be URL-encoded by the orchestrator before being passed to the Ingester. Recent fixes (`727c6c9`, `ab64e1c`, `1fe9bb9`) hardened the operator-diagnostic path for `decodeURIComponent` failures.
- The repo root has a `CassandraPlan.md` that is **older** than `docs/CassandraPlan.md`. The `docs/` copy is v2 and the canonical one.
- "Catchup" is the **hourly fetcher's** mode (resumption after a gap). Don't confuse with [[backfill]] which is the nightly all-rows sweep.

## Source pointers

- Plan: `docs/InjestionPlan.md`
- System design: `docs/CassandraPlan.md` (§5–§6 of the main RFC superseded by `InjestionPlan.md`)
- Code: `data-pipeline/fetcher/`, `data-pipeline/ingester/`, `data-pipeline/orchestrators/{hourly,backfill}.js`
- Schema migrations: `data-pipeline/schema/` (`processed_files`, `backfill_progress`, `backfill_runs`, `companies`)
- Runtime host: see [[infra-linux-deployment]]
