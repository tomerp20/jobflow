import type { Notification } from '@/types';

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

interface NotificationItemProps {
  notification: Notification;
  onRead: (id: string) => void;
}

export default function NotificationItem({ notification, onRead }: NotificationItemProps) {
  const isUnread = notification.readAt === null;

  const content = (
    <div className="min-w-0 flex-1 text-left">
      <p className={`text-sm ${isUnread ? 'font-semibold text-gray-900' : 'font-normal text-gray-500'}`}>
        {notification.title}
      </p>
      <p className={`text-sm mt-0.5 ${isUnread ? 'text-gray-700' : 'text-gray-400'}`}>
        {notification.body}
      </p>
      <p className="text-xs text-gray-400 mt-1">{timeAgo(notification.createdAt)}</p>
    </div>
  );

  if (isUnread) {
    return (
      <button
        onClick={() => onRead(notification.id)}
        className="flex w-full gap-3 px-4 py-3 border-l-4 border-primary-500 bg-primary-50 hover:bg-primary-100 transition-colors"
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex gap-3 px-4 py-3 border-l-4 border-transparent bg-white">
      {content}
    </div>
  );
}
