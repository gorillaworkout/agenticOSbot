'use client';

import { useState, useEffect, useCallback } from 'react';

interface Conversation {
  id: string;
  title: string;
  message_count: number;
  updated_at: string;
  last_message?: { content: string; role: string };
}

interface SidebarProps {
  token: string;
  currentId: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}

export default function Sidebar({ token, currentId, onSelect, onNewChat }: SidebarProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/conversations', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) setConversations(data.data);
    } catch (e) {
      console.error('Failed to load conversations:', e);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) loadConversations();
  }, [token, loadConversations]);

  // Refresh when currentId changes (new message sent)
  useEffect(() => {
    if (token) loadConversations();
  }, [currentId, token, loadConversations]);

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this conversation?')) return;
    try {
      await fetch(`/api/conversations/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setConversations(prev => prev.filter(c => c.id !== id));
      if (id === currentId) onNewChat();
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 24) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffHours < 168) {
      return d.toLocaleDateString([], { weekday: 'short' });
    } else {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  return (
    <aside className="w-64 h-full flex flex-col border-r" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
      {/* Header */}
      <div className="p-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={onNewChat}
          className="w-full px-3 py-2 rounded-lg text-sm font-medium transition-all hover:scale-[1.02] flex items-center gap-2 justify-center"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          New Chat
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {loading && conversations.length === 0 && (
          <div className="p-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>Loading...</div>
        )}
        {conversations.map(conv => (
          <div
            key={conv.id}
            onClick={() => onSelect(conv.id)}
            className="group px-3 py-2.5 cursor-pointer transition-all relative"
            style={{
              background: conv.id === currentId ? 'var(--surface-elevated)' : 'transparent',
              borderLeft: conv.id === currentId ? '2px solid var(--accent)' : '2px solid transparent',
            }}
            onMouseEnter={e => {
              if (conv.id !== currentId) (e.currentTarget as HTMLElement).style.background = 'var(--surface)';
            }}
            onMouseLeave={e => {
              if (conv.id !== currentId) (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: 'var(--text)' }}>
                  {conv.title || 'Untitled'}
                </p>
                {conv.last_message && (
                  <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {conv.last_message.content.slice(0, 60)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {formatDate(conv.updated_at)}
                </span>
                <button
                  onClick={(e) => deleteConversation(conv.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity hover:bg-red-500/20"
                  title="Delete"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#ef4444' }}>
                    <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
                {conv.message_count} msgs
              </span>
            </div>
          </div>
        ))}
        {!loading && conversations.length === 0 && (
          <div className="p-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            No conversations yet
          </div>
        )}
      </div>
    </aside>
  );
}
