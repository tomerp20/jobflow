# ADR 0009 — Org acceptance via weighted scoring (OrgScorer), not a binary gate

**Status:** Accepted
**Date:** 2026-05-24

## Context

The Company Scout (see `/CONTEXT.md` → **Company Scout**, `knowledge/wiki/company-scout.md`) must decide, for each candidate GitHub organization, whether to write a `(Company, Org)` row into `jobflow.companies`. Wrong Orgs pollute the analytics dataset; missed Orgs reduce ingest coverage. The decision is fully automated — no human in the loop.

Three signals were available during the grill (2026-05-24):

1. **Slug similarity** between the org login and the normalized Company name. Reliable for exact matches; produces real-world false positives like `Riverside-Software` for "Riverside" (riverside.fm), `faye` for "Faye" (insurance), `rise` for "Rise".
2. **Org website (`blog`) domain matched against the Application's careers/application URL domain.** Initially attractive. Two failure modes surfaced:
   - **URL trust:** the Application URL is most often on an ATS platform (Greenhouse, Lever, Workday, …) or a job board, not on the company's own site. The domain on the card is not the company's domain.
   - **Brand renames:** Meta's GitHub org is `facebook` with website `opensource.fb.com`; the company name is "Meta" and careers URLs are on `metacareers.com`. Every signal disagrees.
3. **Org display name** (`org.name`, distinct from `org.login`). Catches Meta → `facebook` (display name is "Meta") but admits any unrelated org whose display name happens to coincide with a Company string.

A binary gate (any one signal passes → accept) could only choose between precision and recall — and the user's intent was both: **lots of events** ingested *and* false positives kept out. A binary AND-gate (all signals must agree) becomes unsatisfiable when Application URLs aren't trustworthy and brand renames disagree on the rename pair.

## Decision

A **weighted scoring module — `OrgScorer`** — replaces the binary confidence gate.

- One pure function: `scoreOrgCandidate(company, candidate, urls?)` returns a non-negative number.
- One constant: `ORG_ACCEPT_THRESHOLD` (start: **80**).
- Weight constants at the top of the same file, all editable in one place.
- Multiple weak signals can sum to acceptance; a strong contrary signal (e.g. an ATS slug that disagrees with the org login) is encoded as a **negative** weight, providing genuine evidence against rather than just absence-of-evidence.

Starting rubric (per candidate Org):

| Signal | Points |
|---|---|
| Exact slug match (`normalize(company) == normalize(org.login)`) | +50 |
| Strong slug similarity (substring + length-ratio ≥ 0.7) | +30 |
| Moderate slug similarity (substring + length-ratio ≥ 0.5) | +15 |
| Exact display-name match (`normalize(company) == normalize(org.name)`) | +50 |
| Moderate display-name similarity (substring + length-ratio ≥ 0.5) | +15 |
| ATS slug agrees with org login (when application URL is on an ATS platform) | +40 |
| **ATS slug present but disagrees** with org login | **−50** |
| Anchor-prefix sibling (sibling pass: org login starts with `<verified-anchor>-`) | +50 |
| Real-org credibility — org has ≥5 public non-fork repos | +10 |
| Real-org credibility — org has ≥100 followers | +10 |
| **Pass threshold** | **≥ 80** |

The threshold is a **single dial** — lower it for more events, raise it for fewer false positives — without touching any other code.

## Consequences

- The Scout can accept multiple Orgs per Company (Wix → `wix`, `wix-incubator`, …), realising the multi-Org capability the `companies` table schema and ADR 0003 already assume.
- A 20-Org per-Company safety cap is enforced separately; more than 20 candidates passing the threshold indicates a malfunctioning scorer and aborts that Company.
- Meta-style brand renames remain a known miss (`facebook` org reaches only 70 points under the starting weights). Accepted: the cost of catching them is loosening the display-name signal further, which would admit unrelated orgs.
- Slug-only false positives (`Riverside-Software`, `faye`, `rise`) score below the threshold under the starting weights (≤50) and are rejected — eliminating the regressions from the single-shot resolver.
- **Calibration is manual, not automated.** Per the per-feature decision to ship no tests for the Scout, the starting weights are tuned once during implementation against the existing ~74-Company dataset and then frozen unless drift is observed. This is the single largest risk in this decision.

## Alternatives considered

- **Binary AND-gate (all signals must agree).** Unsatisfiable for the Meta case and for any Application without trustworthy URL data. Rejected.
- **Binary OR-gate (any signal passes).** What the single-shot resolver effectively used; produces the documented false positives. Rejected.
- **Search-driven enumeration with name-only gate.** Highest recall but unbounded false-positive surface (`Comet` → admits `comet-ml`, `cometchat`, `dlsucomet`). Rejected.
- **Hybrid confidence score with manual disambiguation queue.** Adds a human-in-the-loop tier; violates the "fully automated" decision locked early in the grill. Rejected.
- **External alias map (Wikipedia/Wikidata, hand-curated list).** Would solve Meta → `facebook` cleanly; adds an external dependency and curation burden. Out of scope; revisit if the gap bites.

## See also

- `knowledge/wiki/company-scout.md` — full system context
- ADR 0010 — HTTPS shim write path (the consumer of OrgScorer's accept decisions)
- ADR 0003 — Backfill & Hourly Ingest hand off via per-row `initialized` (the invariant the accepted rows feed)
