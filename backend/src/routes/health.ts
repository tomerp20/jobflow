import { Router, Request, Response, NextFunction } from 'express';
import db from '../config/database';
import { dashboardService } from '../services/dashboardService';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/health', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    let dbStatus = 'disconnected';
    try {
      await db.raw('SELECT 1');
      dbStatus = 'connected';
    } catch {
      dbStatus = 'disconnected';
    }

    res.json({
      data: {
        status: 'ok',
        db: dbStatus,
        uptime: process.uptime(),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/metrics', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const metrics = await dashboardService.getMetrics(userId);
    res.json({ data: metrics });
  } catch (err) {
    next(err);
  }
});

export default router;
