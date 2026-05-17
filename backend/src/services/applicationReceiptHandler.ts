import db from '@/config/database';
import { cardService } from '@/services/cardService';
import { notificationService } from '@/services/notificationService';
import { AppError } from '@/middleware/errorHandler';

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

  if (!Number.isFinite(confidence) || confidence < 0.9 || companyName === null) {
    await db('processed_emails')
      .insert({ ...baseLog, action: 'receipt_low_confidence' })
      .onConflict(['user_id', 'gmail_message_id'])
      .ignore();
    await notificationService.create(
      userId,
      'Application email detected',
      'We found a possible application email but could not process it with high enough confidence.',
      { companyName, roleTitle, confidence }
    );
    return { action: 'low_confidence' };
  }

  const appliedStage = await db('stages')
    .where({ user_id: userId, is_applied_stage: true })
    .first();

  let stage = appliedStage;
  let usingFallbackStage = false;

  if (!stage) {
    stage = await db('stages').where({ user_id: userId, is_default: true }).first();
    usingFallbackStage = true;
  }

  if (!stage) {
    throw new AppError(
      'No stages configured for user — cannot process application receipt',
      500,
      'ERR_NO_STAGES'
    );
  }

  const existingCards: { id: string; company_name: string; role_title: string }[] = await db('cards')
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
    await db('processed_emails')
      .insert({ ...baseLog, action: 'receipt_already_tracked', card_id: matchedCard.id })
      .onConflict(['user_id', 'gmail_message_id'])
      .ignore();
    await notificationService.create(
      userId,
      'Application already tracked',
      `Your application to ${truncate(companyName, 120)} is already in your pipeline.`,
      { companyName, roleTitle, matchedCardId: matchedCard.id }
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
  });

  await db('processed_emails')
    .insert({ ...baseLog, action: 'receipt_created', card_id: card.id })
    .onConflict(['user_id', 'gmail_message_id'])
    .ignore();

  const safeCompany = truncate(companyName, 120);
  const notificationBody = usingFallbackStage
    ? `Application to ${safeCompany} added — no "Applied" stage found, placed in default stage.`
    : `Application to ${safeCompany} added to your pipeline.`;

  await notificationService.create(
    userId,
    'Application added',
    notificationBody,
    { companyName, roleTitle: finalRoleTitle, cardId: card.id }
  );

  return { action: 'created' };
}
