# JobFlow Analytics — System Design (v2)

**Status:** Final design, ready for implementation
**Author:** Tomer
**Last updated:** 2026-05-22
**Supersedes:** v1 blueprint (pre-review)

---

## 1. Goal & Scope

Build a local analytics system that ingests GitHub Archive event streams, filters them to a small set of target companies, and produces a continuously updated technical profile of each company (tech stack signals, human-vs-AI commit activity, repo velocity).

The project has two equally weighted goals:

1. **A working tool** for interview research and portfolio demonstration.
2. **A deep-learning vehicle** for Cassandra data modeling, stream ingestion patterns, and hybrid local/cloud AI orchestration.

The dual goal shapes several decisions: we accept some over-engineering (Cassandra instead of Postgres) because the modeling exercise is part of the value, but we cut anything that's pure cargo culting (the embeddings pipeline with no consumer, the chaos lab oversold as resiliency validation).

### Non-goals

- Production resiliency. The single-machine deployment can demonstrate Cassandra failure semantics but cannot validate them. The RFC marks this explicitly where relevant.
- Real-time ingestion. GH Archive publishes hourly batches; the pipeline is batch-oriented, not stream-oriented.
- Comprehensive company coverage. Five target companies in v1. Expansion is a future concern.
- Authentication, multi-user, hosting. Local single-user only.

---

## 2. Hardware & OS Environment

| Component | Spec | Role |
|---|---|---|
| CPU | Intel i9-9900K, 8C/16T | Ingestion, Cassandra JVM, host |
| RAM | 16 GB DDR4 | Hard ceiling, drives many design choices |
| Storage 1 | 480 GB SATA SSD | OS + Cassandra data directory |
| Storage 2 | 2 TB HDD | Backups, GH Archive raw files, snapshots — **never** Cassandra data |
| GPU | NVIDIA GTX 1660 Ti, 6 GB VRAM | Local LLM (summarization tier only) |
| OS | Xubuntu 24.04 LTS | Lean desktop, minimal RAM overhead |
| Dev workflow | SSH from MacBook → Xubuntu host | Claude Code runs on the Linux box via VS Code Remote-SSH |

**Key environment decisions:**

- Cassandra data goes on the SATA SSD. Compaction is random I/O, and an HDD's ~100 IOPS will starve the compaction subsystem under any sustained load.
- GH Archive raw `.json.gz` files (large, append-only, read sequentially once) go on the HDD. This is the only workload that genuinely fits an HDD's strengths.
- Development happens on the MacBook; the Xubuntu box is treated as a remote server, never a workstation.

---

## 3. Architecture Overview

```
                          ┌──────────────────────────┐
                          │   GH Archive (hourly     │
                          │   .json.gz files, HDD)   │
                          └────────────┬─────────────┘
                                       │
                                       ▼
                          ┌──────────────────────────┐
                          │  Node.js Ingestion       │
                          │  - gzip stream decoder   │
                          │  - structural filter     │
                          │  - org filter            │
                          │  - commit-msg regex      │
                          │  - p-limit(50) pool      │
                          └────────────┬─────────────┘
                                       │
                                       ▼
                          ┌──────────────────────────┐
                          │  Cassandra 4.1 (SSD)     │
                          │  Single node, 4G heap    │
                          │  + Reaper UI :8080       │
                          └────────────┬─────────────┘
                                       │
                  ┌────────────────────┼────────────────────┐
                  ▼                    ▼                    ▼
        ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐
        │ GitHub REST API │  │ Local LLM tier   │  │ Read/aggregation │
        │ (enrichment job)│  │ (Qwen2.5-Coder)  │  │ for UI / reports │
        │ Authenticated   │  │ summarization    │  │                  │
        │ 15k req/hr      │  │ only, nightly    │  │                  │
        └─────────────────┘  └──────────────────┘  └──────────────────┘
                                       │
                                       ▼
                            Strategic orchestration:
                            Claude Sonnet 4.5 API
                            (when needed, not always)
```

**Three independent processes, never co-resident under load:**

1. **Ingestion** (Node.js + Cassandra). Daytime / on-demand.
2. **Enrichment** (GitHub API → Cassandra). Runs after ingestion completes.
3. **Local LLM analysis** (Ollama + Qwen2.5-Coder). Nightly, after ingestion + enrichment are done.

This time-slicing is the answer to the 16 GB RAM constraint. Trying to run all three simultaneously would mean ~17 GB of concurrent demand against 16 GB of physical RAM.

---

## 4. Data Model

### 4.1 Keyspace

```sql
CREATE KEYSPACE jobflow
WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
```

Single-node, RF=1. The 3-node experiment in §8 is a separate transient setup, not the production schema target.

### 4.2 Table: `company_events`

The single source of truth for all filtered GitHub events. Replaces both the original `company_tech_events` table and the discarded counter table.

```sql
CREATE TABLE jobflow.company_events (
    company        text,
    year_month     text,        -- partition bucket, e.g. '2026-05'
    event_time     timestamp,
    event_id       text,        -- GitHub's event UUID
    event_type     text,        -- 'PushEvent' | 'PullRequestReviewCommentEvent' | ...
    repo_name      text,
    actor_login    text,
    is_ai          boolean,     -- bot or AI-tool authored
    tech_tags      set<text>,   -- extracted from commit messages
    PRIMARY KEY ((company, year_month), event_time, event_id)
) WITH CLUSTERING ORDER BY (event_time DESC, event_id ASC);
```

**Design rationale:**

- **Composite partition key `(company, year_month)`** bounds partition size. A single active company over a single month is well under the 100 MB / 100k row Cassandra soft limit. Without time-bucketing, a Wix partition grows unbounded and eventually destroys read latency.
- **`event_id` in the clustering key** prevents silent overwrites when two events share a second-resolution timestamp. This is the most common Cassandra modeling mistake and silently drops 1–5% of rows.
- **`is_ai` as a boolean column** replaces the original counter table. Idempotent: re-ingesting the same event twice produces an UPSERT with identical contents, not a doubled count. Aggregation happens at read time.
- **`tech_tags` as a set** rather than a join table — leverages C*'s collection type, no JOIN needed.

### 4.3 Table: `processed_files`

Tracks which GH Archive files have been ingested, to make the pipeline idempotent across re-runs.

```sql
CREATE TABLE jobflow.processed_files (
    file_name      text PRIMARY KEY,
    processed_at   timestamp,
    event_count    int,
    filtered_count int
);
```

The `file_name` column stores the canonical hour ID `YYYY-MM-DD-H` (hour unpadded — `2025-05-01-15`, not `15.json.gz` or a full filesystem path). This matches GH Archive's URL convention and decouples the table from the on-disk layout. `event_count` is the total number of events parsed from the file; `filtered_count` is the subset that survived company-filtering and was written to `company_events`. Row existence implies successful processing — there is no status column.

The ingestion script checks this table before processing each file. Re-running the pipeline on already-processed files becomes a no-op. Without this, re-runs during development produce duplicate rows in `company_events` (harmless thanks to the schema, but pollutes counts and wastes time).

### 4.4 Table: `companies`

Holds the Company → Org mapping produced by the Company Scout. The Scout writes one row per (Company, Org) pair — a single Company may legitimately own multiple Orgs (e.g. Wix → `wix`, `wix-incubator`), so the table is keyed on a composite primary key. The ingestion pipeline reads this table to know which Orgs to filter for. PR1 of the ingestion subsystem adds `initialized boolean` and `initialized_at timestamp` columns — flipped to `true` per row by the Backfill once that (Company, Org) row's events are fully ingested. The Hourly Ingest filters on `initialized = true`; the Backfill filters on `initialized = false`.

```sql
CREATE TABLE jobflow.companies (
    company         text,
    org_name        text,
    added_at        timestamp,
    active          boolean,
    initialized     boolean,         -- added in PR1; true once Backfill has run for this row
    initialized_at  timestamp,       -- added in PR1; when initialized flipped to true
    PRIMARY KEY ((company), org_name)
);
```

Rows are written by the Company Scout when a Company is first sighted in the JobFlow web app — one INSERT per resolved Org, each with `initialized = false`. Example written by the Scout for a newly sighted Wix:

```sql
INSERT INTO jobflow.companies (company, org_name, added_at, active, initialized) VALUES ('wix', 'wix', toTimestamp(now()), true, false);
INSERT INTO jobflow.companies (company, org_name, added_at, active, initialized) VALUES ('wix', 'wix-incubator', toTimestamp(now()), true, false);
```

The ingestion script loads this map at startup into an in-memory `Map<org, company>` for O(1) filtering, filtered by the row's `initialized` flag depending on whether it is running in Hourly Ingest or Backfill mode. The Hourly Ingest picks up a (Company, Org) row only after the Backfill has flipped its `initialized` flag to `true`.

### 4.5 Read-side queries (for reference)

```sql
-- Latest 100 events for Wix in current month
SELECT * FROM company_events
WHERE company = 'wix' AND year_month = '2026-05'
LIMIT 100;

-- AI/human ratio for last 30 days (client-side aggregation)
SELECT is_ai, count(*) FROM company_events
WHERE company = 'wix' AND year_month IN ('2026-04', '2026-05')
  AND event_time > '2026-04-22'
GROUP BY (company, year_month), event_time, event_id;
-- Then sum is_ai=true / total in the application code.
```

The cross-month read requires querying two partitions and merging. The application code handles this; it's ~10 extra lines for unbounded scalability.

---

## 5. Ingestion Pipeline

### 5.1 Pipeline flow

```
gh-archive .json.gz file
    → zlib.createGunzip()
    → readline (line-by-line)
    → JSON.parse
    → filter: event type ∈ {PushEvent, PullRequestReviewCommentEvent}
    → filter: org ∈ companies (in-memory lookup)
    → extract: timestamp, year_month, is_ai signal
    → extract: tech tags from commit messages (regex)
    → p-limit(50) → Cassandra INSERT
    → on file completion: mark in processed_files
```

### 5.2 Concurrency model

The v1 code used `for await` with `await Promise.all(...)` inside, which serializes ingestion to ~200–500 events/sec. The fix is a bounded concurrency pool:

```javascript
const limit = pLimit(50);
const inflight = [];

for await (const rawLine of lineReader) {
  const event = parseAndFilter(rawLine);
  if (!event) continue;

  inflight.push(limit(() => writeEvent(event)));

  // Drain when the queue gets large to avoid unbounded memory growth
  if (inflight.length >= 10000) {
    await Promise.all(inflight.splice(0, 5000));
  }
}

await Promise.all(inflight);
```

Target throughput: 5,000–10,000 events/sec sustained against the single Cassandra node. An hourly GH Archive file (~2–4M events) processes in 5–15 minutes instead of 2–4 hours.

### 5.3 Tech tag extraction

GH Archive `PushEvent` payloads contain `commits[].message` but **not file paths**. Tag extraction therefore runs against commit messages only:

```javascript
const TECH_KEYWORDS = {
  typescript: /\b(typescript|tsx?)\b/i,
  react:      /\b(react|jsx)\b/i,
  nextjs:     /\b(next\.?js|nextjs)\b/i,
  kubernetes: /\b(k8s|kubernetes)\b/i,
  docker:     /\b(docker|dockerfile)\b/i,
  python:     /\b(python|py)\b/i,
  go:         /\b(golang|go-lang)\b/i,
  rust:       /\b(rust)\b/i,
};

function extractTags(event) {
  const text = (event.payload.commits || [])
    .map(c => c.message)
    .join(' ');
  const tags = new Set();
  for (const [tag, re] of Object.entries(TECH_KEYWORDS)) {
    if (re.test(text)) tags.add(tag);
  }
  return tags;
}
```

This catches developers who write conventional commits like `feat(typescript): add user types`. Recall is moderate. A secondary enrichment job (§6) raises recall significantly.

### 5.4 AI-event detection

```javascript
const AI_LOGIN_PATTERNS = /\b(copilot|claude|codex|aider|cursor|devin|bot)\b/i;
const AI_MESSAGE_PATTERNS = /\b(generated by claude|co-authored-by: claude|claude code)\b/i;

function isAiEvent(event) {
  if (event.actor.type === 'Bot') return true;
  if (AI_LOGIN_PATTERNS.test(event.actor.login)) return true;
  const messages = (event.payload.commits || [])
    .map(c => c.message)
    .join(' ');
  if (AI_MESSAGE_PATTERNS.test(messages)) return true;
  return false;
}
```

This is a heuristic and known to undercount — real users can authenticate as AI-named accounts, and well-disguised AI workflows won't trigger any signal. Treat the AI-event metric as a directional indicator, not a precise measurement.

### 5.5 Idempotency

Before processing each file, the pipeline checks `processed_files`. If present, skip. After successful processing of all events in the file, write a row to `processed_files` with the event counts. Re-runs are safe and cheap.

If the pipeline crashes mid-file, the next run re-processes the whole file. Since `company_events` writes are upserts on the full key `(company, year_month, event_time, event_id)`, this produces no duplicates.

---

## 6. Secondary Enrichment (GitHub REST API)

Commit-message tagging has limited recall. For events that passed the org filter, an enrichment job fetches actual commit details from the GitHub API.

**Runs after ingestion, before the LLM tier.**

```
For each event in company_events where tech_tags is empty (or for the most recent N):
  Call GET /repos/{owner}/{repo}/commits/{sha}
  Extract list of changed files from response
  Match file extensions to tech tags
  UPDATE company_events SET tech_tags = tech_tags + {new_tags} WHERE ...
```

**Rate limit math:** 15,000 requests/hour authenticated. For 5 companies producing on the order of 100–1000 events/day, this is comfortable. Use a PAT with `public_repo` scope (no permissions beyond reading public data).

**Failure mode to accept:** GH Archive contains historical events. If a repo was force-pushed, deleted, or made private after the event, the API call returns 404. The enrichment job logs and skips these; the original event remains in Cassandra with whatever tags came from the commit message.

Skip enrichment for events older than ~6 months — the recall improvement isn't worth the API budget.

---

## 7. Local LLM Tier

Single tier, runs nightly via cron. Embeddings are dropped from v1 (no consumer in v1 query paths).

### 7.1 What runs locally

- **Qwen2.5-Coder 7B Q4_K_M** via Ollama, on the GTX 1660 Ti.
- **Purpose:** generate a short natural-language summary per company per week from the structured event data.
  - "This week Wix pushed ~140 commits across 12 repos, with notable TypeScript and React activity. AI-attributed commits made up ~18% of activity, up from 12% last week."
- **Expected throughput:** 20–35 tok/s for ~200-token summaries. A weekly batch of 5 companies finishes in <5 minutes.

### 7.2 What does NOT run locally

- **Strategic analysis, comparison across companies, narrative generation.** These go to Claude Sonnet 4.5 via API, called from a small Python script when needed. Not on a fixed schedule — invoked when generating a report.
- **Code generation, agent tasks, tool use.** Same reasoning as the OpenClaw discussion earlier: small models fail at multi-step reasoning.

### 7.3 Why not embeddings (yet)

The original spec included `nomic-embed-text` for "building the local RAG engine." There is currently no query path that consumes these embeddings. Adding them without a consumer is dead weight: indexing cost, storage cost, code surface for no read-side benefit.

When a real semantic-search query appears ("find events similar to this one across all companies"), add Qdrant in Docker and wire it in. Not before.

---

## 8. Deployment Phases

### Phase 1 — Single-node Cassandra + Reaper (the actual development environment)

```yaml
# docker-compose.yml
services:
  cassandra:
    image: cassandra:4.1
    container_name: jf-cassandra
    ports:
      - "9042:9042"
      - "7199:7199"  # JMX for Reaper
    environment:
      - MAX_HEAP_SIZE=4G
      - HEAP_NEWSIZE=800M
      - CASSANDRA_CLUSTER_NAME=jobflow
    volumes:
      - /home/tomer/cassandra-data:/var/lib/cassandra  # on SSD
    healthcheck:
      test: ["CMD-SHELL", "nodetool status | grep -q '^UN'"]
      interval: 15s
      timeout: 10s
      retries: 20

  reaper:
    image: thelastpickle/cassandra-reaper:latest
    container_name: jf-reaper
    ports:
      - "8080:8080"
    environment:
      - REAPER_STORAGE_TYPE=memory
      - REAPER_CASS_CONTACT_POINTS=[cassandra]
    depends_on:
      cassandra:
        condition: service_healthy
```

**Verify after startup:**

```bash
docker exec -it jf-cassandra nodetool status
# Should show 'UN' (Up Normal) for one node

docker exec -it jf-cassandra cqlsh -e "DESCRIBE KEYSPACES;"
```

**Verify the driver's `localDataCenter` setting:**

```bash
docker exec -it jf-cassandra nodetool status | grep -i datacenter
# Note the DC name; common defaults are 'datacenter1' or 'dc1'
# Pass the exact value to the Node.js cassandra-driver
```

Reaper UI at `http://localhost:8080` (or from the MacBook over SSH tunnel: `ssh -L 8080:localhost:8080 tomer@<linux-box>`).

### Phase 2 — Run the pipeline end-to-end

1. Download a single hourly GH Archive file to the HDD.
2. Run `node ingest.js --file 2026-05-01-15.json.gz` and watch logs.
3. Open Reaper, observe write throughput and partition distribution.
4. Run a CQL `SELECT count(*)` against `company_events` and against `processed_files` to verify counts match expectations.
5. Re-run the same file. Verify it's a no-op (idempotency check).
6. Run the enrichment job on the resulting events.
7. Run the nightly LLM summary job.

### Phase 3 — 3-node Cassandra learning lab (transient, half-day exercise)

**Reframed scope:** this is a Cassandra-internals lab, not a production resiliency validation. The conclusions you draw apply to learning C* failure semantics, not to validating that the system survives real-world failures.

**Why the original framing was wrong:**

- All three nodes share the same disk, kernel, page cache, and network stack on one physical machine. Killing a container does not simulate node loss in any meaningful operational sense.
- With 16 GB RAM and three 3 GB-heap nodes, the machine is at ~9 GB just for JVMs. Anything else (Ollama, the ingestion script, Docker Desktop) gets squeezed.
- Killing a node may *improve* the others' performance temporarily by freeing page cache — the opposite of real production.

**What it IS useful for:**

- Observing the Murmur3 token ring distribution across nodes.
- Watching `nodetool status` show DN (Down Normal) and hint replay on recovery.
- Understanding consistency levels (`CL=QUORUM` vs `CL=ONE`) by playing with them.
- Seeing how gossip propagates and how `nodetool repair` behaves.

**Procedure:**

1. Shut down Ollama and any other RAM consumer.
2. Bring up a 3-node `docker-compose.yml` with `MAX_HEAP_SIZE=3G` per node, `RF=3`.
3. Run a small batch of ingestion (one file).
4. `nodetool status` shows the ring distribution.
5. `docker kill jf-cassandra-3`.
6. Run more ingestion. Observe writes succeeding at `CL=QUORUM` (2 of 3 nodes alive).
7. Bring node 3 back. Observe hint replay in logs.
8. Run `nodetool repair`. Watch the gossip / streaming behavior in Reaper.
9. Tear down the 3-node setup. Return to single-node for normal development.

Half a day, done. Useful learning, no production claims.

---

## 9. RAM Budget

Strict per-process budget so the machine doesn't swap.

| Process | Budget | When active |
|---|---|---|
| Xubuntu host + services | 1.5 GB | Always |
| Cassandra (JVM heap 4 GB + off-heap ~1 GB) | 5 GB | Ingestion + read |
| OS page cache for SSTables | 2–3 GB | Ingestion + read |
| Node.js ingestion + driver | 1 GB | Ingestion only |
| Ollama + Qwen 7B (host buffers) | 1 GB | LLM only (Cassandra still running) |
| GitHub enrichment job (Python or Node) | 500 MB | Enrichment only |
| Headroom | 2 GB | Always |
| **Total simultaneous** | ~13 GB | — |

**Time-slicing rule:**

- Ingestion + enrichment: Cassandra + Node.js + GitHub job. Ollama OFF.
- Nightly LLM: Cassandra + Ollama. Ingestion OFF.
- Never run all three at once.

Implement this in cron with explicit `systemctl stop ollama` / `docker stop` commands at the boundaries.

---

## 10. Dev Workflow

Working from MacBook, executing on the Linux box:

1. **SSH key setup:** `ssh-copy-id tomer@<linux-box-ip>` once. Passwordless thereafter.
2. **VS Code Remote-SSH:** install the extension on MacBook. Connect to `tomer@<linux-box>`. The IDE window opens against the remote filesystem; terminal, debugger, file tree all execute on the Linux host.
3. **Claude Code:** runs inside the Remote-SSH terminal. It reads and writes files on the Linux box natively. No file syncing.
4. **Reaper UI access:** SSH tunnel from MacBook: `ssh -L 8080:localhost:8080 tomer@<linux-box>`. Browser on MacBook hits `localhost:8080`.

This is the workflow that justifies running a "second machine" at all. The MacBook stays the workstation; the Xubuntu box is a dedicated execution environment for heavy workloads.

---

## 11. Project Structure

```
jobflow/
├── docker-compose.yml          # Cassandra + Reaper
├── docker-compose.3node.yml    # Transient 3-node lab
├── schema/
│   ├── 001_keyspace.cql
│   ├── 002_company_events.cql
│   ├── 003_processed_files.cql
│   └── 004_companies.cql
├── ingest/
│   ├── package.json
│   ├── ingest.js               # Main pipeline
│   ├── tag-extractor.js
│   └── ai-detector.js
├── enrich/
│   ├── package.json
│   └── github-commit-enrich.js # Secondary enrichment
├── llm/
│   ├── summarize.py            # Ollama + Qwen
│   └── strategic-report.py     # Claude API (on-demand)
├── scripts/
│   ├── seed-org-map.sql
│   ├── reset-dev.sh            # Nuke and re-init local data
│   └── download-archive.sh     # Pull GH Archive hourly files to HDD
└── docs/
    └── this-rfc.md
```

---

## 12. Known Limitations (honestly stated)

- **Tag extraction recall is moderate** even with enrichment. Many commits don't mention technologies in messages; many file extensions are ambiguous (e.g. `.yml` could be many things).
- **AI-event detection is heuristic.** Will produce false negatives (well-disguised AI workflows) and occasional false positives (people who name themselves with "bot" suffix).
- **Private repos are invisible.** GH Archive only contains public events. A company's most interesting engineering activity may be entirely in private repos and therefore unmeasured.
- **The "live profile" is sparse for small companies.** Companies with low public open-source activity will show very little signal.
- **No production-resiliency conclusions** can be drawn from the single-machine setup, including the 3-node lab.

These are accepted limitations, not bugs to fix. Stating them explicitly is part of the engineering discipline; they're also what an interviewer would expect you to surface unprompted.

---

## 13. Implementation Order (suggested weekend plan)

**Saturday morning:**
1. Finalize Xubuntu install, NVIDIA drivers, openssh-server (done from your side already).
2. Set up SSH from MacBook, VS Code Remote-SSH, verify Claude Code works on the remote.
3. Bring up `docker-compose.yml` (Cassandra + Reaper). Verify `nodetool status` and Reaper UI.

**Saturday afternoon:**
4. Run all four `schema/*.cql` files via cqlsh.
5. Seed `companies`.
6. Download one hourly GH Archive file to the HDD.
7. Write `ingest.js` with the corrected pipeline. Run against the single file.
8. Verify rows in `company_events`, verify idempotency on re-run.

**Sunday morning:**
9. Write the secondary enrichment job. Run it against the events from step 8.
10. Set up Ollama + Qwen2.5-Coder 7B. Run a single summary against one company.

**Sunday afternoon (optional, only if everything above works):**
11. The 3-node lab. Half a day, tear down at the end.

If anything in step 1–8 breaks, stop there. Steps 9–11 are additive; the system has value at step 8 alone.

---

## 14. Open questions for later

- Does the v1 tag extraction recall justify the GitHub API enrichment cost? Measure after a week of data.
- Does the weekly Qwen summary produce something readable, or does it need Claude on the loop? Test on real data, decide.
- When (if ever) does the embeddings tier become justified? Trigger: a real query path needs it.
- Multi-company comparison reports — Sonnet API only, or worth a local pipeline? Cost a few sample reports first.

End of design.