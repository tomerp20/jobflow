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

// Set required env vars before any src module loads env.ts
process.env.DATABASE_URL = integrationUrl;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters!!';
process.env.LOG_LEVEL = 'silent';
