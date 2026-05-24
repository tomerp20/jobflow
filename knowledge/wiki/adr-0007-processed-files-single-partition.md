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

`processed_files` was restructured from `(file_name) PRIMARY KEY` to `(bucket, file_name) PRIMARY KEY` with `CLUSTERING ORDER BY (file_name DESC)`. All rows use `bucket = 'singleton'`. Catchup now reads `MAX(file_name)` in one query and filters on-disk IDs by `id > max`, eliminating the N-concurrent-SELECT pattern that crashed production (3,426 in-flight requests exceeded the cassandra-driver's 2,048 limit).

## The crash this fixes

`ingester --catchup` fires `Promise.all(allOnDisk.map(id => writer.isFileProcessed(id)))` → 3,426 concurrent Cassandra SELECTs → `BusyConnectionError`. Scale-only bug (worked at smaller archive sizes).

## Why single-partition is safe here

The hourly ingester processes files strictly in chronological order and breaks on first failure. Therefore `processed_files` is always a contiguous prefix `{H₀ … H_max}`. Catchup only needs the max — not per-file membership. `id > max` filtering (lexicographic on `YYYY-MM-DD-HH`) is equivalent to "not yet processed."

## Hot-partition trade-off

All rows land in `bucket='singleton'`. On the current single-node Cassandra deployment this causes no imbalance. **If the deployment becomes multi-node**, this partition will be a hotspot and needs repartitioning (e.g. `bucket = YYYY`). This is a known future migration path, accepted per current topology.

## What changed in code

- `CassandraWriter.isFileProcessed()` → removed; replaced by `getMaxProcessedFile()` (one SELECT, returns `string | null`)
- `CassandraWriter.markFileProcessed(fileName)` → writes with `bucket='singleton'`; `event_count`/`filtered_count` columns dropped
- `ingester.js --catchup`: replaces `Promise.all` with single `getMaxProcessedFile()` + `allOnDisk.filter(id => id > max)`
- Schema migration: `data-pipeline/schema/009_processed_files_single_partition.cql`

## Supersedes

[[adr-0005-processed-files-hourly-only]] — its "No schema change" claim is no longer accurate. ADR 0005's core decision (backfill does not use `processed_files`) is unchanged.
