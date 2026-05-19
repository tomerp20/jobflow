import db from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { shiftUp, shiftDown, renumber, withTransaction } from '../util/positions';

export interface StageData {
  name: string;
  position: number;
  width?: number | null;
}

export const stageService = {
  async getStages(userId: string) {
    const stages = await db('stages')
      .where({ user_id: userId })
      .orderBy('position', 'asc');

    return stages;
  },

  async createStage(userId: string, data: StageData) {
    return withTransaction(db, undefined, async (trx) => {
      await shiftUp({ trx, table: 'stages', scope: { user_id: userId }, fromPos: data.position });
      const [stage] = await trx('stages')
        .insert({ user_id: userId, name: data.name, position: data.position })
        .returning('*');
      return stage;
    });
  },

  async updateStage(stageId: string, userId: string, data: Partial<StageData>) {
    const existing = await db('stages')
      .where({ id: stageId, user_id: userId })
      .first();

    if (!existing) {
      throw new AppError('Stage not found', 404, 'ERR_NOT_FOUND');
    }

    return withTransaction(db, undefined, async (trx) => {
      if (data.position !== undefined && data.position !== existing.position) {
        const oldPos = existing.position;
        const newPos = data.position;

        if (newPos > oldPos) {
          await shiftDown({ trx, table: 'stages', scope: { user_id: userId }, fromPos: oldPos, toPos: newPos });
        } else {
          await shiftUp({ trx, table: 'stages', scope: { user_id: userId }, fromPos: newPos, toPos: oldPos - 1 });
        }
      }

      const updateData: Record<string, unknown> = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.position !== undefined) updateData.position = data.position;
      if (data.width !== undefined) updateData.width = data.width;

      const [updated] = await trx('stages')
        .where({ id: stageId, user_id: userId })
        .update(updateData)
        .returning('*');

      return updated;
    });
  },

  async deleteStage(stageId: string, userId: string) {
    return withTransaction(db, undefined, async (trx) => {
      const stage = await trx('stages').where({ id: stageId, user_id: userId }).first();

      if (!stage) {
        throw new AppError('Stage not found', 404, 'ERR_NOT_FOUND');
      }

      const stageCount = await trx('stages')
        .where({ user_id: userId })
        .count('id as count')
        .first();

      if (Number(stageCount?.count) <= 1) {
        throw new AppError('Cannot delete the last stage', 400, 'ERR_LAST_STAGE');
      }

      const fallbackStage = await trx('stages')
        .where({ user_id: userId })
        .whereNot({ id: stageId })
        .orderBy('position', 'asc')
        .first();

      const movedCount = await trx('cards')
        .where({ stage_id: stageId, user_id: userId })
        .update({ stage_id: fallbackStage.id });

      if (movedCount > 0) {
        const fallbackCards = await trx('cards')
          .where({ stage_id: fallbackStage.id, user_id: userId })
          .orderBy('position', 'asc');

        await renumber({
          trx,
          table: 'cards',
          scope: { user_id: userId, stage_id: fallbackStage.id },
          orderedIds: fallbackCards.map((c: { id: string }) => c.id),
        });
      }

      await trx('stages').where({ id: stageId }).del();

      await shiftDown({ trx, table: 'stages', scope: { user_id: userId }, fromPos: stage.position });

      return { deletedStage: stage, movedCardsTo: fallbackStage, movedCardCount: movedCount };
    });
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

    await withTransaction(db, undefined, async (trx) => {
      await renumber({ trx, table: 'stages', scope: { user_id: userId }, orderedIds: stageIds });
    });

    return db('stages')
      .where({ user_id: userId })
      .orderBy('position', 'asc');
  },
};
