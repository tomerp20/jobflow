import db from '../config/database';
import logger from '../config/logger';
import { gmailService } from './gmailService';
import { classifyEmail } from './emailClassifier';
import { cardService } from './cardService';
import { notificationService } from './notificationService';
import { applicationReceiptHandler } from './applicationReceiptHandler';

// Max length of the processed_emails.sender column (varchar(255)). Truncate at the
// call site so an oversized header never causes a silent insert failure — especially
// in the receipt_handler_error branch, where the catch handler would otherwise
// swallow the audit row.
const SENDER_MAX_LEN = 255;

function truncateSender(sender: string): string {
  return sender.length > SENDER_MAX_LEN ? sender.slice(0, SENDER_MAX_LEN) : sender;
}

function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isContainsMatch(cardCompany: string, extractedCompany: string): boolean {
  const a = normalize(cardCompany);
  const b = normalize(extractedCompany);
  // Skip cards whose name has no ASCII alphanumeric characters (e.g. Hebrew-only names)
  // and skip extracted names that are too short to be meaningful.
  if (a.length === 0 || b.length <= 3) return false;
  return a.includes(b) || b.includes(a);
}

export interface SyncSummary {
  scanned: number;
  moved: number;
  ambiguous: number;
  noMatch: number;
  lowConfidence: number;
  notRejection: number;
  receipts: number;
}

export async function syncUserGmail(userId: string): Promise<SyncSummary> {
  const summary: SyncSummary = { scanned: 0, moved: 0, ambiguous: 0, noMatch: 0, lowConfidence: 0, notRejection: 0, receipts: 0 };

  const gmailToken = await db('gmail_tokens').where({ user_id: userId, is_valid: true }).first();
  if (!gmailToken) return summary;

  const gmailClient = await gmailService.getValidClient(userId);
  if (!gmailClient) return summary;

  const lastSyncAt: Date | null = gmailToken.last_sync_at ? new Date(gmailToken.last_sync_at) : null;
  const emails = await gmailService.fetchUnreadEmails(gmailClient, lastSyncAt);

  // Hoist both lookup queries above the loop to avoid per-email round-trips
  const [rejectionStage, cards] = await Promise.all([
    db('stages').where({ user_id: userId, is_rejection_stage: true }).first(),
    db('cards')
      .join('stages', 'cards.stage_id', 'stages.id')
      .where({ 'cards.user_id': userId })
      .where('stages.is_rejection_stage', false)
      .select('cards.*', 'stages.name as stage_name'),
  ]);
  if (!rejectionStage) return summary;

  // Batch-check which message IDs have already been processed (avoids N+1)
  const messageIds = emails.map(e => e.messageId);
  const processedRows = messageIds.length > 0
    ? await db('processed_emails')
        .where({ user_id: userId })
        .whereIn('gmail_message_id', messageIds)
        .select('gmail_message_id')
    : [];
  const processedSet = new Set(processedRows.map((r: { gmail_message_id: string }) => r.gmail_message_id));

  for (const email of emails) {
    if (processedSet.has(email.messageId)) continue;

    summary.scanned++;

    let classification;
    try {
      classification = await classifyEmail(email.subject, email.body);
    } catch (err) {
      logger.error('Email classification failed', { userId, messageId: email.messageId, error: err });
      // Mark as classifier_error so this email is not retried indefinitely
      await db('processed_emails').insert({
        user_id: userId,
        gmail_message_id: email.messageId,
        subject: email.subject,
        sender: email.sender,
        received_at: email.receivedAt,
        action: 'classifier_error',
      }).catch(() => {});
      continue;
    }

    const baseLog = {
      user_id: userId,
      gmail_message_id: email.messageId,
      subject: email.subject,
      sender: truncateSender(email.sender),
      received_at: email.receivedAt,
      confidence: classification.confidence,
      extracted_company: classification.companyName,
      extracted_role_title: classification.type === 'application_receipt' ? classification.roleTitle : null,
      extracted_job_url: classification.type === 'application_receipt' ? classification.jobUrl : null,
    };

    if (classification.type === 'application_receipt') {
      try {
        await applicationReceiptHandler({
          userId,
          gmailMessageId: email.messageId,
          subject: email.subject,
          sender: email.sender,
          companyName: classification.companyName ?? null,
          roleTitle: classification.roleTitle ?? null,
          jobUrl: classification.jobUrl ?? null,
          confidence: classification.confidence,
          emailReceivedAt: email.receivedAt,
        });
        summary.receipts++;
      } catch (err) {
        logger.error('applicationReceiptHandler failed', { userId, messageId: email.messageId, error: err });
        await db('processed_emails')
          .insert({ ...baseLog, action: 'receipt_handler_error' })
          .onConflict(['user_id', 'gmail_message_id'])
          .ignore()
          .catch((insertErr) => {
            logger.error('Failed to record receipt_handler_error in processed_emails', {
              userId,
              messageId: email.messageId,
              error: insertErr,
            });
          });
      }
      continue;
    }

    if (classification.type === 'other') {
      await db('processed_emails')
        .insert({ ...baseLog, action: 'not_actionable' })
        .onConflict(['user_id', 'gmail_message_id'])
        .ignore();
      summary.notRejection++;
      continue;
    }

    if (classification.confidence < 0.9) {
      await db('processed_emails').insert({ ...baseLog, action: 'low_confidence' });
      await notificationService.create(
        userId,
        'Possible rejection — needs review',
        `An email from ${classification.companyName ?? 'unknown company'} may be a rejection (low confidence)`,
        { gmailMessageId: email.messageId }
      );
      summary.lowConfidence++;
      continue;
    }

    if (!classification.companyName) {
      await db('processed_emails').insert({ ...baseLog, action: 'no_match' });
      summary.noMatch++;
      continue;
    }

    const matches = cards.filter(c => isContainsMatch(c.company_name, classification.companyName!));

    if (matches.length === 0) {
      await db('processed_emails').insert({ ...baseLog, action: 'no_match' });
      await notificationService.create(
        userId,
        'Rejection email — no card found',
        `Received a rejection from ${classification.companyName} but no matching card was found`,
        { gmailMessageId: email.messageId, extractedCompany: classification.companyName }
      );
      summary.noMatch++;
    } else if (matches.length > 1) {
      await db('processed_emails').insert({ ...baseLog, action: 'ambiguous_match' });
      await notificationService.create(
        userId,
        'Rejection email needs review',
        `Received a rejection from ${classification.companyName} but multiple cards match`,
        { gmailMessageId: email.messageId, extractedCompany: classification.companyName }
      );
      summary.ambiguous++;
    } else {
      const card = matches[0];
      await cardService.moveCard(card.id, userId, rejectionStage.id, 0);
      await db('processed_emails').insert({ ...baseLog, action: 'moved_to_rejected', card_id: card.id });
      await notificationService.create(
        userId,
        'Application marked as Rejected',
        `${card.company_name} – ${card.role_title} was moved to Rejected`,
        { cardId: card.id, gmailMessageId: email.messageId }
      );
      summary.moved++;
    }
  }

  await db('gmail_tokens').where({ user_id: userId }).update({ last_sync_at: db.fn.now(), updated_at: db.fn.now() });
  return summary;
}
