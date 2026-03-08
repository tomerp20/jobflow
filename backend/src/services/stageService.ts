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

  async deleteStage(stageId: string, userId: string) {
    const stage = await db('stages')
      .where({ id: stageId, user_id: userId })
      .first();

    if (!stage) {
      throw new AppError('Stage not found', 404, 'ERR_NOT_FOUND');
    }

    // Prevent deleting the last remaining stage
    const stageCount = await db('stages')
      .where({ user_id: userId })
      .count('id as count')
      .first();

    if (Number(stageCount?.count) <= 1) {
      throw new AppError('Cannot delete the last stage', 400, 'ERR_LAST_STAGE');
    }

    // Find the first stage (lowest position) that isn't the one being deleted
    const fallbackStage = await db('stages')
      .where({ user_id: userId })
      .whereNot({ id: stageId })
      .orderBy('position', 'asc')
      .first();

    // Move all cards from the deleted stage to the fallback stage
    const movedCount = await db('cards')
      .where({ stage_id: stageId, user_id: userId })
      .update({ stage_id: fallbackStage.id });

    // If cards were moved, append them after existing cards in fallback stage
    if (movedCount > 0) {
      const maxPos = await db('cards')
        .where({ stage_id: fallbackStage.id, user_id: userId })
        .max('position as max')
        .first();

      // Re-number all cards in fallback stage by position
      const fallbackCards = await db('cards')
        .where({ stage_id: fallbackStage.id, user_id: userId })
        .orderBy('position', 'asc');

      for (let i = 0; i < fallbackCards.length; i++) {
        await db('cards')
          .where({ id: fallbackCards[i].id })
          .update({ position: i });
      }
    }

    // Delete the stage
    await db('stages').where({ id: stageId }).del();

    // Shift remaining stage positions to fill the gap
    await db('stages')
      .where({ user_id: userId })
      .andWhere('position', '>', stage.position)
      .decrement('position', 1);

    return { deletedStage: stage, movedCardsTo: fallbackStage, movedCardCount: movedCount };
  },

  async reorderStages(userId: string, stageIds: string[]) {
    // Validate all IDs belong to user
    const userStages = await db('stages')
      .where({ user_id: userId })
      .select('id');

    const userStageIds = new Set(userStages.map((s: { id: string }) => s.id));

    for (const id of stageIds) {
      if (!userStageIds.has(id)) {
        throw new AppError('Stage not found or does not belong to user', 400, 'ERR_INVALID_STAGE');
      }
    }

    if (stageIds.length !== userStages.length) {
      throw new AppError('All stages must be included in reorder', 400, 'ERR_INCOMPLETE_REORDER');
    }

    await db.transaction(async (trx) => {
      for (let i = 0; i < stageIds.length; i++) {
        await trx('stages')
          .where({ id: stageIds[i], user_id: userId })
          .update({ position: i });
      }
    });

    return db('stages')
      .where({ user_id: userId })
      .orderBy('position', 'asc');
  },
};
