import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('notifications', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('title', 255).notNullable();
    table.text('body').notNullable();
    table.jsonb('metadata');
    table.timestamp('read_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE OR REPLACE FUNCTION notify_notification_event()
    RETURNS trigger AS $$
    DECLARE
      payload TEXT;
    BEGIN
      payload := json_build_object(
        'user_id',         NEW.user_id,
        'notification_id', NEW.id
      )::TEXT;

      PERFORM pg_notify('notification_events', payload);

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`DROP TRIGGER IF EXISTS notification_notify_trigger ON notifications;`);

  await knex.raw(`
    CREATE TRIGGER notification_notify_trigger
    AFTER INSERT ON notifications
    FOR EACH ROW EXECUTE FUNCTION notify_notification_event();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TRIGGER IF EXISTS notification_notify_trigger ON notifications;`);
  await knex.raw(`DROP FUNCTION IF EXISTS notify_notification_event() CASCADE;`);
  await knex.schema.dropTableIfExists('notifications');
}
