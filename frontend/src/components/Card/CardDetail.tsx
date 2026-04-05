import { useState, useEffect, useRef } from 'react';
import { cardsApi, todosApi } from '@/services/api';
import type { Card, CardActivity, Todo } from '@/types';
import {
  X,
  Trash2,
  Save,
  ExternalLink,
  Clock,
  MessageSquare,
  Send,
  AlertCircle,
  CheckSquare,
  Plus,
  Unlink,
  Link,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useAutoResize } from '@/hooks/useAutoResize';
import { TODO_PRIORITY_CONFIG, PRIORITY_ORDER } from '@/utils/todoPriority';

interface CardDetailProps {
  cardId: string;
  onClose: () => void;
  onUpdated: (card: Card) => void;
  onDeleted: (cardId: string) => void;
}

export default function CardDetail({ cardId, onClose, onUpdated, onDeleted }: CardDetailProps) {
  const [card, setCard] = useState<Card | null>(null);
  const [activities, setActivities] = useState<CardActivity[]>([]);
  const [linkedTodos, setLinkedTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editData, setEditData] = useState<Partial<Card>>({});
  const [noteText, setNoteText] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [techStackInput, setTechStackInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [newTodoDescription, setNewTodoDescription] = useState('');
  const [addingTodo, setAddingTodo] = useState(false);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [unlinkedTodos, setUnlinkedTodos] = useState<Todo[]>([]);
  const todoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([cardsApi.getCard(cardId), todosApi.getTodos({ cardId })])
      .then(([{ card: c, activities: a }, todos]) => {
        setCard(c);
        setActivities(a);
        setEditData(c);
        setTechStackInput(c.techStack.join(', '));
        setTagsInput(c.tags.join(', '));
        setLinkedTodos(todos);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [cardId]);

  const handleAddLinkedTodo = async () => {
    const trimmed = newTodoDescription.trim();
    if (!trimmed) return;
    setAddingTodo(true);
    try {
      const created = await todosApi.createTodo({ description: trimmed, priority: 'medium', cardId });
      setLinkedTodos((prev) => [created, ...prev]);
      setNewTodoDescription('');
      todoInputRef.current?.focus();
    } catch (err) {
      console.error('Failed to create linked todo:', err);
    } finally {
      setAddingTodo(false);
    }
  };

  const handleToggleTodo = async (todo: Todo) => {
    const newStatus = todo.status === 'active' ? 'completed' : 'active';
    try {
      const updated = await todosApi.updateTodo(todo.id, { status: newStatus });
      setLinkedTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      console.error('Failed to toggle todo:', err);
    }
  };

  const handleTodoPriorityChange = async (todo: Todo, priority: Todo['priority']) => {
    try {
      const updated = await todosApi.updateTodo(todo.id, { priority });
      setLinkedTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      console.error('Failed to update todo priority:', err);
    }
  };

  const handleUnlinkTodo = async (todo: Todo) => {
    try {
      await todosApi.updateTodo(todo.id, { cardId: null });
      setLinkedTodos((prev) => prev.filter((t) => t.id !== todo.id));
    } catch (err) {
      console.error('Failed to unlink todo:', err);
    }
  };

  const handleOpenLinkPicker = async () => {
    setShowLinkPicker(true);
    setLinkSearch('');
    try {
      const all = await todosApi.getTodos({ status: 'active' });
      setUnlinkedTodos(all.filter((t) => t.cardId === null));
    } catch (err) {
      console.error('Failed to fetch unlinked todos:', err);
    }
  };

  const handleLinkExisting = async (todo: Todo) => {
    try {
      const updated = await todosApi.updateTodo(todo.id, { cardId });
      setLinkedTodos((prev) => [updated, ...prev]);
      setUnlinkedTodos((prev) => prev.filter((t) => t.id !== todo.id));
      setShowLinkPicker(false);
    } catch (err) {
      console.error('Failed to link todo:', err);
    }
  };

  const handleSave = async () => {
    if (!card) return;
    setSaving(true);
    try {
      const techStack = techStackInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const tags = tagsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const updated = await cardsApi.updateCard(card.id, { ...editData, techStack, tags });
      setCard(updated);
      onUpdated(updated);
    } catch (err) {
      console.error('Failed to save card:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!card) return;
    try {
      await cardsApi.deleteCard(card.id);
      onDeleted(card.id);
    } catch (err) {
      console.error('Failed to delete card:', err);
    }
  };

  const handleAddNote = async () => {
    if (!card || !noteText.trim()) return;
    try {
      const activity = await cardsApi.addNote(card.id, noteText.trim());
      setActivities((prev) => [activity, ...prev]);
      setNoteText('');
    } catch (err) {
      console.error('Failed to add note:', err);
    }
  };

  const notesRef = useAutoResize(editData.notes || '');

  const updateField = (field: string, value: any) => {
    setEditData((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6" onClick={(e) => e.stopPropagation()}>
          <div className="space-y-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="skeleton h-10 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!card) return null;

  const activeTodoCount = linkedTodos.filter((t) => t.status === 'active').length;
  const filteredUnlinked = unlinkedTodos.filter((t) =>
    t.description.toLowerCase().includes(linkSearch.toLowerCase())
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10 rounded-t-xl">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {card.companyIconUrl && (
              <img src={card.companyIconUrl} alt="" className="w-6 h-6 rounded shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
            <h2 className="text-lg font-semibold text-gray-900 truncate">
              {card.companyName} - {card.roleTitle}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 text-gray-400">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Company & Role */}
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="Company Name"
              value={editData.companyName || ''}
              onChange={(v) => updateField('companyName', v)}
            />
            <InputField
              label="Role Title"
              value={editData.roleTitle || ''}
              onChange={(v) => updateField('roleTitle', v)}
            />
          </div>

          {/* URLs */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-text">Application URL</label>
              <div className="flex gap-1">
                <input
                  type="url"
                  value={editData.applicationUrl || ''}
                  onChange={(e) => updateField('applicationUrl', e.target.value)}
                  className="input-field flex-1"
                  placeholder="https://..."
                />
                {editData.applicationUrl && (
                  <a
                    href={editData.applicationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg border border-gray-300 text-gray-400 hover:text-primary-600"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            </div>
            <div>
              <label className="label-text">Careers URL</label>
              <div className="flex gap-1">
                <input
                  type="url"
                  value={editData.careersUrl || ''}
                  onChange={(e) => updateField('careersUrl', e.target.value)}
                  className="input-field flex-1"
                  placeholder="https://..."
                />
                {editData.careersUrl && (
                  <a
                    href={editData.careersUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg border border-gray-300 text-gray-400 hover:text-primary-600"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Source & Location */}
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="Source"
              value={editData.source || ''}
              onChange={(v) => updateField('source', v)}
              placeholder="LinkedIn, Referral, etc."
            />
            <InputField
              label="Location"
              value={editData.location || ''}
              onChange={(v) => updateField('location', v)}
              placeholder="City, State"
            />
          </div>

          {/* Work Mode & Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-text">Work Mode</label>
              <div className="flex gap-2">
                {(['remote', 'hybrid', 'onsite'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => updateField('workMode', mode)}
                    className={`flex-1 rounded-lg border py-2 text-xs font-medium capitalize transition ${
                      editData.workMode === mode
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label-text">Priority</label>
              <select
                value={editData.priority || 'medium'}
                onChange={(e) => updateField('priority', e.target.value)}
                className="input-field"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          {/* Salary */}
          <div className="grid grid-cols-3 gap-4">
            <InputField
              label="Salary Min"
              type="number"
              value={editData.salaryMin?.toString() || ''}
              onChange={(v) => updateField('salaryMin', v ? Number(v) : undefined)}
            />
            <InputField
              label="Salary Max"
              type="number"
              value={editData.salaryMax?.toString() || ''}
              onChange={(v) => updateField('salaryMax', v ? Number(v) : undefined)}
            />
            <InputField
              label="Currency"
              value={editData.salaryCurrency || 'USD'}
              onChange={(v) => updateField('salaryCurrency', v)}
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-4">
            <InputField
              label="Date Applied"
              type="date"
              value={editData.dateApplied?.split('T')[0] || ''}
              onChange={(v) => updateField('dateApplied', v || undefined)}
            />
            <InputField
              label="Last Interaction"
              type="date"
              value={editData.lastInteractionDate?.split('T')[0] || ''}
              onChange={(v) => updateField('lastInteractionDate', v || undefined)}
            />
            <InputField
              label="Next Follow-up"
              type="date"
              value={editData.nextFollowupDate?.split('T')[0] || ''}
              onChange={(v) => updateField('nextFollowupDate', v || undefined)}
            />
          </div>

          {/* Recruiter */}
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="Recruiter Name"
              value={editData.recruiterName || ''}
              onChange={(v) => updateField('recruiterName', v)}
            />
            <InputField
              label="Recruiter Email"
              type="email"
              value={editData.recruiterEmail || ''}
              onChange={(v) => updateField('recruiterEmail', v)}
            />
          </div>

          {/* Interest Level */}
          <div>
            <label className="label-text">Interest Level: {editData.interestLevel ?? 3}/5</label>
            <input
              type="range"
              min="1"
              max="5"
              value={editData.interestLevel ?? 3}
              onChange={(e) => updateField('interestLevel', Number(e.target.value))}
              className="w-full accent-primary-600"
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>

          {/* Tech Stack & Tags */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-text">Tech Stack (comma separated)</label>
              <input
                type="text"
                value={techStackInput}
                onChange={(e) => setTechStackInput(e.target.value)}
                className="input-field"
                placeholder="React, Node.js, PostgreSQL"
              />
            </div>
            <div>
              <label className="label-text">Tags (comma separated)</label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="input-field"
                placeholder="startup, series-b, interesting"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="label-text">Notes</label>
            <textarea
              ref={notesRef}
              value={editData.notes || ''}
              onChange={(e) => updateField('notes', e.target.value)}
              className="input-field overflow-hidden min-h-[4.5rem]"
              placeholder="General notes about this application..."
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-200">
            <div>
              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle size={14} /> Are you sure?
                  </span>
                  <button
                    onClick={handleDelete}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition disabled:opacity-50"
              >
                <Save size={14} />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          {/* Activity Timeline */}
          <div className="border-t border-gray-200 pt-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <MessageSquare size={14} />
              Activity
            </h3>

            {/* Add Note */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                className="input-field flex-1"
                placeholder="Add a note..."
              />
              <button
                onClick={handleAddNote}
                disabled={!noteText.trim()}
                className="rounded-lg bg-gray-100 px-3 text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition disabled:opacity-40"
              >
                <Send size={14} />
              </button>
            </div>

            {/* Timeline */}
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {activities.map((activity) => (
                <div key={activity.id} className="flex gap-3 text-sm">
                  <div className="mt-1.5 h-2 w-2 rounded-full bg-gray-300 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-700">
                      {activity.note ? (
                        <span>{activity.note}</span>
                      ) : (
                        <span>
                          <span className="font-medium">{activity.action}</span>
                          {activity.fieldChanged && (
                            <span className="text-gray-500">
                              {' '}
                              {activity.fieldChanged}
                              {activity.oldValue && (
                                <>
                                  {' '}
                                  from <span className="text-gray-600">{activity.oldValue}</span>
                                </>
                              )}
                              {activity.newValue && (
                                <>
                                  {' '}
                                  to <span className="text-gray-600">{activity.newValue}</span>
                                </>
                              )}
                            </span>
                          )}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      <Clock size={10} className="inline mr-0.5" />
                      {format(parseISO(activity.createdAt), 'MMM d, yyyy h:mm a')}
                    </p>
                  </div>
                </div>
              ))}
              {activities.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">No activity yet</p>
              )}
            </div>
          </div>

          {/* Linked Tasks */}
          <div className="border-t border-gray-200 pt-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <CheckSquare size={14} />
              Tasks
              {activeTodoCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full bg-primary-100 text-primary-700 text-[11px] font-semibold px-1.5">
                  {activeTodoCount}
                </span>
              )}
            </h3>

            {/* Add new task */}
            <div className="flex gap-2 mb-2">
              <input
                ref={todoInputRef}
                type="text"
                value={newTodoDescription}
                onChange={(e) => setNewTodoDescription(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddLinkedTodo()}
                placeholder="Add a task for this card..."
                className="input-field flex-1 text-sm"
                disabled={addingTodo}
              />
              <button
                onClick={handleAddLinkedTodo}
                disabled={addingTodo || !newTodoDescription.trim()}
                className="rounded-lg bg-gray-100 px-3 text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition disabled:opacity-40"
                aria-label="Add task"
              >
                <Plus size={14} />
              </button>
            </div>

            {/* Link existing task */}
            <div className="mb-3 relative">
              {!showLinkPicker ? (
                <button
                  onClick={handleOpenLinkPicker}
                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-primary-600 transition"
                >
                  <Link size={11} />
                  Link existing task
                </button>
              ) : (
                <div className="border border-gray-200 rounded-lg bg-white shadow-sm">
                  <div className="flex items-center gap-2 px-2 py-1.5 border-b border-gray-100">
                    <input
                      autoFocus
                      type="text"
                      value={linkSearch}
                      onChange={(e) => setLinkSearch(e.target.value)}
                      placeholder="Search tasks..."
                      className="flex-1 text-sm outline-none text-gray-700"
                    />
                    <button
                      onClick={() => setShowLinkPicker(false)}
                      className="text-gray-400 hover:text-gray-600 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    {filteredUnlinked.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-3">No unlinked tasks found</p>
                    ) : (
                      filteredUnlinked.map((todo) => (
                        <button
                          key={todo.id}
                          onClick={() => handleLinkExisting(todo)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 transition"
                        >
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${TODO_PRIORITY_CONFIG[todo.priority].cssClass}`}>
                            {TODO_PRIORITY_CONFIG[todo.priority].label}
                          </span>
                          <span className="truncate text-gray-700">{todo.description}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Todo list */}
            <div className="space-y-1">
              {linkedTodos.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-3">No tasks linked to this card.</p>
              )}
              {linkedTodos.map((todo) => (
                <div
                  key={todo.id}
                  className={`flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 group ${
                    todo.status === 'completed' ? 'opacity-60' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={todo.status === 'completed'}
                    onChange={() => handleToggleTodo(todo)}
                    className="w-4 h-4 shrink-0 cursor-pointer accent-primary-600"
                    aria-label={todo.status === 'completed' ? 'Mark as active' : 'Mark as complete'}
                  />
                  <select
                    value={todo.priority}
                    onChange={(e) => handleTodoPriorityChange(todo, e.target.value as Todo['priority'])}
                    disabled={todo.status === 'completed'}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0 cursor-pointer border-0 outline-none appearance-none ${TODO_PRIORITY_CONFIG[todo.priority].cssClass}`}
                    aria-label="Task priority"
                  >
                    {PRIORITY_ORDER.map((p) => (
                      <option key={p} value={p}>{TODO_PRIORITY_CONFIG[p].label}</option>
                    ))}
                  </select>
                  <span
                    className={`flex-1 text-sm min-w-0 truncate ${
                      todo.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-800'
                    }`}
                    title={todo.description}
                  >
                    {todo.description}
                  </span>
                  <button
                    onClick={() => handleUnlinkTodo(todo)}
                    className="p-1 rounded text-gray-300 hover:text-amber-500 hover:bg-amber-50 transition opacity-0 group-hover:opacity-100 shrink-0"
                    aria-label="Unlink task from card"
                    title="Unlink from card"
                  >
                    <Unlink size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label-text">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field"
        placeholder={placeholder}
      />
    </div>
  );
}
