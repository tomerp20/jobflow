import type { Todo } from '@/types';

export const TODO_PRIORITY_CONFIG: Record<Todo['priority'], { cssClass: string; label: string }> = {
  urgent: { cssClass: 'priority-critical', label: 'Urgent' },
  high:   { cssClass: 'priority-high',     label: 'High'   },
  medium: { cssClass: 'priority-medium',   label: 'Medium' },
  low:    { cssClass: 'priority-low',      label: 'Low'    },
};

export const PRIORITY_ORDER: Todo['priority'][] = ['urgent', 'high', 'medium', 'low'];
