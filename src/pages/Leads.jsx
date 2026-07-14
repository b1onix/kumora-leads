import React, { useState, useMemo } from 'react';
import { useData } from '../App.jsx';
import { api } from '../api.js';
import LeadDrawer from '../components/LeadDrawer.jsx';

const FILTERS = {
  all: () => true,
  email: (l) => !!l.email,
  noemail: (l) => !l.email,
  drafted: (l) => ['drafted', 'approved', 'sending'].includes(l.status),
  sent: (l) => l.status === 'sent',
  failed: (l) => ['draft_failed', 'send_failed'].includes(l.status)
};

export default function Leads() {
  const { state, refresh, toast } = useData();
  const leads = state?.leads || [];
  const [filter, setFilter] = useState('all');
  const [sel, setSel] = useState(new Set());
  const [open, setOpen] = useState(null);
  const [drag, setDrag] = useState(false);
  const [q, setQ] = useState('');

  const shown = useMemo(() => {
    const f = FILTERS[filter] || FILTERS.all;
    const needle = q.trim().toLowerCase();
    return leads.filter((l) => f(l) && (!needle ||
      l.name.toLowerCase().includes(needle) ||
      (l.category || '').toLowerCase().includes(needle) ||
      (l.email || '').toLowerCase().includes(needle)));
  }, [leads, filter, q]);

  const allSel = shown.length > 0 && shown.every((l) => sel.has(l.id));
  const toggleAll = () => {
    const next = new Set(sel);
    if (allSel) shown.forEach((l) => next.delete(l.id));
    else shown.forEach((l) => next.add(l.id));
    setSel(next);
  };
  const toggle = (id) => {
    const next = new Set(sel);
    next.has(id) ? next.delete(id) : next.add(id);
    setSel(next);
  };

  const selIds = [...sel];
  const selWithEmail = leads.filter((l) => sel.has(l.id) && l.email).map((l) => l.id);

  async function generateSelected() {
    if (selWithEmail.length === 0) return toast('Select leads that have an email first', 'err');
    try {
      const r = await api.generate(selWithEmail, false);
      toast(`Queued ${r.queued} for drafting`);
      refresh();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function deleteSelected() {
    if (selIds.length === 0) return;
    if (!confirm(`Delete ${selIds.length} lead(s)?`)) return;
    try { await api.deleteLeads(selIds); setSel(new Set()); refresh(); toast('Deleted'); }
    catch (e) { toast(e.message, 'err'); }
  }

  async function handleFiles(fileList) {
    const file = fileList[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const payload = Array.isArray(parsed)
        ? { leads: parsed, query: file.name }
        : { leads: parsed.leads || [], query: parsed.query || file.name };
      if (!payload.leads.length) return toast('No leads found in that file', 'err');
      const r = await api.import(payload);
      toast(`Imported ${r.imported}, skipped ${r.dupes} dupes`);
      refresh();
    } catch (e) { toast('Import failed: ' + e.message, 'err'); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Leads</h1><p>{leads.length} total · {leads.filter((l) => l.email).length} with an email address</p></div>
        <div style={{ display: 'flex', gap: 10 }}>
          <label className="btn" style={{ cursor: 'pointer' }}>
            ⬆ Import JSON
            <input type="file" accept="application/json,.json" hidden onChange={(e) => handleFiles(e.target.files)} />
          </label>
          <button className="btn primary" disabled={!selWithEmail.length} onClick={generateSelected}>✎ Generate ({selWithEmail.length})</button>
        </div>
      </div>

      <div
        className={'dropzone' + (drag ? ' drag' : '')}
        style={{ marginBottom: 18, padding: leads.length ? 14 : 26 }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
      >
        {drag ? 'Drop to import' : 'Drag a leads-*.json file here (exported from the extension) — or use ⇪ Dashboard in the extension for one-click push'}
      </div>

      <div className="toolbar">
        <div className="seg">
          {[['all', 'All'], ['email', 'Has email'], ['noemail', 'No email'], ['drafted', 'Drafted'], ['sent', 'Sent'], ['failed', 'Failed']].map(([k, lbl]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{lbl}</button>
          ))}
        </div>
        <input type="text" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
        <div className="spacer" />
        {selIds.length > 0 && <>
          <span className="muted" style={{ fontSize: 13 }}>{selIds.length} selected</span>
          <button className="btn sm danger" onClick={deleteSelected}>Delete</button>
        </>}
      </div>

      {shown.length === 0 ? (
        <div className="card pad empty"><div className="big">≡</div><h3>No leads to show</h3><p>Import some leads or change the filter.</p></div>
      ) : (
        <div className="table-wrap">
          <table className="leads">
            <thead>
              <tr>
                <th className="checkcol"><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>
                <th>Business</th><th>Category</th><th>Email</th><th>Website</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id} onClick={() => setOpen(l.id)} style={{ cursor: 'pointer' }}>
                  <td className="checkcol" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggle(l.id)} />
                  </td>
                  <td className="name">{l.name}</td>
                  <td className="cell-mute">{l.category || '—'}</td>
                  <td>{l.email ? <span style={{ color: 'var(--cyan)' }}>{l.email}</span> : <span className="cell-mute">—</span>}</td>
                  <td>{l.website ? <a href={l.website} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>site ↗</a> : <span className="cell-mute">—</span>}</td>
                  <td><span className={'pill ' + l.status}>{l.status.replace(/_/g, ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && <LeadDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
