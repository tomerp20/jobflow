import db from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { Knex } from 'knex';

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  metadata: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

export const notificationService = {
  async create(
    userId: string,
    title: string,
    body: string,
    metadata?: Record<string, unknown>,
    trx?: Knex.Transaction
  ): Promise<Notification> {
    const conn = trx ?? db;
    const [notification] = await conn('notifications')
      .insert({
        user_id: userId,
        title,
        body,
        metadata: metadata ?? null,
      })
      .returning('*');
    return notification;
  },

  async list(userId: string): Promise<Notification[]> {
    return db('notifications')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc');
  },

  async markRead(notificationId: string, userId: string): Promise<void> {
    const existing = await db('notifications')
      .where({ id: notificationId, user_id: userId })
      .first();
    if (!existing) {
      throw new AppError('Notification not found', 404, 'ERR_NOT_FOUND');
    }
    await db('notifications')
      .where({ id: notificationId, user_id: userId })
      .update({ read_at: db.fn.now() });
  },

  async markAllRead(userId: string): Promise<void> {
    await db('notifications')
      .where({ user_id: userId })
      .whereNull('read_at')
      .update({ read_at: db.fn.now() });
  },
};
