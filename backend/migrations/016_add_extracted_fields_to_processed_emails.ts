import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('processed_emails', (table) => {
    table.string('extracted_role_title', 255).nullable();
    table.text('extracted_job_url').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('processed_emails', (table) => {
    table.dropColumn('extracted_role_title');
    table.dropColumn('extracted_job_url');
  });
}
