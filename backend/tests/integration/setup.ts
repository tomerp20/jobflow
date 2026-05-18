import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const integrationUrl = process.env.INTEGRATION_DATABASE_URL;
if (!integrationUrl) {
  throw new Error(
    'INTEGRATION_DATABASE_URL is required to run integration tests. ' +
      'Set it in the environment (CI) or in backend/.env (local).',
  );
}

process.env.DATABASE_URL = integrationUrl;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.LOG_LEVEL = 'silent';
