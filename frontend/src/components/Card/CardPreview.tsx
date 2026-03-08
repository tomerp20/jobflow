import type { Card } from '@/types';
import { MapPin, Monitor, Home, Building2, Clock, CalendarClock, DollarSign } from 'lucide-react';
import { formatDistanceToNow, parseISO, differenceInDays } from 'date-fns';

const priorityConfig: Record<string, { class: string; label: string }> = {
  critical: { class: 'priority-critical', label: 'Critical' },
  high: { class: 'priority-high', label: 'High' },
  medium: { class: 'priority-medium', label: 'Medium' },
  low: { class: 'priority-low', label: 'Low' },
};

const workModeConfig: Record<string, { class: string; icon: typeof Monitor }> = {
  remote: { class: 'workmode-remote', icon: Home },
  hybrid: { class: 'workmode-hybrid', icon: Building2 },
  onsite: { class: 'workmode-onsite', icon: Monitor },
};

interface CardPreviewProps {
  card: Card;
}

export default function CardPreview({ card }: CardPreviewProps) {
  const priority = priorityConfig[card.priority];
  const workMode = workModeConfig[card.workMode];
  const WorkModeIcon = workMode.icon;

  const daysSinceInteraction = card.lastInteractionDate
    ? differenceInDays(new Date(), parseISO(card.lastInteractionDate))
    : null;

  const formatSalary = (min?: number, max?: number, currency?: string) => {
    if (!min && !max) return null;
    const fmt = (n: number) => {
      if (n >= 1000) return `${Math.round(n / 1000)}k`;
      return n.toString();
    };
    const cur = currency || 'USD';
    if (min && max) return `${cur} ${fmt(min)}-${fmt(max)}`;
    if (min) return `${cur} ${fmt(min)}+`;
    return `${cur} up to ${fmt(max!)}`;
  };

  const salary = formatSalary(card.salaryMin, card.salaryMax, card.salaryCurrency);

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-start gap-2">
        {card.companyIconUrl && (
          <img src={card.companyIconUrl} alt="" className="w-5 h-5 rounded mt-0.5 shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        )}
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-gray-900 leading-tight">{card.companyName}</h4>
          <p className="text-xs text-gray-500 mt-0.5 leading-tight">{card.roleTitle}</p>
        </div>
      </div>

      {/* Badges row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${priority.class}`}>
          {priority.label}
        </span>
        <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${workMode.class}`}>
          <WorkModeIcon size={10} />
          {card.workMode}
        </span>
        {card.location && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
            <MapPin size={10} />
            {card.location}
          </span>
        )}
      </div>

      {/* Salary */}
      {salary && (
        <div className="flex items-center gap-1 text-[11px] text-gray-500">
          <DollarSign size={11} className="text-gray-400" />
          {salary}
        </div>
      )}

      {/* Footer info */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-100">
        <div className="flex items-center gap-2">
          {daysSinceInteraction !== null && (
            <span
              className={`flex items-center gap-0.5 text-[10px] ${
                daysSinceInteraction > 7 ? 'text-red-500' : 'text-gray-400'
              }`}
            >
              <Clock size={10} />
              {daysSinceInteraction}d ago
            </span>
          )}
          {card.nextFollowupDate && (
            <span className="flex items-center gap-0.5 text-[10px] text-amber-500">
              <CalendarClock size={10} />
              {formatDistanceToNow(parseISO(card.nextFollowupDate), { addSuffix: false })}
            </span>
          )}
        </div>
      </div>

      {/* Tech stack tags */}
      {card.techStack.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {card.techStack.slice(0, 3).map((tech) => (
            <span
              key={tech}
              className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600"
            >
              {tech}
            </span>
          ))}
          {card.techStack.length > 3 && (
            <span className="text-[10px] text-gray-400">+{card.techStack.length - 3}</span>
          )}
        </div>
      )}
    </div>
  );
}
