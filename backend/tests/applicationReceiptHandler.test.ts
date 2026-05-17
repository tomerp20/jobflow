// ── Mock the database module before importing anything that uses it ──────────

const mockDb = jest.fn();

function createQueryChain(resolvedValue: unknown = undefined) {
  const chain: Record<string, jest.Mock> = {};
  const methods = [
    'where', 'andWhere', 'select', 'first', 'insert', 'update', 'del',
    'returning', 'max', 'join', 'orderBy', 'limit',
    'onConflict', 'ignore', 'merge',
  ];
  for (const method of methods) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }
  chain.first = jest.fn().mockResolvedValue(resolvedValue);
  chain.del = jest.fn().mockResolvedValue(1);
  (chain as any).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue]).then(resolve, reject);
  return chain;
}

jest.mock('../src/config/database', () => {
  const handler = (tableName: string) => mockDb(tableName);
  handler.raw = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
  handler.transaction = jest.fn().mockImplementation(async (callback: (trx: typeof handler) => Promise<unknown>) => callback(handler));
  return { __esModule: true, default: handler };
});

jest.mock('../src/services/cardService', () => ({
  cardService: {
    createCard: jest.fn().mockResolvedValue({ id: 'card-123', stage_name: 'Applied' }),
  },
  resolveCompanyIconUrl: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/services/notificationService', () => ({
  notificationService: {
    create: jest.fn().mockResolvedValue({}),
  },
}));

import { applicationReceiptHandler, ApplicationReceiptInput } from '../src/services/applicationReceiptHandler';
import { cardService } from '../src/services/cardService';
import { notificationService } from '../src/services/notificationService';

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_ID = 'user-abc-123';
const MSG_ID = 'gmail-msg-001';
const APPLIED_STAGE = { id: 'stage-applied-1', name: 'Applied', is_applied_stage: true, is_default: false };
const DEFAULT_STAGE = { id: 'stage-default-1', name: 'New', is_applied_stage: false, is_default: true };

const BASE_INPUT: ApplicationReceiptInput = {
  userId: USER_ID,
  gmailMessageId: MSG_ID,
  subject: 'Your application to Acme Corp',
  sender: 'noreply@acme.com',
  companyName: 'Acme Corp',
  roleTitle: 'Software Engineer',
  jobUrl: 'https://acme.com/jobs/123',
  confidence: 0.95,
  emailReceivedAt: new Date('2024-01-15T10:00:00Z'),
};

afterEach(() => {
  jest.clearAllMocks();
});

function setupDb(options: {
  appliedStage?: typeof APPLIED_STAGE | null;
  defaultStage?: typeof DEFAULT_STAGE | null;
  existingCards?: { company_name: string; role_title: string }[];
}) {
  const { appliedStage = APPLIED_STAGE, defaultStage = DEFAULT_STAGE, existingCards = [] } = options;

  let stagesCallCount = 0;
  const processedEmailsChain = createQueryChain(undefined);
  const cardsChain = createQueryChain(existingCards);

  mockDb.mockImplementation((tableName: string) => {
    if (tableName === 'stages') {
      stagesCallCount++;
      if (stagesCallCount === 1) {
        return createQueryChain(appliedStage);
      }
      return createQueryChain(defaultStage);
    }
    if (tableName === 'cards') return cardsChain;
    if (tableName === 'processed_emails') return processedEmailsChain;
    return createQueryChain(undefined);
  });

  return { processedEmailsChain, cardsChain };
}

// =============================================================================
// applicationReceiptHandler tests
// =============================================================================

describe('applicationReceiptHandler', () => {
  it('full data → Application created in Applied Stage, receipt_created recorded, Notification fired', async () => {
    const { processedEmailsChain } = setupDb({ appliedStage: APPLIED_STAGE, existingCards: [] });

    const result = await applicationReceiptHandler(BASE_INPUT);

    expect(result).toEqual({ action: 'created' });

    expect(cardService.createCard).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      stage_id: APPLIED_STAGE.id,
      company_name: 'Acme Corp',
      role_title: 'Software Engineer',
      source: 'email',
      application_url: 'https://acme.com/jobs/123',
    }), expect.anything());

    expect(processedEmailsChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'receipt_created',
      card_id: 'card-123',
    }));

    expect(notificationService.create).toHaveBeenCalledTimes(1);
  });

  it('roleTitle null → Application created with "Unknown Role"', async () => {
    setupDb({ appliedStage: APPLIED_STAGE, existingCards: [] });

    const result = await applicationReceiptHandler({ ...BASE_INPUT, roleTitle: null });

    expect(result).toEqual({ action: 'created' });
    expect(cardService.createCard).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      role_title: 'Unknown Role',
    }), expect.anything());
  });

  it('company + role match existing Application → no creation, receipt_already_tracked recorded, Notification fired', async () => {
    const { processedEmailsChain } = setupDb({
      appliedStage: APPLIED_STAGE,
      existingCards: [{ company_name: 'Acme Corp', role_title: 'Software Engineer' }],
    });

    const result = await applicationReceiptHandler(BASE_INPUT);

    expect(result).toEqual({ action: 'already_tracked' });
    expect(cardService.createCard).not.toHaveBeenCalled();
    expect(processedEmailsChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'receipt_already_tracked',
    }));
    expect(notificationService.create).toHaveBeenCalledTimes(1);
  });

  it('company matches but role does not → new Application created (not a duplicate)', async () => {
    setupDb({
      appliedStage: APPLIED_STAGE,
      existingCards: [{ company_name: 'Acme Corp', role_title: 'Product Manager' }],
    });

    const result = await applicationReceiptHandler(BASE_INPUT);

    expect(result).toEqual({ action: 'created' });
    expect(cardService.createCard).toHaveBeenCalledTimes(1);
  });

  it('confidence < 0.9 → no creation, receipt_low_confidence recorded, Notification fired', async () => {
    const { processedEmailsChain } = setupDb({ appliedStage: APPLIED_STAGE });

    const result = await applicationReceiptHandler({ ...BASE_INPUT, confidence: 0.85 });

    expect(result).toEqual({ action: 'low_confidence' });
    expect(cardService.createCard).not.toHaveBeenCalled();
    expect(processedEmailsChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'receipt_low_confidence',
    }));
    expect(notificationService.create).toHaveBeenCalledTimes(1);
  });

  it('no Applied Stage → Application created in default Stage, Notification includes fallback warning', async () => {
    const { processedEmailsChain } = setupDb({
      appliedStage: null,
      defaultStage: DEFAULT_STAGE,
      existingCards: [],
    });

    const result = await applicationReceiptHandler(BASE_INPUT);

    expect(result).toEqual({ action: 'created' });
    expect(cardService.createCard).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      stage_id: DEFAULT_STAGE.id,
    }), expect.anything());

    const notifCall = (notificationService.create as jest.Mock).mock.calls[0];
    expect(notifCall[2]).toMatch(/fallback|default stage/i);
  });

  it('companyName null → no creation, receipt_low_confidence recorded', async () => {
    const { processedEmailsChain } = setupDb({ appliedStage: APPLIED_STAGE });

    const result = await applicationReceiptHandler({ ...BASE_INPUT, companyName: null });

    expect(result).toEqual({ action: 'low_confidence' });
    expect(cardService.createCard).not.toHaveBeenCalled();
    expect(processedEmailsChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      action: 'receipt_low_confidence',
    }));
  });

  it('transaction error propagates — no silent partial commit when a step throws', async () => {
    // Simulate card creation failing mid-transaction.
    // The transaction callback throws, Knex rolls back, and the error reaches the caller.
    setupDb({ appliedStage: APPLIED_STAGE, existingCards: [] });
    (cardService.createCard as jest.Mock).mockRejectedValueOnce(new Error('DB write failed'));

    await expect(applicationReceiptHandler(BASE_INPUT)).rejects.toThrow('DB write failed');
  });
});
