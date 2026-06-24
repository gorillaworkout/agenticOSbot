'use client';

import React, { useState, useEffect } from 'react';
import AppSidebar from '@/components/AppSidebar';

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'messaging' | 'productivity' | 'development' | 'storage';
  connected: boolean;
  status?: string;
  setupUrl?: string;
}

const INTEGRATIONS: Integration[] = [
  { id: 'lark', name: 'Lark / Feishu', description: 'Messaging, calendar, tasks, approvals', icon: '💬', category: 'messaging', connected: true, status: 'Active' },
  { id: 'telegram', name: 'Telegram', description: 'Bot messaging and notifications', icon: '📱', category: 'messaging', connected: false },
  { id: 'whatsapp', name: 'WhatsApp', description: 'Business messaging via Cloud API', icon: '📞', category: 'messaging', connected: false },
  { id: 'google', name: 'Google Workspace', description: 'Gmail, Drive, Calendar via OAuth', icon: '🔵', category: 'productivity', connected: false, setupUrl: '/api/auth/google' },
  { id: 'notion', name: 'Notion', description: 'Pages, databases, and blocks', icon: '📝', category: 'productivity', connected: false },
  { id: 'github', name: 'GitHub', description: 'Issues, PRs, Actions, file operations', icon: '🐙', category: 'development', connected: false },
  { id: 'slack', name: 'Slack', description: 'Channels, messages, and workflows', icon: '💼', category: 'messaging', connected: false },
  { id: 'airtable', name: 'Airtable', description: 'Bases, tables, and records', icon: '📊', category: 'productivity', connected: false },
  { id: 'linear', name: 'Linear', description: 'Issues, projects, and cycles', icon: '📐', category: 'development', connected: true, status: 'Active (GOR workspace)' },
  { id: 'xero', name: 'Xero', description: 'Accounting, invoices, and reports', icon: '💰', category: 'productivity', connected: true, status: 'Active (Dupoin)' },
  { id: 'resend', name: 'Resend Email', description: 'Transactional and notification emails', icon: '📧', category: 'messaging', connected: false },
  { id: 'firebase', name: 'Firebase', description: 'Auth, Firestore, and Storage', icon: '🔥', category: 'storage', connected: true, status: 'Active (gorilla-jastip)' },
  { id: 'cloudflare', name: 'Cloudflare', description: 'D1, R2, Workers, and DNS', icon: '☁️', category: 'storage', connected: true, status: 'Active' },
];

const CATEGORIES = [
  { key: 'all', label: 'All', icon: '🔗' },
  { key: 'messaging', label: 'Messaging', icon: '💬' },
  { key: 'productivity', label: 'Productivity', icon: '📋' },
  { key: 'development', label: 'Development', icon: '⚙️' },
  { key: 'storage', label: 'Storage', icon: '💾' },
];

export default function IntegrationsPage() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [integrations, setIntegrations] = useState(INTEGRATIONS);

  const filtered = selectedCategory === 'all'
    ? integrations
    : integrations.filter(i => i.category === selectedCategory);

  const connectedCount = integrations.filter(i => i.connected).length;
  const totalCount = integrations.length;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0a0a0f' }}>
      <AppSidebar activePage="integrations" />
      <main style={{ flex: 1, padding: '32px', maxWidth: '1200px' }}>
        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ color: '#e0e0e0', fontSize: '28px', fontWeight: 700, margin: 0 }}>
            🔗 Integrations
          </h1>
          <p style={{ color: '#888', marginTop: '8px', fontSize: '14px' }}>
            Connect your tools and services. {connectedCount}/{totalCount} connected.
          </p>
        </div>

        {/* Category Filter */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              onClick={() => setSelectedCategory(cat.key)}
              style={{
                padding: '8px 16px',
                borderRadius: '20px',
                border: '1px solid',
                borderColor: selectedCategory === cat.key ? '#7C3AED' : '#2a2a3e',
                background: selectedCategory === cat.key ? '#7C3AED20' : 'transparent',
                color: selectedCategory === cat.key ? '#a78bfa' : '#888',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>

        {/* Integration Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
          {filtered.map(integration => (
            <div
              key={integration.id}
              style={{
                background: '#12121a',
                border: '1px solid',
                borderColor: integration.connected ? '#7C3AED40' : '#1e1e2e',
                borderRadius: '12px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '28px' }}>{integration.icon}</span>
                  <div>
                    <h3 style={{ color: '#e0e0e0', fontSize: '16px', fontWeight: 600, margin: 0 }}>
                      {integration.name}
                    </h3>
                    <p style={{ color: '#666', fontSize: '13px', margin: '4px 0 0' }}>
                      {integration.description}
                    </p>
                  </div>
                </div>
                <span style={{
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 600,
                  background: integration.connected ? '#10B98120' : '#37415120',
                  color: integration.connected ? '#34d399' : '#6b7280',
                }}>
                  {integration.connected ? '✓ Connected' : '○ Not connected'}
                </span>
              </div>

              {integration.status && (
                <div style={{ color: '#888', fontSize: '12px', paddingLeft: '40px' }}>
                  {integration.status}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', paddingLeft: '40px' }}>
                {integration.connected ? (
                  <>
                    <button style={{
                      padding: '6px 14px', borderRadius: '6px', border: '1px solid #374151',
                      background: 'transparent', color: '#888', fontSize: '12px', cursor: 'pointer',
                    }}>
                      ⚙️ Settings
                    </button>
                    <button style={{
                      padding: '6px 14px', borderRadius: '6px', border: '1px solid #EF444440',
                      background: 'transparent', color: '#f87171', fontSize: '12px', cursor: 'pointer',
                    }}>
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button style={{
                    padding: '6px 14px', borderRadius: '6px', border: 'none',
                    background: '#7C3AED', color: 'white', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                  }}>
                    🔗 Connect
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
