import React, { useState, useEffect } from 'react';
import { useData } from '../App.jsx';
import { api } from '../api.js';

/**
 * Plan & Billing. Three packages side by side, current plan marked, upgrades
 * go through Stripe Checkout. Quotas reset on the 1st of each month.
 */
export default function Billing() {
  const { toast } = useData();
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState('');

  const load = () => api.billing().then(setInfo).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []);

  // Post-checkout landing (#/billing?upgraded=pro).
  const upgraded = new URLSearchParams(window.location.hash.split('?')[1] || '').get('upgraded');

  if (!info) return <div className="page-head"><h1>Plan &amp; Billing</h1></div>;

  const { plans, usage, configured } = info;

  async function upgrade(planKey) {
    setBusy(planKey);
    try {
      const r = await api.checkout(planKey);
      if (r.url) window.location.href = r.url; // off to Stripe's hosted checkout
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusy('');
    }
  }

  const fmt = (n) => (n == null ? 'Unlimited' : n.toLocaleString());

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Plan &amp; Billing</h1>
          <p>Monthly quotas reset on the 1st. Upgrades apply instantly after checkout.</p>
        </div>
      </div>

      {upgraded && (
        <div className="banner test">
          Payment received — your {upgraded.toUpperCase()} plan activates as soon as Stripe confirms (a few seconds).
        </div>
      )}
      {!configured && (
        <div className="banner warn">
          Purchasing isn't open yet — plans below show what's coming.
        </div>
      )}

      <div className="plan-grid">
        {plans.map((p) => {
          const current = usage.plan === p.key || (usage.plan === 'owner' && p.key === 'ultra');
          const highlight = p.key === 'pro';
          return (
            <div key={p.key} className={'plan-card' + (highlight ? ' highlight' : '') + (current ? ' current' : '')}>
              {highlight && <div className="plan-flag">Most popular</div>}
              <div className="plan-name">{p.label}</div>
              <div className="plan-price">
                {p.priceMonthly === 0 ? 'Free' : <>${p.priceMonthly}<span>/mo</span></>}
              </div>
              <ul className="plan-feats">
                <li><b>{fmt(p.leadsPerMonth)}</b> lead extractions / month</li>
                <li><b>{fmt(p.emailsPerMonth)}</b> emails sent / month</li>
                <li>AI-written personal emails</li>
                <li>Send from your own domain (Resend)</li>
                <li className={p.customAI ? '' : 'off'}>
                  {p.customAI ? 'Custom AI writer instructions' : 'Custom AI writer — Pro and up'}
                </li>
              </ul>
              {current ? (
                <button className="btn" disabled style={{ width: '100%', justifyContent: 'center' }}>Current plan</button>
              ) : p.priceMonthly === 0 ? (
                <button className="btn ghost" disabled style={{ width: '100%', justifyContent: 'center' }}>Included at signup</button>
              ) : (
                <button
                  className={'btn ' + (highlight ? 'primary' : '')}
                  style={{ width: '100%', justifyContent: 'center' }}
                  disabled={!!busy}
                  onClick={() => upgrade(p.key)}
                >
                  {busy === p.key ? 'Opening checkout…' : `Upgrade to ${p.label}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="card pad" style={{ marginTop: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14 }}>This month's usage</div>
        <UsageBar label="Lead extractions" m={usage.leads} />
        <UsageBar label="Emails sent" m={usage.emails} />
        <div className="note" style={{ marginTop: 12 }}>
          Test-mode sends don't count against your email quota. Duplicate leads never count against extractions.
        </div>
      </div>
    </>
  );
}

function UsageBar({ label, m }) {
  const pct = m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 0;
  const near = m.limit && pct >= 85;
  return (
    <div className="usage-row">
      <div className="usage-top">
        <span>{label}</span>
        <span className="mono">{m.used.toLocaleString()} / {m.limit ? m.limit.toLocaleString() : '∞'}</span>
      </div>
      <div className="meter-track big">
        <div className={'meter-fill' + (near ? ' near' : '')} style={{ width: (m.limit ? pct : 4) + '%' }} />
      </div>
    </div>
  );
}
