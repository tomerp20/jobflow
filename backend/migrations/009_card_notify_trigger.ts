import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION notify_card_event()
    RETURNS trigger AS $$
    DECLARE
      payload TEXT;
      event_type TEXT;
      card_id TEXT;
      user_id TEXT;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        card_id    := OLD.id;
        user_id    := OLD.user_id;
        event_type := 'card.deleted';
      ELSIF TG_OP = 'INSERT' THEN
        card_id    := NEW.id;
        user_id    := NEW.user_id;
        event_type := 'card.created';
      ELSIF TG_OP = 'UPDATE' THEN
        card_id    := NEW.id;
        user_id    := NEW.user_id;
        IF OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
          event_type := 'card.moved';
        ELSE
          event_type := 'card.updated';
        END IF;
      END IF;

      -- pg_notify enforces an 8000-byte payload limit; this payload is
      -- intentionally minimal (event, card_id, user_id) to stay well under it.
      payload := json_build_object(
        'event',   event_type,
        'card_id', card_id,
        'user_id', user_id
      )::TEXT;

      PERFORM pg_notify('card_events', payload);

      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Drop before re-creating so up() is idempotent if re-run after a partial failure.
  await knex.raw(`DROP TRIGGER IF EXISTS card_notify_trigger ON cards;`);

  await knex.raw(`
    CREATE TRIGGER card_notify_trigger
    AFTER INSERT OR UPDATE OR DELETE ON cards
    FOR EACH ROW EXECUTE FUNCTION notify_card_event();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP TRIGGER IF EXISTS card_notify_trigger ON cards;`);
  // CASCADE ensures rollback succeeds even if other objects reference the function.
  await knex.raw(`DROP FUNCTION IF EXISTS notify_card_event() CASCADE;`);
}
