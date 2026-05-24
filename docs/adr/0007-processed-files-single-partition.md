# ADR 0007 — `processed_files` restructured to single-partition for O(1) catchup max lookup

**Status:** Accepted  
**Date:** 2026-05-24

## Context

On 2026-05-23, `ingester --catchup` crashed in production with:

```
NoHostAvailableError → BusyConnectionError: 2048 requests in-flight on a single connection
```

The crash was caused by `ingester.js` firing `Promise.all` of `writer.isFileProcessed(id)` over every on-disk hour ID (3,426 at the time), exceeding the cassandra-driver default `pooling.maxRequestsPerConnection = 2048`. The bug was latent — it worked through the January backfill (which used `--range`) and a smaller smoke test, but manifested once the on-disk archive grew past 2,048 files.

The root insight: because the hourly ingester processes files strictly in chronological order and stops on first failure, `processed_files` is always a contiguous prefix `{H₀ … H_max}`. Catchup only needs `MAX(file_name)`, not per-file set membership.

## Decision

Restructure `processed_files` with a `(bucket, file_name)` composite primary key and `CLUSTERING ORDER BY (file_name DESC)`. All rows use `bucket = 'singleton'`.

```cql
CREATE TABLE processed_files (
    bucket       text,
    file_name    text,
    processed_at timestamp,
    PRIMARY KEY (bucket, file_name)
) WITH CLUSTERING ORDER BY (file_name DESC);
```

Catchup query becomes a single round-trip:

```cql
SELECT file_name FROM processed_files WHERE bucket='singleton' LIMIT 1;
```

Catchup logic becomes: `pending = ondisk.filter(id > max)` (lexicographic, works because `file_name` format is `YYYY-MM-DD-HH`).

The `event_count` and `filtered_count` columns from the original schema are dropped — they were never read back, only written for ad-hoc observability.

## Consequences

**Positive:**
- Catchup startup is now O(1) regardless of on-disk archive size.
- `BusyConnectionError` cannot recur from this code path.
- Schema is simpler (two PK columns, one data column).

**Negative / trade-offs:**
- **Hot partition anti-pattern:** all rows land in the single `bucket='singleton'` partition. On a single-node Cassandra deployment this is acceptable — there is no intra-cluster imbalance. If the deployment ever becomes multi-node, this partition will become a hotspot and would need repartitioning (e.g. `bucket = YYYY` to spread across 12+ partitions per year).
- **Schema migration is destructive:** changing the primary key requires `DROP TABLE + CREATE TABLE`. Safe here because `processed_files` was empty in production at migration time.
- **Contiguity assumption:** `getMaxProcessedFile()` + `id > max` filtering is only correct if `processed_files` is a contiguous prefix. This invariant is maintained by the hourly ingester's sequential, break-on-first-failure processing. If a future change introduces non-sequential processing, this approach would need revisiting.

## Alternatives considered

1. **Raise `maxRequestsPerConnection`** — symptom fix; doesn't scale past the next doubling of the archive.
2. **Serialize the per-file checks** — fixes the concurrency issue but adds O(N) sequential round-trips to catchup startup.
3. **Truncate `processed_files` between catchup runs** — would break the hourly idempotency invariant (hourly mode relies on the table persisting across invocations).
4. **`bucket = YYYY` partitioning** — correct for multi-node but unnecessary complexity for the current single-node deployment.

## Related

- ADR 0005 — `processed_files` is hourly-only (its "No schema change" claim is superseded by this ADR)
- ADR 0003 — Backfill/Hourly relay-race (the `initialized` flag that keeps backfill out of `processed_files`)
- Issue #238
