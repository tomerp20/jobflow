import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import authService from '../services/authService';
import { authenticate } from '../middleware/auth';
import logger from '../config/logger';

const signupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many signup attempts, please try again later.', code: 'ERR_RATE_LIMIT' } },
});

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many login attempts, please try again later.', code: 'ERR_RATE_LIMIT' } },
});

const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many token refresh attempts, please try again later.', code: 'ERR_RATE_LIMIT' } },
});

const router = Router();

/**
 * Helper to wrap async route handlers so rejected promises are forwarded
 * to the Express error handler.
 */
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * Middleware that checks express-validator results and returns 400 with
 * structured errors if validation failed.
 */
function handleValidationErrors(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: {
        message: 'Validation failed',
        code: 'ERR_VALIDATION',
        details: errors.array(),
      },
    });
    return;
  }
  next();
}

// ─── POST /api/auth/signup ────────────────────────────────────────────────────
router.post(
  '/signup',
  signupLimiter,
  [
    body('email')
      .isEmail()
      .withMessage('A valid email address is required')
      .normalizeEmail(),
    body('password')
      .isString()
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .trim(),
    body('name')
      .notEmpty()
      .withMessage('Name is required')
      .isString()
      .trim()
      .escape(),
  ],
  handleValidationErrors,
  asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { email, password, name } = req.body;

    const result = await authService.signup(email, password, name);

    res.status(201).json({
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    });
  })
);

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post(
  '/login',
  loginLimiter,
  [
    body('email')
      .isEmail()
      .withMessage('A valid email address is required')
      .normalizeEmail(),
    body('password')
      .notEmpty()
      .withMessage('Password is required')
      .isString()
      .trim(),
  ],
  handleValidationErrors,
  asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { email, password } = req.body;

    const result = await authService.login(email, password);

    res.status(200).json({
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    });
  })
);

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post(
  '/logout',
  authenticate,
  [
    body('refreshToken')
      .notEmpty()
      .withMessage('Refresh token is required')
      .isString()
      .trim(),
  ],
  handleValidationErrors,
  asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { refreshToken } = req.body;

    await authService.logout(req.user!.id, refreshToken);

    res.status(200).json({
      message: 'Logged out successfully',
    });
  })
);

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post(
  '/refresh',
  refreshLimiter,
  [
    body('refreshToken')
      .notEmpty()
      .withMessage('Refresh token is required')
      .isString()
      .trim(),
  ],
  handleValidationErrors,
  asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { refreshToken } = req.body;

    const result = await authService.refreshTokens(refreshToken);

    res.status(200).json({
      user: result.user,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    });
  })
);

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    res.status(200).json({
      user: req.user,
    });
  })
);

export default router;
