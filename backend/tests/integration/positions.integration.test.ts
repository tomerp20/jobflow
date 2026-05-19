import { destroyDb, getDb, truncateAll } from './db';
import { shiftUp, shiftDown, renumber, withTransaction } from '../../src/util/positions';
import { cardService } from '../../src/services/cardService';

const EMAIL = 'positions-test@integration.test';
const OTHER_EMAIL = 'positions-other@integration.test';

let userId: string;
let otherUserId: string;

beforeAll(async () => {
  const db = getDb();
  const [u1] = await db('users')
    .insert({ email: EMAIL, password_hash: 'x', name: 'Test' })
    .returning('id');
  const [u2] = await db('users')
    .insert({ email: OTHER_EMAIL, password_hash: 'x', name: 'Other' })
    .returning('id');
  userId = u1.id;
  otherUserId = u2.id;
});

beforeEach(async () => {
  const db = getDb();
  // Truncate only the ordered tables, preserve the users created in beforeAll
  await db.raw('TRUNCATE TABLE todo_items, cards, stages RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await truncateAll();
  await destroyDb();
});

async function insertStage(pos: number, uid = userId): Promise<string> {
  const db = getDb();
  const [row] = await db('stages')
    .insert({ user_id: uid, name: `Stage ${pos}`, position: pos })
    .returning('id');
  return row.id;
}

async function insertCard(stageId: string, pos: number, uid = userId): Promise<string> {
  const db = getDb();
  const [row] = await db('cards')
    .insert({
      user_id: uid,
      stage_id: stageId,
      company_name: `Co ${pos}`,
      role_title: `Role ${pos}`,
      position: pos,
    })
    .returning('id');
  return row.id;
}

async function insertTodo(pos: number | null, uid = userId): Promise<string> {
  const db = getDb();
  const [row] = await db('todo_items')
    .insert({ user_id: uid, description: `Todo ${pos}`, priority: 'medium', status: 'active', position: pos })
    .returning('id');
  return row.id;
}

async function stagePositions(uid = userId): Promise<number[]> {
  const db = getDb();
  const rows = await db('stages').where({ user_id: uid }).orderBy('position');
  return rows.map((r: { position: number }) => r.position);
}

async function cardPositions(stageId: string, uid = userId): Promise<number[]> {
  const db = getDb();
  const rows = await db('cards').where({ user_id: uid, stage_id: stageId }).orderBy('position');
  return rows.map((r: { position: number }) => r.position);
}

async function todoPositions(uid = userId): Promise<(number | null)[]> {
  const db = getDb();
  const rows = await db('todo_items').where({ user_id: uid }).orderByRaw('position ASC NULLS LAST');
  return rows.map((r: { position: number | null }) => r.position);
}

// ── shiftUp ───────────────────────────────────────────────────────────────────

describe('shiftUp', () => {
  it('shifts only rows at-or-after fromPos within scope', async () => {
    const db = getDb();
    const s0 = await insertStage(0);
    const s1 = await insertStage(1);
    const s2 = await insertStage(2);
    void s0; void s2;

    await db.transaction(async (trx) => {
      await shiftUp({ trx, table: 'stages', scope: { user_id: userId }, fromPos: 1 });
    });

    expect(await stagePositions()).toEqual([0, 2, 3]);
    // row at 0 was not shifted
    const unchanged = await db('stages').where({ id: s0 }).first();
    expect(unchanged.position).toBe(0);
  });

  it('leaves rows in other scopes untouched', async () => {
    const db = getDb();
    await insertStage(0);
    await insertStage(1);
    await insertStage(0, otherUserId);

    await db.transaction(async (trx) => {
      await shiftUp({ trx, table: 'stages', scope: { user_id: userId }, fromPos: 0 });
    });

    expect(await stagePositions()).toEqual([1, 2]);
    expect(await stagePositions(otherUserId)).toEqual([0]); // untouched
  });

  it('respects toPos upper bound', async () => {
    // Use todo_items (no UNIQUE position constraint) — shiftUp with toPos leaves
    // duplicate positions in the committed state, which stages would reject.
    const db = getDb();
    await insertTodo(0);
    await insertTodo(1);
    await insertTodo(2);
    await insertTodo(3);

    await db.transaction(async (trx) => {
      await shiftUp({ trx, table: 'todo_items', scope: { user_id: userId }, fromPos: 1, toPos: 2 });
    });

    // positions 1 and 2 shift up; 0 and 3 stay
    expect(await todoPositions()).toEqual([0, 2, 3, 3]);
  });
});

// ── shiftDown ─────────────────────────────────────────────────────────────────

describe('shiftDown', () => {
  // All shiftDown boundary tests use todo_items (no UNIQUE position constraint).
  // shiftDown produces duplicate positions in the committed state (e.g. [0,1,1])
  // because it is designed to be paired with a preceding row deletion; in isolation
  // the "gap" that deletion would create doesn't exist yet. stages would reject such
  // states at COMMIT via UNIQUE(user_id, position) DEFERRABLE INITIALLY DEFERRED.

  it('uses strict > so the row at fromPos is not shifted', async () => {
    const db = getDb();
    await insertTodo(0);
    const todoAtFromPos = await insertTodo(1);
    await insertTodo(2);

    await db.transaction(async (trx) => {
      await shiftDown({ trx, table: 'todo_items', scope: { user_id: userId }, fromPos: 1 });
    });

    expect(await todoPositions()).toEqual([0, 1, 1]);
    // the todo at fromPos=1 is NOT shifted (strict >)
    const unchanged = await db('todo_items').where({ id: todoAtFromPos }).first();
    expect(unchanged.position).toBe(1);
  });

  it('leaves rows in other scopes untouched', async () => {
    const db = getDb();
    await insertTodo(0);
    await insertTodo(1);
    await insertTodo(0, otherUserId);
    await insertTodo(1, otherUserId);

    await db.transaction(async (trx) => {
      await shiftDown({ trx, table: 'todo_items', scope: { user_id: userId }, fromPos: 0 });
    });

    expect(await todoPositions()).toEqual([0, 0]);
    expect(await todoPositions(otherUserId)).toEqual([0, 1]); // untouched
  });

  it('respects toPos upper bound', async () => {
    const db = getDb();
    await insertTodo(0);
    await insertTodo(1);
    await insertTodo(2);
    await insertTodo(3);

    await db.transaction(async (trx) => {
      await shiftDown({ trx, table: 'todo_items', scope: { user_id: userId }, fromPos: 0, toPos: 2 });
    });

    // positions 1 and 2 shift down (0 is not >0, 3 is above toPos)
    expect(await todoPositions()).toEqual([0, 0, 1, 3]);
  });
});

// ── renumber ──────────────────────────────────────────────────────────────────

describe('renumber', () => {
  it('assigns 0..N-1 positions matching the supplied order', async () => {
    const db = getDb();
    const id0 = await insertStage(0);
    const id1 = await insertStage(1);
    const id2 = await insertStage(2);

    await db.transaction(async (trx) => {
      await renumber({
        trx,
        table: 'stages',
        scope: { user_id: userId },
        orderedIds: [id2, id0, id1],
      });
    });

    const rows = await db('stages').where({ user_id: userId }).orderBy('position');
    expect(rows[0].id).toBe(id2);
    expect(rows[1].id).toBe(id0);
    expect(rows[2].id).toBe(id1);
    expect(rows.map((r: { position: number }) => r.position)).toEqual([0, 1, 2]);
  });

  it('survives the UNIQUE(user_id, position) constraint on stages', async () => {
    const db = getDb();
    const id0 = await insertStage(0);
    const id1 = await insertStage(1);
    const id2 = await insertStage(2);

    // Reverse order — would conflict without the two-phase approach
    await expect(
      db.transaction(async (trx) => {
        await renumber({
          trx,
          table: 'stages',
          scope: { user_id: userId },
          orderedIds: [id2, id1, id0],
        });
      }),
    ).resolves.not.toThrow();

    expect(await stagePositions()).toEqual([0, 1, 2]);
  });

  it('only renumbers rows in the given scope', async () => {
    const db = getDb();
    const id0 = await insertStage(0);
    const id1 = await insertStage(1);
    await insertStage(0, otherUserId);

    await db.transaction(async (trx) => {
      await renumber({
        trx,
        table: 'stages',
        scope: { user_id: userId },
        orderedIds: [id1, id0],
      });
    });

    expect(await stagePositions()).toEqual([0, 1]);
    expect(await stagePositions(otherUserId)).toEqual([0]); // untouched
  });
});

// ── withTransaction ───────────────────────────────────────────────────────────

describe('withTransaction', () => {
  it('opens its own transaction when trx is undefined', async () => {
    const db = getDb();
    const id = await insertStage(0);

    await withTransaction(db, undefined, async (trx) => {
      await trx('stages').where({ id }).update({ name: 'Updated' });
    });

    const row = await db('stages').where({ id }).first();
    expect(row.name).toBe('Updated');
  });

  it('joins an existing transaction instead of opening a new one', async () => {
    const db = getDb();
    const id = await insertStage(0);

    await db.transaction(async (outer) => {
      await withTransaction(db, outer, async (t) => {
        // t should be the same transaction object
        expect(t).toBe(outer);
        await t('stages').where({ id }).update({ name: 'Inner' });
      });
    });

    const row = await db('stages').where({ id }).first();
    expect(row.name).toBe('Inner');
  });

  it('rolls back all writes if the inner function throws', async () => {
    const db = getDb();
    const id = await insertStage(0);

    await expect(
      withTransaction(db, undefined, async (trx) => {
        await trx('stages').where({ id }).update({ name: 'ShouldRollBack' });
        throw new Error('deliberate failure');
      }),
    ).rejects.toThrow('deliberate failure');

    const row = await db('stages').where({ id }).first();
    expect(row.name).toBe('Stage 0'); // original name preserved
  });
});

// ── card scope isolation ──────────────────────────────────────────────────────

describe('card scope isolation', () => {
  it('shiftDown on cards only affects the target stage', async () => {
    const db = getDb();
    const stage1 = await insertStage(0);
    const stage2 = await insertStage(1);

    await insertCard(stage1, 0);
    await insertCard(stage1, 1);
    await insertCard(stage1, 2);
    await insertCard(stage2, 0);
    await insertCard(stage2, 1);

    await db.transaction(async (trx) => {
      await shiftDown({ trx, table: 'cards', scope: { user_id: userId, stage_id: stage1 }, fromPos: 0 });
    });

    expect(await cardPositions(stage1)).toEqual([0, 0, 1]);
    expect(await cardPositions(stage2)).toEqual([0, 1]); // untouched
  });
});

// ── moveCard within the same stage (drag-within-column) ─────────────────────

describe('cardService.moveCard — same stage', () => {
  it('produces correct final positions when moving down within a column', async () => {
    const s = await insertStage(0);
    const c0 = await insertCard(s, 0);
    const c1 = await insertCard(s, 1);
    const c2 = await insertCard(s, 2);
    const c3 = await insertCard(s, 3);
    const c4 = await insertCard(s, 4);

    // Drag the bottom card (position 4) to the top (position 0)
    await cardService.moveCard(c4, userId, s, 0);

    const rows = await getDb()('cards')
      .where({ user_id: userId, stage_id: s })
      .orderBy('position');
    expect(rows.map((r: { id: string }) => r.id)).toEqual([c4, c0, c1, c2, c3]);
    expect(rows.map((r: { position: number }) => r.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it('produces correct final positions when moving up within a column', async () => {
    const s = await insertStage(0);
    const c0 = await insertCard(s, 0);
    const c1 = await insertCard(s, 1);
    const c2 = await insertCard(s, 2);
    const c3 = await insertCard(s, 3);
    const c4 = await insertCard(s, 4);

    // Drag position 0 down to position 3
    await cardService.moveCard(c0, userId, s, 3);

    const rows = await getDb()('cards')
      .where({ user_id: userId, stage_id: s })
      .orderBy('position');
    expect(rows.map((r: { id: string }) => r.id)).toEqual([c1, c2, c3, c0, c4]);
    expect(rows.map((r: { position: number }) => r.position)).toEqual([0, 1, 2, 3, 4]);
  });
});

// ── todo null positions ───────────────────────────────────────────────────────

describe('todo null positions', () => {
  it('shiftDown does not affect todos with null positions', async () => {
    const db = getDb();
    await insertTodo(0);
    await insertTodo(1);
    await insertTodo(2);
    await insertTodo(null);

    await db.transaction(async (trx) => {
      await shiftDown({ trx, table: 'todo_items', scope: { user_id: userId }, fromPos: 0 });
    });

    expect(await todoPositions()).toEqual([0, 0, 1, null]);
  });
});
