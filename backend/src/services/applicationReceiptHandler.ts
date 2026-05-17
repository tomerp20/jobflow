import db from '@/config/database';
import { cardService } from '@/services/cardService';
import { notificationService } from '@/services/notificationService';

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
    sender,
    received_at: emailReceivedAt,
    confidence,
    extracted_company: companyName,
    extracted_role_title: roleTitle,
    extracted_job_url: jobUrl,
  };

  if (confidence < 0.9 || companyName === null) {
    await db('processed_emails').insert({ ...baseLog, action: 'receipt_low_confidence' });
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

  const existingCards: { company_name: string; role_title: string }[] = await db('cards')
    .where({ user_id: userId })
    .select('company_name', 'role_title');

  const finalRoleTitle = roleTitle ?? 'Unknown Role';
  const normalizedNewCompany = normalizeText(companyName);
  const normalizedNewRole = normalizeText(finalRoleTitle);

  const isDuplicate = existingCards.some((card) => {
    const existingCompany = normalizeText(card.company_name);
    const existingRole = normalizeText(card.role_title);
    return substringMatch(normalizedNewCompany, existingCompany) &&
           substringMatch(normalizedNewRole, existingRole);
  });

  if (isDuplicate) {
    await db('processed_emails').insert({ ...baseLog, action: 'receipt_already_tracked' });
    await notificationService.create(
      userId,
      'Application already tracked',
      `Your application to ${companyName} is already in your pipeline.`,
      { companyName, roleTitle }
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

  await db('processed_emails').insert({ ...baseLog, action: 'receipt_created', card_id: card.id });

  const notificationBody = usingFallbackStage
    ? `Application to ${companyName} added — no "Applied" stage found, placed in default stage.`
    : `Application to ${companyName} added to your pipeline.`;

  await notificationService.create(
    userId,
    'Application added',
    notificationBody,
    { companyName, roleTitle: finalRoleTitle, cardId: card.id }
  );

  return { action: 'created' };
}
