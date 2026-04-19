import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import logger from './config/logger';
import db from './config/database';
import { pgSubscriber } from './services/pgSubscriber';

const PORT = parseInt(process.env.PORT || '3001', 10);

async function start() {
  // Verify database connection
  try {
    await db.raw('SELECT 1');
    logger.info('Database connection established');
  } catch (err) {
    logger.error('Failed to connect to database', { error: (err as Error).message });
    process.exit(1);
  }

  await pgSubscriber.connect();

  app.listen(PORT, () => {
    logger.info('JobFlow API server started', {
      port: PORT,
      environment: process.env.NODE_ENV || 'development',
      pid: process.pid,
    });
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await db.destroy();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await db.destroy();
  process.exit(0);
});

start();
