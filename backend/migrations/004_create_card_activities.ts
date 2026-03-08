import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('card_activities', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('card_id').notNullable().references('id').inTable('cards').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('action', 100).notNullable(); // 'created', 'updated', 'moved', 'note_added'
    table.string('field_changed', 100);
    table.text('old_value');
    table.text('new_value');
    table.text('note');
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.index('card_id');
    table.index('user_id');
    table.index('created_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('card_activities');
}
