'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import * as d3 from 'd3';
import AppSidebar from '@/components/AppSidebar';

interface VaultStats { notes: number; links: number; entities: number; vaultFiles: number; }
interface Note { id: string; title: string; tags: string[]; source_type: string; created_at: string; }
type SidebarSection = 'overview' | 'knowledge' | 'codebase' | 'settings';

interface Feature { icon: string; name: string; description: string; href?: string; }

const FEATURES: Feature[] = [
  { icon: '🧠', name: 'Auto-Learn', description: 'LLM extracts facts & entities from every conversation' },
  { icon: '📖', name: 'Obsidian Vault', description: 'Markdown + YAML frontmatter + [[wiki links]]' },
  { icon: '🔍', name: 'KB Search', description: 'PostgreSQL full-text + trigram search' },
  { icon: '🔗', name: 'Wiki Links', description: 'Obsidian-style [[linked references]]' },
  { icon: '🤖', name: 'Proactive Engine', description: 'Morning briefing, reminders, approvals' },
  { icon: '💬', name: 'Lark Bot', description: 'Chat, tools, smart context, contextual search' },
  { icon: '🔧', name: '66 Tools', description: 'DB, web, Lark API, knowledge, scheduling' },
  { icon: '📊', name: 'Lark Bitable', description: 'Read & analyze Bitable data from chat' },
  { icon: '⚡', name: 'Tool Calling', description: 'Multi-round execution + streaming' },
  { icon: '🧠', name: 'Smart Context', description: 'Doc links, person names, quick tasks' },
  { icon: '🔎', name: 'Contextual Search', description: 'Auto KB/web search on questions' },
  { icon: '📋', name: 'Approval Handler', description: 'Webhook approve/reject cards' },
  { icon: '📅', name: 'Calendar Reminders', description: 'Meeting notifications via Lark' },
  { icon: '📝', name: 'Meeting Summary', description: 'Daily 10pm WIB chat summary' },
  { icon: '⏰', name: 'Deadline Tracker', description: '9am WIB daily deadline check' },
  { icon: '🌐', name: 'Web Search', description: 'DuckDuckGo integrated search' },
  { icon: '🤖', name: 'Bot Manager', description: 'Register & manage Lark bots', href: '/bots' },
  { icon: '🕸️', name: 'Graphify', description: 'Codebase knowledge graph — 702 nodes, 53 communities', href: '/graphify/graph.html' },
];

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
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>AI Agent Operating System</p>
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

function StatCard({ icon, label, value, sub }: { icon: string; label: string; value: string | number; sub?: string }) {
  return (
    <div className="p-4 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-3">
        <div className="text-2xl">{icon}</div>
        <div>
          <div className="text-2xl font-bold">{value}</div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
          {sub && <div className="text-[10px] mt-0.5" style={{ color: 'var(--accent)' }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  const inner = (
    <div className="p-3 rounded-xl transition-all hover:scale-[1.02]" style={{ background: 'var(--surface)', border: '1px solid var(--border)', cursor: feature.href ? 'pointer' : 'default' }}>
      <div className="flex items-start gap-3">
        <div className="text-xl mt-0.5">{feature.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{feature.name}</span>
            <span className="w-2 h-2 rounded-full bg-green-400" />
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{feature.description}</p>
        </div>
      </div>
    </div>
  );
  if (feature.href) return <a href={feature.href}>{inner}</a>;
  return inner;
}

function VaultBrowser({ token }: { token: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const url = search ? `/api/knowledge?search=${encodeURIComponent(search)}` : '/api/knowledge';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) setNotes(data.data?.items || data.data || []);
    } catch {} finally { setLoading(false); }
  }, [token, search]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">📖</span>
          <h3 className="font-semibold">Knowledge Vault</h3>
        </div>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search notes..."
          className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-1"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {loading ? (
          <div className="p-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</div>
        ) : notes.length === 0 ? (
          <div className="p-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            {search ? 'No results found' : 'No notes yet — start chatting!'}
          </div>
        ) : notes.map(note => (
          <div key={note.id} className="p-3 hover:opacity-80 transition-opacity cursor-pointer">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{note.title}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                {note.source_type}
              </span>
            </div>
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {note.tags?.map(t => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-elevated)', color: 'var(--text-muted)' }}>#{t}</span>
              ))}
            </div>
            <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
              {new Date(note.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArchitectureDiagram() {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🏗️</span>
        <h3 className="font-semibold">Architecture</h3>
      </div>
      <pre className="text-[11px] leading-relaxed overflow-x-auto" style={{ color: 'var(--text-muted)' }}>
{`┌─────────────┐     ┌──────────────┐
│  Lark Bot    │────▶│  Webhook     │
│  (user chat) │     │  /api/       │
└─────────────┘     └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  autoLearn() │ ← LLM extracts facts
                    └──────┬───────┘
                           │
              ┌────────────▼────────────┐
              │    Obsidian Vault       │
              │  vault/*.md (gray-matter)│
              │  YAML frontmatter       │
              │  [[wiki links]]         │
              └────────────┬────────────┘
                           │ sync
              ┌────────────▼────────────┐
              │     PostgreSQL          │
              │  knowledge_notes        │
              │  knowledge_entities     │
              │  knowledge_links        │
              └─────────────────────────┘`}
      </pre>
    </div>
  );
}

function VaultGraph({ token }: { token: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [graphData, setGraphData] = useState<any>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 600;
    const height = 460;

    svg.selectAll('*').remove();

    // Subtle drop shadow
    const defs = svg.append('defs');
    const shadow = defs.append('filter').attr('id', 'node-shadow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    shadow.append('feDropShadow').attr('dx', 0).attr('dy', 1).attr('stdDeviation', 3).attr('flood-color', '#000').attr('flood-opacity', 0.1);

    // Subtle dot pattern background
    const pattern = defs.append('pattern').attr('id', 'dots').attr('width', 24).attr('height', 24).attr('patternUnits', 'userSpaceOnUse');
    pattern.append('circle').attr('cx', 12).attr('cy', 12).attr('r', 0.8).attr('fill', '#ddd');

    svg.append('rect').attr('width', '100%').attr('height', '100%').attr('fill', 'url(#dots)').attr('rx', 12);

    fetch('/api/vault/graph', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        setLoading(false);
        if (!data.ok || !data.data.nodes.length) return;
        setGraphData(data.data);

        const nodes = data.data.nodes.map((n: any) => ({ ...n }));
        const links = data.data.edges.map((e: any) => ({ ...e }));

        // Obsidian-style colors
        const COLORS = {
          user: '#7c5cbf',      // Purple for user notes
          system: '#4a9eff',    // Blue for system notes
          entity: '#e879a0',    // Rose for entities
          link: '#c8cdd3',      // Light gray for links
          linkLabel: '#9ca3af',
        };

        const getNodeColor = (d: any) => {
          if (d.type === 'entity' || d.tags?.includes('entity')) return COLORS.entity;
          return d.group === 'user' ? COLORS.user : COLORS.system;
        };

        const simulation = d3.forceSimulation(nodes as any)
          .force('link', d3.forceLink(links as any).id((d: any) => d.id).distance(100).strength(0.4))
          .force('charge', d3.forceManyBody().strength(-200))
          .force('center', d3.forceCenter(width / 2, height / 2))
          .force('collision', d3.forceCollide().radius(32));

        // Links
        const link = svg.append('g')
          .selectAll('line')
          .data(links)
          .join('line')
          .attr('stroke', COLORS.link)
          .attr('stroke-width', 1.5)
          .attr('stroke-opacity', 0.6);

        // Link labels
        const linkLabel = svg.append('g')
          .selectAll('text')
          .data(links)
          .join('text')
          .text((d: any) => d.label || '')
          .attr('font-size', '8px')
          .attr('font-family', '-apple-system, system-ui, sans-serif')
          .attr('fill', COLORS.linkLabel)
          .attr('text-anchor', 'middle')
          .attr('dy', -4);

        // Node groups
        const node = svg.append('g')
          .selectAll('g')
          .data(nodes)
          .join('g')
          .style('cursor', 'pointer')
          .call((d3.drag() as any)
            .on('start', (event: any) => { if (!event.active) simulation.alphaTarget(0.3).restart(); event.subject.fx = event.x; event.subject.fy = event.y; })
            .on('drag', (event: any) => { event.subject.fx = event.x; event.subject.fy = event.y; })
            .on('end', (event: any) => { if (!event.active) simulation.alphaTarget(0); event.subject.fx = null; event.subject.fy = null; })
          )
          .on('click', (_event: any, d: any) => setSelected(d));

        // Main circle with subtle shadow
        node.append('circle')
          .attr('r', 14)
          .attr('fill', '#fff')
          .attr('stroke', (d: any) => getNodeColor(d))
          .attr('stroke-width', 2.5)
          .attr('filter', 'url(#node-shadow)');

        // Inner colored dot
        node.append('circle')
          .attr('r', 5)
          .attr('fill', (d: any) => getNodeColor(d))
          .attr('opacity', 0.7);

        // Label below node
        node.append('text')
          .text((d: any) => d.label.length > 20 ? d.label.slice(0, 20) + '…' : d.label)
          .attr('x', 0)
          .attr('y', 28)
          .attr('text-anchor', 'middle')
          .attr('font-size', '11px')
          .attr('font-family', '-apple-system, system-ui, sans-serif')
          .attr('fill', '#374151')
          .attr('font-weight', '500');

        simulation.on('tick', () => {
          link
            .attr('x1', (d: any) => d.source.x)
            .attr('y1', (d: any) => d.source.y)
            .attr('x2', (d: any) => d.target.x)
            .attr('y2', (d: any) => d.target.y);
          linkLabel
            .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
            .attr('y', (d: any) => (d.source.y + d.target.y) / 2);
          node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
        });
      })
      .catch(() => setLoading(false));

    return () => { svg.selectAll('*').remove(); };
  }, [token]);

  return (
    <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🕸️</span>
          <h3 className="text-sm font-semibold">Knowledge Graph</h3>
        </div>
        <div className="flex gap-4 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#7c5cbf' }} />
            <span>User Notes</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#4a9eff' }} />
            <span>System</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#e879a0' }} />
            <span>Entities</span>
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex-1 relative">
          <svg ref={svgRef} width="100%" height="460" style={{ borderRadius: '10px', background: '#fafafa', border: '1px solid var(--border)' }} />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading graph…</div>
            </div>
          )}
          {!loading && graphData && graphData.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>No notes yet</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Chat with the AI to populate the graph</div>
              </div>
            </div>
          )}
        </div>

        {selected && (
          <div className="w-56 p-4 rounded-lg" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full" style={{ background: selected.group === 'user' ? '#7c5cbf' : (selected.type === 'entity' ? '#e879a0' : '#4a9eff') }} />
              <span className="text-xs font-semibold truncate">{selected.label}</span>
            </div>
            {selected.type && (
              <div className="mb-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                  {selected.type}
                </span>
              </div>
            )}
            {selected.tags && selected.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {selected.tags.map((t: string) => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                    #{t}
                  </span>
                ))}
              </div>
            )}
            <div className="text-[10px] mt-2 font-mono" style={{ color: 'var(--text-muted)' }}>
              ID: {selected.id?.slice(0, 8)}…
            </div>
            <button onClick={() => setSelected(null)} className="text-[10px] mt-3 px-2 py-1 rounded" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
function Dashboard({ token }: { token: string }) {
  const [stats, setStats] = useState<VaultStats>({ notes: 0, links: 0, entities: 0, vaultFiles: 0 });
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState('');

  useEffect(() => {
    fetch('/api/vault', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(data => { if (data.ok) setStats(data.data); }).catch(() => {});
  }, [token]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult('');
    try {
      const res = await fetch('/api/vault', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) {
        setSyncResult(`Synced: ${data.data.imported} imported, ${data.data.updated} updated`);
        const statsData = await fetch('/api/vault', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
        if (statsData.ok) setStats(statsData.data);
      }
    } catch { setSyncResult('Sync failed'); }
    finally { setSyncing(false); }
  };

  const handleLogout = () => {
    localStorage.removeItem('agentic-token');
    window.location.reload();
  };

  const [activeSection, setActiveSection] = useState<SidebarSection>('overview');
  const sidebarMenu = [
    { id: 'overview', icon: '🏠', label: 'Overview', type: 'page' },
    { id: 'knowledge', icon: '🕸️', label: 'Knowledge Graph', type: 'page' },
    { id: 'codebase', icon: '🔬', label: 'Codebase Graph', type: 'page' },
    { id: 'bots', icon: '🤖', label: 'Bot Manager', type: 'external', href: '/bots' },
    { id: 'settings', icon: '⚙️', label: 'System Info', type: 'info' },
  ];
  const activeFeatures = [
    { icon: '🧠', name: 'Auto-Learn', desc: 'LLM extracts facts from chat' },
    { icon: '📖', name: 'Obsidian Vault', desc: 'Markdown + YAML + wiki links' },
    { icon: '🔍', name: 'KB Search', desc: 'PostgreSQL full-text search' },
    { icon: '💬', name: 'Lark Bot', desc: 'Chat, tools, smart context' },
    { icon: '🔧', name: '66 Tools', desc: 'DB, web, Lark API' },
    { icon: '📊', name: 'Lark Bitable', desc: 'Read & analyze data' },
    { icon: '⚡', name: 'Tool Calling', desc: 'Multi-round + streaming' },
    { icon: '📋', name: 'Approval Handler', desc: 'Webhook approve/reject' },
    { icon: '📅', name: 'Calendar', desc: 'Meeting notifications' },
    { icon: '📝', name: 'Meeting Summary', desc: 'Daily 10pm WIB' },
    { icon: '⏰', name: 'Deadline Tracker', desc: '9am WIB daily' },
    { icon: '🌐', name: 'Web Search', desc: 'DuckDuckGo' },
  ];

    return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg)' }}>
      <AppSidebar activePage={activeSection} onNavigate={(id) => setActiveSection(id as SidebarSection)} onLogout={handleLogout} />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-5xl mx-auto space-y-6">

        {/* Overview Section */}
        {activeSection === 'overview' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon="📝" label="Notes" value={stats.notes} sub="in PostgreSQL" />
              <StatCard icon="🔗" label="Wiki Links" value={stats.links} sub="[[references]]" />
              <StatCard icon="🏢" label="Entities" value={stats.entities} sub="people, orgs" />
              <StatCard icon="📁" label="Vault Files" value={stats.vaultFiles} sub="*.md files" />
            </div>
            <div className="rounded-xl p-3 flex items-center justify-between" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div>
                <span className="text-xs font-medium">Vault Sync</span>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Import .md files from vault/ into PostgreSQL</p>
              </div>
              <div className="flex items-center gap-3">
                {syncResult && <span className="text-[10px]" style={{ color: 'var(--accent)' }}>{syncResult}</span>}
                <button onClick={handleSync} disabled={syncing}
                  className="px-3 py-1.5 rounded-lg text-white text-[10px] font-medium transition-all disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}>
                  {syncing ? 'Syncing...' : '🔄 Sync'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <VaultBrowser token={token} />
              <ArchitectureDiagram />
            </div>
            <div>
              <h2 className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>⚡ ACTIVE FEATURES</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {activeFeatures.map((f: any) => (
                  <div key={f.name} className="p-2.5 rounded-lg flex items-start gap-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <span className="text-sm">{f.icon}</span>
                    <div>
                      <span className="text-[11px] font-medium block">{f.name}</span>
                      <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>{f.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Knowledge Graph Section */}
        {activeSection === 'knowledge' && (
          <>
            <VaultGraph token={token} />
            <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 mb-3">
                <span>➕</span>
                <h3 className="text-sm font-semibold">Add Knowledge</h3>
              </div>
              <form onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const title = (form.elements.namedItem('title') as HTMLInputElement).value;
                const content = (form.elements.namedItem('content') as HTMLTextAreaElement).value;
                const tags = (form.elements.namedItem('tags') as HTMLInputElement).value.split(',').map((t: string) => t.trim()).filter(Boolean);
                try {
                  const res = await fetch('/api/knowledge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ sourceType: 'manual', title, content, tags })
                  });
                  const data = await res.json();
                  if (data.ok) { form.reset(); const statsData = await fetch('/api/vault', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()); if (statsData.ok) setStats(statsData.data); }
                } catch (err) { console.error(err); }
              }} className="space-y-2">
                <input type="text" name="title" required placeholder="Title"
                  className="w-full px-3 py-2 rounded-lg text-xs"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                <textarea name="content" required rows={2} placeholder="Content (use [[Wiki Links]]...)"
                  className="w-full px-3 py-2 rounded-lg text-xs"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                <input type="text" name="tags" placeholder="Tags (comma separated)"
                  className="w-full px-3 py-2 rounded-lg text-xs"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                <button type="submit" className="px-4 py-2 rounded-lg text-white text-xs font-medium" style={{ background: 'var(--accent)' }}>
                  💾 Save to Vault
                </button>
              </form>
            </div>
          </>
        )}

        {/* Codebase Graph Section */}
        {activeSection === 'codebase' && (
          <CodebaseGraph token={token} />
        )}

        {/* Settings / System Info Section */}
        {activeSection === 'settings' && (
          <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="text-sm font-semibold mb-4">⚙️ System Information</h3>
            <div className="space-y-3 text-xs">
              {[
                ['Version', 'v1.0.0'],
                ['Runtime', 'Next.js + TypeScript'],
                ['Database', 'PostgreSQL 16'],
                ['LLM', 'OpenAI-compatible (llm.mfah.me)'],
                ['Vault', 'Obsidian-style Markdown + YAML'],
                ['Graph', 'Graphify (702 nodes, 53 communities)'],
                ['Bots', 'Lark Bot + OAuth'],
                ['Platform', 'AgenticOS @ gorillaworkout.id'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1.5 border-b" style={{ borderColor: 'var(--border)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{k}</span>
                  <span className="font-mono">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        </div>
      </main>
    </div>
  );
}

export default function DashboardPage() {
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
    } else {
      setChecking(false);
    }
  }, []);

  if (checking) return <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}><div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</div></div>;

  if (!token) return <LoginForm onLogin={setToken} />;

  return <Dashboard token={token} />;
}
function CodebaseGraph({ token }: { token: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [stats, setStats] = useState<{ nodes: number; edges: number; communities: number } | null>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [connections, setConnections] = useState<any>(null);
  const [godNodes, setGodNodes] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/graphify?action=stats', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (data.ok) setStats(data.data); });
    fetch('/api/graphify?action=god-nodes', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (data.ok) setGodNodes(data.data); });
  }, [token]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    const res = await fetch(`/api/graphify?action=search&q=${encodeURIComponent(searchQuery)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.ok) setSearchResults(data.data);
  };

  const handleNodeClick = async (nodeId: string) => {
    const res = await fetch(`/api/graphify?action=connections&nodeId=${encodeURIComponent(nodeId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.ok) {
      setSelectedNode(nodeId);
      setConnections(data.data);
    }
  };

  if (!stats) return null;

  return (
    <div className="rounded-xl p-5" style={{ background: '#080c14', border: '1px solid #1a2a3c' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <h3 className="font-semibold text-sm tracking-wider" style={{ color: '#10b981', fontFamily: 'monospace' }}>
            GRAPHIFY://CODEBASE
          </h3>
        </div>
        <div className="flex gap-4 text-[10px] font-mono" style={{ color: '#556677' }}>
          <span>{stats.nodes} nodes</span>
          <span>{stats.edges} edges</span>
          <span>{stats.communities} communities</span>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search codebase graph..."
          className="flex-1 px-3 py-2 rounded-lg text-xs font-mono"
          style={{ background: '#0d1a2a', border: '1px solid #1a2a3c', color: '#e0e8f0' }}
        />
        <button
          onClick={handleSearch}
          className="px-3 py-2 rounded-lg text-xs font-mono"
          style={{ background: '#10b981', color: '#fff' }}
        >
          SEARCH
        </button>
      </div>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="mb-4 p-3 rounded-lg" style={{ background: '#0d1a2a', border: '1px solid #1a2a3c' }}>
          <h4 className="text-xs font-mono mb-2" style={{ color: '#10b981' }}>SEARCH RESULTS</h4>
          {searchResults.map((n: any) => (
            <div key={n.id} className="flex items-center gap-2 py-1 cursor-pointer hover:opacity-80" onClick={() => handleNodeClick(n.id)}>
              <span className="text-xs font-mono" style={{ color: '#10b981' }}>{n.label}</span>
              <span className="text-[10px] font-mono" style={{ color: '#334455' }}>community {n.community}</span>
            </div>
          ))}
        </div>
      )}

      {/* God Nodes */}
      <div className="mb-4">
        <h4 className="text-xs font-mono mb-2" style={{ color: '#10b981' }}>GOD NODES (core abstractions)</h4>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {godNodes.slice(0, 10).map((g: any) => (
            <div key={g.node.id} className="p-2 rounded-lg cursor-pointer hover:scale-105 transition-transform"
              style={{ background: '#0d1a2a', border: '1px solid #1a2a3c' }}
              onClick={() => handleNodeClick(g.node.id)}>
              <div className="text-xs font-mono truncate" style={{ color: '#10b981' }}>{g.node.label}</div>
              <div className="text-[10px] font-mono" style={{ color: '#334455' }}>{g.degree} edges</div>
            </div>
          ))}
        </div>
      </div>

      {/* Node Detail */}
      {selectedNode && connections && (
        <div className="p-3 rounded-lg" style={{ background: '#0d1a2a', border: '1px solid #1a2a3c' }}>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-mono font-bold" style={{ color: '#10b981' }}>{selectedNode}</h4>
            <button onClick={() => { setSelectedNode(null); setConnections(null); }}
              className="text-xs px-2 py-0.5 rounded font-mono" style={{ color: '#556677', border: '1px solid #1a2a3c' }}>✕</button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-[10px] font-mono block mb-1" style={{ color: '#556677' }}>CALLS/USES ({connections.outgoing.length})</span>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {connections.outgoing.slice(0, 10).map((e: any, i: number) => (
                  <div key={i} className="text-[10px] font-mono" style={{ color: '#8899aa' }}>
                    → {e.target} <span style={{ color: '#334455' }}>({e.relation})</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <span className="text-[10px] font-mono block mb-1" style={{ color: '#556677' }}>CALLED BY ({connections.incoming.length})</span>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {connections.incoming.slice(0, 10).map((e: any, i: number) => (
                  <div key={i} className="text-[10px] font-mono" style={{ color: '#8899aa' }}>
                    ← {e.source} <span style={{ color: '#334455' }}>({e.relation})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Graphify HTML link */}
      <div className="mt-3 text-center">
        <a href="/graphify/graph.html" target="_blank" rel="noopener noreferrer"
          className="text-xs font-mono px-4 py-2 rounded-lg inline-block transition-all hover:opacity-80"
          style={{ background: '#10b98120', color: '#10b981', border: '1px solid #10b98140' }}>
          🔗 Open Interactive Graph (graph.html)
        </a>
      </div>
    </div>
  );
}
