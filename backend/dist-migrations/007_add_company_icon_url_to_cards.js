"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.alterTable('cards', function (table) {
        table.text('company_icon_url').nullable().defaultTo(null);
    });
    const cards = await knex('cards').select('id', 'company_name', 'application_url', 'careers_url');
    for (const card of cards) {
        let domain = null;
        for (const url of [card.application_url, card.careers_url]) {
            if (url) {
                try {
                    const hostname = new URL(url).hostname;
                    const parts = hostname.split('.');
                    domain = parts.slice(-2).join('.');
                    break;
                } catch (_) {}
            }
        }
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
async function down(knex) {
    await knex.schema.alterTable('cards', function (table) {
        table.dropColumn('company_icon_url');
    });
}
