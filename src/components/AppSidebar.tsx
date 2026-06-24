'use client';

import { useState, useEffect } from 'react';

type SidebarSection = 'overview' | 'knowledge' | 'codebase' | 'settings';

interface MenuItem {
  id: string;
  icon: string;
  label: string;
  type: 'page' | 'info' | 'external';
  href?: string;
}

const MENU_ITEMS: MenuItem[] = [
  { id: 'overview', icon: '🏠', label: 'Overview', type: 'page' },
  { id: 'knowledge', icon: '🕸️', label: 'Knowledge Graph', type: 'page' },
  { id: 'codebase', icon: '🔬', label: 'Codebase Graph', type: 'page' },
  { id: 'bots', icon: '🤖', label: 'Bot Manager', type: 'external', href: '/bots' },
  { id: 'settings', icon: '⚙️', label: 'System Info', type: 'info' },
];

interface AppSidebarProps {
  activePage: string;
  onNavigate?: (id: string) => void;
  onLogout?: () => void;
}

export default function AppSidebar({ activePage, onNavigate, onLogout }: AppSidebarProps) {
  const handleLogout = onLogout || (() => {
    localStorage.removeItem('agentic-token');
    window.location.reload();
  });

  return (
    <aside className="w-60 flex-shrink-0 flex flex-col sticky top-0 h-screen" style={{ background: 'var(--surface)', borderRight: '1px solid var(--border)' }}>
      {/* Logo */}
      <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <a href="/" className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ background: 'var(--accent-soft)' }}>🐾</div>
          <div>
            <h1 className="text-sm font-bold">Agentic<span style={{ color: 'var(--accent)' }}>OS</span></h1>
            <p className="text-[9px]" style={{ color: 'var(--text-muted)' }}>v1.0 • Obsidian Vault</p>
          </div>
        </a>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {MENU_ITEMS.map(item => {
          if (item.type === 'external') {
            return (
              <a key={item.id} href={item.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all hover:opacity-80 ${activePage === item.id ? 'font-semibold' : ''}`}
                style={{
                  background: activePage === item.id ? 'var(--accent-soft)' : 'transparent',
                  color: activePage === item.id ? 'var(--accent)' : 'var(--text-muted)',
                }}>
                <span className="text-sm">{item.icon}</span>
                <span>{item.label}</span>
                <span className="ml-auto text-[10px] opacity-40">↗</span>
              </a>
            );
          }
          if (onNavigate) {
            return (
              <button key={item.id} onClick={() => onNavigate(item.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all text-left"
                style={{
                  background: activePage === item.id ? 'var(--accent-soft)' : 'transparent',
                  color: activePage === item.id ? 'var(--accent)' : 'var(--text-muted)',
                  fontWeight: activePage === item.id ? 600 : 400,
                }}>
                <span className="text-sm">{item.icon}</span>
                <span>{item.label}</span>
                {item.type === 'info' && <span className="ml-auto text-[10px] opacity-30">ℹ</span>}
              </button>
            );
          }
          // Static link for non-dashboard pages (e.g., bots)
          return (
            <a key={item.id} href={`/#${item.id}`}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all hover:opacity-80"
              style={{ color: 'var(--text-muted)' }}>
              <span className="text-sm">{item.icon}</span>
              <span>{item.label}</span>
              {item.type === 'info' && <span className="ml-auto text-[10px] opacity-30">ℹ</span>}
            </a>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-2 border-t space-y-1" style={{ borderColor: 'var(--border)' }}>
        <a href="/chat" className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{ background: 'var(--accent)' }}>
          💬 Open Chat
        </a>
        <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[10px] transition-all hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
          🚪 Logout
        </button>
      </div>
    </aside>
  );
}
