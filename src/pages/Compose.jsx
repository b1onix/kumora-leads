import React, { useState, useEffect } from 'react';
import { useData } from '../App.jsx';
import { api } from '../api.js';

/** Writer-agent picker: choose the voice your emails are written in. */
function WriterPicker({ toast }) {
  const [writers, setWriters] = useState([]);
  const [current, setCurrent] = useState('');

  useEffect(() => {
    api.writers()
      .then((r) => { setWriters(r.writers); setCurrent(r.current); })
      .catch((e) => toast(e.message, 'err'));
  }, []);

  async function pick(key) {
    const prev = current;
    setCurrent(key); // optimistic
    try {
      await api.saveSettings({ writerStyle: key });
    } catch (e) {
      setCurrent(prev);
      toast(e.message, 'err');
    }
  }

  if (writers.length === 0) return null;

  return (
    <div className="card pad" style={{ marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1.4, color: 'var(--ink-3)', marginBottom: 12 }}>
        Writer voice
      </div>
      <div className="writer-grid">
        {writers.map((w) => (
          <button
            key={w.key}
            className={'writer-card' + (current === w.key ? ' on' : '')}
            onClick={() => pick(w.key)}
            type="button"
          >
            <span className="writer-name">{w.label}</span>
            <span className="writer-tag">{w.tagline}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Compose() {
  const { state, refresh, toast } = useData();
  const leads = state?.leads || [];
  const engine = state?.engine || {};
  const [mode, setMode] = useState('manual'); // manual | auto

  const withEmail = leads.filter((l) => l.email);
  const ready = withEmail.filter((l) => ['ready', 'draft_failed'].includes(l.status));
  const drafted = leads.filter((l) => l.status === 'drafted');
  const inFlight = leads.filter((l) => ['queued', 'generating'].includes(l.status));
  const done = leads.filter((l) => ['drafted', 'approved', 'sending', 'sent'].includes(l.status));
  const health = state?.health;

  const total = withEmail.length || 1;
  const progressPct = Math.round((done.length / total) * 100);

  async function generateAll() {
    if (ready.length === 0) return toast('Nothing new to draft — all emailable leads are already handled', 'err');
    if (mode === 'auto') {
      if (!health?.ok) return toast('Finish Settings before auto-send: ' + (health?.missing || []).join(', '), 'err');
      if (!confirm(`Auto mode will generate AND SEND ${ready.length} emails (respecting your daily cap${state?.testMode ? ', in TEST mode' : ''}). Continue?`)) return;
    }
    try {
      const r = await api.generate(ready.map((l) => l.id), mode === 'auto');
      toast(`Queued ${r.queued} lead(s) for ${mode === 'auto' ? 'generate + send' : 'drafting'}`);
      refresh();
    } catch (e) { toast(e.message, 'err'); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Generate emails</h1><p>Kumora reads each business's website and writes one personal cold email — in the voice you pick below.</p></div>
        {(engine.generating || engine.sending) && (
          <button className="btn danger" onClick={() => api.stop().then(refresh)}>■ Stop</button>
        )}
      </div>

      <div className="card pad" style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-mute)', marginBottom: 12 }}>Run mode</div>
        <div style={{ display: 'flex', gap: 14 }}>
          <ModeCard active={mode === 'manual'} onClick={() => setMode('manual')}
            icon="✎" title="Manual review"
            desc="Draft all emails, then you review & approve each one on the Review page before it sends. Safest." />
          <ModeCard active={mode === 'auto'} onClick={() => setMode('auto')}
            icon="⚡" title="Auto send"
            desc="Draft and send automatically as each one is ready, respecting your daily cap. Fast, less oversight." />
        </div>

        {mode === 'auto' && !health?.ok && (
          <div className="note warn" style={{ marginTop: 14 }}>
            ⚠ Auto mode needs your sending details first: {(health?.missing || []).join(', ')}. → <a href="#/settings">Settings</a>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18 }}>
          <button className="btn primary" onClick={generateAll} disabled={ready.length === 0}>
            {mode === 'auto' ? '⚡ Generate & send' : '✎ Draft'} {ready.length} lead{ready.length === 1 ? '' : 's'}
          </button>
          {inFlight.length > 0 && <span className="muted" style={{ fontSize: 13 }}><span className="spin" /> {inFlight.length} in progress…</span>}
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat"><div className="num">{withEmail.length}</div><div className="lbl">Emailable</div></div>
        <div className="stat"><div className="num">{inFlight.length}</div><div className="lbl">Drafting now</div></div>
        <div className="stat"><div className="num">{drafted.length}</div><div className="lbl">Awaiting review</div></div>
        <div className="stat"><div className="num">{leads.filter((l) => l.status === 'sent').length}</div><div className="lbl">Sent</div></div>
      </div>

      <div className="card pad">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 13 }}>
          <span>Overall progress</span><span className="muted">{done.length} / {withEmail.length}</span>
        </div>
        <div className="progress-track"><div className="pf" style={{ width: progressPct + '%' }} /></div>
        {engine.lastEvent && <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>Last: {engine.lastEvent}</div>}
        {drafted.length > 0 && mode === 'manual' && (
          <div style={{ marginTop: 16 }}>
            <a className="btn green" href="#/review">Review {drafted.length} draft{drafted.length === 1 ? '' : 's'} →</a>
          </div>
        )}
      </div>
    </>
  );
}

function ModeCard({ active, onClick, icon, title, desc }) {
  return (
    <button onClick={onClick} className="card" style={{
      flex: 1, textAlign: 'left', padding: 16, cursor: 'pointer',
      border: active ? '1px solid var(--indigo)' : '1px solid var(--border)',
      background: active ? 'rgba(99,102,241,0.1)' : 'var(--panel)', color: 'inherit'
    }}>
      <div style={{ fontSize: 22, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontWeight: 800, marginBottom: 5 }}>{title}</div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{desc}</div>
    </button>
  );
}
