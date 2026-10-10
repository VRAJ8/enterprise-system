import { Circle, Clock, Eye, CheckCircle } from 'lucide-react';

export const TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'completed'];

export const statusConfig = {
  todo: { label: 'To Do', icon: Circle, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', hex: '#f59e0b' },
  in_progress: { label: 'In Progress', icon: Clock, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', hex: '#3b82f6' },
  in_review: { label: 'In Review', icon: Eye, color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20', hex: '#8b5cf6' },
  completed: { label: 'Completed', icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', hex: '#10b981' },
};

export const PRIORITIES = ['low', 'medium', 'high', 'critical'];

export const priorityConfig = {
  low: { label: 'Low', color: 'text-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', rank: 3 },
  medium: { label: 'Medium', color: 'text-amber-400', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20', rank: 2 },
  high: { label: 'High', color: 'text-orange-400', badge: 'bg-orange-500/10 text-orange-400 border-orange-500/20', rank: 1 },
  critical: { label: 'Critical', color: 'text-red-400', badge: 'bg-red-500/10 text-red-400 border-red-500/20', rank: 0 },
};

export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];

export const projectStatusConfig = {
  planning: { label: 'Planning', badge: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
  active: { label: 'Active', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  on_hold: { label: 'On Hold', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  completed: { label: 'Completed', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  cancelled: { label: 'Cancelled', badge: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' },
};

export const healthConfig = {
  on_track: { label: 'On track', dot: 'bg-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  at_risk: { label: 'At risk', dot: 'bg-amber-400', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  off_track: { label: 'Off track', dot: 'bg-red-400', badge: 'bg-red-500/10 text-red-400 border-red-500/20' },
  on_hold: { label: 'On hold', dot: 'bg-zinc-400', badge: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' },
  done: { label: 'Done', dot: 'bg-blue-400', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  cancelled: { label: 'Cancelled', dot: 'bg-zinc-500', badge: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' },
};

export const ROLES = ['admin', 'project_manager', 'team_member'];
/** Where a user lands after signing in: managers get the portfolio view, everyone else their queue. */
export const homeFor = (user) => (user?.role === 'admin' || user?.role === 'project_manager' ? '/dashboard' : '/my-work');
export const roleLabel = (r) => ({ admin: 'Admin', project_manager: 'Project Manager', team_member: 'Team Member' }[r] || r);

export const initials = (name) =>
  (name || '?').split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]).join('').toUpperCase();

// ─── Dates ───
const DAY = 24 * 60 * 60 * 1000;

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function parseISODate(s) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Days from today to the date (negative = past). */
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.round((parseISODate(dateStr) - parseISODate(todayISO())) / DAY);
}

export function formatDate(dateStr, opts = { month: 'short', day: 'numeric' }) {
  if (!dateStr) return '';
  const d = parseISODate(dateStr);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? opts : { ...opts, year: 'numeric' });
}

/** Friendly due-date label + tone for a task. */
export function dueInfo(task) {
  if (!task?.due_date) return null;
  const n = daysUntil(task.due_date);
  const done = task.status === 'completed';
  if (done) return { label: formatDate(task.due_date), tone: 'text-muted-foreground' };
  if (n < 0) return { label: `${-n}d overdue`, tone: 'text-red-400' };
  if (n === 0) return { label: 'Due today', tone: 'text-orange-400' };
  if (n === 1) return { label: 'Tomorrow', tone: 'text-amber-400' };
  if (n < 7) return { label: formatDate(task.due_date, { weekday: 'short' }), tone: 'text-amber-300' };
  return { label: formatDate(task.due_date), tone: 'text-muted-foreground' };
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Download rows as a CSV file. */
export function downloadCsv(filename, rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  rows.forEach((r) => lines.push(columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.value])).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
