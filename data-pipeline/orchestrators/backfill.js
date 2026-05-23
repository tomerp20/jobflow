import path from 'path';
import { fileURLToPath } from 'url';
import cassandra from 'cassandra-driver';
import pino from 'pino';
import { readUninitialised } from './lib/companies-state.js';
import { spawnIngester } from './lib/spawn-ingester.js';
import { findLatestRun, createNewRun, markCompleted, markFailed, getMaxCompletedDate } from './lib/run-state.js';
import { earliestOnDisk, yesterdayUtc } from './lib/disk-bounds.js';

const { Client } = cassandra;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Env config ────────────────────────────────────────────────────────────────
const CASSANDRA_CONTACT_POINTS = (process.env.CASSANDRA_CONTACT_POINTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const CASSANDRA_LOCAL_DC = process.env.CASSANDRA_LOCAL_DC ?? '';
const CASSANDRA_KEYSPACE = process.env.CASSANDRA_KEYSPACE ?? 'jobflow';
const GHARCHIVE_DIR = process.env.GHARCHIVE_DIR ?? '';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const IS_PROD = process.env.NODE_ENV === 'production';

// ── Logger ────────────────────────────────────────────────────────────────────
const loggerOpts = { level: LOG_LEVEL };
if (!IS_PROD) {
  loggerOpts.transport = { target: 'pino-pretty' };
}
const logger = pino(loggerOpts);

// ── Startup validation ────────────────────────────────────────────────────────
if (CASSANDRA_CONTACT_POINTS.length === 0) {
  logger.fatal('CASSANDRA_CONTACT_POINTS is required');
  process.exit(1);
}
if (!CASSANDRA_LOCAL_DC) {
  logger.fatal('CASSANDRA_LOCAL_DC is required');
  process.exit(1);
}
if (!GHARCHIVE_DIR) {
  logger.fatal('GHARCHIVE_DIR is required');
  process.exit(1);
}

function nextDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

async function main() {
  // ── Connect to Cassandra ──────────────────────────────────────────────────
  const client = new Client({
    contactPoints: CASSANDRA_CONTACT_POINTS,
    localDataCenter: CASSANDRA_LOCAL_DC,
    keyspace: CASSANDRA_KEYSPACE,
  });

  try {
    await client.connect();
    await client.execute('SELECT release_version FROM system.local');
    logger.info('cassandra connected');
  } catch (err) {
    logger.fatal({ err }, 'cassandra connection failed');
    await client.shutdown().catch(() => {});
    process.exit(1);
  }

  try {
    // ── Check for uninitialised companies ─────────────────────────────────────
    const uninitialised = await readUninitialised(client);
    if (uninitialised.length === 0) {
      logger.info('nothing to do');
      await client.shutdown();
      process.exit(0);
    }

    // ── Determine lifecycle path ──────────────────────────────────────────────
    const latestRun = await findLatestRun(client, CASSANDRA_KEYSPACE);
    const yesterday = yesterdayUtc();

    let runId, targetRows, startDate;

    if (latestRun && latestRun.status === 'in_progress') {
      // ── Resume path ─────────────────────────────────────────────────────────
      runId = latestRun.runId;
      targetRows = latestRun.targetRows;

      const maxDate = await getMaxCompletedDate(client, CASSANDRA_KEYSPACE, runId);
      if (maxDate !== null) {
        startDate = nextDay(maxDate);
      } else {
        // In-progress run with no completed dates — restart from earliest on disk.
        // Safe to re-ingest: the Ingester writes (run_id, date)-keyed rows and
        // PR3.A's idempotency contract guarantees that repeated writes under the
        // same key produce the same end state.
        try {
          startDate = earliestOnDisk(GHARCHIVE_DIR);
        } catch (err) {
          logger.fatal({ err }, 'cannot determine start date for resume');
          await client.shutdown().catch(() => {});
          process.exit(1);
        }
      }

      logger.info({ runId: runId.toString(), startDate, endDate: yesterday, companies: targetRows.length }, 'resuming run');
    } else {
      // ── Fresh path (no row, completed, or failed) ────────────────────────────
      let earliest;
      try {
        earliest = earliestOnDisk(GHARCHIVE_DIR);
      } catch (err) {
        logger.fatal({ err }, 'cannot determine start date for fresh run');
        await client.shutdown().catch(() => {});
        process.exit(1);
      }

      const created = await createNewRun(client, CASSANDRA_KEYSPACE, uninitialised);
      runId = created.runId;
      targetRows = created.targetRows;
      startDate = earliest;

      logger.info({ runId: runId.toString(), startDate, endDate: yesterday, companies: targetRows.length }, 'starting fresh run');
    }

    // ── Skip spawn if all dates already covered ───────────────────────────────
    if (startDate > yesterday) {
      logger.info({ runId: runId.toString() }, 'all dates already processed — flipping companies');
      await markCompleted(client, CASSANDRA_KEYSPACE, runId, targetRows);
      await client.shutdown();
      process.exit(0);
    }

    // ── Spawn Ingester ────────────────────────────────────────────────────────
    const targetCompaniesArg = targetRows.map(r => `${r.company}:${r.org_name}`).join(',');
    const ingesterPath = path.resolve(__dirname, '..', 'ingester', 'ingester.js');

    logger.info({ startDate, endDate: yesterday, companies: targetRows.length }, 'spawning ingester');

    const exitCode = await spawnIngester(
      [
        ingesterPath,
        '--range', startDate, yesterday,
        '--mode', 'backfill',
        '--target-companies', targetCompaniesArg,
        '--run-id', runId.toString(),
      ],
      logger
    );

    // ── Handle Ingester exit ──────────────────────────────────────────────────
    if (exitCode === 0) {
      // If markCompleted throws here the backfill_runs row stays in_progress,
      // even though every hour has been ingested. That is recoverable: the next
      // nightly run will enter the resume path, find startDate > yesterday at
      // the "all dates already processed" short-circuit above, and retry
      // markCompleted. The companies UPDATEs are idempotent, so this is safe.
      await markCompleted(client, CASSANDRA_KEYSPACE, runId, targetRows);
      logger.info({ runId: runId.toString() }, 'backfill complete — companies initialised');
    } else {
      await markFailed(client, CASSANDRA_KEYSPACE, runId);
      logger.error({ runId: runId.toString(), exitCode }, 'ingester failed — run marked failed');
      await client.shutdown();
      process.exit(exitCode);
    }
  } catch (err) {
    logger.fatal({ err }, 'backfill orchestrator error');
    await client.shutdown().catch(() => {});
    process.exit(1);
  }

  await client.shutdown();
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, 'backfill orchestrator failed');
  process.exit(1);
});
