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
import * as cardServiceModule from '../../src/services/cardService';

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

function makeOtherClassification(
  overrides: Partial<EmailClassification> = {},
): EmailClassification {
  return {
    type: 'other',
    companyName: null,
    roleTitle: null,
    jobUrl: null,
    confidence: 0.6,
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

  // Happy-path receipt: a high-confidence application_receipt email must create an application card
  // in the user's Applied stage, write a receipt_created audit row to processed_emails, and emit
  // an "Application added" notification so the user sees the card immediately in the pipeline.
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

  // Duplicate-receipt dedup: when the user already has a non-rejection-stage card matching the
  // company+role extracted from the email, the sync must not create a second card. It should
  // write receipt_already_tracked to processed_emails and fire an "Application already tracked"
  // notification so the user knows the email was seen but no action was taken.
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

  // Low-confidence receipt: when the classifier's confidence is below the 0.9 threshold, the sync
  // must not create a card (too uncertain to act automatically). It writes receipt_low_confidence
  // and fires a soft "Application email detected" notification prompting the user to review manually.
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

  // Fallback stage: if the user has no is_applied_stage but does have a default stage, a new card
  // should land in the default stage rather than being dropped. The notification body must mention
  // "default stage" so the user understands why the card isn't in their usual Applied column.
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

  // Single-match rejection: when exactly one non-rejection-stage card matches the company from the
  // rejection email, the sync must move that card to the Rejected stage, write a moved_to_rejected
  // audit row linking to the card, and fire an "Application marked as Rejected" notification.
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

  // Ambiguous rejection: when multiple non-rejection-stage cards match the company, the sync must
  // not move any card (to avoid choosing the wrong one). It writes ambiguous_match and fires a
  // "Rejection email needs review" notification so the user can manually decide which card to move.
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

  // No-match rejection: when no card matches the company from the rejection email, the sync writes
  // no_match and fires a "Rejection email — no card found" notification. This is the case where
  // the user received a rejection for an application they never tracked in the pipeline.
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

  // Low-confidence rejection: when the classifier's confidence is below 0.9 for a rejection email,
  // the sync must not move any card. It writes low_confidence and fires a "Possible rejection —
  // needs review" notification so the user can decide whether to trust the classification.
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

  // Non-actionable email: when the classifier returns type=other (neither a receipt nor a rejection),
  // the sync must write a not_actionable audit row and fire no notification, since there is nothing
  // meaningful to surface to the user about a newsletter, promotional email, or other irrelevant message.
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

  // Classifier failure: when the LLM classifier throws for one email, the sync must write a
  // classifier_error audit row for that email and continue processing the remaining emails in the
  // batch. A single bad email must not poison the entire sync run.
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

  // Idempotency: running syncUserGmailWith twice with the same email batch must be a complete no-op
  // on the second run. The pre-filter and the in-transaction re-check both guard against duplicate
  // processed_emails rows, cards, and notifications — protecting against accidental re-delivery.
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

  // Single-email concurrency: two sync calls that race on the same email must produce exactly one
  // card, one audit row, and one notification — not two. The pg_advisory_xact_lock serializes
  // per-email writes so only one sync wins the insert and the other exits via the in-trx re-check.
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

  // Per-email transaction isolation: when the classifier crashes on one email in the middle of a
  // batch, the cards and audit rows for all other emails must persist. Each email runs in its own
  // short transaction so a failure on email #3 cannot roll back the already-committed emails #1, #2, #4, #5.
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
    // Short-acronym guard: company names whose normalized ASCII form is 3 chars or fewer (e.g. "ABC")
    // must never match any card — the companyMatch guard rejects them to prevent false-positive
    // rejections on common abbreviations that appear in many unrelated companies.
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

    // Non-ASCII company name: a company name consisting entirely of non-ASCII characters (e.g. Hebrew)
    // normalizes to an empty string, which companyMatch rejects. The sync must produce no_match and
    // must not crash, ensuring the normalizer handles international company names gracefully.
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

    // Punctuation normalization: company names that differ only by punctuation or whitespace (e.g.
    // "Alpha, Inc." vs "Alpha Inc") must still match after normalization strips all non-alphanumeric
    // ASCII. This prevents rejection emails from failing to match a card due to formatting differences.
    // Punctuation normalization: company names that differ only by punctuation or whitespace (e.g.
    // "Alpha, Inc." vs "Alpha Inc") must still match after normalization strips all non-alphanumeric
    // ASCII. This prevents rejection emails from failing to match a card due to formatting differences.
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

  // ── Regression: #149 email_handler_error ──────────────────────────────────

  // Regression guard for fix #149: the per-email catch block must write an email_handler_error
  // audit row when the per-email transaction itself throws (e.g. ERR_NO_STAGES). Without this
  // row, a re-run of the sync would re-attempt the same email indefinitely, burning LLM budget.
  // The loop must also continue to the next email so a single broken email does not halt the batch.
  it('email_handler_error: per-email transaction throw writes audit row and loop continues', async () => {
    // Remove ALL stages so processReceipt throws ERR_NO_STAGES after the dedup check passes.
    // The per-email catch block fires and writes email_handler_error via the outer knex (not trx).
    await db('stages').where({ user_id: userId }).delete();

    const email1 = makeEmail({ messageId: 'msg-handler-err' });
    const email2 = makeEmail({ messageId: 'msg-handler-ok' });

    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail([email1, email2]),
      classifier: fakeClassifier({
        'msg-handler-err': makeReceiptClassification(),
        'msg-handler-ok': makeOtherClassification(),
      }),
      db,
    });

    expect(summary.errors).toBe(1);
    expect(summary.notActionable).toBe(1);

    const [errAudit] = await db('processed_emails').where({
      user_id: userId,
      gmail_message_id: 'msg-handler-err',
    });
    expect(errAudit.action).toBe('email_handler_error');

    // The loop continued past the failing email and processed the next one.
    const [okAudit] = await db('processed_emails').where({
      user_id: userId,
      gmail_message_id: 'msg-handler-ok',
    });
    expect(okAudit.action).toBe('not_actionable');
  });

  // ── Regression: #150 trx atomicity ────────────────────────────────────────

  // Regression guard for fix #150: cardService.createCard is called with the per-email trx, so
  // the card INSERT is part of the same transaction as the processed_emails INSERT. If anything
  // in the transaction fails after createCard returns, both writes roll back together — no orphan
  // card is left in the cards table pointing to a non-existent audit row.
  it('trx atomicity: card INSERT rolls back with the outer transaction on mid-trx failure', async () => {
    const original = cardServiceModule.cardService.createCard.bind(cardServiceModule.cardService);
    // Call through so the card is written into the open trx, then throw to force the rollback.
    const spy = jest
      .spyOn(cardServiceModule.cardService, 'createCard')
      .mockImplementation(async (...args: Parameters<typeof cardServiceModule.cardService.createCard>) => {
        await original(...args);
        throw new Error('simulated post-createCard failure');
      });

    try {
      const email = makeEmail({ messageId: 'msg-atomicity' });
      const summary = await syncUserGmailWith(userId, {
        gmail: fakeGmail([email]),
        classifier: fakeClassifier({ 'msg-atomicity': makeReceiptClassification() }),
        db,
      });

      // The per-email catch block fires: errors counter incremented.
      expect(summary.errors).toBe(1);
      expect(summary.receiptsCreated).toBe(0);

      // The transaction rolled back: no orphan card in the pipeline.
      const cards = await db('cards').where({ user_id: userId });
      expect(cards).toHaveLength(0);

      // The best-effort email_handler_error audit row was written outside the failed trx.
      const [audit] = await db('processed_emails').where({
        user_id: userId,
        gmail_message_id: 'msg-atomicity',
      });
      expect(audit.action).toBe('email_handler_error');
    } finally {
      spy.mockRestore();
    }
  });

  // ── last_sync_at advancement ───────────────────────────────────────────────

  // Cursor advancement — success: gmail_tokens.last_sync_at is the fetch cursor that prevents
  // re-fetching already-classified emails on the next cron tick. After a successful sync it
  // must advance from null to a recent timestamp; if it stays null, every future sync re-fetches
  // every email from the beginning, wasting LLM quota.
  it('last_sync_at: advances after a successful sync', async () => {
    const before = await db('gmail_tokens').where({ user_id: userId }).first();
    expect(before.last_sync_at).toBeNull();

    const email = makeEmail({ messageId: 'msg-cursor-ok' });
    await syncUserGmailWith(userId, {
      gmail: fakeGmail([email]),
      classifier: fakeClassifier({ 'msg-cursor-ok': makeReceiptClassification() }),
      db,
    });

    const after = await db('gmail_tokens').where({ user_id: userId }).first();
    expect(after.last_sync_at).not.toBeNull();
    expect(new Date(after.last_sync_at).getTime()).toBeGreaterThan(Date.now() - 10_000);
  });

  // Cursor advancement — partial failure: even when some emails error, the sync should still
  // advance last_sync_at so the cursor moves forward. The errored emails are recorded in
  // processed_emails with email_handler_error and will not be re-fetched next time.
  it('last_sync_at: still advances when some emails errored', async () => {
    const email1 = makeEmail({ messageId: 'msg-cursor-err' });
    const email2 = makeEmail({ messageId: 'msg-cursor-ok2' });

    // Delete stages to force ERR_NO_STAGES for email1 but let email2 succeed as type=other.
    await db('stages').where({ user_id: userId }).delete();

    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail([email1, email2]),
      classifier: fakeClassifier({
        'msg-cursor-err': makeReceiptClassification(),
        'msg-cursor-ok2': makeOtherClassification(),
      }),
      db,
    });

    expect(summary.errors).toBe(1);

    const token = await db('gmail_tokens').where({ user_id: userId }).first();
    expect(token.last_sync_at).not.toBeNull();
  });

  // ── Token invalidity early-exit ────────────────────────────────────────────

  // Token-invalidity gate: when the user's gmail_tokens row has is_valid = false (e.g. OAuth
  // token revoked), syncUserGmailWith must return immediately with an empty SyncSummary and must
  // not call the Gmail API or write any cards, preventing syncs against revoked credentials.
  it('early exit: returns empty summary when gmail_tokens.is_valid = false', async () => {
    await db('gmail_tokens').where({ user_id: userId }).update({ is_valid: false });

    let gmailFetchCalled = false;
    const guardedGmail: GmailPort = {
      async getValidClient(_userId: string): Promise<GmailClient | null> {
        return {} as GmailClient;
      },
      async fetchUnreadEmails(_client: GmailClient, _since: Date | null): Promise<RawEmail[]> {
        gmailFetchCalled = true;
        return [makeEmail({ messageId: 'should-not-fetch' })];
      },
    };

    const summary = await syncUserGmailWith(userId, {
      gmail: guardedGmail,
      classifier: fakeClassifier({}),
      db,
    });

    expect(summary.scanned).toBe(0);
    expect(gmailFetchCalled).toBe(false);

    const cards = await db('cards').where({ user_id: userId });
    expect(cards).toHaveLength(0);
  });

  // ── Mixed-classification batch ─────────────────────────────────────────────

  // Mixed batch: a real sync batch contains emails of every classification type interleaved.
  // The per-email loop must route each email to the correct handler independently — a receipt,
  // a duplicate, a rejection match, a no-match rejection, and a non-actionable email all in one
  // call — and the SyncSummary counters must each reflect exactly one hit per type.
  it('mixed batch: all five classification outcomes process correctly in a single sync', async () => {
    // Seed a tracked Acme/SWE card (for receipt_already_tracked) and a Beta/PM card (for rejection).
    const [acmeCard] = await db('cards')
      .insert({
        user_id: userId,
        stage_id: stages.appliedStageId,
        company_name: 'Acme Corp',
        role_title: 'Software Engineer',
        position: 0,
      })
      .returning('*');

    await db('cards').insert({
      user_id: userId,
      stage_id: stages.appliedStageId,
      company_name: 'Beta Ltd',
      role_title: 'Product Manager',
      position: 1,
    });

    const emails = [
      makeEmail({ messageId: 'msg-mix-new-receipt' }),
      makeEmail({ messageId: 'msg-mix-tracked' }),
      makeEmail({ messageId: 'msg-mix-rejection-match' }),
      makeEmail({ messageId: 'msg-mix-rejection-nomatch' }),
      makeEmail({ messageId: 'msg-mix-other' }),
    ];

    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail(emails),
      classifier: fakeClassifier({
        'msg-mix-new-receipt': makeReceiptClassification({ companyName: 'Gamma LLC', roleTitle: 'Dev' }),
        'msg-mix-tracked': makeReceiptClassification({ companyName: 'Acme Corp', roleTitle: 'Software Engineer' }),
        'msg-mix-rejection-match': makeRejectionClassification({ companyName: 'Beta Ltd' }),
        'msg-mix-rejection-nomatch': makeRejectionClassification({ companyName: 'Delta Co' }),
        'msg-mix-other': makeOtherClassification(),
      }),
      db,
    });

    expect(summary.receiptsCreated).toBe(1);
    expect(summary.receiptsAlreadyTracked).toBe(1);
    expect(summary.rejectionsMoved).toBe(1);
    expect(summary.noMatch).toBe(1);
    expect(summary.notActionable).toBe(1);
    expect(summary.errors).toBe(0);

    // Verify audit rows: each email must have exactly one processed_emails row.
    const auditRows = await db('processed_emails').where({ user_id: userId }).orderBy('processed_at');
    expect(auditRows).toHaveLength(5);
    const actions = new Set(auditRows.map((r: { action: string }) => r.action));
    expect(actions).toContain('receipt_created');
    expect(actions).toContain('receipt_already_tracked');
    expect(actions).toContain('moved_to_rejected');
    expect(actions).toContain('no_match');
    expect(actions).toContain('not_actionable');

    // Acme/SWE card must be unchanged; Beta/PM card must be in the rejection stage.
    const [updatedAcme] = await db('cards').where({ id: acmeCard.id });
    expect(updatedAcme.stage_id).toBe(stages.appliedStageId);

    const betaCards = await db('cards').where({ company_name: 'Beta Ltd', user_id: userId });
    expect(betaCards[0].stage_id).toBe(stages.rejectionStageId);

    // A new Gamma LLC card must exist.
    const gammaCards = await db('cards').where({ company_name: 'Gamma LLC', user_id: userId });
    expect(gammaCards).toHaveLength(1);
  });

  // ── Multi-email parallel concurrency ──────────────────────────────────────

  // Multi-email concurrency: two parallel syncs each carrying the same 3-email batch must produce
  // exactly 3 cards, 3 audit rows, and no duplicates. With per-email advisory locks (post-#149),
  // the lock cycles per email rather than per batch — this test proves the serialization still
  // works correctly when both syncs have multiple overlapping emails.
  it('multi-email concurrency: two parallel syncs each with 3 emails produce singleton outcomes', async () => {
    const emails = [
      makeEmail({ messageId: 'msg-multi-1' }),
      makeEmail({ messageId: 'msg-multi-2' }),
      makeEmail({ messageId: 'msg-multi-3' }),
    ];
    const classifications = {
      'msg-multi-1': makeReceiptClassification({ companyName: 'Alpha Inc', roleTitle: 'Dev' }),
      'msg-multi-2': makeReceiptClassification({ companyName: 'Beta Ltd', roleTitle: 'Dev' }),
      'msg-multi-3': makeReceiptClassification({ companyName: 'Gamma LLC', roleTitle: 'Dev' }),
    };

    await Promise.all([
      syncUserGmailWith(userId, {
        gmail: fakeGmail(emails),
        classifier: fakeClassifier(classifications),
        db,
      }),
      syncUserGmailWith(userId, {
        gmail: fakeGmail(emails),
        classifier: fakeClassifier(classifications),
        db,
      }),
    ]);

    // Each company must produce exactly one card — not two from each parallel sync.
    const cards = await db('cards').where({ user_id: userId });
    expect(cards).toHaveLength(3);

    // Each email must have exactly one audit row — the losing sync exits via the in-trx re-check.
    const auditRows = await db('processed_emails').where({ user_id: userId });
    expect(auditRows).toHaveLength(3);
  });

  // ── Re-apply after rejection ───────────────────────────────────────────────

  // Re-application after rejection (fix from PR #146 review): the receipt match query excludes
  // rejection-stage cards so a user who was rejected and re-applies to the same company+role
  // gets a fresh card instead of being silently marked "already tracked". Without the
  // is_rejection_stage = false filter, the old rejected card would block the new receipt.
  it('receipt match excludes rejection-stage cards: re-applying creates a fresh card', async () => {
    // Seed an existing rejected card for Acme Corp / Software Engineer.
    const [rejectedCard] = await db('cards')
      .insert({
        user_id: userId,
        stage_id: stages.rejectionStageId,
        company_name: 'Acme Corp',
        role_title: 'Software Engineer',
        position: 0,
      })
      .returning('*');

    const email = makeEmail({ messageId: 'msg-reapply' });
    const summary = await syncUserGmailWith(userId, {
      gmail: fakeGmail([email]),
      classifier: fakeClassifier({
        'msg-reapply': makeReceiptClassification({ companyName: 'Acme Corp', roleTitle: 'Software Engineer' }),
      }),
      db,
    });

    // A fresh card must be created — not suppressed by the existing rejected one.
    expect(summary.receiptsCreated).toBe(1);
    expect(summary.receiptsAlreadyTracked).toBe(0);

    const cards = await db('cards').where({ user_id: userId });
    expect(cards).toHaveLength(2);

    // The new card must be in the Applied stage, not the rejection stage.
    const newCard = cards.find((c: { id: string }) => c.id !== rejectedCard.id);
    expect(newCard).toBeDefined();
    expect(newCard!.stage_id).toBe(stages.appliedStageId);

    const [audit] = await db('processed_emails').where({
      user_id: userId,
      gmail_message_id: 'msg-reapply',
    });
    expect(audit.action).toBe('receipt_created');
  });
});
