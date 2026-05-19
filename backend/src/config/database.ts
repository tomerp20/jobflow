import knex from 'knex';
import type { Knex } from 'knex';
import { env } from './env';

const config: Knex.Config = {
  client: 'pg',
  connection: {
    connectionString: env.DATABASE_URL,
    ssl: env.NODE_ENV === 'production' && env.DATABASE_URL.includes('.render.com')
      ? { rejectUnauthorized: false }
      : false,
  },
  pool: {
    min: 2,
    max: env.NODE_ENV === 'production' ? 20 : 10,
  },
};

const db = knex(config);

export default db;
