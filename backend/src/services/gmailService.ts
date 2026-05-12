import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import db from '../config/database';
import { notificationService } from './notificationService';
import { AppError } from '../middleware/errorHandler';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
// OAuth state nonces expire after 10 minutes
const OAUTH_STATE_TTL_S = 10 * 60;

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? `${process.env.BACKEND_URL}/api/gmail/callback`
  );
}

/**
 * Creates a short-lived, signed JWT that embeds the userId.
 * Used as the OAuth `state` parameter to prevent CSRF on the callback.
 * The JWT is signed with JWT_SECRET and expires in 10 minutes.
 */
function createOAuthStateToken(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new AppError('JWT_SECRET is not configured', 500, 'ERR_INTERNAL');
  return jwt.sign({ userId, purpose: 'oauth_state' }, secret, { expiresIn: OAUTH_STATE_TTL_S });
}

/**
 * Verifies an OAuth state JWT and returns the embedded userId.
 * Throws AppError(400) if the token is missing, tampered with, or expired.
 */
function verifyOAuthStateToken(state: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new AppError('JWT_SECRET is not configured', 500, 'ERR_INTERNAL');
  try {
    const payload = jwt.verify(state, secret) as { userId: string; purpose: string };
    if (payload.purpose !== 'oauth_state') throw new Error('wrong purpose');
    return payload.userId;
  } catch {
    throw new AppError('Invalid or expired OAuth state', 400, 'ERR_INVALID_STATE');
  }
}

export const gmailService = {
  getAuthUrl(userId: string): string {
    const oauth2Client = createOAuthClient();
    const state = createOAuthStateToken(userId);
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      state,
    });
  },

  async handleCallback(code: string, state: string): Promise<void> {
    // Verify the CSRF state token and extract the userId
    const userId = verifyOAuthStateToken(state);

    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const gmailAddress = profile.data.emailAddress!;

    await db('gmail_tokens')
      .insert({
        user_id: userId,
        gmail_address: gmailAddress,
        access_token: tokens.access_token!,
        refresh_token: tokens.refresh_token!,
        token_expiry: new Date(tokens.expiry_date!),
        is_valid: true,
      })
      .onConflict('user_id')
      .merge(['access_token', 'refresh_token', 'token_expiry', 'gmail_address', 'is_valid', 'updated_at']);
  },

  async getStatus(userId: string) {
    const token = await db('gmail_tokens').where({ user_id: userId }).first();
    if (!token) return { connected: false as const };
    return {
      connected: true as const,
      email: token.gmail_address,
      last_sync_at: token.last_sync_at,
      is_valid: token.is_valid,
    };
  },

  async disconnect(userId: string): Promise<void> {
    await db('gmail_tokens').where({ user_id: userId }).del();
  },

  async getValidClient(userId: string) {
    const token = await db('gmail_tokens').where({ user_id: userId, is_valid: true }).first();
    if (!token) return null;

    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expiry_date: new Date(token.token_expiry).getTime(),
    });

    const expiryMs = new Date(token.token_expiry).getTime();
    if (Date.now() > expiryMs - 5 * 60 * 1000) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);
        await db('gmail_tokens').where({ user_id: userId }).update({
          access_token: credentials.access_token!,
          token_expiry: new Date(credentials.expiry_date!),
          updated_at: db.fn.now(),
        });
      } catch {
        await db('gmail_tokens').where({ user_id: userId }).update({ is_valid: false, updated_at: db.fn.now() });
        await notificationService.create(
          userId,
          'Gmail connection lost',
          'Your Gmail connection has expired. Reconnect in Settings.'
        );
        return null;
      }
    }

    return google.gmail({ version: 'v1', auth: oauth2Client });
  },

  async fetchUnreadEmails(
    gmailClient: ReturnType<typeof google.gmail>,
    lastSyncAt: Date | null
  ) {
    const sinceDate = lastSyncAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const afterEpoch = Math.floor(sinceDate.getTime() / 1000);

    const listRes = await gmailClient.users.messages.list({
      userId: 'me',
      q: `is:unread (in:inbox OR in:promotions) after:${afterEpoch}`,
      maxResults: 50,
    });

    const messages = listRes.data.messages ?? [];
    const emails = [];

    for (const msg of messages) {
      const full = await gmailClient.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'full',
      });

      const headers = full.data.payload?.headers ?? [];
      const subject = headers.find(h => h.name === 'Subject')?.value ?? '';
      const sender = headers.find(h => h.name === 'From')?.value ?? '';
      const dateHeader = headers.find(h => h.name === 'Date')?.value;
      const receivedAt = dateHeader ? new Date(dateHeader) : new Date();

      let body = '';
      const parts = full.data.payload?.parts ?? [];
      const textPart = parts.find(p => p.mimeType === 'text/plain') ?? full.data.payload;
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      }
      body = body.slice(0, 2000);

      emails.push({ messageId: msg.id!, subject, sender, body, receivedAt });
    }

    return emails;
  },
};
