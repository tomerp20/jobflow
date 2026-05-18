import { destroyDb, getDb, truncateAll } from './db';

describe('integration harness smoke', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await truncateAll();
    await destroyDb();
  });

  it('connects to the integration database', async () => {
    const db = getDb();
    const result = await db.raw<{ rows: Array<{ ok: number }> }>('select 1 as ok');
    expect(result.rows[0].ok).toBe(1);
  });

  it('inserts a row, queries it back, and truncates it', async () => {
    const db = getDb();
    const email = `smoke-${Date.now()}@integration.test`;

    const [inserted] = await db('users')
      .insert({
        email,
        password_hash: 'unused',
        name: 'Smoke',
      })
      .returning(['id', 'email']);

    expect(inserted.email).toBe(email);

    const found = await db('users').where({ id: inserted.id }).first();
    expect(found?.email).toBe(email);

    await truncateAll();

    const remaining = await db('users').count<{ count: string }[]>('* as count');
    expect(Number(remaining[0].count)).toBe(0);
  });
});
