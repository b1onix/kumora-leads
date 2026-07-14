import React, { useState } from 'react';
import { useData } from '../App.jsx';
import { api } from '../api.js';

export default function Review() {
  const { state, refresh, toast } = useData();
  const leads = state?.leads || [];
  const drafts = leads.filter((l) => ['drafted', 'send_failed'].includes(l.status));
  const testMode = state?.testMode;
  const health = state?.health;
  const [busy, setBusy] = useState(false);

  async function approveAll() {
    if (drafts.length === 0) return;
    if (!health?.ok) return toast('Finish Settings first: ' + (health?.missing || []).join(', '), 'err');
    const verb = testMode ? 'send (TEST mode → your inbox)' : 'SEND for real';
    if (!confirm(`Approve and ${verb} ${drafts.length} email(s)?`)) return;
    setBusy(true);
    try { const r = await api.approve(drafts.map((l) => l.id)); toast(`Queued ${r.queued} to send`); refresh(); }
    catch (e) { toast(e.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Review &amp; send</h1><p>Edit anything, then approve. A compliance footer is added automatically.</p></div>
        {drafts.length > 0 && <button className="btn green" disabled={busy} onClick={approveAll}>✓ Approve &amp; send all ({drafts.length})</button>}
      </div>

      {testMode && (
        <div className="banner test">🧪 Test mode is ON — every send goes to your own inbox, not the real business. Turn it off in Settings when ready.</div>
      )}
      {!health?.ok && (
        <div className="banner warn">Sending is not configured yet: {(health?.missing || []).join(', ')}. <a className="b-act" href="#/settings">Open Settings →</a></div>
      )}

      {drafts.length === 0 ? (
        <div className="card pad empty">
          <div className="big">➤</div><h3>No drafts waiting</h3>
          <p>Generate some on the <a href="#/compose">Generate</a> page, then review them here.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {drafts.map((l) => <DraftCard key={l.id} lead={l} refresh={refresh} toast={toast} />)}
        </div>
      )}
    </>
  );
}

function DraftCard({ lead, refresh, toast }) {
  const [subject, setSubject] = useState(lead.draft?.subject || '');
  const [body, setBody] = useState(lead.draft?.body || '');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(fn, msg) {
    setBusy(true);
    try { if (editing) await api.editLead(lead.id, { subject, body }); await fn(); if (msg) toast(msg); refresh(); }
    catch (e) { toast(e.message, 'err'); }
    finally { setBusy(false); }
  }

  const words = body.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="card pad">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{lead.name}</div>
          <div className="muted" style={{ fontSize: 12.5 }}>→ {lead.email}{lead.category ? ` · ${lead.category}` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className={'pill ' + lead.status}>{lead.status.replace(/_/g, ' ')}</span>
        </div>
      </div>

      {lead.error && <div className="note warn" style={{ marginBottom: 10 }}>⚠ {lead.error}</div>}
      {lead.draft?.researchNote && <div className="research" style={{ marginBottom: 12 }}><span>🔎</span><span>{lead.draft.researchNote}</span></div>}

      {editing ? (
        <>
          <label className="field"><span className="fl">Subject <span className="hint">{subject.length} chars</span></span>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
          <label className="field"><span className="fl">Body <span className="hint">{words} words</span></span>
            <textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} /></label>
        </>
      ) : (
        <div style={{ background: 'rgba(0,0,0,0.22)', border: '1px solid var(--border)', borderRadius: 11, padding: '12px 14px' }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>{subject || <span className="muted">(no subject)</span>}</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{body}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 9, marginTop: 14, alignItems: 'center' }}>
        <button className="btn sm" onClick={() => setEditing((e) => !e)}>{editing ? '✓ Done editing' : '✎ Edit'}</button>
        <button className="btn sm" disabled={busy} onClick={() => run(() => api.generate([lead.id], false), 'Regenerating…')}>↻ Regenerate</button>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn sm danger" disabled={busy} onClick={() => run(() => api.reject([lead.id]), 'Rejected')}>Reject</button>
        <button className="btn sm green" disabled={busy} onClick={() => run(() => api.approve([lead.id]), 'Approved & queued')}>✓ Approve &amp; send</button>
      </div>
    </div>
  );
}
