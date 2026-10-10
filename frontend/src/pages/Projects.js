import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, errorMessage } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { Plus, Search, FolderKanban, Users, MoreVertical, Trash2, Edit2, AlertTriangle, CalendarDays } from 'lucide-react';
import { motion } from 'framer-motion';
import ProjectFormDialog from '../components/ProjectFormDialog';
import { HealthBadge, ProjectStatusBadge, ProgressBar, EmptyState } from '../components/common';
import { PROJECT_STATUSES, projectStatusConfig, priorityConfig, healthConfig, formatDate, daysUntil } from '../lib/constants';

const ALL = 'all';
const OPEN = 'open';

export default function Projects() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(OPEN);
  const [healthFilter, setHealthFilter] = useState(ALL);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  const canCreate = user?.role === 'admin' || user?.role === 'project_manager';

  const load = useCallback(async () => {
    try {
      setProjects((await projectsApi.list()).data);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load projects'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (p) => {
    if (!window.confirm(`Delete "${p.name}" and all of its tasks, milestones, comments and files? This cannot be undone.`)) return;
    try {
      await projectsApi.delete(p.project_id);
      toast.success('Project deleted');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const filtered = useMemo(() => projects.filter((p) => {
    if (!p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter === OPEN && ['completed', 'cancelled'].includes(p.status)) return false;
    if (![ALL, OPEN].includes(statusFilter) && p.status !== statusFilter) return false;
    if (healthFilter !== ALL && p.health !== healthFilter) return false;
    return true;
  }), [projects, search, statusFilter, healthFilter]);

  const atRisk = projects.filter((p) => ['at_risk', 'off_track'].includes(p.health)).length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5" data-testid="projects-page">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-['Outfit'] tracking-tight">Projects</h2>
          <p className="text-sm text-muted-foreground">
            {projects.length} projects{atRisk > 0 && <span className="text-amber-400"> · {atRisk} need attention</span>}
          </p>
        </div>
        {canCreate && (
          <Button className="gap-1" onClick={() => { setEditing(null); setFormOpen(true); }} data-testid="create-project-btn">
            <Plus size={16} /> New project
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search projects…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" data-testid="project-search" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={OPEN}>Open projects</SelectItem>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s}>{projectStatusConfig[s].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={healthFilter} onValueChange={setHealthFilter}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any health</SelectItem>
            {['on_track', 'at_risk', 'off_track'].map((h) => <SelectItem key={h} value={h}>{healthConfig[h].label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Card key={i} className="h-44 bg-card/50 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={FolderKanban}
          title={projects.length ? 'No projects match these filters' : 'No projects yet'}
          description={projects.length ? 'Try clearing the filters.' : canCreate ? 'Create your first project to start planning work.' : "You'll see projects here once you're added to a team."}
          action={!projects.length && canCreate && <Button size="sm" onClick={() => setFormOpen(true)}><Plus size={14} className="mr-1" /> New project</Button>} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="projects-grid">
          {filtered.map((p, i) => {
            const days = daysUntil(p.end_date);
            const stats = p.task_stats || {};
            return (
              <motion.div key={p.project_id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 10) * 0.04 }}>
                <Card className="bg-card/70 border-border/40 hover:border-primary/30 transition-all cursor-pointer group h-full"
                  onClick={() => navigate(`/projects/${p.project_id}`)} data-testid={`project-card-${p.project_id}`}>
                  <CardContent className="p-5 flex flex-col h-full">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold font-['Outfit'] truncate group-hover:text-primary transition-colors">{p.name}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{p.description || 'No description'}</p>
                      </div>
                      {p.can_manage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-60 group-hover:opacity-100" aria-label="Project actions">
                              <MoreVertical size={14} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
                            <DropdownMenuItem onClick={() => { setEditing(p); setFormOpen(true); }}>
                              <Edit2 size={14} className="mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDelete(p)} className="text-destructive" data-testid={`delete-project-${p.project_id}`}>
                              <Trash2 size={14} className="mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap mb-4">
                      <ProjectStatusBadge status={p.status} />
                      <HealthBadge health={p.health} reason={p.reason} />
                      <span className={`text-[11px] ${priorityConfig[p.priority]?.color}`}>{priorityConfig[p.priority]?.label}</span>
                    </div>

                    <div className="mt-auto space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{stats.completed || 0}/{stats.total || 0} tasks</span>
                        <span className="font-medium">{p.progress}%</span>
                      </div>
                      <ProgressBar value={p.progress} />
                      {p.reason && <p className="text-[11px] text-amber-400/90 flex items-center gap-1"><AlertTriangle size={11} /> {p.reason}</p>}
                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                        <span className="flex items-center gap-1"><Users size={12} /> {p.team_members?.length || 0}</span>
                        {p.end_date && (
                          <span className={`flex items-center gap-1 ${days < 0 && !['completed', 'cancelled'].includes(p.status) ? 'text-red-400' : ''}`}>
                            <CalendarDays size={12} /> {formatDate(p.end_date)}
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <ProjectFormDialog open={formOpen} onOpenChange={setFormOpen} project={editing}
        onSaved={(p) => (editing ? load() : navigate(`/projects/${p.project_id}`))} />
    </motion.div>
  );
}
