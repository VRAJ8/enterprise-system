import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, usersApi } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Calendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Plus, Search, FolderKanban, CalendarIcon, Users, MoreVertical, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

const priorityColors = {
  low: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  high: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-400 border-red-500/20',
};
const statusColors = {
  active: 'bg-emerald-500/10 text-emerald-400',
  completed: 'bg-blue-500/10 text-blue-400',
  on_hold: 'bg-amber-500/10 text-amber-400',
  cancelled: 'bg-red-500/10 text-red-400',
};

export default function Projects() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', description: '', priority: 'medium', start_date: '', end_date: '', team_members: [] });
  const [endDate, setEndDate] = useState(null);

  const canManage = user?.role === 'admin' || user?.role === 'project_manager';

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [p, u] = await Promise.all([projectsApi.list(), usersApi.list()]);
      setProjects(p.data);
      setUsers(u.data);
    } catch {} finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const payload = { ...form };
      if (endDate) payload.end_date = format(endDate, 'yyyy-MM-dd');
      await projectsApi.create(payload);
      setOpen(false);
      setForm({ name: '', description: '', priority: 'medium', start_date: '', end_date: '', team_members: [] });
      setEndDate(null);
      loadData();
    } catch {}
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this project and all its tasks?')) return;
    try { await projectsApi.delete(id); loadData(); } catch {}
  };

  const filtered = projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6" data-testid="projects-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-['Outfit'] tracking-tight">Projects</h2>
          <p className="text-sm text-muted-foreground">{projects.length} total projects</p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-9" data-testid="project-search" />
          </div>
          {canManage && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="bg-primary hover:bg-primary/90 shadow-[0_0_12px_rgba(99,102,241,0.3)] gap-1" data-testid="create-project-btn">
                  <Plus size={16} /> New
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader><DialogTitle className="font-['Outfit']">Create Project</DialogTitle></DialogHeader>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required data-testid="project-name-input" />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} data-testid="project-desc-input" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Priority</Label>
                      <Select value={form.priority} onValueChange={v => setForm({...form, priority: v})}>
                        <SelectTrigger data-testid="project-priority-select"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="critical">Critical</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Deadline</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start text-left font-normal" data-testid="project-deadline-btn">
                            <CalendarIcon size={14} className="mr-2" />
                            {endDate ? format(endDate, 'PP') : 'Pick date'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={endDate} onSelect={setEndDate} />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Team Members</Label>
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 border rounded-md border-border">
                      {users.filter(u => u.user_id !== user?.user_id).map(u => (
                        <label key={u.user_id} className="flex items-center gap-1.5 text-xs cursor-pointer bg-secondary/50 px-2 py-1 rounded-md hover:bg-secondary">
                          <input type="checkbox" checked={form.team_members.includes(u.user_id)}
                            onChange={e => {
                              const members = e.target.checked
                                ? [...form.team_members, u.user_id]
                                : form.team_members.filter(m => m !== u.user_id);
                              setForm({...form, team_members: members});
                            }} className="rounded" />
                          {u.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <Button type="submit" className="w-full bg-primary" data-testid="project-create-submit">Create Project</Button>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Card key={i} className="h-40 bg-card/50 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <FolderKanban size={48} className="mx-auto text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground">No projects found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="projects-grid">
          {filtered.map((p, i) => (
            <motion.div key={p.project_id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}>
              <Card className="bg-card/70 border-border/40 hover:border-primary/30 transition-all cursor-pointer group"
                onClick={() => navigate(`/projects/${p.project_id}`)} data-testid={`project-card-${p.project_id}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold font-['Outfit'] truncate group-hover:text-primary transition-colors">{p.name}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{p.description || 'No description'}</p>
                    </div>
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100">
                            <MoreVertical size={14} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={e => { e.stopPropagation(); handleDelete(p.project_id); }}
                            className="text-destructive" data-testid={`delete-project-${p.project_id}`}>
                            <Trash2 size={14} className="mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={priorityColors[p.priority]}>{p.priority}</Badge>
                    <Badge variant="outline" className={statusColors[p.status] || statusColors.active}>{p.status?.replace('_', ' ')}</Badge>
                  </div>
                  <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Users size={12} />
                      <span>{p.team_members?.length || 0} members</span>
                    </div>
                    {p.end_date && <span>Due {p.end_date}</span>}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
