---
title: Company Scout
slug: company-scout
type: system
tags: [automation, github, scoring, analytics-producer]
sources:
  - CONTEXT.md#company-scout
  - docs/adr/0009-org-scorer-weighted-scoring.md
  - docs/adr/0010-https-shim-write-path.md
  - docs/CassandraPlan.md
related: [[application]] [[company]] [[first-sighting]] [[org]] [[active-github-presence]] [[cassandra-analytics-pipeline]] [[backfill]] [[hourly-ingest]] [[email-agent]] [[adr-0003-backfill-hourly-relay-race]] [[adr-0009-org-scorer-weighted-scoring]] [[adr-0010-https-shim-write-path]]
updated: 2026-05-24
status: stable
shipped: "#181 (slice 1), #182 (slice 2 — PR #247), #183 (slice 3 — PR #248), #184 (slice 4 — PR #249)"
shipped: "#181 (slice 1), #182 (slice 2 — PR #247), #183 (slice 3 — PR #248), #246 (shim — PR #250)"
---

# Company Scout

> Canonical definition: see `/CONTEXT.md` → **Company Scout**.

The producer side of the [[cassandra-analytics-pipeline]]. Triggered by the [[first-sighting]] of a [[company]] on a new [[application]], it enumerates candidate GitHub [[org|Orgs]], scores each against a weighted rubric (see [[adr-0009-org-scorer-weighted-scoring]]), and writes the active accepted Orgs into the analytics pipeline's `companies` Cassandra table via a small HTTPS shim (see [[adr-0010-https-shim-write-path]]).

## Why it exists

The analytics pipeline can't profile a Company until its `(Company, Org)` rows exist in `jobflow.companies`. Before the Scout, that table was hand-curated to a fixed list of ~5 target companies and was never updated. The Scout closes that gap: every Company you actually start tracking becomes a candidate for analytics, with no manual step.

## How it relates

- Triggered by [[first-sighting]] of a [[company]] on an [[application]] (both the manual create path and the [[email-agent]]'s auto-create path)
- Lives inside `cardService.createCard` as the single shared call site — fired detached after the card insert
- Calls the **OrgScorer** module (see [[adr-0009-org-scorer-weighted-scoring]]) to decide which candidate Orgs to accept
- Writes accepted, active Orgs to the analytics pipeline's `companies` table via the HTTPS shim (see [[adr-0010-https-shim-write-path]])
- Produces zero JobFlow-side rows — no new tables, no new columns, no [[notification|Notifications]]

## Decision flow per First Sighting

1. **Enumerate candidates** — slug-probe variants of the Company name + GitHub org search; once an anchor is admitted, prefix-sweep for `<anchor>-*` siblings.
2. **Score each candidate** — `scoreOrgCandidate(company, candidate, urls?)` returns a number 0…N using a weighted rubric (exact slug match, display-name match, ATS-slug agreement, anchor-prefix bonus, real-org credibility). Candidates below `ORG_ACCEPT_THRESHOLD` (currently 80) are rejected.
3. **Classify each admitted Org** — listOrgRepos → [[active-github-presence]] check (≥1 public, non-fork, non-archived repo pushed within 365 days).
4. **POST per-Company batch** — `POST /companies { company, active_orgs: [...] }` to the shim with `Authorization: Bearer <COMPANY_REGISTRY_TOKEN>`. Shim does `INSERT … IF NOT EXISTS` per Org (sets `initialized = false` so [[backfill]] picks it up — ADR 0003 invariant).
5. **Log per-Org outcome** — `registered` or `already_exists` from the shim's response.

## Key invariants

- Fires **exactly once per Company name**, the first time it appears on any [[application]] across all users (normalized: lowercase + trim).
- Rows reach Cassandra **only** via the HTTPS shim; JobFlow never speaks CQL.
- The shim is the sole writer of `initialized = false` — that invariant lives in one place (see [[adr-0010-https-shim-write-path]] and [[adr-0003-backfill-hourly-relay-race]]).
- Card creation latency is unaffected — `runCompanyCheck` is fired detached and never awaited.
- No retry; no scheduled re-evaluation; the Scout never runs twice for the same Company while a card with that name exists.

## Surprises / gotchas

- **gmailSync transaction-boundary edge case.** `createCard` is called inside `gmailSync`'s per-email transaction; the detached check may start before that transaction commits. On a rollback (rare error path), the Scout has run for a card that no longer exists — costing a stray log line and (potentially) an idempotent `companies` row. The new module carries a comment explaining why this is accepted, so it doesn't get "fixed" into a regression.
- **No-retry consequences.**
  - Shim down during a Company's First Sighting → that Company is silently un-registered forever (until manual intervention, which doesn't exist).
  - Company adds a new Org months later → Scout doesn't re-evaluate; the new Org is never registered.
  - All cards for a Company are deleted then a new one is added → Scout fires again; previously-registered Orgs return `already_exists` from the shim (safe).
- **`active` column in `companies` is effectively always `true` in v1.** Only active Orgs are written, so the column never carries a `false` value through this path. The schema retains it for future flexibility; no v1 change.
- **OrgScorer calibration result (slice 2).** No weight tuning was needed. Under the ADR 0009 starting weights: Wix→wix (85), Tenable→tenable (120), Salesforce→salesforce (120) all pass ≥80; Riverside→Riverside-Software (40), Faye→faye (50), Rise→rise (50) all reject <80. The key mechanism: exact slug (+50) alone doesn't clear the threshold — the credibility signals (repos +10, followers +10) and display-name match together push anchors over 80, while small/unknown orgs with only an exact slug hit stay at 50.

## Open questions

- A manual re-trigger admin endpoint (`POST /admin/company-scout/run-for-company?name=X`) would fix the "shim was down" and "Company added Orgs later" gaps in one shot. Not in scope for v1; revisit if the gaps bite in practice.
- Should the OrgScorer threshold and weights be env-tunable rather than file constants? Default = file constants for simplicity; revisit if retuning becomes frequent.

## Source pointers

- Trigger site: `backend/src/services/cardService.ts` (in `createCard`)
- Scout orchestrator: `backend/src/services/companyScout/companyScout.ts` (wired end-to-end — slice 3 / PR #248); `companyRegistry.ts` (LoggingCompanyRegistry dev fallback — slice 1; HttpShimCompanyRegistry production impl + resolveRegistry() factory — slice 4 / PR #249)
- Org Resolver: `backend/src/services/companyScout/orgResolver.ts` (shipped — slice 3 / PR #248)
- Active-Presence Classifier: `backend/src/services/companyScout/activePresenceClassifier.ts` (shipped — slice 3 / PR #248)
- GitHub API client: `backend/src/services/companyScout/githubClient.ts` (shipped — slice 2 / PR #247)
- OrgScorer module: `backend/src/services/companyScout/orgScorer.ts` (shipped — slice 2 / PR #247)
- HTTPS shim: `data-pipeline/shim/shim.js` — Node ESM service; deploy config in `data-pipeline/shim/deploy/` (shipped — PR #250)
- Cassandra schema: `data-pipeline/schema/004_companies.cql` + `005_alter_companies_initialized.cql`
- Canonical pipeline design: `docs/CassandraPlan.md` §4.4 (`companies` table)
- Related ADRs: [[adr-0003-backfill-hourly-relay-race]], [[adr-0009-org-scorer-weighted-scoring]], [[adr-0010-https-shim-write-path]]
