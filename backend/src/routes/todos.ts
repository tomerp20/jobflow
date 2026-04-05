import { Router, Request, Response, NextFunction } from 'express';
import { body, query } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { todoService } from '../services/todoService';

const router = Router();

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

// GET /api/todos
router.get(
  '/',
  authenticate,
  validate([
    query('card_id').optional().isUUID().withMessage('card_id must be a valid UUID'),
    query('status').optional().isIn(['active', 'completed']).withMessage('Invalid status'),
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const filters = {
        card_id: req.query.card_id as string | undefined,
        status:  req.query.status  as string | undefined,
      };
      const todos = await todoService.getAllTodos(userId, filters);
      res.json({ data: todos });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/todos
router.post(
  '/',
  authenticate,
  validate([
    body('description').isString().trim().notEmpty().withMessage('Description is required'),
    body('priority').optional().isIn(VALID_PRIORITIES).withMessage('Invalid priority'),
    body('card_id').optional({ values: 'null' }).isUUID().withMessage('card_id must be a valid UUID'),
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const todo = await todoService.createTodo(userId, {
        description: req.body.description,
        priority:    req.body.priority,
        card_id:     req.body.card_id ?? null,
      });
      res.status(201).json({ data: todo });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/todos/reorder  — must come before /:id to avoid route collision
router.patch(
  '/reorder',
  authenticate,
  validate([
    body('ordered_ids').isArray({ min: 1 }).withMessage('ordered_ids must be a non-empty array'),
    body('ordered_ids.*').isUUID().withMessage('Each id must be a valid UUID'),
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const todos = await todoService.reorderTodos(userId, req.body.ordered_ids);
      res.json({ data: todos });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/todos/:id
router.patch(
  '/:id',
  authenticate,
  validate([
    body('description').optional().isString().trim().notEmpty(),
    body('priority').optional().isIn(VALID_PRIORITIES).withMessage('Invalid priority'),
    body('status').optional().isIn(['active', 'completed']).withMessage('Invalid status'),
    body('card_id').optional({ values: 'null' }).isUUID().withMessage('card_id must be a valid UUID'),
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const todo = await todoService.updateTodo(req.params.id, userId, req.body);
      res.json({ data: todo });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/todos/:id
router.delete(
  '/:id',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      await todoService.deleteTodo(req.params.id, userId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
