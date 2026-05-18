import { Knex } from 'knex';
import db from '../config/database';
import logger from '../config/logger';
import { gmailService } from './gmailService';
import { classifyEmail, EmailClassification } from './emailClassifier';
import { cardService } from './cardService';
import { AppError } from '../middleware/errorHandler';

// ── Public types ──────────────────────────────────────────────────────────────

// Opaque handle — the production adapter knows the real Gmail API type;
// test adapters pass any non-null object.
export type GmailClient = unknown;

export interface RawEmail {
  messageId: string;
  subject: string;
  sender: string;
  body: string;
  receivedAt: Date;
}

export interface GmailPort {
  getValidClient(userId: string): Promise<GmailClient | null>;
  fetchUnreadEmails(client: GmailClient, since: Date | null): Promise<RawEmail[]>;
}

export interface ClassifierPort {
  classify(email: RawEmail): Promise<EmailClassification>;
}

export interface SyncDeps {
  gmail: GmailPort;
  classifier: ClassifierPort;
  db: Knex;
  clock?: () => Date;
}

export interface SyncSummary {
  scanned: number;
  receiptsCreated: number;
  receiptsAlreadyTracked: number;
  receiptsLowConfidence: number;
  rejectionsMoved: number;
  lowConfidence: number;
  noMatch: number;
  ambiguous: number;
  notActionable: number;
  errors: number;
  durationMs: number;
}

// ── Internal types ────────────────────────────────────────────────────────────

const MAX_VARCHAR_255 = 255;
const CONFIDENCE_THRESHOLD = 0.9;

type ProcessedAction =
  | 'receipt_created'
  | 'receipt_already_tracked'
  | 'receipt_low_confidence'
  | 'moved_to_rejected'
  | 'low_confidence'
  | 'no_match'
  | 'ambiguous_match'
  | 'not_actionable'
  | 'classifier_error';

interface ClassifiedEmail {
  email: RawEmail;
  classification: EmailClassification | null;
}

// ── Canonical match helpers ───────────────────────────────────────────────────

function truncate(value: string | null | undefined, max = MAX_VARCHAR_255): string | null {
  if (value == null) return null;
  return value.length > max ? value.slice(0, max) : value;
}

// Strips all non-ASCII-alphanumeric chars and lowercases. Returns empty string
// for names that consist entirely of non-ASCII characters (e.g. Hebrew-only).
function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Canonical company match — used for both receipt and rejection paths.
// Rejects if the card company has no ASCII alphanumeric content, or the
// extracted name is too short (≤3 chars) to be meaningful.
function companyMatch(cardCompany: string, extractedCompany: string): boolean {
  const a = normalize(cardCompany);
  const b = normalize(extractedCompany);
  if (a.length === 0 || b.length <= 3) return false;
  return a.includes(b) || b.includes(a);
}

// Canonical role match — used for receipt duplicate detection only.
// No 3-char guard: role titles can legitimately be short (e.g. "QA").
function roleMatch(cardRole: string, extractedRole: string): boolean {
  const a = normalize(cardRole);
  const b = normalize(extractedRole);
  if (a.length === 0 || b.length === 0) return false;
  return a.includes(b) || b.includes(a);
}

// ── Core implementation ───────────────────────────────────────────────────────

export async function syncUserGmailWith(
  userId: string,
  deps: SyncDeps,
): Promise<SyncSummary> {
  const startMs = (deps.clock ?? (() => new Date()))().getTime();
  const summary: SyncSummary = {
    scanned: 0,
    receiptsCreated: 0,
    receiptsAlreadyTracked: 0,
    receiptsLowConfidence: 0,
    rejectionsMoved: 0,
    lowConfidence: 0,
    noMatch: 0,
    ambiguous: 0,
    notActionable: 0,
    errors: 0,
    durationMs: 0,
  };
  const knex = deps.db;

  // ── Token + client lookup ─────────────────────────────────────────────────
  const gmailToken = await knex('gmail_tokens').where({ user_id: userId, is_valid: true }).first();
  if (!gmailToken) return finalize(summary, startMs);

  const client = await deps.gmail.getValidClient(userId);
  if (!client) return finalize(summary, startMs);

  const lastSyncAt: Date | null = gmailToken.last_sync_at ? new Date(gmailToken.last_sync_at) : null;

  // ── Fetch emails (external I/O — outside transaction) ────────────────────
  const emails = await deps.gmail.fetchUnreadEmails(client, lastSyncAt);

  // ── Batch idempotency pre-filter ─────────────────────────────────────────
  const messageIds = emails.map(e => e.messageId);
  const processedRows = messageIds.length > 0
    ? await knex('processed_emails')
        .where({ user_id: userId })
        .whereIn('gmail_message_id', messageIds)
        .select('gmail_message_id')
    : [];
  const processedSet = new Set(processedRows.map((r: { gmail_message_id: string }) => r.gmail_message_id));

  const unprocessed = emails.filter(e => !processedSet.has(e.messageId));

  // ── Classify all unprocessed emails (external I/O — outside transaction) ─
  const classified: ClassifiedEmail[] = [];
  for (const email of unprocessed) {
    summary.scanned++;
    try {
      const classification = await deps.classifier.classify(email);
      classified.push({ email, classification });
    } catch (err) {
      logger.error('Email classification failed', { userId, messageId: email.messageId, error: err });
      classified.push({ email, classification: null });
      summary.errors++;
    }
  }

  // ── Hoist read-only lookups before the transaction ───────────────────────
  const [rejectionStage, userCards] = await Promise.all([
    knex('stages').where({ user_id: userId, is_rejection_stage: true }).first(),
    knex('cards')
      .join('stages', 'cards.stage_id', 'stages.id')
      .where({ 'cards.user_id': userId })
      .where('stages.is_rejection_stage', false)
      .select('cards.*', 'stages.name as stage_name'),
  ]);

  // ── Process under per-user advisory lock + transaction ───────────────────
  await knex.transaction(async (trx) => {
    // Serialises all DB writes for this user across concurrent sync calls.
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`gmail_sync:${userId}`]);

    for (const { email, classification } of classified) {
      // In-transaction idempotency re-check handles concurrent races that slipped
      // past the pre-filter.
      const alreadyDone = await trx('processed_emails')
        .where({ user_id: userId, gmail_message_id: email.messageId })
        .first();
      if (alreadyDone) continue;

      if (classification === null) {
        await trx('processed_emails').insert({
          user_id: userId,
          gmail_message_id: email.messageId,
          subject: email.subject,
          sender: truncate(email.sender),
          received_at: email.receivedAt,
          action: 'classifier_error' as ProcessedAction,
        }).onConflict(['user_id', 'gmail_message_id']).ignore();
        continue;
      }

      const baseLog = {
        user_id: userId,
        gmail_message_id: email.messageId,
        subject: email.subject,
        sender: truncate(email.sender),
        received_at: email.receivedAt,
        confidence: classification.confidence,
        extracted_company: truncate(classification.companyName),
        extracted_role_title: classification.type === 'application_receipt'
          ? truncate(classification.roleTitle) : null,
        extracted_job_url: classification.type === 'application_receipt'
          ? classification.jobUrl : null,
      };

      if (classification.type === 'application_receipt') {
        await processReceipt(trx, userId, email, classification as EmailClassification & { type: 'application_receipt' }, baseLog, summary);
        continue;
      }

      if (classification.type === 'other') {
        await trx('processed_emails')
          .insert({ ...baseLog, action: 'not_actionable' as ProcessedAction })
          .onConflict(['user_id', 'gmail_message_id']).ignore();
        summary.notActionable++;
        continue;
      }

      // classification.type === 'rejection'
      await processRejection(trx, userId, email, classification as EmailClassification & { type: 'rejection' }, baseLog, rejectionStage, userCards, summary);
    }

    await trx('gmail_tokens')
      .where({ user_id: userId })
      .update({ last_sync_at: trx.fn.now(), updated_at: trx.fn.now() });
  });

  return finalize(summary, startMs);
}

// ── Receipt path ──────────────────────────────────────────────────────────────

async function processReceipt(
  trx: Knex.Transaction,
  userId: string,
  email: RawEmail,
  classification: EmailClassification & { type: 'application_receipt' },
  baseLog: Record<string, unknown>,
  summary: SyncSummary,
): Promise<void> {
  const { companyName, roleTitle, jobUrl, confidence } = classification;

  if (!Number.isFinite(confidence) || confidence < CONFIDENCE_THRESHOLD || companyName === null) {
    await trx('processed_emails')
      .insert({ ...baseLog, action: 'receipt_low_confidence' as ProcessedAction })
      .onConflict(['user_id', 'gmail_message_id']).ignore();
    await trx('notifications').insert({
      user_id: userId,
      title: 'Application email detected',
      body: 'We found a possible application email but could not process it with high enough confidence.',
      metadata: { companyName, roleTitle, confidence },
    });
    summary.receiptsLowConfidence++;
    return;
  }

  const appliedStage = await trx('stages').where({ user_id: userId, is_applied_stage: true }).first();
  let stage = appliedStage;
  let usingFallbackStage = false;

  if (!stage) {
    stage = await trx('stages').where({ user_id: userId, is_default: true }).first();
    usingFallbackStage = true;
  }

  if (!stage) {
    throw new AppError(
      'No stages configured for user — cannot process application receipt',
      500,
      'ERR_NO_STAGES',
    );
  }

  const existingCards: { id: string; company_name: string; role_title: string }[] = await trx('cards')
    .where({ user_id: userId })
    .select('id', 'company_name', 'role_title');

  const finalRoleTitle = roleTitle ?? 'Unknown Role';

  const matchedCard = existingCards.find(card =>
    companyMatch(card.company_name, companyName) &&
    roleMatch(card.role_title, finalRoleTitle),
  );

  if (matchedCard) {
    await trx('processed_emails')
      .insert({ ...baseLog, action: 'receipt_already_tracked' as ProcessedAction, card_id: matchedCard.id })
      .onConflict(['user_id', 'gmail_message_id']).ignore();
    await trx('notifications').insert({
      user_id: userId,
      title: 'Application already tracked',
      body: `Your application to ${truncate(companyName, 120)} is already in your pipeline.`,
      metadata: { companyName, roleTitle, matchedCardId: matchedCard.id },
    });
    summary.receiptsAlreadyTracked++;
    return;
  }

  // cardService.createCard uses the global db instance (not trx) and makes an
  // external Clearbit call. Both are known limitations deferred to a future
  // Clearbit-extraction refactor. The advisory lock serialises this operation
  // so concurrent syncs cannot race to create duplicate cards.
  const card = await cardService.createCard(userId, {
    stage_id: stage.id,
    company_name: companyName,
    role_title: finalRoleTitle,
    application_url: jobUrl ?? undefined,
    source: 'email',
    date_applied: email.receivedAt.toISOString().split('T')[0],
  });

  await trx('processed_emails')
    .insert({ ...baseLog, action: 'receipt_created' as ProcessedAction, card_id: card.id })
    .onConflict(['user_id', 'gmail_message_id']).ignore();

  const safeCompany = truncate(companyName, 120);
  const notificationBody = usingFallbackStage
    ? `Application to ${safeCompany} added — no "Applied" stage found, placed in default stage.`
    : `Application to ${safeCompany} added to your pipeline.`;

  await trx('notifications').insert({
    user_id: userId,
    title: 'Application added',
    body: notificationBody,
    metadata: { companyName, roleTitle: finalRoleTitle, cardId: card.id },
  });

  summary.receiptsCreated++;
}

// ── Rejection path ────────────────────────────────────────────────────────────

async function processRejection(
  trx: Knex.Transaction,
  userId: string,
  email: RawEmail,
  classification: EmailClassification & { type: 'rejection' },
  baseLog: Record<string, unknown>,
  rejectionStage: { id: string } | undefined,
  cards: Array<{ id: string; company_name: string; role_title: string }>,
  summary: SyncSummary,
): Promise<void> {
  if (!rejectionStage) {
    await trx('processed_emails')
      .insert({ ...baseLog, action: 'no_match' as ProcessedAction })
      .onConflict(['user_id', 'gmail_message_id']).ignore();
    summary.noMatch++;
    return;
  }

  if (classification.confidence < CONFIDENCE_THRESHOLD) {
    await trx('processed_emails')
      .insert({ ...baseLog, action: 'low_confidence' as ProcessedAction })
      .onConflict(['user_id', 'gmail_message_id']).ignore();
    await trx('notifications').insert({
      user_id: userId,
      title: 'Possible rejection — needs review',
      body: `An email from ${classification.companyName ?? 'unknown company'} may be a rejection (low confidence)`,
      metadata: { gmailMessageId: email.messageId },
    });
    summary.lowConfidence++;
    return;
  }

  if (!classification.companyName) {
    await trx('processed_emails')
      .insert({ ...baseLog, action: 'no_match' as ProcessedAction })
      .onConflict(['user_id', 'gmail_message_id']).ignore();
    summary.noMatch++;
    return;
  }

  const matches = cards.filter(c => companyMatch(c.company_name, classification.companyName!));

  if (matches.length === 0) {
    await trx('processed_emails')
      .insert({ ...baseLog, action: 'no_match' as ProcessedAction })
      .onConflict(['user_id', 'gmail_message_id']).ignore();
    await trx('notifications').insert({
      user_id: userId,
      title: 'Rejection email — no card found',
      body: `Received a rejection from ${classification.companyName} but no matching card was found`,
      metadata: { gmailMessageId: email.messageId, extractedCompany: classification.companyName },
    });
    summary.noMatch++;
  } else if (matches.length > 1) {
    await trx('processed_emails')
      .insert({ ...baseLog, action: 'ambiguous_match' as ProcessedAction })
      .onConflict(['user_id', 'gmail_message_id']).ignore();
    await trx('notifications').insert({
      user_id: userId,
      title: 'Rejection email needs review',
      body: `Received a rejection from ${classification.companyName} but multiple cards match`,
      metadata: { gmailMessageId: email.messageId, extractedCompany: classification.companyName },
    });
    summary.ambiguous++;
  } else {
    const card = matches[0];
    // cardService.moveCard uses the global db instance (not trx) and contains
    // its own internal transaction for position shifting. Same advisory-lock
    // serialisation applies as for createCard above.
    await cardService.moveCard(card.id, userId, rejectionStage.id, 0);
    await trx('processed_emails')
      .insert({ ...baseLog, action: 'moved_to_rejected' as ProcessedAction, card_id: card.id })
      .onConflict(['user_id', 'gmail_message_id']).ignore();
    await trx('notifications').insert({
      user_id: userId,
      title: 'Application marked as Rejected',
      body: `${card.company_name} – ${card.role_title} was moved to Rejected`,
      metadata: { cardId: card.id, gmailMessageId: email.messageId },
    });
    summary.rejectionsMoved++;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function finalize(summary: SyncSummary, startMs: number): SyncSummary {
  return { ...summary, durationMs: Date.now() - startMs };
}

// ── Production adapters ───────────────────────────────────────────────────────

const realGmailPort: GmailPort = {
  async getValidClient(userId: string) {
    return gmailService.getValidClient(userId) as Promise<GmailClient | null>;
  },
  async fetchUnreadEmails(client: GmailClient, since: Date | null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return gmailService.fetchUnreadEmails(client as any, since);
  },
};

const realClassifierPort: ClassifierPort = {
  async classify(email: RawEmail) {
    return classifyEmail(email.subject, email.body);
  },
};

export async function syncUserGmail(userId: string): Promise<SyncSummary> {
  return syncUserGmailWith(userId, {
    gmail: realGmailPort,
    classifier: realClassifierPort,
    db,
  });
}
