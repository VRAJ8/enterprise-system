import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { dashboardApi } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { FolderKanban, ListTodo, Users, CheckCircle, Clock, AlertCircle, TrendingUp } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area
} from 'recharts';
import { motion } from 'framer-motion';

const COLORS = ['#6366f1', '#10b981', '#3b82f6', '#f59e0b', '#ec4899'];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } }
};
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } }
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover/95 backdrop-blur-md border border-border px-3 py-2 rounded-md shadow-lg text-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="text-xs">{p.name}: {p.value}</p>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [charts, setCharts] = useState(null);
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, c, a] = await Promise.all([
          dashboardApi.stats(),
          dashboardApi.charts(),
          dashboardApi.activity({ limit: 10 }),
        ]);
        setStats(s.data);
        setCharts(c.data);
        setActivity(a.data);
      } catch {}
    };
    load();
  }, []);

  const statCards = stats ? [
    ...(user?.role === 'admin' ? [{ label: 'Total Users', value: stats.total_users, icon: Users, color: 'text-blue-400' }] : []),
    { label: 'Projects', value: stats.total_projects ?? stats.active_projects, icon: FolderKanban, color: 'text-indigo-400' },
    { label: 'Total Tasks', value: stats.total_tasks, icon: ListTodo, color: 'text-amber-400' },
    { label: 'Completed', value: stats.tasks_completed, icon: CheckCircle, color: 'text-emerald-400' },
    { label: 'In Progress', value: stats.tasks_in_progress, icon: Clock, color: 'text-sky-400' },
    { label: 'To Do', value: stats.tasks_todo, icon: AlertCircle, color: 'text-orange-400' },
    { label: 'Completion', value: `${stats.completion_rate}%`, icon: TrendingUp, color: 'text-pink-400' },
  ] : [];

  const taskStatusData = stats ? [
    { name: 'To Do', value: stats.tasks_todo, fill: '#f59e0b' },
    { name: 'In Progress', value: stats.tasks_in_progress, fill: '#3b82f6' },
    { name: 'Completed', value: stats.tasks_completed, fill: '#10b981' },
  ] : [];

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6" data-testid="dashboard-page">
      {/* Welcome */}
      <motion.div variants={item}>
        <h2 className="text-2xl sm:text-3xl font-bold font-['Outfit'] tracking-tight">
          Welcome back, <span className="text-primary">{user?.name}</span>
        </h2>
        <div className="text-muted-foreground mt-1 flex items-center gap-2">
          <Badge variant="outline" className="capitalize">{user?.role?.replace('_', ' ')}</Badge>
          <span>Here's your project overview</span>
        </div>
      </motion.div>

      {/* Stat Cards */}
      <motion.div variants={item} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        {statCards.map((s, i) => (
          <Card key={i} className="bg-card/70 border-border/40 hover:border-primary/30 transition-colors" data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, '-')}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <s.icon size={16} className={s.color} />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</span>
              </div>
              <p className="text-2xl font-bold font-['Outfit']">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </motion.div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Task Status Pie */}
        <motion.div variants={item} className="lg:col-span-4">
          <Card className="bg-card/70 border-border/40 h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-['Outfit']">Task Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={taskStatusData} cx="50%" cy="50%" innerRadius={60} outerRadius={90}
                    paddingAngle={4} dataKey="value" animationBegin={0} animationDuration={800}>
                    {taskStatusData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* Project Tasks Bar Chart */}
        <motion.div variants={item} className="lg:col-span-8">
          <Card className="bg-card/70 border-border/40 h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-['Outfit']">Tasks by Project</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={charts?.project_tasks || []} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="Todo" fill="#f59e0b" radius={[4, 4, 0, 0]} animationDuration={800} />
                  <Bar dataKey="In Progress" fill="#3b82f6" radius={[4, 4, 0, 0]} animationDuration={800} animationBegin={200} />
                  <Bar dataKey="Completed" fill="#10b981" radius={[4, 4, 0, 0]} animationDuration={800} animationBegin={400} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Priority & Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Priority Chart */}
        <motion.div variants={item} className="lg:col-span-5">
          <Card className="bg-card/70 border-border/40 h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-['Outfit']">Priority Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={charts?.priority_distribution || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <defs>
                    <linearGradient id="colorPri" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="value" stroke="#6366f1" fill="url(#colorPri)" strokeWidth={2} animationDuration={1000} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* Recent Activity */}
        <motion.div variants={item} className="lg:col-span-7">
          <Card className="bg-card/70 border-border/40 h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-['Outfit']">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[240px] overflow-y-auto pr-2">
                {activity.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No recent activity</p>
                ) : activity.map((a, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
                    <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground">
                        <span className="font-medium">{a.user_name}</span>
                        <span className="text-muted-foreground"> {a.action} </span>
                        <span className="text-primary">{a.entity_name}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(a.created_at).toLocaleString()}
                      </p>
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
