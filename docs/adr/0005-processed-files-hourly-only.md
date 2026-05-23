# ADR 0005: `processed_files` is hourly-only; Backfill uses `backfill_progress` instead

## Status
Proposed

## Context

The `processed_files` Cassandra table records "this GH Archive hour file has been ingested." Both the Backfill and the Hourly Ingest were originally specified (`docs/InjestionPlan.md` §5.6) to read and write this table for crash recovery and re-run idempotency.

This design caused a subtle but serious correctness problem when a new Company is added to the system after a Backfill Run has begun walking the archive. The PR3 grill walked through the scenario in detail; the short version is:

1. A Backfill Run starts at midnight targeting Company X. Walks the archive day by day. Each file it processes gets a row in `processed_files`.
2. At 02:30, the Company Scout adds Company Y (with `initialized = false`).
3. The Backfill Run continues, filtering only for Company X's Org per the locked `target_companies` set. Each file is added to `processed_files` as "done."
4. The Backfill Run completes at 06:00. Company X is flipped to `initialized = true`. Company Y is still `initialized = false`.
5. The next night's Backfill Run targets Company Y. It walks the archive. But every file is already in `processed_files`. The Ingester skips them all. **Company Y's historical events from before 06:00 are never written to Cassandra.**

The data loss happens because `processed_files` keys on file name alone. The notebook entry says "file is done" without saying "done for which set of companies." Three approaches were considered to fix this:

1. **Per-(file, target-set) keying on `processed_files`.** Each combination of file + set of target companies gets its own row. The "done" check becomes "done for the current target set?" instead of "done globally?" Correct but expensive — 24 × dates × runs rows and a hash-comparison on every check.

2. **Truncate `processed_files` between runs.** Simpler but breaks the Hourly Ingest, which relies on `processed_files` across multiple invocations to know which hourly files it has already processed.

3. **Stop using `processed_files` for the Backfill entirely.** Backfill uses `backfill_progress` (per-date completion) for crash recovery — the granularity is the date, not the file. Inside a single Ingester invocation walking a date, all 24 hourly files are processed sequentially in one process; crash recovery just restarts the in-progress date from scratch (re-reading 24 files; their writes to `company_events` are idempotent upserts).

## Decision

Use approach 3. `processed_files` is **only** read or written by the Ingester when it is running in `--mode hourly`. In `--mode backfill`, the Ingester does not touch `processed_files`. Backfill crash recovery is handled by `backfill_progress`:

- The Backfill Orchestrator queries `backfill_progress` on startup to find the max date marked `completed` for the active Run.
- It then spawns the Ingester with `--range <next-day> <yesterday>` to resume.
- The Ingester walks dates internally; for each date, it writes a `backfill_progress` row (`status = 'completed', completed_at = now(), events_written = N`) once all 24 hourly files for that date have been processed and their events written to `company_events`.
- A crash mid-date means that date's `backfill_progress` row remains `in_progress` (or absent); on restart, the date is reprocessed from hour 0. The ~24 files re-ingested cost CPU and disk reads but produce no duplicate rows in `company_events` (full-key upserts).

The Hourly Ingest mode keeps using `processed_files` exactly as before: read at startup to know which files in `GHARCHIVE_DIR` are already done; write a row on each successful file completion. The semantics are unchanged from the original specification.

## Consequences

- **Data-loss scenario eliminated.** A new Company added mid-Backfill or between Backfill Runs will be picked up by the next Backfill Run and walked through the full local archive without interference from earlier runs' `processed_files` entries. The next Backfill writes events for the new Company; the earlier Backfill's writes for already-initialised Companies are upserts and produce no duplicates.
- **Each Backfill Run re-reads the full local archive for its target_companies.** This is wasteful CPU + disk for already-initialised Companies whose events are already in `company_events`. Bounded by the number of Backfill Runs ever (one per night when there's pending work, none otherwise) and the size of the local archive (~470 GB compressed per year). Acceptable for a learning project; documented as a known cost.
- **Backfill crash recovery has coarser granularity.** A crash mid-date forces re-reading 24 hourly files for that date on resume, vs. the prior design's per-file resume. Worst-case wasted work per crash: 30 minutes to 2 hours. Crashes are rare; this is accepted.
- **No schema change.** `processed_files` keeps its existing primary key `(file_name)`. `backfill_progress` keeps its existing shape from PR1's schema migrations (005–007).
- **The Ingester's behaviour now branches on `--mode`** for `processed_files` reads and writes. This branching is documented in `docs/InjestionPlan.md` §5.6 and in the PR2 issue bodies.
