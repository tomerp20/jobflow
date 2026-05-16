/**
 * Truncates all tables in FK-safe order, then seeds one test user
 * and their default Stages. Called by `npm run seed:test` from the repo root.
 *
 * Requires TEST_DATABASE_URL set in the environment before calling.
 * The test:e2e shell script and CI workflow both export it first.
 */
import knex from 'knex';
import bcrypt from 'bcryptjs';

export const TEST_USER_EMAIL = 'test@jobflow.io';
export const TEST_USER_PASSWORD = 'Test1234!';
export const TEST_USER_NAME = 'Test User';

const DEFAULT_STAGES = [
  'Wishlist',
  'Applied',
  'Recruiter Call',
  'Technical Screen',
  'Home Assignment',
  'Final Interview',
  'Offer',
  'Rejected',
  'Accepted',
];

const dbUrl = process.env.TEST_DATABASE_URL;
if (!dbUrl) {
  console.error('TEST_DATABASE_URL is not set.');
  process.exit(1);
}

const db = knex({
  client: 'pg',
  connection: { connectionString: dbUrl, ssl: { rejectUnauthorized: false } },
});

async function seed(): Promise<void> {
  await db.raw(`
    TRUNCATE TABLE
      processed_emails,
      card_activities,
      todo_items,
      notifications,
      cards,
      gmail_tokens,
      refresh_tokens,
      stages,
      users
    CASCADE
  `);

  const [user] = await db('users')
    .insert({
      email: TEST_USER_EMAIL,
      password_hash: await bcrypt.hash(TEST_USER_PASSWORD, 12),
      name: TEST_USER_NAME,
    })
    .returning('id');

  await db('stages').insert(
    DEFAULT_STAGES.map((name, index) => ({
      user_id: user.id,
      name,
      position: index,
      is_default: true,
      is_rejection_stage: name === 'Rejected',
    })),
  );

  console.log(`Seeded test user: ${TEST_USER_EMAIL}`);
  console.log(`Created ${DEFAULT_STAGES.length} default Stages.`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => db.destroy());
