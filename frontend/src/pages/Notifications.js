import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { notificationsApi, errorMessage } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import {
  Bell, CheckCheck, FolderKanban, ListTodo, MessageSquare, AlertTriangle, CalendarClock, UserPlus, X,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { EmptyState } from '../components/common';
import { timeAgo } from '../lib/constants';

const typeStyle = {
  task_assigned: { icon: ListTodo, color: 'text-blue-400' },
  task_status: { icon: ListTodo, color: 'text-violet-400' },
  project_update: { icon: FolderKanban, color: 'text-indigo-400' },
  project_added: { icon: UserPlus, color: 'text-indigo-400' },
  comment: { icon: MessageSquare, color: 'text-emerald-400' },
  deadline_warning: { icon: CalendarClock, color: 'text-amber-400' },
  deadline_overdue: { icon: AlertTriangle, color: 'text-red-400' },
};

export default function Notifications() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await notificationsApi.list({ unread_only: unreadOnly });
      setNotifications(res.data);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load notifications'));
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => { load(); }, [load]);

  const open = async (n) => {
    if (!n.read) {
      notificationsApi.markRead(n.notification_id).catch(() => {});
      setNotifications((all) => all.map((x) => (x.notification_id === n.notification_id ? { ...x, read: true } : x)));
    }
    if (n.link) navigate(n.link);
  };

  const dismiss = async (e, n) => {
    e.stopPropagation();
    setNotifications((all) => all.filter((x) => x.notification_id !== n.notification_id));
    notificationsApi.delete(n.notification_id).catch(() => {});
  };

  const markAllRead = async () => {
    try {
      await notificationsApi.markAllRead();
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const unread = notifications.filter((n) => !n.read).length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-3xl" data-testid="notifications-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold font-['Outfit'] tracking-tight">Notifications</h2>
          <p className="text-sm text-muted-foreground">{unread} unread</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            <Button variant={!unreadOnly ? 'secondary' : 'ghost'} size="sm" className="h-7" onClick={() => setUnreadOnly(false)}>All</Button>
            <Button variant={unreadOnly ? 'secondary' : 'ghost'} size="sm" className="h-7" onClick={() => setUnreadOnly(true)}>Unread</Button>
          </div>
          {unread > 0 && (
            <Button variant="outline" size="sm" onClick={markAllRead} className="gap-1 h-8" data-testid="mark-all-read-btn">
              <CheckCheck size={14} /> Mark all read
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Card key={i} className="h-16 bg-card/30 animate-pulse" />)}</div>
      ) : notifications.length === 0 ? (
        <EmptyState icon={Bell} title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
          description="Assignments, mentions, status changes and deadline reminders will appear here." />
      ) : (
        <div className="space-y-2" data-testid="notifications-list">
          {notifications.map((n) => {
            const { icon: Icon, color } = typeStyle[n.type] || { icon: Bell, color: 'text-muted-foreground' };
            return (
              <Card key={n.notification_id}
                className={`border-border/30 transition-all cursor-pointer hover:border-primary/30 group
                  ${n.read ? 'bg-card/30' : 'bg-card/70 border-l-2 border-l-primary'}`}
                onClick={() => open(n)}
                data-testid={`notification-${n.notification_id}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${n.read ? 'bg-secondary/30' : 'bg-primary/10'}`}>
                    <Icon size={14} className={color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${n.read ? 'text-muted-foreground' : 'font-medium'}`}>{n.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{n.message}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(n.created_at)}</span>
                  <button onClick={(e) => dismiss(e, n)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground" aria-label="Dismiss">
                    <X size={14} />
                  </button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
