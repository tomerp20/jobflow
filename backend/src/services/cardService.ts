import db from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface CardFilters {
  stage?: string;
  search?: string;
  tags?: string;
  priority?: string;
  workMode?: string;
}

export interface CardData {
  stage_id: string;
  company_name: string;
  role_title: string;
  application_url?: string;
  careers_url?: string;
  source?: string;
  location?: string;
  work_mode?: string;
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
  priority?: string;
  notes?: string;
  date_applied?: string;
  last_interaction_date?: string;
  next_followup_date?: string;
  recruiter_name?: string;
  recruiter_email?: string;
  tech_stack?: string[];
  tags?: string[];
  interest_level?: number;
  position?: number;
}

async function logActivity(
  cardId: string,
  userId: string,
  action: string,
  fieldChanged?: string,
  oldValue?: string | null,
  newValue?: string | null,
  note?: string
) {
  await db('card_activities').insert({
    card_id: cardId,
    user_id: userId,
    action,
    field_changed: fieldChanged || null,
    old_value: oldValue || null,
    new_value: newValue || null,
    note: note || null,
  });
}

const ATS_PLATFORMS: { pattern: RegExp; slugFrom: 'path' | 'subdomain'; stripPrefix?: string; noSlug?: boolean }[] = [
  { pattern: /^(boards|job-boards|job-boards\.eu)\.greenhouse\.io$/, slugFrom: 'path' },
  { pattern: /^jobs\.lever\.co$/, slugFrom: 'path' },
  { pattern: /^[\w-]+\.wd\d+\.myworkdayjobs\.com$/, slugFrom: 'subdomain' },
  { pattern: /^jobs\.ashbyhq\.com$/, slugFrom: 'path' },
  { pattern: /^apply\.workable\.com$/, slugFrom: 'path' },
  { pattern: /^jobs\.smartrecruiters\.com$/, slugFrom: 'path' },
  { pattern: /^[\w-]+\.bamboohr\.com$/, slugFrom: 'subdomain' },
  { pattern: /^jobs\.jobvite\.com$/, slugFrom: 'path' },
  { pattern: /^careers-[\w-]+\.icims\.com$/, slugFrom: 'subdomain', stripPrefix: 'careers-' },
  { pattern: /^[\w-]+\.taleo\.net$/, slugFrom: 'subdomain' },
  { pattern: /^[\w-]+\.recruitee\.com$/, slugFrom: 'subdomain' },
  { pattern: /^(www\.)?linkedin\.com$/, slugFrom: 'path', noSlug: true },
  { pattern: /^(www\.)?indeed\.com$/, slugFrom: 'path', noSlug: true },
  { pattern: /^(www\.)?glassdoor\.com$/, slugFrom: 'path', noSlug: true },
];

function getATSEntry(hostname: string) {
  return ATS_PLATFORMS.find((p) => p.pattern.test(hostname)) ?? null;
}

function extractATSSlug(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const entry = getATSEntry(hostname);
    if (!entry || entry.noSlug) return null;
    if (entry.slugFrom === 'subdomain') {
      const sub = hostname.split('.')[0];
      return entry.stripPrefix ? sub.replace(entry.stripPrefix, '') : sub;
    }
    const segment = parsed.pathname.split('/').find((s) => s.length > 0) ?? null;
    return segment;
  } catch {
    return null;
  }
}

function isATSPlatform(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return getATSEntry(hostname) !== null;
  } catch {
    return false;
  }
}

function isConfidentMatch(
  clearbitName: string,
  clearbitDomain: string,
  companyName: string,
  atsSlug?: string | null
): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedCompany = normalize(companyName);
  const normalizedClearbitName = normalize(clearbitName);
  const normalizedDomain = normalize(clearbitDomain.split('.')[0]);

  const shorter = normalizedCompany.length <= normalizedClearbitName.length ? normalizedCompany : normalizedClearbitName;
  const longer = normalizedCompany.length <= normalizedClearbitName.length ? normalizedClearbitName : normalizedCompany;
  const nameMatch = longer.includes(shorter) && shorter.length / longer.length >= 0.6;

  const slugMatch = atsSlug
    ? normalizedDomain.includes(normalize(atsSlug)) ||
      normalize(atsSlug).includes(normalizedDomain)
    : true;

  return nameMatch && slugMatch;
}

async function queryClearbit(companyName: string): Promise<{ name: string; domain: string } | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(companyName)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const results = await res.json() as { name: string; domain: string }[];
    if (!Array.isArray(results) || results.length === 0) return null;
    const top = results[0];
    if (!top || typeof top.name !== 'string' || typeof top.domain !== 'string') return null;
    return top;
  } catch {
    return null;
  }
}

async function resolveCompanyIconUrl(
  companyName: string,
  applicationUrl?: string,
  careersUrl?: string
): Promise<string | null> {
  if (careersUrl && !isATSPlatform(careersUrl)) {
    try {
      const hostname = new URL(careersUrl).hostname;
      const parts = hostname.split('.');
      const domain = parts.slice(-2).join('.');
      return `https://logo.clearbit.com/${domain}`;
    } catch { /* fall through */ }
  }

  if (applicationUrl && isATSPlatform(applicationUrl)) {
    const slug = extractATSSlug(applicationUrl);
    const match = await queryClearbit(companyName);
    if (match && isConfidentMatch(match.name, match.domain, companyName, slug)) {
      return `https://logo.clearbit.com/${match.domain}`;
    }
    return null;
  }

  if (applicationUrl) {
    try {
      const hostname = new URL(applicationUrl).hostname;
      const parts = hostname.split('.');
      const domain = parts.slice(-2).join('.');
      return `https://logo.clearbit.com/${domain}`;
    } catch { /* fall through */ }
  }

  const match = await queryClearbit(companyName);
  if (match && isConfidentMatch(match.name, match.domain, companyName)) {
    return `https://logo.clearbit.com/${match.domain}`;
  }

  return null;
}

export const cardService = {
  async getAllCards(userId: string, filters: CardFilters) {
    let query = db('cards')
      .join('stages', 'cards.stage_id', 'stages.id')
      .where('cards.user_id', userId)
      .select(
        'cards.*',
        'stages.name as stage_name'
      )
      .orderBy('cards.position', 'asc');

    if (filters.stage) {
      query = query.where('cards.stage_id', filters.stage);
    }

    if (filters.search) {
      const term = `%${filters.search}%`;
      query = query.where((builder) => {
        builder
          .whereILike('cards.company_name', term)
          .orWhereILike('cards.role_title', term)
          .orWhereILike('cards.notes', term);
      });
    }

    if (filters.tags) {
      const tagList = filters.tags.split(',').map((t) => t.trim());
      query = query.whereRaw('cards.tags && ?', [tagList]);
    }

    if (filters.priority) {
      query = query.where('cards.priority', filters.priority);
    }

    if (filters.workMode) {
      query = query.where('cards.work_mode', filters.workMode);
    }

    const cards = await query;
    return cards;
  },

  async getCardById(cardId: string, userId: string) {
    const card = await db('cards')
      .join('stages', 'cards.stage_id', 'stages.id')
      .where({ 'cards.id': cardId, 'cards.user_id': userId })
      .select('cards.*', 'stages.name as stage_name')
      .first();

    if (!card) {
      throw new AppError('Card not found', 404, 'ERR_NOT_FOUND');
    }

    const activities = await db('card_activities')
      .where({ card_id: cardId })
      .orderBy('created_at', 'desc');

    return { ...card, activities };
  },

  async createCard(userId: string, data: CardData) {
    // Determine position: place at end of stage if not specified
    let position = data.position;
    if (position === undefined) {
      const maxPos = await db('cards')
        .where({ user_id: userId, stage_id: data.stage_id })
        .max('position as max')
        .first();
      position = (maxPos?.max ?? -1) + 1;
    }

    const [card] = await db('cards')
      .insert({
        user_id: userId,
        stage_id: data.stage_id,
        position,
        company_name: data.company_name,
        role_title: data.role_title,
        application_url: data.application_url,
        careers_url: data.careers_url,
        source: data.source,
        location: data.location,
        work_mode: data.work_mode || 'remote',
        salary_min: data.salary_min,
        salary_max: data.salary_max,
        salary_currency: data.salary_currency || 'USD',
        priority: data.priority || 'medium',
        notes: data.notes,
        date_applied: data.date_applied,
        last_interaction_date: data.last_interaction_date,
        next_followup_date: data.next_followup_date,
        recruiter_name: data.recruiter_name,
        recruiter_email: data.recruiter_email,
        tech_stack: data.tech_stack || [],
        tags: data.tags || [],
        interest_level: data.interest_level ?? 3,
        company_icon_url: await resolveCompanyIconUrl(data.company_name, data.application_url, data.careers_url),
      })
      .returning('*');

    await logActivity(card.id, userId, 'created');

    // Return card with stage name
    const stage = await db('stages').where({ id: card.stage_id }).first();
    return { ...card, stage_name: stage?.name };
  },

  async updateCard(cardId: string, userId: string, data: Partial<CardData>) {
    const existing = await db('cards')
      .where({ id: cardId, user_id: userId })
      .first();

    if (!existing) {
      throw new AppError('Card not found', 404, 'ERR_NOT_FOUND');
    }

    // Track changes for activity log
    const trackableFields = [
      'company_name', 'role_title', 'application_url', 'careers_url',
      'source', 'location', 'work_mode', 'salary_min', 'salary_max',
      'salary_currency', 'priority', 'notes', 'date_applied',
      'last_interaction_date', 'next_followup_date', 'recruiter_name',
      'recruiter_email', 'interest_level', 'stage_id',
    ];

    const updatePayload: Record<string, unknown> = { updated_at: db.fn.now() };
    const changes: { field: string; oldVal: string | null; newVal: string | null }[] = [];

    for (const field of trackableFields) {
      if (field in data) {
        const newVal = (data as Record<string, unknown>)[field];
        const oldVal = existing[field];

        if (String(newVal) !== String(oldVal)) {
          changes.push({
            field,
            oldVal: oldVal != null ? String(oldVal) : null,
            newVal: newVal != null ? String(newVal) : null,
          });
        }

        updatePayload[field] = newVal;
      }
    }

    // Handle array fields separately
    if ('tech_stack' in data) {
      updatePayload.tech_stack = data.tech_stack || [];
    }
    if ('tags' in data) {
      updatePayload.tags = data.tags || [];
    }

    // Re-derive company icon if relevant fields changed
    if ('company_name' in data || 'application_url' in data || 'careers_url' in data) {
      const name = (data.company_name as string) || existing.company_name;
      const appUrl = 'application_url' in data ? (data.application_url as string) : existing.application_url;
      const carUrl = 'careers_url' in data ? (data.careers_url as string) : existing.careers_url;
      updatePayload.company_icon_url = await resolveCompanyIconUrl(name, appUrl, carUrl);
    }

    const [updated] = await db('cards')
      .where({ id: cardId, user_id: userId })
      .update(updatePayload)
      .returning('*');

    // Log each field change as a separate activity
    for (const change of changes) {
      await logActivity(cardId, userId, 'updated', change.field, change.oldVal, change.newVal);
    }

    const stage = await db('stages').where({ id: updated.stage_id }).first();
    return { ...updated, stage_name: stage?.name };
  },

  async moveCard(cardId: string, userId: string, stageId: string, position: number) {
    const card = await db('cards')
      .where({ id: cardId, user_id: userId })
      .first();

    if (!card) {
      throw new AppError('Card not found', 404, 'ERR_NOT_FOUND');
    }

    // Verify target stage belongs to user
    const targetStage = await db('stages')
      .where({ id: stageId, user_id: userId })
      .first();

    if (!targetStage) {
      throw new AppError('Target stage not found', 404, 'ERR_NOT_FOUND');
    }

    const oldStageId = card.stage_id;
    const oldPosition = card.position;

    await db.transaction(async (trx) => {
      // Remove from old position: shift cards in old stage down to fill gap
      await trx('cards')
        .where({ user_id: userId, stage_id: oldStageId })
        .andWhere('position', '>', oldPosition)
        .decrement('position', 1);

      // Make room in new position: shift cards in target stage up
      await trx('cards')
        .where({ user_id: userId, stage_id: stageId })
        .andWhere('position', '>=', position)
        .andWhere('id', '!=', cardId)
        .increment('position', 1);

      // Move the card
      await trx('cards')
        .where({ id: cardId })
        .update({
          stage_id: stageId,
          position,
          updated_at: trx.fn.now(),
        });
    });

    // Log move activity
    if (oldStageId !== stageId) {
      const oldStage = await db('stages').where({ id: oldStageId }).first();
      await logActivity(
        cardId,
        userId,
        'moved',
        'stage_id',
        oldStage?.name || oldStageId,
        targetStage.name
      );
    }

    const [updated] = await db('cards')
      .join('stages', 'cards.stage_id', 'stages.id')
      .where({ 'cards.id': cardId })
      .select('cards.*', 'stages.name as stage_name');

    return updated;
  },

  async deleteCard(cardId: string, userId: string) {
    const card = await db('cards')
      .where({ id: cardId, user_id: userId })
      .first();

    if (!card) {
      throw new AppError('Card not found', 404, 'ERR_NOT_FOUND');
    }

    // Delete card (cascade deletes activities)
    await db('cards').where({ id: cardId, user_id: userId }).del();

    // Shift remaining cards in the stage down to fill gap
    await db('cards')
      .where({ user_id: userId, stage_id: card.stage_id })
      .andWhere('position', '>', card.position)
      .decrement('position', 1);
  },

  async addNote(cardId: string, userId: string, note: string) {
    const card = await db('cards')
      .where({ id: cardId, user_id: userId })
      .first();

    if (!card) {
      throw new AppError('Card not found', 404, 'ERR_NOT_FOUND');
    }

    await logActivity(cardId, userId, 'note_added', undefined, undefined, undefined, note);

    // Update last_interaction_date
    await db('cards')
      .where({ id: cardId })
      .update({ last_interaction_date: db.fn.now(), updated_at: db.fn.now() });

    const activity = await db('card_activities')
      .where({ card_id: cardId, action: 'note_added' })
      .orderBy('created_at', 'desc')
      .first();

    return activity;
  },
};
