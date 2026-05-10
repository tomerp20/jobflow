import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE stages
      DROP CONSTRAINT stages_user_id_position_unique;

    ALTER TABLE stages
      ADD CONSTRAINT stages_user_id_position_unique
      UNIQUE (user_id, position)
      DEFERRABLE INITIALLY DEFERRED;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE stages
      DROP CONSTRAINT stages_user_id_position_unique;

    ALTER TABLE stages
      ADD CONSTRAINT stages_user_id_position_unique
      UNIQUE (user_id, position);
  `);
}
