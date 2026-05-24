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

`processed_files` was restructured from `(file_name) PRIMARY KEY` to `(bucket, file_name) PRIMARY KEY`. All rows use `bucket = 'singleton'`. Catchup now scans the singleton partition in one paged round-trip and computes the chronological max in JS via `hourIdToMs()`, then filters on-disk IDs by `hourIdToMs(id) > hourIdToMs(max)`. This eliminates the N-concurrent-SELECT pattern that crashed production (3,426 in-flight requests exceeded the cassandra-driver's 2,048 limit).

## The crash this fixes

`ingester --catchup` fires `Promise.all(allOnDisk.map(id => writer.isFileProcessed(id)))` → 3,426 concurrent Cassandra SELECTs → `BusyConnectionError`. Scale-only bug (worked at smaller archive sizes).

## Why single-partition is safe here

The hourly ingester processes files strictly in chronological order and breaks on first failure. Therefore `processed_files` is always a contiguous prefix `{H₀ … H_max}`. Catchup only needs the max — not per-file membership. `hourIdToMs(id) > hourIdToMs(max)` filtering (chronological, not lexicographic — the canonical hour ID is `YYYY-MM-DD-H` with the hour unpadded, so string compare is wrong) is equivalent to "not yet processed."

## Hot-partition trade-off

All rows land in `bucket='singleton'`. On the current single-node Cassandra deployment this causes no imbalance. **If the deployment becomes multi-node**, this partition will be a hotspot and needs repartitioning (e.g. `bucket = YYYY`). This is a known future migration path, accepted per current topology.

## What changed in code

- `CassandraWriter.isFileProcessed()` → removed; replaced by `getMaxProcessedFile()` (single SELECT scans singleton partition, returns `string | null` — chronological max computed in JS)
- `CassandraWriter.markFileProcessed(fileName)` → writes with `bucket='singleton'`; `event_count`/`filtered_count` columns dropped
- `ingester.js --catchup`: replaces `Promise.all` with single `getMaxProcessedFile()` + `allOnDisk.filter(id => hourIdToMs(id) > hourIdToMs(max))`
- Schema migration: `data-pipeline/schema/009_processed_files_single_partition.cql`

## Supersedes

[[adr-0005-processed-files-hourly-only]] — its "No schema change" claim is no longer accurate. ADR 0005's core decision (backfill does not use `processed_files`) is unchanged.
