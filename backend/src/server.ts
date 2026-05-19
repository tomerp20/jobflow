import './config/env';
import { env } from './config/env';
import app from './app';
import logger from './config/logger';
import db from './config/database';
import { pgSubscriber } from './services/pgSubscriber';

async function start() {
  // Verify database connection
  try {
    await db.raw('SELECT 1');
    logger.info('Database connection established');
  } catch (err) {
    logger.error('Failed to connect to database', { error: (err as Error).message });
    process.exit(1);
  }

  pgSubscriber.connect(); // non-blocking: retries in background on failure

  app.listen(env.PORT, () => {
    logger.info('JobFlow API server started', {
      port: env.PORT,
      environment: env.NODE_ENV,
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
