---
title: ADR 0007 — processed_files single-partition for O(1) catchup
slug: adr-0007-processed-files-single-partition
type: decision
tags: [cassandra, pipeline, ingestion, idempotency, performance]
sources:
  - docs/adr/0007-processed-files-single-partition.md
related: [[adr-0005-processed-files-hourly-only]] [[adr-0003-backfill-hourly-relay-race]] [[ingestion-pipeline]] [[cassandra-analytics-pipeline]]
updated: 2026-05-24
status: stable
adr_status: accepted
---

# ADR 0007 — `processed_files` restructured to single-partition for O(1) catchup max lookup

> Canonical text: `docs/adr/0007-processed-files-single-partition.md`.

## TL;DR

`processed_files` was restructured to `(bucket, hour_time timestamp)` PK with `CLUSTERING ORDER BY (hour_time DESC)`. All rows use `bucket = 'singleton'`; `file_name` is stored as a regular column. Catchup is now a true O(1) `LIMIT 1` key lookup — Cassandra timestamps sort chronologically so no JS max scan is needed. This eliminates the N-concurrent-SELECT pattern that crashed production (3,426 in-flight requests exceeded the cassandra-driver's 2,048 limit).

## The crash this fixes

`ingester --catchup` fires `Promise.all(allOnDisk.map(id => writer.isFileProcessed(id)))` → 3,426 concurrent Cassandra SELECTs → `BusyConnectionError`. Scale-only bug (worked at smaller archive sizes).

## Why timestamp clustering, not string clustering

The canonical hour ID format is `YYYY-MM-DD-H` (hour unpadded, 0–23). Clustering on `file_name text DESC` and using `LIMIT 1` would fail because `'…-9' > '…-10'` as strings — once hour 9 of any day is processed, hours 10–23 of every later day would be silently skipped. A `timestamp` clustering column sorts chronologically by definition; `LIMIT 1` is always correct. `markFileProcessed` converts `file_name → hour_time` via `hourIdToMs()` on write.

## Hot-partition trade-off

All rows land in `bucket='singleton'`. On the current single-node Cassandra deployment this causes no imbalance. **If the deployment becomes multi-node**, this partition will be a hotspot and needs repartitioning (e.g. `bucket = YYYY`). This is a known future migration path, accepted per current topology.

## What changed in code

- `CassandraWriter.isFileProcessed()` → removed; replaced by `getMaxProcessedFile()` (one `LIMIT 1` query, returns `string | null`)
- `CassandraWriter.markFileProcessed(fileName)` → computes `hour_time = new Date(hourIdToMs(fileName))` and writes `(bucket, hour_time, file_name, processed_at)`; `event_count`/`filtered_count` columns dropped
- `ingester.js --catchup`: single `getMaxProcessedFile()` call then `allOnDisk.filter(id => hourIdToMs(id) > hourIdToMs(max))`
- Schema migration: `data-pipeline/schema/009_processed_files_single_partition.cql`

## Supersedes

[[adr-0005-processed-files-hourly-only]] — its "No schema change" claim is no longer accurate. ADR 0005's core decision (backfill does not use `processed_files`) is unchanged.
