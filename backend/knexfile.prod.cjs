require('dotenv').config();

const dbUrl = process.env.DATABASE_URL || '';
const requiresSsl = dbUrl.includes('.render.com') || dbUrl.includes('.neon.tech');

module.exports = {
  client: 'pg',
  connection: {
    connectionString: dbUrl,
    ssl: requiresSsl ? { rejectUnauthorized: false } : false,
  },
  migrations: {
    directory: './dist-migrations',
  },
  pool: {
    min: 2,
    max: 20,
  },
};
