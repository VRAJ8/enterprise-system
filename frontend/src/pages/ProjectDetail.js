import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, tasksApi, commentsApi, usersApi } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Progress } from '../components/ui/progress';
import {
  ArrowLeft, Plus, CheckCircle, Circle, Clock, ListTodo, Users, MessageSquare,
  Flag, Calendar, Send, Milestone
} from 'lucide-react';
import { motion } from 'framer-motion';

const statusColors = { todo: 'text-amber-400', in_progress: 'text-blue-400', completed: 'text-emerald-400' };
const statusIcons = { todo: Circle, in_progress: Clock, completed: CheckCircle };
const priorityColors = { low: 'text-emerald-400', medium: 'text-amber-400', high: 'text-orange-400', critical: 'text-red-400' };

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [comments, setComments] = useState([]);
  const [users, setUsers] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [taskOpen, setTaskOpen] = useState(false);
  const [msOpen, setMsOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'medium', assigned_to: '', due_date: '' });
  const [msForm, setMsForm] = useState({ title: '', description: '', due_date: '' });

  const canManage = user?.role === 'admin' || user?.role === 'project_manager';

  useEffect(() => { loadAll(); }, [id]);

  const loadAll = async () => {
    try {
      const [p, t, m, c, u] = await Promise.all([
        projectsApi.get(id), tasksApi.list({ project_id: id }),
        projectsApi.getMilestones(id), commentsApi.list('project', id), usersApi.list()
      ]);
      setProject(p.data); setTasks(t.data); setMilestones(m.data);
      setComments(c.data); setUsers(u.data);
    } catch { navigate('/projects'); }
  };

  const createTask = async (e) => {
    e.preventDefault();
    try {
      await tasksApi.create({ ...taskForm, project_id: id });
      setTaskOpen(false);
      setTaskForm({ title: '', description: '', priority: 'medium', assigned_to: '', due_date: '' });
      loadAll();
    } catch {}
  };

  const createMilestone = async (e) => {
    e.preventDefault();
    try {
      await projectsApi.createMilestone(id, msForm);
      setMsOpen(false);
      setMsForm({ title: '', description: '', due_date: '' });
      loadAll();
    } catch {}
  };

  const toggleMs = async (msId) => {
    try { await projectsApi.toggleMilestone(id, msId); loadAll(); } catch {}
  };

  const addComment = async () => {
    if (!newComment.trim()) return;
    try {
      await commentsApi.create({ content: newComment, entity_type: 'project', entity_id: id });
      setNewComment('');
      loadAll();
    } catch {}
  };

  if (!project) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;

  const progress = project.task_stats?.total > 0
    ? Math.round((project.task_stats.completed / project.task_stats.total) * 100)
    : 0;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6" data-testid="project-detail-page">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/projects')} data-testid="back-to-projects">
          <ArrowLeft size={18} />
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold font-['Outfit'] tracking-tight">{project.name}</h2>
          <p className="text-sm text-muted-foreground mt-1">{project.description || 'No description'}</p>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="outline" className="capitalize">{project.priority}</Badge>
            <Badge variant="outline" className="capitalize">{project.status}</Badge>
            {project.end_date && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar size={12} /> Due: {project.end_date}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Progress */}
      <Card className="bg-card/70 border-border/40">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Progress</span>
            <span className="text-sm text-primary font-['JetBrains Mono']">{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Circle size={10} className="text-amber-400" /> {project.task_stats?.todo} Todo</span>
            <span className="flex items-center gap-1"><Clock size={10} className="text-blue-400" /> {project.task_stats?.in_progress} In Progress</span>
            <span className="flex items-center gap-1"><CheckCircle size={10} className="text-emerald-400" /> {project.task_stats?.completed} Done</span>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="tasks">
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="tasks" data-testid="tab-tasks"><ListTodo size={14} className="mr-1" /> Tasks ({tasks.length})</TabsTrigger>
          <TabsTrigger value="milestones" data-testid="tab-milestones"><Milestone size={14} className="mr-1" /> Milestones</TabsTrigger>
          <TabsTrigger value="team" data-testid="tab-team"><Users size={14} className="mr-1" /> Team</TabsTrigger>
          <TabsTrigger value="comments" data-testid="tab-comments"><MessageSquare size={14} className="mr-1" /> Comments</TabsTrigger>
        </TabsList>

        {/* Tasks Tab */}
        <TabsContent value="tasks" className="mt-4 space-y-4">
          {canManage && (
            <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary gap-1" size="sm" data-testid="create-task-btn"><Plus size={14} /> Add Task</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle className="font-['Outfit']">Create Task</DialogTitle></DialogHeader>
                <form onSubmit={createTask} className="space-y-4">
                  <div className="space-y-2"><Label>Title</Label>
                    <Input value={taskForm.title} onChange={e => setTaskForm({...taskForm, title: e.target.value})} required data-testid="task-title-input" /></div>
                  <div className="space-y-2"><Label>Description</Label>
                    <Textarea value={taskForm.description} onChange={e => setTaskForm({...taskForm, description: e.target.value})} /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>Priority</Label>
                      <Select value={taskForm.priority} onValueChange={v => setTaskForm({...taskForm, priority: v})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['low','medium','high','critical'].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                      </Select></div>
                    <div className="space-y-2"><Label>Assign To</Label>
                      <Select value={taskForm.assigned_to} onValueChange={v => setTaskForm({...taskForm, assigned_to: v})}>
                        <SelectTrigger data-testid="task-assign-select"><SelectValue placeholder="Select member" /></SelectTrigger>
                        <SelectContent>
                          {users.map(u => <SelectItem key={u.user_id} value={u.user_id}>{u.name}</SelectItem>)}
                        </SelectContent>
                      </Select></div>
                  </div>
                  <div className="space-y-2"><Label>Due Date</Label>
                    <Input type="date" value={taskForm.due_date} onChange={e => setTaskForm({...taskForm, due_date: e.target.value})} /></div>
                  <Button type="submit" className="w-full bg-primary" data-testid="task-create-submit">Create Task</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}

          {tasks.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">No tasks yet</p>
          ) : (
            <div className="space-y-2">
              {tasks.map(t => {
                const StatusIcon = statusIcons[t.status] || Circle;
                return (
                  <Card key={t.task_id} className="bg-card/50 border-border/30 hover:border-primary/20 transition-colors" data-testid={`task-${t.task_id}`}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <StatusIcon size={16} className={statusColors[t.status]} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{t.title}</p>
                        <p className="text-xs text-muted-foreground">{t.assigned_to_name || 'Unassigned'}</p>
                      </div>
                      <Flag size={12} className={priorityColors[t.priority]} />
                      <Badge variant="outline" className="text-xs capitalize">{t.status?.replace('_', ' ')}</Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Milestones Tab */}
        <TabsContent value="milestones" className="mt-4 space-y-4">
          {canManage && (
            <Dialog open={msOpen} onOpenChange={setMsOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary gap-1" size="sm" data-testid="create-milestone-btn"><Plus size={14} /> Add Milestone</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle className="font-['Outfit']">Create Milestone</DialogTitle></DialogHeader>
                <form onSubmit={createMilestone} className="space-y-4">
                  <div className="space-y-2"><Label>Title</Label>
                    <Input value={msForm.title} onChange={e => setMsForm({...msForm, title: e.target.value})} required data-testid="ms-title-input" /></div>
                  <div className="space-y-2"><Label>Description</Label>
                    <Textarea value={msForm.description} onChange={e => setMsForm({...msForm, description: e.target.value})} /></div>
                  <div className="space-y-2"><Label>Due Date</Label>
                    <Input type="date" value={msForm.due_date} onChange={e => setMsForm({...msForm, due_date: e.target.value})} required /></div>
                  <Button type="submit" className="w-full bg-primary" data-testid="ms-create-submit">Create Milestone</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
          {milestones.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">No milestones yet</p>
          ) : milestones.map(m => (
            <Card key={m.milestone_id} className="bg-card/50 border-border/30" data-testid={`milestone-${m.milestone_id}`}>
              <CardContent className="p-3 flex items-center gap-3">
                <button onClick={() => canManage && toggleMs(m.milestone_id)}
                  className={`shrink-0 ${m.completed ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                  {m.completed ? <CheckCircle size={18} /> : <Circle size={18} />}
                </button>
                <div className="flex-1">
                  <p className={`text-sm font-medium ${m.completed ? 'line-through text-muted-foreground' : ''}`}>{m.title}</p>
                  <p className="text-xs text-muted-foreground">Due: {m.due_date}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Team Tab */}
        <TabsContent value="team" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(project.team_details || []).map(m => (
              <Card key={m.user_id} className="bg-card/50 border-border/30" data-testid={`team-member-${m.user_id}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-primary/20 text-primary text-xs">
                      {m.name?.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{m.role?.replace('_', ' ')}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Comments Tab */}
        <TabsContent value="comments" className="mt-4 space-y-4">
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {comments.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">No comments yet</p>
            ) : comments.map(c => (
              <div key={c.comment_id} className="flex gap-3" data-testid={`comment-${c.comment_id}`}>
                <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                  <AvatarFallback className="bg-primary/20 text-primary text-[10px]">
                    {c.user_name?.[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 bg-secondary/30 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{c.user_name}</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(c.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-foreground/90">{c.content}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input placeholder="Write a comment..." value={newComment} onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addComment()} data-testid="comment-input" />
            <Button size="icon" onClick={addComment} className="bg-primary shrink-0" data-testid="send-comment-btn">
              <Send size={16} />
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
