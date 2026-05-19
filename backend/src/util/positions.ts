import { Knex } from 'knex';

export type Scope = Record<string, string | number>;

export interface ShiftArgs {
  trx: Knex.Transaction;
  table: 'stages' | 'cards' | 'todo_items';
  scope: Scope;
  fromPos: number;
  toPos?: number;
}

export interface RenumberArgs {
  trx: Knex.Transaction;
  table: 'stages' | 'cards' | 'todo_items';
  scope: Scope;
  orderedIds: string[];
  idColumn?: string;
}

export async function shiftUp(args: ShiftArgs): Promise<number> {
  const { trx, table, scope, fromPos, toPos } = args;
  let q = trx(table).where(scope).andWhere('position', '>=', fromPos);
  if (toPos !== undefined) q = q.andWhere('position', '<=', toPos);
  return q.increment('position', 1);
}

export async function shiftDown(args: ShiftArgs): Promise<number> {
  const { trx, table, scope, fromPos, toPos } = args;
  let q = trx(table).where(scope).andWhere('position', '>', fromPos);
  if (toPos !== undefined) q = q.andWhere('position', '<=', toPos);
  return q.decrement('position', 1);
}

// Two-phase to avoid UNIQUE(scope, position) constraint violations within a transaction.
// Phase 1 moves rows to unique negative sentinels; phase 2 assigns final 0..N-1 positions.
export async function renumber(args: RenumberArgs): Promise<void> {
  const { trx, table, scope, orderedIds, idColumn = 'id' } = args;
  const N = orderedIds.length;
  for (let i = 0; i < N; i++) {
    await trx(table)
      .where({ ...scope, [idColumn]: orderedIds[i] })
      .update({ position: -(N + i + 1) });
  }
  for (let i = 0; i < N; i++) {
    await trx(table)
      .where({ ...scope, [idColumn]: orderedIds[i] })
      .update({ position: i });
  }
}

// Joins caller's trx when present, otherwise opens its own.
export async function withTransaction<T>(
  knex: Knex,
  trx: Knex.Transaction | undefined,
  fn: (t: Knex.Transaction) => Promise<T>,
): Promise<T> {
  if (trx) return fn(trx);
  return knex.transaction(fn);
}
