const { env } = require('./dist/config/env.js');

const requiresSsl = env.DATABASE_URL.includes('.render.com') || env.DATABASE_URL.includes('.neon.tech');

module.exports = {
  client: 'pg',
  connection: {
    connectionString: env.DATABASE_URL,
    ssl: requiresSsl ? { rejectUnauthorized: false } : false,
  },
  searchPath: ['public'],
  migrations: {
    directory: './dist-migrations',
  },
  pool: {
    min: 2,
    max: 20,
  },
};
