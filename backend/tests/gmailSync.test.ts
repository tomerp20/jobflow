// ── Mock the database module before any imports that touch it ─────────────────

const mockDb = jest.fn();
const mockTransaction = jest.fn();
const mockRaw = jest.fn();
const mockFnNow = jest.fn().mockReturnValue('2026-01-01T00:00:00.000Z');

function createQueryChain(resolvedValue: unknown = undefined) {
  const chain: Record<string, jest.Mock> = {};
  const methods = [
    'where', 'andWhere', 'whereIn', 'select', 'first', 'insert', 'update',
    'del', 'returning', 'max', 'join', 'orderBy', 'limit', 'onConflict', 'ignore',
    'merge', 'whereNull', 'whereNotNull',
  ];
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain.first = jest.fn().mockResolvedValue(resolvedValue);
  chain.returning = jest.fn().mockResolvedValue(
    Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue],
  );
  chain.del = jest.fn().mockResolvedValue(1);
  (chain as any).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue]).then(resolve, reject);
  return chain;
}

jest.mock('../src/config/database', () => {
  const handler = (tableName: string) => mockDb(tableName);
  handler.raw = mockRaw;
  handler.fn = { now: mockFnNow };
  handler.transaction = mockTransaction;
  return { __esModule: true, default: handler };
});

jest.mock('../src/services/cardService', () => ({
  cardService: {
    createCard: jest.fn(),
    moveCard: jest.fn(),
  },
  resolveCompanyIconUrl: jest.fn().mockResolvedValue(null),
}));

import { syncUserGmailWith, normalize, companyMatch, GmailPort, ClassifierPort, SyncDeps, RawEmail, GmailClient } from '../src/services/gmailSync';
import { cardService } from '../src/services/cardService';
import { EmailClassification } from '../src/services/emailClassifier';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-abc-123';

const APPLIED_STAGE = { id: 'stage-applied', name: 'Applied', is_applied_stage: true, is_default: false, is_rejection_stage: false };
const DEFAULT_STAGE = { id: 'stage-default', name: 'New', is_applied_stage: false, is_default: true, is_rejection_stage: false };
const REJECTION_STAGE = { id: 'stage-reject', name: 'Rejected', is_rejection_stage: true };

const BASE_EMAIL: RawEmail = {
  messageId: 'msg-001',
  subject: 'Your application to Acme Corp',
  sender: 'noreply@acme.com',
  body: 'Thank you for applying.',
  receivedAt: new Date('2024-01-15T10:00:00Z'),
};

const REJECTION_EMAIL: RawEmail = {
  messageId: 'msg-002',
  subject: 'Application Update from Acme Corp',
  sender: 'hr@acme.com',
  body: 'We regret to inform you we have moved forward with other candidates.',
  receivedAt: new Date('2024-01-20T10:00:00Z'),
};

function makeReceiptClassification(overrides: Partial<EmailClassification> = {}): EmailClassification {
  return {
    type: 'application_receipt',
    companyName: 'Acme Corp',
    roleTitle: 'Software Engineer',
    jobUrl: null,
    confidence: 0.95,
    ...overrides,
  };
}

function makeRejectionClassification(overrides: Partial<EmailClassification> = {}): EmailClassification {
  return {
    type: 'rejection',
    companyName: 'Acme Corp',
    roleTitle: null,
    jobUrl: null,
    confidence: 0.95,
    ...overrides,
  };
}

// ── Port test adapters ────────────────────────────────────────────────────────

function fakeGmail(emails: RawEmail[]): GmailPort {
  return {
    async getValidClient(_userId: string): Promise<GmailClient | null> {
      return {} as GmailClient;
    },
    async fetchUnreadEmails(_client: GmailClient, _since: Date | null): Promise<RawEmail[]> {
      return emails;
    },
  };
}

function fakeClassifier(
  map: Record<string, EmailClassification | Error>,
): ClassifierPort {
  return {
    async classify(email: RawEmail): Promise<EmailClassification> {
      const result = map[email.messageId];
      if (!result) throw new Error(`No classification for messageId: ${email.messageId}`);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

// ── DB mock helpers ───────────────────────────────────────────────────────────

interface SetupOptions {
  processedMessageIds?: string[];
  rejectionStage?: typeof REJECTION_STAGE | null;
  appliedStage?: typeof APPLIED_STAGE | null;
  defaultStage?: typeof DEFAULT_STAGE | null;
  existingCards?: { id: string; company_name: string; role_title: string }[];
  gmailToken?: { user_id: string; last_sync_at: string | null; is_valid: boolean } | null;
}

function setupDb(options: SetupOptions = {}) {
  const {
    processedMessageIds = [],
    rejectionStage = REJECTION_STAGE,
    appliedStage = APPLIED_STAGE,
    defaultStage = DEFAULT_STAGE,
    existingCards = [],
    gmailToken = { user_id: USER_ID, last_sync_at: null, is_valid: true },
  } = options;

  // Track inserts for assertion
  const insertedProcessedEmails: unknown[] = [];
  const insertedNotifications: unknown[] = [];
  let stagesCallCount = 0;
  let inTransactionIdempotencyCheck = false;

  // Outside-transaction mocks
  mockDb.mockImplementation((tableName: string) => {
    if (tableName === 'gmail_tokens') {
      const chain = createQueryChain(gmailToken);
      chain.update = jest.fn().mockResolvedValue(1);
      return chain;
    }
    if (tableName === 'processed_emails') {
      // Pre-filter returns already-processed message IDs
      const chain = createQueryChain(
        processedMessageIds.map(id => ({ gmail_message_id: id })),
      );
      return chain;
    }
    if (tableName === 'stages') {
      stagesCallCount++;
      // First call is for rejection stage lookup (hoisted read)
      if (stagesCallCount === 1) return createQueryChain(rejectionStage);
      // Second call is for applied stage inside processReceipt
      if (stagesCallCount === 2) return createQueryChain(appliedStage);
      // Third call is fallback default stage
      return createQueryChain(defaultStage);
    }
    if (tableName === 'cards') {
      const chain = createQueryChain(existingCards);
      chain.join = jest.fn().mockReturnValue(chain);
      return chain;
    }
    return createQueryChain(undefined);
  });

  // Transaction mock: execute callback with trx
  mockTransaction.mockImplementation(async (cb: (trx: unknown) => Promise<void>) => {
    inTransactionIdempotencyCheck = false;

    const trx = jest.fn().mockImplementation((tableName: string) => {
      if (tableName === 'processed_emails') {
        // First call inside trx per email = idempotency re-check (return null = not processed)
        if (!inTransactionIdempotencyCheck) {
          inTransactionIdempotencyCheck = true;
          return createQueryChain(null);
        }
        // Subsequent calls = inserts
        const chain = createQueryChain(null);
        chain.insert = jest.fn().mockImplementation((row: unknown) => {
          insertedProcessedEmails.push(row);
          return chain;
        });
        return chain;
      }
      if (tableName === 'notifications') {
        const chain = createQueryChain(null);
        chain.insert = jest.fn().mockImplementation((row: unknown) => {
          insertedNotifications.push(row);
          return chain;
        });
        return chain;
      }
      if (tableName === 'gmail_tokens') {
        const chain = createQueryChain(null);
        chain.update = jest.fn().mockResolvedValue(1);
        return chain;
      }
      if (tableName === 'stages') {
        stagesCallCount++;
        if (stagesCallCount === 2) return createQueryChain(appliedStage);
        return createQueryChain(defaultStage);
      }
      if (tableName === 'cards') {
        const chain = createQueryChain(existingCards);
        chain.join = jest.fn().mockReturnValue(chain);
        return chain;
      }
      return createQueryChain(null);
    });
    (trx as any).raw = jest.fn().mockResolvedValue(undefined);
    (trx as any).fn = { now: jest.fn().mockReturnValue('2026-01-01T00:00:00.000Z') };

    return await cb(trx);
  });

  mockRaw.mockResolvedValue(undefined);

  return { insertedProcessedEmails, insertedNotifications };
}

function makeMockKnex(): import('knex').Knex {
  const handler = jest.fn().mockImplementation((tableName: string) => mockDb(tableName));
  (handler as any).transaction = mockTransaction;
  (handler as any).raw = mockRaw;
  (handler as any).fn = { now: mockFnNow };
  return handler as unknown as import('knex').Knex;
}

function makeDeps(emails: RawEmail[], classMap: Record<string, EmailClassification | Error>): SyncDeps {
  return {
    gmail: fakeGmail(emails),
    classifier: fakeClassifier(classMap),
    db: makeMockKnex(),
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

// ── Unit tests for normalize / companyMatch helpers ───────────────────────────

describe('normalize', () => {
  it('strips spaces and punctuation from ASCII names', () => {
    expect(normalize('Acme, Inc.')).toBe('acmeinc');
  });

  it('preserves Hebrew letters', () => {
    expect(normalize('בנק הפועלים')).toBe('בנקהפועלים');
  });

  it('preserves mixed Hebrew and Latin letters', () => {
    expect(normalize('Apple בנק')).toBe('appleבנק');
  });

  it('preserves accented Latin letters', () => {
    expect(normalize('Société Générale')).toBe('sociétégénérale');
  });

  it('strips emoji, preserving surrounding letters', () => {
    expect(normalize('Company 🚀')).toBe('company');
  });

  it('returns empty string for a space-only input', () => {
    expect(normalize('   ')).toBe('');
  });
});

describe('companyMatch', () => {
  it('matches identical Hebrew company names', () => {
    expect(companyMatch('בנק הפועלים', 'בנק הפועלים')).toBe(true);
  });

  it('does not cross-match Hebrew and Latin names for the same company', () => {
    expect(companyMatch('Bank Hapoalim', 'בנק הפועלים')).toBe(false);
  });

  it('matches when extracted name is a substring of card name (ASCII)', () => {
    expect(companyMatch('Acme Corporation', 'Acme Corp')).toBe(true);
  });

  it('rejects when both names normalize to empty', () => {
    expect(companyMatch('   ', '   ')).toBe(false);
  });

  it('rejects when extracted name normalizes to ≤3 chars', () => {
    expect(companyMatch('IBM', 'IBM')).toBe(false);
  });

  it('matches accented-Latin company names', () => {
    expect(companyMatch('Société Générale', 'Société Générale')).toBe(true);
  });

  it('matches the same name in NFC vs NFD form', () => {
    const nfc = 'Société Générale';            // 'é' = U+00E9 (precomposed)
    const nfd = 'Société Générale';        // 'e' + U+0301 (combining acute)
    expect(companyMatch(nfc, nfd)).toBe(true);
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('syncUserGmailWith', () => {
  describe('early exits', () => {
    it('returns zero summary when no gmail token', async () => {
      setupDb({ gmailToken: null });
      const deps = makeDeps([], {});
      const summary = await syncUserGmailWith(USER_ID, deps);
      expect(summary.scanned).toBe(0);
    });

    it('returns zero summary when no valid gmail client', async () => {
      setupDb();
      const deps: SyncDeps = {
        gmail: {
          getValidClient: jest.fn().mockResolvedValue(null),
          fetchUnreadEmails: jest.fn(),
        },
        classifier: fakeClassifier({}),
        db: mockDb as unknown as import('knex').Knex,
      };
      const summary = await syncUserGmailWith(USER_ID, deps);
      expect(summary.scanned).toBe(0);
    });
  });

  describe('receipt path', () => {
    it('creates card + audit row + notification on first receipt email', async () => {
      const { insertedProcessedEmails, insertedNotifications } = setupDb({ existingCards: [] });
      (cardService.createCard as jest.Mock).mockResolvedValue({ id: 'card-new', stage_name: 'Applied' });

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [BASE_EMAIL],
        { 'msg-001': makeReceiptClassification() },
      ));

      expect(summary.receiptsCreated).toBe(1);
      expect(cardService.createCard).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({
          company_name: 'Acme Corp',
          role_title: 'Software Engineer',
          source: 'email',
          stage_id: APPLIED_STAGE.id,
        }),
        expect.anything(),
      );
      expect(insertedProcessedEmails).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: 'receipt_created' })]),
      );
      expect(insertedNotifications).toEqual(
        expect.arrayContaining([expect.objectContaining({ title: 'Application added' })]),
      );
    });

    it('uses fallback default stage when no applied stage exists', async () => {
      const { insertedNotifications } = setupDb({ appliedStage: null, existingCards: [] });
      (cardService.createCard as jest.Mock).mockResolvedValue({ id: 'card-new' });

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [BASE_EMAIL],
        { 'msg-001': makeReceiptClassification() },
      ));

      expect(summary.receiptsCreated).toBe(1);
      expect(cardService.createCard).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ stage_id: DEFAULT_STAGE.id }),
        expect.anything(),
      );
      expect(insertedNotifications[0]).toEqual(
        expect.objectContaining({ body: expect.stringMatching(/fallback|default stage/i) }),
      );
    });

    it('marks already_tracked when company + role match existing card', async () => {
      const { insertedProcessedEmails } = setupDb({
        existingCards: [{ id: 'card-existing', company_name: 'Acme Corp', role_title: 'Software Engineer' }],
      });

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [BASE_EMAIL],
        { 'msg-001': makeReceiptClassification() },
      ));

      expect(summary.receiptsAlreadyTracked).toBe(1);
      expect(cardService.createCard).not.toHaveBeenCalled();
      expect(insertedProcessedEmails).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: 'receipt_already_tracked' })]),
      );
    });

    it('creates card when company matches but role does not', async () => {
      setupDb({
        existingCards: [{ id: 'card-existing', company_name: 'Acme Corp', role_title: 'Product Manager' }],
      });
      (cardService.createCard as jest.Mock).mockResolvedValue({ id: 'card-new' });

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [BASE_EMAIL],
        { 'msg-001': makeReceiptClassification() },
      ));

      expect(summary.receiptsCreated).toBe(1);
    });

    it('records receipt_low_confidence when confidence < 0.9', async () => {
      const { insertedProcessedEmails } = setupDb();

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [BASE_EMAIL],
        { 'msg-001': makeReceiptClassification({ confidence: 0.85 }) },
      ));

      expect(summary.receiptsLowConfidence).toBe(1);
      expect(cardService.createCard).not.toHaveBeenCalled();
      expect(insertedProcessedEmails).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: 'receipt_low_confidence' })]),
      );
    });

    it('records receipt_low_confidence when companyName is null', async () => {
      const { insertedProcessedEmails } = setupDb();

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [BASE_EMAIL],
        { 'msg-001': makeReceiptClassification({ companyName: null }) },
      ));

      expect(summary.receiptsLowConfidence).toBe(1);
      expect(insertedProcessedEmails).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: 'receipt_low_confidence' })]),
      );
    });

    it('uses "Unknown Role" when roleTitle is null', async () => {
      setupDb({ existingCards: [] });
      (cardService.createCard as jest.Mock).mockResolvedValue({ id: 'card-new' });

      await syncUserGmailWith(USER_ID, makeDeps(
        [BASE_EMAIL],
        { 'msg-001': makeReceiptClassification({ roleTitle: null }) },
      ));

      expect(cardService.createCard).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ role_title: 'Unknown Role' }),
        expect.anything(),
      );
    });

    it('marks the second receipt as already_tracked when the first created a matching card in the same batch', async () => {
      // In-batch dedup: with the hoisted userCardsForReceipt list, the second
      // email must see the card created by the first email's committed trx
      // and mark itself as already_tracked rather than creating a duplicate.
      const { insertedProcessedEmails } = setupDb({ existingCards: [] });
      (cardService.createCard as jest.Mock).mockResolvedValueOnce({
        id: 'card-batch-1',
        company_name: 'Acme Corp',
        role_title: 'Software Engineer',
        stage_name: 'Applied',
      });

      const email1: RawEmail = { ...BASE_EMAIL, messageId: 'msg-batch-1' };
      const email2: RawEmail = { ...BASE_EMAIL, messageId: 'msg-batch-2' };

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [email1, email2],
        {
          'msg-batch-1': makeReceiptClassification(),
          'msg-batch-2': makeReceiptClassification(),
        },
      ));

      expect(summary.receiptsCreated).toBe(1);
      expect(summary.receiptsAlreadyTracked).toBe(1);
      expect(cardService.createCard).toHaveBeenCalledTimes(1);
      expect(insertedProcessedEmails).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: 'receipt_created' }),
          expect.objectContaining({ action: 'receipt_already_tracked', card_id: 'card-batch-1' }),
        ]),
      );
    });

    it('does not leave a stale entry in userCardsForReceipt when the trx rolls back', async () => {
      // Rollback safety: if email 1's trx throws after createCard (or anywhere
      // inside the callback), the in-memory list must NOT be updated. Email 2
      // for the same company+role must still create a new card, not match a
      // ghost entry from the rolled-back trx.
      setupDb({ existingCards: [] });
      (cardService.createCard as jest.Mock)
        .mockRejectedValueOnce(new Error('simulated post-createCard failure'))
        .mockResolvedValueOnce({
          id: 'card-second',
          company_name: 'Acme Corp',
          role_title: 'Software Engineer',
          stage_name: 'Applied',
        });

      const email1: RawEmail = { ...BASE_EMAIL, messageId: 'msg-rollback-1' };
      const email2: RawEmail = { ...BASE_EMAIL, messageId: 'msg-rollback-2' };

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [email1, email2],
        {
          'msg-rollback-1': makeReceiptClassification(),
          'msg-rollback-2': makeReceiptClassification(),
        },
      ));

      expect(summary.errors).toBe(1);
      expect(summary.receiptsCreated).toBe(1);
      expect(summary.receiptsAlreadyTracked).toBe(0);
      expect(cardService.createCard).toHaveBeenCalledTimes(2);
    });
  });

  describe('rejection path', () => {
    it('moves card to rejection stage on single match', async () => {
      const { insertedProcessedEmails, insertedNotifications } = setupDb({
        existingCards: [{ id: 'card-acme', company_name: 'Acme Corp', role_title: 'Software Engineer' }],
      });
      (cardService.moveCard as jest.Mock).mockResolvedValue({});

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [REJECTION_EMAIL],
        { 'msg-002': makeRejectionClassification() },
      ));

      expect(summary.rejectionsMoved).toBe(1);
      expect(cardService.moveCard).toHaveBeenCalledWith('card-acme', USER_ID, REJECTION_STAGE.id, 0, expect.anything());
      expect(insertedProcessedEmails).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: 'moved_to_rejected' })]),
      );
      expect(insertedNotifications).toEqual(
        expect.arrayContaining([expect.objectContaining({ title: 'Application marked as Rejected' })]),
      );
    });

    it('records ambiguous_match when multiple cards match', async () => {
      const { insertedProcessedEmails } = setupDb({
        existingCards: [
          { id: 'card-1', company_name: 'Acme Corp', role_title: 'Engineer' },
          { id: 'card-2', company_name: 'Acme Corp', role_title: 'Designer' },
        ],
      });

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [REJECTION_EMAIL],
        { 'msg-002': makeRejectionClassification() },
      ));

      expect(summary.ambiguous).toBe(1);
      expect(cardService.moveCard).not.toHaveBeenCalled();
      expect(insertedProcessedEmails).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: 'ambiguous_match' })]),
      );
    });

    it('records no_match when no cards match', async () => {
      const { insertedProcessedEmails } = setupDb({
        existingCards: [{ id: 'card-1', company_name: 'Other Company', role_title: 'Engineer' }],
      });

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [REJECTION_EMAIL],
        { 'msg-002': makeRejectionClassification() },
      ));

      expect(summary.noMatch).toBe(1);
      expect(insertedProcessedEmails).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: 'no_match' })]),
      );
    });

    it('records low_confidence when confidence < 0.9', async () => {
      const { insertedProcessedEmails } = setupDb({
        existingCards: [{ id: 'card-1', company_name: 'Acme Corp', role_title: 'Engineer' }],
      });

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [REJECTION_EMAIL],
        { 'msg-002': makeRejectionClassification({ confidence: 0.7 }) },
      ));

      expect(summary.lowConfidence).toBe(1);
      expect(cardService.moveCard).not.toHaveBeenCalled();
      expect(insertedProcessedEmails).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: 'low_confidence' })]),
      );
    });

    it('records no_match when companyName is null', async () => {
      const { insertedProcessedEmails } = setupDb({
        existingCards: [{ id: 'card-1', company_name: 'Acme Corp', role_title: 'Engineer' }],
      });

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [REJECTION_EMAIL],
        { 'msg-002': makeRejectionClassification({ companyName: null }) },
      ));

      expect(summary.noMatch).toBe(1);
      expect(insertedProcessedEmails).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: 'no_match' })]),
      );
    });
  });

  describe('other path', () => {
    it('records not_actionable for type=other emails', async () => {
      const { insertedProcessedEmails } = setupDb();

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [BASE_EMAIL],
        { 'msg-001': { type: 'other', companyName: null, roleTitle: null, jobUrl: null, confidence: 0.9 } },
      ));

      expect(summary.notActionable).toBe(1);
      expect(insertedProcessedEmails).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: 'not_actionable' })]),
      );
    });
  });

  describe('classifier error path', () => {
    it('records classifier_error and continues processing remaining emails', async () => {
      setupDb({ existingCards: [] });
      (cardService.createCard as jest.Mock).mockResolvedValue({ id: 'card-new' });

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [BASE_EMAIL, REJECTION_EMAIL],
        {
          'msg-001': new Error('LLM timeout'),
          'msg-002': makeRejectionClassification(),
        },
      ));

      expect(summary.errors).toBe(1);
      expect(summary.scanned).toBe(2);
    });
  });

  describe('idempotency', () => {
    it('skips already-processed message IDs in the batch pre-filter', async () => {
      setupDb({ processedMessageIds: ['msg-001'] });

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [BASE_EMAIL],
        { 'msg-001': makeReceiptClassification() },
      ));

      expect(summary.scanned).toBe(0);
      expect(cardService.createCard).not.toHaveBeenCalled();
    });
  });

  describe('normalizer parity', () => {
    it('moves card to rejection stage when company name is Hebrew-only', async () => {
      const { insertedProcessedEmails } = setupDb({
        existingCards: [{ id: 'card-1', company_name: 'חברה ישראלית', role_title: 'Engineer' }],
      });
      (cardService.moveCard as jest.Mock).mockResolvedValue({});

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [REJECTION_EMAIL],
        { 'msg-002': makeRejectionClassification({ companyName: 'חברה ישראלית' }) },
      ));

      // Hebrew letters are preserved — both normalize to 'חברהישראלית', companyMatch returns true
      expect(summary.rejectionsMoved).toBe(1);
      expect(insertedProcessedEmails).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: 'moved_to_rejected' })]),
      );
    });

    it('matches punctuation-heavy company name correctly', async () => {
      const { } = setupDb({
        existingCards: [{ id: 'card-1', company_name: 'Acme, Inc.', role_title: 'Engineer' }],
      });
      (cardService.moveCard as jest.Mock).mockResolvedValue({});

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [REJECTION_EMAIL],
        { 'msg-002': makeRejectionClassification({ companyName: 'Acme Inc' }) },
      ));

      // Both normalize to 'acmeinc' — should match
      expect(summary.rejectionsMoved).toBe(1);
    });

    it('3-char extracted company name is rejected as too short to be meaningful', async () => {
      setupDb({
        existingCards: [{ id: 'card-1', company_name: 'IBM', role_title: 'Engineer' }],
      });

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [REJECTION_EMAIL],
        { 'msg-002': makeRejectionClassification({ companyName: 'IBM' }) },
      ));

      // 'IBM' normalizes to 'ibm' (3 chars) → b.length <= 3 → no match
      expect(summary.noMatch).toBe(1);
    });
  });

  describe('per-email transaction isolation', () => {
    it('records email_handler_error for the failing email and continues processing the next', async () => {
      setupDb({ existingCards: [] });
      (cardService.createCard as jest.Mock).mockResolvedValue({ id: 'card-new' });

      // First transaction call (email 1) throws; subsequent calls succeed normally.
      const normalImpl = mockTransaction.getMockImplementation()!;
      let transactionCallCount = 0;
      mockTransaction.mockImplementation(async (cb: (trx: unknown) => Promise<void>) => {
        transactionCallCount++;
        if (transactionCallCount === 1) {
          throw new Error('simulated ERR_NO_STAGES failure');
        }
        return normalImpl(cb);
      });

      const failEmail: RawEmail = { ...BASE_EMAIL, messageId: 'msg-fail' };
      const okEmail: RawEmail = { ...BASE_EMAIL, messageId: 'msg-ok' };

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [failEmail, okEmail],
        {
          'msg-fail': makeReceiptClassification(),
          'msg-ok': makeReceiptClassification(),
        },
      ));

      expect(summary.errors).toBe(1);
      expect(summary.receiptsCreated).toBe(1);
    });

    it('does not rethrow — syncUserGmailWith resolves even when every email fails', async () => {
      setupDb({ existingCards: [] });

      // Per-email transaction (call 1) throws; last_sync_at transaction (call 2) uses normal mock.
      const normalImpl = mockTransaction.getMockImplementation()!;
      let transactionCallCount = 0;
      mockTransaction.mockImplementation(async (cb: (trx: unknown) => Promise<void>) => {
        transactionCallCount++;
        if (transactionCallCount === 1) {
          throw new Error('all failing');
        }
        return normalImpl(cb);
      });

      const summary = await syncUserGmailWith(USER_ID, makeDeps(
        [BASE_EMAIL],
        { 'msg-001': makeReceiptClassification() },
      ));

      expect(summary.errors).toBe(1);
    });
  });

  describe('SyncSummary shape', () => {
    it('includes durationMs in the result', async () => {
      setupDb({ gmailToken: null });

      const summary = await syncUserGmailWith(USER_ID, makeDeps([], {}));

      expect(typeof summary.durationMs).toBe('number');
      expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
