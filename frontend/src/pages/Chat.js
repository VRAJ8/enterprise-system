import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { chatApi, usersApi } from '../lib/api';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';
import { Send, Hash, MessageCircle, Plus, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { motion } from 'framer-motion';

export default function Chat() {
  const { user } = useAuth();
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [allUsers, setAllUsers] = useState([]);
  const [dmOpen, setDmOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const pollRef = useRef(null);

  const loadChannels = useCallback(async () => {
    try {
      const [c, u] = await Promise.all([chatApi.getChannels(), usersApi.list()]);
      setChannels(c.data);
      setAllUsers(u.data.filter(u => u.user_id !== user?.user_id));
      if (!activeChannel && c.data.length > 0) setActiveChannel(c.data[0]);
    } catch {}
  }, [user?.user_id, activeChannel]);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  const loadMessages = useCallback(async () => {
    if (!activeChannel) return;
    try {
      const res = await chatApi.getMessages(activeChannel.channel_id);
      setMessages(res.data);
    } catch {}
  }, [activeChannel]);

  useEffect(() => {
    loadMessages();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(loadMessages, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !activeChannel) return;
    try {
      await chatApi.sendMessage({ content: newMessage, channel_id: activeChannel.channel_id });
      setNewMessage('');
      loadMessages();
    } catch {}
  };

  const startDm = async (targetId) => {
    try {
      const res = await chatApi.createDm(targetId);
      setDmOpen(false);
      await loadChannels();
      setActiveChannel(res.data);
    } catch {}
  };

  const getChannelName = (ch) => {
    if (ch.type === 'dm' && ch.member_details) {
      const otherId = ch.members?.find(m => m !== user?.user_id);
      return ch.member_details[otherId]?.name || ch.name;
    }
    return ch.name;
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-[calc(100vh-8rem)]" data-testid="chat-page">
      <div className="flex h-full rounded-lg border border-border/40 overflow-hidden">
        {/* Channel sidebar */}
        <div className="w-64 border-r border-border/40 flex flex-col shrink-0 bg-card/30 hidden sm:flex" data-testid="chat-channels">
          <div className="p-3 border-b border-border/40 flex items-center justify-between">
            <span className="text-sm font-semibold font-['Outfit']">Channels</span>
            <Dialog open={dmOpen} onOpenChange={setDmOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" data-testid="new-dm-btn"><Plus size={14} /></Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle className="font-['Outfit']">Start Direct Message</DialogTitle></DialogHeader>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {allUsers.map(u => (
                    <Button key={u.user_id} variant="ghost" className="w-full justify-start gap-2" onClick={() => startDm(u.user_id)}
                      data-testid={`dm-user-${u.user_id}`}>
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="bg-primary/20 text-primary text-[10px]">{u.name?.[0]}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{u.name}</span>
                      <Badge variant="outline" className="ml-auto text-[10px] capitalize">{u.role?.replace('_', ' ')}</Badge>
                    </Button>
                  ))}
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              {channels.map(ch => (
                <button key={ch.channel_id} onClick={() => setActiveChannel(ch)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2
                    ${activeChannel?.channel_id === ch.channel_id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'}`}
                  data-testid={`channel-${ch.channel_id}`}>
                  {ch.type === 'dm' ? <MessageCircle size={14} /> : <Hash size={14} />}
                  <span className="truncate">{getChannelName(ch)}</span>
                </button>
              ))}
              {channels.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No channels yet. Create a project to start chatting!</p>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Messages area */}
        <div className="flex-1 flex flex-col">
          {activeChannel ? (
            <>
              <div className="h-12 border-b border-border/40 flex items-center px-4 gap-2 shrink-0">
                {activeChannel.type === 'dm' ? <MessageCircle size={16} /> : <Hash size={16} />}
                <span className="text-sm font-semibold">{getChannelName(activeChannel)}</span>
                <Badge variant="outline" className="ml-2 text-[10px]">
                  <Users size={10} className="mr-1" />
                  {activeChannel.members?.length || 0}
                </Badge>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="messages-area">
                {messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-12">No messages yet. Start the conversation!</p>
                ) : messages.map(m => {
                  const isMe = m.sender_id === user?.user_id;
                  return (
                    <div key={m.message_id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`} data-testid={`message-${m.message_id}`}>
                      <Avatar className="h-7 w-7 shrink-0">
                        <AvatarFallback className={`text-[10px] ${isMe ? 'bg-primary/30 text-primary' : 'bg-secondary text-foreground'}`}>
                          {m.sender_name?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className={`max-w-[70%] ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-medium">{isMe ? 'You' : m.sender_name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className={`rounded-lg px-3 py-2 text-sm ${isMe ? 'bg-primary/20 text-foreground' : 'bg-secondary/50'}`}>
                          {m.content}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-3 border-t border-border/40 flex gap-2">
                <Input value={newMessage} onChange={e => setNewMessage(e.target.value)}
                  placeholder="Type a message..." className="flex-1"
                  onKeyDown={e => e.key === 'Enter' && sendMessage()}
                  data-testid="chat-message-input" />
                <Button onClick={sendMessage} className="bg-primary shrink-0" size="icon" data-testid="chat-send-btn">
                  <Send size={16} />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a channel to start chatting
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
