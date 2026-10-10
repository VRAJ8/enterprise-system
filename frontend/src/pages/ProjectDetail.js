import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useTaskDrawer } from '../contexts/TaskDrawerContext';
import { projectsApi, tasksApi, commentsApi, filesApi, dashboardApi, errorMessage } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  ArrowLeft, Plus, CheckCircle, Circle, ListTodo, Users, MessageSquare, CalendarDays, Send, Milestone,
  Edit2, Paperclip, Download, Trash2, History, Loader2, AlertTriangle, MessageCircle, Hash,
} from 'lucide-react';
import { motion } from 'framer-motion';
import NewTaskDialog from '../components/NewTaskDialog';
import ProjectFormDialog from '../components/ProjectFormDialog';
import {
  UserAvatar, PriorityFlag, DueChip, HealthBadge, ProjectStatusBadge, ProgressBar, EmptyState,
} from '../components/common';
import {
  TASK_STATUSES, statusConfig, priorityConfig, roleLabel, formatDate, daysUntil, timeAgo, formatBytes,
} from '../lib/constants';

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openTask, version } = useTaskDrawer();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [comments, setComments] = useState([]);
  const [files, setFiles] = useState([]);
  const [activity, setActivity] = useState([]);
  const [workload, setWorkload] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [taskOpen, setTaskOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [msOpen, setMsOpen] = useState(false);
  const [msForm, setMsForm] = useState({ title: '', description: '', due_date: '' });
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef(null);

  const loadAll = useCallback(async () => {
    try {
      const p = await projectsApi.get(id);
      setProject(p.data);
      const [t, m, c, f, a, w] = await Promise.allSettled([
        tasksApi.list({ project_id: id }),
        projectsApi.getMilestones(id),
        commentsApi.list('project', id),
        filesApi.list('project', id),
        projectsApi.activity(id, 50),
        dashboardApi.workload({ project_id: id }),
      ]);
      if (t.status === 'fulfilled') setTasks(t.value.data);
      if (m.status === 'fulfilled') setMilestones(m.value.data);
      if (c.status === 'fulfilled') setComments(c.value.data);
      if (f.status === 'fulfilled') setFiles(f.value.data);
      if (a.status === 'fulfilled') setActivity(a.value.data);
      if (w.status === 'fulfilled') setWorkload(w.value.data);
    } catch (err) {
      toast.error(errorMessage(err, 'Project not found'));
      navigate('/projects');
    }
  }, [id, navigate]);

  useEffect(() => { loadAll(); }, [loadAll, version]);

  const createMilestone = async (e) => {
    e.preventDefault();
    try {
      await projectsApi.createMilestone(id, msForm);
      setMsOpen(false);
      setMsForm({ title: '', description: '', due_date: '' });
      loadAll();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not add milestone'));
    }
  };

  const toggleMs = async (msId) => {
    try { await projectsApi.toggleMilestone(id, msId); loadAll(); } catch (err) { toast.error(errorMessage(err)); }
  };

  const deleteMs = async (m) => {
    if (!window.confirm(`Delete milestone "${m.title}"?`)) return;
    try { await projectsApi.deleteMilestone(id, m.milestone_id); loadAll(); } catch (err) { toast.error(errorMessage(err)); }
  };

  const addComment = async (e) => {
    e?.preventDefault();
    if (!newComment.trim()) return;
    try {
      const res = await commentsApi.create({ content: newComment, entity_type: 'project', entity_id: id });
      setComments((c) => [...c, res.data]);
      setNewComment('');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not post'));
    }
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('entity_type', 'project');
    fd.append('entity_id', id);
    setUploading(true);
    try {
      const res = await filesApi.upload(fd);
      setFiles((f) => [res.data, ...f]);
      toast.success(`Uploaded ${res.data.original_name}`);
    } catch (err) {
      toast.error(errorMessage(err, 'Upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (f) => {
    if (!window.confirm(`Delete ${f.original_name}?`)) return;
    try { await filesApi.delete(f.file_id); setFiles((all) => all.filter((x) => x.file_id !== f.file_id)); } catch (err) { toast.error(errorMessage(err)); }
  };

  if (!project) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground"><Loader2 className="animate-spin" /></div>;
  }

  const canManage = project.can_manage;
  const stats = project.task_stats || {};
  const daysLeft = daysUntil(project.end_date);
  const workloadById = Object.fromEntries(workload.map((w) => [w.user_id, w]));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6" data-testid="project-detail-page">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/projects')} data-testid="back-to-projects" aria-label="Back to projects">
          <ArrowLeft size={18} />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-3 flex-wrap">
            <h2 className="text-2xl font-bold font-['Outfit'] tracking-tight">{project.name}</h2>
            <div className="flex items-center gap-1.5 mt-1.5">
              <ProjectStatusBadge status={project.status} />
              <HealthBadge health={project.health} reason={project.reason} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl whitespace-pre-wrap">{project.description || 'No description'}</p>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
            <span className={priorityConfig[project.priority]?.color}>{priorityConfig[project.priority]?.label} priority</span>
            {project.start_date && <span className="flex items-center gap-1"><CalendarDays size={12} /> {formatDate(project.start_date)} → {project.end_date ? formatDate(project.end_date) : 'no deadline'}</span>}
            {project.end_date && !['completed', 'cancelled'].includes(project.status) && (
              <span className={daysLeft < 0 ? 'text-red-400' : daysLeft <= 7 ? 'text-amber-400' : ''}>
                {daysLeft < 0 ? `${-daysLeft} days past deadline` : daysLeft === 0 ? 'Due today' : `${daysLeft} days left`}
              </span>
            )}
            <span>Owner: {project.created_by_name}</span>
            <Link to="/chat" className="flex items-center gap-1 hover:text-primary"><Hash size={12} /> Team channel</Link>
          </div>
        </div>
        {canManage && (
          <Button variant="outline" size="sm" className="gap-1 shrink-0" onClick={() => setEditOpen(true)} data-testid="edit-project-btn">
            <Edit2 size={13} /> Edit
          </Button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card/70 border-border/40 md:col-span-2">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Progress</span>
              <span className="text-sm">
                <span className="text-primary font-semibold">{project.progress}%</span>
                {project.expected != null && <span className="text-muted-foreground"> · {project.expected}% of schedule elapsed</span>}
              </span>
            </div>
            <div className="relative">
              <ProgressBar value={project.progress} className="h-2.5" />
              {project.expected != null && (
                <div className="absolute top-[-3px] h-4 w-0.5 bg-foreground/60" style={{ left: `${project.expected}%` }} title="Expected progress today" />
              )}
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground flex-wrap">
              {TASK_STATUSES.map((s) => {
                const Icon = statusConfig[s].icon;
                return <span key={s} className="flex items-center gap-1"><Icon size={11} className={statusConfig[s].color} /> {stats[s] || 0} {statusConfig[s].label}</span>;
              })}
              {stats.overdue > 0 && <span className="flex items-center gap-1 text-red-400"><AlertTriangle size={11} /> {stats.overdue} overdue</span>}
            </div>
            {project.reason && <p className="text-xs text-amber-400">{project.reason}</p>}
          </CardContent>
        </Card>
        <Card className="bg-card/70 border-border/40">
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-2">Next milestones</p>
            {milestones.filter((m) => !m.completed).slice(0, 3).map((m) => {
              const d = daysUntil(m.due_date);
              return (
                <div key={m.milestone_id} className="flex items-center justify-between text-xs py-1">
                  <span className="truncate pr-2">{m.title}</span>
                  <span className={d < 0 ? 'text-red-400' : 'text-muted-foreground'}>{formatDate(m.due_date)}</span>
                </div>
              );
            })}
            {milestones.filter((m) => !m.completed).length === 0 && <p className="text-xs text-muted-foreground">No upcoming milestones</p>}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="tasks">
        <TabsList className="bg-secondary/50 flex-wrap h-auto">
          <TabsTrigger value="tasks" data-testid="tab-tasks"><ListTodo size={14} className="mr-1" /> Tasks ({tasks.length})</TabsTrigger>
          <TabsTrigger value="milestones" data-testid="tab-milestones"><Milestone size={14} className="mr-1" /> Milestones</TabsTrigger>
          <TabsTrigger value="team" data-testid="tab-team"><Users size={14} className="mr-1" /> Team ({project.team_details?.length || 0})</TabsTrigger>
          <TabsTrigger value="discussion" data-testid="tab-comments"><MessageSquare size={14} className="mr-1" /> Discussion</TabsTrigger>
          <TabsTrigger value="files"><Paperclip size={14} className="mr-1" /> Files ({files.length})</TabsTrigger>
          <TabsTrigger value="activity"><History size={14} className="mr-1" /> Activity</TabsTrigger>
        </TabsList>

        {/* Tasks */}
        <TabsContent value="tasks" className="mt-4 space-y-4">
          {canManage && (
            <Button size="sm" className="gap-1" onClick={() => setTaskOpen(true)} data-testid="create-task-btn"><Plus size={14} /> Add task</Button>
          )}
          {tasks.length === 0 ? (
            <EmptyState icon={ListTodo} title="No tasks yet" description="Break the project down into tasks with owners and due dates." />
          ) : (
            TASK_STATUSES.map((s) => {
              const group = tasks.filter((t) => t.status === s);
              if (!group.length) return null;
              const cfg = statusConfig[s];
              return (
                <div key={s} className="space-y-1.5">
                  <p className={`text-xs font-semibold uppercase tracking-wider ${cfg.color}`}>{cfg.label} · {group.length}</p>
                  <Card className="bg-card/50 border-border/30 divide-y divide-border/30">
                    {group.map((t) => (
                      <div key={t.task_id} onClick={() => openTask(t.task_id)}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/30 cursor-pointer" data-testid={`task-${t.task_id}`}>
                        <cfg.icon size={15} className={cfg.color} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${s === 'completed' ? 'text-muted-foreground line-through' : ''}`}>{t.title}</p>
                        </div>
                        <DueChip task={t} />
                        <PriorityFlag priority={t.priority} />
                        {t.assigned_to_name
                          ? <UserAvatar name={t.assigned_to_name} className="h-6 w-6" textClass="text-[9px]" />
                          : <span className="text-[11px] text-muted-foreground italic w-6">—</span>}
                      </div>
                    ))}
                  </Card>
                </div>
              );
            })
          )}
        </TabsContent>

        {/* Milestones */}
        <TabsContent value="milestones" className="mt-4 space-y-3">
          {canManage && (
            <Button size="sm" className="gap-1" onClick={() => setMsOpen(true)} data-testid="create-milestone-btn"><Plus size={14} /> Add milestone</Button>
          )}
          {milestones.length === 0 ? (
            <EmptyState icon={Milestone} title="No milestones" description="Milestones mark key checkpoints like launches, reviews and handoffs." />
          ) : milestones.map((m) => {
            const d = daysUntil(m.due_date);
            const late = !m.completed && d < 0;
            return (
              <Card key={m.milestone_id} className={`bg-card/50 border-border/30 group ${late ? 'border-l-2 border-l-red-500/70' : ''}`} data-testid={`milestone-${m.milestone_id}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <button onClick={() => canManage && toggleMs(m.milestone_id)} disabled={!canManage}
                    className={`shrink-0 ${m.completed ? 'text-emerald-400' : 'text-muted-foreground'} ${canManage ? 'hover:text-emerald-400' : ''}`}
                    aria-label={m.completed ? 'Mark incomplete' : 'Mark complete'}>
                    {m.completed ? <CheckCircle size={18} /> : <Circle size={18} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${m.completed ? 'line-through text-muted-foreground' : ''}`}>{m.title}</p>
                    {m.description && <p className="text-xs text-muted-foreground">{m.description}</p>}
                  </div>
                  <span className={`text-xs ${late ? 'text-red-400' : 'text-muted-foreground'}`}>
                    {formatDate(m.due_date)}{late ? ` · ${-d}d late` : ''}
                  </span>
                  {canManage && (
                    <button onClick={() => deleteMs(m)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" aria-label="Delete milestone">
                      <Trash2 size={14} />
                    </button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Team with workload */}
        <TabsContent value="team" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(project.team_details || []).map((m) => {
              const w = workloadById[m.user_id];
              const projectTasks = tasks.filter((t) => t.assigned_to === m.user_id && t.status !== 'completed');
              return (
                <Card key={m.user_id} className="bg-card/50 border-border/30" data-testid={`team-member-${m.user_id}`}>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center gap-3">
                      <UserAvatar name={m.name} className="h-9 w-9" textClass="text-xs" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {m.name} {m.user_id === project.created_by && <Badge variant="outline" className="ml-1 text-[9px]">Owner</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{m.title || roleLabel(m.role)}{m.department ? ` · ${m.department}` : ''}</p>
                      </div>
                      {m.user_id !== user?.user_id && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Message" onClick={() => navigate('/chat', { state: { dmWith: m.user_id } })}>
                          <MessageCircle size={14} />
                        </Button>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex gap-3">
                      <span>{projectTasks.length} open here</span>
                      {w && <span className={w.status === 'overloaded' ? 'text-red-400' : w.status === 'busy' ? 'text-amber-400' : ''}>
                        {w.estimated_hours}h / {w.capacity_hours}h this project
                      </span>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Discussion */}
        <TabsContent value="discussion" className="mt-4 space-y-4 max-w-3xl">
          <div className="space-y-3">
            {comments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6">No discussion yet. Post decisions, updates and questions here so they don't get lost in chat.</p>
            ) : comments.map((c) => (
              <div key={c.comment_id} className="flex gap-3" data-testid={`comment-${c.comment_id}`}>
                <UserAvatar name={c.user_name} />
                <div className="flex-1 bg-secondary/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{c.user_name}</span>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(c.created_at)}</span>
                  </div>
                  <p className="text-sm text-foreground/90 whitespace-pre-wrap">{c.content}</p>
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={addComment} className="flex gap-2 items-end">
            <Textarea placeholder="Share an update… use @Name to mention someone" value={newComment} rows={2}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment(e); }}
              data-testid="comment-input" />
            <Button type="submit" size="icon" className="shrink-0" disabled={!newComment.trim()} data-testid="send-comment-btn" aria-label="Post">
              <Send size={16} />
            </Button>
          </form>
        </TabsContent>

        {/* Files */}
        <TabsContent value="files" className="mt-4 space-y-2 max-w-3xl">
          <input ref={fileInput} type="file" className="hidden" onChange={upload} />
          <Button variant="outline" size="sm" className="gap-1" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} Upload file
          </Button>
          {files.length === 0 && <p className="text-sm text-muted-foreground py-4">No files yet. Keep specs, briefs and deliverables with the project.</p>}
          {files.map((f) => (
            <div key={f.file_id} className="flex items-center gap-3 rounded-md border border-border/40 px-3 py-2 group">
              <Paperclip size={14} className="text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{f.original_name}</p>
                <p className="text-[10px] text-muted-foreground">{formatBytes(f.size)} · {f.uploaded_by_name} · {timeAgo(f.created_at)}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => filesApi.download(f).catch((err) => toast.error(errorMessage(err)))} aria-label="Download">
                <Download size={13} />
              </Button>
              {(f.uploaded_by === user?.user_id || canManage) && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeFile(f)} aria-label="Delete">
                  <Trash2 size={13} />
                </Button>
              )}
            </div>
          ))}
        </TabsContent>

        {/* Activity */}
        <TabsContent value="activity" className="mt-4 max-w-3xl">
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ol className="space-y-3 border-l border-border/60 pl-4">
              {activity.map((a) => (
                <li key={a.activity_id} className="text-sm relative">
                  <span className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-primary/70" />
                  <span className="font-medium">{a.user_name}</span>{' '}
                  <span className="text-muted-foreground">{a.action}</span>{' '}
                  {a.entity_type === 'task' ? (
                    <button className="text-primary hover:underline" onClick={() => openTask(a.entity_id)}>{a.entity_name}</button>
                  ) : <span className="text-primary">{a.entity_name}</span>}
                  {a.details && <span className="text-muted-foreground text-xs"> ({a.details})</span>}
                  <span className="block text-[10px] text-muted-foreground">{timeAgo(a.created_at)}</span>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
      </Tabs>

      <NewTaskDialog open={taskOpen} onOpenChange={setTaskOpen} projectId={id} onCreated={loadAll} />
      <ProjectFormDialog open={editOpen} onOpenChange={setEditOpen} project={project} onSaved={loadAll} />

      <Dialog open={msOpen} onOpenChange={setMsOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-['Outfit']">Add milestone</DialogTitle></DialogHeader>
          <form onSubmit={createMilestone} className="space-y-4">
            <div className="space-y-2"><Label>Title</Label>
              <Input value={msForm.title} onChange={(e) => setMsForm({ ...msForm, title: e.target.value })} required placeholder="e.g. Beta launch" data-testid="ms-title-input" /></div>
            <div className="space-y-2"><Label>Description</Label>
              <Textarea value={msForm.description} onChange={(e) => setMsForm({ ...msForm, description: e.target.value })} /></div>
            <div className="space-y-2"><Label>Due date</Label>
              <Input type="date" value={msForm.due_date} onChange={(e) => setMsForm({ ...msForm, due_date: e.target.value })} required /></div>
            <Button type="submit" className="w-full" data-testid="ms-create-submit">Add milestone</Button>
          </form>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
