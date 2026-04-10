import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { autocompleteService } from '../services/autocompleteService';

const router = Router();

// Rate-limit the words endpoint: it is unauthenticated and returns ~6 MB per response.
// 10 requests per IP per minute is generous for any legitimate autocomplete use case.
const wordsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      message: 'Too many requests — please wait before retrying',
      code: 'ERR_RATE_LIMIT',
    },
  },
});

// GET /api/autocomplete/words — no authentication required
router.get('/words', wordsRateLimit, (_req: Request, res: Response, next: NextFunction) => {
  try {
    const words = autocompleteService.getWords();

    if (words === null) {
      // Dictionary load failure is permanent until the process restarts.
      res.set('Retry-After', '3600');
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
    // source moves to the envelope — it is a constant for all entries and
    // does not need to be repeated 341 585 times in the response body.
    res.json({ source: 'dictionary', words });
  } catch (err) {
    next(err);
  }
});

export default router;
