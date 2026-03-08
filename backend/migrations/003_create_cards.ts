import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE work_mode AS ENUM ('remote', 'hybrid', 'onsite');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE card_priority AS ENUM ('low', 'medium', 'high', 'critical');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  await knex.schema.createTable('cards', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.uuid('stage_id').notNullable().references('id').inTable('stages').onDelete('CASCADE');
    table.integer('position').notNullable().defaultTo(0);

    // Company info
    table.string('company_name', 255).notNullable();
    table.string('role_title', 255).notNullable();
    table.text('application_url');
    table.text('careers_url');
    table.string('source', 255); // LinkedIn, referral, company website, etc.
    table.string('location', 255);

    // Work mode & compensation
    table.specificType('work_mode', 'work_mode').defaultTo('remote');
    table.integer('salary_min');
    table.integer('salary_max');
    table.string('salary_currency', 3).defaultTo('USD');
    table.specificType('priority', 'card_priority').defaultTo('medium');

    // Notes & dates
    table.text('notes');
    table.date('date_applied');
    table.date('last_interaction_date');
    table.date('next_followup_date');

    // Contact
    table.string('recruiter_name', 255);
    table.string('recruiter_email', 255);

    // Categorization
    table.specificType('tech_stack', 'text[]').defaultTo('{}');
    table.specificType('tags', 'text[]').defaultTo('{}');
    table.integer('interest_level').defaultTo(3); // 1-5

    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    // Indexes
    table.index('user_id');
    table.index('stage_id');
    table.index('next_followup_date');
    table.index('priority');
    table.index('date_applied');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('cards');
  await knex.raw('DROP TYPE IF EXISTS work_mode');
  await knex.raw('DROP TYPE IF EXISTS card_priority');
}
