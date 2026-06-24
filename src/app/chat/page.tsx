'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  toolsUsed?: string[];
  rounds?: number;
}

function LoginForm({ onLogin }: { onLogin: (token: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.ok) {
        localStorage.setItem('agentic-token', data.data.token);
        onLogin(data.data.token);
      } else {
        setError(data.error || 'Login failed');
      }
    } catch { setError('Connection failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4" style={{ background: 'var(--accent-soft)' }}>🐾</div>
          <h1 className="text-2xl font-bold">Agentic <span style={{ color: 'var(--accent)' }}>OS</span></h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Sign in to continue</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Username</label>
            <input type="text" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
              placeholder="dupoin" autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
              placeholder="••••••" />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50"
            style={{ background: 'var(--accent)' }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ChatInterface({ token }: { token: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const createConversation = useCallback(async (title?: string) => {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: title || 'New Chat' }),
    });
    const data = await res.json();
    if (data.ok) { setConversationId(data.data.id); return data.data.id; }
    return null;
  }, [token]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: input.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      let convId = conversationId;
      if (!convId) convId = (await createConversation(userMessage.content.slice(0, 50))) || '';

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversationId: convId, message: userMessage.content, stream: true }),
      });

      if (!res.ok) throw new Error('Chat failed');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      const assistantMessage: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: '', timestamp: new Date(), toolsUsed: [] };
      setMessages(prev => [...prev, assistantMessage]);

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim();
          else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'chunk' && data.content) {
                assistantContent += data.content;
                setMessages(prev => prev.map(m => m.id === assistantMessage.id ? { ...m, content: assistantContent } : m));
              } else if (eventType === 'tool_call') {
                assistantContent += `\n\n🔧 *Using: ${data.name}*`;
                setMessages(prev => prev.map(m => m.id === assistantMessage.id ? { ...m, content: assistantContent, toolsUsed: [...(m.toolsUsed || []), data.name] } : m));
              } else if (eventType === 'done') {
                setMessages(prev => prev.map(m => m.id === assistantMessage.id ? { ...m, toolsUsed: data.toolsUsed || m.toolsUsed, rounds: data.rounds } : m));
              }
            } catch {}
          }
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { id: (Date.now() + 2).toString(), role: 'assistant', content: '⚠️ Error: ' + String(e), timestamp: new Date() }]);
    } finally { setIsLoading(false); }
  };

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--bg)' }}>
      <header className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ background: 'var(--accent)' }}>🐾</div>
          <div>
            <h1 className="font-semibold">Agentic <span style={{ color: 'var(--accent)' }}>OS</span></h1>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>AI Agent • Tool Calling</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href="/" className="text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            📊 Dashboard
          </a>
          <button onClick={() => { localStorage.removeItem('agentic-token'); window.location.reload(); }}
            className="text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            Logout
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4" style={{ background: 'var(--accent-soft)' }}>⚡</div>
            <h2 className="text-xl font-semibold mb-2">Agentic OS Chat</h2>
            <p className="max-w-md text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Ask anything. Tools are auto-detected. Knowledge is auto-learned.</p>
            <div className="grid grid-cols-2 gap-2 max-w-sm w-full">
              {['What can you do?', 'Remember: I like coffee', 'Search KB for projects', 'What tools do you have?'].map(q => (
                <button key={q} onClick={() => setInput(q)}
                  className="text-left text-xs p-3 rounded-xl transition-all hover:scale-[1.02]"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] sm:max-w-[70%] px-4 py-3 rounded-2xl ${msg.role === 'user' ? 'rounded-br-md' : 'rounded-bl-md'}`}
              style={msg.role === 'user' ? { background: 'var(--accent)', color: 'white' } : { background: 'var(--surface)', border: '1px solid var(--border)' }}>
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none" style={{ color: 'var(--text)' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {msg.toolsUsed.map((tool, i) => (
                        <span key={i} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>🔧 {tool}</span>
                      ))}
                      {msg.rounds && msg.rounds > 1 && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{msg.rounds} rounds</span>}
                    </div>
                  )}
                </div>
              ) : (
                <div className="whitespace-pre-wrap">{msg.content}</div>
              )}
              <div className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-blue-200' : ''}`} style={msg.role === 'assistant' ? { color: 'var(--text-muted)' } : {}}>
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex justify-start">
            <div className="px-4 py-3 rounded-2xl rounded-bl-md" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex gap-1">
                <span className="typing-dot w-2 h-2 rounded-full inline-block" style={{ background: 'var(--text-muted)' }}></span>
                <span className="typing-dot w-2 h-2 rounded-full inline-block" style={{ background: 'var(--text-muted)' }}></span>
                <span className="typing-dot w-2 h-2 rounded-full inline-block" style={{ background: 'var(--text-muted)' }}></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="px-4 sm:px-6 py-3 border-t" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
        <form onSubmit={e => { e.preventDefault(); sendMessage(); }} className="flex gap-3 items-end">
          <textarea value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Type a message..." rows={1}
            className="flex-1 resize-none px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} />
          <button type="submit" disabled={!input.trim() || isLoading}
            className="px-4 py-3 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50"
            style={{ background: 'var(--accent)' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </form>
        <div className="text-center mt-1">
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Auto-learn enabled • Knowledge saved to Obsidian vault</span>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [token, setToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('agentic-token');
    if (stored) {
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${stored}` } })
        .then(r => r.json())
        .then(data => { if (data.ok) setToken(stored); else localStorage.removeItem('agentic-token'); })
        .catch(() => {})
        .finally(() => setChecking(false));
    } else { setChecking(false); }
  }, []);

  if (checking) return <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}><div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</div></div>;
  if (!token) return <LoginForm onLogin={setToken} />;
  return <ChatInterface token={token} />;
}
