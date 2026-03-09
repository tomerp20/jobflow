import { useState, type FormEvent } from 'react';
import { cardsApi } from '@/services/api';
import type { Card, Stage } from '@/types';
import { X, Plus } from 'lucide-react';

function toLocalDateStr(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface CardFormProps {
  stageId: string;
  stages: Stage[];
  onClose: () => void;
  onCreated: (card: Card) => void;
}

export default function CardForm({ stageId, stages, onClose, onCreated }: CardFormProps) {
  const [companyName, setCompanyName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [applicationUrl, setApplicationUrl] = useState('');
  const [careersUrl, setCareersUrl] = useState('');
  const [source, setSource] = useState('');
  const [location, setLocation] = useState('');
  const [workMode, setWorkMode] = useState<'remote' | 'hybrid' | 'onsite'>('remote');
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [salaryCurrency, setSalaryCurrency] = useState('USD');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [notes, setNotes] = useState('');
  const [dateApplied, setDateApplied] = useState(() => toLocalDateStr(new Date()));
  const [nextFollowupDate, setNextFollowupDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return toLocalDateStr(d);
  });
  const [recruiterName, setRecruiterName] = useState('');
  const [recruiterEmail, setRecruiterEmail] = useState('');
  const [techStackInput, setTechStackInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [interestLevel, setInterestLevel] = useState(3);
  const [selectedStageId, setSelectedStageId] = useState(stageId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() || !roleTitle.trim()) {
      setError('Company name and role title are required');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const techStack = techStackInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const tags = tagsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const card = await cardsApi.createCard({
        stageId: selectedStageId,
        companyName: companyName.trim(),
        roleTitle: roleTitle.trim(),
        applicationUrl: applicationUrl || undefined,
        careersUrl: careersUrl || undefined,
        source: source || undefined,
        location: location || undefined,
        workMode,
        salaryMin: salaryMin ? Number(salaryMin) : undefined,
        salaryMax: salaryMax ? Number(salaryMax) : undefined,
        salaryCurrency,
        priority,
        notes: notes || undefined,
        dateApplied: dateApplied || undefined,
        nextFollowupDate: nextFollowupDate || undefined,
        recruiterName: recruiterName || undefined,
        recruiterEmail: recruiterEmail || undefined,
        techStack,
        tags,
        interestLevel,
      });
      onCreated(card);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create card');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-xl mx-4 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
          <h2 className="text-lg font-semibold text-gray-900">New Application</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 text-gray-400">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {/* Stage */}
          <div>
            <label className="label-text">Stage</label>
            <select
              value={selectedStageId}
              onChange={(e) => setSelectedStageId(e.target.value)}
              className="input-field"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Company & Role */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-text">
                Company Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="input-field"
                placeholder="Acme Inc."
              />
            </div>
            <div>
              <label className="label-text">
                Role Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                className="input-field"
                placeholder="Senior Frontend Engineer"
              />
            </div>
          </div>

          {/* URLs */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-text">Application URL</label>
              <input
                type="url"
                value={applicationUrl}
                onChange={(e) => setApplicationUrl(e.target.value)}
                className="input-field"
                placeholder="https://..."
              />
            </div>
            <div>
              <label className="label-text">Careers URL</label>
              <input
                type="url"
                value={careersUrl}
                onChange={(e) => setCareersUrl(e.target.value)}
                className="input-field"
                placeholder="https://..."
              />
            </div>
          </div>

          {/* Source & Location */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-text">Source</label>
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="input-field"
                placeholder="LinkedIn, Referral"
              />
            </div>
            <div>
              <label className="label-text">Location</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="input-field"
                placeholder="San Francisco, CA"
              />
            </div>
          </div>

          {/* Work Mode */}
          <div>
            <label className="label-text">Work Mode</label>
            <div className="flex gap-2">
              {(['remote', 'hybrid', 'onsite'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setWorkMode(mode)}
                  className={`flex-1 rounded-lg border py-2 text-sm font-medium capitalize transition ${
                    workMode === mode
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="label-text">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
              className="input-field"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          {/* Salary */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label-text">Salary Min</label>
              <input
                type="number"
                value={salaryMin}
                onChange={(e) => setSalaryMin(e.target.value)}
                className="input-field"
                placeholder="80000"
              />
            </div>
            <div>
              <label className="label-text">Salary Max</label>
              <input
                type="number"
                value={salaryMax}
                onChange={(e) => setSalaryMax(e.target.value)}
                className="input-field"
                placeholder="120000"
              />
            </div>
            <div>
              <label className="label-text">Currency</label>
              <input
                type="text"
                value={salaryCurrency}
                onChange={(e) => setSalaryCurrency(e.target.value)}
                className="input-field"
                placeholder="USD"
              />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-text">Date Applied</label>
              <input
                type="date"
                value={dateApplied}
                onChange={(e) => setDateApplied(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="label-text">Next Follow-up</label>
              <input
                type="date"
                value={nextFollowupDate}
                onChange={(e) => setNextFollowupDate(e.target.value)}
                className="input-field"
              />
            </div>
          </div>

          {/* Recruiter */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-text">Recruiter Name</label>
              <input
                type="text"
                value={recruiterName}
                onChange={(e) => setRecruiterName(e.target.value)}
                className="input-field"
                placeholder="Jane Smith"
              />
            </div>
            <div>
              <label className="label-text">Recruiter Email</label>
              <input
                type="email"
                value={recruiterEmail}
                onChange={(e) => setRecruiterEmail(e.target.value)}
                className="input-field"
                placeholder="jane@company.com"
              />
            </div>
          </div>

          {/* Interest Level */}
          <div>
            <label className="label-text">Interest Level: {interestLevel}/5</label>
            <input
              type="range"
              min="1"
              max="5"
              value={interestLevel}
              onChange={(e) => setInterestLevel(Number(e.target.value))}
              className="w-full accent-primary-600"
            />
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
                placeholder="React, TypeScript, Node.js"
              />
            </div>
            <div>
              <label className="label-text">Tags (comma separated)</label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="input-field"
                placeholder="startup, remote-first"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="label-text">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="input-field resize-none"
              placeholder="Any initial notes..."
            />
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition disabled:opacity-50"
            >
              <Plus size={14} />
              {submitting ? 'Creating...' : 'Create Card'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
