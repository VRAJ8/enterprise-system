import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { tasksApi, projectsApi, usersApi, errorMessage } from '../lib/api';
import { PRIORITIES, priorityConfig, TASK_STATUSES, statusConfig } from '../lib/constants';

const NONE = '__none';
const empty = { title: '', description: '', priority: 'medium', assigned_to: NONE, due_date: '', estimate_hours: '' };

/**
 * Create-task dialog. Pass `projectId` to lock the project, otherwise the user
 * picks one of the projects they manage.
 */
export default function NewTaskDialog({ open, onOpenChange, projectId, defaultStatus = 'todo', onCreated }) {
  const [form, setForm] = useState(empty);
  const [status, setStatus] = useState(defaultStatus);
  const [project, setProject] = useState(projectId || '');
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(empty);
    setStatus(defaultStatus);
    setProject(projectId || '');
    Promise.all([projectsApi.list(), usersApi.list()])
      .then(([p, u]) => {
        const manageable = p.data.filter((x) => x.can_manage && !['completed', 'cancelled'].includes(x.status));
        setProjects(manageable);
        setUsers(u.data);
        if (!projectId && manageable.length === 1) setProject(manageable[0].project_id);
      })
      .catch(() => {});
  }, [open, projectId, defaultStatus]);

  const team = useMemo(() => {
    const p = projects.find((x) => x.project_id === project);
    const ids = new Set(p?.team_members || []);
    return {
      onTeam: users.filter((u) => ids.has(u.user_id)),
      others: users.filter((u) => !ids.has(u.user_id)),
    };
  }, [projects, project, users]);

  const set = (k) => (e) => setForm({ ...form, [k]: e?.target ? e.target.value : e });

  const submit = async (e) => {
    e.preventDefault();
    if (!project) {
      toast.error('Choose a project');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        description: form.description,
        priority: form.priority,
        status,
        project_id: project,
        assigned_to: form.assigned_to === NONE ? null : form.assigned_to,
        due_date: form.due_date || null,
        estimate_hours: form.estimate_hours === '' ? null : Number(form.estimate_hours),
      };
      const res = await tasksApi.create(payload);
      toast.success(`Created "${res.data.title}"`);
      onOpenChange(false);
      onCreated?.(res.data);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not create task'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-['Outfit']">New Task</DialogTitle>
          <DialogDescription>Assign work with a clear owner and due date.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={form.title} onChange={set('title')} required autoFocus placeholder="e.g. Draft Q3 launch plan" data-testid="task-title-input" />
          </div>
          {!projectId && (
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger data-testid="task-project-select"><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => <SelectItem key={p.project_id} value={p.project_id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {projects.length === 0 && <p className="text-xs text-muted-foreground">You don't manage any active projects yet.</p>}
            </div>
          )}
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={set('description')} rows={3} placeholder="Context, acceptance criteria, links…" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Assignee</Label>
              <Select value={form.assigned_to} onValueChange={set('assigned_to')}>
                <SelectTrigger data-testid="task-assign-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {team.onTeam.map((u) => <SelectItem key={u.user_id} value={u.user_id}>{u.name}</SelectItem>)}
                  {team.others.length > 0 && project && <div className="px-2 pt-2 pb-1 text-[10px] uppercase text-muted-foreground">Not on project (will be added)</div>}
                  {team.others.map((u) => <SelectItem key={u.user_id} value={u.user_id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={set('priority')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{priorityConfig[p].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Due date</Label>
              <Input type="date" value={form.due_date} onChange={set('due_date')} />
            </div>
            <div className="space-y-2">
              <Label>Estimate (hours)</Label>
              <Input type="number" min="0" step="0.5" value={form.estimate_hours} onChange={set('estimate_hours')} placeholder="Optional" />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{statusConfig[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={saving} data-testid="task-create-submit">
            {saving && <Loader2 size={14} className="mr-1 animate-spin" />} Create Task
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
