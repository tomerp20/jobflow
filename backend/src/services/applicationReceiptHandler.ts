import db from '../config/database';
import { cardService, resolveCompanyIconUrl } from '../services/cardService';
import { notificationService } from '../services/notificationService';
import { AppError } from '../middleware/errorHandler';

const MAX_VARCHAR_255 = 255;

function truncate(value: string | null, max = MAX_VARCHAR_255): string | null {
  if (value === null) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export interface ApplicationReceiptInput {
  userId: string;
  gmailMessageId: string;
  subject: string;
  sender: string;
  companyName: string | null;
  roleTitle: string | null;
  jobUrl: string | null;
  confidence: number;
  emailReceivedAt: Date;
}

export interface ApplicationReceiptResult {
  action: 'created' | 'already_tracked' | 'low_confidence';
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function substringMatch(a: string, b: string): boolean {
  return a.includes(b) || b.includes(a);
}

export async function applicationReceiptHandler(
  input: ApplicationReceiptInput
): Promise<ApplicationReceiptResult> {
  const { userId, gmailMessageId, subject, sender, companyName, roleTitle, jobUrl, confidence, emailReceivedAt } = input;

  const baseLog = {
    user_id: userId,
    gmail_message_id: gmailMessageId,
    subject,
    sender: truncate(sender),
    received_at: emailReceivedAt,
    confidence,
    extracted_company: truncate(companyName),
    extracted_role_title: truncate(roleTitle),
    extracted_job_url: jobUrl,
  };

  // Resolve company icon URL before the transaction — the resolution may involve an HTTP
  // call (Clearbit lookup) which must not hold a DB connection open.
  const companyIconUrl = (companyName !== null && Number.isFinite(confidence) && confidence >= 0.9)
    ? await resolveCompanyIconUrl(companyName, jobUrl ?? undefined)
    : null;

  return db.transaction(async (trx) => {
    // Serialise per-user inside this transaction. Without this lock, two concurrent
    // handlers for the same user can both read the same `cards` set in the dedup
    // check, both decide no match exists, and both create a duplicate card.
    // The lock is released automatically when the transaction commits or rolls back.
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`receipt:${userId}`]);

    // Authoritative idempotency check: if this gmail_message_id has already been
    // processed (and reached a terminal state) for this user, short-circuit. This
    // runs inside the transaction *after* the per-user advisory lock so retries
    // and races cannot get past it and create a duplicate card. We do NOT rely on
    // the ON CONFLICT DO NOTHING on the inserts below because Postgres silently
    // skips conflicting rows without aborting the transaction.
    const existingProcessed = await trx('processed_emails')
      .where({ user_id: userId, gmail_message_id: gmailMessageId })
      .select('action')
      .first();

    if (existingProcessed) {
      const prior = existingProcessed.action as string;
      if (prior === 'receipt_low_confidence') return { action: 'low_confidence' };
      if (prior === 'receipt_already_tracked') return { action: 'already_tracked' };
      if (prior === 'receipt_created') return { action: 'created' };
      // Any other recorded action (e.g. receipt_handler_error from gmailSyncService
      // after a prior crash) means no side-effect-bearing path has completed yet —
      // fall through and process normally.
    }

    if (!Number.isFinite(confidence) || confidence < 0.9 || companyName === null) {
      await trx('processed_emails')
        .insert({ ...baseLog, action: 'receipt_low_confidence' })
        .onConflict(['user_id', 'gmail_message_id'])
        .merge(['action', 'card_id', 'processed_at', 'confidence']);
      await notificationService.create(
        userId,
        'Application email detected',
        'We found a possible application email but could not process it with high enough confidence.',
        { companyName, roleTitle, confidence },
        trx
      );
      return { action: 'low_confidence' };
    }

    const appliedStage = await trx('stages')
      .where({ user_id: userId, is_applied_stage: true })
      .first();

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
        'ERR_NO_STAGES'
      );
    }

    const existingCards: { id: string; company_name: string; role_title: string }[] = await trx('cards')
      .where({ user_id: userId })
      .select('id', 'company_name', 'role_title');

    const finalRoleTitle = roleTitle ?? 'Unknown Role';
    const normalizedNewCompany = normalizeText(companyName);
    const normalizedNewRole = normalizeText(finalRoleTitle);

    const matchedCard = existingCards.find((card) => {
      const existingCompany = normalizeText(card.company_name);
      const existingRole = normalizeText(card.role_title);
      return substringMatch(normalizedNewCompany, existingCompany) &&
             substringMatch(normalizedNewRole, existingRole);
    });

    if (matchedCard) {
      await trx('processed_emails')
        .insert({ ...baseLog, action: 'receipt_already_tracked', card_id: matchedCard.id })
        .onConflict(['user_id', 'gmail_message_id'])
        .merge(['action', 'card_id', 'processed_at', 'confidence']);
      await notificationService.create(
        userId,
        'Application already tracked',
        `Your application to ${truncate(companyName, 120)} is already in your pipeline.`,
        { companyName, roleTitle, matchedCardId: matchedCard.id },
        trx
      );
      return { action: 'already_tracked' };
    }

    const card = await cardService.createCard(userId, {
      stage_id: stage.id,
      company_name: companyName,
      role_title: finalRoleTitle,
      application_url: jobUrl ?? undefined,
      source: 'email',
      date_applied: emailReceivedAt.toISOString().split('T')[0],
      company_icon_url: companyIconUrl,
    }, trx);

    await trx('processed_emails')
      .insert({ ...baseLog, action: 'receipt_created', card_id: card.id })
      .onConflict(['user_id', 'gmail_message_id'])
      .merge(['action', 'card_id', 'processed_at', 'confidence']);

    const safeCompany = truncate(companyName, 120);
    const notificationBody = usingFallbackStage
      ? `Application to ${safeCompany} added — no "Applied" stage found, placed in default stage.`
      : `Application to ${safeCompany} added to your pipeline.`;

    await notificationService.create(
      userId,
      'Application added',
      notificationBody,
      { companyName, roleTitle: finalRoleTitle, cardId: card.id },
      trx
    );

    return { action: 'created' };
  });
}
