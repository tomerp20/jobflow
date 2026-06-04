---
title: WhatsApp Notifier
slug: whatsapp-notifier
type: system
tags: [automation, whatsapp, notifications, shim]
sources:
  - CONTEXT.md#whatsapp-notifier
  - docs/adr/0011-whatsapp-notifier-on-shim.md
  - docs/adr/0010-https-shim-write-path.md
related: [[application]] [[company-scout]] [[email-agent]] [[notification]] [[cassandra-analytics-pipeline]] [[infra-linux-deployment]] [[adr-0010-https-shim-write-path]]
updated: 2026-06-04
status: planned
---

# WhatsApp Notifier

> Canonical definition: see `/CONTEXT.md` → **WhatsApp Notifier**.

An automated process that sends one outbound [[notification|WhatsApp Message]] — explicitly **not** a [[notification|Notification]] — from the user's personal WhatsApp account to a single hardcoded recipient (Netali, `+972 54-448-3175`) whenever an [[application|Application]] is created. A sibling of the [[email-agent|Email Agent]] and [[company-scout|Company Scout]], triggered by Application creation rather than by email or Company novelty.

## Why it exists

The user wants a real-time heads-up to a specific person every time a new Application enters the pipeline, without opening JobFlow. Free, no third-party API: `whatsapp-web.js` drives the user's own WhatsApp Web session (personal-number ban risk explicitly accepted).

## How it relates

- Triggered from `cardService.createCard` — fired **detached** next to `runCompanyCheck`, one shared call site covering both the manual create path and the [[email-agent|Email Agent]]'s auto-create path.
- Reuses the [[company-scout|Company Scout]]'s network bridge: JobFlow (Render) → existing **ngrok** static domain → the **Cassandra write shim** on the [[infra-linux-deployment|Linux box]].
- Does **not** run as its own component — it is a `POST /notify` route added to the existing shim (see [[adr-0010-https-shim-write-path]] for the shim; ADR 0011 for this extension).
- Produces **no [[notification|Notification]]**, no `notifications` row, no JobFlow-side persistence. The WhatsApp Message is ephemeral.

## Wire contract

`POST /notify` on the shim, `Authorization: Bearer <SHIM_BEARER_TOKEN>` (the same token that guards `/companies`):

```
{ "company": "Wix", "role": "Senior Backend Engineer", "url": "https://wix.com/careers/12345" }
→ 200 { "status": "queued" }   ·   401 / 400 / 415   ·   503 whatsapp_unavailable
```

JobFlow sends only `{ company, role, url }`. The recipient number and the template
("Hey Netali, I found new position, Here are the Details:") are hardcoded **in the shim**.

Rendered message:

```
Hey Netali, I found new position, Here are the Details:
Wix — Senior Backend Engineer
https://wix.com/careers/12345
```

When `url` is absent the link line is dropped; the message still sends.

## Key invariants

- Fires on **every** Application creation (manual + Email Agent). No filtering by source.
- JobFlow never knows the recipient or the wording — only the three data fields.
- `/notify` failures (Chromium dead/unauthenticated → 503) **never affect `/companies`** — the WhatsApp client is isolated and initialized after the HTTP server is listening.
- Card-creation latency is unaffected — the call is detached and never awaited (mirrors the Scout).
- Bursts are throttled: `/notify` serializes sends with a min interval so a bulk Gmail sync doesn't fire a spam-shaped flurry.

## Surprises / gotchas

- **Chromium inside a "Cassandra write shim."** The shim's base image moves `node:20-alpine` → `node:20-slim` to host puppeteer/Chromium reliably; image grows to ~400 MB. Two unrelated features now share one container's *deploy* domain (redeploying the shim restarts the Cassandra write path), though their *failure* domains are kept separate by the isolation guard. See ADR 0011.
- **Scan the QR exactly once.** First run renders the WhatsApp Web QR as ASCII (`qrcode-terminal`, visible over SSH / in `docker logs`). The `LocalAuth` session dir is **bind-mounted to the host**, so it survives restarts/rebuilds — re-scan only if WhatsApp invalidates the session (logout, phone offline >14 days, or ban).
- **Transaction-boundary edge.** `createCard` runs inside gmailSync's per-email transaction; the detached `/notify` can fire before commit, so a rare rollback sends Netali a message for an Application that was never saved. Accepted with a code comment — same edge as the Scout, but human-visible.
- **Silent death.** A dead session drops every message with no active alert in v1 — detection is manual (`docker logs jf-shim`). Consistent with the Scout's no-alerting posture.

## Open questions

- **Self-alert on session death** (message the user's own number on `disconnected`/`auth_failure`) — deferred to v2; v1 is logs-only.
- **Throttle tuning** — exact min send-interval to be set during implementation; revisit if bursts still trip WhatsApp heuristics.

## Source pointers (planned)

- Trigger site: `backend/src/services/cardService.ts` (in `createCard`, next to `runCompanyCheck`)
- JobFlow client: `WhatsAppNotifier` interface + `HttpShimWhatsAppNotifier` / `LoggingWhatsAppNotifier` (mirrors `companyScout/companyRegistry.ts`)
- Shim route: `data-pipeline/shim/shim.js` (`POST /notify`) + the `whatsapp-web.js` client module
- Deploy/runbook: `data-pipeline/shim/RUNBOOK.md` (QR scan, session volume, env)
- Related ADRs: [[adr-0010-https-shim-write-path]], ADR 0011, ADR 0006 (smoke-test transcripts)
