import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../config/database';
import logger from '../config/logger';
import { pgSubscriber } from '../services/pgSubscriber';
import { JwtPayload } from '../middleware/auth';

const router = Router();

/**
 * GET /api/events
 *
 * SSE endpoint for real-time card-event notifications. The browser
 * EventSource API cannot set custom headers, so the JWT is passed as a
 * query parameter: ?token=<jwt>
 *
 * Security note: passing a token in the URL causes it to appear in server
 * access logs and browser history. Ensure any access-log middleware (e.g.
 * morgan) is configured to redact the `token` query param on this route.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = req.query.token as string;

  if (!token) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    logger.error('JWT_SECRET is not configured');
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, secret) as JwtPayload;
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  // Verify the user still exists in the database — wrapped in try/catch so DB
  // errors are forwarded to the Express error handler before SSE headers are set
  let userId: string;
  try {
    const user = await db('users')
      .select('id')
      .where({ id: decoded.userId })
      .first();

    if (!user) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    userId = user.id as string;
  } catch (err) {
    next(err);
    return;
  }

  // Disable compression for this response — the compression middleware buffers
  // writes into a gzip stream, preventing heartbeats from reaching the proxy.
  // Clearing accept-encoding tells the middleware to skip compression here.
  req.headers['accept-encoding'] = 'identity';

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disables nginx buffering
  res.flushHeaders();

  // Helper: write and immediately flush past any remaining middleware buffers
  const send = (chunk: string) => {
    res.write(chunk);
    // compression middleware adds res.flush(); call it if present
    (res as unknown as { flush?: () => void }).flush?.();
  };

  // Send initial connected event
  send('data: {"event":"connected"}\n\n');

  pgSubscriber.registerClient(userId, res);

  const heartbeat = setInterval(() => send(': heartbeat\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    pgSubscriber.removeClient(userId, res);
    logger.info('SSE client disconnected', { userId });
  });
});

export default router;
