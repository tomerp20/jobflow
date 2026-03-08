import { useState, useEffect } from 'react';
import { remindersApi } from '@/services/api';
import type { Card } from '@/types';
import { Bell, ChevronDown, ChevronUp, Calendar } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';

export default function ReminderBanner() {
  const [reminders, setReminders] = useState<Card[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    remindersApi
      .getReminders()
      .then(setReminders)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded || reminders.length === 0) return null;

  return (
    <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2.5"
      >
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-amber-600" />
          <span className="text-sm font-medium text-amber-800">
            {reminders.length} upcoming follow-up{reminders.length !== 1 ? 's' : ''}
          </span>
        </div>
        {expanded ? (
          <ChevronUp size={16} className="text-amber-600" />
        ) : (
          <ChevronDown size={16} className="text-amber-600" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-amber-200 px-4 py-2 space-y-1.5">
          {reminders.map((card) => (
            <div
              key={card.id}
              className="flex items-center justify-between rounded-md bg-white/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{card.companyName}</p>
                <p className="text-xs text-gray-500 truncate">{card.roleTitle}</p>
              </div>
              {card.nextFollowupDate && (
                <span className="flex items-center gap-1 text-xs text-amber-700 shrink-0 ml-3">
                  <Calendar size={12} />
                  {formatDistanceToNow(parseISO(card.nextFollowupDate), { addSuffix: true })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
