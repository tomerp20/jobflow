import { useState, useRef } from 'react';
import { Trash2, Unlink } from 'lucide-react';
import type { Todo } from '@/types';
import { todosApi } from '@/services/api';
import { TODO_PRIORITY_CONFIG, PRIORITY_ORDER } from '@/utils/todoPriority';

export interface TodoItemProps {
  todo: Todo;
  onToggleComplete: (updated: Todo) => void;
  onUpdate: (updated: Todo) => void;
  onDelete: (id: string) => void;
  onUnlink?: (updated: Todo) => void;
}

export default function TodoItem({ todo, onToggleComplete, onUpdate, onDelete, onUnlink }: TodoItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(todo.description);
  const [updatingPriority, setUpdatingPriority] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const priority = TODO_PRIORITY_CONFIG[todo.priority];
  const isCompleted = todo.status === 'completed';

  const handlePriorityChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPriority = e.target.value as Todo['priority'];
    setUpdatingPriority(true);
    try {
      const updated = await todosApi.updateTodo(todo.id, { priority: newPriority });
      onUpdate(updated);
    } catch (err) {
      console.error('Failed to update todo priority:', err);
    } finally {
      setUpdatingPriority(false);
    }
  };

  const handleToggleComplete = async () => {
    const newStatus = isCompleted ? 'active' : 'completed';
    try {
      const updated = await todosApi.updateTodo(todo.id, { status: newStatus });
      onToggleComplete(updated);
    } catch (err) {
      console.error('Failed to toggle todo status:', err);
    }
  };

  const handleDescriptionClick = () => {
    setEditValue(todo.description);
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleEditSave = async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === todo.description) {
      setIsEditing(false);
      setEditValue(todo.description);
      return;
    }
    try {
      const updated = await todosApi.updateTodo(todo.id, { description: trimmed });
      onUpdate(updated);
    } catch (err) {
      console.error('Failed to update todo description:', err);
    } finally {
      setIsEditing(false);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleEditSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(todo.description);
    }
  };

  const handleDelete = async () => {
    try {
      await todosApi.deleteTodo(todo.id);
      onDelete(todo.id);
    } catch (err) {
      console.error('Failed to delete todo:', err);
    }
  };

  const handleUnlink = async () => {
    if (!onUnlink) return;
    try {
      const updated = await todosApi.updateTodo(todo.id, { cardId: null });
      onUnlink(updated);
    } catch (err) {
      console.error('Failed to unlink todo:', err);
    }
  };

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 group">
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={isCompleted}
        onChange={handleToggleComplete}
        className="w-4 h-4 shrink-0 cursor-pointer accent-primary-600"
        aria-label={isCompleted ? 'Mark as active' : 'Mark as complete'}
      />

      {/* Priority dropdown */}
      <select
        value={todo.priority}
        onChange={handlePriorityChange}
        disabled={isCompleted || updatingPriority}
        className={`rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0 cursor-pointer border-0 outline-none appearance-none ${priority.cssClass}`}
        aria-label="Task priority"
      >
        {PRIORITY_ORDER.map((p) => (
          <option key={p} value={p}>{TODO_PRIORITY_CONFIG[p].label}</option>
        ))}
      </select>

      {/* Description */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleEditSave}
            onKeyDown={handleEditKeyDown}
            className="w-full text-sm border border-primary-400 rounded px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-primary-200"
          />
        ) : (
          <span
            onClick={handleDescriptionClick}
            className={`text-sm cursor-text block truncate ${
              isCompleted ? 'line-through opacity-60 text-gray-400' : 'text-gray-800'
            }`}
            title={todo.description}
          >
            {todo.description}
          </span>
        )}
      </div>

      {/* Linked-to-card "T" chip */}
      {todo.cardId !== null && !onUnlink && (
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold shrink-0"
          title="Linked to a card"
        >
          T
        </span>
      )}

      {/* Action buttons — CSS group-hover for zero re-renders */}
      <div className="flex items-center gap-1 shrink-0">
        {onUnlink && todo.cardId !== null && (
          <button
            onClick={handleUnlink}
            className="p-1 rounded text-gray-400 hover:text-amber-500 hover:bg-amber-50 transition opacity-0 group-hover:opacity-100"
            aria-label="Unlink from card"
            title="Unlink from card"
          >
            <Unlink size={13} />
          </button>
        )}
        <button
          onClick={handleDelete}
          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
          aria-label="Delete task"
          title="Delete task"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
