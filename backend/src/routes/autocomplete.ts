import { Router, Request, Response, NextFunction } from 'express';
import { autocompleteService } from '../services/autocompleteService';

const router = Router();

// GET /api/autocomplete/words — no authentication required
router.get('/words', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const words = autocompleteService.getWords();

    if (words === null) {
      res.status(503).json({
        error: {
          message: 'Dictionary unavailable — failed to load at startup',
          code: 'ERR_DICTIONARY_UNAVAILABLE',
        },
      });
      return;
    }

    // The word list is static for the lifetime of the server process; allow caching.
    res.set('Cache-Control', 'public, max-age=86400');
    res.json({ words });
  } catch (err) {
    next(err);
  }
});

export default router;
