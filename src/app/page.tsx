'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import Sidebar from '@/components/Sidebar';
import ModelSelector from '@/components/ModelSelector';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: Date;
  model?: string;
  toolsUsed?: string[];
  rounds?: number;
  metadata?: { type?: string; tool?: string; success?: boolean; executionTimeMs?: number; round?: number };
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="absolute top-2 right-2 px-2 py-1 rounded text-[10px] transition-all"
      style={{ background: copied ? 'var(--accent)' : 'var(--surface-elevated)', color: copied ? 'white' : 'var(--text-muted)' }}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function ToolCallBadge({ toolsUsed, rounds }: { toolsUsed?: string[]; rounds?: number }) {
  if (!toolsUsed || toolsUsed.length === 0) return null;
  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      {toolsUsed.map((tool, i) => (
        <span key={i} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
          </svg>
          {tool}
        </span>
      ))}
      {rounds && rounds > 1 && (
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {rounds} rounds
        </span>
      )}
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [token, setToken] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [showSidebar, setShowSidebar] = useState(true);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const login = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@agentic.os', password: 'admin123' }),
      });
      const data = await res.json();
      if (data.ok) { setToken(data.data.token); return data.data.token; }
    } catch (e) { console.error('Login failed:', e); }
    return null;
  }, []);

  const createConversation = useCallback(async (authToken: string, title?: string) => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ title: title || 'New Chat' }),
      });
      const data = await res.json();
      if (data.ok) { setConversationId(data.data.id); return data.data.id; }
    } catch (e) { console.error('Create conversation failed:', e); }
    return null;
  }, []);

  const loadConversation = useCallback(async (authToken: string, convId: string) => {
    try {
      const res = await fetch(`/api/conversations/${convId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (data.ok) {
        const msgs: Message[] = data.data.messages.map((m: Record<string, unknown>) => ({
          id: m.id as string,
          role: (m.role as string).toLowerCase() as Message['role'],
          content: m.content as string,
          timestamp: new Date(m.created_at as string),
          metadata: m.metadata ? JSON.parse(m.metadata as string) : undefined,
        }));
        setMessages(msgs);
      }
    } catch (e) {
      console.error('Load conversation failed:', e);
    }
  }, []);

  const handleSelectConversation = useCallback(async (id: string) => {
    setConversationId(id);
    setMessages([]);
    if (!token) {
      const t = await login();
      if (t) loadConversation(t, id);
    } else {
      loadConversation(token, id);
    }
    setMobileSidebar(false);
  }, [token, login, loadConversation]);

  const handleNewChat = useCallback(() => {
    setConversationId('');
    setMessages([]);
    setMobileSidebar(false);
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      let authToken = token;
      if (!authToken) authToken = (await login()) || '';
      let convId = conversationId;
      if (!convId) {
        const title = userMessage.content.slice(0, 50) + (userMessage.content.length > 50 ? '...' : '');
        convId = (await createConversation(authToken, title)) || '';
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ conversationId: convId, message: userMessage.content, stream: true, model: selectedModel }),
      });

      if (!res.ok) throw new Error('Chat request failed');

      // Streaming SSE response
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolsUsed: [],
      };
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
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            if (eventType === 'chunk' && data.content) {
              assistantContent += data.content;
              setMessages(prev => prev.map(m =>
                m.id === assistantMessage.id ? { ...m, content: assistantContent } : m
              ));
            } else if (eventType === 'tool_call') {
              assistantContent += `\n\n🔧 *Using tool: ${data.name}*`;
              setMessages(prev => prev.map(m =>
                m.id === assistantMessage.id ? { ...m, content: assistantContent, toolsUsed: [...(m.toolsUsed || []), data.name] } : m
              ));
            } else if (eventType === 'tool_result') {
              // Tool result received, LLM will continue
            } else if (eventType === 'done') {
              setMessages(prev => prev.map(m =>
                m.id === assistantMessage.id ? { ...m, toolsUsed: data.toolsUsed || m.toolsUsed, rounds: data.rounds } : m
              ));
            } else if (eventType === 'error') {
              throw new Error(data.message);
            }
          }
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        content: '⚠️ Error: ' + String(e),
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen">
      {mobileSidebar && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobileSidebar(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative h-full" onClick={e => e.stopPropagation()}>
            <Sidebar token={token} currentId={conversationId} onSelect={handleSelectConversation} onNewChat={handleNewChat} />
          </div>
        </div>
      )}

      {showSidebar && (
        <div className="hidden lg:block">
          <Sidebar token={token} currentId={conversationId} onSelect={handleSelectConversation} onNewChat={handleNewChat} />
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileSidebar(true)} className="lg:hidden p-1.5 rounded-lg transition-all" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            </button>
            <button onClick={() => setShowSidebar(!showSidebar)} className="hidden lg:block p-1.5 rounded-lg transition-all" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
            </button>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ background: 'var(--accent)' }}>A</div>
            <div>
              <h1 className="font-semibold text-lg">Agentic <span style={{ color: 'var(--accent)' }}>OS</span></h1>
              <p className="text-xs hidden sm:block" style={{ color: 'var(--text-muted)' }}>AI Agent Operating System</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {token && <ModelSelector token={token} selected={selectedModel} onSelect={setSelectedModel} />}
            <span className="text-xs px-2 py-1 rounded hidden sm:inline-block" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>v0.2.0</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4" style={{ background: 'var(--accent-soft)' }}>⚡</div>
              <h2 className="text-xl font-semibold mb-2">Welcome to Agentic OS</h2>
              <p className="max-w-md text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Your AI agent with tool-calling capabilities. Ask anything.</p>
              <div className="grid grid-cols-2 gap-2 max-w-sm w-full">
                {['What time is it?', 'Calculate 15% of 2500', 'Create a note', 'Search the web'].map(s => (
                  <button key={s} onClick={() => setInput(s)} className="px-3 py-2 rounded-lg text-xs text-left transition-all hover:scale-[1.02]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {messages.filter(m => m.role !== 'tool').map(msg => (
            <div key={msg.id} className={`flex animate-fade-in-up ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] sm:max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'rounded-br-md' : 'rounded-bl-md'}`}
                style={{ background: msg.role === 'user' ? 'var(--accent)' : 'var(--surface)', border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none' }}>
                {msg.role === 'assistant' ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                      code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '');
                        const codeString = String(children).replace(/\n$/, '');
                        if (match) return <div className="relative group"><CopyButton text={codeString} /><SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div" customStyle={{ borderRadius: '8px', fontSize: '12px', margin: '8px 0' }}>{codeString}</SyntaxHighlighter></div>;
                        return <code className="px-1 py-0.5 rounded text-xs" style={{ background: 'var(--surface-elevated)' }} {...props}>{children}</code>;
                      },
                      p({ children }) { return <p className="mb-2 last:mb-0">{children}</p>; },
                      ul({ children }) { return <ul className="list-disc list-inside mb-2">{children}</ul>; },
                      ol({ children }) { return <ol className="list-decimal list-inside mb-2">{children}</ol>; },
                      h1({ children }) { return <h1 className="text-lg font-bold mb-2">{children}</h1>; },
                      h2({ children }) { return <h2 className="text-base font-bold mb-2">{children}</h2>; },
                      h3({ children }) { return <h3 className="text-sm font-bold mb-1">{children}</h3>; },
                      a({ href, children }) { return <a href={href} className="underline" style={{ color: 'var(--accent)' }} target="_blank" rel="noopener noreferrer">{children}</a>; },
                      blockquote({ children }) { return <blockquote className="border-l-2 pl-3 italic" style={{ borderColor: 'var(--accent)' }}>{children}</blockquote>; },
                      table({ children }) { return <div className="overflow-x-auto mb-2"><table className="text-xs border-collapse" style={{ border: '1px solid var(--border)' }}>{children}</table></div>; },
                      th({ children }) { return <th className="px-2 py-1 text-left" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}>{children}</th>; },
                      td({ children }) { return <td className="px-2 py-1" style={{ border: '1px solid var(--border)' }}>{children}</td>; },
                    }}>
                      {msg.content}
                    </ReactMarkdown>
                    <ToolCallBadge toolsUsed={msg.toolsUsed} rounds={msg.rounds} />
                    {msg.model && <div className="text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>{msg.model}</div>}
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
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Powered by Agentic OS • Tool Calling Enabled</span>
          </div>
        </div>
      </div>
    </div>
  );
}
