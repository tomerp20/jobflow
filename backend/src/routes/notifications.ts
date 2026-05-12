import { Router, Request, Response, NextFunction } from 'express';
import { param } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { notificationService } from '../services/notificationService';

const router = Router();

// GET /api/notifications
router.get(
  '/',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const notifications = await notificationService.list(req.user!.id);
      res.json({ data: notifications });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/notifications/read-all — must come before /:id to avoid route collision
router.patch(
  '/read-all',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await notificationService.markAllRead(req.user!.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/notifications/:id/read
router.patch(
  '/:id/read',
  authenticate,
  validate([
    param('id').isUUID().withMessage('id must be a valid UUID'),
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await notificationService.markRead(req.params.id, req.user!.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
