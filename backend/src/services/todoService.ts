import db from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface Todo {
  id: string;
  user_id: string;
  card_id: string | null;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'active' | 'completed';
  position: number | null;
  created_at: string;
  updated_at: string;
}

export const todoService = {
  async createTodo(
    userId: string,
    data: {
      description: string;
      priority?: 'low' | 'medium' | 'high' | 'urgent';
      card_id?: string | null;
    }
  ): Promise<Todo> {
    const [todo] = await db('todo_items')
      .insert({
        user_id: userId,
        description: data.description,
        priority: data.priority ?? 'medium',
        status: 'active',
        card_id: data.card_id ?? null,
        position: null,
      })
      .returning('*');
    return todo;
  },

  async getAllTodos(
    userId: string,
    filters: { card_id?: string; status?: string } = {}
  ): Promise<Todo[]> {
    const query = db('todo_items').where({ user_id: userId });
    if (filters.card_id) query.where({ card_id: filters.card_id });
    if (filters.status)  query.where({ status: filters.status });
    query.orderByRaw(`
      CASE priority
        WHEN 'urgent' THEN 1
        WHEN 'high'   THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low'    THEN 4
      END ASC,
      created_at ASC
    `);
    return query;
  },

  async updateTodo(
    id: string,
    userId: string,
    data: Partial<Pick<Todo, 'description' | 'priority' | 'status' | 'card_id'>>
  ): Promise<Todo> {
    const existing = await db('todo_items').where({ id, user_id: userId }).first();
    if (!existing) {
      throw new AppError('Todo not found', 404, 'ERR_NOT_FOUND');
    }
    const [updated] = await db('todo_items')
      .where({ id, user_id: userId })
      .update({ ...data, updated_at: db.fn.now() })
      .returning('*');
    return updated;
  },

  async deleteTodo(id: string, userId: string): Promise<void> {
    const existing = await db('todo_items').where({ id, user_id: userId }).first();
    if (!existing) {
      throw new AppError('Todo not found', 404, 'ERR_NOT_FOUND');
    }
    await db('todo_items').where({ id, user_id: userId }).del();
    if (existing.position !== null) {
      await db('todo_items')
        .where({ user_id: userId })
        .andWhere('position', '>', existing.position)
        .decrement('position', 1);
    }
  },

  async reorderTodos(userId: string, orderedIds: string[]): Promise<Todo[]> {
    // Fetch current todos to seed the priority map
    const todos: Todo[] = await db('todo_items').where({ user_id: userId });
    const originalPriority = new Map(todos.map(t => [t.id, t.priority]));

    // Track inferred priorities as we assign them so each item can inherit
    // the already-computed priority of the item directly above it.
    const inferredPriority = new Map<string, Todo['priority']>();

    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      let priority: Todo['priority'];

      if (i === 0) {
        // First item: inherit from the item below it (or keep original if only one)
        const belowId = orderedIds.length > 1 ? orderedIds[1] : null;
        priority = belowId
          ? (originalPriority.get(belowId) ?? 'medium')
          : (originalPriority.get(id) ?? 'medium');
      } else {
        // Every other item inherits the already-inferred priority of the item above
        priority = inferredPriority.get(orderedIds[i - 1]) ?? 'medium';
      }

      inferredPriority.set(id, priority);

      await db('todo_items')
        .where({ id, user_id: userId })
        .update({ position: i, priority, updated_at: db.fn.now() });
    }

    return db('todo_items')
      .where({ user_id: userId })
      .whereIn('id', orderedIds)
      .orderBy('position', 'asc');
  },
};
