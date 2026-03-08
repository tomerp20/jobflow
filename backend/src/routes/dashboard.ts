import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { dashboardService } from '../services/dashboardService';

const router = Router();

// GET /api/dashboard — dashboard aggregations
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const dashboard = await dashboardService.getDashboard(userId);
    res.json({ data: dashboard });
  } catch (err) {
    next(err);
  }
});

export default router;
