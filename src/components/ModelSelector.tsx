'use client';

import { useState, useEffect } from 'react';

interface Model {
  id: string;
  name: string;
}

interface ModelSelectorProps {
  token: string;
  selected: string;
  onSelect: (model: string) => void;
}

export default function ModelSelector({ token, selected, onSelect }: ModelSelectorProps) {
  const [models, setModels] = useState<Model[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch('/api/models', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (data.ok) setModels(data.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const selectedName = selected || 'gemini-3-flash-preview';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-all hover:scale-[1.02]"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v6m-7-10h6m6 0h6"></path>
        </svg>
        <span className="max-w-[120px] truncate">{selectedName}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-64 max-h-72 overflow-y-auto rounded-xl shadow-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="p-2">
              <input
                type="text"
                placeholder="Search models..."
                className="w-full px-3 py-2 rounded-lg text-xs focus:outline-none"
                style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
                onClick={e => e.stopPropagation()}
              />
            </div>
            {loading && <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Loading...</div>}
            {models.map(model => (
              <button
                key={model.id}
                onClick={() => { onSelect(model.id); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs transition-all flex items-center gap-2"
                style={{
                  color: model.id === selectedName ? 'var(--accent)' : 'var(--text)',
                  background: model.id === selectedName ? 'var(--accent-soft)' : 'transparent',
                }}
                onMouseEnter={e => { if (model.id !== selectedName) (e.currentTarget as HTMLElement).style.background = 'var(--bg)'; }}
                onMouseLeave={e => { if (model.id !== selectedName) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                {model.id === selectedName && <span>✓</span>}
                <span className="truncate">{model.id}</span>
              </button>
            ))}
            {!loading && models.length === 0 && (
              <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>No models available</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
