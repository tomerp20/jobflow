import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import db from '../config/database';
import logger from '../config/logger';
import { pgSubscriber } from '../services/pgSubscriber';

const router = Router();

interface JwtPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

/**
 * GET /api/events
 *
 * SSE endpoint for real-time card-event notifications. The browser
 * EventSource API cannot set custom headers, so the JWT is passed as a
 * query parameter: ?token=<jwt>
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
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

  // Verify the user still exists in the database
  const user = await db('users')
    .select('id')
    .where({ id: decoded.userId })
    .first();

  if (!user) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const userId = user.id as string;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disables nginx buffering
  res.flushHeaders();

  // Send initial connected event
  res.write('data: {"event":"connected"}\n\n');

  pgSubscriber.registerClient(userId, res);

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    pgSubscriber.removeClient(userId, res);
    logger.info('SSE client disconnected', { userId });
  });
});

export default router;
