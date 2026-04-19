import { Client } from 'pg';
import type { Response } from 'express';
import logger from '../config/logger';

const BASE_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 60_000;

const sseClients = new Map<string, Set<Response>>();

function registerClient(userId: string, res: Response): void {
  if (!sseClients.has(userId)) {
    sseClients.set(userId, new Set());
  }
  sseClients.get(userId)!.add(res);
}

function removeClient(userId: string, res: Response): void {
  const clients = sseClients.get(userId);
  if (!clients) return;
  clients.delete(res);
  if (clients.size === 0) {
    sseClients.delete(userId);
  }
}

function notifyUser(userId: string, data: Record<string, unknown>): void {
  const clients = sseClients.get(userId);
  if (!clients) return;
  const dead: Response[] = [];
  for (const res of clients) {
    try {
      // res.write() returning false signals backpressure, not a broken connection —
      // only a thrown exception indicates the socket is truly gone.
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      dead.push(res);
    }
  }
  for (const res of dead) {
    clients.delete(res);
  }
  if (clients.size === 0) {
    sseClients.delete(userId);
  }
}

async function connect(retryDelay = BASE_RETRY_DELAY_MS): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required for pgSubscriber');
  }

  const requiresSsl =
    connectionString.includes('.render.com') || connectionString.includes('.neon.tech');
  const client = new Client({
    connectionString,
    ssl: requiresSsl ? { rejectUnauthorized: false } : false,
  });

  const scheduleReconnect = () => {
    client.end().catch(() => {
      // Ignore errors on cleanup — connection may already be broken
    });
    const nextDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
    logger.info(`pgSubscriber reconnecting in ${retryDelay}ms`);
    setTimeout(() => connect(nextDelay), retryDelay);
  };

  try {
    await client.connect();
    await client.query('LISTEN card_events');
    logger.info('pgSubscriber connected and listening on card_events');
  } catch (err) {
    logger.error('pgSubscriber failed to connect', { error: (err as Error).message });
    scheduleReconnect();
    return;
  }

  client.on('notification', (msg) => {
    try {
      const payload = JSON.parse(msg.payload ?? '') as Record<string, unknown>;
      const userId = payload.user_id as string;
      notifyUser(userId, payload);
    } catch (err) {
      logger.error('pgSubscriber failed to parse notification payload', {
        error: (err as Error).message,
        payload: msg.payload,
      });
    }
  });

  client.on('error', (err) => {
    logger.error('pgSubscriber client error', { error: err.message });
    scheduleReconnect();
  });
}

export const pgSubscriber = {
  connect,
  registerClient,
  removeClient,
};
