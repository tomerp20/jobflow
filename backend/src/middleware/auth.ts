import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../config/database';
import logger from '../config/logger';

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
      };
    }
  }
}

export interface JwtPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

/**
 * Express middleware that verifies the JWT access token from the
 * Authorization: Bearer <token> header, looks up the user in the database,
 * and attaches { id, email, name } to req.user.
 *
 * Returns 401 if the token is missing, malformed, expired, or belongs to a
 * user that no longer exists.
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: {
          message: 'Authentication required',
          code: 'ERR_NO_TOKEN',
        },
      });
      return;
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({
        error: {
          message: 'Authentication required',
          code: 'ERR_NO_TOKEN',
        },
      });
      return;
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      logger.error('JWT_SECRET is not configured');
      res.status(500).json({
        error: {
          message: 'Internal server error',
          code: 'ERR_INTERNAL',
        },
      });
      return;
    }

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, secret) as JwtPayload;
    } catch (err) {
      const message =
        err instanceof jwt.TokenExpiredError
          ? 'Token has expired'
          : 'Invalid token';

      res.status(401).json({
        error: {
          message,
          code: 'ERR_INVALID_TOKEN',
        },
      });
      return;
    }

    // Look up user in database to ensure they still exist
    const user = await db('users')
      .select('id', 'email', 'name')
      .where({ id: decoded.userId })
      .first();

    if (!user) {
      res.status(401).json({
        error: {
          message: 'User not found',
          code: 'ERR_USER_NOT_FOUND',
        },
      });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
    };

    next();
  } catch (err) {
    logger.error('Authentication middleware error', { error: err });
    res.status(500).json({
      error: {
        message: 'Internal server error',
        code: 'ERR_INTERNAL',
      },
    });
  }
}
