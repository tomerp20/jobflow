import pino from 'pino';
import pLimit from 'p-limit';
import { parseCLI } from './lib/cli.js';
import { cleanPartials, enumerateRange, hourIdToMs, latestOnDisk, msToHourId } from '../shared/disk-layout/index.js';
import { downloadHour } from './lib/download.js';

const ROOT = process.env.GHARCHIVE_DIR ?? './data/gharchive';
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const IS_PROD = process.env.NODE_ENV === 'production';

const loggerOpts = { level: LOG_LEVEL };
if (!IS_PROD) {
  loggerOpts.transport = { target: 'pino-pretty' };
}
const logger = pino(loggerOpts);

async function main() {
  const cmd = parseCLI(process.argv);

  logger.info({ root: ROOT }, 'cleaning partial files');
  cleanPartials(ROOT);

  if (cmd.mode === 'catchup') {
    await runCatchup(ROOT, logger);
    return;
  }

  const hours =
    cmd.mode === 'hour'
      ? [cmd.hourId]
      : enumerateRange(cmd.start, cmd.end);

  logger.info({ count: hours.length }, 'starting downloads');

  const limit = pLimit(6);

  const settled = await Promise.allSettled(
    hours.map((hourId) =>
      limit(async () => {
        const result = await downloadHour(ROOT, hourId);
        if (result.status === 'written') {
          logger.info({ hourId }, 'written');
        } else if (result.status === 'not-found') {
          logger.warn({ hourId }, 'not found on GH Archive');
        } else if (result.status === 'failed-after-retries') {
          logger.error({ hourId, error: result.error }, 'failed after retries');
        }
        return result;
      })
    )
  );

  const results = settled.map((s) =>
    s.status === 'fulfilled'
      ? s.value
      : { status: 'failed-after-retries', error: s.reason?.message }
  );

  const tally = results.reduce(
    (acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; },
    {}
  );
  logger.info(tally, 'done');
}

async function runCatchup(root, log) {
  const anchor = latestOnDisk(root);
  if (!anchor) {
    // Throw so the main().catch handler exits consistently with other fatal errors
    // and pino's transport gets a chance to flush before exit.
    throw new Error('no anchor to walk from — run --hour or --range first to seed the directory');
  }

  const ceilingMs = Date.now() - 2 * 3_600_000;
  const anchorMs = hourIdToMs(anchor);

  const candidates = [];
  for (let t = anchorMs + 3_600_000; t <= ceilingMs; t += 3_600_000) {
    candidates.push(msToHourId(t));
  }

  if (candidates.length === 0) {
    log.info({ anchor }, 'already up to date');
    return;
  }

  log.info({ count: candidates.length, from: candidates[0], to: candidates[candidates.length - 1] }, 'starting catchup walk');

  const limit = pLimit(6);
  let found404 = false;

  // All candidates are enqueued; p-limit starts up to 6 concurrently.
  // The found404 flag prevents new HTTP requests from being issued after the first 404;
  // any already-in-flight requests are awaited (up to concurrency-1) but their results don't extend the walk.
  const promises = candidates.map((hourId) =>
    limit(async () => {
      if (found404) return { status: 'skipped-catchup-abort', hourId };
      const result = await downloadHour(root, hourId);
      if (result.status === 'not-found') {
        found404 = true;
        log.warn({ hourId }, 'first 404 — halting catchup walk');
      } else if (result.status === 'written') {
        log.info({ hourId }, 'written');
      } else if (result.status === 'failed-after-retries') {
        log.error({ hourId, error: result.error }, 'failed after retries');
      }
      return result;
    })
  );

  const settled = await Promise.allSettled(promises);
  const results = settled.map((s) =>
    s.status === 'fulfilled'
      ? s.value
      : { status: 'failed-after-retries', error: s.reason?.message }
  );
  const tally = results.reduce(
    (acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; },
    {}
  );
  log.info(tally, 'catchup done');
}

main().catch((err) => {
  logger.error(err, 'fatal error');
  process.exit(1);
});
