import db from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface StageData {
  name: string;
  position: number;
}

export const stageService = {
  async getStages(userId: string) {
    const stages = await db('stages')
      .where({ user_id: userId })
      .orderBy('position', 'asc');

    return stages;
  },

  async createStage(userId: string, data: StageData) {
    // Shift existing stages at or after this position up by 1
    await db('stages')
      .where({ user_id: userId })
      .andWhere('position', '>=', data.position)
      .increment('position', 1);

    const [stage] = await db('stages')
      .insert({
        user_id: userId,
        name: data.name,
        position: data.position,
      })
      .returning('*');

    return stage;
  },

  async updateStage(stageId: string, userId: string, data: Partial<StageData>) {
    const existing = await db('stages')
      .where({ id: stageId, user_id: userId })
      .first();

    if (!existing) {
      throw new AppError('Stage not found', 404, 'ERR_NOT_FOUND');
    }

    if (data.position !== undefined && data.position !== existing.position) {
      const oldPos = existing.position;
      const newPos = data.position;

      if (newPos > oldPos) {
        // Moving down: shift stages between old+1 and new down by 1
        await db('stages')
          .where({ user_id: userId })
          .andWhere('position', '>', oldPos)
          .andWhere('position', '<=', newPos)
          .decrement('position', 1);
      } else {
        // Moving up: shift stages between new and old-1 up by 1
        await db('stages')
          .where({ user_id: userId })
          .andWhere('position', '>=', newPos)
          .andWhere('position', '<', oldPos)
          .increment('position', 1);
      }
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.position !== undefined) updateData.position = data.position;

    const [updated] = await db('stages')
      .where({ id: stageId, user_id: userId })
      .update(updateData)
      .returning('*');

    return updated;
  },
};
