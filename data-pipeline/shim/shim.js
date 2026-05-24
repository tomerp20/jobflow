import http from 'node:http';
import pino from 'pino';
import { buildClient, insertIfNotExists } from './lib/cassandra.js';

// ── Env config ───────────────────────────────────────────────────────────────
const SHIM_PORT            = parseInt(process.env.SHIM_PORT ?? '3100', 10);
const SHIM_BEARER_TOKEN    = process.env.SHIM_BEARER_TOKEN ?? '';
const CASSANDRA_CONTACT_POINTS = (process.env.CASSANDRA_CONTACT_POINTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const CASSANDRA_LOCAL_DC   = process.env.CASSANDRA_LOCAL_DC ?? '';
const CASSANDRA_KEYSPACE   = process.env.CASSANDRA_KEYSPACE ?? 'jobflow';
const LOG_LEVEL            = process.env.LOG_LEVEL ?? 'info';
const IS_PROD              = process.env.NODE_ENV === 'production';

// ── Logger ────────────────────────────────────────────────────────────────────
const loggerOpts = { level: LOG_LEVEL };
if (!IS_PROD) loggerOpts.transport = { target: 'pino-pretty' };
const logger = pino(loggerOpts);

// ── Startup validation ────────────────────────────────────────────────────────
if (!SHIM_BEARER_TOKEN) {
  logger.fatal('SHIM_BEARER_TOKEN is required');
  process.exit(1);
}
if (CASSANDRA_CONTACT_POINTS.length === 0) {
  logger.fatal('CASSANDRA_CONTACT_POINTS is required');
  process.exit(1);
}
if (!CASSANDRA_LOCAL_DC) {
  logger.fatal('CASSANDRA_LOCAL_DC is required');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ── Request handler ───────────────────────────────────────────────────────────
async function handleRegister(req, res, client) {
  // Auth
  const auth = req.headers['authorization'] ?? '';
  if (auth !== `Bearer ${SHIM_BEARER_TOKEN}`) {
    return send(res, 401, { error: 'unauthorized' });
  }

  // Body
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'invalid JSON' });
  }

  // Validation
  if (typeof body.company !== 'string' || body.company.trim() === '') {
    return send(res, 400, { error: 'company must be a non-empty string' });
  }
  if (!Array.isArray(body.active_orgs) || body.active_orgs.length === 0) {
    return send(res, 400, { error: 'active_orgs must be a non-empty array' });
  }
  for (const org of body.active_orgs) {
    if (typeof org.org_name !== 'string' || org.org_name.trim() === '') {
      return send(res, 400, { error: 'each active_orgs entry must have a non-empty org_name' });
    }
    if (typeof org.last_repo_push !== 'string') {
      return send(res, 400, { error: 'each active_orgs entry must have a last_repo_push string' });
    }
  }

  // Per-org LWT writes
  const results = [];
  for (const { org_name } of body.active_orgs) {
    try {
      const status = await insertIfNotExists(client, { company: body.company, orgName: org_name });
      results.push({ org_name, status });
      logger.info({ company: body.company, org_name, status }, 'org write');
    } catch (err) {
      logger.error({ company: body.company, org_name, err }, 'cassandra write failed');
      return send(res, 500, { error: 'cassandra write failed', org_name });
    }
  }

  return send(res, 200, { company: body.company, results });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const client = buildClient({
    contactPoints: CASSANDRA_CONTACT_POINTS,
    localDc: CASSANDRA_LOCAL_DC,
    keyspace: CASSANDRA_KEYSPACE,
  });

  await client.connect();
  logger.info({ contactPoints: CASSANDRA_CONTACT_POINTS, keyspace: CASSANDRA_KEYSPACE }, 'cassandra connected');

  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/companies') {
      await handleRegister(req, res, client).catch(err => {
        logger.error({ err }, 'unhandled handler error');
        if (!res.headersSent) send(res, 500, { error: 'internal server error' });
      });
    } else {
      send(res, 404, { error: 'not found' });
    }
  });

  server.listen(SHIM_PORT, '127.0.0.1', () => {
    logger.info({ port: SHIM_PORT }, 'shim listening on localhost');
  });

  // Graceful shutdown: allow in-flight requests to drain before closing Cassandra.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      logger.info({ signal: sig }, 'shutting down');
      server.close(async () => {
        await client.shutdown();
        process.exit(0);
      });
    });
  }
}

main().catch(err => {
  logger.fatal({ err }, 'startup failed');
  process.exit(1);
});
