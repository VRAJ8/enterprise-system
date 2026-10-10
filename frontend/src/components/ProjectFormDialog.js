import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { UserAvatar } from './common';
import { projectsApi, usersApi, errorMessage } from '../lib/api';
import { PRIORITIES, priorityConfig, PROJECT_STATUSES, projectStatusConfig, roleLabel, todayISO } from '../lib/constants';
import { useAuth } from '../contexts/AuthContext';

/** Create a project, or edit one when `project` is given. */
export default function ProjectFormDialog({ open, onOpenChange, project, onSaved }) {
  const { user } = useAuth();
  const editing = !!project;
  const [form, setForm] = useState({});
  const [users, setUsers] = useState([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMemberSearch('');
    setForm(editing ? {
      name: project.name, description: project.description || '', priority: project.priority,
      status: project.status, start_date: project.start_date || '', end_date: project.end_date || '',
      team_members: project.team_members || [],
    } : {
      name: '', description: '', priority: 'medium', status: 'active',
      start_date: todayISO(), end_date: '', team_members: [],
    });
    usersApi.list().then((r) => setUsers(r.data)).catch(() => {});
  }, [open, editing, project]);

  const set = (k) => (e) => setForm({ ...form, [k]: e?.target ? e.target.value : e });
  const ownerId = editing ? project.created_by : user?.user_id;

  const toggleMember = (id) => setForm((f) => ({
    ...f,
    team_members: f.team_members.includes(id) ? f.team_members.filter((m) => m !== id) : [...f.team_members, id],
  }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, start_date: form.start_date || null, end_date: form.end_date || null };
      const res = editing ? await projectsApi.update(project.project_id, payload) : await projectsApi.create(payload);
      toast.success(editing ? 'Project updated' : `Created "${res.data.name}"`);
      onOpenChange(false);
      onSaved?.(res.data);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save project'));
    } finally {
      setSaving(false);
    }
  };

  const q = memberSearch.toLowerCase();
  const candidates = users.filter((u) => u.user_id !== ownerId && (u.name.toLowerCase().includes(q) || (u.department || '').toLowerCase().includes(q)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-['Outfit']">{editing ? 'Edit project' : 'New project'}</DialogTitle>
          <DialogDescription>{editing ? 'Update scope, schedule and team.' : 'Set a clear goal, timeline and team.'}</DialogDescription>
        </DialogHeader>
        {form.name !== undefined && (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={set('name')} required autoFocus data-testid="project-name-input" />
            </div>
            <div className="space-y-2">
              <Label>Description / goal</Label>
              <Textarea value={form.description} onChange={set('description')} rows={3}
                placeholder="What does success look like?" data-testid="project-desc-input" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={set('priority')}>
                  <SelectTrigger data-testid="project-priority-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{priorityConfig[p].label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={set('status')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s}>{projectStatusConfig[s].label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Start date</Label>
                <Input type="date" value={form.start_date} onChange={set('start_date')} />
              </div>
              <div className="space-y-2">
                <Label>Deadline</Label>
                <Input type="date" value={form.end_date} min={form.start_date || undefined} onChange={set('end_date')} data-testid="project-deadline-input" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Team ({form.team_members.filter((m) => m !== ownerId).length} selected)</Label>
                <div className="relative w-40">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} placeholder="Filter…" className="h-7 pl-6 text-xs" />
                </div>
              </div>
              <div className="max-h-44 overflow-y-auto rounded-md border border-border divide-y divide-border/40">
                {candidates.map((u) => (
                  <label key={u.user_id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-secondary/40">
                    <Checkbox checked={form.team_members.includes(u.user_id)} onCheckedChange={() => toggleMember(u.user_id)} />
                    <UserAvatar name={u.name} className="h-6 w-6" textClass="text-[9px]" />
                    <span className="text-sm flex-1">{u.name}</span>
                    <span className="text-[11px] text-muted-foreground">{u.department || roleLabel(u.role)}</span>
                  </label>
                ))}
                {candidates.length === 0 && <p className="text-xs text-muted-foreground p-3">No people found.</p>}
              </div>
              <p className="text-[11px] text-muted-foreground">The project owner is always on the team. Team members see the project, its tasks and its chat channel.</p>
            </div>
            <Button type="submit" className="w-full" disabled={saving} data-testid="project-create-submit">
              {saving && <Loader2 size={14} className="animate-spin mr-1" />} {editing ? 'Save changes' : 'Create project'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
