import path from 'path';
import { fileURLToPath } from 'url';
import cassandra from 'cassandra-driver';
import pino from 'pino';
import { readInitialised } from './lib/companies-state.js';
import { spawnIngester } from './lib/spawn-ingester.js';

const { Client } = cassandra;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Env config ───────────────────────────────────────────────────────────────
const CASSANDRA_CONTACT_POINTS = (process.env.CASSANDRA_CONTACT_POINTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const CASSANDRA_LOCAL_DC = process.env.CASSANDRA_LOCAL_DC ?? '';
const CASSANDRA_KEYSPACE = process.env.CASSANDRA_KEYSPACE ?? 'jobflow';
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

async function main() {
  // ── Connect to Cassandra ────────────────────────────────────────────────────
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
    logger.fatal({ err: err.message }, 'cassandra connection failed');
    process.exit(1);
  }

  // ── Read companies ──────────────────────────────────────────────────────────
  const companies = await readInitialised(client);
  await client.shutdown().catch(err => logger.warn({ err }, 'cassandra shutdown error'));

  if (companies.length === 0) {
    logger.info('no initialised companies');
    process.exit(0);
  }

  // URL-encode each token so values containing ':' or ',' can't break the
  // company:org,company:org wire format the Ingester parses. Mirrors backfill.js.
  const targetCompanies = companies
    .map(r => `${encodeURIComponent(r.company)}:${encodeURIComponent(r.org_name)}`)
    .join(',');
  logger.info({ count: companies.length, targetCompanies }, 'companies loaded — spawning ingester');

  // ── Spawn ingester ──────────────────────────────────────────────────────────
  const ingesterPath = path.resolve(__dirname, '..', 'ingester', 'ingester.js');
  const exitCode = await spawnIngester(
    [ingesterPath, '--catchup', '--mode', 'hourly', '--target-companies', targetCompanies],
    logger
  );

  process.exit(exitCode);
}

main().catch((err) => {
  logger.fatal({ err }, 'hourly orchestrator failed');
  process.exit(1);
});
