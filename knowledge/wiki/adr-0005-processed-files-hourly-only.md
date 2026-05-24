---
title: ADR 0005 — `processed_files` is hourly-only
slug: adr-0005-processed-files-hourly-only
type: decision
tags: [cassandra, pipeline, ingestion, idempotency]
sources:
  - docs/adr/0005-processed-files-hourly-only.md
related: [[cassandra-analytics-pipeline]] [[backfill]] [[hourly-ingest]] [[backfill-run]] [[ingestion-pipeline]] [[adr-0003-backfill-hourly-relay-race]] [[adr-0007-processed-files-single-partition]]
updated: 2026-05-24
status: stable
adr_status: proposed
---

# ADR 0005 — `processed_files` is hourly-only; Backfill uses `backfill_progress`

> Canonical text: `docs/adr/0005-processed-files-hourly-only.md`.

> ⚠️ **Schema note (2026-05-24):** The "No schema change" claim below is superseded. [[adr-0007-processed-files-single-partition]] restructured `processed_files` to `(bucket, file_name)` PK with `CLUSTERING ORDER BY (file_name DESC)` to fix an O(N) concurrent-SELECT crash in `--catchup`. ADR 0005's core decision — backfill does not use `processed_files` — is unchanged.

## TL;DR

`processed_files` is **only** read/written when the Ingester runs in `--mode hourly`. In `--mode backfill` the table is untouched. Backfill crash recovery is per-date via `backfill_progress` instead.

## The bug this prevents

`processed_files` keys on **file name alone**, with no notion of "done for which target set." That caused this loss scenario:

1. Backfill Run starts at midnight targeting Company X.
2. Company Scout adds Company Y at 02:30 (`initialized = false`).
3. Backfill keeps adding rows to `processed_files` ("file done") — but only Company X's events were written.
4. Next night's Backfill targets Company Y, but every file looks "done" already → **Company Y's historical events are never written**.

## Why this approach over alternatives

- **Per-(file, target-set) keying** — correct but expensive (24 × dates × runs rows + hash comparisons).
- **Truncate `processed_files` between runs** — breaks the hourly mode, which relies on the table across invocations.
- **Stop using it for Backfill entirely** ← chosen. Backfill resumes at the *date* granularity from `backfill_progress`.

## Knock-on effects

- Each Backfill Run re-reads the full local archive for its `target_companies`. Wasted CPU + disk for already-initialised Companies, but their `company_events` writes are upserts → no duplicates. ~470 GB compressed per year; acceptable cost.
- Backfill crash recovery has coarser granularity: a mid-date crash re-reads 24 hourly files on resume. Worst case ~30 min – 2 hrs of wasted work per crash.
- Ingester behaviour now branches on `--mode` for `processed_files` reads/writes. Documented in [[ingestion-pipeline|InjestionPlan §5.6]].

## See also
- [[adr-0003-backfill-hourly-relay-race]] — the `initialized` flag that ADR 0005 leans on
- [[backfill-run]] — the unit of work that records into `backfill_progress`
