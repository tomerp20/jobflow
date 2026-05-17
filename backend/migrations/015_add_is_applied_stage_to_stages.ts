import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('stages', (table) => {
    table.boolean('is_applied_stage').notNullable().defaultTo(false);
  });
  await knex.raw(`UPDATE stages SET is_applied_stage = true WHERE LOWER(name) = 'applied'`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('stages', (table) => {
    table.dropColumn('is_applied_stage');
  });
}
