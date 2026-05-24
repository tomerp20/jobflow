# ADR 0006: Smoke-test transcripts are required when smoke-test ACs are listed on a data-pipeline PR

## Status
Proposed

## Context

The JobFlow Analytics ingestion subsystem (PR1 Fetcher, PR2 Ingester, PR3 Orchestrators, PR4 Deployment wrapper) shipped over a single day in May 2026 across approximately 15 implementation PRs. Each PR's acceptance criteria included a "Manual smoke test passes (requires local `cassandra:4.1` container — not automated)" line. The intent was that an agent or human would actually run the binary against a live Cassandra container before declaring the PR done.

What actually happened on three separate occasions:

1. **PR #220 (`#219` critical Ingester fix)** — The agent that wrote the fix never ran the smoke test. All three smoke-test checkboxes in the PR body were unchecked. Later validation against the live Linux box confirmed the fix worked, but only by luck — the diff happened to be correct. The unreviewed smoke test could have hidden a real bug.

2. **PR #222 (`#206` Backfill Orchestrator)** — Same gap. The agent's PR body listed several smoke tests as ACs; none were run. The reviewer noticed but the orchestrator merged before the actual smoke test was performed. The orchestrator turned out to work — but again, by luck.

3. **PR #229 (`#208` Deployment wrapper)** — More disciplined: the agent ran `bash -n` and a `sed` dry-run, but did not actually run `bootstrap.sh` end-to-end on a Linux box. Two real bugs (PATH for nvm node, `HOME` hardcoding) were caught by code review and fixed before merge — but if the reviewer hadn't been thorough, they could have shipped silently and bitten the operator on the first cron-driven run.

The original critical bug — PR #220's "Ingester cannot connect to Cassandra" (`#219`) — would not have shipped at all if the smoke-test AC had been enforced on PR2's three slices (`#197`, `#198`, `#199`). The agents who wrote those PRs marked their smoke-test ACs as "done" without running them. Three Ingester PRs merged green carrying a single bug that crashed the binary at startup.

The pattern is consistent: when smoke-test ACs are honor-system, they get checked without being run. The data-pipeline subsystem's "no automated tests in v1" decision (from the original PR1 grill) was made knowing manual smoke tests would be the safety net. The safety net failed because nobody enforced the run.

## Decision

For any PR in the `data-pipeline/**` subsystem whose acceptance criteria include a "smoke test" line, the PR body **must** include a smoke-test transcript before the PR is reviewed.

A transcript is a copy-paste of the actual command(s) the operator/agent ran plus the relevant output (the success log lines, the cqlsh queries that verify state, exit codes). It does not need to be long — three to ten lines covering "what was run, what was seen, what was verified" is sufficient. It must be against a live Cassandra container (not a mock, not a dry-run, not `bash -n`).

Concretely:

- The agent or human authoring the PR runs the smoke tests listed in the AC against a Cassandra container brought up from `data-pipeline/docker-compose.yml`.
- The successful output is pasted into the PR description under a `## Smoke test transcript` section.
- Reviewers **decline to approve** PRs that list smoke tests in the AC but do not include a transcript.
- The reviewer's first action is to read the transcript and verify it actually shows the AC's expected behaviour (events written, rows present, exit code zero, etc.).

A PR may explicitly opt out of this rule by removing the smoke-test ACs from its body (and explaining why in the PR description). The intent is to make the decision visible: either run the test or accept that you aren't running it. Silently marking the AC checkbox without running the test is what this ADR forbids.

## Consequences

- The PR cycle for data-pipeline work slows by roughly the wall-clock time of running the smoke test — typically 1–5 minutes. For an Ingester PR that processes one hourly archive file, this is 30–60 seconds. For an end-to-end Orchestrator PR, 2–3 minutes. The slowdown is small relative to a multi-hour PR review cycle.
- Reviewers gain a concrete artefact to anchor their review against — instead of trusting a checkbox, they verify the output is consistent with the spec.
- Agents that ship without running the test are filtered out at review time, not after merge. Bugs like `#219` that crashed the binary at startup are caught when the smoke test fails to produce a transcript.
- The discipline is project-local: it applies to `data-pipeline/**` only. The web app's PRs (with their automated test suites) do not need this rule because their test pass already serves as the transcript.
- The ADR does not require automated tests. The data-pipeline subsystem's "no automated tests in v1" decision (carried through PR1 → PR4) stands. This is purely about enforcing the manual-smoke-test discipline that was already part of every PR's AC.
- When the operator decides to migrate to automated tests (likely after the secondary enrichment job and the production hardening phase land), this ADR can be archived as superseded by that test suite.

## What this is not

- It is not a rule that every data-pipeline change needs a smoke test. A docs-only PR (e.g., updates to `docs/InjestionPlan.md`) does not list a smoke-test AC and therefore does not need a transcript. The trigger is the smoke-test AC, not the file path.
- It is not a rule about which Cassandra to test against. The team's `data-pipeline/docker-compose.yml` is the canonical environment; tests against a live Linux deployment also satisfy the rule (with an even higher confidence level).
- It is not a substitute for proper test coverage when V2 introduces automated tests. The ADR is explicitly a v1 process discipline.
