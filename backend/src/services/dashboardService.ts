import db from '../config/database';

export const dashboardService = {
  async getDashboard(userId: string) {
    // Active card count
    const activeResult = await db('cards')
      .where({ user_id: userId })
      .count('id as count')
      .first();
    const activeCount = Number(activeResult?.count || 0);

    // Cards by stage
    const byStage = await db('cards')
      .join('stages', 'cards.stage_id', 'stages.id')
      .where('cards.user_id', userId)
      .groupBy('stages.id', 'stages.name', 'stages.position')
      .select('stages.name')
      .count('cards.id as count')
      .orderBy('stages.position', 'asc');

    const byStageFormatted = byStage.map((row) => ({
      name: row.name,
      count: Number(row.count),
    }));

    // Upcoming follow-ups: next_followup_date within next 7 days
    const now = new Date();
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(now.getDate() + 7);

    const upcomingFollowUps = await db('cards')
      .join('stages', 'cards.stage_id', 'stages.id')
      .where('cards.user_id', userId)
      .whereNotNull('cards.next_followup_date')
      .where('cards.next_followup_date', '>=', now.toISOString().split('T')[0])
      .where('cards.next_followup_date', '<=', sevenDaysFromNow.toISOString().split('T')[0])
      .select('cards.*', 'stages.name as stage_name')
      .orderBy('cards.next_followup_date', 'asc');

    // Stale applications: last_interaction_date > 14 days ago and not in Rejected/Accepted
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(now.getDate() - 14);

    const staleApplications = await db('cards')
      .join('stages', 'cards.stage_id', 'stages.id')
      .where('cards.user_id', userId)
      .where(function () {
        this.where('cards.last_interaction_date', '<', fourteenDaysAgo.toISOString().split('T')[0])
          .orWhereNull('cards.last_interaction_date');
      })
      .whereNotIn('stages.name', ['Rejected', 'Accepted', 'rejected', 'accepted'])
      .select('cards.*', 'stages.name as stage_name')
      .orderBy('cards.last_interaction_date', 'asc');

    return {
      activeCount,
      byStage: byStageFormatted,
      upcomingFollowUps,
      staleApplications,
    };
  },

  async getMetrics(userId: string) {
    // Total cards
    const totalResult = await db('cards')
      .where({ user_id: userId })
      .count('id as count')
      .first();
    const totalCards = Number(totalResult?.count || 0);

    // Cards by stage
    const cardsByStage = await db('cards')
      .join('stages', 'cards.stage_id', 'stages.id')
      .where('cards.user_id', userId)
      .groupBy('stages.name', 'stages.position')
      .select('stages.name')
      .count('cards.id as count')
      .orderBy('stages.position', 'asc');

    // Average days in pipeline (from created_at to now)
    const avgResult = await db('cards')
      .where({ user_id: userId })
      .select(
        db.raw("AVG(EXTRACT(EPOCH FROM (NOW() - cards.created_at)) / 86400) as avg_days")
      )
      .first();
    const avgDaysInPipeline = avgResult?.avg_days
      ? Math.round(Number(avgResult.avg_days))
      : 0;

    // Application rate: cards created per week (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentResult = await db('cards')
      .where({ user_id: userId })
      .where('created_at', '>=', thirtyDaysAgo.toISOString())
      .count('id as count')
      .first();
    const recentCount = Number(recentResult?.count || 0);
    const applicationRate = Math.round((recentCount / 4.3) * 10) / 10; // per week

    return {
      totalCards,
      cardsByStage: cardsByStage.map((row) => ({
        name: row.name,
        count: Number(row.count),
      })),
      avgDaysInPipeline,
      applicationRate,
    };
  },
};
