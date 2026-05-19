import { execSync } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';

export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

  const integrationUrl = process.env.INTEGRATION_DATABASE_URL;
  if (!integrationUrl) {
    throw new Error(
      'INTEGRATION_DATABASE_URL is required to run integration tests. ' +
        'Set it in the environment (CI) or in backend/.env (local).',
    );
  }

  const backendRoot = path.resolve(__dirname, '..', '..');
  execSync('npx ts-node ./node_modules/.bin/knex migrate:latest --knexfile knexfile.ts', {
    cwd: backendRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: integrationUrl,
      NODE_ENV: 'test',
      // env.ts validates JWT_SECRET at import time; migrations don't use JWT but
      // knexfile.ts imports env, so a placeholder satisfying min(32) is required.
      JWT_SECRET: process.env.JWT_SECRET ?? 'test-jwt-secret-for-migrations-32chars!!',
    },
  });
}
