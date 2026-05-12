import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual, createHash } from 'crypto';
import db from '../config/database';
import { authenticate } from '../middleware/auth';
import { gmailService } from '../services/gmailService';
import { syncUserGmail } from '../services/gmailSyncService';

const router = Router();

/**
 * Constant-time string comparison to avoid timing side-channels when
 * validating the CRON_API_KEY secret.
 */
function safeCompare(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

router.get('/auth', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const url = await gmailService.getAuthUrl(req.user!.id);
    res.json({ url });
  } catch (err) { next(err); }
});

router.get('/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, state } = req.query as { code: string; state: string };
    await gmailService.handleCallback(code, state);
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    res.redirect(`${frontendUrl}/settings?gmail=connected`);
  } catch (err) { next(err); }
});

router.get('/status', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await gmailService.getStatus(req.user!.id);
    res.json({ data: status });
  } catch (err) { next(err); }
});

router.delete('/disconnect', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await gmailService.disconnect(req.user!.id);
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cronKey = process.env.CRON_API_KEY;
    const authHeader = req.headers.authorization ?? '';
    const isCron = !!cronKey && safeCompare(authHeader, `Bearer ${cronKey}`);

    if (isCron) {
      const tokens = await db('gmail_tokens').where({ is_valid: true }).select('user_id');
      const results: Record<string, unknown> = {};
      for (const { user_id } of tokens) {
        results[user_id] = await syncUserGmail(user_id);
      }
      return res.json({ results });
    }

    await new Promise<void>((resolve, reject) => {
      authenticate(req as Request, res as Response, (err?: unknown) => (err ? reject(err) : resolve()));
    });

    const summary = await syncUserGmail((req as Request).user!.id);
    res.json({ data: summary });
  } catch (err) { next(err); }
});

export default router;
