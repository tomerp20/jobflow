# ADR 0004: Microservices-shaped CLI contract — per-job parameters as args, service-level config as env vars

## Status
Proposed

## Context

The JobFlow Analytics ingestion pipeline ships as three Node packages (Fetcher, Ingester, Backfill orchestrator) that talk to each other via OS subprocess spawns and a shared Cassandra database. This is a deliberately conservative deployment shape for a single-machine learning project: no message queue, no service discovery, no container orchestration.

There is, however, a stated intention to one day migrate the pipeline to a microservices architecture — separate deployable services communicating via message queues, with independently scalable workers consuming jobs from a fan-out broker. Today's subprocess invocations would become "publish job to queue" calls; today's exit-code waiting would become "subscribe to job-completed events"; today's local file paths would become object storage references.

For the microservices migration to be cheap, the contract between the orchestrator (publisher of jobs) and the Ingester (consumer of jobs) needs to look queue-shaped today. Specifically, the data that travels with one job invocation should map cleanly to a message body: a small, well-typed JSON object containing exactly the parameters that vary per job (date range, mode, target rows, etc.) — and nothing more.

Two alternatives were considered for how the Ingester receives its per-invocation parameters:

1. **CLI arguments only.** Per-job parameters arrive as `--hour`, `--range`, `--mode`, etc. Env vars are reserved for service-level config (Cassandra contact points, the local data center name, the on-disk archive root, the log level, the worker count default). The Ingester treats env vars as "things that would be a pod's env in Kubernetes" — i.e. unchanging across all jobs the pod processes.

2. **Mixed args and env vars.** Per-job parameters can arrive either way. For example, `INGEST_MODE=backfill` env var with `--range A B` args; or `--mode backfill` and `INGEST_TARGET_ROWS` env var. Whatever is convenient for the immediate caller.

## Decision

The Ingester (and any future per-job worker in this subsystem) accepts **per-job parameters strictly as CLI arguments**. Environment variables are reserved for **service-level configuration** that does not change across job invocations. The two categories are mutually exclusive: nothing that varies per job is ever read from an env var, and nothing that is service-level config is ever passed as a CLI argument.

Per-job parameters (CLI args only):
- The work unit identifier: `--hour`, `--range`, `--catchup`
- The mode dispatch: `--mode hourly | backfill`
- The locked target set, if/when introduced: `--target-rows` (or equivalent)
- Any per-invocation overrides of concurrency: `--hourly-write-concurrency`

Service-level config (env vars only):
- `CASSANDRA_CONTACT_POINTS`, `CASSANDRA_LOCAL_DC`, `CASSANDRA_KEYSPACE`
- `GHARCHIVE_DIR`
- `LOG_LEVEL`
- `INGEST_WORKERS` (default — overridable per invocation only if a strong reason emerges)

The Orchestrator (Backfill) follows the same discipline when constructing the Ingester's argv: it assembles a JSON-shaped argument object first (`{mode, range, targetRows}`), then translates that object to argv just before the `spawn()` call. The argument object is the message body of a future queue publish.

## Consequences

- The future migration from subprocess to message queue is local to one file in the Orchestrator (the `spawn()` call) and one file in the Ingester (`lib/cli.js`, which becomes a queue consumer's job decoder). The rest of both packages — companies-loader, worker pool, Cassandra writer, tag/AI extractors — does not change.
- New per-job parameters always go in as args. Reviewers should reject PRs that introduce per-job env vars.
- New service-level config always goes in as env vars. Reviewers should reject PRs that introduce CLI args for things like Cassandra contact points or the archive root.
- The discipline imposes a small mental overhead at every PR ("is this thing per-job or per-service?") that is the price of the migration optionality. Without it, the migration becomes a per-parameter audit of every entrypoint.
- This ADR does not commit to building a microservices abstraction layer now. There is no `JobInvoker` interface, no proto definition, no message envelope schema. Those investments happen if and only if the migration actually starts. This ADR is a behavioural discipline, not a structural one.
