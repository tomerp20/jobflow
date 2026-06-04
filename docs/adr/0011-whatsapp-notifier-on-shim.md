# ADR 0011 — The WhatsApp Notifier lives as a route on the Cassandra write shim, not as its own component

**Status:** Accepted
**Date:** 2026-06-04

## Context

We want an outbound WhatsApp message sent to a single personal recipient (Netali, hardcoded) whenever an **Application** is created — see `/CONTEXT.md` → **WhatsApp Notifier**, `knowledge/wiki/whatsapp-notifier.md`. The sender is the user's personal WhatsApp account, driven by `whatsapp-web.js` (free, unofficial, drives a headless Chromium via puppeteer; personal-number ban risk explicitly accepted).

The network topology is identical to the Company Scout's (ADR 0010): **JobFlow runs on Render (public cloud)** and must reach a service on the **Xubuntu box at `tomer@192.168.10.12` (home LAN)**. That bridge already exists — a single `ngrok` systemd agent forwards `localhost:3333` → one static `*.ngrok-free.dev` hostname, in front of the Cassandra write shim.

Constraints surfaced during the grill (2026-06-04):

- **ngrok free = exactly 1 static domain** (3 concurrent endpoints / 20k req-mo / 1 GB-mo). A second endpoint would get a *rotating* `*.ngrok-free.app` URL, breaking JobFlow's `WHATSAPP_NOTIFY_URL` on every box restart.
- The user's explicit directive: **no new components in the system** — reuse the existing shim, the existing ngrok tunnel.
- The send path must never block Application creation, and must never take down the Company Scout's Cassandra write path.

## Decision

The WhatsApp Notifier is a **new `POST /notify` route on the existing Cassandra write shim** (`data-pipeline/shim/`). No new container, no reverse proxy, no second ngrok endpoint. Because ngrok already forwards the whole static domain to `localhost:3333`, `/notify` is reachable for free the moment the route exists — both `/companies` and `/notify` live under the one static domain.

**Wire contract** (mirrors `/companies` conventions):

```
POST /notify
Authorization: Bearer <SHIM_BEARER_TOKEN>   # same token guards both routes
Content-Type: application/json

{ "company": "Wix", "role": "Senior Backend Engineer", "url": "https://wix.com/careers/12345" }

→ 200 { "status": "queued" }
→ 401 bad/missing token · 400 bad body · 415 wrong content-type
→ 503 { "status": "whatsapp_unavailable" }   # Chromium dead/unauthenticated
```

- **JobFlow stays generic** — it posts only `{ company, role, url }`. The **recipient number (`+972 54-448-3175`) and the message template ("Hey Netali, I found new position…") are hardcoded in the shim.** Changing recipient/wording is a box-side edit + container restart; no Render redeploy.
- **`url` is optional** — when the Application has no `application_url`, the shim drops the link line and still sends company + role.
- **Throttle:** `/notify` enqueues into a serialized queue with a min send-interval, so a bulk Gmail sync that creates N Applications doesn't fire N near-simultaneous messages (a WhatsApp spam-flag pattern).
- **Isolation:** the `whatsapp-web.js` client is initialized in its own guarded scope *after* the HTTP server is listening; if Chromium is dead/unauthenticated, `/notify` returns 503 and **`/companies` keeps serving**. A Chromium crash degrades `/notify` only.
- **Base image:** the shim moves from `node:20-alpine` to **`node:20-slim` (Debian)** — the supported puppeteer/Chromium path. `cassandra-driver` + `pino` run identically on Debian. Image grows to ~400 MB (inherent to bundling Chromium).
- **Auth:** first run renders the WhatsApp Web QR as ASCII via `qrcode-terminal` (visible over SSH / in `docker logs`); the `LocalAuth` session directory is **bind-mounted to the host** so the QR is scanned exactly once and survives restarts/rebuilds.
- **Observability (v1):** logs only. The shim logs every send outcome and logs loudly on `disconnected`/`auth_failure`. Detection of a dead session is manual (`docker logs jf-shim`) — consistent with the Company Scout's no-alerting posture.

JobFlow's side mirrors `CompanyRegistry` exactly: a `WhatsAppNotifier` interface with `HttpShimWhatsAppNotifier` (production, POSTs to `WHATSAPP_NOTIFY_URL` with a 3s `AbortController` timeout, swallows all errors) and `LoggingWhatsAppNotifier` (dev fallback when `WHATSAPP_NOTIFY_URL` is unset → feature is a no-op locally and in tests). Fired **detached** from inside `cardService.createCard`, next to `runCompanyCheck` — one shared call site covering both the manual and Email Agent create paths.

## Consequences

- **No new infrastructure.** Zero new containers, no proxy, no second tunnel, well within ngrok-free limits (a few sends/day vs 20k req/mo).
- **The shim is no longer "tiny," and two unrelated features share one container.** A future reader will be surprised to find `whatsapp-web.js` + Chromium inside a service named "Cassandra write shim" — this ADR is that explanation. The isolation guard keeps the *failure* domains separate (a Chromium crash can't sink `/companies`), but the *deploy* domain is now shared: redeploying the shim restarts the Cassandra write path too.
- **The base-image change touches a working production container.** ADR 0006 (smoke-test transcripts required for data-pipeline PRs) applies: the PR must show `/companies` still green *and* a `/notify` send transcript.
- **The transaction-boundary edge is accepted.** `createCard` runs inside gmailSync's per-email transaction; the detached `/notify` can fire before commit, so a (rare) rollback means Netali receives a message for an Application that was never saved. Carries a code comment; same accepted edge as the Scout (ADR 0010 / `company-scout.md`), but with a human-visible blast radius rather than an invisible Cassandra row.
- **Silent-failure gap.** A dead WhatsApp session drops every message with no active alert in v1; the documented future fix is a self-alert ping (message the user's own number on `disconnected`/`auth_failure`).

## Alternatives considered

- **Separate `jf-whatsapp` container + a path-routing reverse proxy** under the one static domain (`/companies`→shim, `/notify`→whatsapp). Clean separation of concerns and failure domains; but re-introduces a proxy component and a second container. **Rejected** — the user explicitly wanted no new components, and the isolation guard recovers most of the failure-domain benefit.
- **Second ngrok endpoint for the WhatsApp service.** Allowed by the 3-endpoint free limit, but only one *static* domain exists on free; the second endpoint's URL rotates on every restart, silently breaking `WHATSAPP_NOTIFY_URL`. **Rejected** as brittle.
- **Switch the box to Cloudflare Tunnel** (free, unlimited stable named hostnames → trivial second hostname). A real, free, stable option; **rejected** for v1 because ngrok reuse was locked and changing the tunnel provider is out of scope.
- **Stay on `node:20-alpine` with Alpine's chromium apk.** Keeps the lean base, but Alpine's Chromium is the quirkier, less-trodden puppeteer path (version lag, crashes). **Rejected** in favour of the boring Debian-slim path.

## See also

- `knowledge/wiki/whatsapp-notifier.md` — full system context
- ADR 0010 — Company Scout's HTTPS-shim write path (the pattern this mirrors and the shim it extends)
- ADR 0006 — smoke-test transcripts required for data-pipeline changes
- `/CONTEXT.md` → **WhatsApp Notifier**, **WhatsApp Message**
