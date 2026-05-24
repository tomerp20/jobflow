# ADR 0008 — Ingester workers own decompression and line iteration

**Status:** Accepted
**Date:** 2026-05-24

## Context

A live diagnostic during the 2026-05-24 catchup run showed the ingester pinned
on the main thread while every other resource sat idle:

| Resource              | Utilization                                        |
|-----------------------|----------------------------------------------------|
| Main JS thread        | ~60% (one hot core — readline `'line'` + postMessage) |
| Each of 4 workers     | 0–10% (starved, mostly waiting for `postMessage`)  |
| libuv threadpool      | 10–20% (gunzip well under capacity)                |
| Cassandra MutationStage | Active=0, Pending=0, 99.4% idle (`nodetool tpstats`) |
| System total          | 82–85% idle (2.7 of 16 cores used)                 |

The Feb 1-5 backfill (5 days, 13,604 events written) took **155.83s wall clock**.
Backlog on `/mnt/hdd/gharchive` was ~8,811 hour files (~1 TB compressed) — at
the observed pace, ~15 hours of runtime.

The previous topology funneled every line through a single main-thread pipeline:

```
createReadStream → createGunzip → createInterface
  → 'line' (main thread)
  → batch of 1000 → postMessage(lines) to next worker
```

Workers did CPU-light work (substring filter → `JSON.parse` →
tag/AI extraction) and finished faster than the main thread could feed them.
libuv (where gunzip runs) was nowhere near saturation, so the bottleneck was
upstream of gunzip: the readline/`postMessage` loop itself.

## Decision

Move decompression and line iteration **into the workers**. The main thread
becomes a thin coordinator that dispatches file paths to workers and writes
extracted events to Cassandra.

| Before                                             | After                                                 |
|----------------------------------------------------|-------------------------------------------------------|
| Main: read → gunzip → readline → postMessage(lines) | Main: `postMessage({filePath, hourId})` to worker     |
| Worker: filter → JSON.parse → extract → postMessage(events) | Worker: read → gunzip → readline → filter → JSON.parse → extract → postMessage(events) |
| Main: Cassandra batch writes                       | Main: Cassandra batch writes *(unchanged)*            |
| Workers spawned per-hour, terminated per-hour      | **Persistent worker pool** for the whole run          |

Concrete contract changes:

- **Worker pool persists across the whole run** — workers spawn once at
  startup, terminate once at shutdown.
- **Main thread queues files chronologically**, dispatches one file per idle
  worker.
- **Per-file completion ack**: workers post `{type:'fileDone', hourId, …}`
  after their final event batch. Main writes the `processed_files` row only
  after all events for that hour have settled in Cassandra **and** all
  chronologically-prior hours have already been marked.
- **Backpressure** preserved: main does not dispatch the next file while
  events-in-flight to Cassandra exceeds the 10K watermark. Workers idle (do
  not advance the queue) until Cassandra drains below the watermark.
- **Failure semantics** preserved: first worker error or Cassandra error
  aborts the run; remaining in-flight writes are awaited before exit so the
  worker pool terminates cleanly.
- **Default worker ceiling** raised from `Math.min(4, cores/2)` to
  `Math.min(8, cores − 2)`. Env override still respected.
- **`UV_THREADPOOL_SIZE=16`** in `run-backfill.sh` and `run-hourly.sh` —
  8 workers × 1 concurrent gunzip each + spare slots for fs IO.

## Why writes stay on the main thread

Cassandra is 99.4% idle — funneling writes through one client is not the
bottleneck. Keeping writes on main preserves:

- One `Client`, one batch coordinator, no per-worker driver pool to size.
- No race on the per-partition batch buffers in `cassandra-writer.js`.
- No per-batch deduplication across workers.
- One place to enforce the `processed_files` write order.

If Cassandra ever becomes the bottleneck (driver-side queue fills up,
MutationStage backs up), that is a separate, defensive PR worth shipping
*after* measuring — it is not coupled to this change.

## Why we did not pre-decompress files to disk

Considered and rejected:

- **Disk-space blocker.** 8,811 files × ~1 GB decompressed ≈ 8.8 TB. The HDD
  is 2 TB.
- **HDD throughput regression.** Reading 1 GB plain (~10s at 100–150 MB/s
  spinning-rust sequential) is roughly **10× slower** than reading ~100 MB
  compressed + in-memory gunzip. On HDD, gzip is effectively a 10× IO speedup.
- **Wrong bottleneck.** libuv (where gunzip runs) was at 10–20%, not pinned.
  Pre-decompressing would not unblock the main-thread readline loop, which is
  the actual choke point.

The fix is to keep streaming compressed reads from disk but parallelize the
streaming across workers.

## Consequences

**Positive:**

- Decompression and line iteration scale linearly with worker count up to
  `cores − 2`.
- Main thread is no longer a serialization point — it now does only event
  buffering and Cassandra dispatch.
- `processed_files` invariants (contiguous prefix in chronological order)
  preserved despite concurrent per-hour processing — finalize runs in input
  order.

**Negative / trade-offs:**

- **Per-worker decompression buffer is in RAM.** Peak ~100–200 MB per worker
  while a file is streaming. 8 workers × 200 MB ≈ 1.6 GB peak. On the 16 GB
  host this is fine, but worth noting for future scale.
- **Cross-hour event interleaving in backfill mode.** Multiple hours
  contribute to the same per-partition batch buffers concurrently. Correctness
  is preserved (Cassandra dedups via the full primary key, and
  `flushAllPartitionBuffers` at date completion drains everything before
  `backfill_progress` is written), but the buffer is no longer "this hour's
  events only."
- **One date at a time in `--mode backfill --verb range`.** Within a date,
  hours are dispatched concurrently; across dates we still process serially so
  a date failure surfaces before later dates contaminate state.

## Smoke-test target

Re-run the Feb 1-5 backfill that produced the 155s baseline. Target:
**≥ 2× wall-clock improvement** (155s → ≤ 75s). Ship if met. ADR 0006
(smoke-test discipline) governs the transcript format.

## Alternatives considered

1. **Pre-decompress files to disk** — rejected; see above.
2. **Each worker streams 2+ files concurrently** — adds bookkeeping; measure
   single-file-per-worker throughput first.
3. **Raise Cassandra driver `coreConnectionsPerHost` / batch limits** —
   Cassandra is 99.4% idle today; not on the critical path. Defensible as a
   later, defensive cleanup PR.
4. **Tune Cassandra server config (`concurrent_writes`, memtable, etc.)** —
   `nodetool tpstats` shows no contention; not worth touching.

## Related

- Issue #240
- ADR 0003 — Backfill/Hourly relay-race
- ADR 0004 — Microservices-shaped CLI contract
- ADR 0005 — `processed_files` is hourly-only
- ADR 0006 — Smoke-test discipline for data-pipeline PRs
- ADR 0007 — `processed_files` single-partition for O(1) catchup
