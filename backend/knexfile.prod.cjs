require('dotenv').config();

const isExternal = (process.env.DATABASE_URL || '').includes('.render.com');

module.exports = {
  client: 'pg',
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: isExternal ? { rejectUnauthorized: false } : false,
  },
  migrations: {
    directory: './dist-migrations',
  },
  pool: {
    min: 2,
    max: 20,
  },
};
