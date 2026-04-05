// ── Mock the database module before importing anything that uses it ──────────

const mockDb = jest.fn();
const mockTransaction = jest.fn();

function createQueryChain(resolvedValue: unknown = undefined) {
  const chain: Record<string, jest.Mock> = {};
  const methods = [
    'where', 'andWhere', 'select', 'first', 'insert', 'update', 'del',
    'returning', 'orderBy', 'orderByRaw', 'decrement', 'whereIn',
  ];
  for (const method of methods) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }
  chain.first = jest.fn().mockResolvedValue(resolvedValue);
  chain.returning = jest.fn().mockResolvedValue(
    Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue]
  );
  chain.del = jest.fn().mockResolvedValue(1);
  (chain as any).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(Array.isArray(resolvedValue) ? resolvedValue : [resolvedValue]).then(resolve, reject);
  return chain;
}

jest.mock('../src/config/database', () => {
  const handler = (tableName: string) => mockDb(tableName);
  handler.raw = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
  handler.fn = { now: jest.fn().mockReturnValue('2026-01-01T00:00:00.000Z') };
  handler.transaction = mockTransaction;
  return { __esModule: true, default: handler };
});

import { todoService } from '../src/services/todoService';

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const CARD_ID = '770e8400-e29b-41d4-a716-446655440002';
const TODO_ID  = 'aaa00000-e29b-41d4-a716-446655440001';

const MOCK_TODO = {
  id: TODO_ID,
  user_id: USER_ID,
  card_id: null,
  description: 'Learn React Query',
  priority: 'medium',
  status: 'active',
  position: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

afterEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// GET ALL TODOS
// =============================================================================

describe('TodoService - getAllTodos', () => {
  it('should return todos sorted by priority desc then created_at asc', async () => {
    const todos = [
      { ...MOCK_TODO, id: 'todo-1', priority: 'urgent' },
      { ...MOCK_TODO, id: 'todo-2', priority: 'low' },
    ];

    const chain = createQueryChain(todos);
    (chain as any).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(todos).then(resolve, reject);

    mockDb.mockImplementation(() => chain);

    const result = await todoService.getAllTodos(USER_ID);

    expect(result).toHaveLength(2);
    expect(chain.where).toHaveBeenCalledWith({ user_id: USER_ID });
    expect(chain.orderByRaw).toHaveBeenCalled();
  });

  it('should filter by card_id when provided', async () => {
    const linked = [{ ...MOCK_TODO, card_id: CARD_ID }];

    const chain = createQueryChain(linked);
    (chain as any).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(linked).then(resolve, reject);

    mockDb.mockImplementation(() => chain);

    const result = await todoService.getAllTodos(USER_ID, { card_id: CARD_ID });

    expect(result).toHaveLength(1);
    expect(chain.where).toHaveBeenCalledWith({ card_id: CARD_ID });
  });
});

// =============================================================================
// UPDATE TODO
// =============================================================================

describe('TodoService - updateTodo', () => {
  it('should update fields and return the updated todo', async () => {
    const updated = { ...MOCK_TODO, description: 'Learn GraphQL', priority: 'high' as const };
    let callCount = 0;

    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'todo_items') {
        callCount++;
        if (callCount === 1) {
          // find existing
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue({ ...MOCK_TODO }),
          });
          return chain;
        } else {
          // update
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            update: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([updated]),
            }),
          });
          return chain;
        }
      }
      return createQueryChain(undefined);
    });

    const result = await todoService.updateTodo(TODO_ID, USER_ID, {
      description: 'Learn GraphQL',
      priority: 'high',
    });

    expect(result).toMatchObject({ description: 'Learn GraphQL', priority: 'high' });
  });

  it('should throw 404 when todo not found', async () => {
    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'todo_items') {
        const chain = createQueryChain(undefined);
        chain.where = jest.fn().mockReturnValue({
          first: jest.fn().mockResolvedValue(undefined),
        });
        return chain;
      }
      return createQueryChain(undefined);
    });

    await expect(
      todoService.updateTodo('nonexistent', USER_ID, { description: 'nope' })
    ).rejects.toMatchObject({ statusCode: 404, code: 'ERR_NOT_FOUND' });
  });
});

// =============================================================================
// DELETE TODO
// =============================================================================

describe('TodoService - deleteTodo', () => {
  it('should hard-delete the todo and close position gaps', async () => {
    const existingWithPosition = { ...MOCK_TODO, position: 2 };
    const delMock = jest.fn().mockResolvedValue(1);
    const decrementMock = jest.fn().mockResolvedValue(1);
    let callCount = 0;

    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'todo_items') {
        callCount++;
        if (callCount === 1) {
          // find existing
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue(existingWithPosition),
          });
          return chain;
        } else if (callCount === 2) {
          // delete
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({ del: delMock });
          return chain;
        } else {
          // shift positions
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            andWhere: jest.fn().mockReturnValue({ decrement: decrementMock }),
          });
          return chain;
        }
      }
      return createQueryChain(undefined);
    });

    await todoService.deleteTodo(TODO_ID, USER_ID);

    expect(delMock).toHaveBeenCalledTimes(1);
    expect(decrementMock).toHaveBeenCalledWith('position', 1);
  });

  it('should delete without position shift when position is null', async () => {
    const existingNoPosition = { ...MOCK_TODO, position: null };
    const delMock = jest.fn().mockResolvedValue(1);
    let callCount = 0;

    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'todo_items') {
        callCount++;
        if (callCount === 1) {
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({
            first: jest.fn().mockResolvedValue(existingNoPosition),
          });
          return chain;
        } else {
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({ del: delMock });
          return chain;
        }
      }
      return createQueryChain(undefined);
    });

    await todoService.deleteTodo(TODO_ID, USER_ID);

    expect(delMock).toHaveBeenCalledTimes(1);
    // Only 2 db calls: find + delete (no position shift)
    expect(callCount).toBe(2);
  });

  it('should throw 404 when todo not found', async () => {
    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'todo_items') {
        const chain = createQueryChain(undefined);
        chain.where = jest.fn().mockReturnValue({
          first: jest.fn().mockResolvedValue(undefined),
        });
        return chain;
      }
      return createQueryChain(undefined);
    });

    await expect(todoService.deleteTodo('nonexistent', USER_ID))
      .rejects.toMatchObject({ statusCode: 404, code: 'ERR_NOT_FOUND' });
  });
});

// =============================================================================
// REORDER TODOS
// =============================================================================

describe('TodoService - reorderTodos', () => {
  it('should assign positions and infer priority from the item above', async () => {
    // Before reorder: todo-A is urgent (pos 0), todo-B is low (pos 1), todo-C is medium (pos 2)
    // User drags todo-B to top → new order: [B, A, C]
    // Expected: B inherits priority of item below (A=urgent), A inherits B's old slot neighbour (A=urgent stays),
    //           actually per our rule: B is at index 0 → inherits from item below (A=urgent)
    //                                  A is at index 1 → inherits from item above (B, but B just got urgent)
    const todoA = { ...MOCK_TODO, id: 'todo-A', priority: 'urgent' as const, position: 0 };
    const todoB = { ...MOCK_TODO, id: 'todo-B', priority: 'low'    as const, position: 1 };
    const todoC = { ...MOCK_TODO, id: 'todo-C', priority: 'medium' as const, position: 2 };
    const allTodos = [todoA, todoB, todoC];

    const updateMock = jest.fn().mockResolvedValue(1);
    const reorderedResult = [
      { ...todoB, position: 0, priority: 'urgent' },
      { ...todoA, position: 1, priority: 'urgent' },
      { ...todoC, position: 2, priority: 'urgent' },
    ];

    let callCount = 0;
    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'todo_items') {
        callCount++;
        if (callCount === 1) {
          // initial fetch of all todos
          const chain = createQueryChain(allTodos);
          (chain as any).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            Promise.resolve(allTodos).then(resolve, reject);
          return chain;
        } else if (callCount <= 4) {
          // update calls per item (3 items)
          const chain = createQueryChain(undefined);
          chain.where = jest.fn().mockReturnValue({ update: updateMock });
          return chain;
        } else {
          // final fetch
          const chain = createQueryChain(reorderedResult);
          (chain as any).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            Promise.resolve(reorderedResult).then(resolve, reject);
          return chain;
        }
      }
      return createQueryChain(undefined);
    });

    const result = await todoService.reorderTodos(USER_ID, ['todo-B', 'todo-A', 'todo-C']);

    // update was called once per todo
    expect(updateMock).toHaveBeenCalledTimes(3);
    // First item (index 0, no neighbour above) gets priority from item below (todo-A = urgent)
    expect(updateMock.mock.calls[0][0]).toMatchObject({ position: 0, priority: 'urgent' });
    // Second item (index 1, neighbour above is todo-B which just got urgent) gets urgent
    expect(updateMock.mock.calls[1][0]).toMatchObject({ position: 1, priority: 'urgent' });
    expect(result).toHaveLength(3);
  });
});

// =============================================================================
// CREATE TODO
// =============================================================================

describe('TodoService - createTodo', () => {
  it('should create a todo with default priority (medium) and status (active)', async () => {
    mockDb.mockImplementation((tableName: string) => {
      if (tableName === 'todo_items') {
        const chain = createQueryChain(undefined);
        chain.insert = jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ ...MOCK_TODO }]),
        });
        return chain;
      }
      return createQueryChain(undefined);
    });

    const result = await todoService.createTodo(USER_ID, {
      description: 'Learn React Query',
    });

    expect(result).toMatchObject({
      description: 'Learn React Query',
      priority: 'medium',
      status: 'active',
      card_id: null,
    });
  });
});
