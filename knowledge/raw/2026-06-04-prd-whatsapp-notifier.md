## Problem Statement

As the JobFlow user, every time a new [[application|Application]] enters my pipeline — whether I add it manually or the [[email-agent|Email Agent]] auto-creates it from an [[application-receipt|Application Receipt]] — I only find out by looking at JobFlow. I want a specific person (Netali) to be told in real time, over WhatsApp, the moment a new Application is created, without me opening the app or taking any action.

## Solution

A new automated process — the **[[whatsapp-notifier|WhatsApp Notifier]]** — sends a single ephemeral outbound **WhatsApp Message** from my personal WhatsApp account to one hardcoded recipient (Netali, `+972 54-448-3175`) whenever an [[application|Application]] is created. It is a sibling of the [[email-agent|Email Agent]] and [[company-scout|Company Scout]], triggered by Application creation rather than by email or [[first-sighting|Company novelty]].

It reuses existing infrastructure end to end: a new `POST /notify` route is added to the existing Cassandra write shim on the [[infra-linux-deployment|Linux box]], reached from JobFlow (Render) over the **existing ngrok static domain** — no new container, no proxy, no second tunnel. JobFlow fires the call **detached** so Application creation latency is never affected, and the WhatsApp Message is never persisted in JobFlow (it is explicitly **not** a [[notification|Notification]]).

The message reads:

```
Hey Netali, I found new position, Here are the Details:
<Company> — <Role>
<job-posting URL>
```

The full design is authoritative in [[adr-0011-whatsapp-notifier-on-shim]], [[whatsapp-notifier]], `CONTEXT.md`, and the grill transcript at `knowledge/raw/2026-06-04-grill-whatsapp-notifier.md`.

## User Stories

1. As the JobFlow user, I want a WhatsApp Message sent automatically whenever an Application is created, so that I am notified in real time without opening JobFlow.
2. As the JobFlow user, I want the message sent on **both** the manual create path and the Email Agent auto-create path, so that no new Application is ever missed regardless of how it entered.
3. As the JobFlow user, I want the message delivered to one specific person (Netali), so that the right person is kept informed of every new opportunity.
4. As the JobFlow user, I want the message to contain the company name, the role title, and the job-posting URL, so that Netali has the essential details at a glance.
5. As the JobFlow user, I want the message to still be sent when an Application has no job-posting URL (just dropping the link line), so that I am notified even for Applications lacking a link.
6. As the JobFlow user, I want the greeting and recipient phone number to live on the shim (box-side), so that I can change the recipient or wording with a box-side edit and restart — no JobFlow code change or Render redeploy.
7. As the JobFlow user, I want JobFlow to send only `{ company, role, url }` and never know who the recipient is, so that the personal contact stays out of the application code.
8. As the JobFlow user, I want Application creation to never be blocked or slowed by the WhatsApp send, so that the board stays responsive even if WhatsApp is slow or down.
9. As the JobFlow user, I want the message sent from my own personal WhatsApp account (via whatsapp-web.js), so that it costs nothing and arrives as a normal personal message.
10. As the JobFlow user, I want to authenticate the WhatsApp session once by scanning a QR code over SSH, so that setup is a single one-time step.
11. As the JobFlow user, I want the authenticated session to survive container restarts, rebuilds, and reboots, so that I do not have to re-scan the QR repeatedly.
12. As the JobFlow user, I want a burst of Applications created in one Email Agent sync to be sent as a throttled, paced sequence rather than a simultaneous flurry, so that my account does not look like a spam bot and risk a ban.
13. As the JobFlow user, I want every Application in a burst to still get its own message (paced, not dropped or merged), so that one-message-per-Application is preserved.
14. As the JobFlow user, I want a failure of the WhatsApp send path to never affect the Company Scout's Cassandra write path on the same shim, so that adding this feature does not destabilise an existing one.
15. As the JobFlow user, I want the WhatsApp send outcomes and session lifecycle events logged, so that I can diagnose a dead session by checking the shim logs.
16. As the JobFlow user, I want the feature to be a no-op in local development and tests (when the notify URL is unset), so that nobody is messaged outside production.
17. As the JobFlow user, I want the notify endpoint protected by the same bearer token as the existing shim, so that only JobFlow can trigger messages.
18. As the JobFlow user, I want a clear operator runbook for the one-time QR scan, the session volume, and the recipient/template config, so that I can set it up and recover it reliably.
19. As the JobFlow user, I want the PR to demonstrate the existing `/companies` path still works and a real `/notify` send succeeds, so that I can trust the shared-container change did not regress the Company Scout.
20. As Netali, I want each message clearly phrased as a new-position heads-up with the company, role, and link, so that I immediately understand what it is and can act on it.

## Implementation Decisions

**Topology & infrastructure (locked in [[adr-0011-whatsapp-notifier-on-shim]])**
- The WhatsApp Notifier is a **new `POST /notify` route on the existing Cassandra write shim** — no new component. Reachable for free under the one ngrok static domain (ngrok free = 1 static domain; a second endpoint would get a rotating URL and was rejected).
- The shim's base image moves from `node:20-alpine` to **`node:20-slim` (Debian)** to host whatsapp-web.js / puppeteer / Chromium reliably (Alpine's musl breaks the bundled Chromium). Image grows to ~400 MB.
- The WhatsApp client is initialized **after** the HTTP server is listening and isolated, so a dead/unauthenticated Chromium causes `/notify` to return `503` while `/companies` keeps serving. Failure domains stay separate; the deploy domain is shared (redeploying the shim restarts the Cassandra write path).
- Authentication: the QR is rendered as ASCII via `qrcode-terminal` (visible over SSH and in `docker logs`); the whatsapp-web.js `LocalAuth` session directory is **bind-mounted to the host** so the QR is scanned exactly once and survives restarts/rebuilds.

**Wire contract (`POST /notify` on the shim)**
- Auth: `Authorization: Bearer <SHIM_BEARER_TOKEN>` — the **same token** already guarding `/companies` (same middleware).
- Content-Type `application/json`; body `{ "company": string, "role": string, "url"?: string }`.
- Responses mirror `/companies` conventions: `200 { status: "queued" }`, `401` bad/missing token, `400` bad body, `415` wrong content-type, `503 { status: "whatsapp_unavailable" }` when the client is not ready.

**Shim-side modules**
- **Message formatter** — pure `(company, role, url) → text`: the `"Hey Netali, I found new position, Here are the Details:"` template, `<Company> — <Role>` line, and the optional URL line dropped when `url` is absent. Recipient name + number hardcoded shim-side.
- **Recipient normalizer** — pure `+972 54-448-3175 → 972544483175@c.us` (strip `+`, spaces, dashes; append `@c.us`).
- **Throttled send queue** — a serialized queue with a minimum send-interval so a bulk Email Agent sync does not fire near-simultaneous messages. Every Application still gets its own paced message.
- **WhatsApp client wrapper** — hides the whatsapp-web.js lifecycle (init, QR logging, `ready`/`disconnected`/`auth_failure` state, `sendMessage`) behind a small `isReady()` / `send(text)` surface. Logs every send outcome and logs loudly on disconnect/auth_failure (v1 observability is logs-only).
- **`/notify` route handler** — auth + content-type + body validation, then enqueue; returns `503` when the client is not ready.

**JobFlow-side modules (mirror the [[company-scout|Company Scout]]'s `CompanyRegistry`)**
- A `WhatsAppNotifier` interface with two implementations and a factory:
  - `HttpShimWhatsAppNotifier` (production) — `POST {WHATSAPP_NOTIFY_URL}` with the bearer token, a 3s `AbortController` timeout, and swallows all errors (network, 4xx, 5xx) at warn level.
  - `LoggingWhatsAppNotifier` (dev fallback) — selected when `WHATSAPP_NOTIFY_URL` is unset; logs what *would* have been sent. The feature is a **no-op until configured** (local dev + tests never message anyone).
- Wired into `cardService.createCard`, fired **detached** (never awaited) next to `runCompanyCheck` — one shared call site covering both the manual and Email Agent create paths. Payload sourced from the created card: `company_name`, `role_title`, `application_url`.

**Accepted edge cases**
- **Transaction-boundary edge:** `createCard` runs inside the Email Agent's per-email transaction; the detached `/notify` can fire before commit, so a rare rollback sends Netali a message for an Application that was never saved. Accepted with a code comment — same edge as the Company Scout, with a human-visible blast radius.
- **Silent session death:** a dead WhatsApp session drops every message with no active alert in v1; detection is manual via `docker logs jf-shim`.

**Configuration**
- JobFlow (Render): new `WHATSAPP_NOTIFY_URL` (the static ngrok domain + `/notify`); reuses the existing shim bearer token value.
- Shim (box): recipient number and template hardcoded in shim code; `LocalAuth` session directory bind-mounted via `docker-compose.yml`; `qrcode-terminal` for first-run QR.

## Testing Decisions

- **No automated tests** are written for this feature (explicit user decision). The shim has no existing test harness and none is introduced; the JobFlow side adds no Jest specs.
- **Verification is via the ADR-0006 smoke-test transcript**, which is mandatory for this data-pipeline PR. The transcript must show:
  1. The existing `POST /companies` path still returns its expected results (no regression from the base-image change and shared container).
  2. A real `POST /notify` call producing a delivered WhatsApp Message to the recipient (happy path, with URL and without URL).
  3. The negative paths return correctly (`401` wrong token, `400` bad body, `415` wrong content-type, `503` when the WhatsApp client is not ready).
- **Local safety net:** the `LoggingWhatsAppNotifier` dev fallback guarantees that running JobFlow without `WHATSAPP_NOTIFY_URL` set messages no one — so manual local exercise of the create paths is safe.

## Out of Scope

- **Automated test suites** for any module (per the testing decision above).
- **Self-alert on session death** (messaging the user's own number on `disconnected`/`auth_failure`) — deferred to v2; v1 is logs-only.
- **Coalescing bursts** into a single summary message — rejected in favour of per-Application messages with a throttle.
- **Cloudflare Tunnel migration** — ngrok reuse is locked; changing tunnel providers is out of scope.
- **Configurable recipient / multiple recipients / per-source filtering** — a single hardcoded recipient on all Application creation is the v1 scope.
- **Retry / delivery guarantees** — fire-and-forget; a failed send is logged and dropped, consistent with the Company Scout.
- **Any frontend / in-app surface** — the WhatsApp Message is purely outbound and external; it produces no [[notification|Notification]] and no UI change.

## Further Notes

- **Personal-number ban risk is explicitly accepted.** whatsapp-web.js is unofficial and against WhatsApp ToS; the throttle exists to reduce burst-shaped spam signals. Risk is low for an aged, daily-used number sending occasional messages to one recipient.
- **Recommended pre-build spike (CLAUDE.md "verify external deps"):** before the full build, spend ~10 minutes proving whatsapp-web.js authenticates on the specific box (scan QR, send one test message) — this is the one runtime-unproven dependency.
- **Exact throttle interval** (min gap between sends) is to be set during implementation and tuned if bursts still trip WhatsApp heuristics.
