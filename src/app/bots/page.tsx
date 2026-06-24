'use client';

import { useState, useEffect, useCallback } from 'react';
import AppSidebar from '@/components/AppSidebar';

interface Bot {
  app_id: string;
  bot_name: string;
  enabled: boolean;
  has_user_token: boolean;
  user_name?: string;
  token_expires_at?: string;
}

const BOT_CAPABILITIES: Record<string, { name: string; icon: string }[]> = {
  '📅 Calendar': [
    { name: 'View calendar events', icon: '📋' },
    { name: 'Create meetings', icon: '➕' },
    { name: 'Update meetings (time, title, attendees)', icon: '✏️' },
    { name: 'Cancel/delete meetings', icon: '🗑️' },
  ],
  '👥 Contacts': [
    { name: 'Search Lark users by name', icon: '🔍' },
    { name: 'Get user open_id for scheduling', icon: '🆔' },
  ],
  '💬 Messaging': [
    { name: 'Send messages via Lark bot', icon: '📨' },
    { name: 'Send to individuals or groups', icon: '👥' },
  ],
  '📝 Notes': [
    { name: 'Create and search notes', icon: '📝' },
    { name: 'List recent notes', icon: '📋' },
  ],
  '⏰ Scheduling': [
    { name: 'Create scheduled tasks (cron/interval)', icon: '⏰' },
    { name: 'List and manage tasks', icon: '📋' },
  ],
  '🌐 Other': [
    { name: 'Web search', icon: '🌐' },
    { name: 'Calculator', icon: '🧮' },
    { name: 'Knowledge base', icon: '📚' },
    { name: 'Agent memory', icon: '🧠' },
    { name: 'Generate PDF documents', icon: '📄' },
  ],
};

export default function BotsPage() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [botName, setBotName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [authStep, setAuthStep] = useState<'idle' | 'link' | 'polling' | 'done'>('idle');
  const [verificationUrl, setVerificationUrl] = useState('');
  const [deviceCode, setDeviceCode] = useState('');
  const [authAppId, setAuthAppId] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [expandedBotId, setExpandedBotId] = useState<string | null>(null);

  const loadBots = useCallback(async () => {
    try {
      const res = await fetch('/api/bots');
      const data = await res.json();
      if (data.ok) setBots(data.data);
    } catch {}
  }, []);

  useEffect(() => { loadBots(); }, [loadBots]);

  // Check if returning from OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      window.history.replaceState({}, '', '/bots');
      loadBots();
    }
  }, [loadBots]);

  const registerBot = async () => {
    if (!appId || !appSecret || !botName) { setError('All fields required'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, appSecret, botName }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to register');
      setShowAdd(false);
      setAppId('');
      setAppSecret('');
      setBotName('');
      loadBots();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const startAuth = async (id: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/bots/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: id }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Auth failed');

      setVerificationUrl(data.data.verificationUrl);
      setDeviceCode(data.data.deviceCode);
      setAuthAppId(id);
      setAuthStep('link');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const beginPolling = () => {
    setAuthStep('polling');
    let attempts = 0;
    const maxAttempts = 40;

    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`/api/bots/auth?deviceCode=${deviceCode}&appId=${authAppId}`);
        const data = await res.json();
        if (data.ok && data.data?.status === 'success') {
          clearInterval(interval);
          setAuthStep('done');
          setAuthMessage(`✅ Authorized as ${data.data.userName}`);
          loadBots();
        } else if (data.data?.status === 'expired' || attempts >= maxAttempts) {
          clearInterval(interval);
          setAuthStep('idle');
          setError('Authorization expired or timed out. Please try again.');
        }
      } catch {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          setAuthStep('idle');
          setError('Polling timed out.');
        }
      }
    }, 3000);

    setTimeout(() => { clearInterval(interval); if (authStep === 'polling') { setAuthStep('idle'); } }, 600000);
  };

  const cancelAuth = () => {
    setAuthStep('idle');
    setVerificationUrl('');
    setAuthMessage('');
    setError('');
  };

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <AppSidebar activePage="bots" />
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">🤖 Bot Manager</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              Register Lark bots and authorize user access
            </p>
          </div>
          <div className="flex gap-2">
            <a href="/" className="px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              ← Chat
            </a>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: 'var(--accent)' }}
            >
              + Add Bot
            </button>
          </div>
        </div>

        {showAdd && (
          <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h2 className="font-semibold mb-4">Register New Bot</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Bot Name</label>
                <input value={botName} onChange={e => setBotName(e.target.value)} placeholder="e.g. My Bot 2"
                  className="w-full mt-1 px-3 py-2 rounded-lg text-sm" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              </div>
              <div>
                <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>App ID</label>
                <input value={appId} onChange={e => setAppId(e.target.value)} placeholder="cli_xxxxxxxxxx"
                  className="w-full mt-1 px-3 py-2 rounded-lg text-sm font-mono" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              </div>
              <div>
                <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>App Secret</label>
                <input value={appSecret} onChange={e => setAppSecret(e.target.value)} type="password" placeholder="App secret"
                  className="w-full mt-1 px-3 py-2 rounded-lg text-sm font-mono" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)', color: 'var(--text)' }} />
              </div>
              {error && <p className="text-red-400 text-xs">{error}</p>}
              <div className="flex gap-2">
                <button onClick={registerBot} disabled={loading}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
                  {loading ? 'Registering...' : 'Register Bot'}
                </button>
                <button onClick={() => { setShowAdd(false); setError(''); }} className="px-4 py-2 rounded-lg text-sm" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {authStep !== 'idle' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="rounded-2xl p-6 max-w-md w-full mx-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              {authStep === 'link' && (
                <>
                  <h2 className="text-lg font-bold mb-4 text-center">Authorize Bot</h2>
                  <p className="text-sm text-center mb-4" style={{ color: 'var(--text-muted)' }}>
                    Click the link below to authorize in Lark. After authorizing, click &quot;I&apos;ve Authorized&quot;.
                  </p>
                  <div className="text-center mb-4">
                    <a href={verificationUrl} target="_blank" rel="noopener noreferrer"
                       className="text-base underline break-all font-medium" style={{ color: 'var(--accent)' }}>
                      🔗 Open Lark Authorization
                    </a>
                  </div>
                  <div className="flex gap-2 justify-center">
                    <button onClick={beginPolling} className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>
                      I&apos;ve Authorized — Continue
                    </button>
                    <button onClick={cancelAuth} className="px-4 py-2 rounded-lg text-sm" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
              {authStep === 'polling' && (
                <>
                  <h2 className="text-lg font-bold mb-4 text-center">Waiting for Authorization...</h2>
                  <div className="flex justify-center mb-4">
                    <div className="w-12 h-12 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
                  </div>
                  <p className="text-xs text-center mb-4" style={{ color: 'var(--text-muted)' }}>
                    Make sure you completed authorization in the Lark page
                  </p>
                  <div className="flex justify-center">
                    <button onClick={cancelAuth} className="px-4 py-2 rounded-lg text-sm" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
              {authStep === 'done' && (
                <>
                  <h2 className="text-lg font-bold mb-4 text-center">{authMessage}</h2>
                  <p className="text-xs text-center mb-4" style={{ color: 'var(--text-muted)' }}>
                    Bot is now authorized with calendar, contact, and messaging access.
                  </p>
                  <div className="flex justify-center">
                    <button onClick={() => { cancelAuth(); loadBots(); }} className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>
                      Done
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {bots.length === 0 && (
            <div className="text-center py-12 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-lg mb-2">No bots registered yet</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Click &quot;Add Bot&quot; to get started</p>
            </div>
          )}
          {bots.map(bot => (
            <div key={bot.app_id}>
              <div className="rounded-xl p-5 flex items-center justify-between" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: expandedBotId === bot.app_id ? '0.75rem 0.75rem 0 0' : '0.75rem' }}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
                       style={{ background: bot.has_user_token ? '#10b98120' : '#f59e0b20' }}>
                    {bot.has_user_token ? '✅' : '⚠️'}
                  </div>
                  <div>
                    <h3 className="font-semibold">{bot.bot_name}</h3>
                    <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{bot.app_id}</p>
                    {bot.has_user_token ? (
                      <div>
                        <p className="text-xs mt-0.5" style={{ color: '#10b981' }}>
                          ✅ Authorized{bot.user_name ? `: ${bot.user_name}` : ''}
                        </p>
                        {bot.token_expires_at && (
                          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            Token expires: {new Date(bot.token_expires_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs mt-0.5" style={{ color: '#f59e0b' }}>⚠️ Not authorized — click Authorize to connect</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => startAuth(bot.app_id)} disabled={loading}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{ background: bot.has_user_token ? '#6366f1' : 'var(--accent)' }}>
                    {bot.has_user_token ? 'Re-authorize' : 'Authorize'}
                  </button>
                  <button onClick={() => setExpandedBotId(expandedBotId === bot.app_id ? null : bot.app_id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border)' }}>
                    {expandedBotId === bot.app_id ? '▲ Hide' : '▼ Capabilities'}
                  </button>
                </div>
              </div>
              {expandedBotId === bot.app_id && (
                <div className="px-5 pb-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 0.75rem 0.75rem' }}>
                  <div className="pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                    <h4 className="text-sm font-semibold mb-3">🛠 What this bot can do</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {Object.entries(BOT_CAPABILITIES).map(([category, caps]) => (
                        <div key={category} className="rounded-lg p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                          <h5 className="text-xs font-bold mb-2" style={{ color: 'var(--accent)' }}>{category}</h5>
                          <ul className="space-y-1">
                            {caps.map(cap => (
                              <li key={cap.name} className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                <span className="mr-1">{cap.icon}</span>{cap.name}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                      💡 Try asking: &quot;<i>jadwal meeting hari ini</i>&quot;, &quot;<i>buat meeting jam 3 sore</i>&quot;, &quot;<i>cari user Bayu</i>&quot;, &quot;<i>kirim pesan ke Sandra</i>&quot;
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      </main>
    </div>
  );
}
