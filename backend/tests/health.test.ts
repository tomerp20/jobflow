import request from 'supertest';

// ── Mock the database module ─────────────────────────────────────────────────
const mockRaw = jest.fn();

jest.mock('../src/config/database', () => {
  const handler = (tableName: string) => {
    const chain: Record<string, jest.Mock> = {};
    const methods = [
      'where', 'andWhere', 'select', 'first', 'insert', 'update', 'del',
      'returning', 'max', 'join', 'orderBy',
    ];
    for (const method of methods) {
      chain[method] = jest.fn().mockReturnValue(chain);
    }
    chain.first = jest.fn().mockResolvedValue(undefined);
    return chain;
  };
  handler.raw = mockRaw;
  handler.fn = { now: jest.fn().mockReturnValue('2026-01-01T00:00:00.000Z') };
  handler.transaction = jest.fn();
  return { __esModule: true, default: handler };
});

import app from '../src/app';

afterEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// HEALTH ENDPOINT TESTS
// =============================================================================

describe('Health - GET /api/health', () => {
  it('should return status, db, and uptime when database is connected', async () => {
    mockRaw.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('status', 'ok');
    expect(res.body.data).toHaveProperty('db', 'connected');
    expect(res.body.data).toHaveProperty('uptime');
    expect(typeof res.body.data.uptime).toBe('number');
  });

  it('should return 200 even without auth header', async () => {
    mockRaw.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const res = await request(app)
      .get('/api/health');
    // No Authorization header set

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('should return db status as disconnected when database fails', async () => {
    mockRaw.mockRejectedValue(new Error('Connection refused'));

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.db).toBe('disconnected');
  });

  it('should return uptime as a positive number', async () => {
    mockRaw.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.data.uptime).toBeGreaterThan(0);
  });

  it('should return valid JSON with correct content-type', async () => {
    mockRaw.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toBeDefined();
    expect(res.body.data).toBeDefined();
  });

  it('should return 404 for non-existent routes', async () => {
    const res = await request(app).get('/api/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Route not found');
    expect(res.body.error.code).toBe('ERR_NOT_FOUND');
  });
});
