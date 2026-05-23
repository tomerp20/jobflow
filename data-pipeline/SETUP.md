# JobFlow Data-Pipeline — Operator Setup Runbook

This runbook brings a fresh Xubuntu box up to a self-running JobFlow data pipeline.
The pipeline consists of four Node binaries (Fetcher, Ingester, Hourly Orchestrator,
Backfill Orchestrator) wrapped by `bootstrap.sh`, cron, and `flock` lock coordination.

`bootstrap.sh` is idempotent — safe to re-run any time (e.g. after pulling new
schema migrations).

---

## What this runbook covers

- Manual prerequisites the Operator must do once per box (mounting the HDD,
  installing Node / Docker / `cqlsh`).
- Cloning the repo and per-machine config.
- Running `bootstrap.sh` to wire up Cassandra, schemas, log directories,
  and the cron schedule.
- Verifying everything came up correctly.

## What this runbook does NOT cover

- **Formatting the HDD or mounting it at `/mnt/hdd`** — done by the Operator before
  `bootstrap.sh` runs. `bootstrap.sh` verifies the mount point exists but does not
  create it.
- **Installing Node ≥ 20.6, Docker (with the `docker compose` plugin), or `cqlsh`** —
  installed via the OS package manager. `bootstrap.sh` checks they are on `PATH`
  but does not install them.
- **Creating the Operator user account.** Bootstrap runs as whoever invokes it.
- **Log rotation, monitoring, alerting.** Out of scope for v1.

> **Single-tenant assumption.** The locks live in world-writable `/var/lock/`. The
> design assumes one operator user on the box. If you ever add another local user,
> they could pre-create `/var/lock/jobflow-{backfill,hourly}.lock` and starve the
> pipeline (it would skip silently). Move locks to a private path (e.g.
> `/run/lock/<user>/`) if you violate this assumption.

---

## Step 1 — Manual prerequisites (one-time, per box)

### 1.1 Format and mount the HDD at `/mnt/hdd`

The Fetcher writes GH Archive `.json.gz` files to `/mnt/hdd/gharchive/`. This must
be the spinning HDD, not the SSD. Whatever filesystem you pick, ensure it is
mounted at `/mnt/hdd` and the mount survives reboot (`/etc/fstab` entry).

Verify with:

```bash
mountpoint /mnt/hdd
```

If the command prints `/mnt/hdd is a mountpoint`, you are good. If it says
`is not a mountpoint`, `bootstrap.sh` will refuse to run.

### 1.2 Install Node ≥ 20.6

The orchestrators and fetcher require `node` 20.6 or newer (for stable
`fetch`, `node:test`, and ESM-by-default).

```bash
# Example using nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
nvm use 20
node --version    # → v20.x.x
```

### 1.3 Install Docker and the `docker compose` plugin

Cassandra runs in a container managed by `data-pipeline/docker-compose.yml`.

```bash
# Standard Docker install:
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin

# Give your user permission to talk to the docker socket (log out and back in after):
sudo usermod -aG docker "$USER"

docker compose version    # confirms the plugin is installed
```

### 1.4 Install `cqlsh`

Used by `bootstrap.sh` to wait for Cassandra and apply schema migrations.

```bash
# Recent Ubuntu (22.04+) marks the system Python as PEP 668 "externally managed",
# which makes a plain `pip3 install cqlsh` fail. Use pipx for an isolated install:
sudo apt-get install -y pipx
pipx ensurepath          # adds ~/.local/bin to PATH (re-login or `source ~/.profile` after)
pipx install cqlsh
cqlsh --version
```

> If you prefer not to use `pipx`, the Cassandra Debian repo ships `cqlsh` inside the
> `cassandra-tools` package — but installing that pulls in the Cassandra server too.
> `pipx` is the minimal-footprint option.

### 1.5 Clone the repo

```bash
git clone https://github.com/tomerp20/jobflow.git
cd jobflow
```

The data-pipeline lives at `data-pipeline/`. The remainder of this guide assumes
your shell's working directory is the repo root.

### 1.6 Install Node dependencies

```bash
( cd data-pipeline/fetcher       && npm install --omit=dev )
( cd data-pipeline/ingester      && npm install --omit=dev )
( cd data-pipeline/orchestrators && npm install --omit=dev )
```

### 1.7 Create a per-machine `.env` (optional but recommended)

The cron-fired shell scripts source `data-pipeline/.env` if it exists. Use it to
set Cassandra contact points, `GHARCHIVE_DIR`, etc. Without it, the Node binaries
will read from the process environment only.

```bash
cat > data-pipeline/.env <<'EOF'
CASSANDRA_CONTACT_POINTS=127.0.0.1
CASSANDRA_LOCAL_DC=datacenter1
CASSANDRA_KEYSPACE=jobflow
GHARCHIVE_DIR=/mnt/hdd/gharchive
LOG_LEVEL=info
NODE_ENV=production
EOF
```

Per-binary `.env.example` files live under `data-pipeline/{fetcher,ingester,orchestrators}/`
for reference. The single `data-pipeline/.env` above is the one the cron scripts read.

#### Backfill date-range overrides

`run-backfill.sh` accepts two optional env vars that control the date range
passed to the Fetcher and Backfill Orchestrator:

| Var | Default | Meaning |
|-----|---------|---------|
| `BACKFILL_START_DATE` | `$(date -u -d '1 year ago' +%Y-%m-%d)` | Inclusive start of the range. |
| `END_DATE` | `$(date -u -d 'yesterday' +%Y-%m-%d)` | Inclusive end of the range. |

Both can be overridden in three places (later wins):

1. The cron line or operator shell (e.g. `BACKFILL_START_DATE=2026-01-01 ./data-pipeline/scripts/run-backfill.sh`).
2. The persistent `data-pipeline/.env` file (sourced after the defaults are set).
3. A one-off invocation that exports the var before calling the script.

The 1-year default matches the plan's stated yearly-coverage goal. Add a line
like `BACKFILL_START_DATE=2024-01-01` to `data-pipeline/.env` for a persistent
custom backfill window.

---

## Step 2 — Run `bootstrap.sh`

```bash
data-pipeline/scripts/bootstrap.sh
```

What it does:

1. Verifies `node` (≥ 20.6), `docker compose`, and `cqlsh` are on `PATH`.
2. Verifies `/mnt/hdd` is a real mount point (not just a directory).
3. Creates `/mnt/hdd/gharchive/` and `~/jobflow-logs/`.
4. Brings up the Cassandra container via `docker compose up -d cassandra`
   and polls `cqlsh` until it responds (up to 5 minutes).
5. Applies every `.cql` file under `data-pipeline/schema/` in numeric order.
   Tolerates "already exists" errors so re-runs are safe.
6. Substitutes `@JOBFLOW_ROOT@` and `@USER@` in `cron/jobflow.cron.template` and
   installs the result at `/etc/cron.d/jobflow` (this is the **only** step that
   uses `sudo`).
7. Prints a summary plus verification commands.

If any step fails, the script exits non-zero with a `FATAL:` line on stderr.

---

## Step 3 — Verify the install

```bash
# Cron file installed with paths substituted:
sudo cat /etc/cron.d/jobflow
grep -E 'run-(backfill|hourly)\.sh' /etc/cron.d/jobflow   # should print both lines

# Cron daemon running:
sudo systemctl status cron

# Cassandra keyspace and tables in place:
cqlsh -e "DESCRIBE KEYSPACE jobflow"

# Disk mount and log directory:
mountpoint /mnt/hdd
ls -la ~/jobflow-logs/

# Tail logs once the first cron interval has fired:
tail -F ~/jobflow-logs/hourly.log
tail -F ~/jobflow-logs/backfill.log
tail -F ~/jobflow-logs/hourly-skips.log
```

---

## Day-to-day operation

After bootstrap, the pipeline runs itself. Cron fires:

- **Backfill** — every night at 00:00. Holds
  `/var/lock/jobflow-backfill.lock` for the whole run. Logs to
  `~/jobflow-logs/backfill.log`.
- **Hourly** — every hour at :15. Holds
  `/var/lock/jobflow-hourly.lock`, and checks the backfill lock; if backfill is
  running, this hour is skipped and the skip is logged to
  `~/jobflow-logs/hourly-skips.log`. The Ingester's `--catchup` mode handles the
  resulting backlog on the next successful hourly invocation. Logs to
  `~/jobflow-logs/hourly.log`.

If a cron interval skips because the disk is below the safety threshold (50 GB
free for backfill, 10 GB for hourly), the FATAL message is in the corresponding
log file. The next interval tries again.

### Manual invocation (testing)

You can run either entry-point script directly to see output on the terminal:

```bash
data-pipeline/scripts/run-hourly.sh
data-pipeline/scripts/run-backfill.sh
```

These scripts know nothing about log paths — that's the cron line's responsibility —
so direct invocation prints to stdout/stderr as normal.

### Re-running `bootstrap.sh`

Re-running `bootstrap.sh` is safe. Use it to:

- Apply newly-added schema migrations after pulling a new repo state.
- Re-install the cron file after editing `cron/jobflow.cron.template`.
- Recover from a partial setup that failed midway.

---

## Files

| File | Purpose |
|------|---------|
| `data-pipeline/scripts/bootstrap.sh` | One-time idempotent setup. |
| `data-pipeline/scripts/run-backfill.sh` | Backfill cron entry point. |
| `data-pipeline/scripts/run-hourly.sh` | Hourly cron entry point. |
| `data-pipeline/cron/jobflow.cron.template` | Cron schedule with placeholders. |
| `data-pipeline/schema/*.cql` | Cassandra schema migrations applied by bootstrap. |
| `/etc/cron.d/jobflow` | Installed (not committed) — substituted output of the template. |
| `~/jobflow-logs/` | Append-forever logs (`backfill.log`, `hourly.log`, `hourly-skips.log`). |
| `/var/lock/jobflow-backfill.lock` | Backfill cron lock. |
| `/var/lock/jobflow-hourly.lock` | Hourly cron lock. |
| `/mnt/hdd/gharchive/` | GH Archive `.json.gz` files written by the Fetcher. |
