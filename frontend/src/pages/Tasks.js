import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { tasksApi, projectsApi, usersApi } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from '../components/ui/dropdown-menu';
import { Circle, Clock, CheckCircle, Flag, MoreVertical, Trash2, ArrowRight, Filter } from 'lucide-react';
import { motion } from 'framer-motion';

const statusConfig = {
  todo: { label: 'To Do', icon: Circle, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  in_progress: { label: 'In Progress', icon: Clock, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  completed: { label: 'Completed', icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
};
const priorityColors = { low: 'text-emerald-400', medium: 'text-amber-400', high: 'text-orange-400', critical: 'text-red-400' };

export default function Tasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState([]);
  const [filterProject, setFilterProject] = useState('all');
  const [loading, setLoading] = useState(true);

  const canManage = user?.role === 'admin' || user?.role === 'project_manager';

  const loadTasks = useCallback(async () => {
    try {
      const params = {};
      if (filterProject !== 'all') params.project_id = filterProject;
      const [t, p] = await Promise.all([tasksApi.list(params), projectsApi.list()]);
      setTasks(t.data);
      setProjects(p.data);
    } catch {} finally { setLoading(false); }
  }, [filterProject]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const updateStatus = async (taskId, newStatus) => {
    try { await tasksApi.update(taskId, { status: newStatus }); loadTasks(); } catch {}
  };
  const deleteTask = async (taskId) => {
    if (!window.confirm('Delete this task?')) return;
    try { await tasksApi.delete(taskId); loadTasks(); } catch {}
  };

  const columns = ['todo', 'in_progress', 'completed'];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6" data-testid="tasks-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-['Outfit'] tracking-tight">Task Board</h2>
          <p className="text-sm text-muted-foreground">{tasks.length} total tasks</p>
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-muted-foreground" />
          <Select value={filterProject} onValueChange={setFilterProject}>
            <SelectTrigger className="w-48" data-testid="task-filter-project">
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map(p => (
                <SelectItem key={p.project_id} value={p.project_id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1,2,3].map(i => <div key={i} className="h-96 bg-card/30 rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6" data-testid="kanban-board">
          {columns.map(status => {
            const config = statusConfig[status];
            const StatusIcon = config.icon;
            const columnTasks = tasks.filter(t => t.status === status);
            const nextStatus = status === 'todo' ? 'in_progress' : status === 'in_progress' ? 'completed' : null;

            return (
              <div key={status} className="space-y-3" data-testid={`column-${status}`}>
                <div className={`flex items-center gap-2 p-3 rounded-lg ${config.bg} border ${config.border}`}>
                  <StatusIcon size={16} className={config.color} />
                  <span className="text-sm font-semibold">{config.label}</span>
                  <Badge variant="outline" className="ml-auto text-xs">{columnTasks.length}</Badge>
                </div>

                <div className="space-y-2 min-h-[200px]">
                  {columnTasks.map((task, i) => (
                    <motion.div key={task.task_id} initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.03 }}>
                      <Card className="bg-card/60 border-border/30 hover:border-primary/20 transition-all group"
                        data-testid={`task-card-${task.task_id}`}>
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-start justify-between">
                            <p className="text-sm font-medium flex-1 pr-2">{task.title}</p>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100">
                                  <MoreVertical size={12} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                {nextStatus && (
                                  <DropdownMenuItem onClick={() => updateStatus(task.task_id, nextStatus)}
                                    data-testid={`move-task-${task.task_id}`}>
                                    <ArrowRight size={12} className="mr-2" /> Move to {statusConfig[nextStatus].label}
                                  </DropdownMenuItem>
                                )}
                                {status === 'completed' && (
                                  <DropdownMenuItem onClick={() => updateStatus(task.task_id, 'in_progress')}>
                                    <ArrowRight size={12} className="mr-2" /> Move back
                                  </DropdownMenuItem>
                                )}
                                {canManage && (
                                  <DropdownMenuItem onClick={() => deleteTask(task.task_id)} className="text-destructive"
                                    data-testid={`delete-task-${task.task_id}`}>
                                    <Trash2 size={12} className="mr-2" /> Delete
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {task.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
                          )}

                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground truncate max-w-[120px]">
                              {task.project_name || 'Unknown'}
                            </span>
                            <div className="flex items-center gap-2">
                              <Flag size={10} className={priorityColors[task.priority]} />
                              {task.assigned_to_name && (
                                <span className="text-muted-foreground">{task.assigned_to_name.split(' ')[0]}</span>
                              )}
                            </div>
                          </div>

                          {task.due_date && (
                            <p className="text-[10px] text-muted-foreground">Due: {task.due_date}</p>
                          )}
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
