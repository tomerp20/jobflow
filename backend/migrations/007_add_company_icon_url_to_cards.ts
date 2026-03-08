import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. Add column
  await knex.schema.alterTable('cards', (table) => {
    table.text('company_icon_url').nullable().defaultTo(null);
  });

  // 2. Backfill existing cards
  const cards = await knex('cards').select('id', 'company_name', 'application_url', 'careers_url');
  for (const card of cards) {
    let domain: string | null = null;
    // Try application_url first
    for (const url of [card.application_url, card.careers_url]) {
      if (url) {
        try {
          const hostname = new URL(url).hostname;
          const parts = hostname.split('.');
          domain = parts.slice(-2).join('.');
          break;
        } catch {}
      }
    }
    // Fall back to company name
    if (!domain && card.company_name) {
      domain = card.company_name.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
    }
    if (domain) {
      await knex('cards').where('id', card.id).update({
        company_icon_url: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cards', (table) => {
    table.dropColumn('company_icon_url');
  });
}
