import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import db from '../config/database';

const router = Router();

// GET /api/reminders — upcoming follow-ups sorted by date
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const today = new Date().toISOString().split('T')[0];

    const reminders = await db('cards')
      .join('stages', 'cards.stage_id', 'stages.id')
      .where('cards.user_id', userId)
      .whereNotNull('cards.next_followup_date')
      .where('cards.next_followup_date', '>=', today)
      .select('cards.*', 'stages.name as stage_name')
      .orderBy('cards.next_followup_date', 'asc');

    res.json({ data: reminders });
  } catch (err) {
    next(err);
  }
});

export default router;
