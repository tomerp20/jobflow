import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('stages', (table) => {
    table.boolean('is_rejection_stage').notNullable().defaultTo(false);
  });
  await knex.raw(`UPDATE stages SET is_rejection_stage = true WHERE name = 'Rejected'`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('stages', (table) => {
    table.dropColumn('is_rejection_stage');
  });
}
