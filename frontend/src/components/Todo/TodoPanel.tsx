import { useState, useRef, useCallback, type JSX } from 'react';
import { CheckSquare, ChevronDown, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Todo } from '@/types';
import { todosApi } from '@/services/api';
import TodoItem from './TodoItem';

// Thin wrapper that adds a drag handle to each TodoItem
function SortableTodoItem({
  todo,
  onToggleComplete,
  onUpdate,
  onDelete,
}: {
  todo: Todo;
  onToggleComplete: (updated: Todo) => void;
  onUpdate: (updated: Todo) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: todo.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex items-center gap-1"
    >
      <button
        className="p-1 cursor-grab text-gray-300 hover:text-gray-500 shrink-0 touch-none"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <div className="flex-1 min-w-0">
        <TodoItem
          todo={todo}
          onToggleComplete={onToggleComplete}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

export default function TodoPanel(): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [hasFetched, setHasFetched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newDescription, setNewDescription] = useState('');
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeTodos = todos.filter((t) => t.status === 'active');

  // Register both pointer and keyboard sensors so drag-to-reorder is
  // accessible to keyboard-only users (WCAG 2.1 SC 2.1.1)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = activeTodos.findIndex((t) => t.id === active.id);
    const newIndex = activeTodos.findIndex((t) => t.id === over.id);
    const reordered = arrayMove(activeTodos, oldIndex, newIndex);

    // Optimistic update — merge reordered active todos back with non-active ones
    setTodos((prev) => {
      const nonActive = prev.filter((t) => t.status !== 'active');
      return [...reordered, ...nonActive];
    });

    try {
      const updated = await todosApi.reorderTodos(reordered.map((t) => t.id));
      // Replace with authoritative state from backend
      setTodos((prev) => {
        const nonActive = prev.filter((t) => t.status !== 'active');
        return [...updated, ...nonActive];
      });
    } catch (err) {
      console.error('Failed to reorder todos:', err);
      // Rollback: re-fetch to restore server order
      todosApi
        .getTodos({ status: 'active' })
        .then((data) =>
          setTodos((prev) => {
            const nonActive = prev.filter((t) => t.status !== 'active');
            return [...data, ...nonActive];
          })
        )
        .catch((rollbackErr) => {
          console.error('Failed to roll back todo order after reorder failure:', rollbackErr);
        });
    }
  };

  // Stable callbacks so SortableTodoItem does not re-render on every parent render
  const handleTodoUpdate = useCallback(
    (updated: Todo) =>
      setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t))),
    []
  );

  const handleTodoDelete = useCallback(
    (id: string) => setTodos((prev) => prev.filter((t) => t.id !== id)),
    []
  );

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
          {(hasFetched || activeTodos.length > 0) && (
            <span
              className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full text-[11px] font-semibold px-1.5 ${
                activeTodos.length > 0
                  ? 'bg-primary-100 text-primary-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {activeTodos.length}
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
          overflowY: isOpen ? 'auto' : 'hidden',
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
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={activeTodos.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-0.5">
                  {activeTodos.map((todo) => (
                    <SortableTodoItem
                      key={todo.id}
                      todo={todo}
                      onToggleComplete={handleTodoUpdate}
                      onUpdate={handleTodoUpdate}
                      onDelete={handleTodoDelete}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>
    </div>
  );
}
