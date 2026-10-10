import React, { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Loader2, CheckCircle2, XCircle, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardHeader, CardContent, CardFooter } from './ui/card';
import { Textarea } from './ui/textarea';
import { aiApi, errorMessage } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useTaskDrawer } from '../contexts/TaskDrawerContext';

const MANAGER_PROMPTS = [
  "What's overdue across my projects?",
  'Who has the most open work right now?',
  'Which projects are at risk and why?',
];
const MEMBER_PROMPTS = [
  'What should I work on today?',
  'What do I have due this week?',
];

const ACTION_LABELS = { create_project: 'Created project', create_task: 'Created task', update_task: 'Updated task' };

export default function AIAssistant() {
  const { user } = useAuth();
  const { notifyChanged } = useTaskDrawer();
  const [isOpen, setIsOpen] = useState(false);
  const [enabled, setEnabled] = useState(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  const isManager = user?.role === 'admin' || user?.role === 'project_manager';
  const prompts = isManager ? MANAGER_PROMPTS : MEMBER_PROMPTS;

  useEffect(() => {
    if (isOpen && enabled === null) {
      aiApi.status().then((r) => setEnabled(r.data.enabled)).catch(() => setEnabled(false));
    }
  }, [isOpen, enabled]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const send = async (text) => {
    const message = (text ?? input).trim();
    if (!message || loading) return;
    const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text }));
    setMessages((prev) => [...prev, { role: 'user', text: message }]);
    setInput('');
    setLoading(true);
    try {
      const res = await aiApi.chat(message, history);
      const { reply, actions = [] } = res.data;
      setMessages((prev) => [...prev, { role: 'ai', text: reply, actions }]);
      if (actions.some((a) => a.ok)) notifyChanged();
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'ai', error: true, text: errorMessage(err, "Sorry, I couldn't reach the assistant.") }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end">
      {isOpen && (
        <Card className="w-[calc(100vw-3rem)] sm:w-96 h-[540px] max-h-[75vh] mb-4 shadow-2xl flex flex-col border-primary/20 animate-in slide-in-from-bottom-5" data-testid="ai-panel">
          <CardHeader className="p-4 bg-primary text-primary-foreground flex flex-row items-center justify-between rounded-t-lg space-y-0">
            <div className="flex items-center gap-2">
              <Bot size={20} />
              <div>
                <p className="font-semibold tracking-tight leading-none">Project Assistant</p>
                <p className="text-[11px] opacity-80 mt-1">Answers from your projects · can make changes for you</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-primary-foreground/10" onClick={() => setIsOpen(false)} aria-label="Close assistant">
              <X size={18} />
            </Button>
          </CardHeader>

          <CardContent ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/30">
            {enabled === false && (
              <div className="text-sm text-muted-foreground bg-card border rounded-lg p-3">
                The assistant isn't configured on this server. An administrator can enable it by setting
                <code className="mx-1 text-xs">GROQ_API_KEY</code> in the backend environment.
              </div>
            )}
            {enabled !== false && messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Hi {user?.name?.split(' ')[0]}! Ask me about deadlines, workload or progress
                  {isManager ? ', or ask me to create and assign tasks.' : ', or to update your tasks.'}
                </p>
                <div className="flex flex-col gap-2">
                  {prompts.map((p) => (
                    <button key={p} onClick={() => send(p)}
                      className="text-left text-sm px-3 py-2 rounded-lg border border-border bg-card hover:border-primary/40 flex items-center gap-2">
                      <Sparkles size={13} className="text-primary shrink-0" /> {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-tr-none'
                    : msg.error
                      ? 'bg-destructive/10 border border-destructive/30 text-destructive rounded-tl-none'
                      : 'bg-card border rounded-tl-none shadow-sm'
                }`}>
                  {msg.text}
                  {msg.actions?.length > 0 && (
                    <ul className="mt-2 pt-2 border-t border-border/50 space-y-1">
                      {msg.actions.map((a, j) => (
                        <li key={j} className={`text-xs flex items-start gap-1.5 ${a.ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {a.ok ? <CheckCircle2 size={12} className="mt-0.5 shrink-0" /> : <XCircle size={12} className="mt-0.5 shrink-0" />}
                          <span>{a.ok ? `${ACTION_LABELS[a.tool] || a.tool}: ${a.title || a.name || ''}` : `Couldn't ${(ACTION_LABELS[a.tool] || a.tool).toLowerCase()}: ${a.error}`}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-card border px-3 py-2 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Thinking…</span>
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="p-3 border-t bg-card rounded-b-lg">
            <div className="flex w-full gap-2 items-end">
              <Textarea
                rows={1}
                placeholder={enabled === false ? 'Assistant unavailable' : 'Ask about your projects…'}
                value={input}
                disabled={enabled === false}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                className="bg-muted/50 border-none focus-visible:ring-1 min-h-[40px] max-h-28 resize-none text-sm"
                data-testid="ai-input"
              />
              <Button size="icon" onClick={() => send()} disabled={loading || !input.trim() || enabled === false} aria-label="Send">
                <Send size={18} />
              </Button>
            </div>
          </CardFooter>
        </Card>
      )}

      <Button
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 rounded-full shadow-xl hover:scale-105 transition-transform"
        size="icon"
        aria-label={isOpen ? 'Close assistant' : 'Open assistant'}
        data-testid="ai-toggle"
      >
        {isOpen ? <X size={28} /> : <Bot size={28} />}
      </Button>
    </div>
  );
}
