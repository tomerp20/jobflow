import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE todo_priority AS ENUM ('low', 'medium', 'high', 'urgent');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  await knex.raw(`
    DO $$ BEGIN
      CREATE TYPE todo_status AS ENUM ('active', 'completed');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  await knex.schema.createTable('todo_items', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.uuid('card_id').nullable().references('id').inTable('cards').onDelete('SET NULL');
    table.text('description').notNullable();
    table.specificType('priority', 'todo_priority').notNullable().defaultTo('medium');
    table.specificType('status', 'todo_status').notNullable().defaultTo('active');
    table.integer('position').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Indexes for common query patterns
    table.index(['user_id', 'status']);
    table.index('card_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('todo_items');
  await knex.raw('DROP TYPE IF EXISTS todo_priority');
  await knex.raw('DROP TYPE IF EXISTS todo_status');
}
