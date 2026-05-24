import http from 'node:http';
import crypto from 'node:crypto';
import pino from 'pino';
import { buildClient, insertIfNotExists } from './lib/cassandra.js';

// ── Env config ───────────────────────────────────────────────────────────────
const SHIM_PORT            = parseInt(process.env.SHIM_PORT ?? '3333', 10);
const SHIM_BIND_ADDRESS    = process.env.SHIM_BIND_ADDRESS ?? '127.0.0.1';
const SHIM_BEARER_TOKEN    = process.env.SHIM_BEARER_TOKEN ?? '';
const CASSANDRA_CONTACT_POINTS = (process.env.CASSANDRA_CONTACT_POINTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
const CASSANDRA_LOCAL_DC   = process.env.CASSANDRA_LOCAL_DC ?? '';
const CASSANDRA_KEYSPACE   = process.env.CASSANDRA_KEYSPACE ?? 'jobflow';
const LOG_LEVEL            = process.env.LOG_LEVEL ?? 'info';
const IS_PROD              = process.env.NODE_ENV === 'production';

// 64 KB is generous for a per-Company batch (largest plausible Wix-style payload
// is well under 4 KB); larger requests are rejected before parsing to bound
// memory and rule out trivial DoS.
const MAX_BODY_BYTES = 64 * 1024;

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

// Pre-encode the expected Authorization header once so request-time comparison
// is fixed-length and constant-time (see checkAuth).
const EXPECTED_AUTH_BUFFER = Buffer.from(`Bearer ${SHIM_BEARER_TOKEN}`);

// ── Helpers ───────────────────────────────────────────────────────────────────
function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

// Constant-time bearer check. A naive `!==` leaks token bytes via timing
// (each match continues comparison further; mismatches return early). Comparing
// fixed-length buffers with timingSafeEqual closes that side channel.
function checkAuth(req) {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return false;
  const provided = Buffer.from(header);
  if (provided.length !== EXPECTED_AUTH_BUFFER.length) return false;
  return crypto.timingSafeEqual(provided, EXPECTED_AUTH_BUFFER);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        // Destroy the socket so the client doesn't keep streaming a giant body
        // we'll never accept.
        req.destroy();
        const err = new Error('payload too large');
        err.statusCode = 413;
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ── Request handler ───────────────────────────────────────────────────────────
async function handleRegister(req, res, client) {
  // Auth
  if (!checkAuth(req)) {
    return send(res, 401, { error: 'unauthorized' });
  }

  // Content-Type — fail early if the client sent something we can't parse
  const contentType = (req.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return send(res, 415, { error: 'content-type must be application/json' });
  }

  // Body
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    if (err && err.statusCode === 413) {
      return send(res, 413, { error: 'payload too large' });
    }
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
    // `last_repo_push` is part of the agreed wire contract (ADR 0010) and is
    // required so producers cannot silently drift. The current Cassandra schema
    // for `jobflow.companies` does not yet store this column; it is preserved
    // in structured logs (the `org write` line below). When the schema gains a
    // `last_repo_push timestamp` column, switch insertIfNotExists to write it.
    if (typeof org.last_repo_push !== 'string') {
      return send(res, 400, { error: 'each active_orgs entry must have a last_repo_push string' });
    }
  }

  // Per-org LWT writes
  const results = [];
  for (const { org_name, last_repo_push } of body.active_orgs) {
    try {
      const status = await insertIfNotExists(client, { company: body.company, orgName: org_name });
      results.push({ org_name, status });
      logger.info({ company: body.company, org_name, last_repo_push, status }, 'org write');
    } catch (err) {
      logger.error({ company: body.company, org_name, err }, 'cassandra write failed');
      return send(res, 500, { error: 'cassandra write failed', org_name });
    }
  }

  return send(res, 200, { company: body.company, results });
}

// ── Main ──────────────────────────────────────────────────────────────────────
// Hoisted so the top-level main().catch() can clean up if startup fails after
// the Cassandra client has been created but before steady state.
let client = null;

async function main() {
  client = buildClient({
    contactPoints: CASSANDRA_CONTACT_POINTS,
    localDc: CASSANDRA_LOCAL_DC,
    keyspace: CASSANDRA_KEYSPACE,
  });

  await client.connect();
  logger.info({ contactPoints: CASSANDRA_CONTACT_POINTS, keyspace: CASSANDRA_KEYSPACE }, 'cassandra connected');

  const server = http.createServer(async (req, res) => {
    // Liveness check — unauthenticated; used by the RUNBOOK smoke test
    // and any external monitor (e.g. ngrok proxies it as-is, no header needed).
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { status: 'ok' });
    }
    if (req.method === 'POST' && req.url === '/companies') {
      await handleRegister(req, res, client).catch(err => {
        logger.error({ err }, 'unhandled handler error');
        if (!res.headersSent) send(res, 500, { error: 'internal server error' });
      });
    } else {
      send(res, 404, { error: 'not found' });
    }
  });

  // Slowloris mitigation — bound the time a single request can monopolise a
  // socket. Values are generous for our latency profile (Cassandra LWTs may
  // take a few hundred ms each, batch up to 20 Orgs per Company).
  server.requestTimeout = 30_000; // 30s overall request
  server.headersTimeout = 10_000; // 10s to receive request headers

  server.listen(SHIM_PORT, SHIM_BIND_ADDRESS, () => {
    logger.info({ port: SHIM_PORT, bind: SHIM_BIND_ADDRESS }, 'shim listening');
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

main().catch(async err => {
  logger.fatal({ err }, 'startup failed');
  if (client) {
    try { await client.shutdown(); } catch { /* best-effort cleanup */ }
  }
  process.exit(1);
});
