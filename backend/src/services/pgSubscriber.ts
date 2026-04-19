import { Client } from 'pg';
import type { Response } from 'express';
import logger from '../config/logger';

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

function notifyUser(userId: string, data: object): void {
  const clients = sseClients.get(userId);
  if (!clients) return;
  for (const res of clients) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

async function connect(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();
    await client.query('LISTEN card_events');
    logger.info('pgSubscriber connected and listening on card_events');
  } catch (err) {
    logger.error('pgSubscriber failed to connect', { error: (err as Error).message });
    setTimeout(() => connect(), 5000);
    return;
  }

  client.on('notification', (msg) => {
    try {
      const payload = JSON.parse(msg.payload ?? '');
      const userId: string = payload.user_id;
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
    setTimeout(() => connect(), 5000);
  });
}

export const pgSubscriber = {
  connect,
  registerClient,
  removeClient,
};
