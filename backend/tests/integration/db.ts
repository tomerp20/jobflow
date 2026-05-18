import knex, { type Knex } from 'knex';

let instance: Knex | null = null;

export function getDb(): Knex {
  if (instance) return instance;

  const url = process.env.INTEGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('INTEGRATION_DATABASE_URL must be set before calling getDb()');
  }

  instance = knex({
    client: 'pg',
    connection: url,
    pool: { min: 1, max: 5 },
  });

  return instance;
}

export async function destroyDb(): Promise<void> {
  if (instance) {
    await instance.destroy();
    instance = null;
  }
}

const PROTECTED_TABLES = new Set(['knex_migrations', 'knex_migrations_lock']);

export async function truncateAll(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select<Array<{ tablename: string }>>('tablename')
    .from('pg_tables')
    .where('schemaname', 'public');

  const targets = rows
    .map((r) => r.tablename)
    .filter((name) => !PROTECTED_TABLES.has(name));

  if (targets.length === 0) return;

  const quoted = targets.map((t) => `"${t}"`).join(', ');
  await db.raw(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}
