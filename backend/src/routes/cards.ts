import { Router, Request, Response, NextFunction } from 'express';
import { body, query } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { cardService } from '../services/cardService';

const router = Router();

// GET /api/cards — list all cards with query filters
router.get(
  '/',
  authenticate,
  validate([
    query('stage').optional().isUUID().withMessage('Stage must be a valid UUID'),
    query('search').optional().isString(),
    query('tags').optional().isString(),
    query('priority').optional().isIn(['low', 'medium', 'high', 'critical']).withMessage('Invalid priority'),
    query('workMode').optional().isIn(['remote', 'hybrid', 'onsite']).withMessage('Invalid work mode'),
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const filters = {
        stage: req.query.stage as string | undefined,
        search: req.query.search as string | undefined,
        tags: req.query.tags as string | undefined,
        priority: req.query.priority as string | undefined,
        workMode: req.query.workMode as string | undefined,
      };
      const cards = await cardService.getAllCards(userId, filters);
      res.json({ data: cards });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/cards — create a new card
router.post(
  '/',
  authenticate,
  validate([
    body('stage_id').isUUID().withMessage('Stage ID is required and must be a valid UUID'),
    body('company_name').isString().trim().notEmpty().withMessage('Company name is required'),
    body('role_title').isString().trim().notEmpty().withMessage('Role title is required'),
    body('application_url').optional({ values: 'null' }).isString(),
    body('careers_url').optional({ values: 'null' }).isString(),
    body('source').optional({ values: 'null' }).isString(),
    body('location').optional({ values: 'null' }).isString(),
    body('work_mode').optional().isIn(['remote', 'hybrid', 'onsite']).withMessage('Invalid work mode'),
    body('salary_min').optional({ values: 'null' }).isInt({ min: 0 }),
    body('salary_max').optional({ values: 'null' }).isInt({ min: 0 }),
    body('salary_currency').optional().isString().isLength({ min: 3, max: 3 }),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('notes').optional({ values: 'null' }).isString(),
    body('date_applied').optional({ values: 'null' }).isISO8601().toDate(),
    body('last_interaction_date').optional({ values: 'null' }).isISO8601().toDate(),
    body('next_followup_date').optional({ values: 'null' }).isISO8601().toDate(),
    body('recruiter_name').optional({ values: 'null' }).isString(),
    body('recruiter_email').optional({ values: 'null' }).isEmail(),
    body('tech_stack').optional().isArray(),
    body('tags').optional().isArray(),
    body('interest_level').optional().isInt({ min: 1, max: 5 }),
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const card = await cardService.createCard(userId, req.body);
      res.status(201).json({ data: card });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/cards/:id — get card with activity history
router.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const card = await cardService.getCardById(req.params.id, userId);
    res.json({ data: card });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/cards/:id — update card fields
router.patch(
  '/:id',
  authenticate,
  validate([
    body('stage_id').optional().isUUID(),
    body('company_name').optional().isString().trim().notEmpty(),
    body('role_title').optional().isString().trim().notEmpty(),
    body('application_url').optional({ values: 'null' }).isString(),
    body('careers_url').optional({ values: 'null' }).isString(),
    body('source').optional({ values: 'null' }).isString(),
    body('location').optional({ values: 'null' }).isString(),
    body('work_mode').optional().isIn(['remote', 'hybrid', 'onsite']),
    body('salary_min').optional({ values: 'null' }).isInt({ min: 0 }),
    body('salary_max').optional({ values: 'null' }).isInt({ min: 0 }),
    body('salary_currency').optional().isString().isLength({ min: 3, max: 3 }),
    body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
    body('notes').optional({ values: 'null' }).isString(),
    body('date_applied').optional({ values: 'null' }).isISO8601().toDate(),
    body('last_interaction_date').optional({ values: 'null' }).isISO8601().toDate(),
    body('next_followup_date').optional({ values: 'null' }).isISO8601().toDate(),
    body('recruiter_name').optional({ values: 'null' }).isString(),
    body('recruiter_email').optional({ values: 'null' }).isEmail(),
    body('tech_stack').optional().isArray(),
    body('tags').optional().isArray(),
    body('interest_level').optional().isInt({ min: 1, max: 5 }),
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const card = await cardService.updateCard(req.params.id, userId, req.body);
      res.json({ data: card });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/cards/:id — delete card
router.delete('/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    await cardService.deleteCard(req.params.id, userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// PATCH /api/cards/:id/move — reorder/move cards between columns
router.patch(
  '/:id/move',
  authenticate,
  validate([
    body('stageId').isUUID().withMessage('Stage ID is required'),
    body('position').isInt({ min: 0 }).withMessage('Position must be a non-negative integer'),
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { stageId, position } = req.body;
      const card = await cardService.moveCard(req.params.id, userId, stageId, position);
      res.json({ data: card });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/cards/:id/notes — add timeline note
router.post(
  '/:id/notes',
  authenticate,
  validate([
    body('note').isString().trim().notEmpty().withMessage('Note is required'),
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { note } = req.body;
      const activity = await cardService.addNote(req.params.id, userId, note);
      res.status(201).json({ data: activity });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
