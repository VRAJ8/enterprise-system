import React, { useState, useEffect } from 'react';
import { notificationsApi } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Bell, CheckCheck, FolderKanban, ListTodo, MessageSquare, User } from 'lucide-react';
import { motion } from 'framer-motion';

const typeIcons = {
  task_assigned: ListTodo,
  task_status: ListTodo,
  project_update: FolderKanban,
  comment: MessageSquare,
  user: User,
};
const typeColors = {
  task_assigned: 'text-blue-400',
  task_status: 'text-amber-400',
  project_update: 'text-indigo-400',
  comment: 'text-emerald-400',
  user: 'text-pink-400',
};

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadNotifs(); }, []);

  const loadNotifs = async () => {
    try {
      const res = await notificationsApi.list();
      setNotifications(res.data);
    } catch {} finally { setLoading(false); }
  };

  const markRead = async (id) => {
    try { await notificationsApi.markRead(id); loadNotifs(); } catch {}
  };
  const markAllRead = async () => {
    try { await notificationsApi.markAllRead(); loadNotifs(); } catch {}
  };

  const unread = notifications.filter(n => !n.read).length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6" data-testid="notifications-page">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold font-['Outfit'] tracking-tight">Notifications</h2>
          <p className="text-sm text-muted-foreground">{unread} unread</p>
        </div>
        {unread > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead} className="gap-1" data-testid="mark-all-read-btn">
            <CheckCheck size={14} /> Mark all read
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Card key={i} className="h-16 bg-card/30 animate-pulse" />)}</div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16">
          <Bell size={48} className="mx-auto text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground">No notifications yet</p>
        </div>
      ) : (
        <div className="space-y-2" data-testid="notifications-list">
          {notifications.map((n, i) => {
            const Icon = typeIcons[n.type] || Bell;
            const color = typeColors[n.type] || 'text-muted-foreground';
            return (
              <motion.div key={n.notification_id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}>
                <Card className={`border-border/30 transition-all cursor-pointer hover:border-primary/20
                  ${n.read ? 'bg-card/30' : 'bg-card/70 border-l-2 border-l-primary'}`}
                  onClick={() => !n.read && markRead(n.notification_id)}
                  data-testid={`notification-${n.notification_id}`}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${n.read ? 'bg-secondary/30' : 'bg-primary/10'}`}>
                      <Icon size={14} className={color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${n.read ? 'text-muted-foreground' : 'font-medium'}`}>{n.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{n.message}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground">{new Date(n.created_at).toLocaleDateString()}</p>
                      {!n.read && <Badge className="bg-primary text-[9px] px-1 mt-0.5">New</Badge>}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
