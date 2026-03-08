import { useState, type FormEvent } from 'react';
import { stagesApi } from '@/services/api';
import type { Stage } from '@/types';
import { X } from 'lucide-react';

interface StageFormProps {
  stage?: Stage; // if provided, we're renaming; otherwise creating
  totalStages: number; // used as default position for new stages
  onClose: () => void;
  onSaved: (stage: Stage) => void;
}

export default function StageForm({ stage, totalStages, onClose, onSaved }: StageFormProps) {
  const [name, setName] = useState(stage?.name || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isEdit = !!stage;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setSaving(true);
    setError('');

    try {
      let saved: Stage;
      if (isEdit) {
        saved = await stagesApi.updateStage(stage.id, { name: trimmed });
      } else {
        saved = await stagesApi.createStage(trimmed, totalStages);
      }
      onSaved(saved);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to save stage');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEdit ? 'Rename Stage' : 'New Stage'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 text-gray-400">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div>
            <label htmlFor="stage-name" className="block text-sm font-medium text-gray-700 mb-1">
              Stage Name
            </label>
            <input
              id="stage-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
              placeholder="e.g. Phone Screen"
              autoFocus
              required
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition"
            >
              {saving ? 'Saving...' : isEdit ? 'Rename' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
