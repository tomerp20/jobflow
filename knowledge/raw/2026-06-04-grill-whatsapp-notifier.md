# Grill transcript — WhatsApp Notifier (2026-06-04)

Topic: send an outbound WhatsApp message from the user's personal account to one
recipient (Netali) whenever an Application is created, via `whatsapp-web.js` on
the Linux box, reached from JobFlow (Render) over the existing ngrok tunnel.

Pre-loaded: CONTEXT.md, wiki/company-scout.md, ADR 0010 (HTTPS shim), shim source.

## Locked decisions

1. **Auth / session** — SSH in once, scan the WhatsApp Web QR rendered as ASCII via
   `qrcode-terminal` (visible in `docker logs`). Dockerized. **`LocalAuth` session
   directory bind-mounted to the host** so the QR is scanned exactly once and
   survives restarts/rebuilds. Headless Chromium needs `--no-sandbox`.

2. **No new components — `/notify` is a route on the existing Cassandra write shim.**
   Not a separate container, not a proxy, not a second ngrok endpoint. ngrok free =
   1 static domain (3 endpoints / 20k req-mo / 1 GB-mo, verified); a 2nd endpoint
   would get a rotating URL → rejected. `/notify` reachable for free under the one
   static domain.

3. **Coupling accepted, failures isolated.** Pulling whatsapp-web.js + Chromium into
   the shim makes it a heavier, two-feature container. The WhatsApp client is
   isolated: if Chromium is dead/unauthenticated, `/notify` → 503 and `/companies`
   keeps serving. → ADR 0011.

4. **Naming.** System = **WhatsApp Notifier** (sibling of Email Agent / Company
   Scout). What it sends = **WhatsApp Message**, explicitly NOT a Notification (the
   glossary reserves Notification for the persistent in-app entity). CONTEXT.md
   updated inline.

5. **Burst handling = (b) throttle.** `/notify` serializes sends with a min interval
   so a bulk Gmail sync (N Applications back-to-back) doesn't fire a spam-shaped
   flurry. Keeps one-message-per-Application semantics.

6. **Wire contract + auth.** `POST /notify`, reuse the existing `SHIM_BEARER_TOKEN`
   (same middleware guards both routes). Body = `{ company, role, url }` only.
   `url` = the Application's `application_url` (job posting); optional.

7. **Message text** (template lives in the shim):
   ```
   Hey Netali, I found new position, Here are the Details:
   <Company> — <Role>
   <url>
   ```
   No URL → drop the link line, still send.

8. **Recipient.** Number `+972 54-448-3175` **hardcoded in the shim** (normalized to
   `972544483175@c.us`). Recipient + template live shim-side; JobFlow stays generic
   (sends only the 3 fields). Changing recipient/wording = box-side edit + restart,
   no Render redeploy.

9. **Observability = (a) logs-only** for v1. Shim logs every send outcome + loud log
   on `disconnected`/`auth_failure`. Manual detection (`docker logs jf-shim`).
   Self-alert ping deferred to v2.

10. **JobFlow wiring.** Mirror `CompanyRegistry`: `WhatsAppNotifier` interface +
    `HttpShimWhatsAppNotifier` (prod, POST to `WHATSAPP_NOTIFY_URL`, 3s
    `AbortController` timeout, swallow errors) + `LoggingWhatsAppNotifier` (dev
    fallback when URL unset → no-op locally/in tests). Fired **detached** from
    `createCard` next to `runCompanyCheck` — one shared call site (manual + Email
    Agent). **Transaction-boundary edge = (a) accept** with a comment (rare rollback
    → spurious message to Netali); same edge as the Scout.

11. **Base image = (b) `node:20-slim` (Debian).** Alpine's musl breaks puppeteer's
    bundled Chromium; Debian-slim is the supported path. Image → ~400 MB. Touches the
    container carrying the Cassandra write path → ADR 0006 smoke-test transcripts
    required (`/companies` green + `/notify` send transcript).

## Artifacts produced

- `docs/adr/0011-whatsapp-notifier-on-shim.md`
- `knowledge/wiki/whatsapp-notifier.md`
- `CONTEXT.md` — added WhatsApp Notifier + WhatsApp Message glossary entries + relationship
- `knowledge/wiki/index.md` — added system + ADR links

## Out of scope / deferred (v2)

- Self-alert ping on session death.
- Coalescing bursts into one summary message (chose per-Application + throttle instead).
- Cloudflare Tunnel migration (ngrok reuse locked).
- Throttle interval exact value — set during implementation.
