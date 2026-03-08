// ── Mock the database module before importing anything that uses it ──────────

const mockDb = jest.fn();
const mockTransaction = jest.fn();

function createQueryChain(resolvedValue: unknown = undefined) {
  const chain: Record<string, jest.Mock> = {};
  const methods = [
    'where', 'andWhere', 'select', 'first', 'insert', 'update', 'del',
    'returning', 'max', 'join', 'orderBy', 'increment', 'decrement',
    'whereILike', 'orWhereILike', 'whereRaw',
  ];
  for (const method of methods) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }
  // Default terminal resolutions
  chain.first = jest.fn().mockResolvedValue(resolvedValue);
  chain.returning = jest.fn().mockResolvedValue(
    Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue]
  );
  chain.del = jest.fn().mockResolvedValue(1);
  // Make the chain thenable so `await query` resolves to the resolved value
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

import { cardService } from '../src/services/cardService';

// ── Constants ────────────────────────────────────────────────────────────────

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const STAGE_ID = '660e8400-e29b-41d4-a716-446655440001';
const CARD_ID = '770e8400-e29b-41d4-a716-446655440002';
const TARGET_STAGE_ID = '880e8400-e29b-41d4-a716-446655440003';

const MOCK_CARD = {
  id: CARD_ID,
  user_id: USER_ID,
  stage_id: STAGE_ID,
  position: 0,
  company_name: 'Acme Corp',
  role_title: 'Senior Engineer',
  application_url: 'https://acme.com/jobs/123',
  careers_url: null,
  source: 'LinkedIn',
  location: 'San Francisco',
  work_mode: 'remote',
  salary_min: 150000,
  salary_max: 200000,
  salary_currency: 'USD',
  priority: 'high',
  notes: 'Great opportunity',
  date_applied: '2026-01-15',
  last_interaction_date: null,
  next_followup_date: null,
  recruiter_name: null,
  recruiter_email: null,
  tech_stack: ['TypeScript', 'Node.js'],
  tags: ['startup', 'remote'],
  interest_level: 4,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const MOCK_STAGE = {
  id: STAGE_ID,
  user_id: USER_ID,
  name: 'Applied',
  position: 1,
  is_default: true,
};

afterEach(() => {
  jest.clearAllMocks();
});

// Helper to set up mockDb per table
function setupDbMock(tableResponses: Record<string, ReturnType<typeof createQueryChain>>) {
  mockDb.mockImplementation((tableName: string) => {
    if (tableResponses[tableName]) {
      return tableResponses[tableName];
    }
    return createQueryChain(undefined);
  });
}

// =============================================================================
// CARD SERVICE TESTS
// =============================================================================

describe('CardService - createCard', () => {
  it('should create a card and return it with stage name', async () => {
    // cards table: max position query, then insert
    const cardsChain = createQueryChain(undefined);
    // First call: max position query
    const maxChain = createQueryChain({ max: 2 });
    // We need to handle two calls to db('cards')
    let cardsCallCount = 0;
    const insertResult = { ...MOCK_CARD };

    const activitiesChain = createQueryChain(undefined);
    activitiesChain.insert = jest.fn().mockResolvedValue([]);

    const stagesChain = createQueryChain({ ...MOCK_STAGE });

    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'cards') {
        cardsCallCount++;
        if (cardsCallCount === 1) {
          // max position query
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            max: jest.fn().mockReturnValue({
              first: jest.fn().mockResolvedValue({ max: 2 }),
            }),
          });
          return chain;
        } else {
          // insert query
          const chain = createQueryChain(undefined);
          chain.insert = jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([insertResult]),
          });
          return chain;
        }
      }
      if (tableName === 'card_activities') return activitiesChain;
      if (tableName === 'stages') return stagesChain;
      return createQueryChain(undefined);
    });

    const result = await cardService.createCard(USER_ID, {
      stage_id: STAGE_ID,
      company_name: 'Acme Corp',
      role_title: 'Senior Engineer',
      source: 'LinkedIn',
      location: 'San Francisco',
      work_mode: 'remote',
      salary_min: 150000,
      salary_max: 200000,
      priority: 'high',
      notes: 'Great opportunity',
      tech_stack: ['TypeScript', 'Node.js'],
      tags: ['startup', 'remote'],
      interest_level: 4,
    });

    expect(result).toMatchObject({
      id: CARD_ID,
      company_name: 'Acme Corp',
      role_title: 'Senior Engineer',
      stage_name: 'Applied',
    });
  });

  it('should default position to 0 when stage has no cards', async () => {
    let cardsCallCount = 0;
    const insertResult = { ...MOCK_CARD, position: 0 };

    const activitiesChain = createQueryChain(undefined);
    activitiesChain.insert = jest.fn().mockResolvedValue([]);

    const stagesChain = createQueryChain({ ...MOCK_STAGE });

    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'cards') {
        cardsCallCount++;
        if (cardsCallCount === 1) {
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            max: jest.fn().mockReturnValue({
              first: jest.fn().mockResolvedValue({ max: null }),
            }),
          });
          return chain;
        } else {
          const chain = createQueryChain(undefined);
          chain.insert = jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([insertResult]),
          });
          return chain;
        }
      }
      if (tableName === 'card_activities') return activitiesChain;
      if (tableName === 'stages') return stagesChain;
      return createQueryChain(undefined);
    });

    const result = await cardService.createCard(USER_ID, {
      stage_id: STAGE_ID,
      company_name: 'New Corp',
      role_title: 'Developer',
    });

    expect(result.position).toBe(0);
  });
});

describe('CardService - getAllCards', () => {
  it('should list cards with no filters', async () => {
    const cardsList = [
      { ...MOCK_CARD, stage_name: 'Applied' },
      { ...MOCK_CARD, id: 'card-2', company_name: 'Beta Inc', stage_name: 'Wishlist' },
    ];

    const cardsChain = createQueryChain(cardsList);
    // Override the then to return the list
    (cardsChain as any).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(cardsList).then(resolve, reject);

    setupDbMock({ cards: cardsChain });

    const result = await cardService.getAllCards(USER_ID, {});

    expect(result).toHaveLength(2);
    expect(result[0].company_name).toBe('Acme Corp');
    expect(result[1].company_name).toBe('Beta Inc');
  });

  it('should list cards filtered by priority', async () => {
    const cardsList = [{ ...MOCK_CARD, stage_name: 'Applied', priority: 'high' }];

    const cardsChain = createQueryChain(cardsList);
    (cardsChain as any).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(cardsList).then(resolve, reject);

    setupDbMock({ cards: cardsChain });

    const result = await cardService.getAllCards(USER_ID, { priority: 'high' });

    expect(result).toHaveLength(1);
    expect(cardsChain.where).toHaveBeenCalled();
  });

  it('should apply search filter across company_name, role_title, notes', async () => {
    const cardsList = [{ ...MOCK_CARD, stage_name: 'Applied' }];

    const cardsChain = createQueryChain(cardsList);
    (cardsChain as any).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(cardsList).then(resolve, reject);

    setupDbMock({ cards: cardsChain });

    const result = await cardService.getAllCards(USER_ID, { search: 'Acme' });

    expect(result).toHaveLength(1);
    // The where method should have been called for the search filter
    expect(cardsChain.where).toHaveBeenCalled();
  });
});

describe('CardService - updateCard', () => {
  it('should update card and track changes in activities', async () => {
    let cardsCallCount = 0;
    const updatedCard = { ...MOCK_CARD, company_name: 'Acme Corp Updated', priority: 'critical' };

    const activitiesChain = createQueryChain(undefined);
    const activitiesInsertMock = jest.fn().mockResolvedValue([]);
    activitiesChain.insert = activitiesInsertMock;

    const stagesChain = createQueryChain({ ...MOCK_STAGE });

    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'cards') {
        cardsCallCount++;
        if (cardsCallCount === 1) {
          // first call: find existing card
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue({ ...MOCK_CARD }),
          });
          return chain;
        } else {
          // second call: update
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            update: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([updatedCard]),
            }),
          });
          return chain;
        }
      }
      if (tableName === 'card_activities') return activitiesChain;
      if (tableName === 'stages') return stagesChain;
      return createQueryChain(undefined);
    });

    const result = await cardService.updateCard(CARD_ID, USER_ID, {
      company_name: 'Acme Corp Updated',
      priority: 'critical',
    });

    expect(result.company_name).toBe('Acme Corp Updated');
    expect(result.stage_name).toBe('Applied');

    // Verify activity logging was called for changed fields
    expect(activitiesInsertMock).toHaveBeenCalledTimes(2); // company_name + priority
    const firstActivityCall = activitiesInsertMock.mock.calls[0][0];
    expect(firstActivityCall).toMatchObject({
      card_id: CARD_ID,
      user_id: USER_ID,
      action: 'updated',
    });
  });

  it('should throw 404 when updating a non-existent card', async () => {
    const cardsChain = createQueryChain(undefined);
    cardsChain.where = jest.fn().mockReturnValue({
      first: jest.fn().mockResolvedValue(undefined),
    });

    setupDbMock({ cards: cardsChain });

    await expect(
      cardService.updateCard('nonexistent-id', USER_ID, { company_name: 'Nope' })
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ERR_NOT_FOUND',
    });
  });
});

describe('CardService - moveCard', () => {
  it('should move card between stages with proper position management', async () => {
    let cardsCallCount = 0;
    const movedCard = {
      ...MOCK_CARD,
      stage_id: TARGET_STAGE_ID,
      position: 1,
      stage_name: 'Technical Screen',
    };

    const targetStage = {
      id: TARGET_STAGE_ID,
      user_id: USER_ID,
      name: 'Technical Screen',
      position: 3,
      is_default: true,
    };

    // transaction mock: execute the callback with a trx object
    const trxChain = createQueryChain(undefined);
    trxChain.decrement = jest.fn().mockResolvedValue(1);
    trxChain.increment = jest.fn().mockResolvedValue(1);
    trxChain.update = jest.fn().mockResolvedValue(1);

    mockTransaction.mockImplementation(async (callback: (trx: any) => Promise<void>) => {
      const trx: any = (tableName: string) => {
        const chain: Record<string, jest.Mock> = {};
        const methods = [
          'where', 'andWhere', 'decrement', 'increment', 'update',
        ];
        for (const method of methods) {
          chain[method] = jest.fn().mockReturnValue(chain);
        }
        chain.decrement = jest.fn().mockResolvedValue(1);
        chain.increment = jest.fn().mockResolvedValue(1);
        chain.update = jest.fn().mockResolvedValue(1);
        return chain;
      };
      trx.fn = { now: jest.fn().mockReturnValue('2026-01-01T00:00:00.000Z') };
      await callback(trx);
    });

    let stagesCallCount = 0;

    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'cards') {
        cardsCallCount++;
        if (cardsCallCount === 1) {
          // find card
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue({ ...MOCK_CARD }),
          });
          return chain;
        } else {
          // final select for return value
          const chain = createQueryChain(undefined);
          chain.join = jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              select: jest.fn().mockResolvedValue([movedCard]),
            }),
          });
          return chain;
        }
      }
      if (tableName === 'stages') {
        stagesCallCount++;
        if (stagesCallCount === 1) {
          // verify target stage
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue(targetStage),
          });
          return chain;
        } else if (stagesCallCount === 2) {
          // old stage lookup for activity log
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue(MOCK_STAGE),
          });
          return chain;
        }
        return createQueryChain(undefined);
      }
      if (tableName === 'card_activities') {
        const chain = createQueryChain(undefined);
        chain.insert = jest.fn().mockResolvedValue([]);
        return chain;
      }
      return createQueryChain(undefined);
    });

    const result = await cardService.moveCard(CARD_ID, USER_ID, TARGET_STAGE_ID, 1);

    expect(result).toMatchObject({
      stage_id: TARGET_STAGE_ID,
      position: 1,
      stage_name: 'Technical Screen',
    });
    // Transaction was called
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('should throw 404 when moving a non-existent card', async () => {
    const cardsChain = createQueryChain(undefined);
    cardsChain.where = jest.fn().mockReturnValue({
      first: jest.fn().mockResolvedValue(undefined),
    });

    setupDbMock({ cards: cardsChain });

    await expect(
      cardService.moveCard('nonexistent', USER_ID, TARGET_STAGE_ID, 0)
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ERR_NOT_FOUND',
    });
  });

  it('should throw 404 when target stage does not exist', async () => {
    let cardsCallCount = 0;

    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'cards') {
        cardsCallCount++;
        const chain = createQueryChain(undefined);
        chain.where = jest.fn().mockReturnValue({
          first: jest.fn().mockResolvedValue({ ...MOCK_CARD }),
        });
        return chain;
      }
      if (tableName === 'stages') {
        const chain = createQueryChain(undefined);
        chain.where = jest.fn().mockReturnValue({
          first: jest.fn().mockResolvedValue(undefined),
        });
        return chain;
      }
      return createQueryChain(undefined);
    });

    await expect(
      cardService.moveCard(CARD_ID, USER_ID, 'nonexistent-stage', 0)
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ERR_NOT_FOUND',
    });
  });
});

describe('CardService - deleteCard', () => {
  it('should delete a card and shift remaining positions', async () => {
    let cardsCallCount = 0;
    const delMock = jest.fn().mockResolvedValue(1);
    const decrementMock = jest.fn().mockResolvedValue(1);

    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'cards') {
        cardsCallCount++;
        if (cardsCallCount === 1) {
          // find card
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue({ ...MOCK_CARD }),
          });
          return chain;
        } else if (cardsCallCount === 2) {
          // delete
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            del: delMock,
          });
          return chain;
        } else {
          // shift positions
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            andWhere: jest.fn().mockReturnValue({
              decrement: decrementMock,
            }),
          });
          return chain;
        }
      }
      return createQueryChain(undefined);
    });

    await cardService.deleteCard(CARD_ID, USER_ID);

    expect(delMock).toHaveBeenCalledTimes(1);
    expect(decrementMock).toHaveBeenCalledWith('position', 1);
  });

  it('should throw 404 when deleting a non-existent card', async () => {
    const cardsChain = createQueryChain(undefined);
    cardsChain.where = jest.fn().mockReturnValue({
      first: jest.fn().mockResolvedValue(undefined),
    });

    setupDbMock({ cards: cardsChain });

    await expect(
      cardService.deleteCard('nonexistent', USER_ID)
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ERR_NOT_FOUND',
    });
  });
});

describe('CardService - addNote', () => {
  it('should add a note and return the activity record', async () => {
    let cardsCallCount = 0;
    let activitiesCallCount = 0;

    const activityRecord = {
      id: 'act-1',
      card_id: CARD_ID,
      user_id: USER_ID,
      action: 'note_added',
      field_changed: null,
      old_value: null,
      new_value: null,
      note: 'Followed up with recruiter',
      created_at: '2026-01-15T10:00:00.000Z',
    };

    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'cards') {
        cardsCallCount++;
        if (cardsCallCount === 1) {
          // find card
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue({ ...MOCK_CARD }),
          });
          return chain;
        } else {
          // update last_interaction_date
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            update: jest.fn().mockResolvedValue(1),
          });
          return chain;
        }
      }
      if (tableName === 'card_activities') {
        activitiesCallCount++;
        if (activitiesCallCount === 1) {
          // insert activity
          const chain = createQueryChain(undefined);
          chain.insert = jest.fn().mockResolvedValue([]);
          return chain;
        } else {
          // query for the latest activity
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              first: jest.fn().mockResolvedValue(activityRecord),
            }),
          });
          return chain;
        }
      }
      return createQueryChain(undefined);
    });

    const result = await cardService.addNote(CARD_ID, USER_ID, 'Followed up with recruiter');

    expect(result).toMatchObject({
      card_id: CARD_ID,
      action: 'note_added',
      note: 'Followed up with recruiter',
    });
  });

  it('should throw 404 when adding note to non-existent card', async () => {
    const cardsChain = createQueryChain(undefined);
    cardsChain.where = jest.fn().mockReturnValue({
      first: jest.fn().mockResolvedValue(undefined),
    });

    setupDbMock({ cards: cardsChain });

    await expect(
      cardService.addNote('nonexistent', USER_ID, 'some note')
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ERR_NOT_FOUND',
    });
  });
});
