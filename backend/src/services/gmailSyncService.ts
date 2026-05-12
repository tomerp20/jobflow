import db from '../config/database';
import { gmailService } from './gmailService';
import { classifyEmail } from './emailClassifier';
import { cardService } from './cardService';
import { notificationService } from './notificationService';

function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isContainsMatch(cardCompany: string, extractedCompany: string): boolean {
  const a = normalize(cardCompany);
  const b = normalize(extractedCompany);
  return a.includes(b) || b.includes(a);
}

export interface SyncSummary {
  scanned: number;
  moved: number;
  ambiguous: number;
  noMatch: number;
  lowConfidence: number;
  notRejection: number;
}

export async function syncUserGmail(userId: string): Promise<SyncSummary> {
  const summary: SyncSummary = { scanned: 0, moved: 0, ambiguous: 0, noMatch: 0, lowConfidence: 0, notRejection: 0 };

  const gmailClient = await gmailService.getValidClient(userId);
  if (!gmailClient) return summary;

  const emails = await gmailService.fetchUnreadEmails(userId, gmailClient);
  const rejectionStage = await db('stages').where({ user_id: userId, is_rejection_stage: true }).first();
  if (!rejectionStage) return summary;

  for (const email of emails) {
    const alreadyProcessed = await db('processed_emails')
      .where({ user_id: userId, gmail_message_id: email.messageId })
      .first();
    if (alreadyProcessed) continue;

    summary.scanned++;

    let classification;
    try {
      classification = await classifyEmail(email.subject, email.body);
    } catch {
      continue;
    }

    const baseLog = {
      user_id: userId,
      gmail_message_id: email.messageId,
      subject: email.subject,
      sender: email.sender,
      received_at: email.receivedAt,
      confidence: classification.confidence,
      extracted_company: classification.companyName,
    };

    if (!classification.isRejection) {
      await db('processed_emails').insert({ ...baseLog, action: 'not_rejection' });
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

    const cards = await db('cards')
      .join('stages', 'cards.stage_id', 'stages.id')
      .where({ 'cards.user_id': userId })
      .where('stages.is_rejection_stage', false)
      .select('cards.*', 'stages.name as stage_name');

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
