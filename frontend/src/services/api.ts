import axios from 'axios';
import type { Card, CardActivity, CardFilters, DashboardData, Stage, Todo, User } from '@/types';
import { snakeToCamel, camelToSnake } from '@/utils/caseTransform';

export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: attach auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: handle 401 with token refresh
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
        const newToken = data.accessToken;
        localStorage.setItem('accessToken', newToken);
        if (data.refreshToken) {
          localStorage.setItem('refreshToken', data.refreshToken);
        }
        processQueue(null, newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// Auth API — auth routes return { user, accessToken, refreshToken } directly (not wrapped in { data })
export const authApi = {
  signup: async (data: { name: string; email: string; password: string }) => {
    const res = await api.post<{ user: User; accessToken: string; refreshToken: string }>('/auth/signup', data);
    return res.data;
  },
  login: async (data: { email: string; password: string }) => {
    const res = await api.post<{ user: User; accessToken: string; refreshToken: string }>('/auth/login', data);
    return res.data;
  },
  logout: async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    await api.post('/auth/logout', { refreshToken });
  },
  refresh: async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    const res = await api.post<{ accessToken: string; refreshToken: string }>('/auth/refresh', { refreshToken });
    return res.data;
  },
  getMe: async () => {
    const res = await api.get<{ user: User }>('/auth/me');
    return res.data.user;
  },
};

// Stages API — backend returns { data: [...stages] }
export const stagesApi = {
  getStages: async (): Promise<Stage[]> => {
    const res = await api.get('/stages');
    return snakeToCamel(res.data.data) as Stage[];
  },
  createStage: async (name: string, position: number): Promise<Stage> => {
    const res = await api.post('/stages', { name, position });
    return snakeToCamel(res.data.data) as Stage;
  },
  updateStage: async (id: string, data: { name?: string; width?: number }): Promise<Stage> => {
    const res = await api.patch(`/stages/${id}`, data);
    return snakeToCamel(res.data.data) as Stage;
  },
  deleteStage: async (id: string): Promise<{ deletedStage: Stage; movedCardsTo: Stage; movedCardCount: number }> => {
    const res = await api.delete(`/stages/${id}`);
    return snakeToCamel(res.data.data) as { deletedStage: Stage; movedCardsTo: Stage; movedCardCount: number };
  },
  reorderStages: async (stageIds: string[]): Promise<Stage[]> => {
    const res = await api.put('/stages/reorder', { stageIds });
    return snakeToCamel(res.data.data) as Stage[];
  },
};

// Cards API — backend returns { data: ... } with snake_case fields
export const cardsApi = {
  getCards: async (filters?: CardFilters): Promise<Card[]> => {
    const params = new URLSearchParams();
    if (filters?.search) params.set('search', filters.search);
    if (filters?.stageId) params.set('stage', filters.stageId); // backend expects 'stage'
    if (filters?.priority) params.set('priority', filters.priority);
    if (filters?.workMode) params.set('workMode', filters.workMode);
    if (filters?.tags?.length) params.set('tags', filters.tags.join(','));
    const res = await api.get(`/cards?${params.toString()}`);
    return snakeToCamel(res.data.data) as Card[];
  },
  getCard: async (id: string): Promise<{ card: Card; activities: CardActivity[] }> => {
    const res = await api.get(`/cards/${id}`);
    const raw = snakeToCamel(res.data.data);
    // Backend returns card with activities embedded
    const { activities, ...card } = raw;
    return { card: card as Card, activities: (activities || []) as CardActivity[] };
  },
  createCard: async (data: Partial<Card>): Promise<Card> => {
    const payload = camelToSnake(data);
    const res = await api.post('/cards', payload);
    return snakeToCamel(res.data.data) as Card;
  },
  updateCard: async (id: string, data: Partial<Card>): Promise<Card> => {
    const payload = camelToSnake(data);
    const res = await api.patch(`/cards/${id}`, payload); // PATCH not PUT
    return snakeToCamel(res.data.data) as Card;
  },
  moveCard: async (id: string, stageId: string, position: number): Promise<Card> => {
    const res = await api.patch(`/cards/${id}/move`, { stageId, position });
    return snakeToCamel(res.data.data) as Card;
  },
  deleteCard: async (id: string): Promise<void> => {
    await api.delete(`/cards/${id}`);
  },
  addNote: async (id: string, note: string): Promise<CardActivity> => {
    const res = await api.post(`/cards/${id}/notes`, { note });
    return snakeToCamel(res.data.data) as CardActivity;
  },
};

// Todos API
// Todos API — backend returns { data: ... } with snake_case fields
export const todosApi = {
  getTodos: async (filters?: { cardId?: string; status?: 'active' | 'completed' }): Promise<Todo[]> => {
    const params = new URLSearchParams();
    if (filters?.cardId) params.set('card_id', filters.cardId);
    if (filters?.status) params.set('status', filters.status);
    const query = params.toString();
    const res = await api.get(`/todos${query ? `?${query}` : ''}`);
    return snakeToCamel(res.data.data) as Todo[];
  },
  createTodo: async (data: { description: string; priority?: Todo['priority']; cardId?: string | null }): Promise<Todo> => {
    const res = await api.post('/todos', camelToSnake(data));
    return snakeToCamel(res.data.data) as Todo;
  },
  updateTodo: async (id: string, data: Partial<Pick<Todo, 'description' | 'priority' | 'status' | 'cardId'>>): Promise<Todo> => {
    const res = await api.patch(`/todos/${id}`, camelToSnake(data));
    return snakeToCamel(res.data.data) as Todo;
  },
  deleteTodo: async (id: string): Promise<void> => {
    await api.delete(`/todos/${id}`);
  },
  reorderTodos: async (orderedIds: string[]): Promise<Todo[]> => {
    const res = await api.patch('/todos/reorder', { ordered_ids: orderedIds });
    return snakeToCamel(res.data.data) as Todo[];
  },
};

// Dashboard API — backend returns { data: { activeCount, byStage, ... } }
export const dashboardApi = {
  getDashboard: async (): Promise<DashboardData> => {
    const res = await api.get('/dashboard');
    return snakeToCamel(res.data.data) as DashboardData;
  },
};

// Reminders API — backend returns { data: [...cards] }
export const remindersApi = {
  getReminders: async (): Promise<Card[]> => {
    const res = await api.get('/reminders');
    return snakeToCamel(res.data.data) as Card[];
  },
};

export default api;
