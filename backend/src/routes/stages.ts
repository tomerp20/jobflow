import { Router, Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { stageService } from '../services/stageService';

const router = Router();

// GET /api/stages — list stages for current user, ordered by position
router.get('/', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const stages = await stageService.getStages(userId);
    res.json({ data: stages });
  } catch (err) {
    next(err);
  }
});

// POST /api/stages — create a new stage
router.post(
  '/',
  authenticate,
  validate([
    body('name').isString().trim().notEmpty().withMessage('Name is required'),
    body('position').isInt({ min: 0 }).withMessage('Position must be a non-negative integer'),
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { name, position } = req.body;
      const stage = await stageService.createStage(userId, { name, position });
      res.status(201).json({ data: stage });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/stages/:id — update stage (name, position)
router.patch(
  '/:id',
  authenticate,
  validate([
    body('name').optional().isString().trim().notEmpty().withMessage('Name cannot be empty'),
    body('position').optional().isInt({ min: 0 }).withMessage('Position must be a non-negative integer'),
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      const data: { name?: string; position?: number } = {};

      if (req.body.name !== undefined) data.name = req.body.name;
      if (req.body.position !== undefined) data.position = req.body.position;

      const stage = await stageService.updateStage(id, userId, data);
      res.json({ data: stage });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/stages/:id — delete a stage, move its cards to the first available stage
router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const result = await stageService.deleteStage(id, userId);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// PUT /api/stages/reorder — reorder all stages
router.put(
  '/reorder',
  authenticate,
  validate([
    body('stageIds').isArray({ min: 1 }).withMessage('stageIds must be a non-empty array'),
    body('stageIds.*').isString().withMessage('Each stageId must be a string'),
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { stageIds } = req.body;
      const stages = await stageService.reorderStages(userId, stageIds);
      res.json({ data: stages });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
