import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTaskDrawer } from '../contexts/TaskDrawerContext';
import { dashboardApi } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import {
  FolderKanban, ListTodo, Users, CheckCircle, AlertTriangle, CalendarClock, TrendingUp, Activity,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { motion } from 'framer-motion';
import { HealthBadge, ProgressBar, UserAvatar } from '../components/common';
import { statusConfig, healthConfig, formatDate, roleLabel, timeAgo } from '../lib/constants';

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } } };

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover/95 backdrop-blur-md border border-border px-3 py-2 rounded-md shadow-lg text-sm">
      {label && <p className="font-medium mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || p.payload?.fill }} className="text-xs">{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

const axis = { fill: '#a1a1aa', fontSize: 11 };

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openTask } = useTaskDrawer();
  const [stats, setStats] = useState(null);
  const [charts, setCharts] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [workload, setWorkload] = useState([]);
  const [activity, setActivity] = useState([]);

  const isManager = user?.role === 'admin' || user?.role === 'project_manager';

  useEffect(() => {
    Promise.allSettled([
      dashboardApi.stats(), dashboardApi.charts(), dashboardApi.portfolio(),
      isManager ? dashboardApi.workload() : Promise.resolve({ data: [] }),
      dashboardApi.activity({ limit: 15 }),
    ]).then(([s, c, p, w, a]) => {
      if (s.status === 'fulfilled') setStats(s.value.data);
      if (c.status === 'fulfilled') setCharts(c.value.data);
      if (p.status === 'fulfilled') setPortfolio(p.value.data);
      if (w.status === 'fulfilled') setWorkload(w.value.data);
      if (a.status === 'fulfilled') setActivity(a.value.data);
    });
  }, [isManager]);

  const statCards = stats ? [
    ...(user?.role === 'admin' ? [{ label: 'People', value: stats.total_users, icon: Users, color: 'text-blue-400', to: '/users' }] : []),
    { label: 'Active projects', value: stats.active_projects, icon: FolderKanban, color: 'text-indigo-400', to: '/projects' },
    { label: isManager ? 'Open tasks' : 'My open tasks', value: stats.total_tasks - stats.tasks_completed, icon: ListTodo, color: 'text-sky-400', to: '/tasks' },
    { label: 'Overdue', value: stats.tasks_overdue, icon: AlertTriangle, color: stats.tasks_overdue ? 'text-red-400' : 'text-muted-foreground', to: '/tasks', alert: stats.tasks_overdue > 0 },
    { label: 'Due in 7 days', value: stats.tasks_due_this_week, icon: CalendarClock, color: 'text-amber-400', to: '/my-work' },
    { label: 'Completed', value: stats.tasks_completed, icon: CheckCircle, color: 'text-emerald-400' },
    { label: 'Completion', value: `${stats.completion_rate}%`, icon: TrendingUp, color: 'text-pink-400' },
  ] : [];

  const taskStatusData = stats ? [
    { name: statusConfig.todo.label, value: stats.tasks_todo, fill: statusConfig.todo.hex },
    { name: statusConfig.in_progress.label, value: stats.tasks_in_progress, fill: statusConfig.in_progress.hex },
    { name: statusConfig.in_review.label, value: stats.tasks_in_review, fill: statusConfig.in_review.hex },
    { name: statusConfig.completed.label, value: stats.tasks_completed, fill: statusConfig.completed.hex },
  ].filter((d) => d.value > 0) : [];

  const summary = portfolio?.summary || {};
  const attention = (portfolio?.projects || []).filter((p) => ['off_track', 'at_risk'].includes(p.health));

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6" data-testid="dashboard-page">
      <motion.div variants={item}>
        <h2 className="text-2xl sm:text-3xl font-bold font-['Outfit'] tracking-tight">
          Welcome back, <span className="text-primary">{user?.name?.split(' ')[0]}</span>
        </h2>
        <div className="text-muted-foreground mt-1 flex items-center gap-2 text-sm">
          <Badge variant="outline">{roleLabel(user?.role)}</Badge>
          <span>{isManager ? "Here's how your portfolio is tracking" : "Here's your work at a glance"}</span>
        </div>
      </motion.div>

      <motion.div variants={item} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {statCards.map((s) => (
          <Card key={s.label} onClick={() => s.to && navigate(s.to)}
            className={`bg-card/70 border-border/40 transition-colors ${s.to ? 'cursor-pointer hover:border-primary/30' : ''} ${s.alert ? 'border-red-500/30' : ''}`}
            data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, '-')}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <s.icon size={15} className={s.color} />
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider truncate">{s.label}</span>
              </div>
              <p className="text-2xl font-bold font-['Outfit']">{s.value ?? '—'}</p>
            </CardContent>
          </Card>
        ))}
      </motion.div>

      {/* Portfolio health */}
      <motion.div variants={item} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="bg-card/70 border-border/40 lg:col-span-7">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-['Outfit']">Portfolio health</CardTitle>
            <CardDescription>Progress compared against schedule for every open project</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              {['on_track', 'at_risk', 'off_track', 'on_hold'].map((h) => (
                <div key={h} className="flex items-center gap-2 rounded-md border border-border/40 px-3 py-1.5">
                  <span className={`w-2 h-2 rounded-full ${healthConfig[h].dot}`} />
                  <span className="text-xs text-muted-foreground">{healthConfig[h].label}</span>
                  <span className="text-sm font-semibold">{summary[h] || 0}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1">
              {(portfolio?.projects || []).length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">No open projects</p>}
              {(portfolio?.projects || []).map((p) => (
                <button key={p.project_id} onClick={() => navigate(`/projects/${p.project_id}`)}
                  className="w-full text-left grid grid-cols-12 items-center gap-3 rounded-md px-2 py-2 hover:bg-secondary/40">
                  <span className="col-span-5 sm:col-span-4 text-sm truncate">{p.name}</span>
                  <span className="col-span-3 hidden sm:block"><HealthBadge health={p.health} reason={p.reason} /></span>
                  <span className="col-span-5 sm:col-span-3"><ProgressBar value={p.progress}
                    barClass={p.health === 'off_track' ? 'bg-red-500' : p.health === 'at_risk' ? 'bg-amber-500' : 'bg-primary'} /></span>
                  <span className="col-span-2 text-xs text-right text-muted-foreground">{p.end_date ? formatDate(p.end_date) : '—'}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/70 border-border/40 lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-['Outfit'] flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-400" /> Needs attention
            </CardTitle>
            <CardDescription>Projects behind schedule or with overdue work</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {attention.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Everything is on track.</p>
            ) : attention.slice(0, 6).map((p) => (
              <button key={p.project_id} onClick={() => navigate(`/projects/${p.project_id}`)}
                className="w-full text-left rounded-md border border-border/40 px-3 py-2 hover:border-primary/30">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{p.name}</span>
                  <HealthBadge health={p.health} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{p.reason}</p>
              </button>
            ))}
          </CardContent>
        </Card>
      </motion.div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <motion.div variants={item} className="lg:col-span-4">
          <Card className="bg-card/70 border-border/40 h-full">
            <CardHeader className="pb-2"><CardTitle className="text-base font-['Outfit']">Task status</CardTitle></CardHeader>
            <CardContent>
              {taskStatusData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-16 text-center">No tasks yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={taskStatusData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
                      {taskStatusData.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="transparent" />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={item} className="lg:col-span-8">
          <Card className="bg-card/70 border-border/40 h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-['Outfit']">Throughput</CardTitle>
              <CardDescription>Tasks completed per week</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={charts?.throughput || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" tick={axis} />
                  <YAxis tick={axis} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="Completed" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {isManager && (
          <motion.div variants={item} className="lg:col-span-7">
            <Card className="bg-card/70 border-border/40 h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-['Outfit']">Team workload</CardTitle>
                <CardDescription>Estimated open work vs. weekly capacity</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5 max-h-[320px] overflow-y-auto">
                {workload.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No team members yet</p>}
                {workload.map((w) => (
                  <div key={w.user_id} className="grid grid-cols-12 gap-3 items-center">
                    <div className="col-span-4 flex items-center gap-2 min-w-0">
                      <UserAvatar name={w.name} className="h-6 w-6" textClass="text-[9px]" />
                      <span className="text-sm truncate">{w.name}</span>
                    </div>
                    <div className="col-span-5">
                      <ProgressBar value={Math.min(w.load_percent, 100)}
                        barClass={w.status === 'overloaded' ? 'bg-red-500' : w.status === 'busy' ? 'bg-amber-500' : 'bg-emerald-500'} />
                    </div>
                    <div className="col-span-3 text-right text-xs text-muted-foreground">
                      <span className={w.status === 'overloaded' ? 'text-red-400 font-medium' : ''}>{w.estimated_hours}h/{w.capacity_hours}h</span>
                      <span className="block">{w.open_tasks} open{w.overdue ? <span className="text-red-400"> · {w.overdue} late</span> : ''}</span>
                    </div>
                  </div>
                ))}
                {workload.some((w) => w.unestimated > 0) && (
                  <p className="text-[11px] text-muted-foreground pt-1">Some tasks have no estimate. Add hours to tasks to make this view more accurate.</p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        <motion.div variants={item} className={isManager ? 'lg:col-span-5' : 'lg:col-span-12'}>
          <Card className="bg-card/70 border-border/40 h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-['Outfit'] flex items-center gap-2"><Activity size={15} /> Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[320px] overflow-y-auto pr-2">
                {activity.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No recent activity</p>
                ) : activity.map((a) => (
                  <div key={a.activity_id} className="flex items-start gap-3 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p>
                        <span className="font-medium">{a.user_name}</span>
                        <span className="text-muted-foreground"> {a.action} </span>
                        {a.entity_type === 'task' ? (
                          <button className="text-primary hover:underline" onClick={() => openTask(a.entity_id)}>{a.entity_name}</button>
                        ) : a.entity_type === 'project' && a.action !== 'deleted' ? (
                          <button className="text-primary hover:underline" onClick={() => navigate(`/projects/${a.entity_id}`)}>{a.entity_name}</button>
                        ) : <span className="text-primary">{a.entity_name}</span>}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{timeAgo(a.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
