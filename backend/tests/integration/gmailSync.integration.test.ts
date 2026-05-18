import type { Knex } from 'knex';
import { destroyDb, getDb, truncateAll } from './db';
import {
  syncUserGmailWith,
  type ClassifierPort,
  type GmailClient,
  type GmailPort,
  type RawEmail,
} from '../../src/services/gmailSync';
import type { EmailClassification } from '../../src/services/emailClassifier';

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function seedUser(db: Knex): Promise<string> {
  const [row] = await db('users')
    .insert({
      email: `gmail-sync-test-${Date.now()}-${Math.random()}@integration.test`,
      password_hash: 'unused',
      name: 'Test User',
    })
    .returning('id');
  return row.id;
}

interface SeededStages {
  appliedStageId: string;
  defaultStageId: string;
  rejectionStageId: string;
}

async function seedStages(db: Knex, userId: string): Promise<SeededStages> {
  const rows = await db('stages')
    .insert([
      {
        user_id: userId,
        name: 'Applied',
        position: 0,
        is_applied_stage: true,
        is_default: false,
        is_rejection_stage: false,
      },
      {
        user_id: userId,
        name: 'Inbox',
        position: 1,
        is_applied_stage: false,
        is_default: true,
        is_rejection_stage: false,
      },
      {
        user_id: userId,
        name: 'Rejected',
        position: 2,
        is_rejection_stage: true,
        is_applied_stage: false,
        is_default: false,
      },
    ])
    .returning('id');
  return {
    appliedStageId: rows[0].id,
    defaultStageId: rows[1].id,
    rejectionStageId: rows[2].id,
  };
}

async function seedGmailToken(db: Knex, userId: string): Promise<void> {
  await db('gmail_tokens').insert({
    user_id: userId,
    gmail_address: 'test@gmail.com',
    access_token: 'fake-access-token',
    refresh_token: 'fake-refresh-token',
    token_expiry: new Date('2099-01-01').toISOString(),
    is_valid: true,
    last_sync_at: null,
  });
}

// ── Port fakes ────────────────────────────────────────────────────────────────

function fakeGmail(emails: RawEmail[]): GmailPort {
  return {
    async getValidClient(_userId: string): Promise<GmailClient | null> {
      return {} as GmailClient;
    },
    async fetchUnreadEmails(
      _client: GmailClient,
      _since: Date | null,
    ): Promise<RawEmail[]> {
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

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeEmail(overrides: Partial<RawEmail> & { messageId: string }): RawEmail {
  return {
    subject: 'Test Subject',
    sender: 'noreply@example.com',
    body: 'Test body',
    receivedAt: new Date('2024-06-01T10:00:00Z'),
    ...overrides,
  };
}

function makeReceiptClassification(
  overrides: Partial<EmailClassification> = {},
): EmailClassification {
  return {
    type: 'application_receipt',
    companyName: 'Acme Corp',
    roleTitle: 'Software Engineer',
    jobUrl: null,
    confidence: 0.95,
    ...overrides,
  };
}

function makeRejectionClassification(
  overrides: Partial<EmailClassification> = {},
): EmailClassification {
  return {
    type: 'rejection',
    companyName: 'Acme Corp',
    roleTitle: null,
    jobUrl: null,
    confidence: 0.95,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('syncUserGmailWith — integration', () => {
  let db: Knex;
  let userId: string;
  let stages: SeededStages;

  beforeEach(async () => {
    await truncateAll();
    db = getDb();
    userId = await seedUser(db);
    stages = await seedStages(db, userId);
    await seedGmailToken(db, userId);
  });

  afterAll(async () => {
    await truncateAll();
    await destroyDb();
  });

  // ── Receipt path ─────────────────────────────────────────────────────────

  it('receipt — happy: creates card, audit row receipt_created, and notification', async () => {
    const email = makeEmail({ messageId: 'msg-receipt-happy' });
    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail([email]),
      classifier: fakeClassifier({ 'msg-receipt-happy': makeReceiptClassification() }),
      db,
    });

    expect(summary.scanned).toBe(1);
    expect(summary.receiptsCreated).toBe(1);

    const cards = await db('cards').where({ user_id: userId });
    expect(cards).toHaveLength(1);
    expect(cards[0].company_name).toBe('Acme Corp');
    expect(cards[0].role_title).toBe('Software Engineer');
    expect(cards[0].stage_id).toBe(stages.appliedStageId);
    expect(cards[0].source).toBe('email');

    const [audit] = await db('processed_emails').where({
      user_id: userId,
      gmail_message_id: 'msg-receipt-happy',
    });
    expect(audit.action).toBe('receipt_created');
    expect(audit.card_id).toBe(cards[0].id);

    const notifications = await db('notifications').where({ user_id: userId });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('Application added');
  });

  it('receipt — already tracked: no new card, audit row receipt_already_tracked, notification', async () => {
    await db('cards').insert({
      user_id: userId,
      stage_id: stages.appliedStageId,
      company_name: 'Acme Corp',
      role_title: 'Software Engineer',
      position: 0,
    });

    const email = makeEmail({ messageId: 'msg-receipt-tracked' });
    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail([email]),
      classifier: fakeClassifier({ 'msg-receipt-tracked': makeReceiptClassification() }),
      db,
    });

    expect(summary.receiptsAlreadyTracked).toBe(1);
    expect(summary.receiptsCreated).toBe(0);

    const cards = await db('cards').where({ user_id: userId });
    expect(cards).toHaveLength(1);

    const [audit] = await db('processed_emails').where({ user_id: userId });
    expect(audit.action).toBe('receipt_already_tracked');

    const [notification] = await db('notifications').where({ user_id: userId });
    expect(notification.title).toBe('Application already tracked');
  });

  it('receipt — low confidence: no card, audit row receipt_low_confidence, notification', async () => {
    const email = makeEmail({ messageId: 'msg-receipt-lowconf' });
    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail([email]),
      classifier: fakeClassifier({
        'msg-receipt-lowconf': makeReceiptClassification({ confidence: 0.7 }),
      }),
      db,
    });

    expect(summary.receiptsLowConfidence).toBe(1);
    expect(summary.receiptsCreated).toBe(0);

    const cards = await db('cards').where({ user_id: userId });
    expect(cards).toHaveLength(0);

    const [audit] = await db('processed_emails').where({ user_id: userId });
    expect(audit.action).toBe('receipt_low_confidence');

    const [notification] = await db('notifications').where({ user_id: userId });
    expect(notification.title).toBe('Application email detected');
  });

  it('receipt — fallback stage: card lands in default stage when no is_applied_stage exists', async () => {
    await db('stages').where({ user_id: userId, is_applied_stage: true }).delete();

    const email = makeEmail({ messageId: 'msg-receipt-fallback' });
    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail([email]),
      classifier: fakeClassifier({ 'msg-receipt-fallback': makeReceiptClassification() }),
      db,
    });

    expect(summary.receiptsCreated).toBe(1);

    const [card] = await db('cards').where({ user_id: userId });
    expect(card.stage_id).toBe(stages.defaultStageId);

    const [notification] = await db('notifications').where({ user_id: userId });
    expect(notification.title).toBe('Application added');
    expect(notification.body).toContain('default stage');
  });

  // ── Rejection path ───────────────────────────────────────────────────────

  it('rejection — single match: card moved to rejection stage, audit row moved_to_rejected, notification', async () => {
    const [card] = await db('cards')
      .insert({
        user_id: userId,
        stage_id: stages.appliedStageId,
        company_name: 'Acme Corp',
        role_title: 'Software Engineer',
        position: 0,
      })
      .returning('*');

    const email = makeEmail({ messageId: 'msg-rejection-single' });
    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail([email]),
      classifier: fakeClassifier({ 'msg-rejection-single': makeRejectionClassification() }),
      db,
    });

    expect(summary.rejectionsMoved).toBe(1);

    const [updatedCard] = await db('cards').where({ id: card.id });
    expect(updatedCard.stage_id).toBe(stages.rejectionStageId);

    const [audit] = await db('processed_emails').where({ user_id: userId });
    expect(audit.action).toBe('moved_to_rejected');
    expect(audit.card_id).toBe(card.id);

    const [notification] = await db('notifications').where({ user_id: userId });
    expect(notification.title).toBe('Application marked as Rejected');
  });

  it('rejection — ambiguous: multiple matching cards, no move, audit row ambiguous_match, notification', async () => {
    await db('cards').insert([
      {
        user_id: userId,
        stage_id: stages.appliedStageId,
        company_name: 'Acme Corp',
        role_title: 'SWE',
        position: 0,
      },
      {
        user_id: userId,
        stage_id: stages.appliedStageId,
        company_name: 'Acme Corp',
        role_title: 'PM',
        position: 1,
      },
    ]);

    const email = makeEmail({ messageId: 'msg-rejection-ambiguous' });
    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail([email]),
      classifier: fakeClassifier({ 'msg-rejection-ambiguous': makeRejectionClassification() }),
      db,
    });

    expect(summary.ambiguous).toBe(1);

    const cardsInApplied = await db('cards').where({ user_id: userId, stage_id: stages.appliedStageId });
    expect(cardsInApplied).toHaveLength(2);

    const [audit] = await db('processed_emails').where({ user_id: userId });
    expect(audit.action).toBe('ambiguous_match');

    const [notification] = await db('notifications').where({ user_id: userId });
    expect(notification.title).toBe('Rejection email needs review');
  });

  it('rejection — no match: no matching card, audit row no_match, notification', async () => {
    const email = makeEmail({ messageId: 'msg-rejection-nomatch' });
    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail([email]),
      classifier: fakeClassifier({ 'msg-rejection-nomatch': makeRejectionClassification() }),
      db,
    });

    expect(summary.noMatch).toBe(1);

    const [audit] = await db('processed_emails').where({ user_id: userId });
    expect(audit.action).toBe('no_match');

    const [notification] = await db('notifications').where({ user_id: userId });
    expect(notification.title).toBe('Rejection email — no card found');
  });

  it('rejection — low confidence: audit row low_confidence, notification', async () => {
    const email = makeEmail({ messageId: 'msg-rejection-lowconf' });
    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail([email]),
      classifier: fakeClassifier({
        'msg-rejection-lowconf': makeRejectionClassification({ confidence: 0.5 }),
      }),
      db,
    });

    expect(summary.lowConfidence).toBe(1);

    const [audit] = await db('processed_emails').where({ user_id: userId });
    expect(audit.action).toBe('low_confidence');

    const [notification] = await db('notifications').where({ user_id: userId });
    expect(notification.title).toBe('Possible rejection — needs review');
  });

  // ── Other path ───────────────────────────────────────────────────────────

  it('other: type=other → not_actionable, no notification', async () => {
    const email = makeEmail({ messageId: 'msg-other' });
    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail([email]),
      classifier: fakeClassifier({
        'msg-other': {
          type: 'other',
          companyName: null,
          roleTitle: null,
          jobUrl: null,
          confidence: 0.6,
        },
      }),
      db,
    });

    expect(summary.notActionable).toBe(1);

    const [audit] = await db('processed_emails').where({ user_id: userId });
    expect(audit.action).toBe('not_actionable');

    const notifications = await db('notifications').where({ user_id: userId });
    expect(notifications).toHaveLength(0);
  });

  // ── Classifier error ──────────────────────────────────────────────────────

  it('classifier error: writes classifier_error audit row, loop continues to next email', async () => {
    const email1 = makeEmail({ messageId: 'msg-err-1' });
    const email2 = makeEmail({ messageId: 'msg-err-2' });
    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail([email1, email2]),
      classifier: fakeClassifier({
        'msg-err-1': new Error('LLM unavailable'),
        'msg-err-2': makeReceiptClassification({ companyName: 'Beta Ltd' }),
      }),
      db,
    });

    expect(summary.scanned).toBe(2);
    expect(summary.errors).toBe(1);
    expect(summary.receiptsCreated).toBe(1);

    const auditRows = await db('processed_emails')
      .where({ user_id: userId })
      .orderBy('processed_at');
    expect(auditRows).toHaveLength(2);
    const actions = auditRows.map((r: { action: string }) => r.action);
    expect(actions).toContain('classifier_error');
    expect(actions).toContain('receipt_created');
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  it('idempotency: second sync with same emails is a complete no-op', async () => {
    const email = makeEmail({ messageId: 'msg-idempotent' });
    const deps = {
      gmail: fakeGmail([email]),
      classifier: fakeClassifier({ 'msg-idempotent': makeReceiptClassification() }),
      db,
    };

    await syncUserGmailWith(userId, deps);
    await syncUserGmailWith(userId, deps);

    const cards = await db('cards').where({ user_id: userId });
    expect(cards).toHaveLength(1);

    const auditRows = await db('processed_emails').where({
      user_id: userId,
      gmail_message_id: 'msg-idempotent',
    });
    expect(auditRows).toHaveLength(1);

    const notifications = await db('notifications').where({ user_id: userId });
    expect(notifications).toHaveLength(1);
  });

  // ── Concurrency ───────────────────────────────────────────────────────────

  it('concurrency: two parallel syncs produce exactly one card, one audit row, one notification (pg_advisory_xact_lock)', async () => {
    const email = makeEmail({ messageId: 'msg-concurrent' });
    const makeDeps = () => ({
      gmail: fakeGmail([email]),
      classifier: fakeClassifier({
        'msg-concurrent': makeReceiptClassification({ companyName: 'ConcurrentCo' }),
      }),
      db,
    });

    await Promise.all([
      syncUserGmailWith(userId, makeDeps()),
      syncUserGmailWith(userId, makeDeps()),
    ]);

    const cards = await db('cards').where({ user_id: userId });
    expect(cards).toHaveLength(1);

    const auditRows = await db('processed_emails').where({
      user_id: userId,
      gmail_message_id: 'msg-concurrent',
    });
    expect(auditRows).toHaveLength(1);

    const notifications = await db('notifications').where({ user_id: userId });
    expect(notifications).toHaveLength(1);
  });

  // ── Batch poisoning ───────────────────────────────────────────────────────

  it('batch poisoning: failure on email #3 does not roll back emails #1, #2, #4, #5 (per-email transaction)', async () => {
    const emails = [
      makeEmail({ messageId: 'msg-poison-1' }),
      makeEmail({ messageId: 'msg-poison-2' }),
      makeEmail({ messageId: 'msg-poison-3' }),
      makeEmail({ messageId: 'msg-poison-4' }),
      makeEmail({ messageId: 'msg-poison-5' }),
    ];

    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail(emails),
      classifier: fakeClassifier({
        'msg-poison-1': makeReceiptClassification({ companyName: 'Alpha Inc', roleTitle: 'Dev' }),
        'msg-poison-2': makeReceiptClassification({ companyName: 'Beta Ltd', roleTitle: 'Dev' }),
        'msg-poison-3': new Error('Simulated classifier crash'),
        'msg-poison-4': makeReceiptClassification({ companyName: 'Gamma LLC', roleTitle: 'Dev' }),
        'msg-poison-5': makeReceiptClassification({ companyName: 'Delta Co', roleTitle: 'Dev' }),
      }),
      db,
    });

    expect(summary.scanned).toBe(5);
    expect(summary.receiptsCreated).toBe(4);
    expect(summary.errors).toBe(1);

    const cards = await db('cards').where({ user_id: userId });
    expect(cards).toHaveLength(4);

    const auditRows = await db('processed_emails').where({ user_id: userId });
    expect(auditRows).toHaveLength(5);

    const actions = auditRows.map((r: { action: string }) => r.action).sort();
    expect(actions.filter((a: string) => a === 'receipt_created')).toHaveLength(4);
    expect(actions.filter((a: string) => a === 'classifier_error')).toHaveLength(1);
  });

  // ── Normalizer parity ─────────────────────────────────────────────────────

  describe('normalizer edge cases', () => {
    it('3-char company acronym is rejected by companyMatch guard — no false positive match', async () => {
      const [card] = await db('cards')
        .insert({
          user_id: userId,
          stage_id: stages.appliedStageId,
          company_name: 'ABC',
          role_title: 'Engineer',
          position: 0,
        })
        .returning('*');

      const email = makeEmail({ messageId: 'msg-norm-acronym' });
      const summary = await syncUserGmailWith(userId, {
        gmail: fakeGmail([email]),
        classifier: fakeClassifier({
          // normalize('ABC') = 'abc', length 3 ≤ 3 → companyMatch returns false
          'msg-norm-acronym': makeRejectionClassification({ companyName: 'ABC' }),
        }),
        db,
      });

      expect(summary.noMatch).toBe(1);
      expect(summary.rejectionsMoved).toBe(0);

      const [unchanged] = await db('cards').where({ id: card.id });
      expect(unchanged.stage_id).toBe(stages.appliedStageId);
    });

    it('Hebrew-only company name normalizes to empty string — no match, no crash', async () => {
      const email = makeEmail({ messageId: 'msg-norm-hebrew' });
      const summary = await syncUserGmailWith(userId, {
        gmail: fakeGmail([email]),
        classifier: fakeClassifier({
          // normalize('חברה בע"מ') = '' → length 0 ≤ 3 → companyMatch returns false
          'msg-norm-hebrew': makeRejectionClassification({ companyName: 'חברה בע"מ' }),
        }),
        db,
      });

      expect(summary.noMatch).toBe(1);
      expect(summary.errors).toBe(0);
    });

    it('punctuation-heavy name still matches when ASCII content is identical', async () => {
      const [card] = await db('cards')
        .insert({
          user_id: userId,
          stage_id: stages.appliedStageId,
          company_name: 'Alpha, Inc.',
          role_title: 'Engineer',
          position: 0,
        })
        .returning('*');

      const email = makeEmail({ messageId: 'msg-norm-punctuation' });
      const summary = await syncUserGmailWith(userId, {
        gmail: fakeGmail([email]),
        classifier: fakeClassifier({
          // normalize('Alpha, Inc.') = 'alphainc' === normalize('Alpha Inc')
          'msg-norm-punctuation': makeRejectionClassification({ companyName: 'Alpha Inc' }),
        }),
        db,
      });

      expect(summary.rejectionsMoved).toBe(1);

      const [updated] = await db('cards').where({ id: card.id });
      expect(updated.stage_id).toBe(stages.rejectionStageId);
    });
  });
});
