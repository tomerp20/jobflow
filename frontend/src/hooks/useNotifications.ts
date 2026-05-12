import { useEffect, useState, useCallback } from 'react';
import type { Notification } from '@/types';
import { notificationService } from '@/services/notificationService';
import { API_BASE_URL } from '@/services/api';

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    notificationService.fetchNotifications().then(setNotifications).catch(() => {});
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const es = new EventSource(`${API_BASE_URL}/events?token=${encodeURIComponent(token)}`);

    es.addEventListener('notification', async () => {
      try {
        const all = await notificationService.fetchNotifications();
        setNotifications(all);
      } catch (err) {
        console.error('[useNotifications] Failed to fetch notification:', err);
      }
    });

    es.onerror = (err) => {
      console.error('[useNotifications] SSE connection error:', err);
      const currentToken = localStorage.getItem('accessToken');
      if (currentToken && currentToken !== token) {
        es.close();
      }
    };

    return () => {
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unreadCount = notifications.filter((n) => n.readAt === null).length;

  const markRead = useCallback(async (id: string) => {
    const prev = notifications;
    setNotifications((ns) =>
      ns.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
    );
    try {
      await notificationService.markRead(id);
    } catch (err) {
      console.error('[useNotifications] Failed to mark read:', err);
      setNotifications(prev);
    }
  }, [notifications]);

  const markAllRead = useCallback(async () => {
    const prev = notifications;
    const now = new Date().toISOString();
    setNotifications((ns) =>
      ns.map((n) => (n.readAt === null ? { ...n, readAt: now } : n))
    );
    try {
      await notificationService.markAllRead();
    } catch (err) {
      console.error('[useNotifications] Failed to mark all read:', err);
      setNotifications(prev);
    }
  }, [notifications]);

  return { notifications, unreadCount, markRead, markAllRead };
}
