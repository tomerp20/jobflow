import { Worker } from 'worker_threads';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';
import { hourIdToPath, enumerateRange, enumerateAllOnDisk, hourIdToMs } from 'disk-layout';
import { parseCLI } from './lib/cli.js';
import { CassandraWriter } from './lib/cassandra-writer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Env config ──────────────────────────────────────────────────────────────
const CASSANDRA_CONTACT_POINTS = (process.env.CASSANDRA_CONTACT_POINTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const CASSANDRA_LOCAL_DC = process.env.CASSANDRA_LOCAL_DC ?? '';
const CASSANDRA_KEYSPACE = process.env.CASSANDRA_KEYSPACE ?? 'jobflow';
const GHARCHIVE_DIR = process.env.GHARCHIVE_DIR ?? './data/gharchive';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const IS_PROD = process.env.NODE_ENV === 'production';
// Default ceiling raised to Math.min(8, cores-2) to exploit worker-side decompression
// (see docs/adr/0008-ingester-worker-side-decompression.md). Env override still respected.
const INGEST_WORKERS = process.env.INGEST_WORKERS
  ? parseInt(process.env.INGEST_WORKERS, 10)
  : Math.max(1, Math.min(8, os.cpus().length - 2));
const HOURLY_WRITE_CONCURRENCY = process.env.HOURLY_WRITE_CONCURRENCY
  ? parseInt(process.env.HOURLY_WRITE_CONCURRENCY, 10)
  : 50;

// Backpressure watermark: pause file dispatch when more than this many events
// are in flight to Cassandra. Matches the previous in-line watermark.
const INFLIGHT_HIGH_WATERMARK = 10000;

// ── Logger ───────────────────────────────────────────────────────────────────
const loggerOpts = { level: LOG_LEVEL };
if (!IS_PROD) {
  loggerOpts.transport = { target: 'pino-pretty' };
}
const logger = pino(loggerOpts);

// ── CLI (parsed before env validation so bad args exit with usage, not env error) ─
const cmd = parseCLI(process.argv);

// ── Startup validation ────────────────────────────────────────────────────────
if (CASSANDRA_CONTACT_POINTS.length === 0) {
  logger.fatal('CASSANDRA_CONTACT_POINTS is required');
  process.exit(1);
}
if (!CASSANDRA_LOCAL_DC) {
  logger.fatal('CASSANDRA_LOCAL_DC is required');
  process.exit(1);
}

// ── Build company filter structures from --target-companies ───────────────────
const orgToCompany = {};
for (const { company, org } of cmd.targetCompanies) {
  orgToCompany[org] = company;
}
const orgNames = Object.keys(orgToCompany);
// Escape metacharacters before joining — org names are user-supplied via CLI
// and could contain dots or other regex chars that would cause ReDoS or silent mismatch.
// "/" suffix anchors to repo.name format, reducing false positives.
const orgRegexSource = orgNames.map(o => escapeRegex(o) + '/').join('|');

logger.info({ workers: INGEST_WORKERS, mode: cmd.mode, orgs: orgNames }, 'ingester starting');

// ── Cassandra ─────────────────────────────────────────────────────────────────
const writer = new CassandraWriter({
  contactPoints: CASSANDRA_CONTACT_POINTS,
  localDc: CASSANDRA_LOCAL_DC,
  keyspace: CASSANDRA_KEYSPACE,
  logger,
  writeConcurrency: HOURLY_WRITE_CONCURRENCY,
});

await writer.connect();
logger.info('cassandra connected');
writer.startRateLogger();

// ── Resolve hour IDs to process ───────────────────────────────────────────────
let hourIds;

if (cmd.verb === 'hour') {
  hourIds = [cmd.hourId];
} else if (cmd.verb === 'range') {
  hourIds = enumerateRange(cmd.start, cmd.end);
} else if (cmd.verb === 'catchup') {
  // catchup: walk disk, find all hours after the highest already-processed hour
  const allOnDisk = enumerateAllOnDisk(GHARCHIVE_DIR);
  if (allOnDisk.length === 0) {
    logger.warn('no files in GHARCHIVE_DIR');
    await writer.shutdown();
    process.exit(0);
  }
  const maxProcessed = await writer.getMaxProcessedFile();
  // Compare chronologically (hourIdToMs), not lexicographically — the hour
  // component of the canonical hourId is unpadded (`YYYY-MM-DD-H`, 0–23), so
  // string compare yields '…-9' > '…-10'. Using ms timestamps avoids the bug.
  const maxMs = maxProcessed !== null ? hourIdToMs(maxProcessed) : null;
  const pending = maxMs !== null ? allOnDisk.filter(id => hourIdToMs(id) > maxMs) : allOnDisk;
  const alreadyProcessed = allOnDisk.length - pending.length;
  logger.info(
    { total: allOnDisk.length, alreadyProcessed, toProcess: pending.length },
    'catchup startup summary'
  );
  if (pending.length === 0) {
    logger.info('nothing to do');
    await writer.shutdown();
    process.exit(0);
  }
  hourIds = pending;
} else {
  throw new Error(`unknown verb: ${cmd.verb}`);
}

// ── Spawn persistent worker pool ──────────────────────────────────────────────
const workerPool = spawnWorkers(INGEST_WORKERS);

let exitCode = 0;

try {
  if (cmd.mode === 'backfill' && cmd.verb === 'range') {
    // Group hourIds by date for per-date backfill_progress tracking.
    // Process one date at a time so a failure surfaces before later dates contaminate state;
    // within a date, dispatch hours concurrently across the worker pool.
    const dateHoursMap = new Map();
    for (const hourId of hourIds) {
      const date = hourId.slice(0, 10); // YYYY-MM-DD
      if (!dateHoursMap.has(date)) dateHoursMap.set(date, []);
      dateHoursMap.get(date).push(hourId);
    }

    for (const [date, dateHours] of dateHoursMap) {
      try {
        const eventsWrittenForDate = await processHourBatch(dateHours);
        // Flush remaining per-partition buffers accumulated across this date's files,
        // then record date-level progress only after the flush lands in Cassandra.
        await writer.flushAllPartitionBuffers();
        await writer.writeBackfillProgress(cmd.runId, date, eventsWrittenForDate);
        logger.info({ date, eventsWritten: eventsWrittenForDate }, 'date complete — backfill_progress written');
      } catch (err) {
        logger.error(
          { date, partition: err.partitionKey ?? null, sampleEventId: err.sampleEventId ?? null, err: err.message },
          'failed to process date — no backfill_progress row written'
        );
        exitCode = 1;
        break;
      }
    }
  } else {
    try {
      await processHourBatch(hourIds);
    } catch (err) {
      logger.error({ err: err.message }, 'failed to process hours — stopping');
      exitCode = 1;
    }
  }
} finally {
  // Terminate persistent worker pool, then shutdown Cassandra client.
  await Promise.all(workerPool.map(w => w.terminate().catch(() => undefined)));
  await writer.shutdown();
}

process.exit(exitCode);

// ─────────────────────────────────────────────────────────────────────────────

// Dispatches the given hourIds concurrently across the worker pool.
// - Chronological-order invariants:
//     * dispatch happens in input order
//     * processed_files writes (hourly mode) happen in input order
// - Backpressure: dispatch pauses while events-in-flight to Cassandra exceeds the watermark.
// - Failure: first write or worker error aborts; remaining in-flight writes are awaited so
//   the worker pool can be cleanly terminated afterwards.
// Returns the total filtered (= emitted-by-worker) event count across all hours.
async function processHourBatch(orderedHourIds) {
  if (orderedHourIds.length === 0) return 0;

  // Hours waiting to be dispatched — chronological FIFO.
  const pendingHours = [...orderedHourIds];
  // Workers currently idle and waiting for a file. Initially every worker is idle.
  const readyWorkers = [...workerPool];

  // Per-hour state.
  // inFlightByHour: count of events for this hour that have been handed to the writer
  //                 but whose write promise hasn't settled yet.
  const inFlightByHour = new Map();
  const dispatchedAll = new Set();              // worker has emitted fileDone for this hour
  const statsByHour = new Map();                // {totalEmitted, droppedNoTimestamp, droppedNoId}
  let nextFinalizeIdx = 0;                      // index into orderedHourIds of next hour to finalize
  let totalEventsEmittedAcrossHours = 0;        // accumulator for return value

  let totalInFlight = 0;
  let busyWorkers = 0;   // dispatched but not yet returned (fileDone, workerError, or hard crash)
  let writeError = null;

  let resolveDone, rejectDone;
  const done = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });

  function tryDispatch() {
    while (
      !writeError &&
      readyWorkers.length > 0 &&
      pendingHours.length > 0 &&
      totalInFlight < INFLIGHT_HIGH_WATERMARK
    ) {
      const worker = readyWorkers.shift();
      const hourId = pendingHours.shift();
      const filePath = hourIdToPath(GHARCHIVE_DIR, hourId);
      inFlightByHour.set(hourId, 0);
      busyWorkers++;
      logger.info({ hourId, filePath, worker: worker.threadId }, 'dispatching file to worker');
      worker.postMessage({ type: 'processFile', hourId, filePath });
    }
    checkTerminalCondition();
  }

  function checkTerminalCondition() {
    if (writeError) {
      // Wait until all in-flight writes settle AND every dispatched worker has
      // returned (via fileDone, workerError, or hard crash). Using busyWorkers
      // rather than readyWorkers.length so a hard-crashed worker (which is not
      // returned to the pool) still counts toward the quorum.
      if (totalInFlight === 0 && busyWorkers === 0) {
        rejectDone(writeError);
      }
      return;
    }
    // Success: every input hour finalized.
    if (nextFinalizeIdx === orderedHourIds.length) {
      resolveDone(totalEventsEmittedAcrossHours);
    }
  }

  // Finalize hours in chronological input order. Awaits the underlying
  // markFileProcessed write so it cannot interleave with itself.
  let finalizing = false;
  let finalizePending = false;
  async function tryFinalize() {
    if (finalizing) { finalizePending = true; return; }
    finalizing = true;
    try {
      do {
        finalizePending = false;
        while (nextFinalizeIdx < orderedHourIds.length) {
          const h = orderedHourIds[nextFinalizeIdx];
          if (!dispatchedAll.has(h)) break;
          if ((inFlightByHour.get(h) ?? 0) > 0) break;
          if (writeError) break;

          const stats = statsByHour.get(h) ?? { totalEmitted: 0, droppedNoTimestamp: 0, droppedNoId: 0 };
          totalEventsEmittedAcrossHours += stats.totalEmitted;
          logger.info(
            { hourId: h, totalEmitted: stats.totalEmitted, droppedNoTimestamp: stats.droppedNoTimestamp, droppedNoId: stats.droppedNoId },
            'hour complete'
          );
          if (cmd.mode === 'hourly') {
            try {
              await writer.markFileProcessed(h);
              logger.info({ hourId: h }, 'processed_files row written');
            } catch (err) {
              if (!writeError) {
                writeError = err;
                logger.error({ hourId: h, err: err.message }, 'markFileProcessed failed');
              }
              break;
            }
          }
          nextFinalizeIdx++;
        }
      } while (finalizePending && !writeError);
    } finally {
      finalizing = false;
    }
    checkTerminalCondition();
  }

  function recordWriteError(err) {
    if (writeError) return;
    writeError = err;
  }

  function attachWorker(worker) {
    worker.on('message', (msg) => {
      if (!msg || !msg.type) return;

      if (msg.type === 'events') {
        if (writeError) return; // drop further events once we've started failing
        const { hourId, results } = msg;
        for (const event of results) {
          inFlightByHour.set(hourId, (inFlightByHour.get(hourId) ?? 0) + 1);
          totalInFlight++;
          const p = cmd.mode === 'backfill'
            ? writer.addBackfillEvent(event)
            : writer.writeEvent(event);
          p.then(() => {
            inFlightByHour.set(hourId, (inFlightByHour.get(hourId) ?? 1) - 1);
            totalInFlight--;
            if (totalInFlight < INFLIGHT_HIGH_WATERMARK) tryDispatch();
            tryFinalize();
          }).catch((err) => {
            inFlightByHour.set(hourId, (inFlightByHour.get(hourId) ?? 1) - 1);
            totalInFlight--;
            if (!writeError) {
              const partitionKey = err.partitionKey ?? `${event.company}/${event.year_month}`;
              const sampleEventId = err.sampleEventId ?? event.event_id;
              logger.error(
                { hourId, partition: partitionKey, event_id: sampleEventId, err: err.message },
                cmd.mode === 'backfill' ? 'batch flush failed after retries' : 'write failed after retries'
              );
              recordWriteError(err);
            }
            checkTerminalCondition();
          });
        }
      } else if (msg.type === 'fileDone') {
        statsByHour.set(msg.hourId, {
          totalEmitted: msg.totalEmitted,
          droppedNoTimestamp: msg.droppedNoTimestamp,
          droppedNoId: msg.droppedNoId,
        });
        dispatchedAll.add(msg.hourId);
        busyWorkers--;
        readyWorkers.push(worker);
        tryDispatch();
        tryFinalize();
      } else if (msg.type === 'workerError') {
        logger.error({ hourId: msg.hourId, err: msg.message }, 'worker failed on file');
        const err = new Error(`worker error on ${msg.hourId}: ${msg.message}`);
        recordWriteError(err);
        busyWorkers--;
        readyWorkers.push(worker);
        checkTerminalCondition();
      }
    });

    worker.on('error', (err) => {
      logger.error({ err: err.message }, 'worker thread errored');
      recordWriteError(err);
      busyWorkers--;
      // The worker is gone; do not return it to readyWorkers.
      checkTerminalCondition();
    });
  }

  // Strip any listeners installed by a previous processHourBatch invocation
  // (backfill-mode date loop calls us once per date with the same worker pool).
  for (const w of workerPool) {
    w.removeAllListeners('message');
    w.removeAllListeners('error');
    attachWorker(w);
  }

  tryDispatch();

  try {
    return await done;
  } finally {
    for (const w of workerPool) {
      w.removeAllListeners('message');
      w.removeAllListeners('error');
    }
  }
}

function spawnWorkers(count) {
  const workerPath = path.join(__dirname, 'worker.js');
  return Array.from({ length: count }, () =>
    new Worker(workerPath, { workerData: { orgRegexSource, orgToCompany } })
  );
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Graceful shutdown on SIGINT/SIGTERM so pino flushes and Cassandra connection closes cleanly.
async function gracefulShutdown(signal) {
  logger.info({ signal }, 'shutting down');
  try {
    await Promise.all(workerPool.map(w => w.terminate().catch(() => undefined)));
  } finally {
    await writer.shutdown();
  }
  process.exit(0);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
