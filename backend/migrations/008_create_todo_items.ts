import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('todo_items', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.uuid('card_id').nullable().references('id').inTable('cards').onDelete('SET NULL');
    table.text('description').notNullable();
    table.enum('priority', ['low', 'medium', 'high', 'urgent']).notNullable().defaultTo('medium');
    table.enum('status', ['active', 'completed']).notNullable().defaultTo('active');
    table.integer('position').nullable();
    table.timestamps(true, true);

    // Indexes for common query patterns
    table.index(['user_id', 'status']);
    table.index('card_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('todo_items');
}
