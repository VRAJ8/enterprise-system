import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { AlertTriangle, CalendarDays, CalendarRange, Clock3, Inbox, CheckCircle2, Circle, Sun, Eye, Undo2, Check } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { useAuth } from '../contexts/AuthContext';
import { useTaskDrawer } from '../contexts/TaskDrawerContext';
import { tasksApi, errorMessage } from '../lib/api';
import { PriorityFlag, StatusBadge, DueChip, EmptyState, UserAvatar } from '../components/common';

const SECTIONS = [
  { key: 'overdue', label: 'Overdue', icon: AlertTriangle, tone: 'text-red-400' },
  { key: 'today', label: 'Due today', icon: Sun, tone: 'text-orange-400' },
  { key: 'this_week', label: 'Next 7 days', icon: CalendarDays, tone: 'text-amber-300' },
  { key: 'later', label: 'Later', icon: CalendarRange, tone: 'text-muted-foreground' },
  { key: 'no_date', label: 'No due date', icon: Inbox, tone: 'text-muted-foreground' },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function MyWork() {
  const { user } = useAuth();
  const { openTask, version } = useTaskDrawer();
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      setData((await tasksApi.myWork()).data);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load your work'));
    }
  }, []);

  useEffect(() => { load(); }, [load, version]);

  const quickComplete = async (e, task) => {
    e.stopPropagation();
    try {
      await tasksApi.update(task.task_id, { status: 'completed' });
      toast.success(`Completed "${task.title}"`, {
        action: { label: 'Undo', onClick: async () => { await tasksApi.update(task.task_id, { status: task.status }); load(); } },
      });
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const review = async (task, status) => {
    try {
      await tasksApi.update(task.task_id, { status });
      toast.success(status === 'completed' ? `Approved "${task.title}"` : `Sent "${task.title}" back to In Progress`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const groups = data?.groups || {};
  const focusCount = (groups.overdue?.length || 0) + (groups.today?.length || 0) + (groups.review?.length || 0);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-4xl" data-testid="my-work-page">
      <div>
        <h2 className="text-2xl font-bold font-['Outfit'] tracking-tight">{greeting()}, {user?.name?.split(' ')[0]}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {data == null ? 'Loading your work…'
            : data.open_count === 0 && !groups.review?.length ? "You're all caught up."
            : focusCount > 0 ? `${focusCount} task${focusCount === 1 ? '' : 's'} need${focusCount === 1 ? 's' : ''} your attention today.`
            : `${data.open_count} open task${data.open_count === 1 ? '' : 's'}, nothing urgent.`}
          {groups.review?.length > 0 && ` ${groups.review.length} waiting for your review.`}
        </p>
      </div>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Open', value: data.open_count, icon: Clock3, tone: 'text-blue-400' },
            { label: 'Overdue', value: groups.overdue.length, icon: AlertTriangle, tone: 'text-red-400' },
            { label: 'Due this week', value: groups.today.length + groups.this_week.length, icon: CalendarDays, tone: 'text-amber-400' },
            { label: 'Done (7 days)', value: data.completed_last_7_days, icon: CheckCircle2, tone: 'text-emerald-400' },
          ].map((s) => (
            <Card key={s.label} className="bg-card/70 border-border/40">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider">
                  <s.icon size={14} className={s.tone} /> {s.label}
                </div>
                <p className="text-2xl font-bold font-['Outfit'] mt-1">{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {groups.review?.length > 0 && (
        <section className="space-y-2" data-testid="my-work-review">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-violet-400">
            <Eye size={15} /> Waiting for your review <Badge variant="outline" className="text-[10px]">{groups.review.length}</Badge>
          </h3>
          <Card className="bg-card/60 border-border/40 divide-y divide-border/30">
            {groups.review.map((t) => (
              <div key={t.task_id} onClick={() => openTask(t.task_id)}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/30 cursor-pointer">
                <UserAvatar name={t.assigned_to_name || '?'} className="h-6 w-6" textClass="text-[9px]" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.title}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{t.assigned_to_name || 'Unassigned'} · {t.project_name}</p>
                </div>
                <DueChip task={t} />
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={(e) => { e.stopPropagation(); review(t, 'in_progress'); }}>
                  <Undo2 size={12} /> Send back
                </Button>
                <Button size="sm" className="h-7 gap-1 text-xs bg-emerald-600 hover:bg-emerald-600/90" onClick={(e) => { e.stopPropagation(); review(t, 'completed'); }}>
                  <Check size={12} /> Approve
                </Button>
              </div>
            ))}
          </Card>
        </section>
      )}

      {data && data.open_count === 0 && !groups.review?.length && (
        <EmptyState icon={CheckCircle2} title="Inbox zero" description="No open tasks are assigned to you. New assignments will show up here." />
      )}

      {data && SECTIONS.map(({ key, label, icon: Icon, tone }) => {
        const items = groups[key] || [];
        if (!items.length) return null;
        return (
          <section key={key} className="space-y-2" data-testid={`my-work-${key}`}>
            <h3 className={`text-sm font-semibold flex items-center gap-2 ${tone}`}>
              <Icon size={15} /> {label} <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
            </h3>
            <Card className="bg-card/60 border-border/40 divide-y divide-border/30">
              {items.map((t) => (
                <div key={t.task_id} onClick={() => openTask(t.task_id)}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/30 cursor-pointer group">
                  <button onClick={(e) => quickComplete(e, t)} title="Mark complete"
                    className="text-muted-foreground hover:text-emerald-400 shrink-0" aria-label={`Complete ${t.title}`}>
                    <Circle size={17} className="group-hover:hidden" />
                    <CheckCircle2 size={17} className="hidden group-hover:block" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.title}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{t.project_name}</p>
                  </div>
                  <div className="hidden sm:block"><StatusBadge status={t.status} /></div>
                  <PriorityFlag priority={t.priority} />
                  <div className="w-24 text-right"><DueChip task={t} /></div>
                </div>
              ))}
            </Card>
          </section>
        );
      })}
    </motion.div>
  );
}
