import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('gmail_tokens', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    table.uuid('user_id').notNullable().unique().references('id').inTable('users').onDelete('CASCADE');
    table.string('gmail_address', 255).notNullable();
    table.text('access_token').notNullable();
    table.text('refresh_token').notNullable();
    table.timestamp('token_expiry', { useTz: true }).notNullable();
    table.boolean('is_valid').notNullable().defaultTo(true);
    table.timestamp('last_sync_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('gmail_tokens');
}
