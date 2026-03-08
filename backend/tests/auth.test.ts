import request from 'supertest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// ── Mock the database module before importing anything that uses it ──────────
const mockDb = jest.fn();

// Chainable query builder mock factory
function createQueryChain(resolvedValue: unknown = undefined) {
  const chain: Record<string, jest.Mock> = {};
  const methods = [
    'where', 'andWhere', 'select', 'first', 'insert', 'update', 'del',
    'returning', 'max', 'join', 'orderBy', 'increment', 'decrement',
  ];
  for (const method of methods) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }
  chain.first = jest.fn().mockResolvedValue(resolvedValue);
  chain.returning = jest.fn().mockResolvedValue(
    Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue]
  );
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.del = jest.fn().mockResolvedValue(1);
  return chain;
}

jest.mock('../src/config/database', () => {
  const handler = (tableName: string) => {
    // Each test will configure mockDb to return the right chain per table
    return mockDb(tableName);
  };
  handler.raw = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
  handler.fn = { now: jest.fn().mockReturnValue('2026-01-01T00:00:00.000Z') };
  handler.transaction = jest.fn();
  return { __esModule: true, default: handler };
});

import app from '../src/app';

// ── Constants ────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const MOCK_USER = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'test@example.com',
  name: 'Test User',
  password_hash: '', // will be set in beforeAll
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
};

let validPasswordHash: string;

beforeAll(async () => {
  validPasswordHash = await bcrypt.hash('password123', 10);
  MOCK_USER.password_hash = validPasswordHash;
});

afterEach(() => {
  jest.clearAllMocks();
});

// ── Helper: generate a valid access token ────────────────────────────────────
function generateValidToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '15m' });
}

// ── Helper: configure mockDb for a specific test scenario ────────────────────
function setupDbMock(tableResponses: Record<string, ReturnType<typeof createQueryChain>>) {
  mockDb.mockImplementation((tableName: string) => {
    if (tableResponses[tableName]) {
      return tableResponses[tableName];
    }
    return createQueryChain(undefined);
  });
}

// =============================================================================
// AUTH TESTS
// =============================================================================

describe('Auth - POST /api/auth/signup', () => {
  it('should create a user and return access and refresh tokens', async () => {
    const usersChain = createQueryChain(undefined); // no existing user
    usersChain.insert = jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([
        { id: MOCK_USER.id, email: 'newuser@example.com', name: 'New User' },
      ]),
    });

    const stagesChain = createQueryChain(undefined);
    stagesChain.insert = jest.fn().mockResolvedValue([]);

    const refreshChain = createQueryChain(undefined);
    refreshChain.insert = jest.fn().mockResolvedValue([]);

    setupDbMock({
      users: usersChain,
      stages: stagesChain,
      refresh_tokens: refreshChain,
    });

    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'newuser@example.com',
        password: 'password123',
        name: 'New User',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user).toEqual({
      id: MOCK_USER.id,
      email: 'newuser@example.com',
      name: 'New User',
    });
  });

  it('should create default stages on signup', async () => {
    const usersChain = createQueryChain(undefined);
    usersChain.insert = jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([
        { id: MOCK_USER.id, email: 'stages@example.com', name: 'Stage User' },
      ]),
    });

    const stagesChain = createQueryChain(undefined);
    const stagesInsertMock = jest.fn().mockResolvedValue([]);
    stagesChain.insert = stagesInsertMock;

    const refreshChain = createQueryChain(undefined);
    refreshChain.insert = jest.fn().mockResolvedValue([]);

    setupDbMock({
      users: usersChain,
      stages: stagesChain,
      refresh_tokens: refreshChain,
    });

    await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'stages@example.com',
        password: 'password123',
        name: 'Stage User',
      });

    // Verify stages.insert was called with 9 default stages
    expect(stagesInsertMock).toHaveBeenCalledTimes(1);
    const insertedStages = stagesInsertMock.mock.calls[0][0];
    expect(insertedStages).toHaveLength(9);
    expect(insertedStages[0]).toMatchObject({ name: 'Wishlist', position: 0, is_default: true });
    expect(insertedStages[8]).toMatchObject({ name: 'Accepted', position: 8, is_default: true });
  });

  it('should reject duplicate emails with 409', async () => {
    const usersChain = createQueryChain({ id: MOCK_USER.id, email: 'dup@example.com' });

    setupDbMock({ users: usersChain });

    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'dup@example.com',
        password: 'password123',
        name: 'Dup User',
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ERR_EMAIL_EXISTS');
  });

  it('should reject signup with short password (validation)', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'valid@example.com',
        password: 'short',
        name: 'Test',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ERR_VALIDATION');
  });

  it('should reject signup with invalid email (validation)', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({
        email: 'not-an-email',
        password: 'password123',
        name: 'Test',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ERR_VALIDATION');
  });
});

describe('Auth - POST /api/auth/login', () => {
  it('should login with correct credentials and return tokens', async () => {
    const usersChain = createQueryChain({
      ...MOCK_USER,
      password_hash: validPasswordHash,
    });

    const refreshChain = createQueryChain(undefined);
    refreshChain.insert = jest.fn().mockResolvedValue([]);

    setupDbMock({
      users: usersChain,
      refresh_tokens: refreshChain,
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'password123',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user).toMatchObject({
      id: MOCK_USER.id,
      email: MOCK_USER.email,
      name: MOCK_USER.name,
    });
  });

  it('should reject wrong password with generic message', async () => {
    const usersChain = createQueryChain({
      ...MOCK_USER,
      password_hash: validPasswordHash,
    });

    setupDbMock({ users: usersChain });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'wrongpassword',
      });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
    expect(res.body.error.code).toBe('ERR_INVALID_CREDENTIALS');
  });

  it('should reject non-existent email with same generic message', async () => {
    const usersChain = createQueryChain(undefined); // no user found

    setupDbMock({ users: usersChain });

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'nobody@example.com',
        password: 'password123',
      });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
    expect(res.body.error.code).toBe('ERR_INVALID_CREDENTIALS');
  });

  it('should reject login with missing password (validation)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ERR_VALIDATION');
  });
});

describe('Auth - GET /api/auth/me', () => {
  it('should return user data with valid auth token', async () => {
    const token = generateValidToken(MOCK_USER.id, MOCK_USER.email);

    const usersChain = createQueryChain(undefined);
    usersChain.select = jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        first: jest.fn().mockResolvedValue({
          id: MOCK_USER.id,
          email: MOCK_USER.email,
          name: MOCK_USER.name,
        }),
      }),
    });

    setupDbMock({ users: usersChain });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: MOCK_USER.id,
      email: MOCK_USER.email,
      name: MOCK_USER.name,
    });
  });

  it('should reject requests without auth token with 401', async () => {
    const res = await request(app)
      .get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR_NO_TOKEN');
  });

  it('should reject expired tokens', async () => {
    const expiredToken = jwt.sign(
      { userId: MOCK_USER.id, email: MOCK_USER.email },
      JWT_SECRET,
      { expiresIn: '0s' } // expires immediately
    );

    // Wait a moment so the token is definitely expired
    await new Promise((r) => setTimeout(r, 50));

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Token has expired');
    expect(res.body.error.code).toBe('ERR_INVALID_TOKEN');
  });

  it('should reject malformed tokens', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid.token.here');

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid token');
    expect(res.body.error.code).toBe('ERR_INVALID_TOKEN');
  });

  it('should reject if Bearer prefix is missing', async () => {
    const token = generateValidToken(MOCK_USER.id, MOCK_USER.email);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', token);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR_NO_TOKEN');
  });
});

describe('Auth - password hashing', () => {
  it('should hash passwords correctly so they can be verified with bcrypt', async () => {
    const password = 'my-secret-password';
    const hash = await bcrypt.hash(password, 10);

    // Hash should not equal plaintext
    expect(hash).not.toBe(password);

    // bcrypt.compare should return true for the correct password
    const isMatch = await bcrypt.compare(password, hash);
    expect(isMatch).toBe(true);

    // bcrypt.compare should return false for the wrong password
    const isMismatch = await bcrypt.compare('wrong-password', hash);
    expect(isMismatch).toBe(false);
  });
});
