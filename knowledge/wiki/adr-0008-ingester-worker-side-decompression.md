---
title: ADR 0008 — Ingester worker-side decompression
slug: adr-0008-ingester-worker-side-decompression
type: decision
tags: [pipeline, ingestion, performance, workers, gzip]
sources:
  - docs/adr/0008-ingester-worker-side-decompression.md
related: [[ingestion-pipeline]] [[cassandra-analytics-pipeline]] [[adr-0004-microservices-shaped-cli-contract]] [[adr-0005-processed-files-hourly-only]] [[adr-0007-processed-files-single-partition]]
updated: 2026-05-24
status: stable
adr_status: accepted
---

# ADR 0008 — Ingester workers own decompression and line iteration

> Canonical text: `docs/adr/0008-ingester-worker-side-decompression.md`.

## TL;DR

Move `createReadStream → createGunzip → createInterface` into each worker. Main thread becomes a thin coordinator: queues files chronologically, dispatches one file per idle worker, writes events to Cassandra, and writes `processed_files`/`backfill_progress` in chronological order. Persistent worker pool for the whole run (no more per-hour spawn/terminate). Defaults bumped: `INGEST_WORKERS = min(8, cores-2)`, `UV_THREADPOOL_SIZE=16`.

## The bottleneck this fixes

Live diagnostic (2026-05-24 catchup): main thread pinned at ~60% on one core (readline `'line'` loop + `postMessage` dispatch), 4 workers at 0–10%, libuv at 10–20%, Cassandra MutationStage 99.4% idle, system 82–85% idle. All decompressed bytes funneled through one event loop before reaching workers. Workers finished CPU-light extraction faster than the main thread could feed them.

Feb 1-5 backfill: **155.83s wall clock** for 13,604 events. Target post-fix: ≤ 75s (≥ 2× improvement).

## Why writes stay on main

Cassandra is 99.4% idle. One `Client`, one batch coordinator, no per-worker driver pool, no race on per-partition buffers, one place to enforce `processed_files` write order. Driver-side parallelism is a separate, defensive cleanup PR if metrics ever justify it.

## Why not pre-decompress to disk

- 8,811 × ~1 GB decompressed ≈ 8.8 TB on a 2 TB HDD — blocker.
- HDD reads ~10s for 1 GB plain vs ~1s for 100 MB compressed + in-memory gunzip → 10× IO regression on spinning rust.
- libuv (where gunzip runs) was 10–20%, not the choke. Pre-decompressing doesn't unblock the readline loop.

## What changed in code

- `data-pipeline/ingester/worker.js` — worker opens its own file stream, decompresses, iterates lines, filters/parses/extracts; posts `{type:'events', hourId, results}` batches and `{type:'fileDone', hourId, totalEmitted, droppedNoTimestamp, droppedNoId}` on completion.
- `data-pipeline/ingester/ingester.js` — persistent worker pool spawned at startup, terminated at shutdown. New `processHourBatch` coordinator: pending-hours queue, ready-workers queue, per-hour in-flight tracking, chronological finalize loop.
- `data-pipeline/scripts/run-backfill.sh`, `data-pipeline/scripts/run-hourly.sh` — `export UV_THREADPOOL_SIZE=16` (operator override still wins).

## Trade-offs

- **Cross-hour event interleaving in backfill mode** — per-partition buffers in `cassandra-writer.js` contain events from multiple hours concurrently. Correctness preserved via `flushAllPartitionBuffers` at date boundary before `backfill_progress` write.
- **Per-worker RAM peak ~200 MB** during streaming. 8 × 200 MB ≈ 1.6 GB peak on 16 GB host — fine, but worth noting for future scale.
- **One date at a time in `--mode backfill --verb range`.** Within a date, hours dispatch concurrently. Across dates, serial — preserves the existing first-failure-stops semantics from [[adr-0005-processed-files-hourly-only]].

## Related

- [[ingestion-pipeline]] — system page (updated to describe the new shape)
- [[adr-0007-processed-files-single-partition]] — preceded this work; the contiguous-prefix invariant continues to hold because chronological finalize is preserved
