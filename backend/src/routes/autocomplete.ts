import { Router, Request, Response, NextFunction } from 'express';
import { autocompleteService } from '../services/autocompleteService';

const router = Router();

// GET /api/autocomplete/words — no authentication required
router.get('/words', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const words = autocompleteService.getWords();
    res.json({ words });
  } catch (err) {
    next(err);
  }
});

export default router;
