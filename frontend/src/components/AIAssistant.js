// frontend/src/components/AIAssistant.js
import React, { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardHeader, CardContent, CardFooter } from './ui/card';
import { Input } from './ui/input';

export default function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    { role: 'ai', text: 'Hello! I can help you with project tasks and deadlines. What’s on your mind?' }
  ]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMsg = { role: 'user', text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch("http://localhost:8000/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });
      const data = await response.json();
      setMessages(prev => [...prev, { role: 'ai', text: data.reply }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'ai', text: "Sorry, I'm having trouble connecting to the server." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {isOpen && (
        <Card className="w-80 sm:w-96 h-[500px] mb-4 shadow-2xl flex flex-col border-primary/20 animate-in slide-in-from-bottom-5">
          <CardHeader className="p-4 bg-primary text-primary-foreground flex flex-row items-center justify-between rounded-t-lg">
            <div className="flex items-center gap-2">
              <Bot size={20} />
              <span className="font-semibold tracking-tight">Project Assistant</span>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-primary-foreground/10" onClick={() => setIsOpen(false)}>
              <X size={18} />
            </Button>
          </CardHeader>
          
          <CardContent ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-muted/30">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                  msg.role === 'user' 
                  ? 'bg-primary text-primary-foreground rounded-tr-none' 
                  : 'bg-card border rounded-tl-none shadow-sm'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-card border p-3 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">Thinking...</span>
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="p-3 border-t bg-card rounded-b-lg">
            <div className="flex w-full gap-2">
              <Input 
                placeholder="Ask about tasks..." 
                value={input} 
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                className="bg-muted/50 border-none focus-visible:ring-1"
              />
              <Button size="icon" onClick={handleSend} disabled={loading}>
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
      >
        {isOpen ? <X size={28} /> : <Bot size={28} />}
      </Button>
    </div>
  );
}