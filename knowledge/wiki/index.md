---
title: Wiki Index
slug: index
type: reference
updated: 2026-05-24
---

# JobFlow Wiki Index

Entry point for the knowledge base. Pages are flat; this file groups them by `type` for human navigation. **Claude:** grep `wiki/` directly when looking for specific terms — the index is a cheatsheet, not the source of truth.

> Schema: see [[../CLAUDE.md|CLAUDE.md]]. Authoritative sources: `/CONTEXT.md`, `/docs/adr/`, project memory.

## Concepts (domain nouns)

Mirror `CONTEXT.md` terms. Each page adds *system context* the glossary cannot carry.

- [[application]] — the central entity; one job pursuit at a Company
- [[stage]] — a user-defined step in a hiring pipeline
- [[applied-stage]] — the Stage flagged as the Email Agent's auto-create target
- [[rejection-stage]] — the Stage flagged as the Email Agent's rejection-routing target
- [[application-receipt]] — email acknowledgment that triggers auto-Application creation
- [[company]] — the employer named on an Application (not stored as its own entity)
- [[first-sighting]] — the first time a Company appears anywhere; triggers the Scout
- [[org]] — a GitHub organization the Company Scout resolved to a Company
- [[tracked-event]] — a row in `company_events`; one piece of public GH activity
- [[active-github-presence]] — Company Scout's classification of "alive" orgs
- [[activity]] — a row in `card_activities` (system event or user note)
- [[note]] — user-authored `card_activities` row
- [[timeline]] — chronological Activities + Notes for one Application
- [[notification]] — persistent in-app message from automation
- [[task]] — user-created action item, optionally linked to an Application

## Systems / Subsystems

- [[email-agent]] — reads inbox, routes/creates Applications, produces Notifications
- [[company-scout]] — runs on First Sighting; resolves Orgs; classifies GH presence
- [[cassandra-analytics-pipeline]] — Cassandra ingestion (Backfill + Hourly Ingest)
- [[ingestion-pipeline]] — Fetcher → Ingester → Cassandra; subsystem of the above
- [[backfill]] — nightly catchup process for uninitialised (Company, Org) rows
- [[hourly-ingest]] — frequent ingest for initialised (Company, Org) rows
- [[kanban-board]] — frontend React board rendering Stages & Applications
- [[gmail-integration]] — OAuth + token storage for the Email Agent

### Canonical design docs (linked, not duplicated)

- `docs/CassandraPlan.md` — JobFlow Analytics System Design (v2). Repo-root `/CassandraPlan.md` is the older v1.
- `docs/InjestionPlan.md` — Ingestion pipeline consolidated plan.
- `/ONBOARDING.md` — repo overview for new contributors.
- `/CONTEXT.md` — domain glossary; canonical for every concept page.

## Workflows

- [[workflow-feature-development]] — 6-step branch → implement → commit → PR → review → human merge
- [[workflow-grill-with-docs]] — stress-test plans against `CONTEXT.md` & ADRs
- [[workflow-prd-to-issues]] — break PRD into vertical-slice GitHub issues
- [[workflow-ship]] — one-shot feature delivery from a GitHub issue
- [[workflow-code-review]] — multi-agent orchestrated review (NOT `senior-code-reviewer`)

## Decisions (wiki mirrors of ADRs)

- [[adr-0001-applied-stage-flag]] → `/docs/adr/0001-applied-stage-flag.md`
- [[adr-0002-e2e-first-testing-strategy]] → `/docs/adr/0002-e2e-first-testing-strategy.md`
- [[adr-0003-backfill-hourly-relay-race]] → `/docs/adr/0003-backfill-hourly-relay-race.md`
- [[adr-0004-microservices-shaped-cli-contract]] → `/docs/adr/0004-microservices-shaped-cli-contract.md`
- [[adr-0005-processed-files-hourly-only]] → `/docs/adr/0005-processed-files-hourly-only.md`
- [[adr-0007-processed-files-single-partition]] → `/docs/adr/0007-processed-files-single-partition.md`
- [[adr-0008-ingester-worker-side-decompression]] → `/docs/adr/0008-ingester-worker-side-decompression.md`

## References (external systems & infrastructure)

- [[infra-render]] — Render deploy; spins down after 15min — see memory
- [[infra-neon]] — Postgres on Neon; uses pooler — see memory
- [[infra-linux-deployment]] — Xubuntu box at tomer@192.168.10.12 — see memory
- [[gh-archive]] — source of public GitHub events the pipeline ingests

## People

- [[tomer]] — collaboration preferences, role — see `memory/user_preferences.md`

## Open questions

(none yet — `q-<slug>` pages go here as they arise)
