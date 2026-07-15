import React from 'react';
import { useData } from '../App.jsx';

const STATUS_ORDER = [
  ['total', 'Imported', (l) => true],
  ['withEmail', 'Has email', (l) => !!l.email],
  ['drafted', 'Drafted', (l) => ['drafted', 'approved', 'sending', 'sent'].includes(l.status)],
  ['approved', 'Approved+', (l) => ['approved', 'sending', 'sent'].includes(l.status)],
  ['sent', 'Sent', (l) => l.status === 'sent']
];

export default function Dashboard() {
  const { state } = useData();
  const leads = state?.leads || [];
  const campaigns = state?.campaigns || [];

  const funnel = STATUS_ORDER.map(([key, label, fn]) => ({
    key, label, n: leads.filter(fn).length
  }));
  const max = Math.max(1, funnel[0].n);

  const withEmail = leads.filter((l) => l.email).length;
  const sent = leads.filter((l) => l.status === 'sent').length;
  const failed = leads.filter((l) => ['draft_failed', 'send_failed'].includes(l.status)).length;
  const emailRate = leads.length ? Math.round((withEmail / leads.length) * 100) : 0;

  const recent = [...leads]
    .filter((l) => l.updatedAt)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 8);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Your lead pipeline at a glance.</p>
        </div>
        <a className="btn primary" href="#/compose">Generate emails →</a>
      </div>

      {leads.length === 0 ? (
        <div className="card pad empty">
          <div className="big">◉</div>
          <h3>No leads yet</h3>
          <p>Open Google Maps, scrape with the Kumora extension, then hit <b>⇪ Dashboard</b>.<br />
             Or import a JSON file on the <a href="#/leads">Leads</a> page.</p>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat"><div className="num">{leads.length}</div><div className="lbl">Total leads</div><div className="sub">{campaigns.length} import{campaigns.length === 1 ? '' : 's'}</div></div>
            <div className="stat"><div className="num">{withEmail}</div><div className="lbl">With email</div><div className="sub">{emailRate}% of leads</div></div>
            <div className="stat"><div className="num">{sent}</div><div className="lbl">Emails sent</div><div className="sub">{state?.sentToday ?? 0} today</div></div>
            <div className="stat"><div className="num">{failed}</div><div className="lbl">Needs attention</div><div className="sub">failed draft/send</div></div>
          </div>

          <div className="row" style={{ alignItems: 'stretch' }}>
            <div className="card pad" style={{ flex: 1.4 }}>
              <h3 style={{ fontSize: 15, marginBottom: 16 }}>Pipeline funnel</h3>
              <div className="funnel">
                {funnel.map((f) => (
                  <div className="funnel-row" key={f.key}>
                    <div className="fl-label">{f.label}</div>
                    <div className="fl-bar"><div className="fl-fill" style={{ width: (f.n / max) * 100 + '%' }} /></div>
                    <div className="fl-num">{f.n}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card pad" style={{ flex: 1 }}>
              <h3 style={{ fontSize: 15, marginBottom: 14 }}>Recent activity</h3>
              {recent.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>Nothing yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {recent.map((l) => (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                      <span className={'pill ' + l.status}>{l.status.replace('_', ' ')}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
