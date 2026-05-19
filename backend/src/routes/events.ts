import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../config/logger';
import { pgSubscriber } from '../services/pgSubscriber';
import { JwtPayload } from '../middleware/auth';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';

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
router.get('/', (req: Request, res: Response, next: NextFunction): void => {
  const token = req.query.token as string;

  if (!token) {
    next(new AppError('Missing token', 401, 'ERR_MISSING_TOKEN'));
    return;
  }

  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch {
    next(new AppError('Invalid token', 401, 'ERR_INVALID_TOKEN'));
    return;
  }

  if (typeof decoded.userId !== 'string' || decoded.userId.length === 0) {
    next(new AppError('Invalid token', 401, 'ERR_INVALID_TOKEN'));
    return;
  }

  const userId: string = decoded.userId;

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
  send('event: message\ndata: {"event":"connected"}\n\n');

  pgSubscriber.registerClient(userId, res);

  const heartbeat = setInterval(() => send(': heartbeat\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    pgSubscriber.removeClient(userId, res);
    logger.info('SSE client disconnected', { userId });
  });
});

export default router;
