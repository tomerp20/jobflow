---
date: 2026-05-24
topic: Company Scout — re-grill against the wiki
participants: Tomer + Claude
status: closed
artifacts:
  - CONTEXT.md (revised Company Scout, Active GitHub Presence, Relationships)
  - knowledge/wiki/company-scout.md (created)
  - docs/adr/0009-org-scorer-weighted-scoring.md (created)
  - docs/adr/0010-https-shim-write-path.md (created)
related-issues:
  - PRD: #180
  - slices: #181, #182, #183, #184 (to be revised post-grill)
---

# Company Scout — re-grill (2026-05-24)

A re-grill of PRD #180. The original grill (earlier this session) **skipped the mandatory wiki pre-load step** in the `grill-with-docs` skill and produced a PRD that was misaligned with the project's real state — most notably it assumed one Org per Company, deferred the Cassandra write, and ignored the `initialized = false` invariant. Tomer flagged this and asked for a re-grill, properly grounded against the wiki and the updated `CONTEXT.md`.

## What's locked across both grills

Carried forward from the first grill (not re-asked):

- Trigger: **First Sighting** on both Application-creation paths (manual route + `gmailSync`), inside `cardService.createCard` as the single shared call site — not `pgSubscriber`, not two call sites. Global normalized dedup against `cards.company_name`.
- Background fire-after-commit, not awaited, no retry on crash.
- `GITHUB_TOKEN` env var — optional in dev, required in production.
- A clear comment in the new module about the `gmailSync`-rollback transaction-boundary edge case.
- No automated tests for the Scout feature.
- "Active GitHub Presence" rule: ≥1 public, non-fork, non-archived repo pushed within rolling 365 days.

## What changed in this re-grill

### Multi-Org per Company
A Company has **many** `(Company, Org)` rows, not one. `CONTEXT.md`, `CassandraPlan.md` §4.4, and ADR 0003 all assume this — the original grill missed it.

### "Active" is a per-Org classification, not a per-Company gate
Tomer's answer: **only active Orgs are written.** That makes the `Active GitHub Presence` classification *per-Org*; a Company has APGP iff at least one of its Orgs does. `CONTEXT.md` revised accordingly.

### Cassandra write is NOT deferred
The analytics pipeline at `/data-pipeline/` is real, the `companies` table exists, and Backfill + Hourly Ingest depend on Scout-written rows landing with `initialized = false` (ADR 0003). v1 must actually write to Cassandra — not log.

### Org resolution: weighted scoring instead of binary gate
A binary gate forces a precision/recall choice — Tomer wanted **both** good quality *and* lots of events. With URL trust dropped (Application URLs are most often ATS or third-party, so domain match is unreliable) and Meta-style brand renames disagreeing across every signal, no binary AND-gate is satisfiable.

**Decision:** an `OrgScorer` deep module — `scoreOrgCandidate(company, candidate, urls?) → number`, threshold `ORG_ACCEPT_THRESHOLD = 80`, weight constants in one file. Captured in **ADR 0009**.

Stress-tested against the original ~74-Company dataset:
- `Wix → wix`: 85 ✓
- `Wix → wix-incubator` (sibling): 85 ✓ (with anchor-prefix bonus)
- `Comet → comet-ml`: 100 ✓; `cometchat`: 50 ✗; `dlsucomet`: ✗
- `Riverside → Riverside-Software`: 50 ✗ (today's known false positive)
- `Meta → facebook`: 70 ✗ (accepted miss — brand renames are an honest gap of fully automated guessing)

Calibration: manual, one-time during implementation. The no-tests decision (carried over) means there's no automated regression to catch drift.

### Write path: tiny HTTPS shim, not direct CQL
JobFlow lives on Render; Cassandra lives on the home Linux box at `192.168.10.12`. The box will be exposed to the internet. Three options were weighed: direct CQL, HTTPS shim, Postgres outbox.

**Decision:** ~30-line Node HTTPS shim alongside Cassandra. One endpoint `POST /companies` with bearer-token auth; loops over `active_orgs` and issues `INSERT … IF NOT EXISTS` per Org (LWT — atomic check-and-insert). The shim is the **sole** writer of `initialized = false`, enforcing the ADR 0003 invariant in one place. Captured in **ADR 0010**.

JobFlow side: `CompanyRegistry` interface with `HttpShimCompanyRegistry` (prod) and `LoggingCompanyRegistry` (dev fallback when `COMPANY_REGISTRY_URL` unset). Per-Company batch POST; per-Org response statuses (`registered` / `already_exists`) logged on JobFlow side.

Tomer added: the shim must check existence and refuse silently (`already_exists`) on duplicates. Clarified as **idempotency by composite PK** (the same `(Company, Org)` row), not a global one-Org-one-Company invariant.

### Re-run scenarios — accepted as-is
- **A.** Shim down during a First Sighting → Company is silently un-registered forever. Accepted; no retry; no admin endpoint in v1.
- **B.** Company adds new Orgs months later → Scout doesn't re-evaluate; new Orgs never registered. Accepted; consistent with "fire once on First Sighting".
- **C.** All cards for a Company deleted then re-created → Scout fires again; shim's `IF NOT EXISTS` makes this safe. Documented; no code change.

## Things to clean up after the grill

- PRD #180 needs revision: replace the "Cassandra write deferred / LoggingCompanyRegistry is v1" framing with the HTTPS-shim reality; replace single-Org resolution with multi-Org + `OrgScorer`; add `COMPANY_REGISTRY_URL` / `COMPANY_REGISTRY_TOKEN` env vars.
- Slices #182 (resolver) and #183 (registry hand-off) need substantial rewrites; slice #181 (skeleton + trigger + env) needs only small edits; slice #184 (search fallback) likely folds into the new resolver slice.
- The shim itself is a **separate deliverable** in `data-pipeline/`, not part of the JobFlow PRD. A parallel issue/PRD covers it.
- The `companies.active` column is effectively always `true` under the locked design (only active Orgs are written). Schema unchanged; flagged for future cleanup.
