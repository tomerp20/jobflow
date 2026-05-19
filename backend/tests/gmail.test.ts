// ── Mock the database module before any imports that use it ───────────────────

const mockDb = jest.fn();

function createQueryChain(resolvedValue: unknown = undefined) {
  const chain: Record<string, jest.Mock> = {};
  const methods = [
    'where', 'andWhere', 'select', 'first', 'insert', 'update', 'del',
    'returning', 'join', 'orderBy',
  ];
  for (const method of methods) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }
  chain.first = jest.fn().mockResolvedValue(resolvedValue);
  chain.select = jest.fn().mockResolvedValue(
    Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue],
  );
  chain.del = jest.fn().mockResolvedValue(1);
  return chain;
}

jest.mock('../src/config/database', () => {
  const handler = (tableName: string) => mockDb(tableName);
  handler.raw = jest.fn();
  handler.fn = { now: jest.fn() };
  handler.transaction = jest.fn();
  return { __esModule: true, default: handler };
});

jest.mock('../src/services/gmailSync', () => ({
  syncUserGmail: jest.fn(),
}));

jest.mock('../src/services/gmailService', () => ({
  gmailService: {
    getAuthUrl: jest.fn(),
    handleCallback: jest.fn(),
    getStatus: jest.fn(),
    disconnect: jest.fn(),
  },
}));

import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import { syncUserGmail } from '../src/services/gmailSync';

// ── Constants ────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
const CRON_API_KEY = 'test-cron-key-secret';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_EMAIL = 'test@example.com';
const USER_NAME = 'Test User';

function generateValidToken(userId: string, email: string, name: string): string {
  return jwt.sign({ userId, email, name }, JWT_SECRET, { expiresIn: '15m' });
}

afterEach(() => {
  jest.clearAllMocks();
  delete process.env.CRON_API_KEY;
});

// =============================================================================
// POST /api/gmail/sync
// =============================================================================

describe('POST /api/gmail/sync — cron path', () => {
  it('should sync all users when called with a valid CRON_API_KEY', async () => {
    process.env.CRON_API_KEY = CRON_API_KEY;

    const gmailTokensChain = createQueryChain([{ user_id: USER_ID }]);
    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'gmail_tokens') return gmailTokensChain;
      return createQueryChain(undefined);
    });

    (syncUserGmail as jest.Mock).mockResolvedValue({ scanned: 5, receiptsCreated: 1 });

    const res = await request(app)
      .post('/api/gmail/sync')
      .set('Authorization', `Bearer ${CRON_API_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body.results[USER_ID]).toMatchObject({ scanned: 5, receiptsCreated: 1 });
    expect(syncUserGmail).toHaveBeenCalledWith(USER_ID);
    expect(syncUserGmail).toHaveBeenCalledTimes(1);
  });

  it('should return 401 when CRON_API_KEY is wrong', async () => {
    process.env.CRON_API_KEY = CRON_API_KEY;

    const res = await request(app)
      .post('/api/gmail/sync')
      .set('Authorization', 'Bearer wrong-key');

    // Wrong cron key is passed to authenticate as a JWT — rejected as invalid token
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR_INVALID_TOKEN');
  });
});

describe('POST /api/gmail/sync — user path', () => {
  it('should sync for the authenticated user when called with a valid JWT', async () => {
    const token = generateValidToken(USER_ID, USER_EMAIL, USER_NAME);
    (syncUserGmail as jest.Mock).mockResolvedValue({ scanned: 3, receiptsCreated: 0 });

    const res = await request(app)
      .post('/api/gmail/sync')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ scanned: 3, receiptsCreated: 0 });
    expect(syncUserGmail).toHaveBeenCalledWith(USER_ID);
  });

  it('should return 401 when no token is provided', async () => {
    const res = await request(app)
      .post('/api/gmail/sync');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR_NO_TOKEN');
  });

  it('should return 401 when JWT is invalid', async () => {
    const res = await request(app)
      .post('/api/gmail/sync')
      .set('Authorization', 'Bearer invalid.jwt.token');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR_INVALID_TOKEN');
  });

  it('should return 401 when JWT is expired', async () => {
    const expiredToken = jwt.sign(
      { userId: USER_ID, email: USER_EMAIL, name: USER_NAME },
      JWT_SECRET,
      { expiresIn: '0s' },
    );

    await new Promise((r) => setTimeout(r, 50));

    const res = await request(app)
      .post('/api/gmail/sync')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Token has expired');
  });
});
