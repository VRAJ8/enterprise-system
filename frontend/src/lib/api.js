import axios from 'axios';

const API_BASE = process.env.REACT_APP_BACKEND_URL + '/api';

const api = axios.create({
  baseURL: 'http://localhost:8000/api',
  withCredentials: true,
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses - skip redirect for auth/me verification calls
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const isAuthCheck = err.config?.url?.includes('/auth/me');
    if (err.response?.status === 401 && !isAuthCheck) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

// Auth
export const authApi = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  session: (sessionId) => api.post('/auth/session', { session_id: sessionId }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
};

// Users
export const usersApi = {
  list: () => api.get('/users'),
  get: (id) => api.get(`/users/${id}`),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
};

// Projects
export const projectsApi = {
  list: () => api.get('/projects'),
  create: (data) => api.post('/projects', data),
  get: (id) => api.get(`/projects/${id}`),
  update: (id, data) => api.put(`/projects/${id}`, data),
  delete: (id) => api.delete(`/projects/${id}`),
  getMilestones: (id) => api.get(`/projects/${id}/milestones`),
  createMilestone: (id, data) => api.post(`/projects/${id}/milestones`, data),
  toggleMilestone: (projectId, milestoneId) => api.put(`/projects/${projectId}/milestones/${milestoneId}`),
};

// Tasks
export const tasksApi = {
  list: (params) => api.get('/tasks', { params }),
  create: (data) => api.post('/tasks', data),
  get: (id) => api.get(`/tasks/${id}`),
  update: (id, data) => api.put(`/tasks/${id}`, data),
  delete: (id) => api.delete(`/tasks/${id}`),
};

// Chat
export const chatApi = {
  getChannels: () => api.get('/chat/channels'),
  getMessages: (channelId, limit = 50) => api.get(`/chat/messages/${channelId}`, { params: { limit } }),
  sendMessage: (data) => api.post('/chat/messages', data),
  createDm: (userId) => api.post(`/chat/dm/${userId}`),
};

// Notifications
export const notificationsApi = {
  list: () => api.get('/notifications'),
  unreadCount: () => api.get('/notifications/unread-count'),
  markRead: (id) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
};

// Dashboard
export const dashboardApi = {
  stats: () => api.get('/dashboard/stats'),
  charts: () => api.get('/dashboard/charts'),
  activity: (params) => api.get('/dashboard/activity', { params }),
};

// Comments
export const commentsApi = {
  create: (data) => api.post('/users/comments', data),
  list: (entityType, entityId) => api.get(`/users/comments/${entityType}/${entityId}`),
};

// Files
export const filesApi = {
  upload: (formData) => api.post('/users/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  list: (entityType, entityId) => api.get(`/users/files/${entityType}/${entityId}`),
};

export default api;
