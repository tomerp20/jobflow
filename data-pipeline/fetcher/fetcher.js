import pino from 'pino';
import pLimit from 'p-limit';
import { parseCLI } from './lib/cli.js';
import { cleanPartials, enumerateRange } from '../shared/disk-layout/index.js';
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

main().catch((err) => {
  logger.error(err, 'fatal error');
  process.exit(1);
});
