import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('processed_emails', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('gmail_message_id', 255).notNullable();
    table.text('subject').nullable();
    table.string('sender', 255).nullable();
    table.timestamp('received_at', { useTz: true }).nullable();
    table.timestamp('processed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.string('action', 50).notNullable();
    table.uuid('card_id').nullable().references('id').inTable('cards').onDelete('SET NULL');
    table.decimal('confidence', 5, 2).nullable();
    table.string('extracted_company', 255).nullable();

    table.unique(['user_id', 'gmail_message_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('processed_emails');
}
