import { useState, useEffect, useRef } from 'react';
import { CheckSquare, Trash2, Plus } from 'lucide-react';
import { todosApi, cardsApi } from '@/services/api';
import type { Todo, Card } from '@/types';

const TODO_PRIORITY_CONFIG: Record<Todo['priority'], { cssClass: string; label: string }> = {
  urgent: { cssClass: 'priority-critical', label: 'Urgent' },
  high:   { cssClass: 'priority-high',     label: 'High'   },
  medium: { cssClass: 'priority-medium',   label: 'Medium' },
  low:    { cssClass: 'priority-low',      label: 'Low'    },
};

const PRIORITY_ORDER: Todo['priority'][] = ['urgent', 'high', 'medium', 'low'];

export default function TasksPage() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDescription, setNewDescription] = useState('');
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([todosApi.getTodos(), cardsApi.getCards({})])
      .then(([todosData, cardsData]) => {
        setTodos(todosData);
        setCards(cardsData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const cardMap = new Map(cards.map((c) => [c.id, c]));

  const activeTodos = todos.filter((t) => t.status === 'active');
  const completedTodos = todos
    .filter((t) => t.status === 'completed')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const handleToggle = async (todo: Todo) => {
    const newStatus = todo.status === 'active' ? 'completed' : 'active';
    try {
      const updated = await todosApi.updateTodo(todo.id, { status: newStatus });
      setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      console.error('Failed to toggle todo:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await todosApi.deleteTodo(id);
      setTodos((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error('Failed to delete todo:', err);
    }
  };

  const handleAddTodo = async () => {
    const trimmed = newDescription.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      const created = await todosApi.createTodo({ description: trimmed, priority: 'medium' });
      setTodos((prev) => [created, ...prev]);
      setNewDescription('');
      inputRef.current?.focus();
    } catch (err) {
      console.error('Failed to create todo:', err);
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="skeleton h-12 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Heading */}
      <div className="flex items-center gap-2">
        <CheckSquare size={22} className="text-primary-600" />
        <h1 className="text-xl font-bold text-gray-900">Tasks</h1>
        <span className="text-sm text-gray-400 ml-1">
          {activeTodos.length} active · {completedTodos.length} completed
        </span>
      </div>

      {/* Add task */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddTodo()}
          placeholder="Add a task..."
          className="input-field flex-1 text-sm"
          disabled={adding}
        />
        <button
          onClick={handleAddTodo}
          disabled={adding || !newDescription.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={15} />
          Add
        </button>
      </div>

      {/* Active section */}
      {activeTodos.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Active</h2>
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {PRIORITY_ORDER.map((priority) => {
              const group = activeTodos.filter((t) => t.priority === priority);
              if (group.length === 0) return null;
              return (
                <div key={priority}>
                  <div className="px-4 py-1.5 bg-gray-50 flex items-center gap-2">
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${TODO_PRIORITY_CONFIG[priority].cssClass}`}>
                      {TODO_PRIORITY_CONFIG[priority].label}
                    </span>
                  </div>
                  {group.map((todo) => (
                    <TodoRow
                      key={todo.id}
                      todo={todo}
                      linkedCard={todo.cardId ? cardMap.get(todo.cardId) : undefined}
                      onToggle={handleToggle}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Completed section */}
      {completedTodos.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Completed</h2>
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {completedTodos.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                linkedCard={todo.cardId ? cardMap.get(todo.cardId) : undefined}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </section>
      )}

      {todos.length === 0 && (
        <div className="py-16 text-center text-gray-400">
          <CheckSquare size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No tasks yet. Add one above.</p>
        </div>
      )}
    </div>
  );
}

interface TodoRowProps {
  todo: Todo;
  linkedCard?: Card;
  onToggle: (todo: Todo) => void;
  onDelete: (id: string) => void;
}

function TodoRow({ todo, linkedCard, onToggle, onDelete }: TodoRowProps) {
  const isCompleted = todo.status === 'completed';
  const config = TODO_PRIORITY_CONFIG[todo.priority];

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 group">
      <input
        type="checkbox"
        checked={isCompleted}
        onChange={() => onToggle(todo)}
        className="w-4 h-4 shrink-0 cursor-pointer accent-primary-600"
        aria-label={isCompleted ? 'Mark as active' : 'Mark as complete'}
      />
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${isCompleted ? 'line-through text-gray-400' : 'text-gray-800'}`}>
          {todo.description}
        </span>
        {linkedCard && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">
            {linkedCard.companyName} — {linkedCard.roleTitle}
          </p>
        )}
      </div>
      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${config.cssClass}`}>
        {config.label}
      </span>
      <span className="text-xs text-gray-400 shrink-0 hidden sm:block">
        {new Date(todo.createdAt).toLocaleDateString()}
      </span>
      <button
        onClick={() => onDelete(todo.id)}
        className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition opacity-0 group-hover:opacity-100 shrink-0"
        aria-label="Delete task"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
