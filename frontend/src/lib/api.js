import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:8000/api',
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

// Handle 401 responses - skip redirect for auth/me verification and login calls
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || '';
    const isAuthCall = url.includes('/auth/me') || url.includes('/auth/login') || url.includes('/auth/register');
    if (err.response?.status === 401 && !isAuthCall) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

/** Human-readable message from an API error (handles FastAPI validation errors). */
export function errorMessage(err, fallback = 'Something went wrong') {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail.length) {
    const d = detail[0];
    const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : '';
    const msg = (d.msg || '').replace(/^Value error, /, '');
    return field && field !== 'body' ? `${String(field).replace(/_/g, ' ')}: ${msg}` : msg;
  }
  if (err?.message === 'Network Error') return 'Cannot reach the server. Check your connection.';
  return fallback;
}

// Auth
export const authApi = {
  config: () => api.get('/auth/config'),
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  session: (sessionId) => api.post('/auth/session', { session_id: sessionId }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
};

// Users
export const usersApi = {
  list: (params) => api.get('/users', { params }),
  create: (data) => api.post('/users', data),
  get: (id) => api.get(`/users/${id}`),
  update: (id, data) => api.put(`/users/${id}`, data),
  setStatus: (id, disabled) => api.put(`/users/${id}/status`, { disabled }),
  delete: (id) => api.delete(`/users/${id}`),
};

// Projects
export const projectsApi = {
  list: () => api.get('/projects'),
  create: (data) => api.post('/projects', data),
  get: (id) => api.get(`/projects/${id}`),
  update: (id, data) => api.put(`/projects/${id}`, data),
  delete: (id) => api.delete(`/projects/${id}`),
  activity: (id, limit = 50) => api.get(`/projects/${id}/activity`, { params: { limit } }),
  getMilestones: (id) => api.get(`/projects/${id}/milestones`),
  createMilestone: (id, data) => api.post(`/projects/${id}/milestones`, data),
  toggleMilestone: (projectId, milestoneId) => api.put(`/projects/${projectId}/milestones/${milestoneId}`),
  deleteMilestone: (projectId, milestoneId) => api.delete(`/projects/${projectId}/milestones/${milestoneId}`),
};

// Tasks
export const tasksApi = {
  list: (params) => api.get('/tasks', { params }),
  myWork: () => api.get('/tasks/my-work'),
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
  list: (params) => api.get('/notifications', { params }),
  unreadCount: () => api.get('/notifications/unread-count'),
  markRead: (id) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
  delete: (id) => api.delete(`/notifications/${id}`),
};

// Dashboard
export const dashboardApi = {
  stats: () => api.get('/dashboard/stats'),
  charts: () => api.get('/dashboard/charts'),
  portfolio: () => api.get('/dashboard/portfolio'),
  workload: (params) => api.get('/dashboard/workload', { params }),
  activity: (params) => api.get('/dashboard/activity', { params }),
};

// Comments
export const commentsApi = {
  create: (data) => api.post('/users/comments', data),
  list: (entityType, entityId) => api.get(`/users/comments/${entityType}/${entityId}`),
  delete: (id) => api.delete(`/users/comments/${id}`),
};

// Files
export const filesApi = {
  upload: (formData) => api.post('/users/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  list: (entityType, entityId) => api.get(`/users/files/${entityType}/${entityId}`),
  download: async (file) => {
    const res = await api.get(`/users/files/download/${file.file_id}`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.original_name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  delete: (id) => api.delete(`/users/files/${id}`),
};

// AI assistant
export const aiApi = {
  status: () => api.get('/ai/status'),
  chat: (message, history) => api.post('/ai/chat', { message, history }),
};

export default api;
