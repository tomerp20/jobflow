// ── Mock the database module before importing anything that uses it ──────────

const mockDb = jest.fn();
const mockTransaction = jest.fn();

function createQueryChain(resolvedValue: unknown = undefined) {
  const chain: Record<string, jest.Mock> = {};
  const methods = [
    'where', 'andWhere', 'whereNot', 'select', 'first', 'insert', 'update', 'del',
    'returning', 'max', 'count', 'orderBy', 'increment', 'decrement',
  ];
  for (const method of methods) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }
  chain.first = jest.fn().mockResolvedValue(resolvedValue);
  chain.returning = jest.fn().mockResolvedValue(
    Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue]
  );
  chain.del = jest.fn().mockResolvedValue(1);
  (chain as any).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue]).then(resolve, reject);
  return chain;
}

jest.mock('../src/config/database', () => {
  const handler = (tableName: string) => mockDb(tableName);
  handler.raw = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
  handler.fn = { now: jest.fn().mockReturnValue('2026-01-01T00:00:00.000Z') };
  handler.transaction = mockTransaction;
  return { __esModule: true, default: handler };
});

import { stageService } from '../src/services/stageService';

// ── Constants ────────────────────────────────────────────────────────────────

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_USER_ID = '550e8400-e29b-41d4-a716-446655440099';
const STAGE_ID_1 = '660e8400-e29b-41d4-a716-446655440001';
const STAGE_ID_2 = '660e8400-e29b-41d4-a716-446655440002';
const STAGE_ID_3 = '660e8400-e29b-41d4-a716-446655440003';

const MOCK_STAGES = [
  { id: STAGE_ID_1, user_id: USER_ID, name: 'Wishlist', position: 0, is_default: true },
  { id: STAGE_ID_2, user_id: USER_ID, name: 'Applied', position: 1, is_default: true },
  { id: STAGE_ID_3, user_id: USER_ID, name: 'Interview', position: 2, is_default: true },
];

afterEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// CREATE STAGE
// =============================================================================

describe('StageService - createStage', () => {
  it('should create a stage and shift positions', async () => {
    const newStage = { id: 'new-stage', user_id: USER_ID, name: 'Phone Screen', position: 1 };
    const stagesChain = createQueryChain(undefined);
    stagesChain.insert = jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([newStage]),
    });

    mockDb.mockImplementation(() => stagesChain);

    const result = await stageService.createStage(USER_ID, { name: 'Phone Screen', position: 1 });

    expect(result).toMatchObject({ name: 'Phone Screen', position: 1 });
    // Verify positions were shifted
    expect(stagesChain.increment).toHaveBeenCalledWith('position', 1);
  });
});

// =============================================================================
// UPDATE STAGE (RENAME)
// =============================================================================

describe('StageService - updateStage (rename)', () => {
  it('should rename a stage', async () => {
    const updatedStage = { ...MOCK_STAGES[0], name: 'Saved' };
    let callCount = 0;

    mockDb.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // find existing
        return createQueryChain(MOCK_STAGES[0]);
      }
      // update
      const chain = createQueryChain(undefined);
      chain.where = jest.fn().mockReturnValue({
        update: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([updatedStage]),
        }),
      });
      return chain;
    });

    const result = await stageService.updateStage(STAGE_ID_1, USER_ID, { name: 'Saved' });

    expect(result).toMatchObject({ name: 'Saved' });
  });

  it('should throw 404 for non-existent stage', async () => {
    mockDb.mockImplementation(() => createQueryChain(undefined));

    await expect(
      stageService.updateStage('nonexistent', USER_ID, { name: 'Nope' })
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ERR_NOT_FOUND',
    });
  });
});

// =============================================================================
// DELETE STAGE
// =============================================================================

describe('StageService - deleteStage', () => {
  it('should delete a stage and move cards to first available stage', async () => {
    let stagesCallCount = 0;
    let cardsCallCount = 0;
    const delMock = jest.fn().mockResolvedValue(1);

    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'stages') {
        stagesCallCount++;
        if (stagesCallCount === 1) {
          // find stage
          return createQueryChain(MOCK_STAGES[1]); // deleting "Applied"
        } else if (stagesCallCount === 2) {
          // count stages
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            count: jest.fn().mockReturnValue({
              first: jest.fn().mockResolvedValue({ count: '3' }),
            }),
          });
          return chain;
        } else if (stagesCallCount === 3) {
          // find fallback stage
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            whereNot: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                first: jest.fn().mockResolvedValue(MOCK_STAGES[0]), // fallback to "Wishlist"
              }),
            }),
          });
          return chain;
        } else if (stagesCallCount === 4) {
          // delete stage
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            del: delMock,
          });
          return chain;
        } else {
          // shift positions
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue(chain);
          chain.andWhere = jest.fn().mockReturnValue(chain);
          chain.decrement = jest.fn().mockResolvedValue(1);
          return chain;
        }
      }
      if (tableName === 'cards') {
        cardsCallCount++;
        if (cardsCallCount === 1) {
          // move cards - update stage_id
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            update: jest.fn().mockResolvedValue(2), // 2 cards moved
          });
          return chain;
        } else if (cardsCallCount === 2) {
          // max position in fallback
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            max: jest.fn().mockReturnValue({
              first: jest.fn().mockResolvedValue({ max: 3 }),
            }),
          });
          return chain;
        } else {
          // re-number cards
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue(chain);
          chain.orderBy = jest.fn().mockReturnValue(chain);
          // return cards array for re-numbering
          (chain as any).then = (resolve: (v: unknown) => void) =>
            Promise.resolve([
              { id: 'card-1', position: 0 },
              { id: 'card-2', position: 1 },
              { id: 'card-3', position: 2 },
              { id: 'card-4', position: 3 },
            ]).then(resolve);
          chain.update = jest.fn().mockResolvedValue(1);
          return chain;
        }
      }
      return createQueryChain(undefined);
    });

    const result = await stageService.deleteStage(STAGE_ID_2, USER_ID);

    expect(result.deletedStage).toMatchObject({ name: 'Applied' });
    expect(result.movedCardsTo).toMatchObject({ name: 'Wishlist' });
    expect(result.movedCardCount).toBe(2);
  });

  it('should throw error when deleting the last stage', async () => {
    let stagesCallCount = 0;

    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'stages') {
        stagesCallCount++;
        if (stagesCallCount === 1) {
          return createQueryChain(MOCK_STAGES[0]);
        } else {
          // count = 1
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            count: jest.fn().mockReturnValue({
              first: jest.fn().mockResolvedValue({ count: '1' }),
            }),
          });
          return chain;
        }
      }
      return createQueryChain(undefined);
    });

    await expect(
      stageService.deleteStage(STAGE_ID_1, USER_ID)
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'ERR_LAST_STAGE',
    });
  });

  it('should throw 404 when deleting non-existent stage', async () => {
    mockDb.mockImplementation(() => createQueryChain(undefined));

    await expect(
      stageService.deleteStage('nonexistent', USER_ID)
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ERR_NOT_FOUND',
    });
  });
});

// =============================================================================
// REORDER STAGES
// =============================================================================

describe('StageService - reorderStages', () => {
  it('should reorder stages by updating positions', async () => {
    let stagesCallCount = 0;
    const reorderedStages = [
      { ...MOCK_STAGES[2], position: 0 },
      { ...MOCK_STAGES[0], position: 1 },
      { ...MOCK_STAGES[1], position: 2 },
    ];

    // Transaction mock
    mockTransaction.mockImplementation(async (callback: (trx: any) => Promise<void>) => {
      const trx: any = () => {
        const chain: Record<string, jest.Mock> = {};
        chain.where = jest.fn().mockReturnValue(chain);
        chain.update = jest.fn().mockResolvedValue(1);
        return chain;
      };
      await callback(trx);
    });

    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'stages') {
        stagesCallCount++;
        if (stagesCallCount === 1) {
          // validate: select all user stages
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            select: jest.fn().mockResolvedValue(
              MOCK_STAGES.map((s) => ({ id: s.id }))
            ),
          });
          return chain;
        } else {
          // final fetch after reorder
          const chain = createQueryChain(reorderedStages);
          (chain as any).then = (resolve: (v: unknown) => void) =>
            Promise.resolve(reorderedStages).then(resolve);
          return chain;
        }
      }
      return createQueryChain(undefined);
    });

    const result = await stageService.reorderStages(
      USER_ID,
      [STAGE_ID_3, STAGE_ID_1, STAGE_ID_2]
    );

    expect(result).toHaveLength(3);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('should throw error when stageIds include stages from another user', async () => {
    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'stages') {
        const chain = createQueryChain(undefined);
        chain.where = jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue(
            MOCK_STAGES.map((s) => ({ id: s.id }))
          ),
        });
        return chain;
      }
      return createQueryChain(undefined);
    });

    await expect(
      stageService.reorderStages(USER_ID, [STAGE_ID_1, 'foreign-stage-id', STAGE_ID_3])
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'ERR_INVALID_STAGE',
    });
  });

  it('should throw error when not all stages are included', async () => {
    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'stages') {
        const chain = createQueryChain(undefined);
        chain.where = jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue(
            MOCK_STAGES.map((s) => ({ id: s.id }))
          ),
        });
        return chain;
      }
      return createQueryChain(undefined);
    });

    await expect(
      stageService.reorderStages(USER_ID, [STAGE_ID_1, STAGE_ID_2]) // missing STAGE_ID_3
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'ERR_INCOMPLETE_REORDER',
    });
  });
});
