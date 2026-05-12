import { google } from 'googleapis';
import db from '../config/database';
import { notificationService } from './notificationService';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? `${process.env.BACKEND_URL}/api/gmail/callback`
  );
}

export const gmailService = {
  getAuthUrl(userId: string): string {
    const oauth2Client = createOAuthClient();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      state: userId,
    });
  },

  async handleCallback(code: string, userId: string): Promise<void> {
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

  async fetchUnreadEmails(userId: string, gmailClient: ReturnType<typeof google.gmail>) {
    const token = await db('gmail_tokens').where({ user_id: userId }).first();
    const sinceDate = token?.last_sync_at
      ? new Date(token.last_sync_at)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
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
