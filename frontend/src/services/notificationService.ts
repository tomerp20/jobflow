import api from './api';
import { snakeToCamel } from '@/utils/caseTransform';
import type { Notification } from '@/types';

export const notificationService = {
  async fetchNotifications(): Promise<Notification[]> {
    const res = await api.get('/notifications');
    return snakeToCamel(res.data.data) as Notification[];
  },

  async markRead(id: string): Promise<void> {
    await api.patch(`/notifications/${id}/read`);
  },

  async markAllRead(): Promise<void> {
    await api.patch('/notifications/read-all');
  },
};
