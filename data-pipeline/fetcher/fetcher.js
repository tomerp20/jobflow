import pino from 'pino';
import pLimit from 'p-limit';
import { parseCLI } from './lib/cli.js';
import { cleanPartials, enumerateRange, latestOnDisk } from './lib/disk-layout.js';
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

  const limit = pLimit(3);

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
    log.error('no anchor to walk from — run --hour or --range first to seed the directory');
    process.exit(1);
  }

  const ceilingMs = Date.now() - 2 * 3_600_000;
  const anchorMs = _hourIdToMs(anchor);

  const candidates = [];
  for (let t = anchorMs + 3_600_000; t <= ceilingMs; t += 3_600_000) {
    candidates.push(_msToHourId(t));
  }

  if (candidates.length === 0) {
    log.info({ anchor }, 'already up to date');
    return;
  }

  log.info({ count: candidates.length, from: candidates[0], to: candidates[candidates.length - 1] }, 'starting catchup walk');

  const limit = pLimit(3);
  let found404 = false;

  // All candidates are enqueued; p-limit starts up to 3 concurrently.
  // The found404 flag prevents new HTTP requests from being issued after the first 404;
  // any already-in-flight requests are awaited but their results don't extend the walk.
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

function _hourIdToMs(hourId) {
  const [y, m, d, h] = hourId.split('-').map(Number);
  return Date.UTC(y, m - 1, d, h);
}

function _msToHourId(ms) {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hour = d.getUTCHours();
  return `${year}-${month}-${day}-${hour}`;
}

main().catch((err) => {
  logger.error(err, 'fatal error');
  process.exit(1);
});
