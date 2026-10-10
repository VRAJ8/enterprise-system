import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { chatApi, usersApi, errorMessage } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Send, Hash, MessageCircle, Plus, Users, ArrowLeft, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { motion } from 'framer-motion';
import { UserAvatar } from '../components/common';
import { roleLabel, timeAgo } from '../lib/constants';

export default function Chat() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [channels, setChannels] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [allUsers, setAllUsers] = useState([]);
  const [dmOpen, setDmOpen] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  const activeChannel = channels.find((c) => c.channel_id === activeId) || null;

  const loadChannels = useCallback(async () => {
    try {
      const c = await chatApi.getChannels();
      setChannels(c.data);
      return c.data;
    } catch {
      return [];
    }
  }, []);

  const startDm = useCallback(async (targetId) => {
    try {
      const res = await chatApi.createDm(targetId);
      setDmOpen(false);
      await loadChannels();
      setActiveId(res.data.channel_id);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not open conversation'));
    }
  }, [loadChannels]);

  useEffect(() => {
    (async () => {
      const [chs, u] = await Promise.all([loadChannels(), usersApi.list().catch(() => ({ data: [] }))]);
      setAllUsers(u.data.filter((x) => x.user_id !== user?.user_id));
      const dmWith = location.state?.dmWith;
      if (dmWith) {
        navigate(location.pathname, { replace: true, state: null });
        startDm(dmWith);
      } else if (chs.length && window.innerWidth >= 640) {
        setActiveId(chs[0].channel_id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMessages = useCallback(async () => {
    if (!activeId) return;
    try {
      const res = await chatApi.getMessages(activeId);
      setMessages(res.data);
    } catch {}
  }, [activeId]);

  useEffect(() => {
    setMessages([]);
    loadMessages().then(() => setChannels((chs) => chs.map((c) => (c.channel_id === activeId ? { ...c, unread_count: 0 } : c))));
    const msgTimer = setInterval(loadMessages, 4000);
    const chTimer = setInterval(loadChannels, 15000);
    return () => { clearInterval(msgTimer); clearInterval(chTimer); };
  }, [activeId, loadMessages, loadChannels]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!newMessage.trim() || !activeChannel || sending) return;
    setSending(true);
    try {
      const res = await chatApi.sendMessage({ content: newMessage, channel_id: activeChannel.channel_id });
      setMessages((m) => [...m, res.data]);
      setNewMessage('');
    } catch (err) {
      toast.error(errorMessage(err, 'Message not sent'));
    } finally {
      setSending(false);
    }
  };

  const channelName = (ch) => {
    if (ch?.type === 'dm' && ch.member_details) {
      const otherId = ch.members?.find((m) => m !== user?.user_id);
      return ch.member_details[otherId]?.name || ch.name;
    }
    return ch?.name;
  };

  const projectChannels = channels.filter((c) => c.type !== 'dm');
  const dmChannels = channels.filter((c) => c.type === 'dm');
  const dmCandidates = allUsers.filter((u) => u.name.toLowerCase().includes(dmSearch.toLowerCase()));

  const ChannelButton = ({ ch }) => (
    <button onClick={() => setActiveId(ch.channel_id)}
      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2
        ${activeId === ch.channel_id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'}`}
      data-testid={`channel-${ch.channel_id}`}>
      {ch.type === 'dm' ? <UserAvatar name={channelName(ch)} className="h-5 w-5" textClass="text-[8px]" /> : <Hash size={14} />}
      <span className={`truncate flex-1 ${ch.unread_count ? 'text-foreground font-semibold' : ''}`}>{channelName(ch)}</span>
      {ch.unread_count > 0 && <Badge className="bg-primary text-[10px] h-4 px-1.5">{ch.unread_count}</Badge>}
    </button>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-[calc(100vh-8rem)]" data-testid="chat-page">
      <div className="flex h-full rounded-lg border border-border/40 overflow-hidden">
        {/* Channel list (full width on mobile when no channel is open) */}
        <div className={`w-full sm:w-64 border-r border-border/40 flex-col shrink-0 bg-card/30 ${activeId ? 'hidden sm:flex' : 'flex'}`} data-testid="chat-channels">
          <div className="p-3 border-b border-border/40 flex items-center justify-between">
            <span className="text-sm font-semibold font-['Outfit']">Conversations</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDmOpen(true)} data-testid="new-dm-btn" aria-label="New direct message">
              <Plus size={14} />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-3">
              <div className="space-y-0.5">
                <p className="px-3 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">Project channels</p>
                {projectChannels.map((ch) => <ChannelButton key={ch.channel_id} ch={ch} />)}
                {projectChannels.length === 0 && <p className="px-3 text-xs text-muted-foreground">Join a project to get its channel.</p>}
              </div>
              <div className="space-y-0.5">
                <p className="px-3 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">Direct messages</p>
                {dmChannels.map((ch) => <ChannelButton key={ch.channel_id} ch={ch} />)}
                {dmChannels.length === 0 && (
                  <button onClick={() => setDmOpen(true)} className="px-3 text-xs text-primary hover:underline">Start a conversation</button>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>

        {/* Messages */}
        <div className={`flex-1 flex-col min-w-0 ${activeId ? 'flex' : 'hidden sm:flex'}`}>
          {activeChannel ? (
            <>
              <div className="h-12 border-b border-border/40 flex items-center px-3 gap-2 shrink-0">
                <Button variant="ghost" size="icon" className="h-8 w-8 sm:hidden" onClick={() => setActiveId(null)} aria-label="Back">
                  <ArrowLeft size={16} />
                </Button>
                {activeChannel.type === 'dm' ? <MessageCircle size={16} /> : <Hash size={16} />}
                <span className="text-sm font-semibold truncate">{channelName(activeChannel)}</span>
                <Badge variant="outline" className="ml-1 text-[10px]">
                  <Users size={10} className="mr-1" /> {activeChannel.members?.length || 0}
                </Badge>
                {activeChannel.project_id && (
                  <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => navigate(`/projects/${activeChannel.project_id}`)}>
                    Open project
                  </Button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="messages-area">
                {messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-12">No messages yet. Start the conversation!</p>
                ) : messages.map((m, i) => {
                  const isMe = m.sender_id === user?.user_id;
                  const grouped = i > 0 && messages[i - 1].sender_id === m.sender_id
                    && new Date(m.created_at) - new Date(messages[i - 1].created_at) < 5 * 60 * 1000;
                  return (
                    <div key={m.message_id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''} ${grouped ? '-mt-3' : ''}`} data-testid={`message-${m.message_id}`}>
                      <div className="w-7 shrink-0">{!grouped && <UserAvatar name={m.sender_name} />}</div>
                      <div className={`max-w-[75%] ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
                        {!grouped && (
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-medium">{isMe ? 'You' : m.sender_name}</span>
                            <span className="text-[10px] text-muted-foreground" title={new Date(m.created_at).toLocaleString()}>{timeAgo(m.created_at)}</span>
                          </div>
                        )}
                        <div className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${isMe ? 'bg-primary/20 text-foreground' : 'bg-secondary/50'}`}>
                          {m.content}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={sendMessage} className="p-3 border-t border-border/40 flex gap-2">
                <Input value={newMessage} onChange={(e) => setNewMessage(e.target.value)}
                  placeholder={`Message ${activeChannel.type === 'dm' ? channelName(activeChannel) : '#' + channelName(activeChannel)}`}
                  className="flex-1" data-testid="chat-message-input" />
                <Button type="submit" className="shrink-0" size="icon" disabled={!newMessage.trim() || sending} data-testid="chat-send-btn" aria-label="Send">
                  <Send size={16} />
                </Button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a conversation
            </div>
          )}
        </div>
      </div>

      <Dialog open={dmOpen} onOpenChange={setDmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-['Outfit']">New direct message</DialogTitle></DialogHeader>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={dmSearch} onChange={(e) => setDmSearch(e.target.value)} placeholder="Find a person…" className="pl-8" autoFocus />
          </div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {dmCandidates.map((u) => (
              <Button key={u.user_id} variant="ghost" className="w-full justify-start gap-2 h-10" onClick={() => startDm(u.user_id)} data-testid={`dm-user-${u.user_id}`}>
                <UserAvatar name={u.name} className="h-6 w-6" textClass="text-[9px]" />
                <span className="text-sm">{u.name}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">{u.department || roleLabel(u.role)}</span>
              </Button>
            ))}
            {dmCandidates.length === 0 && <p className="text-sm text-muted-foreground p-2">No people found.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
