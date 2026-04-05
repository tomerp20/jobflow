import { useState, useRef, type JSX } from 'react';
import { CheckSquare, ChevronDown } from 'lucide-react';
import type { Todo } from '@/types';
import { todosApi } from '@/services/api';
import TodoItem from './TodoItem';

export default function TodoPanel(): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [hasFetched, setHasFetched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newDescription, setNewDescription] = useState('');
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeTodos = todos.filter((t) => t.status === 'active');

  const handleToggle = async () => {
    const opening = !isOpen;
    setIsOpen(opening);

    if (opening && !hasFetched) {
      setLoading(true);
      try {
        const data = await todosApi.getTodos({ status: 'active' });
        setTodos(data);
        setHasFetched(true);
      } catch (err) {
        console.error('Failed to fetch todos:', err);
      } finally {
        setLoading(false);
      }
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

  const handleAddKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleAddTodo();
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2">
          <CheckSquare size={16} className="text-primary-600 shrink-0" />
          <span className="text-sm font-semibold text-gray-800">Tasks</span>
          {activeTodos.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full bg-primary-100 text-primary-700 text-[11px] font-semibold px-1.5">
              {activeTodos.length}
            </span>
          )}
          {hasFetched && activeTodos.length === 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full bg-gray-100 text-gray-500 text-[11px] font-semibold px-1.5">
              0
            </span>
          )}
        </div>
        <ChevronDown
          size={16}
          className="text-gray-400 shrink-0"
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.3s ease-in-out',
          }}
        />
      </button>

      {/* Collapsible body */}
      <div
        style={{
          maxHeight: isOpen ? '500px' : '0',
          opacity: isOpen ? 1 : 0,
          overflow: 'hidden',
          padding: isOpen ? undefined : '0',
          transition: 'max-height 0.3s ease-in-out, opacity 0.2s ease-in-out',
        }}
      >
        <div className="px-4 pb-4 pt-1 border-t border-gray-100">
          {/* Add task row */}
          <div className="flex gap-2 mb-3">
            <input
              ref={inputRef}
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              onKeyDown={handleAddKeyDown}
              placeholder="Add a task..."
              className="input-field flex-1 text-sm py-1.5"
              disabled={adding}
            />
            <button
              type="button"
              onClick={handleAddTodo}
              disabled={adding || !newDescription.trim()}
              className="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              Add
            </button>
          </div>

          {/* Todo list */}
          {loading ? (
            <div className="py-4 text-center text-sm text-gray-400">Loading tasks...</div>
          ) : activeTodos.length === 0 ? (
            <p className="py-3 text-center text-sm text-gray-400">No active tasks. Add one above.</p>
          ) : (
            <div className="space-y-0.5">
              {activeTodos.map((todo) => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  onToggleComplete={(updated) =>
                    setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
                  }
                  onUpdate={(updated) =>
                    setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
                  }
                  onDelete={(id) => setTodos((prev) => prev.filter((t) => t.id !== id))}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
