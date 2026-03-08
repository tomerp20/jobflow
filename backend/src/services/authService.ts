import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';

const SALT_ROUNDS = 10;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

const DEFAULT_STAGES = [
  'Wishlist',
  'Applied',
  'Recruiter Call',
  'Technical Screen',
  'Home Assignment',
  'Final Interview',
  'Offer',
  'Rejected',
  'Accepted',
];

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface UserRecord {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AppError('JWT_SECRET is not configured', 500, 'ERR_CONFIG');
  }
  return secret;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate an access token and a refresh token for the given user.
 * The refresh token is a random UUID whose SHA-256 hash is stored in the DB.
 */
async function generateTokens(userId: string, email: string): Promise<TokenPair> {
  const secret = getJwtSecret();

  const accessToken = jwt.sign(
    { userId, email },
    secret,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );

  const refreshToken = uuidv4();
  const tokenHash = hashToken(refreshToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await db('refresh_tokens').insert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  return { accessToken, refreshToken };
}

/**
 * Create the 9 default pipeline stages for a newly registered user.
 */
async function createDefaultStages(userId: string): Promise<void> {
  const stages = DEFAULT_STAGES.map((name, index) => ({
    user_id: userId,
    name,
    position: index,
    is_default: true,
  }));

  await db('stages').insert(stages);
}

/**
 * Register a new user, create default stages, and return token pair.
 */
async function signup(
  email: string,
  password: string,
  name: string
): Promise<{ user: { id: string; email: string; name: string }; tokens: TokenPair }> {
  // Check if email already exists
  const existingUser = await db('users').where({ email: email.toLowerCase() }).first();
  if (existingUser) {
    throw new AppError('Email already in use', 409, 'ERR_EMAIL_EXISTS');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const [user] = await db('users')
    .insert({
      email: email.toLowerCase(),
      password_hash: passwordHash,
      name,
    })
    .returning(['id', 'email', 'name']);

  await createDefaultStages(user.id);

  const tokens = await generateTokens(user.id, user.email);

  logger.info('User signed up', { userId: user.id, email: user.email });

  return {
    user: { id: user.id, email: user.email, name: user.name },
    tokens,
  };
}

/**
 * Authenticate a user with email and password. Returns token pair on success.
 * Uses constant-time comparison and generic error messages to avoid leaking
 * whether an email exists.
 */
async function login(
  email: string,
  password: string
): Promise<{ user: { id: string; email: string; name: string }; tokens: TokenPair }> {
  const user: UserRecord | undefined = await db('users')
    .where({ email: email.toLowerCase() })
    .first();

  // Always run bcrypt.compare even if user doesn't exist to prevent timing attacks
  const storedHash = user?.password_hash ?? '$2a$10$invalidhashplaceholdervalue.padding';
  const isValid = await bcrypt.compare(password, storedHash);

  if (!user || !isValid) {
    throw new AppError('Invalid email or password', 401, 'ERR_INVALID_CREDENTIALS');
  }

  const tokens = await generateTokens(user.id, user.email);

  logger.info('User logged in', { userId: user.id });

  return {
    user: { id: user.id, email: user.email, name: user.name },
    tokens,
  };
}

/**
 * Validate an existing refresh token, rotate it (delete old, issue new pair).
 */
async function refreshTokens(
  refreshToken: string
): Promise<{ user: { id: string; email: string; name: string }; tokens: TokenPair }> {
  const tokenHash = hashToken(refreshToken);

  const storedToken = await db('refresh_tokens')
    .where({ token_hash: tokenHash })
    .andWhere('expires_at', '>', new Date())
    .first();

  if (!storedToken) {
    throw new AppError('Invalid or expired refresh token', 401, 'ERR_INVALID_REFRESH_TOKEN');
  }

  const user: UserRecord | undefined = await db('users')
    .where({ id: storedToken.user_id })
    .first();

  if (!user) {
    // User was deleted; clean up the token
    await db('refresh_tokens').where({ id: storedToken.id }).del();
    throw new AppError('Invalid or expired refresh token', 401, 'ERR_INVALID_REFRESH_TOKEN');
  }

  // Rotate: delete old token then issue new pair
  await db('refresh_tokens').where({ id: storedToken.id }).del();

  const tokens = await generateTokens(user.id, user.email);

  logger.info('Tokens refreshed', { userId: user.id });

  return {
    user: { id: user.id, email: user.email, name: user.name },
    tokens,
  };
}

/**
 * Invalidate a specific refresh token (logout).
 */
async function logout(userId: string, refreshToken: string): Promise<void> {
  const tokenHash = hashToken(refreshToken);

  await db('refresh_tokens')
    .where({ user_id: userId, token_hash: tokenHash })
    .del();

  logger.info('User logged out', { userId });
}

export default {
  signup,
  login,
  refreshTokens,
  logout,
  generateTokens,
  createDefaultStages,
};
