import knex from 'knex';
import type { Knex } from 'knex';
import dotenv from 'dotenv';

dotenv.config();

const environment = process.env.NODE_ENV || 'development';

const config: Knex.Config = {
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL || 'postgresql://jobflow:jobflow@localhost:5432/jobflow',
    ssl: environment === 'production' && (process.env.DATABASE_URL || '').includes('.render.com')
      ? { rejectUnauthorized: false }
      : false,
  },
  pool: {
    min: 2,
    max: environment === 'production' ? 20 : 10,
  },
};

const db = knex(config);

export default db;
