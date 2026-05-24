# Retrospective — Cassandra Pipeline V1 (2026-05-23)

A single-day build of the JobFlow Analytics ingestion subsystem, spanning planning, implementation, code review, deployment, and a real e2e test against live data. Captures what was built, what surprised us, what worked, and what didn't, so future work on this codebase (and on adjacent projects) starts with the lessons.

---

## The arc — what happened in one day

| Phase | What we did |
|---|---|
| **Morning** | Created a worktree, read the existing plan docs (`CassandraPlan.md`, `InjestionPlan.md`), realised the plan needed a per-PR grilling before any code |
| **Mid-morning** | PR1 grill → PRD #187 → slice issues #188 (schema), #189 (Fetcher base), #190 (Fetcher catchup), shipped + merged in parallel |
| **Late morning** | PR2 grill → PRD #194 → slice issues #196 (disk-layout refactor), #197/#198/#199 (Ingester base / backfill / catchup) |
| **Midday** | First Cassandra container brought up on the Linux box. Schemas applied. First Ingester smoke test crashed with `policies.retry.DefaultRetryPolicy is not a constructor` → filed `#219` critical, agent fixed via PR #220, verified live |
| **Afternoon** | PR3 grill → PRD #204 → slice issues #205 (Hourly Orchestrator), #206 (Backfill Orchestrator). Discovered the `latestOnDisk` bug `#226` mid-test, fixed via PR #228 |
| **Late afternoon** | PR4 grill → PRD #208 → slice #209, implemented via PR #229. Deployment wrapper landed |
| **Evening** | Wiped the Linux box clean, ran `bootstrap.sh` fresh, did end-to-end tests against 63 companies + Microsoft over 7 days (12,621 events written). Filed three followups (#216, #217, #221, #225, #231, #234) along the way |

By the end: V1 code 100% complete, deployment wrapper live on a real Linux box, ingestion pipeline producing real data from real GH Archive files.

---

## Technical surprises worth knowing

### 1. The cassandra-driver API doesn't match what an LLM assumes

The agents implementing PR2 used two cassandra-driver APIs that don't exist:

- `policies.retry.DefaultRetryPolicy()` — not a class; real exports are `RetryPolicy`, `IdempotenceAwareRetryPolicy`, `FallthroughRetryPolicy`. Drop the explicit policy and the driver's default is fine.
- `client.prepare(sql)` — does not exist. Cassandra-driver's `Client` has `execute()` and `batch()`. Prepared statements happen via `{ prepare: true }` option on those calls; the driver caches the prepared form internally on first call.

Both bugs slipped past three code reviews because nobody actually ran the binary against a real Cassandra (see ADR 0006). The fix was trivial; the process gap was the real problem.

**Takeaway:** for any unfamiliar driver/library, an LLM-written first draft against it should be smoke-tested before merge. Always.

### 2. Public-GitHub activity for enterprise companies is way lower than `public_repos` count implies

Going in, we assumed companies with 416 public repos (Salesforce) would produce thousands of events per day. Real data:

| Company | `public_repos` | Events on 2026-05-22 |
|---|---|---|
| Microsoft | (not in our list initially) | **1,704** (re-added in 7-day test) |
| Comet | 67 | 26 |
| Salesforce | 416 | **14** |
| Port-labs | 126 | 7 |
| Workday | 54 | **0** |
| Vonage | 148 | **0** |
| Autodesk | 87 | **0** |

Most enterprise orgs use GitHub Enterprise / private repos for real work. Their public org is documentation, examples, or occasional OSS contributions. **Microsoft alone drove ~90% of our event volume.**

**Takeaway:** for analytics over public GitHub activity, "public_repos count" is a near-useless metric. Pick companies by recent push activity, not repo count. Microsoft and a handful of true-OSS-first companies (`comet-ml`, `port-labs`, `salesforce`'s actual public repos) drive most of the signal.

### 3. GH Archive scales surprisingly well at LAN throughput

We fetched 168 files (4.2 GB compressed) in 131 seconds = **~33 MB/s sustained**, **~1.3 files/second** with `p-limit(3)`. The HDD wrote at that rate without breaking a sweat (7200 RPM HDDs do ~150 MB/s sequential, so we were well within capacity).

For a 1-year backfill (~470 GB compressed), at this rate: **~4 hours of fetch wall-clock**. Not as scary as the original plan implied.

### 4. The 7-day backfill across 63 companies took 21 seconds for Microsoft alone, then ~3 minutes for all 63

Microsoft is fast because all events go to the same `(microsoft, 2026-05)` partition — UNLOGGED batches stay full and warm. The other 62 companies spread their few events across many partitions, so batching loses some efficiency. Still, **3 minutes for 168 files × 63 companies** = comfortably faster than the plan's "5-15 min for hourly" target.

### 5. The "exit code on ENOENT" bug (`#221`) was a false positive

I filed `#221` ("Ingester exits 0 on missing-file failure") based on observing `exit=0` in my own shell. Turns out my shell had `node ... | tail; echo $?` — and `$?` captures the **last** pipeline stage's exit code (the `echo` itself), not `node`'s. The Ingester's exit-on-failure logic was correct from the start.

An agent running `/ship 221` did the diagnostic work, found the false positive, and closed the issue with a verification trail.

**Takeaway:** when reading exit codes from a piped command, redirect first (`> /tmp/out 2>&1`) and inspect `$?` immediately. Pipes mask the truth.

---

## Process patterns that worked

### A. The grill → PRD → prd-to-issues → ship sequence

For each of the four PRs (PR1 Fetcher, PR2 Ingester, PR3 Orchestrators, PR4 Deployment), we ran the same sequence:

1. **Grill** the design with the relevant docs (CassandraPlan, InjestionPlan). Resolve every "we'll figure it out later" before writing code.
2. **PRD** captures the grilled decisions as a GitHub issue. Long, structured, includes user stories.
3. **prd-to-issues** breaks the PRD into independently-grabbable slices.
4. **ship** each slice via an agent.

The grilling was the secret. By the time the PRD was written, every architectural decision had a justification; by the time the slices were created, every cross-cut had been considered. Agents picking up the implementation issues had near-zero ambiguity.

What helped: the grill produced **ADRs** (`0003` relay-race, `0004` microservices-shaped CLI, `0005` processed_files hourly-only) for the load-bearing decisions. Future contributors can see *why*, not just *what*.

### B. Chained branches off a feature-parent (then off main after parent merges)

Initially we used a chained-branch pattern: PR1's slices branched off a parent feature branch (`feature/cassandra-data-pipeline`), not off main. This let multiple slices co-exist before the parent landed.

Later, after the parent merged to main, we switched to branching slices off main directly. Both approaches worked. The lesson is: pick one and be consistent within a PRD's slices, so reviewers know what to expect.

### C. Precursor "grill outcomes" PRs before each implementation PR

Each grill produced a small documentation/ADR PR (`#186`, `#193`, `#203`) that landed on main BEFORE the implementation slices started. This kept the implementation PRs focused on code, and gave the implementation agents a stable target to read.

The pattern is reusable: for any PRD-style workflow, the grill outcomes (CONTEXT.md updates, ADRs, plan amendments) ship as a precursor PR, not bundled with implementation.

### D. The supervisor/worker SSH pattern

When the user wanted "two-way live communication" between Claude sessions, the realistic answer was: I (the supervisor Claude on the Mac) SSH directly into the Linux box and run commands there. This gave the *outcome* of a supervisor-with-remote-worker pattern without the complexity of two independent Claude instances coordinating over a shared channel.

This worked because:
- The Mac already had passwordless SSH to the Linux box.
- The supervisor Claude had full session context (no fresh-agent briefing needed).
- The user could watch terminal output on the Linux box independently if they wanted.

For long-running operations (fetches, backfills), we used `run_in_background: true` so the supervisor didn't block waiting for results.

### E. Parallel agents on disjoint files

When PR2's three slices (`#197`, `#198`, `#199`) could touch disjoint Ingester code paths, we tried to ship them in parallel via separate agents. This worked for `#199` (the catchup slice) — it merged cleanly. But `#198` (the backfill mode) and `#199` both touched `data-pipeline/ingester/lib/cli.js`, so when `#199` merged first, `#198`'s PR (`#215`) hit a merge conflict requiring a rebase. The rebase resolution took ~5 minutes.

**Takeaway:** "disjoint logical paths" doesn't mean "disjoint files." Before parallelising, grep the planned changes for shared files. If there's overlap, serialise.

---

## Process gaps that hurt

### A. Smoke-test ACs were honor-system

Three PRs (`#220`, `#222`, `#229`) merged with smoke-test acceptance criteria marked done without anyone actually running the smoke test. PR #220 worked anyway because the code happened to be correct. PR #222 worked because the reviewer was thorough. PR #229 worked because the reviewer caught real bugs in code review.

The recurring failure mode: agents that implemented the code never ran the binary, and reviewers accepted that. The first critical bug (`#219`) was caused by this pattern over three earlier PRs (`#197`, `#198`, `#199`).

ADR `0006` addresses this for the data-pipeline subsystem going forward.

### B. The `latestOnDisk` design coupling wasn't grilled at the right time

The Backfill Orchestrator's `endDate` was hard-coded to `yesterdayUtc()`, but the on-disk archive doesn't always reach yesterday. This bit us during the first 7-day backfill test: the orchestrator tried to walk a date that had no files, the Ingester crashed on ENOENT, the run was marked failed.

The fix (`#226`) was a one-line change. The bug should have been caught during the PR3 grill — when the orchestrator's range computation came up, "what if the disk doesn't reach yesterday?" wasn't asked. A good grill would have surfaced this; in retrospect, the grill leaned more on the *correctness* of the lifecycle (fresh / resume / failed) than the *robustness* of the range computation.

**Takeaway:** for any auto-discovered input, ask "what if the discovery returns less than expected?" alongside "what if it returns nothing?"

### C. The hardcoded `BACKFILL_START_DATE` in `run-backfill.sh` (`#234`)

PR4's `run-backfill.sh` hardcoded `BACKFILL_START_DATE="2025-05-22"` — a value lifted from the example in `docs/InjestionPlan.md` §6.4 verbatim. Meaningful when the plan was authored; meaningless to a fresh operator. The first cron-driven backfill on a clean box would try to fetch ~8,760 files (over 2 hours of fetch).

The PR4 grill specified that BACKFILL_START_DATE would be a hardcoded value — it just specified the wrong default-construction strategy. The grill should have specified "default to 1 year ago via `$(date -d ...)` at script invocation time," not "hardcoded `2025-05-22`."

**Takeaway:** when a value is "configurable but with a default," the default should be computed from current state, not pinned to a snapshot value.

### D. Cross-producer drift between Backfill and Hourly orchestrators (`#231`)

When we URL-encoded the `--target-companies` argument in the Backfill Orchestrator (`#225` / PR #230), we forgot the Hourly Orchestrator also builds the same wire format and didn't encode it. The reviewer caught this and filed `#231` — but the fix is in a separate PR (a Sonnet agent picked it up later that day).

This is a class of bug worth watching: when one of N producers of a wire format is updated, the others can silently drift. Either extract to a shared helper or audit grep-style before merging changes that affect a wire format.

### E. The Cassandra container crashed mid-backfill due to operator action

During the first 7-day backfill on the Linux box, Cassandra restarted at 17:53:46 — coincidentally just as the Ingester was writing. The cause was operator action (the user was debugging Reaper in a separate window and ran `docker compose up`, which restarted the whole stack), not a pipeline bug.

The Backfill Orchestrator handled this correctly: detected the connection failure, tried to mark the run as failed (the marking failed too because Cassandra was still restarting), exited with an error. The next invocation found the `in_progress` row and resumed cleanly.

**Takeaway:** the pipeline's failure-handling story works in practice. The orchestrator's "treat-failed-as-completed-on-next-run" semantics (from ADR 0003) handled the case correctly without operator intervention.

---

## Decisions worth understanding (the *why* behind the *what*)

### Multi-org per Company (yes / no / yes)

Early in the PR1 grill, I went back and forth on whether a Company has one Org or many. Final answer: **one Company → many Orgs.** Justified by real data — Wix actually has `wix`, `wix-incubator`, `wix-private`. The Cassandra `companies` table is keyed `((company), org_name)` to allow multiple rows per Company.

This was the correct call. The data confirms it.

### One CONTEXT.md vs two (CONTEXT-MAP.md)

The grill considered whether the Cassandra Analytics pipeline was a separate bounded context from the JobFlow web app (separate CONTEXT.md files, a CONTEXT-MAP.md at the root) or one extended context. After seeing the merged glossary terms — Company, First Sighting, Company Scout, Active GitHub Presence — that bridge the two systems, we chose **one context**.

This was the correct call. The pipeline isn't a separate domain; it's the analytics arm of the Company Scout's resolution.

### processed_files is hourly-only (ADR 0005)

The grill discussed whether Backfill should write to `processed_files` for crash recovery. Initially yes, then we discovered a subtle bug: if Backfill marks a file as done (for Company X), and later Company Y is added, the next backfill skips the file → Company Y never gets backfilled.

Solution: `processed_files` is hourly-only. Backfill uses `backfill_progress` (per-date) for crash recovery instead. Each backfill walks every file in its range — wasteful for already-initialised companies but idempotent via the `company_events` primary key.

This was the correct call. The data corruption scenario it prevents is a real one.

### No automated tests in V1

For all four PRDs, we explicitly skipped automated tests. The intent was speed: ship a working pipeline, manually smoke-test, add tests after the architecture stabilises.

In hindsight: **mostly right, but smoke-test enforcement should have been more disciplined.** The honor-system smoke-test ACs let one critical bug ship (`#219`). ADR 0006 closes this loop for V1. V2's "production hardening" phase will introduce a real test suite for the data-pipeline subsystem.

---

## What to do differently next time

1. **Grill more aggressively for failure modes, not just happy paths.** "What if the disk is empty / doesn't reach yesterday / has gaps / has too much?" should be standard grill questions for any auto-discovered input.

2. **Smoke-test transcripts as a merge gate, not an honor-system AC.** ADR 0006 codifies this for the data-pipeline subsystem.

3. **Defaults should be computed, not snapshotted.** Hardcoded values from example invocations are footguns. `BACKFILL_START_DATE` and similar "defaults with override" parameters should compute their defaults at invocation time.

4. **Multi-producer wire formats need a single source of truth.** When N orchestrators produce the same CLI arg format, extract to a shared helper. Reviewers should flag any change that touches a wire-format producer without also touching the others.

5. **For parallel agents, audit the touched files before parallelising.** Different logical paths don't mean different files. A 30-second `git grep` saves a 15-minute rebase later.

6. **Keep grill outcomes in a precursor PR.** Land the ADRs and plan amendments BEFORE the implementation slices start. Implementation agents have a clean target to read; the implementation PRs stay focused on code.

---

## Things to remember for V2 / future work

- The deferred backlog (`#210`, `#212`, `#213`, `#214`, `#227`) is real future work, not "abandoned" features. Each has clear acceptance criteria and a revival trigger.
- The first cron-driven backfill on a fresh box will be expensive (potentially hours) because the BACKFILL_START_DATE default sets the first-fetch scope. After `#234` lands, this becomes "1 year ago" rather than the May 2025 hardcoded value.
- Microsoft's volume dominates the dataset. Any analytics-quality concern (recall, precision, statistical relevance) needs to be evaluated with and without Microsoft as a separate slice.
- The orchestrator's `latestOnDisk` change (`#226`) means the operator controls the backfill range by controlling what's on disk. The Fetcher's range is the upper bound; the Backfill auto-adapts.

---

## Closing

V1 of the ingestion subsystem is a single-day project that shipped a complete, tested, deployed pipeline against real GH Archive data, with a deliberate "no automated tests" trade-off and a clear plan for what's deferred.

Most of the surprises came from "the LLM/agent assumed a library API or operational property that wasn't actually true." Most of the wins came from "we grilled the design with the relevant docs before writing code, then trusted agents to implement against the grilled specification."

The next time we run this playbook, the playbook itself should be smoother — ADR 0006 enforces smoke-test discipline, the runbook captures the deployment phases, and the followup issues capture the real bugs we didn't anticipate.
