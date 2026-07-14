import React, { useState, useEffect } from 'react';
import { useData } from '../App.jsx';
import { api } from '../api.js';

export default function LeadDrawer({ id, onClose }) {
  const { state, refresh, toast } = useData();
  const lead = (state?.leads || []).find((l) => l.id === id);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (lead?.draft) {
      setSubject(lead.draft.subject || '');
      setBody(lead.draft.body || '');
      setDirty(false);
    }
  }, [lead?.draft?.generatedAt, id]);

  if (!lead) return null;

  async function act(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); refresh(); }
    catch (e) { toast(e.message, 'err'); }
  }

  const save = () => act(() => api.editLead(id, { subject, body }), 'Draft saved').then(() => setDirty(false));

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{lead.name}</div>
            <div className="chipline">
              <span className={'pill ' + lead.status}>{lead.status.replace(/_/g, ' ')}</span>
              {lead.category && <span className="tag">{lead.category}</span>}
              {lead.rating && <span className="tag">★ {lead.rating}{lead.reviews ? ` (${lead.reviews})` : ''}</span>}
            </div>
          </div>
          <button className="btn sm ghost" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 13, marginBottom: 18 }}>
            <span className="muted">Email</span><span style={{ color: lead.email ? 'var(--cyan)' : 'var(--text-mute)' }}>{lead.email || 'none found'}</span>
            <span className="muted">Website</span><span>{lead.website ? <a href={lead.website} target="_blank" rel="noopener">{lead.website}</a> : '—'}</span>
            <span className="muted">Phone</span><span>{lead.phone || '—'}</span>
            <span className="muted">Address</span><span>{lead.address || '—'}</span>
            {lead.mapsUrl && <><span className="muted">Maps</span><span><a href={lead.mapsUrl} target="_blank" rel="noopener">open in maps ↗</a></span></>}
          </div>

          {lead.error && <div className="note warn" style={{ marginBottom: 16 }}>⚠ {lead.error}</div>}

          {!lead.email && <div className="note" style={{ marginBottom: 16 }}>This lead has no email, so it can't be drafted or sent. It's kept for reference.</div>}

          {lead.draft ? (
            <>
              {lead.draft.researchNote && (
                <div className="research"><span>🔎</span><span>{lead.draft.researchNote}</span></div>
              )}
              <label className="field" style={{ marginTop: 14 }}>
                <span className="fl">Subject <span className="hint">{subject.length} chars</span></span>
                <input type="text" value={subject} onChange={(e) => { setSubject(e.target.value); setDirty(true); }} />
              </label>
              <label className="field">
                <span className="fl">Body <span className="hint">{body.trim().split(/\s+/).filter(Boolean).length} words · footer added on send</span></span>
                <textarea rows={11} value={body} onChange={(e) => { setBody(e.target.value); setDirty(true); }} />
              </label>
            </>
          ) : lead.email ? (
            <div className="note info">No draft yet. Generate one below (Claude will research their website and write a personalized email).</div>
          ) : null}
        </div>

        <div className="drawer-foot">
          {lead.email && (
            <button className="btn" onClick={() => act(() => api.generate([id], false), 'Queued for drafting')}>
              {lead.draft ? '↻ Regenerate' : '✎ Generate'}
            </button>
          )}
          {lead.draft && dirty && <button className="btn" onClick={save}>💾 Save edits</button>}
          {lead.draft && ['drafted', 'send_failed'].includes(lead.status) && (
            <button className="btn green" onClick={async () => { if (dirty) await api.editLead(id, { subject, body }); act(() => api.approve([id]), 'Approved & queued to send'); }}>
              ✓ Approve & send
            </button>
          )}
          <div className="spacer" style={{ flex: 1 }} />
          {lead.email && lead.status !== 'suppressed' && (
            <button className="btn sm danger" onClick={() => act(() => api.suppress(lead.email), 'Suppressed')}>Suppress</button>
          )}
        </div>
      </div>
    </>
  );
}
