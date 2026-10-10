import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useTaskDrawer } from '../contexts/TaskDrawerContext';
import { tasksApi, projectsApi, usersApi, errorMessage } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Plus, Search, LayoutGrid, List, Download, CheckSquare, ListTodo, X } from 'lucide-react';
import { motion } from 'framer-motion';
import NewTaskDialog from '../components/NewTaskDialog';
import { UserAvatar, PriorityFlag, StatusBadge, DueChip, EmptyState } from '../components/common';
import {
  TASK_STATUSES, statusConfig, PRIORITIES, priorityConfig, daysUntil, downloadCsv, todayISO,
} from '../lib/constants';

const ALL = 'all';

function loadPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function TaskCard({ task, onOpen, draggable }) {
  const checklist = task.checklist || [];
  const done = checklist.filter((c) => c.done).length;
  return (
    <Card
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData('text/task', task.task_id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={() => onOpen(task.task_id)}
      className={`bg-card/70 border-border/30 hover:border-primary/40 transition-all cursor-pointer
        ${task.overdue ? 'border-l-2 border-l-red-500/70' : ''} ${draggable ? 'active:cursor-grabbing' : ''}`}
      data-testid={`task-card-${task.task_id}`}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <p className="text-sm font-medium flex-1 leading-snug">{task.title}</p>
          <PriorityFlag priority={task.priority} />
        </div>
        <p className="text-[11px] text-muted-foreground truncate">{task.project_name}</p>
        <div className="flex items-center gap-2 text-xs">
          <DueChip task={task} />
          {checklist.length > 0 && (
            <span className={`inline-flex items-center gap-1 text-[11px] ${done === checklist.length ? 'text-emerald-400' : 'text-muted-foreground'}`}>
              <CheckSquare size={11} /> {done}/{checklist.length}
            </span>
          )}
          {task.estimate_hours ? <span className="text-[11px] text-muted-foreground">{task.estimate_hours}h</span> : null}
          <span className="ml-auto">
            {task.assigned_to_name
              ? <UserAvatar name={task.assigned_to_name} className="h-6 w-6" textClass="text-[9px]" />
              : <span className="text-[11px] text-muted-foreground italic">Unassigned</span>}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Tasks() {
  const { user } = useAuth();
  const { openTask, version } = useTaskDrawer();
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(() => loadPref('tasks.view', 'board'));
  const [filters, setFilters] = useState({ project: ALL, assignee: ALL, priority: ALL, due: ALL, q: '' });
  const [newOpen, setNewOpen] = useState(false);
  const [newStatus, setNewStatus] = useState('todo');
  const [dragOver, setDragOver] = useState(null);
  const [sort, setSort] = useState({ key: 'due_date', dir: 1 });

  const canManage = user?.role === 'admin' || user?.role === 'project_manager';

  const load = useCallback(async () => {
    try {
      const [t, p, u] = await Promise.all([tasksApi.list(), projectsApi.list(), usersApi.list()]);
      setTasks(t.data);
      setProjects(p.data);
      setUsers(u.data);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load tasks'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, version]);
  useEffect(() => { try { localStorage.setItem('tasks.view', view); } catch {} }, [view]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const today = todayISO();
    return tasks.filter((t) => {
      if (filters.project !== ALL && t.project_id !== filters.project) return false;
      if (filters.assignee === 'me' && t.assigned_to !== user?.user_id) return false;
      if (filters.assignee === 'unassigned' && t.assigned_to) return false;
      if (![ALL, 'me', 'unassigned'].includes(filters.assignee) && t.assigned_to !== filters.assignee) return false;
      if (filters.priority !== ALL && t.priority !== filters.priority) return false;
      if (filters.due === 'overdue' && !t.overdue) return false;
      if (filters.due === 'today' && t.due_date !== today) return false;
      if (filters.due === 'week') {
        const n = daysUntil(t.due_date);
        if (n === null || n < 0 || n > 7) return false;
      }
      if (q && !t.title.toLowerCase().includes(q) && !(t.description || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, filters, user?.user_id]);

  const activeFilterCount = Object.entries(filters).filter(([k, v]) => (k === 'q' ? v.trim() : v !== ALL)).length;

  const moveTask = async (taskId, status) => {
    const task = tasks.find((t) => t.task_id === taskId);
    if (!task || task.status === status) return;
    if (!task.can_update) {
      toast.error('You can only move tasks assigned to you');
      return;
    }
    setTasks((all) => all.map((t) => (t.task_id === taskId ? { ...t, status } : t)));
    try {
      const res = await tasksApi.update(taskId, { status });
      setTasks((all) => all.map((t) => (t.task_id === taskId ? res.data : t)));
    } catch (err) {
      setTasks((all) => all.map((t) => (t.task_id === taskId ? task : t)));
      toast.error(errorMessage(err, 'Could not move task'));
    }
  };

  const sorted = useMemo(() => {
    const val = (t) => {
      if (sort.key === 'priority') return priorityConfig[t.priority]?.rank ?? 9;
      if (sort.key === 'status') return TASK_STATUSES.indexOf(t.status);
      if (sort.key === 'due_date') return t.due_date || '9999-12-31';
      return (t[sort.key] || '').toString().toLowerCase();
    };
    return [...filtered].sort((a, b) => (val(a) > val(b) ? sort.dir : val(a) < val(b) ? -sort.dir : 0));
  }, [filtered, sort]);

  const exportCsv = () => {
    downloadCsv(`tasks-${todayISO()}.csv`, sorted, [
      { label: 'Title', value: 'title' },
      { label: 'Project', value: 'project_name' },
      { label: 'Status', value: (t) => statusConfig[t.status]?.label },
      { label: 'Priority', value: 'priority' },
      { label: 'Assignee', value: 'assigned_to_name' },
      { label: 'Start', value: 'start_date' },
      { label: 'Due', value: 'due_date' },
      { label: 'Overdue', value: (t) => (t.overdue ? 'yes' : '') },
      { label: 'Estimate (h)', value: 'estimate_hours' },
      { label: 'Completed at', value: (t) => (t.completed_at || '').slice(0, 10) },
      { label: 'Created by', value: 'created_by_name' },
    ]);
  };

  const SortHead = ({ k, children, className = '' }) => (
    <TableHead className={`cursor-pointer select-none ${className}`}
      onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : 1 }))}>
      {children} {sort.key === k ? (sort.dir === 1 ? '↑' : '↓') : ''}
    </TableHead>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5" data-testid="tasks-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold font-['Outfit'] tracking-tight">Tasks</h2>
          <p className="text-sm text-muted-foreground">
            {filtered.length} of {tasks.length} tasks · {filtered.filter((t) => t.overdue).length} overdue
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            <Button variant={view === 'board' ? 'secondary' : 'ghost'} size="sm" className="h-7 gap-1" onClick={() => setView('board')}>
              <LayoutGrid size={13} /> Board
            </Button>
            <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="sm" className="h-7 gap-1" onClick={() => setView('list')}>
              <List size={13} /> List
            </Button>
          </div>
          <Button variant="outline" size="sm" className="gap-1 h-8" onClick={exportCsv} disabled={!filtered.length}>
            <Download size={13} /> Export
          </Button>
          {canManage && (
            <Button size="sm" className="gap-1 h-8" onClick={() => { setNewStatus('todo'); setNewOpen(true); }} data-testid="new-task-btn">
              <Plus size={14} /> New Task
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-56">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            placeholder="Search tasks…" className="pl-8 h-8 text-sm" data-testid="task-search" />
        </div>
        <Select value={filters.project} onValueChange={(v) => setFilters({ ...filters, project: v })}>
          <SelectTrigger className="w-40 h-8 text-xs" data-testid="task-filter-project"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All projects</SelectItem>
            {projects.map((p) => <SelectItem key={p.project_id} value={p.project_id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.assignee} onValueChange={(v) => setFilters({ ...filters, assignee: v })}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Anyone</SelectItem>
            <SelectItem value="me">Assigned to me</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {users.map((u) => <SelectItem key={u.user_id} value={u.user_id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.priority} onValueChange={(v) => setFilters({ ...filters, priority: v })}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any priority</SelectItem>
            {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{priorityConfig[p].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.due} onValueChange={(v) => setFilters({ ...filters, due: v })}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any due date</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="today">Due today</SelectItem>
            <SelectItem value="week">Next 7 days</SelectItem>
          </SelectContent>
        </Select>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs"
            onClick={() => setFilters({ project: ALL, assignee: ALL, priority: ALL, due: ALL, q: '' })}>
            <X size={12} /> Clear ({activeFilterCount})
          </Button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-96 bg-card/30 rounded-lg animate-pulse" />)}
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState icon={ListTodo} title="No tasks yet"
          description={canManage ? 'Create a task to start tracking work.' : 'Tasks assigned to you will appear here.'}
          action={canManage && <Button size="sm" onClick={() => setNewOpen(true)}><Plus size={14} className="mr-1" /> New Task</Button>} />
      ) : view === 'board' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4" data-testid="kanban-board">
          {TASK_STATUSES.map((status) => {
            const cfg = statusConfig[status];
            const Icon = cfg.icon;
            const col = filtered
              .filter((t) => t.status === status)
              .sort((a, b) => (priorityConfig[a.priority]?.rank - priorityConfig[b.priority]?.rank) || (a.due_date || '9').localeCompare(b.due_date || '9'));
            return (
              <div key={status}
                onDragOver={(e) => { e.preventDefault(); setDragOver(status); }}
                onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
                onDrop={(e) => { e.preventDefault(); setDragOver(null); moveTask(e.dataTransfer.getData('text/task'), status); }}
                className={`rounded-lg p-2 transition-colors ${dragOver === status ? 'bg-primary/5 ring-1 ring-primary/40' : 'bg-card/20'}`}
                data-testid={`column-${status}`}>
                <div className={`flex items-center gap-2 px-2 py-2 mb-2 rounded-md ${cfg.bg}`}>
                  <Icon size={14} className={cfg.color} />
                  <span className="text-sm font-semibold">{cfg.label}</span>
                  <Badge variant="outline" className="ml-auto text-[10px]">{col.length}</Badge>
                  {canManage && (
                    <button onClick={() => { setNewStatus(status); setNewOpen(true); }} className="text-muted-foreground hover:text-foreground" aria-label={`Add task to ${cfg.label}`}>
                      <Plus size={14} />
                    </button>
                  )}
                </div>
                <div className="space-y-2 min-h-[160px]">
                  {col.map((task) => <TaskCard key={task.task_id} task={task} onOpen={openTask} draggable={task.can_update} />)}
                  {col.length === 0 && <p className="text-[11px] text-center text-muted-foreground py-6">Drop tasks here</p>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="bg-card/70 border-border/40 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/40 hover:bg-transparent">
                <SortHead k="title">Task</SortHead>
                <SortHead k="project_name" className="hidden md:table-cell">Project</SortHead>
                <SortHead k="status">Status</SortHead>
                <SortHead k="priority">Priority</SortHead>
                <SortHead k="assigned_to_name" className="hidden sm:table-cell">Assignee</SortHead>
                <SortHead k="due_date">Due</SortHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((t) => (
                <TableRow key={t.task_id} className="border-border/30 cursor-pointer" onClick={() => openTask(t.task_id)}>
                  <TableCell className="font-medium text-sm max-w-[280px] truncate">{t.title}</TableCell>
                  <TableCell className="text-xs text-muted-foreground hidden md:table-cell">{t.project_name}</TableCell>
                  <TableCell><StatusBadge status={t.status} /></TableCell>
                  <TableCell><PriorityFlag priority={t.priority} showLabel /></TableCell>
                  <TableCell className="text-sm hidden sm:table-cell">{t.assigned_to_name || <span className="text-muted-foreground italic text-xs">Unassigned</span>}</TableCell>
                  <TableCell>{t.due_date ? <DueChip task={t} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                </TableRow>
              ))}
              {sorted.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">No tasks match these filters</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <NewTaskDialog open={newOpen} onOpenChange={setNewOpen} defaultStatus={newStatus}
        projectId={projects.find((p) => p.project_id === filters.project)?.can_manage ? filters.project : undefined}
        onCreated={load} />
    </motion.div>
  );
}
