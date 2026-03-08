"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.alterTable('stages', function (table) {
        table.integer('width').nullable().defaultTo(null);
    });
}
async function down(knex) {
    await knex.schema.alterTable('stages', function (table) {
        table.dropColumn('width');
    });
}
