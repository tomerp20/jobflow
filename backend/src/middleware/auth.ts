import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import logger from '../config/logger';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
      };
      isCronRequest?: boolean;
    }
  }
}

export interface JwtPayload {
  userId: string;
  email: string;
  name: string;
  iat: number;
  exp: number;
}

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

    req.user = {
      id: decoded.userId,
      email: decoded.email,
      name: decoded.name,
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
