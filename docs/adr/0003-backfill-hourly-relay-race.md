# ADR 0003: Backfill and Hourly Ingest hand off via the per-row `initialized` flag

## Status
Proposed

## Context

The JobFlow Analytics ingestion pipeline has two operational modes — the Backfill (a nightly catch-everything sweep) and the Hourly Ingest (a frequent low-latency loop processing the newest GH Archive file). Both processes read from the same on-disk archive and write to the same `company_events` Cassandra partition for a given Company. Without a clear ownership rule, the two would race: the Hourly Ingest could write a few hours of recent events for a brand-new (Company, Org) row before the Backfill ever runs, leaving an inconsistent "Cassandra has the last 8 hours but nothing else" state that has to be reconciled.

Three approaches were considered for dividing the work:

1. **Hourly processes everything; Backfill fills gaps.** The Hourly Ingest writes events for every active (Company, Org) row, including brand-new ones. The Backfill later walks the local archive to fill in older events that Hourly never saw. Simplest to think about but creates a per-Company partial-state window of variable length, complicates Backfill (it has to reason about "what's already there?"), and risks gaps if the Backfill never runs for some reason.

2. **A workflow flag on the Company table.** Add an enum like `state ∈ {pending, backfilling, ready}` and have Hourly skip Companies not in `ready`. Workable but conflates "this (Company, Org) row is current" with workflow state that could grow unrelated states later. State machines invite more states.

3. **A per-row `initialized` boolean owned by the Backfill.** The Backfill targets and processes rows where `initialized = false`; on success it flips them to `initialized = true`. The Hourly Ingest only processes rows where `initialized = true`. The two modes are mutually exclusive per (Company, Org) row.

## Decision

Use approach 3. Each `(company, org)` row in the `companies` Cassandra table carries an `initialized boolean` flag (default `false`). The Backfill Run is the only writer that flips the flag to `true`, and it does so only after every event in the local archive for that row has been written to `company_events`. The Hourly Ingest reads `companies` at startup, filters to rows where `initialized = true`, builds its `orgRegex` from just those orgs, and writes events accordingly. The Backfill reads the same table, filters to `initialized = false`, and uses an analogous filter for its own scans.

The two processes are coordinated at the operational level by a `flock`-based cron lock that prevents Hourly from running concurrently with the Backfill — but the per-row filter is the *correctness* guarantee, independent of the lock. Even if the lock were broken, the filter ensures no row is written by both jobs at the same time.

## Consequences

- A new (Company, Org) row added by the Company Scout will be invisible to the Hourly Ingest until the next Backfill Run completes for it. This delay is bounded by the Backfill cadence (nightly) plus the Backfill's runtime. For a freshly added Company on Tuesday morning, events for that Company will appear in `company_events` after the Wednesday-morning Backfill completes — not before. This is an acceptable trade-off for the integrity guarantee.
- Backfill becomes the single writer of historical state for new rows, so its idempotency and resumability properties (already designed into `processed_files` and the `backfill_progress` table) are the only mechanisms that need to be correct for correctness of the whole pipeline.
- Adding a new Org to an already-`initialized` Company creates a new row with `initialized = false`. The next Backfill Run picks up just that new row and processes it independently — the already-initialized siblings are untouched. This is the reason the `initialized` flag lives at the (Company, Org) row level rather than at the Company level.
- The Ingester needs only one piece of state to know which filter to apply: the `--mode` flag (`hourly` or `backfill`). The mode determines both the write strategy and the `initialized` filter direction. This keeps the Ingester's control flow simple — one read of `companies` at startup, one filter, one orgRegex.
