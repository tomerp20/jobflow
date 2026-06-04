# JobFlow Cassandra Write Shim — Operator Runbook

The shim is a small Node HTTP service that runs in a Docker container on the
Linux deploy box. It exposes one authenticated endpoint (`POST /companies`)
that JobFlow's `HttpShimCompanyRegistry` calls to register `(company, org)`
pairs into the `jobflow.companies` Cassandra table using `INSERT … IF NOT EXISTS`.

---

## Architecture

```
Render (JobFlow)
  └─ HttpShimCompanyRegistry
       └─ POST https://YOUR_NGROK_HOST/companies
            └─ ngrok edge (TLS termination, public hostname)
                 └─ ngrok agent on the box (outbound-only QUIC)
                      └─ 127.0.0.1:3333 (host) → jf-shim container :3333
                           └─ cassandra:9042 (docker network) → jf-cassandra
```

The shim container publishes its port on **127.0.0.1:3333** of the host
(not 0.0.0.0), so the only way in from outside the box is via the ngrok
tunnel. Cassandra's native port (9042) is published on the host too but
**only** because the existing pipeline workers (ingester, fetcher) reach it
that way; it is firewalled from the public internet.

**Process model:** Cassandra, Reaper, and the shim all run as Docker
containers managed by `docker compose` (see `data-pipeline/docker-compose.yml`).
A single `docker compose up -d` brings up the full data-plane stack.
ngrok runs as a native systemd service on the host.

---

## Prerequisites

- Docker + docker-compose plugin installed and `docker.service` enabled at boot
- The repo is cloned at `/home/tomer/jobflow` (adjust paths below if different)
- ngrok installed as a systemd service forwarding `localhost:3333` to a
  static `*.ngrok-free.dev` (or paid) hostname; see `data-pipeline/shim/RUNBOOK.md`
  in the deployment notes for the ngrok unit and config
- A bearer token shared with JobFlow's Render env (`COMPANY_REGISTRY_TOKEN`)

---

## Deploy steps (first-time)

### 1. Create the env file (only one secret)

```bash
cd /home/tomer/jobflow/data-pipeline/shim
cp .env.example .env
# Generate a strong token:
NEW_TOKEN=$(openssl rand -hex 32)
sed -i "s|SHIM_BEARER_TOKEN=change-me|SHIM_BEARER_TOKEN=${NEW_TOKEN}|" .env
chmod 600 .env
```

`SHIM_BEARER_TOKEN` must match `COMPANY_REGISTRY_TOKEN` in JobFlow's Render
environment variables. All other config (port, Cassandra host, DC, keyspace,
log level) is defined in `data-pipeline/docker-compose.yml` — do not duplicate
it into `.env`.

### 2. Build and bring up the shim (alongside Cassandra and Reaper)

```bash
cd /home/tomer/jobflow/data-pipeline
docker compose up -d --build shim
# Or to bring up the whole stack including any stopped Cassandra/Reaper:
# docker compose up -d --build
```

Compose will build the shim image, wait for Cassandra to be healthy
(`depends_on.condition: service_healthy`), then start the container.

### 3. Verify it is running

```bash
docker compose ps          # all containers should be 'running' / 'healthy'
docker logs jf-shim --tail 20   # expect 'cassandra connected' + 'shim listening'

# Confirm the host-side publish is bound to localhost only (not 0.0.0.0):
ss -tlnp | grep ':3333'
# expected: 127.0.0.1:3333 — NOT 0.0.0.0:3333

# Unauthenticated liveness check via ngrok (no bearer required):
curl -fsS -H 'ngrok-skip-browser-warning: 1' https://YOUR_NGROK_HOST/health
# expected: {"status":"ok"}
```

The `ngrok-skip-browser-warning` header bypasses ngrok's interstitial page,
which is the browser-warning that ngrok injects for browser-shaped User-Agents.
Bot-shaped UAs (like curl, undici, node) typically do not trigger it, but
sending the header is the bulletproof move.

---

## Environment variables

The shim's runtime config splits across **two** sources:

- **`data-pipeline/docker-compose.yml` → `shim.environment`** — non-secret,
  committed defaults (port, bind address, Cassandra host/DC/keyspace, log level).
  Override here if you need to change them.
- **`data-pipeline/shim/.env`** — the one secret (`SHIM_BEARER_TOKEN`).
  Gitignored. Lock with `chmod 600`.

| Variable | Source | Default | Description |
|---|---|---|---|
| `SHIM_PORT` | compose | `3333` | Port shim binds inside the container |
| `SHIM_BIND_ADDRESS` | compose | `0.0.0.0` | Bind address (must be 0.0.0.0 inside container so the published port is reachable) |
| `SHIM_BEARER_TOKEN` | .env | — | Shared secret; must match `COMPANY_REGISTRY_TOKEN` in Render |
| `CASSANDRA_CONTACT_POINTS` | compose | `cassandra` | Docker service name resolves over the compose network |
| `CASSANDRA_LOCAL_DC` | compose | `datacenter1` | Cassandra local datacenter name |
| `CASSANDRA_KEYSPACE` | compose | `jobflow` | Cassandra keyspace |
| `LOG_LEVEL` | compose | `info` | Pino log level |
| `NODE_ENV` | compose | `production` | Disables pino-pretty when set to `production` |

---

## Rotating the shared secret

1. Generate a new secret: `openssl rand -hex 32`
2. Update `SHIM_BEARER_TOKEN` in `/home/tomer/jobflow/data-pipeline/shim/.env`
3. Restart the shim container: `cd /home/tomer/jobflow/data-pipeline && docker compose restart shim`
4. Update `COMPANY_REGISTRY_TOKEN` in JobFlow's Render environment variables
5. Trigger a Render redeploy (env var change auto-triggers it)

Both sides must be updated atomically in terms of effect — there is a brief
window while Render is restarting where Scout writes will fail. **The Company
Scout has no retry**: per `knowledge/wiki/company-scout.md` (Surprises /
gotchas), any First Sighting that hits the shim during this window is silently
un-registered until the same Company is sighted again. For v1 the write volume
is sparse enough that this gap is acceptable; if it becomes a real problem,
the documented future fix is a manual re-trigger admin endpoint.

---

## End-to-end smoke test

Run from any machine with internet access (replace values as needed):

```bash
SHIM_URL="https://YOUR_NGROK_HOST"
TOKEN="your-bearer-token"
NGROK_HDR=(-H 'ngrok-skip-browser-warning: 1')

# ── Step 1: POST a synthetic Company ─────────────────────────────────────────
curl -s -X POST "${SHIM_URL}/companies" "${NGROK_HDR[@]}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "smoke-test-co",
    "active_orgs": [
      { "org_name": "smoke-test-org", "last_repo_push": "2026-05-24T00:00:00Z" }
    ]
  }' | jq .

# Expected response:
# { "company": "smoke-test-co", "results": [{ "org_name": "smoke-test-org", "status": "registered" }] }

# ── Step 2: Confirm row in Cassandra with initialized = false ─────────────────
# On the deploy box (note: container is jf-cassandra, not jobflow-cassandra):
docker exec -it jf-cassandra cqlsh -e \
  "SELECT company, org_name, active, initialized FROM jobflow.companies WHERE company = 'smoke-test-co';"

# ── Step 3: Re-POST same body → already_exists ───────────────────────────────
# (same curl as step 1) → status: 'already_exists'

# ── Step 4: Clean up ─────────────────────────────────────────────────────────
docker exec -it jf-cassandra cqlsh -e \
  "DELETE FROM jobflow.companies WHERE company = 'smoke-test-co' AND org_name = 'smoke-test-org';"
```

### Negative-path smoke checks

The shim should reject malformed or unauthorised requests cleanly:

```bash
# 401 — wrong token
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "${SHIM_URL}/companies" "${NGROK_HDR[@]}" \
  -H "Authorization: Bearer wrong-token" \
  -H "Content-Type: application/json" \
  -d '{"company":"x","active_orgs":[{"org_name":"y","last_repo_push":"2026-01-01T00:00:00Z"}]}'
# expected: 401

# 400 — invalid JSON body
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "${SHIM_URL}/companies" "${NGROK_HDR[@]}" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" -d 'not-json'
# expected: 400

# 400 — missing required field (last_repo_push)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "${SHIM_URL}/companies" "${NGROK_HDR[@]}" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"company":"x","active_orgs":[{"org_name":"y"}]}'
# expected: 400

# 415 — wrong Content-Type
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "${SHIM_URL}/companies" "${NGROK_HDR[@]}" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: text/plain" -d 'whatever'
# expected: 415

# 404 — unknown path OR unsupported method
# (Caddy used to return 405 specifically on wrong method against /companies;
# without Caddy the shim treats all method/path mismatches uniformly as 404.)
curl -sS -o /dev/null -w "%{http_code}\n" "${SHIM_URL}/nope" "${NGROK_HDR[@]}"
# expected: 404

curl -sS -o /dev/null -w "%{http_code}\n" -X GET "${SHIM_URL}/companies" "${NGROK_HDR[@]}"
# expected: 404 (was 405 under Caddy)
```

---

## Roll back

If the shim needs to be disabled:

```bash
cd /home/tomer/jobflow/data-pipeline
docker compose stop shim
```

To stop it from restarting on the next boot too:

```bash
docker update --restart=no jf-shim
```

JobFlow falls back to `LoggingCompanyRegistry` automatically when
`COMPANY_REGISTRY_URL` is unset or unreachable — no code change required.
Remove or clear `COMPANY_REGISTRY_URL` from Render env vars to activate the
fallback without removing the token.

---

## WhatsApp Notifier (`POST /notify`) — ADR 0011

The shim also hosts the WhatsApp Notifier: JobFlow POSTs `{ company, role, url }`
on every Application creation and the shim sends a WhatsApp Message from the
sender phone's personal account to a single hardcoded recipient (in
`lib/message.js`). It runs on the same container, port, ngrok tunnel, and bearer
token as `/companies`; a dead WhatsApp session returns `503` on `/notify` and
never affects `/companies`.

### First-time setup (one-time QR scan)

```bash
# 1. Create the host-side session directory (bind-mounted; makes the QR scan
#    survive restarts/rebuilds). uid 1000 = the container's 'node' user.
mkdir -p /home/tomer/whatsapp-session
sudo chown 1000:1000 /home/tomer/whatsapp-session

# 2. Build + start the shim (now Debian-based, with Chromium baked in).
cd /home/tomer/jobflow/data-pipeline
docker compose up -d --build shim

# 3. Watch the logs for the ASCII QR code, then scan it from the sender phone:
#    WhatsApp → Settings → Linked Devices → Link a Device.
docker logs jf-shim -f
# Expect: 'whatsapp.qr_required' followed by a QR, then 'whatsapp.authenticated'
# and 'whatsapp.ready'. The session is now saved to /home/tomer/whatsapp-session.
```

After `whatsapp.ready`, you only re-scan if the session is invalidated (logout,
phone offline > ~14 days, or a ban). Detection is manual — `docker logs jf-shim`
shows `whatsapp.disconnected` / `whatsapp.auth_failure`.

> **If you get a fresh QR on every restart**, the host session directory is not
> writable by the container's uid 1000. The `LocalAuth` session can't persist, so
> it re-authenticates each boot — easy to misread as a code bug. Fix the owner and
> verify:
> ```bash
> sudo chown -R 1000:1000 /home/tomer/whatsapp-session
> ls -ld /home/tomer/whatsapp-session   # owner column must read 1000 (or 'node')
> ```

### JobFlow (Render) config

Add one env var: `WHATSAPP_NOTIFY_URL` = the same static ngrok base URL already
used for `COMPANY_REGISTRY_URL` (no `/notify` suffix — the client appends it).
The bearer token is reused from `COMPANY_REGISTRY_TOKEN`. Leaving
`WHATSAPP_NOTIFY_URL` unset makes the feature a no-op (`LoggingWhatsAppNotifier`).

### Smoke test

Because this PR changes the shim's base image (Alpine → Debian) and the shared
container, ADR 0006 / ADR 0011 require the **same transcript** to also prove the
`/companies` Cassandra path did not regress. Run the `/companies` happy-path +
Cassandra-row check from the "End-to-end smoke test" section above **first**,
then the `/notify` checks below.

```bash
SHIM_URL="https://YOUR_NGROK_HOST"
TOKEN="your-bearer-token"
NGROK_HDR=(-H 'ngrok-skip-browser-warning: 1')

# Happy path (with URL) — recipient should receive the message.
curl -s -X POST "${SHIM_URL}/notify" "${NGROK_HDR[@]}" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"company":"Wix","role":"Senior Backend Engineer","url":"https://wix.com/careers/123"}'
# expected: {"status":"queued"}

# Happy path (no URL) — message sent without the link line.
curl -s -X POST "${SHIM_URL}/notify" "${NGROK_HDR[@]}" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"company":"Acme","role":"Platform Engineer"}'
# expected: {"status":"queued"}

# Negative paths
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "${SHIM_URL}/notify" "${NGROK_HDR[@]}" \
  -H "Authorization: Bearer wrong" -H "Content-Type: application/json" -d '{}'        # 401
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "${SHIM_URL}/notify" "${NGROK_HDR[@]}" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" -d 'nope'   # 400
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "${SHIM_URL}/notify" "${NGROK_HDR[@]}" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: text/plain" -d 'x'            # 415
# When the WhatsApp client is not ready: expect 503 {"status":"whatsapp_unavailable"}
```

> ⚠️ whatsapp-web.js is unofficial (against WhatsApp ToS); ban risk on the sender
> number is accepted. The `/notify` send queue paces messages (min 3 s apart) so a
> bulk Email Agent sync doesn't fire a spam-shaped burst.

---

## Where logs go

- Shim logs: `docker logs jf-shim -f`
- Cassandra logs: `docker logs jf-cassandra -f`
- ngrok logs (TLS termination, traffic visibility): `sudo journalctl -u ngrok -f`
- ngrok also exposes a local web UI at `http://127.0.0.1:4040` (request inspector)
