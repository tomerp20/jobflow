# ADR 0010 — Company Scout writes to Cassandra via a tiny HTTPS shim, not direct CQL

**Status:** Accepted
**Date:** 2026-05-24

## Context

The Company Scout (see `/CONTEXT.md` → **Company Scout**, `knowledge/wiki/company-scout.md`) writes one row per accepted `(Company, Org)` pair into `jobflow.companies` on the analytics-pipeline Cassandra cluster. The two systems live in genuinely different network zones:

- **JobFlow web app** runs on **Render** (public cloud) and connects to Neon Postgres.
- **Analytics pipeline + Cassandra** run on the Xubuntu box at `tomer@192.168.10.12` (see `knowledge/wiki/infra-linux-deployment.md` / project memory).

Render cannot reach a private home-LAN address; the home box will be exposed to the internet for this purpose. The write volume is intentionally tiny — a single batch per Company First Sighting, with no scaling concerns in v1.

Additional constraints from the grill (2026-05-24):

- The `companies` table carries an `initialized boolean` flag (ADR 0003) that **must** be `false` on every Scout-written row, or the row regresses Backfill state silently. The producer must not be allowed to "forget" this.
- The Scout's run-once-per-Company semantics combined with no retry mean the write surface is small, but a corrupted write would silently break the Backfill/Hourly relay race for that row.

## Decision

JobFlow writes via a **tiny HTTPS shim** running on the Xubuntu box, alongside Cassandra. JobFlow does not import `cassandra-driver` and does not speak CQL.

**Wire contract:**

```
POST /companies
Authorization: Bearer <COMPANY_REGISTRY_TOKEN>
Content-Type: application/json

{
  "company": "wix",
  "active_orgs": [
    { "org_name": "wix",           "last_repo_push": "2026-05-20T..." },
    { "org_name": "wix-incubator", "last_repo_push": "2026-04-18T..." }
  ]
}

→ 200 OK
{
  "company": "wix",
  "results": [
    { "org_name": "wix",           "status": "registered" },
    { "org_name": "wix-incubator", "status": "already_exists" }
  ]
}
```

- One POST per Company (batch of all admitted active Orgs).
- The shim loops over `active_orgs` and issues `INSERT … IF NOT EXISTS` per Org — a Cassandra Lightweight Transaction. Atomic check-and-insert; no read-before-write race.
- The shim is the sole writer of `initialized = false` and the only code that touches the `companies` table on this path. The invariant is enforced in one place.
- HTTPS via a reverse-proxy (Caddy/nginx) terminating Let's Encrypt; Cassandra's native port stays bound to localhost.
- Auth via a shared bearer token rotated by changing one env var on each side.
- The shim itself is a separate deliverable in the `data-pipeline/` repo, ~30 lines of Node.

JobFlow's `CompanyRegistry` interface has two implementations:

- `HttpShimCompanyRegistry` (production): POSTs to `COMPANY_REGISTRY_URL` with the bearer token.
- `LoggingCompanyRegistry` (dev fallback when `COMPANY_REGISTRY_URL` is unset): emits a structured log line of what *would* have been registered.

## Consequences

- JobFlow has **no Cassandra driver dependency** and no CQL anywhere — one HTTP call from one place.
- The shim centralizes the `initialized = false` invariant; future JobFlow contributors physically cannot forget it.
- The shim's per-Org `INSERT … IF NOT EXISTS` makes JobFlow's POSTs idempotent — duplicate sends (rare, but possible across network glitches or a deliberate re-trigger later) cause no harm and produce `already_exists` in the response so the caller can log accordingly.
- The shim is one more service to keep running (`systemd` unit on the Linux box). Operational footprint: small but nonzero.
- **A shim outage during a Company's First Sighting permanently loses that registration** for the current scope (no retry; the First Sighting flag in `cards.company_name` is already consumed). Documented in `knowledge/wiki/company-scout.md` Open Questions; a manual re-trigger admin endpoint is the natural future fix.
- The `data-pipeline/` repo grows by a small service and its own deploy story (cron / systemd). JobFlow ships only the client-side `HttpShimCompanyRegistry` and the env vars.

## Alternatives considered

- **Direct CQL over the internet.** JobFlow opens a CQL connection to `cassandra://your-home-ip:9042` using `cassandra-driver`. Native protocol on the public internet is a much larger attack surface than HTTPS; brings a multi-MB native client into JobFlow for what is otherwise one HTTP POST; spreads the `initialized = false` invariant across producer code. Rejected.
- **Postgres outbox.** JobFlow inserts the intent into a `pending_company_writes` table on Neon; a daemon on the Xubuntu box polls and writes to Cassandra. Decouples networks; survives Cassandra/network downtime. Adds a JobFlow-side table (the user specifically wanted no JobFlow companies-related table); two new pieces of infra (table + daemon). Rejected as too much for the volume.

## See also

- `knowledge/wiki/company-scout.md` — full system context
- ADR 0003 — Backfill & Hourly Ingest hand off via per-row `initialized` (the invariant the shim enforces)
- ADR 0009 — OrgScorer weighted scoring (produces the accept decisions the shim writes)
