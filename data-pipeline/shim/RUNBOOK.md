# JobFlow Cassandra Write Shim — Operator Runbook

The shim is a small Node HTTP service running on the Xubuntu box at
`tomer@192.168.10.12`. It exposes one authenticated endpoint (`POST /companies`)
that JobFlow's `HttpShimCompanyRegistry` calls to register `(company, org)` pairs
into the `jobflow.companies` Cassandra table using `INSERT … IF NOT EXISTS`.

---

## Architecture

```
Render (JobFlow)
  └─ HttpShimCompanyRegistry
       └─ POST https://YOUR_DOMAIN/companies
            └─ Caddy (TLS termination, Let's Encrypt)
                 └─ 127.0.0.1:3100 ← shim.js (systemd: jobflow-shim)
                      └─ 127.0.0.1:9042 ← Cassandra (Docker)
```

Cassandra's native port (9042) is never reachable from outside the box.

**Process model:** Cassandra runs as a Docker container managed by `docker compose`
(see `data-pipeline/SETUP.md`); the shim runs as a *native* systemd service
(`jobflow-shim`), not in a container. Both processes are local to this box and
communicate over `127.0.0.1` — no container/host networking concerns.

---

## Deploy steps (first-time)

### 1. Prerequisites

- Node ≥ 20.6 on PATH
- Cassandra running via `docker compose` (see `data-pipeline/SETUP.md`)
- A public hostname with a DNS A record pointing to the box's WAN IP
  (the Caddy block in `deploy/Caddyfile` must match this hostname)
- Port 443 open on the router/firewall; port 3100 is NOT forwarded externally

### 2. Install Node dependencies

```bash
cd /opt/jobflow/data-pipeline/shim
npm install --omit=dev
```

### 3. Create the env file

```bash
cp /opt/jobflow/data-pipeline/shim/.env.example /opt/jobflow/data-pipeline/shim/.env
# Edit .env: set SHIM_BEARER_TOKEN and verify Cassandra vars
nano /opt/jobflow/data-pipeline/shim/.env

# Lock the env file — it contains SHIM_BEARER_TOKEN.
sudo chown tomer:tomer /opt/jobflow/data-pipeline/shim/.env
chmod 600 /opt/jobflow/data-pipeline/shim/.env
```

Generate a strong token: `openssl rand -hex 32`.

`SHIM_BEARER_TOKEN` must match `COMPANY_REGISTRY_TOKEN` in JobFlow's Render
environment variables.

### 4. Install and start the systemd unit

```bash
sudo cp /opt/jobflow/data-pipeline/shim/deploy/jobflow-shim.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jobflow-shim
sudo systemctl status jobflow-shim   # should show "Active: active (running)"
```

### 5. Install Caddy (if not already present)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

### 6. Install the Caddyfile

```bash
# Replace YOUR_DOMAIN with the real hostname in the file first
sudo cp /opt/jobflow/data-pipeline/shim/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will provision a Let's Encrypt cert automatically on first request (or
at reload time). Check: `sudo journalctl -u caddy -n 30`.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SHIM_PORT` | no | `3100` | Port shim binds on localhost |
| `SHIM_BEARER_TOKEN` | **yes** | — | Shared secret; must match `COMPANY_REGISTRY_TOKEN` in Render |
| `CASSANDRA_CONTACT_POINTS` | **yes** | — | Comma-separated host list (e.g. `127.0.0.1`) |
| `CASSANDRA_LOCAL_DC` | **yes** | — | Cassandra local datacenter name (e.g. `datacenter1`) |
| `CASSANDRA_KEYSPACE` | no | `jobflow` | Cassandra keyspace |
| `LOG_LEVEL` | no | `info` | Pino log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |
| `NODE_ENV` | no | — | Set to `production` to disable pino-pretty |

---

## Rotating the shared secret

1. Generate a new secret: `openssl rand -hex 32`
2. Update `SHIM_BEARER_TOKEN` in `/opt/jobflow/data-pipeline/shim/.env`
3. Restart the shim: `sudo systemctl restart jobflow-shim`
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

## Verify it is running

```bash
# Service status
sudo systemctl status jobflow-shim

# Tail live logs
sudo journalctl -u jobflow-shim -f

# Confirm it is bound on localhost only
ss -tlnp | grep 3100
# expected: 127.0.0.1:3100 — NOT 0.0.0.0:3100

# Unauthenticated liveness check via Caddy (no bearer required)
curl -fsS https://YOUR_DOMAIN/health
# expected: {"status":"ok"}
```

---

## End-to-end smoke test

Run from any machine with internet access (replace values as needed):

```bash
SHIM_URL="https://YOUR_DOMAIN"
TOKEN="your-bearer-token"

# ── Step 1: POST a synthetic Company ─────────────────────────────────────────
curl -s -X POST "${SHIM_URL}/companies" \
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
# On the Xubuntu box:
docker exec -it jobflow-cassandra cqlsh -e \
  "SELECT company, org_name, active, initialized FROM jobflow.companies WHERE company = 'smoke-test-co';"

# Expected output:
#  company       | org_name        | active | initialized
# ---------------+-----------------+--------+-------------
#  smoke-test-co | smoke-test-org  |   True |       False

# ── Step 3: Re-POST the same body → should return already_exists ─────────────
curl -s -X POST "${SHIM_URL}/companies" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "smoke-test-co",
    "active_orgs": [
      { "org_name": "smoke-test-org", "last_repo_push": "2026-05-24T00:00:00Z" }
    ]
  }' | jq .

# Expected response:
# { "company": "smoke-test-co", "results": [{ "org_name": "smoke-test-org", "status": "already_exists" }] }

# ── Step 4: Confirm row is unchanged (initialized still false, not regressed) ─
docker exec -it jobflow-cassandra cqlsh -e \
  "SELECT company, org_name, active, initialized FROM jobflow.companies WHERE company = 'smoke-test-co';"

# ── Step 5: Clean up the test row ────────────────────────────────────────────
docker exec -it jobflow-cassandra cqlsh -e \
  "DELETE FROM jobflow.companies WHERE company = 'smoke-test-co' AND org_name = 'smoke-test-org';"
```

### Negative-path smoke checks

The shim should reject malformed or unauthorised requests cleanly. Run these
once after a fresh deploy to confirm the auth, validation, and method-routing
paths all behave:

```bash
# 401 — wrong token
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "${SHIM_URL}/companies" \
  -H "Authorization: Bearer wrong-token" \
  -H "Content-Type: application/json" \
  -d '{"company":"x","active_orgs":[{"org_name":"y","last_repo_push":"2026-01-01T00:00:00Z"}]}'
# expected: 401

# 400 — invalid JSON body
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "${SHIM_URL}/companies" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d 'not-json'
# expected: 400

# 400 — missing required field (last_repo_push)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "${SHIM_URL}/companies" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"company":"x","active_orgs":[{"org_name":"y"}]}'
# expected: 400

# 415 — wrong Content-Type
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "${SHIM_URL}/companies" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: text/plain" \
  -d 'whatever'
# expected: 415

# 405 — wrong method on /companies (Caddy rejects before reaching shim)
curl -sS -o /dev/null -w "%{http_code}\n" -X GET "${SHIM_URL}/companies" \
  -H "Authorization: Bearer ${TOKEN}"
# expected: 405

# 404 — unknown path
curl -sS -o /dev/null -w "%{http_code}\n" "${SHIM_URL}/nope"
# expected: 404
```

---

## Roll back

If the shim needs to be disabled:

```bash
sudo systemctl stop jobflow-shim
sudo systemctl disable jobflow-shim
```

JobFlow falls back to `LoggingCompanyRegistry` automatically when
`COMPANY_REGISTRY_URL` is unset or unreachable — no code change required.
Remove or clear `COMPANY_REGISTRY_URL` from Render env vars to activate the
fallback without removing the token.

---

## Where logs go

- Shim process logs: `sudo journalctl -u jobflow-shim`
- Caddy access + TLS logs: `sudo journalctl -u caddy`
- To persist logs to a file, add `StandardOutput=append:/home/tomer/jobflow-logs/shim.log`
  to the `[Service]` block in `jobflow-shim.service` and reload systemd.
