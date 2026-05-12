import { useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';
import type { Notification } from '@/types';
import NotificationItem from './NotificationItem';

interface NotificationPanelProps {
  notifications: Notification[];
  unreadCount: number;
  onRead: (id: string) => void;
  onReadAll: () => void;
  onClose: () => void;
}

export default function NotificationPanel({
  notifications,
  unreadCount,
  onRead,
  onReadAll,
  onClose,
}: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full mt-1 w-80 rounded-lg border border-gray-200 bg-white shadow-lg z-50 flex flex-col"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-900">Notifications</span>
        <button
          onClick={onReadAll}
          disabled={unreadCount === 0}
          className="text-xs text-primary-600 hover:text-primary-800 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          Mark all as read
        </button>
      </div>

      <div className="overflow-y-auto max-h-96 divide-y divide-gray-100">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Bell size={32} className="mb-2" />
            <p className="text-sm">No notifications</p>
          </div>
        ) : (
          notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onRead={onRead}
            />
          ))
        )}
      </div>
    </div>
  );
}
