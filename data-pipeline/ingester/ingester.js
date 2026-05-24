import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
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
const INGEST_WORKERS = process.env.INGEST_WORKERS
  ? parseInt(process.env.INGEST_WORKERS, 10)
  : Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
const HOURLY_WRITE_CONCURRENCY = process.env.HOURLY_WRITE_CONCURRENCY
  ? parseInt(process.env.HOURLY_WRITE_CONCURRENCY, 10)
  : 50;

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

// ── Process each hour file ────────────────────────────────────────────────────
let exitCode = 0;

if (cmd.mode === 'backfill' && cmd.verb === 'range') {
  // Group hourIds by date for per-date backfill_progress tracking
  const dateHoursMap = new Map();
  for (const hourId of hourIds) {
    const date = hourId.slice(0, 10); // YYYY-MM-DD
    if (!dateHoursMap.has(date)) dateHoursMap.set(date, []);
    dateHoursMap.get(date).push(hourId);
  }

  for (const [date, dateHours] of dateHoursMap) {
    let eventsWrittenForDate = 0;
    try {
      for (const hourId of dateHours) {
        eventsWrittenForDate += await processHour(hourId);
      }
      // No date-level flush needed: processHour flushes all partition buffers
      // at end-of-file in backfill mode, so they're already empty here.
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
  for (const hourId of hourIds) {
    try {
      await processHour(hourId);
    } catch (err) {
      logger.error({ hourId, err: err.message }, 'failed to process hour — stopping');
      exitCode = 1;
      break;
    }
  }
}

await writer.shutdown();
process.exit(exitCode);

// ─────────────────────────────────────────────────────────────────────────────

// Returns the number of filtered events written (used by backfill date accumulator).
async function processHour(hourId) {
  const filePath = hourIdToPath(GHARCHIVE_DIR, hourId);

  // In --mode hourly: check processed_files for idempotency.
  // Catchup pre-filters to only unprocessed hours, so skip the query there.
  // Compare chronologically (hourIdToMs), not lexicographically — see catchup
  // block above for the unpadded-hour rationale.
  if (cmd.mode === 'hourly' && cmd.verb !== 'catchup') {
    const maxProcessed = await writer.getMaxProcessedFile();
    if (maxProcessed !== null && hourIdToMs(hourId) <= hourIdToMs(maxProcessed)) {
      logger.info({ hourId }, 'already processed, skipping');
      return 0;
    }
  }

  logger.info({ hourId, filePath }, 'processing file');

  const workers = spawnWorkers(INGEST_WORKERS);
  let workerIdx = 0;

  let totalParsed = 0;
  let totalFiltered = 0;
  let totalDroppedNoTimestamp = 0;
  let totalDroppedNoId = 0;
  let inFlight = 0;
  let writeError = null;
  let paused = false;

  function onWorkerResult({ results, droppedNoTimestamp, droppedNoId }) {
    if (writeError) return; // stop buffering once a fatal write error has been observed
    totalDroppedNoTimestamp += droppedNoTimestamp;
    totalDroppedNoId += droppedNoId;
    for (const event of results) {
      totalParsed++;
      inFlight++;
      if (cmd.mode === 'backfill') {
        writer.addBackfillEvent(event).then(() => {
          totalFiltered++;
          inFlight--;
        }).catch(err => {
          inFlight--;
          if (!writeError) {
            writeError = err;
            logger.error(
              { event_id: err.sampleEventId ?? event.event_id, partition: err.partitionKey ?? `${event.company}/${event.year_month}`, err: err.message },
              'batch flush failed after retries'
            );
          }
        });
      } else {
        writer.writeEvent(event).then(() => {
          totalFiltered++;
          inFlight--;
        }).catch(err => {
          inFlight--;
          writeError = err;
          logger.error({ event_id: event.event_id, partition: `${event.company}/${event.year_month}`, err: err.message }, 'write failed after retries');
        });
      }
    }
  }

  let rl = null;

  for (const w of workers) {
    w.on('message', (events) => {
      onWorkerResult(events);
      // Resume reading if we drained below the low-water mark
      if (paused && inFlight <= 5000) {
        paused = false;
        rl?.resume();
      }
    });
  }

  // Stream the file through readline, distribute batches to workers
  await new Promise((resolve, reject) => {
    const fileStream = createReadStream(filePath);
    const gunzip = createGunzip();
    rl = createInterface({ input: fileStream.pipe(gunzip), crlfDelay: Infinity });

    let batch = [];

    function dispatchBatch(lines) {
      const worker = workers[workerIdx % workers.length];
      workerIdx++;
      worker.postMessage(lines);

      // Apply backpressure: pause reading until in-flight Cassandra writes drain
      if (inFlight > 10000 && !paused) {
        paused = true;
        rl.pause();
      }
    }

    rl.on('line', (line) => {
      if (writeError) {
        rl.close();
        fileStream.destroy();
        return;
      }
      batch.push(line);
      if (batch.length >= 1000) {
        const toSend = batch;
        batch = [];
        dispatchBatch(toSend);
      }
    });

    rl.on('close', () => {
      if (batch.length > 0) {
        dispatchBatch(batch);
        batch = [];
      }
      resolve();
    });

    fileStream.on('error', reject);
    gunzip.on('error', reject);
    rl.on('error', reject);
  });

  // Drain remaining in-flight writes
  while (inFlight > 0) {
    await sleep(50);
  }

  // Terminate workers (parallel)
  await Promise.all(workers.map(w => w.terminate()));

  if (writeError) {
    logger.error({ hourId }, 'hour failed');
    throw writeError;
  }

  // In backfill mode: flush buffered events accumulated during this file
  if (cmd.mode === 'backfill') {
    await writer.flushAllPartitionBuffers();
  }

  logger.info({ hourId, totalParsed, totalFiltered, totalDroppedNoTimestamp, totalDroppedNoId }, 'hour complete');

  // In --mode hourly: mark file processed
  if (cmd.mode === 'hourly') {
    await writer.markFileProcessed(hourId);
    logger.info({ hourId, totalParsed, totalFiltered }, 'processed_files row written');
  }

  return totalFiltered;
}

function spawnWorkers(count) {
  const workerPath = path.join(__dirname, 'worker.js');
  return Array.from({ length: count }, () =>
    new Worker(workerPath, { workerData: { orgRegexSource, orgToCompany } })
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Graceful shutdown on SIGINT/SIGTERM so pino flushes and Cassandra connection closes cleanly.
async function gracefulShutdown(signal) {
  logger.info({ signal }, 'shutting down');
  await writer.shutdown();
  process.exit(0);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
